import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { importScheduleFromFile } from "../lib/source-import";
import type { SchoolProfile } from "../types/schedule";

const bufferToArrayBuffer = (buffer: ArrayBuffer | Uint8Array) =>
  buffer instanceof Uint8Array
    ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    : buffer;

const buildGenericWorkbookFile = () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Sınıf", "Ders", "Hoca", "Derslik"],
    ["1.S", "Arkeoloji", "Dr. Ayşe Kaya", "102-103"],
    ["2.S", "Medya Yönetimi", "Öğr. Gör. Ali Demir", "104"],
  ]);

  XLSX.utils.book_append_sheet(workbook, sheet, "Dersler");

  return new File(
    [bufferToArrayBuffer(XLSX.write(workbook, { type: "array", bookType: "xlsx" }))],
    "ders-programi.xlsx",
    {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  );
};

describe("source import", () => {
  it("auto-generates an exam schedule from a generic timetable workbook and a school profile", async () => {
    const profile: SchoolProfile = {
      id: "profile-1",
      name: "İletişim Fakültesi",
      updatedAt: new Date().toISOString(),
      dates: ["Pzt 23.03.2026", "Sal 24.03.2026"],
      times: ["09:00", "11:00"],
      programs: ["Gazetecilik", "Radyo TV"],
      classYears: ["1.S", "2.S"],
      rooms: ["102-103", "104"],
      instructors: ["Dr. Ayşe Kaya", "Öğr. Gör. Ali Demir"],
      courseTemplates: [
        {
          id: "course-1",
          programs: ["Gazetecilik"],
          classYear: "1.S",
          courseName: "Arkeoloji",
          instructorText: "Dr. Ayşe Kaya",
          locationText: "102-103",
        },
        {
          id: "course-2",
          programs: ["Radyo TV"],
          classYear: "2.S",
          courseName: "Medya Yönetimi",
          instructorText: "Öğr. Gör. Ali Demir",
          locationText: "104",
        },
      ],
    };

    const result = await importScheduleFromFile(buildGenericWorkbookFile(), { profile });

    expect(result.mode).toBe("auto-generated");
    expect(result.document.sourceMeta.importedFrom).toBe("auto-generated");
    expect(result.document.exams).toHaveLength(2);
    expect(result.document.template.dates).toEqual(profile.dates);
    expect(result.document.template.times).toEqual(profile.times);
    expect(result.document.exams[0]?.slotKey).toContain("__@@__");
    expect(result.document.exams.find((exam) => exam.courseName === "Arkeoloji")?.instructorText).toBe(
      "Dr. Ayşe Kaya",
    );
    expect(result.document.exams.find((exam) => exam.courseName === "Arkeoloji")?.locationText).toBe(
      "102-103",
    );
    expect(result.document.exams.find((exam) => exam.courseName === "Arkeoloji")?.programs).toEqual([
      "Gazetecilik",
    ]);
  });
});
