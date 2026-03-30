import * as XLSX from "xlsx-js-style";
import {
  UNOFFERED_SECTION_TITLE,
  UNASSIGNED_SHEET_NAME,
  classYearToLabel,
  createSlotKey,
  formatExamLine,
  formatLocationText,
  formatPrograms,
  isUnofferedSlot,
  isUnassignedSlot,
  normalizeClassYear,
  parseSlotKey,
  sortClassYears,
  sortExamsForDisplay,
} from "./schedule";
import type { ExamCard, ScheduleDocument } from "../types/schedule";

const GENERAL_SHEET_NAME = "Genel";
const NOTES_SHEET_NAME = "Notlar";
const TABLE_SHEET_NAME = "Tablo Görünümü";
const TABLE_HEADERS = [
  "Bölüm / Program",
  "Sınıf",
  "Ders",
  "Tarih",
  "Saat",
  "Derslik",
  "Hoca / Gözetmen",
  "Süre (dk)",
  "Öğrenci",
] as const;
const TABLE_COLUMN_COUNT = TABLE_HEADERS.length;

type TableRowKind = "title" | "subtitle" | "section" | "header" | "data" | "spacer";
type GridRowKind = "title" | "header" | "time" | "section" | "sectionData" | "spacer";

const BORDER_COLOR = "7A7A7A";

const createBorder = (style: XLSX.BorderType = "thin"): XLSX.CellStyle["border"] => ({
  top: { style, color: { rgb: BORDER_COLOR } },
  bottom: { style, color: { rgb: BORDER_COLOR } },
  left: { style, color: { rgb: BORDER_COLOR } },
  right: { style, color: { rgb: BORDER_COLOR } },
});

const createTableCellStyle = (rowKind: TableRowKind, columnIndex: number): XLSX.CellStyle => {
  const centered = columnIndex === 1 || columnIndex === 3 || columnIndex === 4 || columnIndex === 6;
  const base: XLSX.CellStyle = {
    border: createBorder(rowKind === "title" || rowKind === "subtitle" || rowKind === "section" ? "medium" : "thin"),
    font: {
      name: "Calibri",
      sz: 11,
    },
    alignment: {
      vertical: "center",
      horizontal: centered ? "center" : "left",
      wrapText: true,
    },
  };

  if (rowKind === "title") {
    return {
      ...base,
      font: {
        ...base.font,
        bold: true,
        sz: 15,
        color: { rgb: "FFFFFF" },
      },
      fill: {
        patternType: "solid",
        fgColor: { rgb: "1F4E78" },
      },
      alignment: {
        ...base.alignment,
        horizontal: "center",
      },
    };
  }

  if (rowKind === "subtitle") {
    return {
      ...base,
      font: {
        ...base.font,
        bold: true,
        sz: 12,
        color: { rgb: "FFFFFF" },
      },
      fill: {
        patternType: "solid",
        fgColor: { rgb: "4F81BD" },
      },
      alignment: {
        ...base.alignment,
        horizontal: "center",
      },
    };
  }

  if (rowKind === "section") {
    return {
      ...base,
      font: {
        ...base.font,
        bold: true,
        color: { rgb: "5A3B00" },
      },
      fill: {
        patternType: "solid",
        fgColor: { rgb: "F4D8A5" },
      },
      alignment: {
        ...base.alignment,
        horizontal: "center",
      },
    };
  }

  if (rowKind === "header") {
    return {
      ...base,
      font: {
        ...base.font,
        bold: true,
        color: { rgb: "23313D" },
      },
      fill: {
        patternType: "solid",
        fgColor: { rgb: "FCE4D6" },
      },
      alignment: {
        ...base.alignment,
        horizontal: "center",
      },
    };
  }

  return {
    ...base,
    fill: {
      patternType: "solid",
      fgColor: { rgb: centered ? "F9FBFD" : "FFFFFF" },
    },
  };
};

const ensureCell = (sheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number) => {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });

  if (!sheet[address]) {
    sheet[address] = {
      t: "s",
      v: "",
    };
  }

  return sheet[address];
};

const applyTableStyles = (sheet: XLSX.WorkSheet, rowKinds: TableRowKind[]) => {
  sheet["!rows"] = rowKinds.map((rowKind) => {
    if (rowKind === "title") {
      return { hpx: 26 };
    }

    if (rowKind === "subtitle" || rowKind === "section") {
      return { hpx: 22 };
    }

    if (rowKind === "header") {
      return { hpx: 20 };
    }

    if (rowKind === "spacer") {
      return { hpx: 8 };
    }

    return { hpx: 18 };
  });

  rowKinds.forEach((rowKind, rowIndex) => {
    if (rowKind === "spacer") {
      return;
    }

    for (let columnIndex = 0; columnIndex < TABLE_COLUMN_COUNT; columnIndex += 1) {
      const cell = ensureCell(sheet, rowIndex, columnIndex);
      cell.s = createTableCellStyle(rowKind, columnIndex);
    }
  });
};

