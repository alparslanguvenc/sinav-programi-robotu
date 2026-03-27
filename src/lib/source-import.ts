import * as XLSX from "xlsx";
import {
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
import { normalizeSchoolProfile } from "./profiles";
import { parseWorkbookArrayBuffer } from "./xlsx-parser";
import type {
  ExamCard,
  ProfileCourseTemplate,
  ScheduleDocument,
  SchoolProfile,
} from "../types/schedule";

type GenericSheet = {
  name: string;
  rows: string[][];
};

type CourseSeed = {
  programs: string[];
  classYear: string;
  courseName: string;
  instructorText: string | null;
  locationText: string | null;
};

type ImportOptions = {
  profile?: SchoolProfile | null;
  fallbackTemplate?: Pick<ScheduleDocument["template"], "dates" | "times"> | null;
};

type ImportedScheduleResult = {
  document: ScheduleDocument;
  mode: "exam-workbook" | "auto-generated";
  message: string;
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

const extractSeedsFromRows = (rows: string[][], classHint?: string | null) => {
  const courseSeeds: CourseSeed[] = [];
  let headerMap: Partial<Record<keyof CourseSeed, number>> | null = null;

  for (const row of rows) {
    const cleaned = row.map((cell) => cell.trim()).filter(Boolean);

    if (cleaned.length === 0) {
      continue;
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
          normalizeClassYear(classHint ?? ""),
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

    const fallbackSeed = inferCourseSeedFromCells(cleaned, classHint);

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

const selectSlotForExam = (
  slots: string[],
  examsBySlot: Map<string, ExamCard[]>,
  courseSeed: CourseSeed,
) => {
  const normalizedClassYear = normalizeClassYear(courseSeed.classYear);
  const normalizedPrograms = normalizePrograms(courseSeed.programs);
  const requestedRooms = splitRooms(courseSeed.locationText ?? "");

  const candidates = slots.filter((slotKey) => {
    const slotExams = examsBySlot.get(slotKey) ?? [];
    const classConflict =
      normalizedClassYear &&
      slotExams.some((exam) =>
        doAudiencesOverlap(
          {
            classYear: normalizedClassYear,
            programs: normalizedPrograms,
          },
          exam,
        ),
      );

    if (classConflict) {
      return false;
    }

    if (requestedRooms.length === 0) {
      return true;
    }

    const occupiedRooms = new Set(slotExams.flatMap((exam) => exam.rooms));
    return requestedRooms.every((room) => !occupiedRooms.has(room));
  });

  const rankedSlots = (candidates.length > 0 ? candidates : slots).sort((left, right) => {
    const leftCount = examsBySlot.get(left)?.length ?? 0;
    const rightCount = examsBySlot.get(right)?.length ?? 0;

    if (leftCount !== rightCount) {
      return leftCount - rightCount;
    }

    return slots.indexOf(left) - slots.indexOf(right);
  });

  return rankedSlots[0] ?? null;
};

export const buildAutoScheduleDocument = (
  courseSeeds: CourseSeed[],
  sourceFileName: string,
  options: ImportOptions = {},
) => {
  const profile = options.profile ? normalizeSchoolProfile(options.profile) : null;
  const template = resolveTemplate(profile, options.fallbackTemplate);
  const slots = template.dates.flatMap((date) => template.times.map((time) => createSlotKey(date, time)));
  const examsBySlot = new Map<string, ExamCard[]>();
  const exams = uniqueCourseSeeds(courseSeeds)
    .sort((left, right) => {
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
    })
    .map((courseSeed) => {
      const slotKey = selectSlotForExam(slots, examsBySlot, courseSeed);
      const exam = {
        ...createBlankExam(slotKey ?? UNASSIGNED_SLOT_KEY, courseSeed.classYear, courseSeed.programs),
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
      times: template.times,
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
      const courseSeeds = resolveSeedsFromSource({
        profile: options.profile ? normalizeSchoolProfile(options.profile) : null,
        rawText,
        genericSheets,
      });

      if (courseSeeds.length === 0) {
        throw new Error("Excel dosyasından ders listesi çıkarılamadı. Profil derslerini kontrol edin.");
      }

      return {
        document: buildAutoScheduleDocument(courseSeeds, file.name, options),
        mode: "auto-generated",
        message: `${file.name} ders programından otomatik sınav taslağı üretildi.`,
      };
    }
  }

  if (/\.doc$/i.test(lowerName) && !/\.docx$/i.test(lowerName)) {
    throw new Error("Eski .doc Word dosyaları için lütfen belgeyi .docx olarak kaydedip tekrar yükleyin.");
  }

  if (/\.docx$/i.test(lowerName)) {
    const rawText = await extractRawTextFromDocx(arrayBuffer);
    const courseSeeds = resolveSeedsFromSource({
      profile: options.profile ? normalizeSchoolProfile(options.profile) : null,
      rawText,
      genericSheets: [],
    });

    if (courseSeeds.length === 0) {
      throw new Error("Word dosyasından ders listesi çıkarılamadı. Profil derslerini kontrol edin.");
    }

    return {
      document: buildAutoScheduleDocument(courseSeeds, file.name, options),
      mode: "auto-generated",
      message: `${file.name} Word içeriğinden otomatik sınav taslağı üretildi.`,
    };
  }

  if (/\.pdf$/i.test(lowerName)) {
    const rawText = await extractRawTextFromPdf(arrayBuffer);
    const courseSeeds = resolveSeedsFromSource({
      profile: options.profile ? normalizeSchoolProfile(options.profile) : null,
      rawText,
      genericSheets: [],
    });

    if (courseSeeds.length === 0) {
      throw new Error("PDF dosyasından ders listesi çıkarılamadı. Profil derslerini kontrol edin.");
    }

    return {
      document: buildAutoScheduleDocument(courseSeeds, file.name, options),
      mode: "auto-generated",
      message: `${file.name} PDF içeriğinden otomatik sınav taslağı üretildi.`,
    };
  }

  throw new Error("Desteklenen biçimler: Excel, PDF ve Word.");
};
