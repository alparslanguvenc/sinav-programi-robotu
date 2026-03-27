import { describe, expect, it } from "vitest";
import { createSlotKey } from "../lib/schedule";
import { parseWorkbook } from "../lib/xlsx-parser";
import { loadFixtureDocument, readFixtureWorkbook } from "./fixture";

describe("xlsx parser", () => {
  it("parses the provided workbook into 52 exam cards", () => {
    const document = loadFixtureDocument();

    expect(document.exams).toHaveLength(52);
    expect(document.template.dates).toEqual([
      "Pzt 23.03.2026",
      "Sal 24.03.2026",
      "Çar 25.03.2026",
      "Per 26.03.2026",
      "Cum 27.03.2026",
    ]);
    expect(document.template.times).toEqual([
      "09:30",
      "10:00",
      "11:00",
      "12:00",
      "13:00",
      "13:30",
      "14:30",
      "16:00",
    ]);
  });

  it("splits multiline cells and multi-room values into independent cards", () => {
    const document = loadFixtureDocument();
    const slotKey = createSlotKey("Per 26.03.2026", "09:30");

    expect(
      document.exams.filter((exam) => exam.slotKey === slotKey && exam.classYear === "1.S"),
    ).toHaveLength(3);
    expect(
      document.exams.find((exam) => exam.courseName === "Yönetim ve Organizasyon")?.rooms,
    ).toEqual(["102", "103"]);
  });

  it("reconstructs the document from class sheets when the Genel sheet is missing", () => {
    const workbook = readFixtureWorkbook();
    workbook.SheetNames = workbook.SheetNames.filter((sheetName) => sheetName !== "Genel");
    delete workbook.Sheets.Genel;

    const document = parseWorkbook(workbook);

    expect(document.exams).toHaveLength(52);
    expect(
      document.exams.find((exam) => exam.courseName === "Mesleki İngilizce VI")?.slotKey,
    ).toBe(createSlotKey("Cum 27.03.2026", "16:00"));
  });
});
