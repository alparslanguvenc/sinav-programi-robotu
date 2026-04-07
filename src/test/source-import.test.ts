import * as XLSX from "xlsx";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAutoScheduleDocument,
  buildAutoScheduleDocumentWithAI,
  importScheduleFromFile,
} from "../lib/source-import";
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

const buildPreviousOutputWorkbookFile = () => {
  const workbook = XLSX.utils.book_new();

  const generalSheet = XLSX.utils.aoa_to_sheet([
    ["ABC Okulu Sınav Programı"],
    ["Saat", "11.05.2026", "12.05.2026"],
    ["09:00", "Seyahat | 1.S: Arkeoloji (101)", ""],
    ["Açılmayan Dersler"],
    ["Dersler", "Seyahat | 4.S: Tur Operatörlüğü"],
  ]);

  const tableSheet = XLSX.utils.aoa_to_sheet([
    ["ABC Okulu Sınav Programı"],
    ["TABLO GÖRÜNÜMÜ"],
    ["1. SINIF"],
    ["Bölüm / Program", "Sınıf", "Ders", "Tarih", "Saat", "Derslik", "Hoca / Gözetmen", "Süre (dk)", "Öğrenci"],
    ["Seyahat", "1. Sınıf", "Arkeoloji", "11.05.2026", "09:00", "101", "", "", ""],
    [""],
    ["AÇILMAYAN DERSLER"],
    ["Bölüm / Program", "Sınıf", "Ders", "Tarih", "Saat", "Derslik", "Hoca / Gözetmen", "Süre (dk)", "Öğrenci"],
    ["Seyahat", "4. Sınıf", "Tur Operatörlüğü", "", "", "", "Lütfi Atay ile görüşünüz", "", ""],
  ]);

  XLSX.utils.book_append_sheet(workbook, generalSheet, "Genel");
  XLSX.utils.book_append_sheet(workbook, tableSheet, "Tablo Görünümü");

  return new File(
    [bufferToArrayBuffer(XLSX.write(workbook, { type: "array", bookType: "xlsx" }))],
    "onceki-program-ciktisi.xlsx",
    {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  );
};

describe("source import", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("opens a previous exported exam workbook without falling back to AI", async () => {
    const result = await importScheduleFromFile(buildPreviousOutputWorkbookFile());

    expect(result.mode).toBe("exam-workbook");
    expect(result.document.sourceMeta.importedFrom).toBe("exam-workbook");
    expect(result.document.exams.some((exam) => exam.courseName === "Arkeoloji")).toBe(true);
    expect(result.document.exams.some((exam) => exam.courseName === "Tur Operatörlüğü")).toBe(true);
    expect(result.document.exams.find((exam) => exam.courseName === "Tur Operatörlüğü")?.slotKey).toBe(
      "__unoffered__",
    );
  });

  it("does not invent extra times when profile times are explicitly set", () => {
    const profile: SchoolProfile = {
      id: "profile-2",
      name: "Kısıtlı Saat Testi",
      updatedAt: new Date().toISOString(),
      dates: ["Pzt 23.03.2026"],
      times: ["10:00"],
      programs: ["Gazetecilik"],
      classYears: ["1.S"],
      rooms: ["101", "102"],
      instructors: ["Dr. Ayşe Kaya", "Dr. Ali Demir"],
      courseTemplates: [],
    };

    const document = buildAutoScheduleDocument(
      [
        {
          programs: ["Gazetecilik"],
          classYear: "1.S",
          courseName: "Arkeoloji",
          instructorText: "Dr. Ayşe Kaya",
          locationText: "101",
        },
        {
          programs: ["Gazetecilik"],
          classYear: "1.S",
          courseName: "Sanat Tarihi",
          instructorText: "Dr. Ali Demir",
          locationText: "102",
        },
      ],
      "ders-programi.pdf",
      { profile },
    );

    expect(document.template.times).toEqual(["10:00"]);
    expect(new Set(document.exams.map((exam) => exam.slotKey.split("__@@__")[1]))).toEqual(new Set(["10:00"]));
  });

  it("applies advanced Turkish scheduling instructions for deadlines, last-day rules, and elective second languages", () => {
    const profile: SchoolProfile = {
      id: "profile-3",
      name: "Seyahat Programi",
      updatedAt: new Date().toISOString(),
      dates: ["Çar 14.05.2026", "Per 15.05.2026", "Cum 16.05.2026"],
      times: ["09:00", "11:00"],
      programs: ["Seyahat"],
      classYears: ["1.S", "4.S"],
      rooms: ["101", "102", "103", "104", "105", "201", "202", "203", "204", "205"],
      instructors: [],
      courseTemplates: [],
    };

    const instruction =
      "4. sınıfların sınavları 15.05.2026 tarihine kadar tamamlansın. " +
      "Diğer sınıflar için, İngilizce sınavı son gün, mesleki ingilizce sınavı sondan bir önceki gün. " +
      "Almanca, japonca ve rusça sınavları 14.05.2026 tarihinde olsun. " +
      "Aynı gün, aynı saatte farklı sınav olmasın. " +
      "Bir sınıfın Almanca, rusça ve japonca sınavları aynı gün ve saatte olsun. " +
      "Onlar seçmeli ders. Bir öğrenci iki tane ikinci yabancı dil dersi alamıyor.";

    const document = buildAutoScheduleDocument(
      [
        {
          programs: ["Seyahat"],
          classYear: "1.S",
          courseName: "İngilizce II",
          instructorText: "Tuba Özgün",
          locationText: "101",
        },
        {
          programs: ["Seyahat"],
          classYear: "1.S",
          courseName: "Mesleki İngilizce II",
          instructorText: "Hakan Memiş",
          locationText: "102",
        },
        {
          programs: ["Seyahat"],
          classYear: "1.S",
          courseName: "Almanca II",
          instructorText: "Metin Gülel",
          locationText: "103",
        },
        {
          programs: ["Seyahat"],
          classYear: "1.S",
          courseName: "Rusça II",
          instructorText: "Maria Stoyanova",
          locationText: "104",
        },
        {
          programs: ["Seyahat"],
          classYear: "1.S",
          courseName: "Japonca II",
          instructorText: "Mariko KIZILAY",
          locationText: "105",
        },
        {
          programs: ["Seyahat"],
          classYear: "4.S",
          courseName: "İngilizce VIII",
          instructorText: "Tuba Özgün",
          locationText: "201",
        },
        {
          programs: ["Seyahat"],
          classYear: "4.S",
          courseName: "Tur Operatörlüğü",
          instructorText: "Lütfi Atay",
          locationText: "202",
        },
        {
          programs: ["Seyahat"],
          classYear: "4.S",
          courseName: "Almanca VIII",
          instructorText: "Metin Gülel",
          locationText: "203",
        },
        {
          programs: ["Seyahat"],
          classYear: "4.S",
          courseName: "Rusça VIII",
          instructorText: "Maria Stoyanova",
          locationText: "204",
        },
        {
          programs: ["Seyahat"],
          classYear: "4.S",
          courseName: "Japonca VIII",
          instructorText: "Mariko KIZILAY",
          locationText: "205",
        },
      ],
      "ders-programi.pdf",
      { profile, userInstructions: instruction },
    );

    const byCourseName = (courseName: string) =>
      document.exams.find((exam) => exam.courseName === courseName);

    expect(byCourseName("İngilizce II")?.slotKey).toContain("16.05.2026");
    expect(byCourseName("Mesleki İngilizce II")?.slotKey).toContain("15.05.2026");

    const firstClassSecondForeign = ["Almanca II", "Rusça II", "Japonca II"]
      .map((courseName) => byCourseName(courseName))
      .filter((exam): exam is NonNullable<typeof exam> => Boolean(exam));

    expect(firstClassSecondForeign).toHaveLength(3);
    expect(new Set(firstClassSecondForeign.map((exam) => exam.slotKey)).size).toBe(1);
    expect(firstClassSecondForeign.every((exam) => exam.slotKey.includes("14.05.2026"))).toBe(true);
    expect(new Set(firstClassSecondForeign.map((exam) => exam.electiveGroupId)).size).toBe(1);
    expect(firstClassSecondForeign[0]?.electiveGroupId).toBe("second-foreign::1.S");

    expect(
      document.exams
        .filter((exam) => exam.classYear === "4.S")
        .every((exam) => !exam.slotKey.includes("16.05.2026")),
    ).toBe(true);

    const fourthClassSecondForeign = ["Almanca VIII", "Rusça VIII", "Japonca VIII"]
      .map((courseName) => byCourseName(courseName))
      .filter((exam): exam is NonNullable<typeof exam> => Boolean(exam));

    expect(new Set(fourthClassSecondForeign.map((exam) => exam.slotKey)).size).toBe(1);
    expect(fourthClassSecondForeign.every((exam) => exam.slotKey.includes("14.05.2026"))).toBe(true);
    expect(fourthClassSecondForeign[0]?.electiveGroupId).toBe("second-foreign::4.S");
  });

  it("uses AI instruction interpretation when free-form phrasing is not covered by rule-based parsing", async () => {
    const profile: SchoolProfile = {
      id: "profile-4",
      name: "Seyahat Programi",
      updatedAt: new Date().toISOString(),
      dates: ["Çar 14.05.2026", "Per 15.05.2026", "Cum 16.05.2026"],
      times: ["09:00", "11:00"],
      programs: ["Seyahat"],
      classYears: ["1.S"],
      rooms: ["101", "102", "103"],
      instructors: [],
      courseTemplates: [],
      geminiApiKey: "gsk_test_key",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  constraints: [
                    {
                      kind: "date-position",
                      subjects: ["__english_general__"],
                      classYears: ["1.S"],
                      scope: "all",
                      positionFromEnd: 0,
                      weight: 340,
                    },
                    {
                      kind: "date-position",
                      subjects: ["__vocational_english__"],
                      classYears: ["1.S"],
                      scope: "all",
                      positionFromEnd: 1,
                      weight: 320,
                    },
                  ],
                  groupSecondForeignByClassYear: false,
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const instruction = "Genel İngilizceyi final gününe, mesleki İngilizceyi de ondan bir gün önceye al.";
    const result = await buildAutoScheduleDocumentWithAI(
      [
        {
          programs: ["Seyahat"],
          classYear: "1.S",
          courseName: "İngilizce II",
          instructorText: "Tuba Özgün",
          locationText: "101",
        },
        {
          programs: ["Seyahat"],
          classYear: "1.S",
          courseName: "Mesleki İngilizce II",
          instructorText: "Hakan Memiş",
          locationText: "102",
        },
        {
          programs: ["Seyahat"],
          classYear: "1.S",
          courseName: "Tur Operatörlüğü",
          instructorText: "Lütfi Atay",
          locationText: "103",
        },
      ],
      "ders-programi.pdf",
      {
        profile,
        useAI: true,
        userInstructions: instruction,
      },
    );

    const byCourseName = (courseName: string) =>
      result.document.exams.find((exam) => exam.courseName === courseName);

    expect(result.instructionAiStatus.used).toBe(true);
    expect(result.instructionAiStatus.provider).toBe("Groq");
    expect(byCourseName("İngilizce II")?.slotKey).toContain("16.05.2026");
    expect(byCourseName("Mesleki İngilizce II")?.slotKey).toContain("15.05.2026");
  });
});
