import * as XLSX from "xlsx";
import {
  DEFAULT_EXAM_DURATION,
  UNASSIGNED_SLOT_KEY,
  createBlankExam,
  createSlotKey,
  createViews,
  doAudiencesOverlap,
  formatPrograms,
  normalizeClassYear,
  normalizePrograms,
  normalizeDocument,
  parseProgramsInput,
  splitRooms,
} from "./schedule";
import { interpretSchedulingInstructionsWithAI, parseCoursesWithAI } from "./ai-parser";
import type { AIScheduleConstraint, AIScheduleInstructionPlan, SheetData } from "./ai-parser";
import { normalizeSchoolProfile } from "./profiles";
import { parseWorkbookArrayBuffer } from "./xlsx-parser";
import type {
  ExamCard,
  ProfileCourseTemplate,
  ScheduleDocument,
  SchoolProfile,
} from "../types/schedule";

// SheetData ile aynı yapı; ai-parser'dan alınıyor
type GenericSheet = SheetData;

export type CourseSeed = {
  programs: string[];
  classYear: string;
  courseName: string;
  instructorText: string | null;
  locationText: string | null;
  electiveGroupId?: string | null;
};

// ─── Kullanıcı talimatı ayrıştırıcısı ──────────────────────────────────────

/**
 * Slot key'den tarih ve saat parçalarını ayırır.
 * Format: "Pzt 14.05.2026__@@__09:00"
 */
const splitSlotKey = (slotKey: string): { date: string; time: string } => {
  const [date = "", time = ""] = slotKey.split("__@@__");
  return { date, time };
};

/**
 * "DD.MM.YYYY" → Date nesnesi. Geçersizse null.
 */
