import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseScheduleDocumentJson, serializeScheduleDocument } from "../lib/document";
import { UNOFFERED_SLOT_KEY, UNASSIGNED_SLOT_KEY } from "../lib/schedule";
import { buildWorkbook, exportWorkbookArrayBuffer } from "../lib/xlsx-export";
import { parseWorkbookArrayBuffer } from "../lib/xlsx-parser";
import type { ExamCard } from "../types/schedule";
import { loadFixtureDocument } from "./fixture";

const simplifyExams = (exams: ExamCard[]) =>
  exams
    .map((exam) => ({
      courseName: exam.courseName,
      classYear: exam.classYear,
      slotKey: exam.slotKey,
      rooms: [...exam.rooms].sort(),
      locationText: exam.locationText ?? null,
      parallelGroupId: exam.parallelGroupId,
      notes: exam.notes,
    }))
    .sort((left, right) =>
      `${left.slotKey}:${left.classYear}:${left.courseName}`.localeCompare(
        `${right.slotKey}:${right.classYear}:${right.courseName}`,
        "tr",
      ),
    );

describe("document roundtrips", () => {
  it("roundtrips through JSON without losing schedule data", () => {
    const original = loadFixtureDocument();
    const restored = parseScheduleDocumentJson(serializeScheduleDocument(original));

    expect(simplifyExams(restored.exams)).toEqual(simplifyExams(original.exams));
    expect(restored.template.dates).toEqual(original.template.dates);
    expect(restored.sourceMeta.notesRows).toEqual(original.sourceMeta.notesRows);
  });

  it("roundtrips through Excel export/import without losing schedule slots", () => {
    const original = loadFixtureDocument();
    const restored = parseWorkbookArrayBuffer(exportWorkbookArrayBuffer(original));

    expect(simplifyExams(restored.exams)).toEqual(simplifyExams(original.exams));
    expect(restored.sourceMeta.notesRows).toEqual(original.sourceMeta.notesRows);
  });

  it("preserves unassigned cards through Excel export/import", () => {
    const original = loadFixtureDocument();
    original.exams.push({
      id: "manual-unassigned",
      classYear: "2.S",
      courseName: "Deneme Sınavı",
      slotKey: UNASSIGNED_SLOT_KEY,
      rooms: ["105"],
      locationText: "105",
      parallelGroupId: null,
      notes: "havuz",
    });

    const restored = parseWorkbookArrayBuffer(exportWorkbookArrayBuffer(original));

    expect(
      simplifyExams(restored.exams).find((exam) => exam.courseName === "Deneme Sınavı"),
    ).toEqual({
      courseName: "Deneme Sınavı",
      classYear: "2.S",
      slotKey: UNASSIGNED_SLOT_KEY,
      rooms: ["105"],
      locationText: "105",
      parallelGroupId: null,
      notes: "havuz",
    });
  });

  it("preserves newly added empty time blocks through Excel export/import", () => {
    const original = loadFixtureDocument();
    original.template.times = [...original.template.times, "17:00"];

    const restored = parseWorkbookArrayBuffer(exportWorkbookArrayBuffer(original));

    expect(restored.template.times).toContain("17:00");
  });

  it("preserves unopened-course rows through Excel export/import", () => {
    const original = loadFixtureDocument();
    original.exams.push({
      id: "manual-unoffered",
      classYear: "3.S",
      courseName: "Eski Müfredat Dersi",
      slotKey: UNOFFERED_SLOT_KEY,
      rooms: ["101"],
      locationText: "Öğrenci ile belirlenecek",
      parallelGroupId: null,
      notes: "Alttan alanlar",
    });

    const restored = parseWorkbookArrayBuffer(exportWorkbookArrayBuffer(original));

    expect(
      simplifyExams(restored.exams).find((exam) => exam.courseName === "Eski Müfredat Dersi"),
    ).toEqual({
      courseName: "Eski Müfredat Dersi",
      classYear: "3.S",
      slotKey: UNOFFERED_SLOT_KEY,
      rooms: ["Öğrenci ile belirlenecek"],
      locationText: "Öğrenci ile belirlenecek",
      parallelGroupId: null,
      notes: null,
    });
  });

  it("preserves free-text class and location values through Excel export/import", () => {
    const original = loadFixtureDocument();
    original.exams.push({
      id: "manual-custom-text",
      classYear: "Hazırlık Grubu",
      courseName: "Portfolyo Değerlendirme",
      slotKey: UNASSIGNED_SLOT_KEY,
      rooms: ["hoca ile görüşülecek"],
      locationText: "hoca ile görüşülecek",
      parallelGroupId: null,
      notes: null,
    });

    const restored = parseWorkbookArrayBuffer(exportWorkbookArrayBuffer(original));

    expect(
      simplifyExams(restored.exams).find((exam) => exam.courseName === "Portfolyo Değerlendirme"),
    ).toEqual({
      courseName: "Portfolyo Değerlendirme",
      classYear: "Hazırlık Grubu",
      slotKey: UNASSIGNED_SLOT_KEY,
      rooms: ["hoca ile görüşülecek"],
      locationText: "hoca ile görüşülecek",
      parallelGroupId: null,
      notes: null,
    });
  });

  it("adds a row-based table worksheet to Excel export", () => {
    const original = loadFixtureDocument();
    original.exams.push({
      id: "manual-table-unoffered",
      classYear: "4.S",
      courseName: "Eski Program Dersi",
      slotKey: UNOFFERED_SLOT_KEY,
      rooms: ["Öğrenci ile belirlenecek"],
      locationText: "Öğrenci ile belirlenecek",
      parallelGroupId: null,
      notes: null,
    });

    const workbook = buildWorkbook(original);
    const tableSheet = workbook.Sheets["Tablo Görünümü"];
    const rows = XLSX.utils.sheet_to_json<Array<string | null>>(tableSheet, {
      header: 1,
      raw: false,
      defval: null,
    });

    expect(workbook.SheetNames).toContain("Tablo Görünümü");
    expect(rows.some((row) => row[0] === "1. SINIF")).toBe(true);
    expect(rows.some((row) => row[1] === "Yönetim ve Organizasyon")).toBe(true);
    expect(rows.some((row) => row[0] === "AÇILMAYAN DERSLER")).toBe(true);
    expect(rows.some((row) => row[1] === "Eski Program Dersi")).toBe(true);
    expect(tableSheet.A3?.s?.border?.top?.style).toBe("medium");
    expect(tableSheet.A4?.s?.fill?.fgColor?.rgb).toBe("FCE4D6");
  });

  it("styles the grid worksheets with highlighted headers and card-like exam cells", () => {
    const workbook = buildWorkbook(loadFixtureDocument());
    const generalSheet = workbook.Sheets["Genel"];
    const classSheet = workbook.Sheets["1. Sınıf"];

    expect(generalSheet.A1?.s?.fill?.fgColor?.rgb).toBe("0D4549");
    expect(generalSheet.B2?.s?.fill?.fgColor?.rgb).toBe("F6E9D4");
    expect(generalSheet.B3?.s?.fill?.fgColor?.rgb).toBe("FFF4E6");
    expect(generalSheet.B3?.s?.border?.top?.style).toBe("medium");
    expect(classSheet.A2?.s?.fill?.fgColor?.rgb).toBe("E7D9BF");
  });
});
