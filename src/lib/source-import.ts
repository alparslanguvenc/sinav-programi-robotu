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
import { parseCoursesWithAI } from "./ai-parser";
import type { SheetData } from "./ai-parser";
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
};

/** Mevcut sınav kartlarından CourseSeed listesi çıkarır (yeniden oluşturma için). */
export const extractCourseSeeds = (exams: ExamCard[]): CourseSeed[] =>
  exams.map((exam) => ({
    programs: exam.programs,
    classYear: exam.classYear,
    courseName: exam.courseName,
    instructorText: exam.instructorText ?? null,
    locationText: exam.locationText ?? null,
  }));

type ImportOptions = {
  profile?: SchoolProfile | null;
  fallbackTemplate?: Pick<ScheduleDocument["template"], "dates" | "times"> | null;
  /** AI destekli ayrıştırma etkin mi? (profilde API key varsa kullanılır) */
  useAI?: boolean;
};

type ImportedScheduleResult = {
  document: ScheduleDocument;
  mode: "exam-workbook" | "auto-generated";
  message: string;
  /** AI kullanıldıysa sonuç bilgisi */
  aiStatus?: { used: boolean; seedCount: number; error: string | null; provider?: string };
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

const uniqueCourseSeeds = (courseSeeds: CourseSeed[]) => {
  const seen = new Set<string>();

  return courseSeeds.filter((courseSeed) => {
    const key = `${formatPrograms(courseSeed.programs).toLocaleLowerCase("tr")}::${normalizeClassYear(
      courseSeed.classYear,
    )}::${normalizeSearchText(courseSeed.courseName)}`;

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
    byExactKey.set(`${normalizedClassYear}::${normalizedCourseName}`, courseTemplate);
    byExactKey.set(
      `${normalizedPrograms}::${normalizedClassYear}::${normalizedCourseName}`,
      courseTemplate,
    );

    if (!byCourseKey.has(normalizedCourseName)) {
      byCourseKey.set(normalizedCourseName, courseTemplate);
    }
  }

  return uniqueCourseSeeds(
    courseSeeds.map((courseSeed) => {
      const normalizedClassYear = normalizeClassYear(courseSeed.classYear);
      const normalizedPrograms = formatPrograms(courseSeed.programs).toLocaleLowerCase("tr");
      const normalizedCourseName = normalizeSearchText(courseSeed.courseName);
      const matchedTemplate =
        byExactKey.get(`${normalizedPrograms}::${normalizedClassYear}::${normalizedCourseName}`) ??
        byExactKey.get(`${normalizedClassYear}::${normalizedCourseName}`) ??
        byCourseKey.get(normalizedCourseName);

      return {
        programs: matchedTemplate?.programs ?? courseSeed.programs,
        classYear: matchedTemplate?.classYear ?? courseSeed.classYear,
        courseName: matchedTemplate?.courseName ?? courseSeed.courseName,
        instructorText: matchedTemplate?.instructorText ?? courseSeed.instructorText,
        locationText: matchedTemplate?.locationText ?? courseSeed.locationText,
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

const selectSlotForExam = (
  slots: string[],
  examsBySlot: Map<string, ExamCard[]>,
  courseSeed: CourseSeed,
  defaultDuration: number = DEFAULT_EXAM_DURATION,
  /** true → çakışmasız slot yoksa null döner (yeni saat eklenmesi için sinyal) */
  strictMode: boolean = false,
) => {
  const normalizedClassYear = normalizeClassYear(courseSeed.classYear);
  const normalizedPrograms = normalizePrograms(courseSeed.programs);
  const requestedRooms = splitRooms(courseSeed.locationText ?? "");
  const instructorLower = courseSeed.instructorText?.trim().toLocaleLowerCase("tr") ?? null;

  // Build a map: date → list of {startMin, endMin} for existing same-class exams
  const classYearDayCounts = new Map<string, number>();
  const classYearDayIntervals = new Map<string, Array<{ startMin: number; endMin: number }>>();

  for (const [slotKey, slotExams] of examsBySlot) {
    const date = getDateFromSlot(slotKey);
    for (const exam of slotExams) {
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
  const candidates = slots.filter((slotKey) => {
    const slotExams = examsBySlot.get(slotKey) ?? [];

    // Hard constraint: no class/audience overlap
    if (
      normalizedClassYear &&
      slotExams.some((exam) =>
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
  const scoredSlots = (candidates.length > 0 ? candidates : slots).map((slotKey) => {
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

    // Small bonus for earlier slots (maintain order)
    score -= slots.indexOf(slotKey) * 0.1;

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
  const sortedSeeds = uniqueCourseSeeds(courseSeeds).sort((left, right) => {
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

    // Önce strict modda dene: çakışmasız slot var mı?
    let slotKey = selectSlotForExam(slots, examsBySlot, courseSeed, defaultDuration, true);

    // Çakışmasız slot bulunamadıysa yeni saat ekleyerek tekrar dene
    while (slotKey === null) {
      if (!expandTimeSlots()) {
        // Havuz bitti — çakışmalı da olsa en iyi slota yerleştir
        slotKey = selectSlotForExam(slots, examsBySlot, courseSeed, defaultDuration, false);
        break;
      }
      slotKey = selectSlotForExam(slots, examsBySlot, courseSeed, defaultDuration, true);
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
    };

    if (slotKey) {
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

const extractRawTextFromDocx = async (arrayBuffer: ArrayBuffer) => {
  const mammoth = (await import("mammoth")) as unknown as {
    extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
  };
  const result = await mammoth.extractRawText({
    arrayBuffer,
  });
  return result.value;
};

const extractRawTextFromPdf = async (arrayBuffer: ArrayBuffer) => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
  }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const rows: string[] = [];
    let currentY: number | null = null;
    let currentRow: string[] = [];

    for (const item of textContent.items as Array<{ str?: string; transform?: number[] }>) {
      if (!item.str) {
        continue;
      }

      const y: number = item.transform?.[5] ?? currentY ?? 0;

      if (currentY !== null && Math.abs(y - currentY) > 4) {
        rows.push(currentRow.join(" ").trim());
        currentRow = [];
      }

      currentRow.push(item.str);
      currentY = y;
    }

    if (currentRow.length > 0) {
      rows.push(currentRow.join(" ").trim());
    }

    pages.push(rows.filter(Boolean).join("\n"));
  }

  return pages.join("\n");
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

  if (options.useAI && apiKey) {
    // AI'a hem yapılandırılmış Excel tablosunu hem ham metni gönder
    const aiResult = await parseCoursesWithAI(apiKey, genericSheets, rawText);

    if (aiResult.seeds.length > 0) {
      const providerLabel = aiResult.provider === "groq" ? "Groq" : "Gemini";
      const merged = mergeWithProfile(aiResult.seeds, profile);
      return {
        seeds: merged,
        aiStatus: { used: true, seedCount: aiResult.seeds.length, error: null, provider: providerLabel },
      };
    }

    // AI sonuç üretemedi — rule-based'e düş, hatayı bildir
    const ruleBasedSeeds = resolveSeedsFromSource({ profile, rawText, genericSheets });
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
  const ruleBasedSeeds = resolveSeedsFromSource({ profile, rawText, genericSheets });
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
      return {
        document: buildAutoScheduleDocument(courseSeeds, file.name, options),
        mode: "auto-generated",
        message: `${file.name} ders programından otomatik sınav taslağı üretildi.${aiNote}`,
        aiStatus,
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
    return {
      document: buildAutoScheduleDocument(courseSeeds, file.name, options),
      mode: "auto-generated",
      message: `${file.name} Word içeriğinden otomatik sınav taslağı üretildi.${aiNote}`,
      aiStatus,
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
    return {
      document: buildAutoScheduleDocument(courseSeeds, file.name, options),
      mode: "auto-generated",
      message: `${file.name} PDF içeriğinden otomatik sınav taslağı üretildi.${aiNote}`,
      aiStatus,
    };
  }

  throw new Error("Desteklenen biçimler: Excel, PDF ve Word.");
};
