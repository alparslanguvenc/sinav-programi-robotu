import { describe, expect, it } from "vitest";
import { detectConflicts } from "../lib/conflicts";
import { UNOFFERED_SLOT_KEY, createSlotKey } from "../lib/schedule";
import { loadFixtureDocument } from "./fixture";

describe("conflict detection", () => {
  it("finds the three room conflicts and four class conflicts from the source workbook", () => {
    const document = loadFixtureDocument();
    const conflicts = detectConflicts(document.exams);

    expect(conflicts.filter((conflict) => conflict.type === "room")).toHaveLength(3);
    expect(conflicts.filter((conflict) => conflict.type === "class")).toHaveLength(4);
  });

  it("suppresses class conflicts when same-slot exams share a parallel group", () => {
    const document = loadFixtureDocument();
    const countsBySlotAndClass = new Map<string, number>();

    for (const exam of document.exams) {
      const key = `${exam.slotKey}:${exam.classYear}`;
      countsBySlotAndClass.set(key, (countsBySlotAndClass.get(key) ?? 0) + 1);
    }

    const groupedExams = document.exams.map((exam) => {
      const key = `${exam.slotKey}:${exam.classYear}`;
      return countsBySlotAndClass.get(key)! > 1
        ? { ...exam, parallelGroupId: key }
        : exam;
    });

    const conflicts = detectConflicts(groupedExams);

    expect(conflicts.filter((conflict) => conflict.type === "class")).toHaveLength(0);
    expect(conflicts.filter((conflict) => conflict.type === "room")).toHaveLength(3);
  });

  it("does not treat free-text locations as room resources", () => {
    const slotKey = createSlotKey("Pzt 23.03.2026", "09:30");
    const conflicts = detectConflicts([
      {
        id: "custom-1",
        classYear: "Hazırlık Grubu",
        programs: [],
        courseName: "Mülakat",
        slotKey,
        rooms: ["hoca ile görüşülecek"],
        locationText: "hoca ile görüşülecek",
        parallelGroupId: null,
        notes: null,
      },
      {
        id: "custom-2",
        classYear: "Hazırlık Grubu",
        programs: [],
        courseName: "Sunum",
        slotKey,
        rooms: ["hoca ile görüşülecek"],
        locationText: "hoca ile görüşülecek",
        parallelGroupId: "hazirlik",
        notes: null,
      },
    ]);

    expect(conflicts.filter((conflict) => conflict.type === "room")).toHaveLength(0);
  });

  it("ignores unopened-course cards in conflict detection", () => {
    const conflicts = detectConflicts([
      {
        id: "unoffered-1",
        classYear: "2.S",
        programs: [],
        courseName: "Eski Ders I",
        slotKey: UNOFFERED_SLOT_KEY,
        rooms: ["101"],
        locationText: "101",
        parallelGroupId: null,
        notes: null,
      },
      {
        id: "unoffered-2",
        classYear: "2.S",
        programs: [],
        courseName: "Eski Ders II",
        slotKey: UNOFFERED_SLOT_KEY,
        rooms: ["101"],
        locationText: "101",
        parallelGroupId: null,
        notes: null,
      },
    ]);

    expect(conflicts).toHaveLength(0);
  });

  it("does not create class conflicts for different programs in the same class year", () => {
    const slotKey = createSlotKey("Pzt 23.03.2026", "11:00");
    const conflicts = detectConflicts([
      {
        id: "dept-a",
        classYear: "1.S",
        programs: ["Gazetecilik"],
        courseName: "Haber Yazımı",
        slotKey,
        rooms: ["201"],
        locationText: "201",
        instructorText: null,
        parallelGroupId: null,
        notes: null,
      },
      {
        id: "dept-b",
        classYear: "1.S",
        programs: ["Halkla İlişkiler"],
        courseName: "Kurumsal İletişim",
        slotKey,
        rooms: ["202"],
        locationText: "202",
        instructorText: null,
        parallelGroupId: null,
        notes: null,
      },
    ]);

    expect(conflicts.filter((conflict) => conflict.type === "class")).toHaveLength(0);
  });

  it("creates class conflicts when programs overlap", () => {
    const slotKey = createSlotKey("Pzt 23.03.2026", "12:00");
    const conflicts = detectConflicts([
      {
        id: "shared-a",
        classYear: "1.S",
        programs: ["Gazetecilik", "Halkla İlişkiler"],
        courseName: "Atatürk İlkeleri",
        slotKey,
        rooms: ["301"],
        locationText: "301",
        instructorText: null,
        parallelGroupId: null,
        notes: null,
      },
      {
        id: "shared-b",
        classYear: "1.S",
        programs: ["Gazetecilik"],
        courseName: "Medya Hukuku",
        slotKey,
        rooms: ["302"],
        locationText: "302",
        instructorText: null,
        parallelGroupId: null,
        notes: null,
      },
    ]);

    expect(conflicts.filter((conflict) => conflict.type === "class")).toHaveLength(1);
    expect(conflicts[0]?.resourceKey).toContain("Gazetecilik");
  });
});