const parseTrDate = (str: string): Date | null => {
  const m = str.match(/(\d{1,2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Slot tarih string'inden (ör. "Pzt 14.05.2026" veya "14.05.2026") Date çıkarır.
 */
const parseDateFromSlotDate = (slotDate: string): Date | null => {
  const m = slotDate.match(/(\d{1,2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  return parseTrDate(m[0]);
};

/** Haftanın gün adı eşleştirme tablosu */
const DAY_TOKENS: Record<string, string[]> = {
  pazartesi: ["pazartesi", "pzt", "monday", "mon"],
  salı:      ["salı", "sali", "sal", "tuesday", "tue"],
  çarşamba:  ["çarşamba", "carsamba", "çar", "car", "wednesday", "wed"],
  perşembe:  ["perşembe", "persembe", "per", "thursday", "thu"],
  cuma:      ["cuma", "cum", "friday", "fri"],
};

const AVOID_RE    = /\b(olmasın|olmasin|koyma|koymayın|denk gelmesin|yapma|olmamalı|olmamali|yasak|kaçın|katma|ekleme)\b/i;
const DEADLINE_RE = /\b(kadar|bitirilsin|tamamlansın|tamamlansin)\b/i;

/** Konu dışı (stop) kelimeler */
const STOP_WORDS = new Set([
  ...Object.values(DAY_TOKENS).flat(),
  "ve", "ile", "de", "da", "bir", "bu", "tüm", "tum", "bütün", "butun",
  "sınav", "sinav", "ders", "dersi", "dersleri", "sınavı", "sinavı", "sınavları", "sinavlari",
  "aynı", "ayni", "gün", "gun", "günü", "gunu", "tarih", "tarihinde", "tarihine",
  "sınıf", "sinif", "sınıfın", "sinifin", "sınıfların", "siniflarin",
  "saati", "saatine", "saatlerine", "saat", "genel", "olarak",
  "kadar", "önce", "once", "bitirilsin", "tamamlansın", "tamamlansin",
  "olsun", "olmasın", "olmasin", "koyma", "yap", "planla",
]);

/**
 * "3. sınıf", "3.s", "üçüncü" → normalize edilmiş sınıf yılı token'ı ("3.s")
 */
const CLASS_YEAR_WORD: Record<string, string> = {
  birinci: "1.s", "1.sinif": "1.s", "1.sınıf": "1.s",
  ikinci:  "2.s", "2.sinif": "2.s", "2.sınıf": "2.s",
  üçüncü: "3.s", "3.sinif": "3.s", "3.sınıf": "3.s",
  dördüncü:"4.s", "4.sinif": "4.s", "4.sınıf": "4.s",
  beşinci: "5.s", "5.sinif": "5.s", "5.sınıf": "5.s",
};

const normalizeSubjectToken = (w: string): string => CLASS_YEAR_WORD[w] ?? w;

type ConstraintScope = "all" | "others";

/** Kısıt tipi */
type UserConstraint =
  | {
      kind: "pin-date";
      dateStr: string;
      weight: number;
      subjects: string[];
      classYears: string[];
      scope: ConstraintScope;
    }
  | {
      kind: "avoid-time";
      timeStr: string;
      weight: number;
      subjects: string[];
      classYears: string[];
      scope: ConstraintScope;
    }
  | {
      kind: "deadline";
      before: Date;
      weight: number;
      subjects: string[];
      classYears: string[];
      scope: ConstraintScope;
    }
  | {
      kind: "day-score";
      dayKey: string;
      weight: number;
      subjects: string[];
      classYears: string[];
      scope: ConstraintScope;
    }
  | {
      kind: "date-position";
      positionFromEnd: number;
      weight: number;
      subjects: string[];
      classYears: string[];
      scope: ConstraintScope;
    };

type ParsedUserInstructions = {
  constraints: UserConstraint[];
  groupSecondForeignByClassYear: boolean;
};

type ResolvedUserConstraint = Exclude<UserConstraint, { kind: "date-position" }> & { scope: "all" };

const SPECIAL_SUBJECT_TOKENS = {
  english: "__english_general__",
  vocationalEnglish: "__vocational_english__",
  german: "__german__",
  russian: "__russian__",
  japanese: "__japanese__",
  secondForeign: "__second_foreign__",
} as const;

const CLASS_YEAR_SCOPE_RE = /(\d+)\.?\s*(?:sınıf|sinif)[\p{L}]*/giu;
const OTHER_CLASSES_RE = /\bdiğer\s+sınıf|\bdiger\s+sinif/iu;

/**
 * Türkçe doğal dil talimatını yapılandırılmış kısıtlara dönüştürür.
 *
 * Desteklenen kalıplar:
 *  "Almanca 14.05.2026 tarihinde olsun"  → o tarihe yönlendir
 *  "08:00 saatlerine sınav koyma"        → o saati atla
 *  "4. sınıf 15.05.2026 tarihine kadar" → o tarihten sonraki slotları cezalandır
 *  "Fizik Cuma olmasın"                  → Cuma'dan kaçın
 *  "Dr. Kaya Salı olsun"                 → Salı'yı tercih et
 */
const extractClassYearsFromLine = (lower: string) => {
  const matches = [...lower.matchAll(CLASS_YEAR_SCOPE_RE)];
  return [...new Set(matches.map((match) => normalizeClassYear(`${match[1]}.S`)).filter(Boolean))];
};

const extractConstraintSubjects = (lower: string) => {
  const tokens: string[] = [];

  if (/mesleki\s+ingilizce/u.test(lower)) {
    tokens.push(SPECIAL_SUBJECT_TOKENS.vocationalEnglish);
  } else if (/\bingilizce\b|\benglish\b/u.test(lower)) {
    tokens.push(SPECIAL_SUBJECT_TOKENS.english);
  }

  if (/\balmanca\b/u.test(lower)) {
    tokens.push(SPECIAL_SUBJECT_TOKENS.german);
  }
  if (/\brusça\b|\brusca\b/u.test(lower)) {
    tokens.push(SPECIAL_SUBJECT_TOKENS.russian);
  }
  if (/\bjaponca\b/u.test(lower)) {
    tokens.push(SPECIAL_SUBJECT_TOKENS.japanese);
  }
  if (/ikinci\s+yabanc[ıi]\s+dil|2\.\s*yabanc[ıi]/u.test(lower)) {
    tokens.push(SPECIAL_SUBJECT_TOKENS.secondForeign);
  }

  return tokens.length > 0 ? [...new Set(tokens)] : extractSubjects(lower);
};

const buildConstraintTarget = (lower: string) => ({
  subjects: extractConstraintSubjects(lower),
  classYears: extractClassYearsFromLine(lower),
  scope: OTHER_CLASSES_RE.test(lower) ? "others" : "all",
} satisfies Pick<UserConstraint, "subjects" | "classYears" | "scope">);

const extractDateToken = (value: string) => value.match(/(\d{1,2}\.\d{2}\.\d{4})/)?.[1] ?? value;

const parseUserInstructions = (instructions: string): ParsedUserInstructions => {
  if (!instructions.trim()) {
    return { constraints: [], groupSecondForeignByClassYear: false };
  }

  const constraints: UserConstraint[] = [];
  // Nokta, yeni satır, ·, •, noktalı virgül ile böl — ama "14.05" gibi tarihleri bozma
  const lines = instructions
    .split(/(?<!\d)\.(?!\d{2}\.\d{4})|\n|[·•;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const line of lines) {
    const lower = line.toLocaleLowerCase("tr");
    const target = buildConstraintTarget(lower);

    const isAvoid    = AVOID_RE.test(lower);
    const isDeadline = DEADLINE_RE.test(lower) && !isAvoid;

    const hasVocationalPenultimate =
      /mesleki\s+ingilizce[\s\S]*?(?:sondan\s+bir\s+önceki\s+gün|sondan\s+bir\s+onceki\s+gun)/u.test(lower);
    const hasEnglishLast = /\bingilizce\b[\s\S]*?(?:son\s+gün|son\s+gun)/u.test(lower);

    if (hasVocationalPenultimate) {
      constraints.push({
        kind: "date-position",
        positionFromEnd: 1,
        weight: 320,
        subjects: [SPECIAL_SUBJECT_TOKENS.vocationalEnglish],
        classYears: target.classYears,
        scope: target.scope,
      });
    }

    if (hasEnglishLast) {
      constraints.push({
        kind: "date-position",
        positionFromEnd: 0,
        weight: 340,
        subjects: [SPECIAL_SUBJECT_TOKENS.english],
        classYears: target.classYears,
        scope: target.scope,
      });
    }

    if (
      !hasVocationalPenultimate &&
      /sondan\s+bir\s+önceki\s+gün|sondan\s+bir\s+onceki\s+gun/u.test(lower)
    ) {
      constraints.push({
        kind: "date-position",
        positionFromEnd: 1,
        weight: 320,
        ...target,
      });
    } else if (!hasEnglishLast && /son\s+gün|son\s+gun/u.test(lower)) {
      constraints.push({
        kind: "date-position",
        positionFromEnd: 0,
        weight: 340,
        ...target,
      });
    }

    // ── 1. Belirli tarih kısıtları (DD.MM.YYYY) ──────────────────────────
    const dateMatches = [...lower.matchAll(/(\d{1,2}\.\d{2}\.\d{4})/g)];
    if (dateMatches.length > 0) {
      for (const dm of dateMatches) {
        const dateStr = dm[1];
        const parsedDate = parseTrDate(dateStr);
        if (!parsedDate) continue;

        if (isDeadline && !isAvoid) {
          // "tarihine kadar tamamlansın" → o tarihten sonraki slotları cezalandır
          constraints.push({ kind: "deadline", before: parsedDate, weight: -300, ...target });
        } else {
          // "tarihinde olsun" → o tarihe yönlendir (+250), diğer tarihlerden kaçın (-60)
          const weight = isAvoid ? -250 : 250;
          constraints.push({ kind: "pin-date", dateStr, weight, ...target });
        }
      }
      // Aynı satırda saat de olabilir, devam et
    }

    // ── 2. Belirli saat kısıtları (HH:MM) ────────────────────────────────
    const timeMatches = [...lower.matchAll(/(\d{1,2}:\d{2})/g)];
    if (timeMatches.length > 0) {
      const weight = isAvoid ? -300 : 80;
      for (const tm of timeMatches) {
        constraints.push({ kind: "avoid-time", timeStr: tm[1], weight, ...target });
      }
    }

    // Tarih veya saat kısıtı bulduysa haftanın günü aramaya gerek yok
    if (dateMatches.length > 0 || timeMatches.length > 0) continue;

    // ── 3. Haftanın günü kısıtları ────────────────────────────────────────
    for (const [dayKey, variants] of Object.entries(DAY_TOKENS)) {
      if (variants.some((v) => lower.includes(v))) {
        const weight = isAvoid ? -200 : 70;
        constraints.push({ kind: "day-score", dayKey, weight, ...target });
        break;
      }
    }
  }

  const lowerInstructions = instructions.toLocaleLowerCase("tr");
  const hasSecondForeignMention =
    /almanca|japonca|rusça|rusca|ikinci\s+yabanc[ıi]\s+dil|2\.\s*yabanc[ıi]/u.test(lowerInstructions);
  const wantsSameSlot =
    /ayn[ıi]\s+g[üu]n[\s\S]{0,80}ayn[ıi]\s+saat|ayn[ıi]\s+saat[\s\S]{0,80}ayn[ıi]\s+g[üu]n/u.test(lowerInstructions);
  const marksElective = /seçmeli|secmeli/u.test(lowerInstructions);
  const saysOneStudentOnlyOneSecondForeign =
    /bir\s+öğrenci[\s\S]{0,80}ikinci\s+yabanc[ıi]\s+dil|iki\s+tane\s+ikinci\s+yabanc[ıi]\s+dil/u.test(
      lowerInstructions,
    );

  return {
    constraints,
    groupSecondForeignByClassYear:
      hasSecondForeignMention && (wantsSameSlot || marksElective || saysOneStudentOnlyOneSecondForeign),
  };
};

const constraintKey = (constraint: UserConstraint) => {
  const sortedSubjects = [...constraint.subjects].sort().join("|");
  const sortedClassYears = [...constraint.classYears].sort().join("|");
  const scope = constraint.scope;

  switch (constraint.kind) {
    case "pin-date":
      return `pin-date::${constraint.dateStr}::${constraint.weight}::${sortedSubjects}::${sortedClassYears}::${scope}`;
    case "avoid-time":
      return `avoid-time::${constraint.timeStr}::${constraint.weight}::${sortedSubjects}::${sortedClassYears}::${scope}`;
    case "deadline":
      return `deadline::${constraint.before.toISOString()}::${constraint.weight}::${sortedSubjects}::${sortedClassYears}::${scope}`;
    case "day-score":
      return `day-score::${constraint.dayKey}::${constraint.weight}::${sortedSubjects}::${sortedClassYears}::${scope}`;
    case "date-position":
      return `date-position::${constraint.positionFromEnd}::${constraint.weight}::${sortedSubjects}::${sortedClassYears}::${scope}`;
  }
};

const mergeParsedUserInstructions = (
  base: ParsedUserInstructions,
  extra: ParsedUserInstructions,
): ParsedUserInstructions => {
  const seen = new Set<string>();
  const constraints = [...base.constraints, ...extra.constraints].filter((constraint) => {
    const key = constraintKey(constraint);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  return {
    constraints,
    groupSecondForeignByClassYear:
      base.groupSecondForeignByClassYear || extra.groupSecondForeignByClassYear,
  };
};

const normalizeAiSubjectToken = (subject: string) => {
  const lower = subject.trim().toLocaleLowerCase("tr");

  if (!lower) {
    return "";
  }

  if (/mesleki\s+ingilizce/u.test(lower)) {
    return SPECIAL_SUBJECT_TOKENS.vocationalEnglish;
  }
  if (/\bingilizce\b|\benglish\b/u.test(lower)) {
    return SPECIAL_SUBJECT_TOKENS.english;
  }
  if (/\balmanca\b|\bgerman\b/u.test(lower)) {
    return SPECIAL_SUBJECT_TOKENS.german;
  }
  if (/\brusça\b|\brusca\b|\brussian\b/u.test(lower)) {
    return SPECIAL_SUBJECT_TOKENS.russian;
  }
  if (/\bjaponca\b|\bjapanese\b/u.test(lower)) {
    return SPECIAL_SUBJECT_TOKENS.japanese;
  }
  if (/ikinci\s+yabanc[ıi]\s+dil|second\s+foreign/u.test(lower)) {
    return SPECIAL_SUBJECT_TOKENS.secondForeign;
  }

  return lower;
};

const normalizeAiDayKey = (dayKey: string) => {
  const lower = dayKey.trim().toLocaleLowerCase("tr");

  for (const [canonicalDay, variants] of Object.entries(DAY_TOKENS)) {
    if (canonicalDay === lower || variants.includes(lower)) {
      return canonicalDay;
    }
  }

  return "";
};

const aiConstraintToUserConstraint = (constraint: AIScheduleConstraint): UserConstraint | null => {
  const subjects = [...new Set((constraint.subjects ?? []).map(normalizeAiSubjectToken).filter(Boolean))];
  const classYears = [...new Set((constraint.classYears ?? []).map((value) => normalizeClassYear(value)).filter(Boolean))];
  const scope: ConstraintScope = constraint.scope === "others" ? "others" : "all";

  switch (constraint.kind) {
    case "pin-date": {
      const dateStr = extractDateToken(constraint.dateStr ?? "");
      if (!dateStr) {
        return null;
      }

      return {
        kind: "pin-date",
        dateStr,
        weight: typeof constraint.weight === "number" ? constraint.weight : 250,
        subjects,
        classYears,
        scope,
      };
    }
    case "avoid-time": {
      const timeStr = (constraint.timeStr ?? "").trim();
      if (!timeStr) {
        return null;
      }

      return {
        kind: "avoid-time",
        timeStr,
        weight: typeof constraint.weight === "number" ? constraint.weight : -300,
        subjects,
        classYears,
        scope,
      };
    }
    case "deadline": {
      const dateStr = extractDateToken(constraint.dateStr ?? "");
      const before = parseTrDate(dateStr);
      if (!before) {
        return null;
      }

      return {
        kind: "deadline",
        before,
        weight: typeof constraint.weight === "number" ? constraint.weight : -300,
        subjects,
        classYears,
        scope,
      };
    }
    case "day-score": {
      const dayKey = normalizeAiDayKey(constraint.dayKey ?? "");
      if (!dayKey) {
        return null;
      }

      return {
        kind: "day-score",
        dayKey,
        weight: typeof constraint.weight === "number" ? constraint.weight : 70,
        subjects,
        classYears,
        scope,
      };
    }
    case "date-position": {
      const positionFromEnd =
        typeof constraint.positionFromEnd === "number" && constraint.positionFromEnd >= 0
          ? Math.floor(constraint.positionFromEnd)
          : null;
      if (positionFromEnd === null) {
        return null;
      }

      return {
        kind: "date-position",
        positionFromEnd,
        weight:
          typeof constraint.weight === "number"
            ? constraint.weight
            : positionFromEnd === 0
              ? 340
              : 320,
        subjects,
        classYears,
        scope,
      };
    }
  }
};

const parsedInstructionsFromAIPlan = (plan: AIScheduleInstructionPlan): ParsedUserInstructions => ({
  constraints: plan.constraints
    .map(aiConstraintToUserConstraint)
    .filter((constraint): constraint is UserConstraint => Boolean(constraint)),
  groupSecondForeignByClassYear: plan.groupSecondForeignByClassYear,
});

export const parseUserConstraints = (instructions: string): UserConstraint[] =>
  parseUserInstructions(instructions).constraints;

/** Bir satırdan özne token'larını çıkarır (tarih/saat/fiil/stop kelimeleri hariç) */
const extractSubjects = (lower: string): string[] =>
  lower
    .replace(/\d{1,2}\.\d{2}\.\d{4}/g, "") // tarihleri sil
    .replace(/\d{1,2}:\d{2}/g, "")          // saatleri sil
    .split(/[\s,]+/)
    .map((w) => w.replace(/[^a-züşğıöçüşğıöça-z0-9.]/gi, "").toLocaleLowerCase("tr"))
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w))
    .map(normalizeSubjectToken);

const isVocationalEnglishCourse = (courseName: string): boolean =>
  /\bmesleki\s+ingilizce\b/i.test(courseName);

const matchesConstraintToken = (token: string, courseSeed: CourseSeed, entityStr: string) => {
  const courseLC = courseSeed.courseName.toLocaleLowerCase("tr");

  switch (token) {
    case SPECIAL_SUBJECT_TOKENS.english:
      return isEnglishCourse(courseLC) && !isVocationalEnglishCourse(courseLC);
    case SPECIAL_SUBJECT_TOKENS.vocationalEnglish:
      return isVocationalEnglishCourse(courseLC);
    case SPECIAL_SUBJECT_TOKENS.german:
      return /\balmanca\b/i.test(courseLC);
    case SPECIAL_SUBJECT_TOKENS.russian:
      return /\brusça\b|\brusca\b/i.test(courseLC);
    case SPECIAL_SUBJECT_TOKENS.japanese:
      return /\bjaponca\b/i.test(courseLC);
    case SPECIAL_SUBJECT_TOKENS.secondForeign:
      return isSecondForeignLanguage(courseLC);
    default:
      return entityStr.includes(token);
  }
};

const matchesUserConstraint = (
  constraint: Pick<UserConstraint, "subjects" | "classYears">,
  courseSeed: CourseSeed,
) => {
  const normalizedClassYear = normalizeClassYear(courseSeed.classYear);
  const classMatches =
    constraint.classYears.length === 0 || constraint.classYears.includes(normalizedClassYear);

  if (!classMatches) {
    return false;
  }

  if (constraint.subjects.length === 0) {
    return true;
  }

  const courseLC = courseSeed.courseName.toLocaleLowerCase("tr");
  const instrLC = (courseSeed.instructorText ?? "").toLocaleLowerCase("tr");
  const entityStr = `${courseLC} ${instrLC} ${normalizedClassYear.toLocaleLowerCase("tr")}`;

  return constraint.subjects.some((token) => matchesConstraintToken(token, courseSeed, entityStr));
};

const resolveUserConstraints = (
  constraints: UserConstraint[],
  courseSeeds: CourseSeed[],
  dates: string[],
): ResolvedUserConstraint[] => {
  const allClassYears = [
    ...new Set(courseSeeds.map((seed) => normalizeClassYear(seed.classYear)).filter(Boolean)),
  ];
  const explicitlyMentionedClassYears = new Set(
    constraints
      .filter((constraint) => constraint.scope !== "others")
      .flatMap((constraint) => constraint.classYears),
  );

  return constraints
    .map((constraint) => {
      const classYears =
        constraint.scope === "others"
          ? allClassYears.filter((classYear) => !explicitlyMentionedClassYears.has(classYear))
          : constraint.classYears;

      if (constraint.kind === "date-position") {
        const targetDate = dates[dates.length - 1 - constraint.positionFromEnd];
        if (!targetDate) {
          return null;
        }

        return {
          kind: "pin-date",
          dateStr: extractDateToken(targetDate),
          weight: constraint.weight,
          subjects: constraint.subjects,
          classYears,
          scope: "all",
        } satisfies ResolvedUserConstraint;
      }

      return {
        ...constraint,
        classYears,
        scope: "all",
      } satisfies ResolvedUserConstraint;
    })
    .filter((constraint): constraint is ResolvedUserConstraint => Boolean(constraint));
};

const applyInstructionSeedMetadata = (
  courseSeeds: CourseSeed[],
  instructions: ParsedUserInstructions,
) =>
  courseSeeds.map((courseSeed) => {
    const normalizedClassYear = normalizeClassYear(courseSeed.classYear);
    const electiveGroupId =
      courseSeed.electiveGroupId ??
      (instructions.groupSecondForeignByClassYear &&
      normalizedClassYear &&
      isSecondForeignLanguage(courseSeed.courseName.toLocaleLowerCase("tr"))
        ? `second-foreign::${normalizedClassYear}`
        : null);

    return {
      ...courseSeed,
      electiveGroupId,
    };
  });

const filterSlotsByConstraintDates = (
  slots: string[],
  matchingConstraints: ResolvedUserConstraint[],
) => {
  let filteredSlots = [...slots];

  const preferredDates = [
    ...new Set(
      matchingConstraints
        .filter(
          (constraint): constraint is Extract<ResolvedUserConstraint, { kind: "pin-date" }> =>
            constraint.kind === "pin-date" && constraint.weight > 0,
        )
        .map((constraint) => constraint.dateStr),
    ),
  ];

  if (preferredDates.length > 0) {
    const preferredSlots = filteredSlots.filter((slotKey) =>
      preferredDates.some((dateStr) => getDateFromSlot(slotKey).includes(dateStr)),
    );

    if (preferredSlots.length > 0) {
      filteredSlots = preferredSlots;
    }
  }

  const deadlineConstraints = matchingConstraints.filter(
    (constraint): constraint is Extract<ResolvedUserConstraint, { kind: "deadline" }> =>
      constraint.kind === "deadline",
  );

  if (deadlineConstraints.length > 0) {
    const deadlineSlots = filteredSlots.filter((slotKey) => {
      const slotDate = parseDateFromSlotDate(getDateFromSlot(slotKey));
      if (!slotDate) {
        return true;
      }

      return deadlineConstraints.every((constraint) => slotDate <= constraint.before);
    });

    if (deadlineSlots.length > 0) {
      filteredSlots = deadlineSlots;
    }
  }

  return filteredSlots;
};

/** Bir slot için kullanıcı kısıt skorunu hesaplar */
const applyUserConstraints = (
  constraints: ResolvedUserConstraint[],
  slotKey: string,
): number => {
  if (constraints.length === 0) return 0;

  const { date: slotDate, time: slotTime } = splitSlotKey(slotKey);
  const dateLower  = slotDate.toLocaleLowerCase("tr");
  let totalScore = 0;

  for (const c of constraints) {
    switch (c.kind) {
      case "pin-date": {
        // Slot tarihinde DD.MM.YYYY var mı?
        const hits = dateLower.includes(c.dateStr);
        if (c.weight > 0) {
          // tercih et: eşleşirse büyük bonus, eşleşmezse küçük ceza
          totalScore += hits ? c.weight : -60;
        } else {
          // kaçın: eşleşirse büyük ceza
          if (hits) totalScore += c.weight;
        }
        break;
      }
      case "avoid-time": {
        // Slot saati eşleşiyor mu?
        if (slotTime.startsWith(c.timeStr) || slotTime === c.timeStr) {
          totalScore += c.weight;
        }
        break;
      }
      case "deadline": {
        // Slot tarihi son tarihten sonra mı?
        const slotParsedDate = parseDateFromSlotDate(slotDate);
        if (slotParsedDate && slotParsedDate > c.before) {
          totalScore += c.weight;
        }
        break;
      }
      case "day-score": {
        const dayVariants = DAY_TOKENS[c.dayKey] ?? [c.dayKey];
        if (dayVariants.some((v) => dateLower.includes(v))) {
          totalScore += c.weight;
        }
        break;
      }
    }
  }

  return totalScore;
};

/** Mevcut sınav kartlarından CourseSeed listesi çıkarır (yeniden oluşturma için). */
export const extractCourseSeeds = (exams: ExamCard[]): CourseSeed[] =>
  exams.map((exam) => ({
    programs: exam.programs,
    classYear: exam.classYear,
    courseName: exam.courseName,
    instructorText: exam.instructorText ?? null,
    locationText: exam.locationText ?? null,
    electiveGroupId: exam.electiveGroupId ?? null,
  }));

type ImportOptions = {
  profile?: SchoolProfile | null;
  fallbackTemplate?: Pick<ScheduleDocument["template"], "dates" | "times"> | null;
  /** AI destekli ayrıştırma etkin mi? (profilde API key varsa kullanılır) */
  useAI?: boolean;
  /** Kullanıcının AI'ya iletmek istediği ek talimatlar */
  userInstructions?: string;
  /** Dışarıda önceden çözülmüş talimatlar varsa yeniden parse etme */
  parsedInstructions?: ParsedUserInstructions | null;
};

type InstructionAiStatus = {
  used: boolean;
  error: string | null;
  provider?: string;
};

type ImportedScheduleResult = {
  document: ScheduleDocument;
  mode: "exam-workbook" | "auto-generated";
  message: string;
  /** AI kullanıldıysa sonuç bilgisi */
  aiStatus?: { used: boolean; seedCount: number; error: string | null; provider?: string };
  instructionAiStatus?: InstructionAiStatus;
};

const DEFAULT_DATES = ["1. Gün", "2. Gün", "3. Gün", "4. Gün", "5. Gün"];
const DEFAULT_TIMES = ["09:00", "11:00", "13:00", "15:00"];

const CLASS_YEAR_PATTERN = /\b(\d+)\s*(?:\.?\s*s(?:ınıf)?|sinif)\b/ui;
const INSTRUCTOR_PATTERN =
  /\b(prof\.?|doç\.?|doc\.?|dr\.?|öğr\.?\s*gör\.?|ogr\.?\s*gor\.?|arş\.?\s*gör\.?|teacher|lecturer|instructor)\b/ui;
const ROOM_PATTERN =
  /^(?:[A-ZÇĞİÖŞÜ]-?)?\d{2,4}(?:[-/]\d{2,4})*$|^(?:amfi|derslik|salon|oda)\b/ui;
const HEADER_PATTERNS = {
  programs: /(böl(ü|u)m|program|department|dept|birim|major|branch)/i,
  classYear: /(sınıf|sinif|class|grade|year)/i,
  courseName: /(ders|course|module|modul|lesson)/i,
  instructorText: /(hoca|öğret|ogret|teacher|lecturer|instructor|gözetmen|gozetmen)/i,
  locationText: /(derslik|oda|salon|room|yer)/i,
};

const normalizeSearchText = (value: string) =>
  value
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeCompactSearchText = (value: string) => normalizeSearchText(value).replace(/\s+/g, "");

const uniqueCourseSeeds = (courseSeeds: CourseSeed[]) => {
  const seen = new Set<string>();

  return courseSeeds.filter((courseSeed) => {
    const key = `${formatPrograms(courseSeed.programs).toLocaleLowerCase("tr")}::${normalizeClassYear(
      courseSeed.classYear,
    )}::${normalizeCompactSearchText(courseSeed.courseName)}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const inferClassYear = (value: string) => {
  const trimmed = value.trim();
  const match = CLASS_YEAR_PATTERN.exec(trimmed);

  if (match) {
    return normalizeClassYear(`${match[1]}.S`);
  }

  // "Seyahat N" / "N. Grup" / "N. Şube" kalıpları → N.S
  const seyahatMatch = /\b(?:seyahat|grup|şube|sube)\s+(\d+)\b/i.exec(trimmed);
  if (seyahatMatch) {
    return normalizeClassYear(`${seyahatMatch[1]}.S`);
  }
  const seyahatMatch2 = /\b(\d+)\.\s*(?:grup|şube|sube)\b/i.exec(trimmed);
  if (seyahatMatch2) {
    return normalizeClassYear(`${seyahatMatch2[1]}.S`);
  }

  return /(hazırlık|hazirlik|prep)/i.test(trimmed) ? trimmed : "";
};

const inferCourseSeedFromCells = (cells: string[], classHint?: string | null): CourseSeed | null => {
  const cleaned = cells.map((cell) => cell.trim()).filter(Boolean);

  if (cleaned.length === 0) {
    return null;
  }

  let classYear = classHint ? normalizeClassYear(classHint) : "";
  let programs: string[] = [];
  let instructorText: string | null = null;
  let locationText: string | null = null;
  const courseCandidates: string[] = [];

  for (const cell of cleaned) {
    const inferredClassYear = inferClassYear(cell);

    if (!classYear && inferredClassYear && inferredClassYear !== cell) {
      classYear = inferredClassYear;
      continue;
    }

    if (programs.length === 0 && !INSTRUCTOR_PATTERN.test(cell) && !ROOM_PATTERN.test(cell)) {
      const programCandidates = parseProgramsInput(cell);

      if (programCandidates.length > 1) {
        programs = programCandidates;
        continue;
      }
    }

    if (!instructorText && INSTRUCTOR_PATTERN.test(cell)) {
      instructorText = cell;
      continue;
    }

    if (!locationText && ROOM_PATTERN.test(cell)) {
      locationText = cell;
      continue;
    }

    if (
      /\b(pzt|sal|çar|car|per|cum|cts|paz|monday|tuesday|wednesday|thursday|friday)\b/i.test(cell) ||
      /^\d{1,2}:\d{2}$/.test(cell) ||
      /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(cell)
    ) {
      continue;
    }

    courseCandidates.push(cell);
  }

  const courseName = [...courseCandidates].sort((left, right) => right.length - left.length)[0]?.trim();

  if (!courseName) {
    return null;
  }

  return {
    programs: normalizePrograms(programs),
    classYear,
    courseName,
    instructorText,
    locationText,
  };
};

const detectHeaderMap = (row: string[]) => {
  const entries = Object.entries(HEADER_PATTERNS)
    .map(([key, pattern]) => [key, row.findIndex((cell) => pattern.test(cell))] as const)
    .filter(([, index]) => index >= 0);

  if (!entries.some(([key]) => key === "courseName")) {
    return null;
  }

  return Object.fromEntries(entries) as Partial<Record<keyof CourseSeed, number>>;
};

/**
 * Satırın tümünü birleştirerek sınıf yılı içeren bir BÖLÜM BAŞLIĞI mı diye kontrol eder.
 * Sadece gerçek başlık satırlarında döner; normal ders satırlarında boş string döner.
 * Başlık heuristic: az sayıda hücre, ders kodu/hoca unvanı/saat içermiyor, sınıf kalıbı var.
 */
const inferSectionClassYear = (cells: string[]): string => {
  // Çok fazla hücre varsa muhtemelen ders satırı
  if (cells.length > 6) return "";
  // Saat veya hoca unvanı içeriyorsa ders satırı
  const joined = cells.join(" ");
  if (/\d{1,2}:\d{2}/.test(joined)) return "";
  if (/\b(prof|doç|doc|dr\.|öğr|ogr|arş|ars)\b/i.test(joined)) return "";
  return inferClassYear(joined);
};

const extractSeedsFromRows = (rows: string[][], classHint?: string | null) => {
  const courseSeeds: CourseSeed[] = [];
  let headerMap: Partial<Record<keyof CourseSeed, number>> | null = null;
  // Belge içindeki bölüm başlıklarından güncellenen dinamik sınıf yılı
  let currentClassHint: string = normalizeClassYear(classHint ?? "");

  for (const row of rows) {
    const cleaned = row.map((cell) => cell.trim()).filter(Boolean);

    if (cleaned.length === 0) {
      continue;
    }

    // Bölüm başlığı tespiti: satır birleştirildiğinde sınıf yılı içeriyor mu?
    // Örn: ["1.", "SINIF", "HAFTALIK", "DERS", "PROGRAMI"] → "1.S"
    const sectionYear = inferSectionClassYear(cleaned);
    if (sectionYear) {
      currentClassHint = sectionYear;
      continue; // Bu satır bir başlık, ders değil
    }

    const maybeHeader = detectHeaderMap(cleaned);

    if (maybeHeader) {
      headerMap = maybeHeader;
      continue;
    }

    if (headerMap && typeof headerMap.courseName === "number") {
      const courseName = cleaned[headerMap.courseName]?.trim();

      if (!courseName) {
        continue;
      }

      courseSeeds.push({
        programs:
          typeof headerMap.programs === "number"
            ? parseProgramsInput(cleaned[headerMap.programs] ?? "")
            : [],
        classYear:
          (typeof headerMap.classYear === "number" ? inferClassYear(cleaned[headerMap.classYear] ?? "") : "") ||
          currentClassHint,
        courseName,
        instructorText:
          typeof headerMap.instructorText === "number"
            ? cleaned[headerMap.instructorText]?.trim() || null
            : null,
        locationText:
          typeof headerMap.locationText === "number"
            ? cleaned[headerMap.locationText]?.trim() || null
            : null,
      });
      continue;
    }

    const fallbackSeed = inferCourseSeedFromCells(cleaned, currentClassHint);

    if (fallbackSeed) {
      courseSeeds.push(fallbackSeed);
    }
  }

  return courseSeeds;
};

const extractGenericSheetsFromWorkbook = (arrayBuffer: ArrayBuffer): GenericSheet[] => {
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });

  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });

    return {
      name,
      rows: rows.map((row) => row.map((cell) => String(cell ?? "").trim())),
    };
  });
};

const extractRawTextFromWorkbook = (sheets: GenericSheet[]) =>
  sheets
    .flatMap((sheet) => [
      sheet.name,
      ...sheet.rows.map((row) => row.filter(Boolean).join(" | ")),
    ])
    .join("\n");

const extractTextLines = (rawText: string) =>
  rawText
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\t+|\s{2,}|\|/g).map((part) => part.trim()).filter(Boolean));

const matchProfileTemplatesInText = (
  profile: SchoolProfile,
  rawText: string,
): ProfileCourseTemplate[] => {
  const normalizedText = normalizeSearchText(rawText);

  return profile.courseTemplates.filter((courseTemplate) => {
    const normalizedCourse = normalizeSearchText(courseTemplate.courseName);
    return normalizedCourse.length > 2 && normalizedText.includes(normalizedCourse);
  });
};

const mergeWithProfile = (courseSeeds: CourseSeed[], profile: SchoolProfile | null) => {
  if (!profile) {
    return uniqueCourseSeeds(courseSeeds);
  }

  const byExactKey = new Map<string, ProfileCourseTemplate>();
  const byCourseKey = new Map<string, ProfileCourseTemplate>();

  for (const courseTemplate of profile.courseTemplates) {
    const normalizedClassYear = normalizeClassYear(courseTemplate.classYear);
    const normalizedPrograms = formatPrograms(courseTemplate.programs).toLocaleLowerCase("tr");
    const normalizedCourseName = normalizeSearchText(courseTemplate.courseName);
    const compactCourseName = normalizeCompactSearchText(courseTemplate.courseName);
    const exactKeys = [
      `${normalizedClassYear}::${normalizedCourseName}`,
      `${normalizedPrograms}::${normalizedClassYear}::${normalizedCourseName}`,
      `${normalizedClassYear}::${compactCourseName}`,
      `${normalizedPrograms}::${normalizedClassYear}::${compactCourseName}`,
    ];

    for (const key of exactKeys) {
      byExactKey.set(key, courseTemplate);
    }

    if (!byCourseKey.has(normalizedCourseName)) {
      byCourseKey.set(normalizedCourseName, courseTemplate);
    }
    if (!byCourseKey.has(compactCourseName)) {
      byCourseKey.set(compactCourseName, courseTemplate);
    }
  }

  return uniqueCourseSeeds(
    courseSeeds.map((courseSeed) => {
      const normalizedClassYear = normalizeClassYear(courseSeed.classYear);
      const normalizedPrograms = formatPrograms(courseSeed.programs).toLocaleLowerCase("tr");
      const normalizedCourseName = normalizeSearchText(courseSeed.courseName);
      const compactCourseName = normalizeCompactSearchText(courseSeed.courseName);
      const matchedTemplate =
        byExactKey.get(`${normalizedPrograms}::${normalizedClassYear}::${normalizedCourseName}`) ??
        byExactKey.get(`${normalizedClassYear}::${normalizedCourseName}`) ??
        byExactKey.get(`${normalizedPrograms}::${normalizedClassYear}::${compactCourseName}`) ??
        byExactKey.get(`${normalizedClassYear}::${compactCourseName}`) ??
        byCourseKey.get(normalizedCourseName) ??
        byCourseKey.get(compactCourseName);

      return {
        programs: matchedTemplate?.programs ?? courseSeed.programs,
        classYear: matchedTemplate?.classYear ?? courseSeed.classYear,
        courseName: matchedTemplate?.courseName ?? courseSeed.courseName,
        instructorText: matchedTemplate?.instructorText ?? courseSeed.instructorText,
        locationText: matchedTemplate?.locationText ?? courseSeed.locationText,
        electiveGroupId: courseSeed.electiveGroupId ?? null,
      };
    }),
  );
};

const resolveSeedsFromSource = (options: {
  profile: SchoolProfile | null;
  rawText: string;
  genericSheets: GenericSheet[];
}) => {
  const profile = options.profile;
  const classHints = new Map<string, string>();

  for (const sheet of options.genericSheets) {
    const classYear = inferClassYear(sheet.name);

    if (classYear) {
      classHints.set(sheet.name, classYear);
    }
  }

  const rowSeeds = options.genericSheets.flatMap((sheet) =>
    extractSeedsFromRows(sheet.rows, classHints.get(sheet.name) ?? null),
  );
  const lineSeeds = extractSeedsFromRows(extractTextLines(options.rawText));
  const mergedSeeds = mergeWithProfile([...rowSeeds, ...lineSeeds], profile);

  if (mergedSeeds.length > 0) {
    return mergedSeeds;
  }

  if (!profile) {
    return [];
  }

  const matchedTemplates = matchProfileTemplatesInText(profile, options.rawText);
  const fallbackTemplates = matchedTemplates.length > 0 ? matchedTemplates : profile.courseTemplates;

  return fallbackTemplates.map((courseTemplate) => ({
    programs: courseTemplate.programs,
    classYear: courseTemplate.classYear,
    courseName: courseTemplate.courseName,
    instructorText: courseTemplate.instructorText,
    locationText: courseTemplate.locationText,
  }));
};

const resolveTemplate = (
  profile: SchoolProfile | null,
  fallbackTemplate?: Pick<ScheduleDocument["template"], "dates" | "times"> | null,
) => {
  const normalizedProfile = profile ? normalizeSchoolProfile(profile) : null;
  const dates =
    normalizedProfile?.dates.length
      ? normalizedProfile.dates
      : fallbackTemplate?.dates?.length
        ? [...fallbackTemplate.dates]
        : DEFAULT_DATES;
  const times =
    normalizedProfile?.times.length
      ? normalizedProfile.times
      : fallbackTemplate?.times?.length
        ? [...fallbackTemplate.times]
        : DEFAULT_TIMES;

  return {
    dates,
    times,
  };
};

const resolveParsedInstructionsWithAI = async (
  courseSeeds: CourseSeed[],
  options: ImportOptions,
  template: Pick<ScheduleDocument["template"], "dates" | "times">,
): Promise<{ parsedInstructions: ParsedUserInstructions; instructionAiStatus: InstructionAiStatus }> => {
  const existingInstructions = options.parsedInstructions;

  if (existingInstructions) {
    return {
      parsedInstructions: existingInstructions,
      instructionAiStatus: { used: false, error: null },
    };
  }

  const parsedInstructions = parseUserInstructions(options.userInstructions ?? "");
  const trimmedInstructions = options.userInstructions?.trim() ?? "";
  const profile = options.profile ? normalizeSchoolProfile(options.profile) : null;
  const apiKey = profile?.geminiApiKey?.trim();

  if (!trimmedInstructions || !options.useAI || !apiKey) {
    return {
      parsedInstructions,
      instructionAiStatus: { used: false, error: null },
    };
  }

  const aiResult = await interpretSchedulingInstructionsWithAI(
    apiKey,
    courseSeeds,
    template.dates,
    template.times,
    trimmedInstructions,
  );

  if (aiResult.error) {
    return {
      parsedInstructions,
      instructionAiStatus: {
        used: false,
        error: aiResult.error,
        provider: aiResult.provider === "groq" ? "Groq" : "Gemini",
      },
    };
  }

  const aiInstructions = parsedInstructionsFromAIPlan(aiResult.plan);
  const mergedInstructions = mergeParsedUserInstructions(parsedInstructions, aiInstructions);

  return {
    parsedInstructions: mergedInstructions,
    instructionAiStatus: {
      used:
        aiInstructions.constraints.length > 0 || aiInstructions.groupSecondForeignByClassYear,
      error: null,
      provider: aiResult.provider === "groq" ? "Groq" : "Gemini",
    },
  };
};

/** Get date portion from a slot key */
const getDateFromSlot = (slotKey: string): string => {
  const sepIndex = slotKey.indexOf("__@@__");
  return sepIndex >= 0 ? slotKey.slice(0, sepIndex) : slotKey;
};

/** Get time portion from a slot key and convert to minutes since midnight */
const getSlotTimeMinutes = (slotKey: string): number | null => {
  const sepIndex = slotKey.indexOf("__@@__");
  if (sepIndex < 0) return null;
  const time = slotKey.slice(sepIndex + 6);
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

/** Detect if course is English (prefer Friday) */
const isEnglishCourse = (courseName: string): boolean =>
  /\b(ingilizce|english|eng\.?\s|ınglızce)\b/i.test(courseName);

/** Detect if course is a second foreign language (prefer Thursday) */
const isSecondForeignLanguage = (courseName: string): boolean =>
  /\b(ikinci\s+yabanc[ıi]\s+dil|2\.\s*yabanc[ıi]|fransızca|almanca|rusça|rusca|ispanyolca|japonca|çince|cince|italyanca|arapça|arapca|farsça|farsca|korece|portekizce)\b/i.test(
    courseName,
  );

/** Minimum gap between two exams for the same class year (minutes) */
const MIN_SAME_CLASS_GAP_MINUTES = 120;

/**
 * Smart slot selection with fitness scoring.
 * Considers: class conflicts, room conflicts, instructor conflicts,
 * 2-hour minimum gap for same class year on same day,
 * day distribution (spread same class year across different days),
 * language day preferences (English→Friday, 2nd foreign→Thursday),
 * and load balancing.
 */
/**
 * Saat havuzu — çakışma çözülemediğinde dinamik olarak eklenir.
 * Türk üniversitelerinde yaygın sınav saatleri, en makul sıralamayla.
 */
const TIME_EXPANSION_POOL = [
  "09:00", "11:00", "13:00", "15:00",
  "10:00", "12:00", "14:00", "16:00",
  "08:00", "17:00", "18:00",
];

const sharesElectiveGroup = (exam: ExamCard, electiveGroupId: string | null | undefined) =>
  Boolean(electiveGroupId) && exam.electiveGroupId === electiveGroupId;

const selectSlotForExam = (
  slots: string[],
  examsBySlot: Map<string, ExamCard[]>,
  courseSeed: CourseSeed,
  defaultDuration: number = DEFAULT_EXAM_DURATION,
  /** true → çakışmasız slot yoksa null döner (yeni saat eklenmesi için sinyal) */
  strictMode: boolean = false,
  /** Kullanıcı talimatından türetilmiş kısıtlar */
  userConstraints: ResolvedUserConstraint[] = [],
  preferredSlotKey: string | null = null,
) => {
  const normalizedClassYear = normalizeClassYear(courseSeed.classYear);
  const normalizedPrograms = normalizePrograms(courseSeed.programs);
  const requestedRooms = splitRooms(courseSeed.locationText ?? "");
  const instructorLower = courseSeed.instructorText?.trim().toLocaleLowerCase("tr") ?? null;
  const matchingConstraints = userConstraints.filter((constraint) => matchesUserConstraint(constraint, courseSeed));
  const candidateSlots = filterSlotsByConstraintDates(slots, matchingConstraints);

  // Build a map: date → list of {startMin, endMin} for existing same-class exams
  const classYearDayCounts = new Map<string, number>();
  const classYearDayIntervals = new Map<string, Array<{ startMin: number; endMin: number }>>();

  for (const [slotKey, slotExams] of examsBySlot) {
    const date = getDateFromSlot(slotKey);
    for (const exam of slotExams) {
      if (sharesElectiveGroup(exam, courseSeed.electiveGroupId)) {
        continue;
      }

      if (normalizedClassYear && normalizeClassYear(exam.classYear) === normalizedClassYear) {
        const key = `${normalizedClassYear}::${date}`;
        classYearDayCounts.set(key, (classYearDayCounts.get(key) ?? 0) + 1);

        const startMin = getSlotTimeMinutes(slotKey);
        if (startMin !== null) {
          const endMin = startMin + (exam.durationMinutes ?? defaultDuration);
          const intervals = classYearDayIntervals.get(key) ?? [];
          intervals.push({ startMin, endMin });
          classYearDayIntervals.set(key, intervals);
        }
      }
    }
  }

  /** Check if placing an exam at candidateStart with given duration violates the 2-hour gap rule */
  const violatesGapRule = (date: string, candidateStart: number): boolean => {
    if (!normalizedClassYear) return false;
    const key = `${normalizedClassYear}::${date}`;
    const intervals = classYearDayIntervals.get(key);
    if (!intervals) return false;
    const candidateEnd = candidateStart + defaultDuration;
    for (const { startMin, endMin } of intervals) {
      // Gap between candidate end and existing start must be >= 120, OR
      // gap between existing end and candidate start must be >= 120
      if (candidateEnd > startMin - MIN_SAME_CLASS_GAP_MINUTES && startMin > candidateStart) {
        return true; // candidate ends too close before existing
      }
      if (endMin > candidateStart - MIN_SAME_CLASS_GAP_MINUTES && candidateStart > startMin) {
        return true; // existing ends too close before candidate
      }
      // Overlapping ranges (same start or complete overlap)
      if (candidateStart < endMin && startMin < candidateEnd) {
        return true;
      }
    }
    return false;
  };

  // Determine language-based day preference
  const courseNameLower = courseSeed.courseName.toLocaleLowerCase("tr");
  const preferFriday = isEnglishCourse(courseNameLower);
  const preferThursday = isSecondForeignLanguage(courseNameLower);

  // Filter hard constraints
  const candidates = candidateSlots.filter((slotKey) => {
    const slotExams = examsBySlot.get(slotKey) ?? [];

    // Hard constraint: no class/audience overlap
    if (
      normalizedClassYear &&
      slotExams.some(
        (exam) =>
          !sharesElectiveGroup(exam, courseSeed.electiveGroupId) &&
          doAudiencesOverlap(
            { classYear: normalizedClassYear, programs: normalizedPrograms },
            exam,
          ),
      )
    ) {
      return false;
    }

    // Hard constraint: no room conflicts
    if (requestedRooms.length > 0) {
      const occupiedRooms = new Set(slotExams.flatMap((exam) => exam.rooms));
      if (requestedRooms.some((room) => occupiedRooms.has(room))) {
        return false;
      }
    }

    // Hard constraint: no instructor conflicts
    if (instructorLower) {
      const instructorConflict = slotExams.some(
        (exam) => exam.instructorText?.trim().toLocaleLowerCase("tr") === instructorLower,
      );
      if (instructorConflict) {
        return false;
      }
    }

    // Hard constraint: same class year must have 2-hour gap between exams on same day
    if (normalizedClassYear) {
      const date = getDateFromSlot(slotKey);
      const startMin = getSlotTimeMinutes(slotKey);
      if (startMin !== null && violatesGapRule(date, startMin)) {
        return false;
      }
    }

    return true;
  });

  // Score each candidate slot
  const scoredSlots = (candidates.length > 0 ? candidates : candidateSlots).map((slotKey) => {
    let score = 100; // base score
    const slotExams = examsBySlot.get(slotKey) ?? [];
    const date = getDateFromSlot(slotKey).toLocaleLowerCase("tr");

    // Prefer less loaded slots (load balancing)
    score -= slotExams.length * 10;

    // Prefer days with fewer exams for the same class year (day distribution)
    if (normalizedClassYear) {
      const dayCount = classYearDayCounts.get(`${normalizedClassYear}::${getDateFromSlot(slotKey)}`) ?? 0;
      score -= dayCount * 15; // heavily penalize same-day exams for same class
    }

    // Language day preferences
    if (preferFriday && (date.includes("cuma") || date.includes("fri"))) {
      score += 50;
    }
    if (preferThursday && (date.includes("perşembe") || date.includes("persembe") || date.includes("thu"))) {
      score += 50;
    }

    // Kullanıcı talimat kısıtları
    score += applyUserConstraints(matchingConstraints, slotKey);

    if (preferredSlotKey && slotKey === preferredSlotKey) {
      score += 500;
    }

    // Small bonus for earlier slots (maintain order)
    score -= candidateSlots.indexOf(slotKey) * 0.1;

    return { slotKey, score };
  });

  // Strict modda çakışmasız slot yoksa null döndür → çağıran yeni saat ekler
  if (strictMode && candidates.length === 0) {
    return null;
  }

  // Sort by score (highest first)
  scoredSlots.sort((a, b) => b.score - a.score);

  return scoredSlots[0]?.slotKey ?? null;
};

export const buildAutoScheduleDocument = (
  courseSeeds: CourseSeed[],
  sourceFileName: string,
  options: ImportOptions = {},
) => {
  const profile = options.profile ? normalizeSchoolProfile(options.profile) : null;
  const template = resolveTemplate(profile, options.fallbackTemplate);
  const hasPinnedTimes = (profile?.times.length ?? 0) > 0 || (options.fallbackTemplate?.times?.length ?? 0) > 0;

  // Kullanıcı talimatını yapılandırılmış kısıtlara dönüştür
  const parsedInstructions = options.parsedInstructions ?? parseUserInstructions(options.userInstructions ?? "");
  const seededConstraints = resolveUserConstraints(parsedInstructions.constraints, courseSeeds, template.dates);

  // Değiştirilebilir saat listesi — çakışma çözülemeyince yeni saat eklenir
  const mutableTimes: string[] = [...template.times];
  let slots = template.dates.flatMap((date) => mutableTimes.map((time) => createSlotKey(date, time)));

  /**
   * Havuzdan henüz kullanılmayan bir sonraki saati ekler.
   * Yeni eklenen slotları mevcut listeye dahil eder.
   * @returns Yeni saat eklendiyse true, havuz doluysa false.
   */
  const expandTimeSlots = (): boolean => {
    const nextTime = TIME_EXPANSION_POOL.find((t) => !mutableTimes.includes(t));
    if (!nextTime) return false;
    mutableTimes.push(nextTime);
    mutableTimes.sort((a, b) => a.localeCompare(b));
    const newSlots = template.dates.map((date) => createSlotKey(date, nextTime));
    slots = [...slots, ...newSlots];
    return true;
  };

  const examsBySlot = new Map<string, ExamCard[]>();
  const electiveGroupSlots = new Map<string, string>();
  const sortedSeeds = applyInstructionSeedMetadata(uniqueCourseSeeds(courseSeeds), parsedInstructions).sort((left, right) => {
    const classDelta = normalizeClassYear(left.classYear).localeCompare(
      normalizeClassYear(right.classYear),
      "tr",
    );
    if (classDelta !== 0) return classDelta;
    const programDelta = formatPrograms(left.programs).localeCompare(formatPrograms(right.programs), "tr");
    if (programDelta !== 0) return programDelta;
    return left.courseName.localeCompare(right.courseName, "tr");
  });

  const exams = sortedSeeds.map((courseSeed) => {
    const defaultDuration = profile?.defaultExamDuration ?? DEFAULT_EXAM_DURATION;
    const preferredSlotKey =
      courseSeed.electiveGroupId ? electiveGroupSlots.get(courseSeed.electiveGroupId) ?? null : null;

    // Önce strict modda dene: çakışmasız slot var mı?
    let slotKey = selectSlotForExam(
      slots,
      examsBySlot,
      courseSeed,
      defaultDuration,
      true,
      seededConstraints,
      preferredSlotKey,
    );

    // Çakışmasız slot bulunamadıysa yeni saat ekleyerek tekrar dene
    while (slotKey === null) {
      if (hasPinnedTimes) {
        slotKey = selectSlotForExam(
          slots,
          examsBySlot,
          courseSeed,
          defaultDuration,
          false,
          seededConstraints,
          preferredSlotKey,
        );
        break;
      }

      if (!expandTimeSlots()) {
        // Havuz bitti — çakışmalı da olsa en iyi slota yerleştir
        slotKey = selectSlotForExam(
          slots,
          examsBySlot,
          courseSeed,
          defaultDuration,
          false,
          seededConstraints,
          preferredSlotKey,
        );
        break;
      }
      slotKey = selectSlotForExam(
        slots,
        examsBySlot,
        courseSeed,
        defaultDuration,
        true,
        seededConstraints,
        preferredSlotKey,
      );
    }

    const exam: ExamCard = {
      ...createBlankExam(slotKey ?? UNASSIGNED_SLOT_KEY, courseSeed.classYear, courseSeed.programs, defaultDuration),
      programs: normalizePrograms(courseSeed.programs),
      courseName: courseSeed.courseName,
      classYear: courseSeed.classYear,
      slotKey: slotKey ?? UNASSIGNED_SLOT_KEY,
      locationText: courseSeed.locationText ?? "Belirlenecek",
      rooms: splitRooms(courseSeed.locationText ?? ""),
      instructorText: courseSeed.instructorText ?? null,
      electiveGroupId: courseSeed.electiveGroupId ?? null,
    };

    if (slotKey) {
      if (courseSeed.electiveGroupId && !electiveGroupSlots.has(courseSeed.electiveGroupId)) {
        electiveGroupSlots.set(courseSeed.electiveGroupId, slotKey);
      }

      const existing = examsBySlot.get(slotKey);
      if (existing) {
        existing.push(exam);
      } else {
        examsBySlot.set(slotKey, [exam]);
      }
    }

    return exam;
  });

  const classYears = [
    ...new Set([
      ...exams.map((exam) => normalizeClassYear(exam.classYear)),
      ...(profile?.classYears ?? []),
    ]),
  ].filter(Boolean);

  return normalizeDocument({
    template: {
      dates: template.dates,
      times: mutableTimes, // Genişletilmiş saat listesini kullan
      views: createViews(classYears),
    },
    exams,
    sourceMeta: {
      generalTitle: profile ? `${profile.name} Sınav Programı` : `${sourceFileName} Sınav Programı`,
      classSheetTitles: {},
      notesRows: [],
      sourceFileName,
      importedFrom: "auto-generated",
    },
  });
};

export const buildAutoScheduleDocumentWithAI = async (
  courseSeeds: CourseSeed[],
  sourceFileName: string,
  options: ImportOptions = {},
): Promise<{ document: ScheduleDocument; instructionAiStatus: InstructionAiStatus }> => {
  const profile = options.profile ? normalizeSchoolProfile(options.profile) : null;
  const template = resolveTemplate(profile, options.fallbackTemplate);
  const { parsedInstructions, instructionAiStatus } = await resolveParsedInstructionsWithAI(
    courseSeeds,
    options,
    template,
  );

  return {
    document: buildAutoScheduleDocument(courseSeeds, sourceFileName, {
      ...options,
      parsedInstructions,
    }),
    instructionAiStatus,
  };
};

const extractRawTextFromDocx = async (arrayBuffer: ArrayBuffer) => {
  const mammoth = (await import("mammoth")) as unknown as {
    extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
  };
  const result = await mammoth.extractRawText({
    arrayBuffer,
  });
  return result.value;
};

// ─── Grid PDF algılama ve ayrıştırma ──────────────────────────────────────────

type PdfTI = { text: string; x: number; y: number };
type PdfDayBand = { label: string; upper: number; lower: number };
type GridEntry = {
  classHint: string;
  courseName: string;
  instructorText: string | null;
  locationText: string | null;
};

const DAY_LABEL_RE = /^(Pa|Sa|Ça|Pe|Cu)$/;
const TIME_RANGE_RE = /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/;
const PERIOD_RE = /^\d{1,2}$/;
const GRID_SKIP_RE = /^(Grup\s+[A-Z]|Jap\d*|Rus\d*|Alm\d*|İng\d*|Ing\d*|TFVFa\d*)$/i;
const GRID_ROOM_RE = /^(?:Lab(?:-?\d+)?|\d{2,3})$/i;
const GRID_CLASS_RE = /seyahat\s+\d+/i;
const GRID_METADATA_RE = /Ders Planı|aSc k12/i;
const GRID_ROOM_LIST_RE = /^\d{2,3}(?:,\s*\d{2,3}|,\s*Lab)+/i;
const TEACHER_TITLE_RE = /^Öğretmen\s+/i;
const GRID_INSTRUCTOR_HINT_RE =
  /\b(prof\.?|doç\.?|doc\.?|dr\.?|öğr\.?\s*gör\.?|ogr\.?\s*gor\.?|öğretim|ogretim|eleman|elm\.?|görevl|gorevl)\b/ui;
const GRID_NAME_LIKE_RE = /^\p{Lu}[\p{L}.']+(?:\s+\p{Lu}[\p{L}.']+){1,4}$/u;
const GRID_MERGED_ROOM_RE = /^(?<course>.*?\p{L}.*?)\s*(?<room>Lab(?:-?\d+)?|\d{2,3})$/u;
const JOINABLE_FRAGMENT_STOPWORDS = new Set(["ve", "ile", "veya", "bir"]);

const collapseAdjacentDuplicateWords = (value: string) => {
  const words = value.split(/\s+/g).filter(Boolean);
  const deduped: string[] = [];

  for (const word of words) {
    const previous = deduped[deduped.length - 1];
    if (previous && normalizeCompactSearchText(previous) === normalizeCompactSearchText(word)) {
      continue;
    }
    deduped.push(word);
  }

  return deduped.join(" ");
};

const cleanGridJoinedText = (value: string) =>
  collapseAdjacentDuplicateWords(
    value
      .replace(/\s+'(?=\p{L})/gu, "'")
      .replace(/\s+/g, " ")
      .replace(/\b(\p{L}{4,})\s+([a-zçğıöşü]{1,8})\b/gu, (match, left: string, right: string) =>
        JOINABLE_FRAGMENT_STOPWORDS.has(right.toLocaleLowerCase("tr")) ? match : `${left}${right}`,
      )
      .trim(),
  );

const looksLikeInstructorText = (value: string) => {
  const trimmed = cleanGridJoinedText(value);

  if (trimmed.length < 2) {
    return false;
  }

  return GRID_INSTRUCTOR_HINT_RE.test(trimmed) || GRID_NAME_LIKE_RE.test(trimmed);
};

const cleanGridInstructorText = (value: string, courseName: string) => {
  let cleaned = cleanGridJoinedText(value)
    .replace(/\s+/g, " ")
    .replace(/^(VIII|VII|VI|IV|V|III|II|I)\b\s*/u, "")
    .trim();

  if (courseName) {
    const normalizedCourse = courseName.toLocaleLowerCase("tr");
    const normalizedInstructor = cleaned.toLocaleLowerCase("tr");
    if (normalizedInstructor.startsWith(normalizedCourse)) {
      cleaned = cleaned.slice(courseName.length).trim();
    }
  }

  return looksLikeInstructorText(cleaned) ? cleaned : null;
};

const isSkippableGridCourseText = (value: string) => {
  const cleaned = cleanGridJoinedText(value);
  return (
    !cleaned ||
    GRID_SKIP_RE.test(cleaned) ||
    /^grup\s+[a-z]$/iu.test(cleaned) ||
    GRID_CLASS_RE.test(cleaned) ||
    GRID_METADATA_RE.test(cleaned)
  );
};

const parseMergedGridCourseRoom = (value: string) => {
  const cleaned = cleanGridJoinedText(value);
  const match = GRID_MERGED_ROOM_RE.exec(cleaned);

  if (!match?.groups) {
    return null;
  }

  const courseName = cleanGridJoinedText(match.groups.course ?? "");
  const locationText = (match.groups.room ?? "").trim();

  if (!courseName || !locationText || isSkippableGridCourseText(courseName)) {
    return null;
  }

  return {
    courseName,
    locationText,
  };
};

const findNearestGridClassHint = (
  items: PdfTI[],
  anchorY: number,
  minX: number,
  maxX: number,
) =>
  items
    .filter(
      (item) =>
        GRID_CLASS_RE.test(item.text) &&
        item.x >= minX &&
        item.x <= maxX &&
        Math.abs(item.y - anchorY) <= 60,
    )
    .sort(
      (left, right) =>
        Math.abs(left.y - anchorY) - Math.abs(right.y - anchorY) ||
        Math.abs(left.x - minX) - Math.abs(right.x - minX),
    )[0]?.text ?? "";

const clusterByX = (items: PdfTI[], tolerance: number) => {
  const clusters: Array<{ center: number; items: PdfTI[] }> = [];

  for (const item of [...items].sort((left, right) => left.x - right.x)) {
    const lastCluster = clusters[clusters.length - 1];

    if (!lastCluster || Math.abs(item.x - lastCluster.center) > tolerance) {
      clusters.push({
        center: item.x,
        items: [item],
      });
      continue;
    }

    lastCluster.items.push(item);
    lastCluster.center = Math.round(
      lastCluster.items.reduce((sum, candidate) => sum + candidate.x, 0) / lastCluster.items.length,
    );
  }

  return clusters;
};

const dedupeGridEntries = (entries: GridEntry[]) => {
  const byKey = new Map<string, GridEntry>();

  for (const entry of entries) {
    const compactCourse = normalizeCompactSearchText(entry.courseName);

    if (!compactCourse) {
      continue;
    }

    const key = `${normalizeClassYear(entry.classHint)}::${compactCourse}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, entry);
      continue;
    }

    const existingScore =
      (existing.instructorText?.length ?? 0) + (existing.locationText?.length ?? 0) + existing.courseName.length;
    const incomingScore =
      (entry.instructorText?.length ?? 0) + (entry.locationText?.length ?? 0) + entry.courseName.length;

    if (incomingScore > existingScore) {
      byKey.set(key, entry);
    }
  }

  return [...byKey.values()];
};

const buildGridDayBands = (items: PdfTI[]): PdfDayBand[] => {
  const dayItems = items.filter((item) => DAY_LABEL_RE.test(item.text)).sort((left, right) => right.y - left.y);
  const timeYs = items.filter((item) => TIME_RANGE_RE.test(item.text)).map((item) => item.y);

  if (dayItems.length < 3 || timeYs.length === 0) {
    return [];
  }

  const topBoundary = Math.max(...timeYs) + 12;

  return dayItems.map((item, index, list) => ({
    label: item.text,
    upper: index === 0 ? topBoundary : (list[index - 1].y + item.y) / 2,
    lower: index === list.length - 1 ? 0 : (item.y + list[index + 1].y) / 2,
  }));
};

const buildGridText = (entries: GridEntry[]) => {
  const dedupedEntries = dedupeGridEntries(entries);

  if (dedupedEntries.length === 0) {
    return null;
  }

  const lines = ["Sınıf | Ders | Öğretim Üyesi | Derslik"];

  for (const entry of dedupedEntries) {
    lines.push(
      `${entry.classHint || "-"} | ${entry.courseName} | ${entry.instructorText || "-"} | ${entry.locationText || "-"}`,
    );
  }

  return lines.join("\n");
};

const extractRoomScheduleEntries = (items: PdfTI[]): GridEntry[] => {
  const pageClassHint =
    [...items.filter((item) => GRID_CLASS_RE.test(item.text))]
      .sort((left, right) => right.y - left.y)
      .find((item) => !TEACHER_TITLE_RE.test(item.text))
      ?.text ?? "";

  if (!pageClassHint) {
    return [];
  }

  const dayBands = buildGridDayBands(items);
  const minContentX = Math.max(...items.filter((item) => DAY_LABEL_RE.test(item.text)).map((item) => item.x)) + 40;
  const entries: GridEntry[] = [];

  for (const band of dayBands) {
    const rowItems = items.filter(
      (item) =>
        item.x >= minContentX &&
        item.y < band.upper &&
        item.y >= band.lower &&
        !DAY_LABEL_RE.test(item.text) &&
        !PERIOD_RE.test(item.text) &&
        !TIME_RANGE_RE.test(item.text) &&
        !GRID_CLASS_RE.test(item.text) &&
        !GRID_ROOM_LIST_RE.test(item.text) &&
        !GRID_METADATA_RE.test(item.text) &&
        item.text !== "Öğle Arası",
    );

    const roomAnchors = rowItems.filter((item) => GRID_ROOM_RE.test(item.text));
    if (roomAnchors.length === 0) {
      continue;
    }

    const xClusters = clusterByX(roomAnchors, 36);

    for (let clusterIndex = 0; clusterIndex < xClusters.length; clusterIndex += 1) {
      const cluster = xClusters[clusterIndex];
      const previousCluster = xClusters[clusterIndex - 1];
      const nextCluster = xClusters[clusterIndex + 1];
      const leftBoundary = previousCluster
        ? (previousCluster.center + cluster.center) / 2 + 8
        : cluster.center - 40;
      const rightBoundary = nextCluster ? (cluster.center + nextCluster.center) / 2 : cluster.center + 170;
      const anchorsInCluster = [...cluster.items].sort((left, right) => right.y - left.y);

      for (let anchorIndex = 0; anchorIndex < anchorsInCluster.length; anchorIndex += 1) {
        const anchor = anchorsInCluster[anchorIndex];
        const higherAnchor = anchorsInCluster[anchorIndex - 1];
        const upperBoundary = higherAnchor ? higherAnchor.y - 2 : band.upper;

        const sameLineItems = rowItems
          .filter(
            (item) =>
              !GRID_ROOM_RE.test(item.text) &&
              !GRID_SKIP_RE.test(item.text) &&
              !GRID_CLASS_RE.test(item.text) &&
              item.x > anchor.x + 4 &&
              item.x < rightBoundary + 28 &&
              Math.abs(item.y - anchor.y) <= 3,
          )
          .sort((left, right) => left.x - right.x);

        const instructorParts = sameLineItems.filter((item) => looksLikeInstructorText(item.text)).map((item) => item.text);
        const sameLineCourseParts = sameLineItems
          .filter((item) => !looksLikeInstructorText(item.text) && item.text.trim().length > 1)
          .map((item) => item.text);

        const courseName = cleanGridJoinedText(
          [
            ...rowItems
              .filter(
                (item) =>
                  !GRID_ROOM_RE.test(item.text) &&
                  !GRID_SKIP_RE.test(item.text) &&
                  item.y > anchor.y &&
                  item.y <= upperBoundary &&
                  item.x >= leftBoundary &&
                  item.x < rightBoundary,
              )
              .sort((left, right) => right.y - left.y || left.x - right.x)
              .map((item) => item.text),
            ...sameLineCourseParts,
          ].join(" "),
        );

        if (!courseName || isSkippableGridCourseText(courseName)) {
          continue;
        }

        entries.push({
          classHint: pageClassHint,
          courseName,
          instructorText: cleanGridInstructorText(instructorParts.join(" "), courseName),
          locationText: anchor.text,
        });
      }
    }
  }

  return entries;
};

const extractTeacherScheduleEntries = (items: PdfTI[]): GridEntry[] => {
  const teacherName =
    items
      .filter((item) => TEACHER_TITLE_RE.test(item.text))
      .sort((left, right) => right.y - left.y)[0]
      ?.text.replace(TEACHER_TITLE_RE, "")
      .trim() ?? "";

  if (!teacherName) {
    return [];
  }

  const dayBands = buildGridDayBands(items);
  const entries: GridEntry[] = [];

  for (const band of dayBands) {
    const bandItems = items.filter((item) => item.y < band.upper && item.y >= band.lower);
    const mergedEntries = bandItems
      .filter(
        (item) =>
          !GRID_ROOM_RE.test(item.text) &&
          !GRID_CLASS_RE.test(item.text) &&
          !GRID_METADATA_RE.test(item.text) &&
          !DAY_LABEL_RE.test(item.text) &&
          !PERIOD_RE.test(item.text) &&
          !TIME_RANGE_RE.test(item.text) &&
          !TEACHER_TITLE_RE.test(item.text) &&
          item.text !== "Öğle Arası",
      )
      .map((item) => {
        const parsed = parseMergedGridCourseRoom(item.text);

        if (!parsed) {
          return null;
        }

        const classHint = findNearestGridClassHint(items, item.y, item.x - 12, item.x + 120);

        return {
          classHint,
          courseName: parsed.courseName,
          instructorText: teacherName,
          locationText: parsed.locationText,
        } satisfies GridEntry;
      })
      .filter(Boolean);

    for (const entry of mergedEntries) {
      if (entry) {
        entries.push(entry);
      }
    }

    const rowAnchors = items
      .filter((item) => GRID_ROOM_RE.test(item.text) && item.y < band.upper && item.y >= band.lower)
      .sort((left, right) => left.x - right.x);

    for (let anchorIndex = 0; anchorIndex < rowAnchors.length; anchorIndex += 1) {
      const anchor = rowAnchors[anchorIndex];
      const previousAnchor = rowAnchors[anchorIndex - 1];
      const leftBoundary = previousAnchor ? previousAnchor.x + 10 : anchor.x - 120;

      const courseName = cleanGridJoinedText(
        items
          .filter(
            (item) =>
              !GRID_ROOM_RE.test(item.text) &&
              !GRID_CLASS_RE.test(item.text) &&
              !GRID_METADATA_RE.test(item.text) &&
              !DAY_LABEL_RE.test(item.text) &&
              !PERIOD_RE.test(item.text) &&
              !TIME_RANGE_RE.test(item.text) &&
              !TEACHER_TITLE_RE.test(item.text) &&
              item.text !== "Öğle Arası" &&
              item.x > leftBoundary &&
              item.x < anchor.x - 2 &&
              item.y <= anchor.y + 4 &&
              item.y >= anchor.y - 18,
          )
          .sort((left, right) => right.y - left.y || left.x - right.x)
          .map((item) => item.text)
          .join(" "),
      );

      if (!courseName || isSkippableGridCourseText(courseName)) {
        continue;
      }

      const classHint = findNearestGridClassHint(items, anchor.y, leftBoundary - 10, anchor.x + 20);

      entries.push({
        classHint,
        courseName,
        instructorText: teacherName,
        locationText: anchor.text,
      });
    }
  }

  return entries;
};

const extractGridPageFromItems = (items: PdfTI[]): string | null => {
  const dayBands = buildGridDayBands(items);
  if (dayBands.length === 0) {
    return null;
  }

  const entries = TEACHER_TITLE_RE.test(items.find((item) => TEACHER_TITLE_RE.test(item.text))?.text ?? "")
    ? extractTeacherScheduleEntries(items)
    : extractRoomScheduleEntries(items);

  return buildGridText(entries);
};

export const __testables = {
  extractGridPageFromItems,
  inferClassYear,
};

const extractRawTextFromPdf = async (arrayBuffer: ArrayBuffer) => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
  }).promise;
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const items: PdfTI[] = [];
    for (const item of textContent.items as Array<{ str?: string; transform?: number[] }>) {
      const text = item.str?.trim();
      if (!text) continue;
      items.push({
        text,
        x: Math.round(item.transform?.[4] ?? 0),
        y: Math.round(item.transform?.[5] ?? 0),
      });
    }

    items.sort((left, right) => right.y - left.y || left.x - right.x);

    // Izgara PDF tespiti: gün etiketleri var mı?
    const dayItems = items.filter((i) => DAY_LABEL_RE.test(i.text));
    if (dayItems.length >= 3) {
      const gridText = extractGridPageFromItems(items);
      if (gridText) {
        pageTexts.push(gridText);
        continue;
      }
    }

    // Standart: Y koordinatına göre satır gruplama
    const rows: string[] = [];
    let currentY: number | null = null;
    let currentRow: string[] = [];

    for (const item of items) {
      if (currentY !== null && Math.abs(item.y - currentY) > 4) {
        rows.push(currentRow.join(" ").trim());
        currentRow = [];
      }
      currentRow.push(item.text);
      currentY = item.y;
    }

    if (currentRow.length > 0) {
      rows.push(currentRow.join(" ").trim());
    }

    pageTexts.push(rows.filter(Boolean).join("\n"));
  }

  return pageTexts.join("\n");
};

/**
 * AI destekli ders çıkarma.
 *
 * API key varsa → AI birincil parser.
 *   Excel: yapılandırılmış tablo formatı + ham metin gönderilir.
 *   PDF/Word: ham metin gönderilir.
 *   AI başarısız → rule-based'e düş, hatayı raporla.
 * API key yoksa → sadece rule-based.
 */
const resolveCourseSeedsWithAI = async (
  rawText: string,
  genericSheets: GenericSheet[],
  options: ImportOptions,
): Promise<{ seeds: CourseSeed[]; aiStatus: { used: boolean; seedCount: number; error: string | null; provider?: string } }> => {
  const profile = options.profile ? normalizeSchoolProfile(options.profile) : null;
  const apiKey = profile?.geminiApiKey?.trim();
  const ruleBasedSeeds = resolveSeedsFromSource({ profile, rawText, genericSheets });
  const hasStructuredGridOutput = /Sınıf\s*\|\s*Ders\s*\|\s*Öğretim Üyesi\s*\|\s*Derslik/u.test(rawText);

  if (hasStructuredGridOutput && ruleBasedSeeds.length > 0) {
    return {
      seeds: ruleBasedSeeds,
      aiStatus: { used: false, seedCount: 0, error: null },
    };
  }

  if (options.useAI && apiKey) {
    // AI'a hem yapılandırılmış Excel tablosunu hem ham metni gönder
    const aiResult = await parseCoursesWithAI(apiKey, genericSheets, rawText, options.userInstructions);

    if (aiResult.seeds.length > 0) {
      const providerLabel = aiResult.provider === "groq" ? "Groq" : "Gemini";
      const merged = mergeWithProfile(aiResult.seeds, profile);
      return {
        seeds: merged,
        aiStatus: { used: true, seedCount: aiResult.seeds.length, error: null, provider: providerLabel },
      };
    }

    // AI sonuç üretemedi — rule-based'e düş, hatayı bildir
    return {
      seeds: ruleBasedSeeds,
      aiStatus: {
        used: false,
        seedCount: 0,
        error: aiResult.error ?? "AI ders programını analiz edemedi.",
      },
    };
  }

  // AI devre dışı veya API key yok — sadece rule-based
  return {
    seeds: ruleBasedSeeds,
    aiStatus: { used: false, seedCount: 0, error: null },
  };
};

export const importScheduleFromFile = async (
  file: File,
  options: ImportOptions = {},
): Promise<ImportedScheduleResult> => {
  const lowerName = file.name.toLocaleLowerCase("tr");
  const arrayBuffer = await file.arrayBuffer();

  if (/\.(xlsx|xls)$/i.test(lowerName)) {
    try {
      const document = parseWorkbookArrayBuffer(arrayBuffer);
      return {
        document: normalizeDocument({
          ...document,
          sourceMeta: {
            ...document.sourceMeta,
            sourceFileName: file.name,
            importedFrom: "exam-workbook",
          },
        }),
        mode: "exam-workbook",
        message: `${file.name} sınav çizelgesi olarak açıldı.`,
      };
    } catch {
      const genericSheets = extractGenericSheetsFromWorkbook(arrayBuffer);
      const rawText = extractRawTextFromWorkbook(genericSheets);
      const { seeds: courseSeeds, aiStatus } = await resolveCourseSeedsWithAI(rawText, genericSheets, options);

      if (courseSeeds.length === 0) {
        throw new Error("Excel dosyasından ders listesi çıkarılamadı. Profil derslerini kontrol edin.");
      }

      const aiNote = aiStatus.used
        ? ` ✓ ${aiStatus.provider ?? "AI"} ile ${aiStatus.seedCount} ders tanındı.`
        : "";
      const scheduleResult = await buildAutoScheduleDocumentWithAI(courseSeeds, file.name, options);
      return {
        document: scheduleResult.document,
        mode: "auto-generated",
        message: `${file.name} ders programından otomatik sınav taslağı üretildi.${aiNote}`,
        aiStatus,
        instructionAiStatus: scheduleResult.instructionAiStatus,
      };
    }
  }

  if (/\.doc$/i.test(lowerName) && !/\.docx$/i.test(lowerName)) {
    throw new Error("Eski .doc Word dosyaları için lütfen belgeyi .docx olarak kaydedip tekrar yükleyin.");
  }

  if (/\.docx$/i.test(lowerName)) {
    const rawText = await extractRawTextFromDocx(arrayBuffer);
    const { seeds: courseSeeds, aiStatus } = await resolveCourseSeedsWithAI(rawText, [], options);

    if (courseSeeds.length === 0) {
      throw new Error("Word dosyasından ders listesi çıkarılamadı. Profil derslerini kontrol edin.");
    }

    const aiNote = aiStatus.used
      ? ` ✓ ${aiStatus.provider ?? "AI"} ile ${aiStatus.seedCount} ders tanındı.`
      : "";
    const scheduleResult = await buildAutoScheduleDocumentWithAI(courseSeeds, file.name, options);
    return {
      document: scheduleResult.document,
      mode: "auto-generated",
      message: `${file.name} Word içeriğinden otomatik sınav taslağı üretildi.${aiNote}`,
      aiStatus,
      instructionAiStatus: scheduleResult.instructionAiStatus,
    };
  }

  if (/\.pdf$/i.test(lowerName)) {
    const rawText = await extractRawTextFromPdf(arrayBuffer);
    const { seeds: courseSeeds, aiStatus } = await resolveCourseSeedsWithAI(rawText, [], options);

    if (courseSeeds.length === 0) {
      throw new Error("PDF dosyasından ders listesi çıkarılamadı. Profil derslerini kontrol edin.");
    }

    const aiNote = aiStatus.used
      ? ` ✓ ${aiStatus.provider ?? "AI"} ile ${aiStatus.seedCount} ders tanındı.`
      : "";
    const scheduleResult = await buildAutoScheduleDocumentWithAI(courseSeeds, file.name, options);
    return {
      document: scheduleResult.document,
      mode: "auto-generated",
      message: `${file.name} PDF içeriğinden otomatik sınav taslağı üretildi.${aiNote}`,
      aiStatus,
      instructionAiStatus: scheduleResult.instructionAiStatus,
    };
  }

  throw new Error("Desteklenen biçimler: Excel, PDF ve Word.");
};
