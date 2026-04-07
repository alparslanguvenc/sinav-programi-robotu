import type { ExamCard, ScheduleDocument, ScheduleView, UiScale } from "../types/schedule";

export const SLOT_KEY_SEPARATOR = "__@@__";
export const STORAGE_KEY = "vize-programi-editor.document";
export const SAVED_RECORDS_STORAGE_KEY = "vize-programi-editor.saved-records";
export const ACTIVE_SAVED_RECORD_STORAGE_KEY = "vize-programi-editor.active-saved-record";
export const UI_SCALE_STORAGE_KEY = "vize-programi-editor.ui-scale";
export const SAMPLE_FIXTURE_URL = `${import.meta.env.BASE_URL}fixtures/vize_programi_ders_programi_gorunumu.xlsx`;
export const UNASSIGNED_SLOT_KEY = "__unassigned__";
export const UNOFFERED_SLOT_KEY = "__unoffered__";
export const UNASSIGNED_SHEET_NAME = "Yerleştirilmeyen";
export const UNOFFERED_SECTION_TITLE = "Açılmayan Dersler";
export const UI_SCALE_VALUES: Record<UiScale, number> = {
  small: 0.88,
  normal: 1,
  large: 1.12,
};
export const TIME_INPUT_PATTERN = /^(\d{1,2}):(\d{2})$/;

let idCounter = 0;

export const createExamId = () => {
  idCounter += 1;
  return `exam-${idCounter}`;
};

export const createSlotKey = (date: string, time: string) =>
  `${date}${SLOT_KEY_SEPARATOR}${time}`;

export const isUnassignedSlot = (slotKey: string) => slotKey === UNASSIGNED_SLOT_KEY;
export const isUnofferedSlot = (slotKey: string) => slotKey === UNOFFERED_SLOT_KEY;
export const isFloatingSlot = (slotKey: string) =>
  isUnassignedSlot(slotKey) || isUnofferedSlot(slotKey);

export const normalizeTimeInput = (value: string) => {
  const normalized = value.trim();
  const match = TIME_INPUT_PATTERN.exec(normalized);

  if (!match) {
    return null;
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

export const compareTimeStrings = (left: string, right: string) => {
  const normalizedLeft = normalizeTimeInput(left) ?? left;
  const normalizedRight = normalizeTimeInput(right) ?? right;
  return normalizedLeft.localeCompare(normalizedRight, "tr");
};

export const insertTimeSorted = (times: string[], candidate: string) => {
  const normalizedCandidate = normalizeTimeInput(candidate);

  if (!normalizedCandidate) {
    return {
      ok: false as const,
      message: "Saat biçimi `HH:MM` olmalı.",
    };
  }

  if (times.includes(normalizedCandidate)) {
    return {
      ok: false as const,
      message: "Bu saat bloğu zaten var.",
    };
  }

  return {
    ok: true as const,
    normalizedTime: normalizedCandidate,
    times: [...times, normalizedCandidate].sort(compareTimeStrings),
  };
};

export const parseSlotKey = (slotKey: string) => {
  if (isUnassignedSlot(slotKey)) {
    return {
      date: "Yerleştirilmedi",
      time: "Havuz",
    };
  }

  if (isUnofferedSlot(slotKey)) {
    return {
      date: UNOFFERED_SECTION_TITLE,
      time: "Esnek",
    };
  }

  const [date, time] = slotKey.split(SLOT_KEY_SEPARATOR);
  return {
    date,
    time,
  };
};

const STANDARD_CLASS_YEAR_PATTERN = /^(\d+)\s*\.\s*S$/i;
const STANDARD_CLASS_LABEL_PATTERN = /^(\d+)\s*\.\s*Sınıf$/i;
const PROGRAM_SEPARATOR_PATTERN = /[,;\n]+/g;

const sanitizeProgram = (value: string) => value.trim().replace(/\s+/g, " ");

export const normalizePrograms = (programs: string[]) => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const program of programs) {
    const trimmed = sanitizeProgram(program);

    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLocaleLowerCase("tr");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(trimmed);
  }

  return normalized;
};

export const parseProgramsInput = (value: string) =>
  normalizePrograms(value.split(PROGRAM_SEPARATOR_PATTERN));

export const formatPrograms = (programs: string[]) => normalizePrograms(programs).join(", ");

export const normalizeClassYear = (value: string) => {
  const trimmed = value.trim().replace(/\s+/g, " ");

  if (!trimmed) {
    return "";
  }

  const compact = trimmed.replace(/\s+/g, "");
  const standardMatch =
    STANDARD_CLASS_YEAR_PATTERN.exec(compact) ?? STANDARD_CLASS_LABEL_PATTERN.exec(trimmed);

  return standardMatch ? `${standardMatch[1]}.S` : trimmed;
};

