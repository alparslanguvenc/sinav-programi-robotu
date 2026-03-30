import {
  DEFAULT_EXAM_DURATION,
  doAudiencesOverlap,
  formatAudienceLabel,
  formatPrograms,
  isConflictResource,
  isFloatingSlot,
  normalizePrograms,
  normalizeTimeInput,
  parseSlotKey,
  SLOT_KEY_SEPARATOR,
} from "./schedule";
import type { Conflict, ExamCard, SchoolProfile } from "../types/schedule";

const createConflictId = (type: Conflict["type"], slotKey: string, resourceKey: string) =>
  `${type}:${slotKey}:${resourceKey}`;

const haveSharedParallelGroup = (left: ExamCard, right: ExamCard) =>
  Boolean(left.parallelGroupId) && left.parallelGroupId === right.parallelGroupId;

const haveSharedElectiveGroup = (left: ExamCard, right: ExamCard) =>
  Boolean(left.electiveGroupId) && left.electiveGroupId === right.electiveGroupId;

const getComponentResourceKey = (exams: ExamCard[]) => {
  const firstExam = exams[0];

  if (!firstExam) {
    return "";
  }

  if (exams.some((exam) => normalizePrograms(exam.programs).length === 0)) {
    return formatAudienceLabel({
      classYear: firstExam.classYear,
      programs: [],
    });
  }

  const programs = normalizePrograms(exams.flatMap((exam) => exam.programs));
  return formatAudienceLabel({
    classYear: firstExam.classYear,
    programs,
  });
};

/** Parse time from slot key to minutes since midnight */
const slotTimeToMinutes = (slotKey: string): number | null => {
  const { time } = parseSlotKey(slotKey);
  const normalized = normalizeTimeInput(time);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
};

/** Check if two exams in the same day have overlapping time ranges based on durations */
const doTimesOverlap = (examA: ExamCard, examB: ExamCard): boolean => {
  const startA = slotTimeToMinutes(examA.slotKey);
  const startB = slotTimeToMinutes(examB.slotKey);
  if (startA === null || startB === null) return false;

  const endA = startA + (examA.durationMinutes ?? DEFAULT_EXAM_DURATION);
  const endB = startB + (examB.durationMinutes ?? DEFAULT_EXAM_DURATION);

  return startA < endB && startB < endA;
};

/** Get date part from slot key */
const getSlotDate = (slotKey: string): string => {
  const sepIndex = slotKey.indexOf(SLOT_KEY_SEPARATOR);
  return sepIndex >= 0 ? slotKey.slice(0, sepIndex) : slotKey;
};

export interface ConflictDetectionOptions {
  profile?: SchoolProfile | null;
}