const createGridCellStyle = (
  rowKind: GridRowKind,
  columnIndex: number,
  hasValue: boolean,
): XLSX.CellStyle => {
  const isFirstColumn = columnIndex === 0;
  const base: XLSX.CellStyle = {
    border: createBorder(rowKind === "title" || rowKind === "section" ? "medium" : "thin"),
    font: {
      name: "Calibri",
      sz: 11,
    },
    alignment: {
      vertical: rowKind === "title" || rowKind === "header" || rowKind === "section" ? "center" : "top",
      horizontal:
        rowKind === "title" || rowKind === "header" || rowKind === "section" || isFirstColumn
          ? "center"
          : "left",
      wrapText: true,
    },
  };

  if (rowKind === "title") {
    return {
      ...base,
      font: {
        ...base.font,
        bold: true,
        sz: 14,
        color: { rgb: "FFFFFF" },
      },
      fill: {
        patternType: "solid",
        fgColor: { rgb: "0D4549" },
      },
    };
  }

  if (rowKind === "header") {
    return {
      ...base,
      font: {
        ...base.font,
        bold: true,
        color: { rgb: "23313D" },
      },
      fill: {
        patternType: "solid",
        fgColor: { rgb: isFirstColumn ? "E7D9BF" : "F6E9D4" },
      },
    };
  }

  if (rowKind === "time") {
    if (isFirstColumn) {
      return {
        ...base,
        font: {
          ...base.font,
          bold: true,
          color: { rgb: "0D4549" },
        },
        fill: {
          patternType: "solid",
          fgColor: { rgb: "F0E6D6" },
        },
        alignment: {
          ...base.alignment,
          vertical: "center",
          horizontal: "center",
        },
      };
    }

    return {
      ...base,
      fill: {
        patternType: "solid",
        fgColor: { rgb: hasValue ? "FFF4E6" : "FAFBFC" },
      },
      border: createBorder(hasValue ? "medium" : "thin"),
      font: {
        ...base.font,
        bold: hasValue,
        color: { rgb: hasValue ? "24323A" : "5B6770" },
      },
      alignment: {
        ...base.alignment,
        horizontal: "left",
      },
    };
  }

  if (rowKind === "section") {
    return {
      ...base,
      font: {
        ...base.font,
        bold: true,
        color: { rgb: "5A3B00" },
      },
      fill: {
        patternType: "solid",
        fgColor: { rgb: "F4D8A5" },
      },
    };
  }

  if (rowKind === "sectionData") {
    return {
      ...base,
      fill: {
        patternType: "solid",
        fgColor: { rgb: isFirstColumn ? "F8E8C8" : "FFF6EA" },
      },
      border: createBorder("medium"),
      font: {
        ...base.font,
        bold: isFirstColumn,
      },
      alignment: {
        ...base.alignment,
        horizontal: isFirstColumn ? "center" : "left",
      },
    };
  }

  return base;
};

const applyGridStyles = (
  sheet: XLSX.WorkSheet,
  rows: Array<Array<string | null>>,
  rowKinds: GridRowKind[],
  columnCount: number,
) => {
  sheet["!rows"] = rowKinds.map((rowKind) => {
    if (rowKind === "title") {
      return { hpx: 28 };
    }

    if (rowKind === "header" || rowKind === "section") {
      return { hpx: 24 };
    }

    if (rowKind === "sectionData") {
      return { hpx: 34 };
    }

    if (rowKind === "spacer") {
      return { hpx: 8 };
    }

    return { hpx: 52 };
  });

  rowKinds.forEach((rowKind, rowIndex) => {
    if (rowKind === "spacer") {
      return;
    }

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const value = rows[rowIndex]?.[columnIndex];
      const cell = ensureCell(sheet, rowIndex, columnIndex);
      cell.s = createGridCellStyle(rowKind, columnIndex, Boolean(value));
    }
  });
};

const getGeneralTitle = (document: ScheduleDocument) =>
  document.sourceMeta.generalTitle ?? "VİZE PROGRAMI (GENEL) — Ders Programı Görünümü";

const getClassTitle = (document: ScheduleDocument, classYear: string) =>
  document.sourceMeta.classSheetTitles[normalizeClassYear(classYear)] ??
  `${classYearToLabel(classYear).toUpperCase()} VİZE PROGRAMI (Ders Programı Görünümü)`;