export const classYearToLabel = (classYear: string) => {
  const normalized = normalizeClassYear(classYear);
  const match = STANDARD_CLASS_YEAR_PATTERN.exec(normalized);
  return match ? `${match[1]}. Sınıf` : normalized;
};

export const labelToClassYear = (sheetName: string) => {
  const match = /^(\d+)\./.exec(sheetName.trim());
  return match ? `${match[1]}.S` : null;
};

export const splitRooms = (value: string) =>
  value
    .split(/[;,/]+/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      if (/^\d+(?:-\d+)+$/.test(part)) {
        return part.split("-").map((room) => room.trim()).filter(Boolean);
      }

      return [part];
    });

export const formatClassLabel = (classYear: string) => {
  return classYearToLabel(classYear);
};

const CLASS_YEAR_COLORS = [
  { background: "#fee2e2", foreground: "#991b1b", border: "#fca5a5" },
  { background: "#ffedd5", foreground: "#9a3412", border: "#fdba74" },
  { background: "#fef3c7", foreground: "#92400e", border: "#fcd34d" },
  { background: "#dcfce7", foreground: "#166534", border: "#86efac" },
  { background: "#d1fae5", foreground: "#065f46", border: "#6ee7b7" },
  { background: "#dbeafe", foreground: "#1d4ed8", border: "#93c5fd" },
  { background: "#e0e7ff", foreground: "#4338ca", border: "#a5b4fc" },
  { background: "#f3e8ff", foreground: "#7e22ce", border: "#d8b4fe" },
  { background: "#fce7f3", foreground: "#9d174d", border: "#f9a8d4" },
  { background: "#e2e8f0", foreground: "#334155", border: "#cbd5e1" },
];

const hashClassYear = (classYear: string) =>
  normalizeClassYear(classYear)
    .split("")
    .reduce((acc, char) => acc * 31 + char.charCodeAt(0), 7);

export const getClassYearColor = (classYear: string) => {
  const normalized = normalizeClassYear(classYear);

  if (!normalized) {
    return CLASS_YEAR_COLORS[0];
  }

  const paletteIndex = Math.abs(hashClassYear(normalized)) % CLASS_YEAR_COLORS.length;
  return CLASS_YEAR_COLORS[paletteIndex];
};

export const formatAudienceLabel = (input: Pick<ExamCard, "classYear" | "programs">) => {
  const classLabel = formatClassLabel(input.classYear);
  const programsText = formatPrograms(input.programs);
  return programsText ? `${programsText} · ${classLabel}` : classLabel;
};

export const formatLocationText = (exam: Pick<ExamCard, "locationText" | "rooms">) =>
  exam.locationText?.trim() || formatRooms(exam.rooms) || "Belirlenecek";

export const isConflictResource = (value: string) => !/\s/.test(value.trim());

export const formatRooms = (rooms: string[]) =>
  rooms.map((room) => room.trim()).filter(Boolean).join("-");

export const formatExamLine = (
  exam: Pick<ExamCard, "classYear" | "courseName" | "rooms" | "locationText" | "programs">,
  includeClassPrefix: boolean,
) => {
  const roomText = formatLocationText(exam);
  const programsText = formatPrograms(exam.programs);
  const prefix = `${programsText ? `${programsText} | ` : ""}${
    includeClassPrefix ? `${normalizeClassYear(exam.classYear)}: ` : ""
  }`;
  return `${prefix}${exam.courseName} (${roomText})`;
};

export const createViews = (classYears: string[]): ScheduleView[] => [
  { id: "genel", label: "Genel", classYear: null },
  ...sortClassYears(classYears).map((classYear) => ({
    id: `class:${normalizeClassYear(classYear)}`,
    label: classYearToLabel(classYear),
    classYear: normalizeClassYear(classYear),
  })),
];

export const sortClassYears = (classYears: string[]) =>
  [...classYears]
    .map(normalizeClassYear)
    .filter(Boolean)
    .sort((left, right) => {
      const leftNumber = Number.parseInt(left, 10);
      const rightNumber = Number.parseInt(right, 10);

      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
      }

      return left.localeCompare(right, "tr");
    });

export const normalizeDocument = (document: ScheduleDocument): ScheduleDocument => {
  const exams = document.exams.map((exam) => ({
    ...exam,
    classYear: normalizeClassYear(exam.classYear),
    programs: normalizePrograms(exam.programs ?? []),
    courseName: exam.courseName.trim(),
    rooms: exam.rooms.map((room) => room.trim()).filter(Boolean),
    locationText: exam.locationText?.trim() || formatRooms(exam.rooms) || null,
    instructorText: exam.instructorText?.trim() || null,
    parallelGroupId: exam.parallelGroupId?.trim() || null,
    notes: exam.notes?.trim() || null,
    durationMinutes: exam.durationMinutes ?? DEFAULT_EXAM_DURATION,
    studentCount: exam.studentCount ?? null,
  }));

  const classYears = new Set<string>([
    ...Object.keys(document.sourceMeta.classSheetTitles),
    ...exams.map((exam) => exam.classYear),
  ]);

  return {
    ...document,
    exams,
    template: {
      ...document.template,
      views: createViews([...classYears]),
    },
  };
};

