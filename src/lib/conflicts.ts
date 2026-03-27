import { isConflictResource, isFloatingSlot, parseSlotKey } from "./schedule";
import type { Conflict, ExamCard } from "../types/schedule";

const createConflictId = (type: Conflict["type"], slotKey: string, resourceKey: string) =>
  `${type}:${slotKey}:${resourceKey}`;

const hasSharedParallelGroup = (exams: ExamCard[]) => {
  if (exams.length < 2) {
    return false;
  }

  const groups = new Set(exams.map((exam) => exam.parallelGroupId).filter(Boolean));
  return groups.size === 1 && groups.has(exams[0]?.parallelGroupId ?? null);
};

export const detectConflicts = (exams: ExamCard[]) => {
  const roomUsage = new Map<string, Set<string>>();
  const classUsage = new Map<string, ExamCard[]>();

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
    const classExams = classUsage.get(classKey);

    if (classExams) {
      classExams.push(exam);
    } else {
      classUsage.set(classKey, [exam]);
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

  for (const [key, slotExams] of classUsage.entries()) {
    if (slotExams.length < 2 || hasSharedParallelGroup(slotExams)) {
      continue;
    }

    const [slotKey, classYear] = key.split("::");
    conflicts.push({
      id: createConflictId("class", slotKey, classYear),
      type: "class",
      slotKey,
      resourceKey: classYear,
      cardIds: slotExams.map((exam) => exam.id),
      severity: "warning",
    });
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
