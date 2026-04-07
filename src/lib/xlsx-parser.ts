import * as XLSX from "xlsx";
import {
  UNOFFERED_SECTION_TITLE,
  UNOFFERED_SLOT_KEY,
  UNASSIGNED_SHEET_NAME,
  UNASSIGNED_SLOT_KEY,
  createSlotKey,
  createViews,
  createExamId,
  labelToClassYear,
  normalizeClassYear,
  normalizeDocument,
  parseProgramsInput,
  splitRooms,
} from "./schedule";
import type { ExamCard, ScheduleDocument, SourceWorkbookMeta } from "../types/schedule";

type CellValue = string | number | boolean | null | undefined;
type GridTemplate = {
  title: string | null;
  dates: string[];
  times: string[];
  cards: ExamCard[];
};

const GENERAL_SHEET_NAME = "Genel";
const NOTES_SHEET_NAME = "Notlar";
const TABLE_VIEW_SHEET_NAME = "Tablo Görünümü";
const TIME_HEADER = "Saat";

const cellToString = (value: CellValue) => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
};

const sheetToAoA = (sheet: XLSX.WorkSheet) =>
  XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
    header: 1,
    raw: false,
    defval: null,
  });

const findHeaderRowIndex = (rows: CellValue[][]) =>
  rows.findIndex((row) => cellToString(row[0]).localeCompare(TIME_HEADER, "tr", { sensitivity: "base" }) === 0);

const findUnofferedRowIndex = (rows: CellValue[][]) =>
  rows.findIndex(
    (row) =>
      cellToString(row[0]).localeCompare(UNOFFERED_SECTION_TITLE, "tr", {
        sensitivity: "base",
      }) === 0,
  );

const findColumnIndex = (headerRow: string[], value: string) =>
  headerRow.findIndex((header) => header.localeCompare(value, "tr", { sensitivity: "base" }) === 0);

const parseExamLine = (line: string, classYearHint: string | null) => {
  const match = /^(?<body>.+?)\s*\((?<rooms>[^()]*)\)\s*$/u.exec(line);

  if (!match?.groups) {
    throw new Error(`Sınav satırı çözümlenemedi: "${line}"`);
  }

  let body = match.groups.body.trim();
  let programs: string[] = [];

  if (body.includes(" | ")) {
    const [programPart, ...rest] = body.split(" | ");
    programs = parseProgramsInput(programPart);
    body = rest.join(" | ").trim();
  }

  let classYear = normalizeClassYear(classYearHint ?? "");
  let courseName = body;

  if (!classYearHint) {
    const separatorIndex = body.indexOf(":");

    if (separatorIndex === -1) {
      throw new Error(`Sınıf bilgisi bulunamadı: "${line}"`);
    }

    classYear = normalizeClassYear(body.slice(0, separatorIndex));
    courseName = body.slice(separatorIndex + 1).trim();
  }

  if (!classYear) {
    throw new Error(`Sınıf bilgisi bulunamadı: "${line}"`);
  }

  return {
    classYear,
    programs,
    courseName: courseName.trim(),
    roomsText: match.groups.rooms.trim(),
  };
};

const parseCellLines = (value: string, classYearHint: string | null, slotKey: string) => {
  const cards: ExamCard[] = [];

  for (const line of value.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }

    const parsedLine = parseExamLine(trimmedLine, classYearHint);

    cards.push({
      id: createExamId(),
      courseName: parsedLine.courseName,
      classYear: parsedLine.classYear,
      programs: parsedLine.programs,
      slotKey,
      rooms: splitRooms(parsedLine.roomsText),
      locationText: parsedLine.roomsText,
      instructorText: null,
      parallelGroupId: null,
      notes: null,
    });
  }

  return cards;
};