export const DEFAULT_EXAM_DURATION = 60;

export const createBlankExam = (
  slotKey: string,
  classYear: string,
  programs: string[] = [],
  durationMinutes: number = DEFAULT_EXAM_DURATION,
): ExamCard => ({
  id: createExamId(),
  courseName: "Yeni Sınav",
  classYear: normalizeClassYear(classYear),
  programs: normalizePrograms(programs),
  slotKey,
  rooms: ["Belirlenecek"],
  locationText: "Belirlenecek",
  instructorText: null,
  parallelGroupId: null,
  notes: null,
  durationMinutes,
  studentCount: null,
});

export const getActiveViewClassYear = (
  document: ScheduleDocument | null,
  activeViewId: string,
) => document?.template.views.find((view) => view.id === activeViewId)?.classYear ?? null;

export const getDefaultSlotKey = (document: ScheduleDocument) =>
  document.template.dates[0] && document.template.times[0]
    ? UNASSIGNED_SLOT_KEY
    : UNASSIGNED_SLOT_KEY;

export const sortExamsForDisplay = (document: ScheduleDocument, exams: ExamCard[]) => {
  const dateOrder = new Map(document.template.dates.map((date, index) => [date, index]));
  const timeOrder = new Map(document.template.times.map((time, index) => [time, index]));

  return [...exams].sort((left, right) => {
    const leftPriority = isUnassignedSlot(left.slotKey) ? 2 : isUnofferedSlot(left.slotKey) ? 1 : 0;
    const rightPriority = isUnassignedSlot(right.slotKey) ? 2 : isUnofferedSlot(right.slotKey) ? 1 : 0;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    const leftSlot = parseSlotKey(left.slotKey);
    const rightSlot = parseSlotKey(right.slotKey);
    const dateDelta = (dateOrder.get(leftSlot.date) ?? 999) - (dateOrder.get(rightSlot.date) ?? 999);

    if (dateDelta !== 0) {
      return dateDelta;
    }

    const timeDelta = (timeOrder.get(leftSlot.time) ?? 999) - (timeOrder.get(rightSlot.time) ?? 999);

    if (timeDelta !== 0) {
      return timeDelta;
    }

    const classDelta = normalizeClassYear(left.classYear).localeCompare(
      normalizeClassYear(right.classYear),
      "tr",
    );

    if (classDelta !== 0) {
      return classDelta;
    }

    const programDelta = formatPrograms(left.programs).localeCompare(formatPrograms(right.programs), "tr");

    if (programDelta !== 0) {
      return programDelta;
    }

    return left.courseName.localeCompare(right.courseName, "tr");
  });
};

export const groupExamsBySlot = (document: ScheduleDocument, exams: ExamCard[]) => {
  const grouped = new Map<string, ExamCard[]>();

  for (const exam of sortExamsForDisplay(document, exams)) {
    const existing = grouped.get(exam.slotKey);
    if (existing) {
      existing.push(exam);
    } else {
      grouped.set(exam.slotKey, [exam]);
    }
  }

  return grouped;
};

export const doAudiencesOverlap = (
  left: Pick<ExamCard, "classYear" | "programs">,
  right: Pick<ExamCard, "classYear" | "programs">,
) => {
  const leftClassYear = normalizeClassYear(left.classYear);
  const rightClassYear = normalizeClassYear(right.classYear);

  if (!leftClassYear || leftClassYear !== rightClassYear) {
    return false;
  }

  const leftPrograms = normalizePrograms(left.programs ?? []);
  const rightPrograms = normalizePrograms(right.programs ?? []);

  if (leftPrograms.length === 0 || rightPrograms.length === 0) {
    return true;
  }

  const rightSet = new Set(rightPrograms.map((program) => program.toLocaleLowerCase("tr")));
  return leftPrograms.some((program) => rightSet.has(program.toLocaleLowerCase("tr")));
};

export const groupExamsByAudience = (exams: ExamCard[]) => {
  const grouped = new Map<string, { label: string; exams: ExamCard[]; sortKey: string }>();

  for (const exam of exams) {
    const normalizedClassYear = normalizeClassYear(exam.classYear);
    const programsText = formatPrograms(exam.programs);
    const key = `${programsText.toLocaleLowerCase("tr")}::${normalizedClassYear.toLocaleLowerCase("tr")}`;
    const label = formatAudienceLabel(exam);
    const existing = grouped.get(key);

    if (existing) {
      existing.exams.push(exam);
    } else {
      grouped.set(key, {
        label,
        exams: [exam],
        sortKey: `${normalizedClassYear}::${programsText}`,
      });
    }
  }

  return [...grouped.values()].sort((left, right) => left.sortKey.localeCompare(right.sortKey, "tr"));
};
