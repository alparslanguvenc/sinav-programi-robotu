import {
  doAudiencesOverlap,
  formatAudienceLabel,
  formatPrograms,
  isConflictResource,
  isFloatingSlot,
  normalizePrograms,
  parseSlotKey,
} from "./schedule";
import type { Conflict, ExamCard } from "../types/schedule";

const createConflictId = (type: Conflict["type"], slotKey: string, resourceKey: string) =>
  `${type}:${slotKey}:${resourceKey}`;

const haveSharedParallelGroup = (left: ExamCard, right: ExamCard) =>
  Boolean(left.parallelGroupId) && left.parallelGroupId === right.parallelGroupId;

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

export const detectConflicts = (exams: ExamCard[]) => {
  const roomUsage = new Map<string, Set<string>>();
  const slotClassUsage = new Map<string, ExamCard[]>();

  for (const exam of exams) {
    if (isFloatingSlot(exam.slotKey)) {
      continue;
    }

    for (const room of new Set(exam.rooms.filter(isConflictResource))) {
      const key = `${exam.slotKey}::${room}`;
      const existing = roomUsage.get(key);

      if (existing) {
        existing.add(exam.id);
      } else {
        roomUsage.set(key, new Set([exam.id]));
      }
    }

    const normalizedClassYear = exam.classYear.trim();

    if (!normalizedClassYear) {
      continue;
    }

    const classKey = `${exam.slotKey}::${normalizedClassYear}`;
    const classExams = slotClassUsage.get(classKey);

    if (classExams) {
      classExams.push(exam);
    } else {
      slotClassUsage.set(classKey, [exam]);
    }
  }

  const conflicts: Conflict[] = [];

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

        if (!doAudiencesOverlap(leftExam, rightExam) || haveSharedParallelGroup(leftExam, rightExam)) {
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