const parseGridSheet = (
  sheet: XLSX.WorkSheet,
  classYearHint: string | null,
): GridTemplate => {
  const rows = sheetToAoA(sheet);
  const headerRowIndex = findHeaderRowIndex(rows);

  if (headerRowIndex === -1) {
    throw new Error("Çizelge başlığı bulunamadı.");
  }

  const title = cellToString(rows[0]?.[0]) || null;
  const headerRow = rows[headerRowIndex] ?? [];
  const dates = headerRow.slice(1).map(cellToString).filter(Boolean);
  const times: string[] = [];
  const cards: ExamCard[] = [];
  const unofferedRowIndex = findUnofferedRowIndex(rows);

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    if (unofferedRowIndex !== -1 && rowIndex >= unofferedRowIndex) {
      break;
    }

    const row = rows[rowIndex] ?? [];
    const time = cellToString(row[0]);

    if (!time) {
      continue;
    }

    times.push(time);

    for (let columnIndex = 0; columnIndex < dates.length; columnIndex += 1) {
      const date = dates[columnIndex];
      const cellValue = cellToString(row[columnIndex + 1]);

      if (!cellValue) {
        continue;
      }

      const slotKey = createSlotKey(date, time);
      cards.push(...parseCellLines(cellValue, classYearHint, slotKey));
    }
  }

  if (unofferedRowIndex !== -1) {
    const dataRow = rows[unofferedRowIndex + 1] ?? [];
    const cellValue = dataRow
      .slice(1)
      .map(cellToString)
      .filter(Boolean)
      .join("\n");

    if (cellValue) {
      cards.push(...parseCellLines(cellValue, classYearHint, UNOFFERED_SLOT_KEY));
    }
  }

  return {
    title,
    dates,
    times,
    cards,
  };
};

const readNotesRows = (sheet?: XLSX.WorkSheet) => {
  if (!sheet?.["!ref"]) {
    return [];
  }

  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const rows: Array<string | null> = [];

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const address = XLSX.utils.encode_cell({ r: rowIndex, c: 0 });
    const value = cellToString(sheet[address]?.v);
    rows.push(value || null);
  }

  return rows;
};

const extractUniqueOrdered = (values: string[]) => [...new Set(values.filter(Boolean))];

