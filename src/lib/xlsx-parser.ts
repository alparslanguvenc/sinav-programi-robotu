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
  const classSheetNames = sheetNames.filter((sheetName) => labelToClassYear(sheetName));

  if (!generalSheet && classSheetNames.length === 0) {
    throw new Error("Excel dosyasında desteklenen çizelge sekmesi bulunamadı.");
  }

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
};

export const parseWorkbookArrayBuffer = (arrayBuffer: ArrayBuffer) =>
  parseWorkbook(XLSX.read(new Uint8Array(arrayBuffer), { type: "array" }));