const buildGridRows = (
  document: ScheduleDocument,
  exams: ExamCard[],
  includeClassPrefix: boolean,
  title: string,
) => {
  const slotMap = new Map<string, ExamCard[]>();
  const columnCount = document.template.dates.length + 1;

  for (const exam of sortExamsForDisplay(document, exams)) {
    const existing = slotMap.get(exam.slotKey);
    if (existing) {
      existing.push(exam);
    } else {
      slotMap.set(exam.slotKey, [exam]);
    }
  }

  const rows: Array<Array<string | null>> = [
    [title, ...Array.from({ length: columnCount - 1 }, () => null)],
    ["Saat", ...document.template.dates],
  ];
  const rowKinds: GridRowKind[] = ["title", "header"];

  for (const time of document.template.times) {
    const row: Array<string | null> = [time];

    for (const date of document.template.dates) {
      const slotKey = createSlotKey(date, time);
      const slotExams = slotMap.get(slotKey) ?? [];
      row.push(
        slotExams.length > 0
          ? slotExams.map((exam) => formatExamLine(exam, includeClassPrefix)).join("\n")
          : null,
      );
    }

    rows.push(row);
    rowKinds.push("time");
  }

  const unofferedExams = sortExamsForDisplay(
    document,
    exams.filter((exam) => isUnofferedSlot(exam.slotKey)),
  );

  if (unofferedExams.length > 0) {
    rows.push(Array.from({ length: columnCount }, () => null));
    rowKinds.push("spacer");
    rows.push([UNOFFERED_SECTION_TITLE, ...Array.from({ length: columnCount - 1 }, () => null)]);
    rowKinds.push("section");
    rows.push([
      "Dersler",
      unofferedExams.map((exam) => formatExamLine(exam, includeClassPrefix)).join("\n"),
      ...Array.from({ length: columnCount - 2 }, () => null),
    ]);
    rowKinds.push("sectionData");
  }

  return {
    rows,
    rowKinds,
  };
};

const applyBasicLayout = (sheet: XLSX.WorkSheet, columnCount: number, rowCount: number) => {
  const merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: columnCount - 1 } }];

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    if (sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 0 })]?.v !== UNOFFERED_SECTION_TITLE) {
      continue;
    }

    merges.push({ s: { r: rowIndex, c: 0 }, e: { r: rowIndex, c: columnCount - 1 } });
    merges.push({ s: { r: rowIndex + 1, c: 1 }, e: { r: rowIndex + 1, c: columnCount - 1 } });
  }

  sheet["!merges"] = merges;
  sheet["!cols"] = [
    { wch: 10 },
    ...Array.from({ length: columnCount - 1 }, () => ({ wch: 28 })),
  ];
};

const createWorksheet = (
  document: ScheduleDocument,
  exams: ExamCard[],
  includeClassPrefix: boolean,
  title: string,
) => {
  const { rows, rowKinds } = buildGridRows(document, exams, includeClassPrefix, title);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  applyBasicLayout(sheet, document.template.dates.length + 1, rows.length);
  applyGridStyles(sheet, rows, rowKinds, document.template.dates.length + 1);
  return sheet;
};

const createUnassignedWorksheet = (document: ScheduleDocument) => {
  const rows: Array<Array<string | null>> = [
    ["Yerleştirilmeyen Kartlar"],
    [
      "Bölüm / Programlar",
      "Sınıf",
      "Ders",
      "Derslik / Açıklama",
      "Hoca / Gözetmen",
      "Paralel Grup",
      "Not",
      "Süre (dk)",
      "Öğrenci",
    ],
  ];

  for (const exam of sortExamsForDisplay(
    document,
    document.exams.filter((item) => isUnassignedSlot(item.slotKey)),
  )) {
    rows.push([
        formatPrograms(exam.programs),
        exam.classYear,
        exam.courseName,
        exam.locationText ?? exam.rooms.join("-"),
        exam.instructorText ?? null,
        exam.parallelGroupId,
        exam.notes,
        String(exam.durationMinutes ?? 60),
        exam.studentCount ? String(exam.studentCount) : "",
      ]);
  }

  return XLSX.utils.aoa_to_sheet(rows);
};

const createSectionRow = (label: string) => [label, ...Array(TABLE_COLUMN_COUNT - 1).fill("")];