const parseTableViewSheet = (sheet?: XLSX.WorkSheet) => {
  if (!sheet) {
    throw new Error("Tablo görünümü sekmesi bulunamadı.");
  }

  const rows = sheetToAoA(sheet);
  const generalTitle = cellToString(rows[0]?.[0]) || null;
  const exams: ExamCard[] = [];
  const dates: string[] = [];
  const times: string[] = [];
  const classSheetTitles: Record<string, string> = {};

  let currentSectionTitle = "";
  let currentHeaderMap: Record<string, number> | null = null;

  for (const row of rows) {
    const stringRow = row.map(cellToString);
    const firstCell = stringRow[0] ?? "";
    const nonEmptyCount = stringRow.filter(Boolean).length;

    if (!firstCell && nonEmptyCount === 0) {
      currentHeaderMap = null;
      continue;
    }

    if (firstCell && nonEmptyCount === 1) {
      currentSectionTitle = firstCell;
      currentHeaderMap = null;

      const classYear = labelToClassYear(firstCell);
      if (classYear) {
        classSheetTitles[normalizeClassYear(classYear)] = firstCell;
      }

      continue;
    }

    const maybeHeaderMap = {
      programs: findColumnIndex(stringRow, "Bölüm / Program"),
      classYear: findColumnIndex(stringRow, "Sınıf"),
      courseName: findColumnIndex(stringRow, "Ders"),
      date: findColumnIndex(stringRow, "Tarih"),
      time: findColumnIndex(stringRow, "Saat"),
      locationText: findColumnIndex(stringRow, "Derslik"),
      instructorText: findColumnIndex(stringRow, "Hoca / Gözetmen"),
      duration: findColumnIndex(stringRow, "Süre (dk)"),
      studentCount: findColumnIndex(stringRow, "Öğrenci"),
    };

    if (maybeHeaderMap.classYear >= 0 && maybeHeaderMap.courseName >= 0) {
      currentHeaderMap = maybeHeaderMap;
      continue;
    }

    if (!currentHeaderMap) {
      continue;
    }

    const classYear = normalizeClassYear(cellToString(row[currentHeaderMap.classYear]));
    const courseName = cellToString(row[currentHeaderMap.courseName]);
    const date = cellToString(row[currentHeaderMap.date]);
    const time = cellToString(row[currentHeaderMap.time]);
    const locationText = cellToString(row[currentHeaderMap.locationText]);
    const instructorText = cellToString(row[currentHeaderMap.instructorText]);
    const durationText = cellToString(row[currentHeaderMap.duration]);
    const studentCountText = cellToString(row[currentHeaderMap.studentCount]);

    if (!classYear || !courseName) {
      continue;
    }

    const slotKey =
      currentSectionTitle.localeCompare(UNOFFERED_SECTION_TITLE, "tr", { sensitivity: "base" }) === 0 ||
      !date ||
      !time
        ? UNOFFERED_SLOT_KEY
        : createSlotKey(date, time);

    if (slotKey !== UNOFFERED_SLOT_KEY) {
      dates.push(date);
      times.push(time);
    }

    const rooms = splitRooms(locationText);
    const parsedDuration = Number(durationText);
    const parsedStudentCount = Number(studentCountText);

    exams.push({
      id: createExamId(),
      classYear,
      programs: parseProgramsInput(cellToString(row[currentHeaderMap.programs])),
      courseName,
      slotKey,
      rooms: rooms.length > 0 ? rooms : locationText ? [locationText] : ["Belirlenecek"],
      locationText: locationText || null,
      instructorText: instructorText || null,
      parallelGroupId: null,
      notes: null,
      durationMinutes: Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : undefined,
      studentCount: Number.isFinite(parsedStudentCount) && parsedStudentCount > 0 ? parsedStudentCount : null,
    });
  }

  if (exams.length === 0) {
    throw new Error("Tablo görünümü sekmesinden sınav satırları çözümlenemedi.");
  }

  return normalizeDocument({
    template: {
      dates: extractUniqueOrdered(dates),
      times: extractUniqueOrdered(times),
      views: createViews([
        ...new Set([
          ...Object.keys(classSheetTitles),
          ...exams.map((exam) => normalizeClassYear(exam.classYear)),
        ]),
      ]),
    },
    exams,
    sourceMeta: createSourceMeta({
      generalTitle,
      classSheetTitles,
      notesRows: [],
    }),
  });
};

const createSourceMeta = (options: {
  generalTitle: string | null;
  classSheetTitles: Record<string, string>;
  notesRows: Array<string | null>;
}): SourceWorkbookMeta => ({
  generalTitle: options.generalTitle,
  classSheetTitles: options.classSheetTitles,
  notesRows: options.notesRows,
});

const parseUnassignedSheet = (sheet?: XLSX.WorkSheet) => {
  if (!sheet) {
    return [];
  }

  const rows = XLSX.utils.sheet_to_json<Array<string | null>>(sheet, {
    header: 1,
    raw: false,
    defval: null,
  });
  const exams: ExamCard[] = [];
  const headerRow = rows[1]?.map(cellToString) ?? [];
  const programsColumnIndex = findColumnIndex(headerRow, "Bölüm / Programlar");
  const classColumnIndex = findColumnIndex(headerRow, "Sınıf");
  const courseColumnIndex = findColumnIndex(headerRow, "Ders");
  const locationColumnIndex = findColumnIndex(headerRow, "Derslik / Açıklama");
  const instructorColumnIndex = findColumnIndex(headerRow, "Hoca / Gözetmen");
  const parallelColumnIndex = findColumnIndex(headerRow, "Paralel Grup");
  const notesColumnIndex = findColumnIndex(headerRow, "Not");

  for (const row of rows.slice(2)) {
    const classYear = normalizeClassYear(
      cellToString(classColumnIndex >= 0 ? row[classColumnIndex] : row[0]),
    );
    const courseName = cellToString(courseColumnIndex >= 0 ? row[courseColumnIndex] : row[1]);
    const locationText = cellToString(locationColumnIndex >= 0 ? row[locationColumnIndex] : row[2]);
    const rooms = splitRooms(locationText);

    if (!classYear || !courseName) {
      continue;
    }

    exams.push({
      id: createExamId(),
      classYear,
      programs:
        programsColumnIndex >= 0 ? parseProgramsInput(cellToString(row[programsColumnIndex])) : [],
      courseName,
      rooms: rooms.length > 0 ? rooms : ["Belirlenecek"],
      locationText: locationText || "Belirlenecek",
      slotKey: UNASSIGNED_SLOT_KEY,
      instructorText:
        instructorColumnIndex >= 0 ? cellToString(row[instructorColumnIndex]) || null : null,
      parallelGroupId:
        parallelColumnIndex >= 0
          ? cellToString(row[parallelColumnIndex]) || null
          : cellToString(row[3]) || null,
      notes:
        notesColumnIndex >= 0 ? cellToString(row[notesColumnIndex]) || null : cellToString(row[4]) || null,
    });
  }

  return exams;
};