export const detectConflicts = (
  exams: ExamCard[],
  options: ConflictDetectionOptions = {},
) => {
  const roomUsage = new Map<string, Set<string>>();
  const slotClassUsage = new Map<string, ExamCard[]>();
  const slotInstructorUsage = new Map<string, ExamCard[]>();

  for (const exam of exams) {
    if (isFloatingSlot(exam.slotKey)) {
      continue;
    }

    // Room conflicts
    for (const room of new Set(exam.rooms.filter(isConflictResource))) {
      const key = `${exam.slotKey}::${room}`;
      const existing = roomUsage.get(key);

      if (existing) {
        existing.add(exam.id);
      } else {
        roomUsage.set(key, new Set([exam.id]));
      }
    }

    // Class conflicts
    const normalizedClassYear = exam.classYear.trim();

    if (normalizedClassYear) {
      const classKey = `${exam.slotKey}::${normalizedClassYear}`;
      const classExams = slotClassUsage.get(classKey);

      if (classExams) {
        classExams.push(exam);
      } else {
        slotClassUsage.set(classKey, [exam]);
      }
    }

    // Instructor conflicts
    const instructor = exam.instructorText?.trim();
    if (instructor) {
      const instructorKey = `${exam.slotKey}::${instructor.toLocaleLowerCase("tr")}`;
      const instructorExams = slotInstructorUsage.get(instructorKey);

      if (instructorExams) {
        instructorExams.push(exam);
      } else {
        slotInstructorUsage.set(instructorKey, [exam]);
      }
    }
  }

  const conflicts: Conflict[] = [];

  // Room conflicts
  for (const [key, cardIds] of roomUsage.entries()) {
    if (cardIds.size < 2) {
      continue;
    }

    const [slotKey, room] = key.split("::");
    conflicts.push({
      id: createConflictId("room", slotKey, room),
      type: "room",
      slotKey,
      resourceKey: room,
      cardIds: [...cardIds],
      severity: "warning",
    });
  }

  // Class conflicts (audience overlap)
  for (const [key, slotExams] of slotClassUsage.entries()) {
    if (slotExams.length < 2) {
      continue;
    }

    const adjacency = new Map<string, Set<string>>();

    for (const exam of slotExams) {
      adjacency.set(exam.id, new Set());
    }

    for (let leftIndex = 0; leftIndex < slotExams.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < slotExams.length; rightIndex += 1) {
        const leftExam = slotExams[leftIndex];
        const rightExam = slotExams[rightIndex];

        if (
          !doAudiencesOverlap(leftExam, rightExam) ||
          haveSharedParallelGroup(leftExam, rightExam) ||
          haveSharedElectiveGroup(leftExam, rightExam)
        ) {
          continue;
        }

        adjacency.get(leftExam.id)?.add(rightExam.id);
        adjacency.get(rightExam.id)?.add(leftExam.id);
      }
    }

    const visited = new Set<string>();

    for (const exam of slotExams) {
      if (visited.has(exam.id) || (adjacency.get(exam.id)?.size ?? 0) === 0) {
        continue;
      }

      const queue = [exam.id];
      const componentIds: string[] = [];

      while (queue.length > 0) {
        const currentId = queue.shift()!;

        if (visited.has(currentId)) {
          continue;
        }

        visited.add(currentId);
        componentIds.push(currentId);

        for (const neighborId of adjacency.get(currentId) ?? []) {
          if (!visited.has(neighborId)) {
            queue.push(neighborId);
          }
        }
      }

      if (componentIds.length < 2) {
        continue;
      }

      const componentExams = slotExams.filter((slotExam) => componentIds.includes(slotExam.id));
      const [slotKey] = key.split("::");
      const resourceKey = getComponentResourceKey(componentExams);

      conflicts.push({
        id: createConflictId("class", slotKey, `${resourceKey}:${formatPrograms(componentExams.flatMap((item) => item.programs))}`),
        type: "class",
        slotKey,
        resourceKey,
        cardIds: componentIds,
        severity: "warning",
      });
    }
  }

  // Instructor conflicts
  for (const [key, instructorExams] of slotInstructorUsage.entries()) {
    if (instructorExams.length < 2) {
      continue;
    }

    const [slotKey, instructorLower] = key.split("::");
    const displayName = instructorExams[0].instructorText ?? instructorLower;

    conflicts.push({
      id: createConflictId("instructor", slotKey, instructorLower),
      type: "instructor",
      slotKey,
      resourceKey: displayName,
      cardIds: instructorExams.map((exam) => exam.id),
      severity: "warning",
    });
  }

  // Capacity conflicts (student count > room capacity)
  const profile = options.profile ?? null;
  if (profile?.roomCapacities) {
    for (const exam of exams) {
      if (isFloatingSlot(exam.slotKey)) continue;
      const studentCount = exam.studentCount;
      if (!studentCount || studentCount <= 0) continue;

      for (const room of exam.rooms.filter(isConflictResource)) {
        const capacity = profile.roomCapacities[room];
        if (capacity && studentCount > capacity) {
          conflicts.push({
            id: createConflictId("capacity", exam.slotKey, `${room}:${exam.id}`),
            type: "capacity",
            slotKey: exam.slotKey,
            resourceKey: `${room} (${capacity} kişilik) < ${studentCount} öğrenci`,
            cardIds: [exam.id],
            severity: "warning",
          });
        }
      }
    }
  }

  // Duration overlap conflicts (same day, overlapping time ranges, same resource)
  const scheduledExams = exams.filter((exam) => !isFloatingSlot(exam.slotKey));
  const examsByDate = new Map<string, ExamCard[]>();
  for (const exam of scheduledExams) {
    const date = getSlotDate(exam.slotKey);
    const dateExams = examsByDate.get(date);
    if (dateExams) {
      dateExams.push(exam);
    } else {
      examsByDate.set(date, [exam]);
    }
  }

  for (const [, dateExams] of examsByDate) {
    for (let i = 0; i < dateExams.length; i++) {
      for (let j = i + 1; j < dateExams.length; j++) {
        const examA = dateExams[i];
        const examB = dateExams[j];

        // Skip same-slot exams (already handled by room/class checks)
        if (examA.slotKey === examB.slotKey) continue;

        // Check if durations make these overlap
        if (!doTimesOverlap(examA, examB)) continue;

        // Check for room overlap
        const sharedRooms = examA.rooms
          .filter(isConflictResource)
          .filter((room) => examB.rooms.includes(room));

        const pairKey = [examA.id, examB.id].sort().join("+");

        for (const room of sharedRooms) {
          conflicts.push({
            id: createConflictId("duration-overlap", examA.slotKey, `${room}:${pairKey}`),
            type: "duration-overlap",
            slotKey: examA.slotKey,
            resourceKey: `${room} — sınav süreleri çakışıyor`,
            cardIds: [examA.id, examB.id],
            severity: "warning",
          });
        }

        // Check for audience overlap with duration
        if (doAudiencesOverlap(examA, examB) && !haveSharedParallelGroup(examA, examB) && !haveSharedElectiveGroup(examA, examB)) {
          const resourceKey = getComponentResourceKey([examA, examB]);
          conflicts.push({
            id: createConflictId("duration-overlap", examA.slotKey, `class:${resourceKey}:${pairKey}`),
            type: "duration-overlap",
            slotKey: examA.slotKey,
            resourceKey: `${resourceKey} — sınav süreleri çakışıyor`,
            cardIds: [examA.id, examB.id],
            severity: "warning",
          });
        }
      }
    }
  }

  return conflicts.sort((left, right) => {
    const leftSlot = parseSlotKey(left.slotKey);
    const rightSlot = parseSlotKey(right.slotKey);
    const dateDelta = leftSlot.date.localeCompare(rightSlot.date, "tr");

    if (dateDelta !== 0) {
      return dateDelta;
    }

    const timeDelta = leftSlot.time.localeCompare(rightSlot.time, "tr");

    if (timeDelta !== 0) {
      return timeDelta;
    }

    return left.resourceKey.localeCompare(right.resourceKey, "tr");
  });
};

export const createConflictIndex = (conflicts: Conflict[]) => {
  const cardIds = new Set<string>();
  const slotKeys = new Set<string>();

  for (const conflict of conflicts) {
    slotKeys.add(conflict.slotKey);

    for (const cardId of conflict.cardIds) {
      cardIds.add(cardId);
    }
  }

  return {
    conflictedCardIds: cardIds,
    conflictedSlotKeys: slotKeys,
  };
};