const createTableWorksheet = (document: ScheduleDocument) => {
  const emptyRow = () => Array(TABLE_COLUMN_COUNT).fill("") as string[];
  const titleRow = (text: string) => { const r = emptyRow(); r[0] = text; return r; };
  const rows: string[][] = [
    titleRow(getGeneralTitle(document)),
    titleRow("TABLO GÖRÜNÜMÜ"),
  ];
  const rowKinds: TableRowKind[] = ["title", "subtitle"];
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: TABLE_COLUMN_COUNT - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: TABLE_COLUMN_COUNT - 1 } },
  ];

  const classYears = sortClassYears([
    ...new Set(document.exams.map((exam) => normalizeClassYear(exam.classYear))),
  ]);

  for (const classYear of classYears) {
    const sectionStart = rows.length;
    rows.push(createSectionRow(classYearToLabel(classYear).toUpperCase()));
    rowKinds.push("section");
    merges.push({ s: { r: sectionStart, c: 0 }, e: { r: sectionStart, c: TABLE_COLUMN_COUNT - 1 } });
    rows.push([...TABLE_HEADERS]);
    rowKinds.push("header");

    const scheduledExams = sortExamsForDisplay(
      document,
      document.exams.filter(
        (exam) =>
          normalizeClassYear(exam.classYear) === normalizeClassYear(classYear) &&
          !isUnassignedSlot(exam.slotKey) &&
          !isUnofferedSlot(exam.slotKey),
      ),
    );

    for (const exam of scheduledExams) {
      const slot = parseSlotKey(exam.slotKey);
      rows.push([
        formatPrograms(exam.programs),
        classYearToLabel(exam.classYear),
        exam.courseName,
        slot.date,
        slot.time,
        formatLocationText(exam),
        exam.instructorText ?? "",
        String(exam.durationMinutes ?? 60),
        exam.studentCount ? String(exam.studentCount) : "",
      ]);
      rowKinds.push("data");
    }

    const unofferedExams = sortExamsForDisplay(
      document,
      document.exams.filter(
        (exam) =>
          normalizeClassYear(exam.classYear) === normalizeClassYear(classYear) &&
          isUnofferedSlot(exam.slotKey),
      ),
    );

    if (unofferedExams.length > 0) {
      const unofferedStart = rows.length;
      rows.push(createSectionRow(UNOFFERED_SECTION_TITLE.toUpperCase()));
      rowKinds.push("section");
      merges.push({
        s: { r: unofferedStart, c: 0 },
        e: { r: unofferedStart, c: TABLE_COLUMN_COUNT - 1 },
      });
      rows.push([...TABLE_HEADERS]);
      rowKinds.push("header");

      for (const exam of unofferedExams) {
        rows.push([
          formatPrograms(exam.programs),
          classYearToLabel(exam.classYear),
          exam.courseName,
          "",
          "",
          formatLocationText(exam),
          exam.instructorText ?? "",
          String(exam.durationMinutes ?? 60),
          exam.studentCount ? String(exam.studentCount) : "",
        ]);
        rowKinds.push("data");
      }
    }

    rows.push(emptyRow());
    rowKinds.push("spacer");
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = merges;
  sheet["!cols"] = [
    { wch: 24 },
    { wch: 14 },
    { wch: 34 },
    { wch: 18 },
    { wch: 12 },
    { wch: 18 },
    { wch: 24 },
    { wch: 10 },
    { wch: 10 },
  ];
  applyTableStyles(sheet, rowKinds);

  return sheet;
};

export const buildWorkbook = (document: ScheduleDocument) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    createWorksheet(document, document.exams, true, getGeneralTitle(document)),
    GENERAL_SHEET_NAME,
  );

  const classYears = sortClassYears([
    ...new Set(document.exams.map((exam) => normalizeClassYear(exam.classYear))),
  ]);

  for (const classYear of classYears) {
    const classExams = document.exams.filter(
      (exam) => normalizeClassYear(exam.classYear) === normalizeClassYear(classYear),
    );

    XLSX.utils.book_append_sheet(
      workbook,
      createWorksheet(document, classExams, false, getClassTitle(document, classYear)),
      classYearToLabel(classYear),
    );
  }

  XLSX.utils.book_append_sheet(workbook, createTableWorksheet(document), TABLE_SHEET_NAME);

  if (document.sourceMeta.notesRows.length > 0) {
    const rows = document.sourceMeta.notesRows.map((row) => [row]);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), NOTES_SHEET_NAME);
  }

  if (document.exams.some((exam) => isUnassignedSlot(exam.slotKey))) {
    XLSX.utils.book_append_sheet(workbook, createUnassignedWorksheet(document), UNASSIGNED_SHEET_NAME);
  }

  return workbook;
};

export const exportWorkbookArrayBuffer = (document: ScheduleDocument) =>
  XLSX.write(buildWorkbook(document), { type: "array", bookType: "xlsx" });