export const parseWorkbook = (workbook: XLSX.WorkBook): ScheduleDocument => {
  const sheetNames = workbook.SheetNames;
  const generalSheet = workbook.Sheets[GENERAL_SHEET_NAME];
  const tableViewSheet = workbook.Sheets[TABLE_VIEW_SHEET_NAME];
  const classSheetNames = sheetNames.filter((sheetName) => labelToClassYear(sheetName));

  if (!generalSheet && classSheetNames.length === 0) {
    if (tableViewSheet) {
      return parseTableViewSheet(tableViewSheet);
    }

    throw new Error("Excel dosyasında desteklenen çizelge sekmesi bulunamadı.");
  }

  try {
    let templateDates: string[] = [];
    let templateTimes: string[] = [];
    let exams: ExamCard[] = [];
    let generalTitle: string | null = null;
    const classSheetTitles: Record<string, string> = {};

    if (generalSheet) {
      const generalGrid = parseGridSheet(generalSheet, null);
      templateDates = generalGrid.dates;
      templateTimes = generalGrid.times;
      exams = generalGrid.cards;
      generalTitle = generalGrid.title;
    } else {
      const firstClassSheetName = classSheetNames[0];
      const firstClassYear = labelToClassYear(firstClassSheetName);

      if (!firstClassYear) {
        throw new Error("Sınıf sekmesi çözümlenemedi.");
      }

      const firstGrid = parseGridSheet(workbook.Sheets[firstClassSheetName], firstClassYear);
      templateDates = firstGrid.dates;
      templateTimes = firstGrid.times;
    }

    for (const sheetName of classSheetNames) {
      const classYear = labelToClassYear(sheetName);
      if (!classYear) {
        continue;
      }

      const grid = parseGridSheet(workbook.Sheets[sheetName], classYear);
      classSheetTitles[normalizeClassYear(classYear)] = grid.title ?? sheetName;

      if (!generalSheet) {
        exams.push(...grid.cards);
      }
    }

    exams.push(...parseUnassignedSheet(workbook.Sheets[UNASSIGNED_SHEET_NAME]));

    const classYears = new Set<string>([
      ...Object.keys(classSheetTitles),
      ...exams.map((exam) => exam.classYear),
    ]);

    return normalizeDocument({
      template: {
        dates: templateDates,
        times: templateTimes,
        views: createViews([...classYears]),
      },
      exams,
      sourceMeta: createSourceMeta({
        generalTitle,
        classSheetTitles,
        notesRows: readNotesRows(workbook.Sheets[NOTES_SHEET_NAME]),
      }),
    });
  } catch (error) {
    if (tableViewSheet) {
      return parseTableViewSheet(tableViewSheet);
    }

    throw error;
  }
};

export const parseWorkbookArrayBuffer = (arrayBuffer: ArrayBuffer) =>
  parseWorkbook(XLSX.read(new Uint8Array(arrayBuffer), { type: "array" }));
