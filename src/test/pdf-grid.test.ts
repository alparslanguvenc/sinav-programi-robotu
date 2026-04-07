import { describe, expect, it } from "vitest";
import { __testables } from "../lib/source-import";

const roomScheduleItems = [
  { text: "Seyahat 1", x: 344, y: 554 },
  { text: "101, 102, 103, Lab, 105, 106, 301, 302, 303", x: 650, y: 538 },
  { text: "8:10 - 8:55", x: 107, y: 489 },
  { text: "Pa", x: 33, y: 428 },
  { text: "Sa", x: 33, y: 337 },
  { text: "Ça", x: 32, y: 246 },
  { text: "Pe", x: 33, y: 155 },
  { text: "Cu", x: 32, y: 64 },
  { text: "Japonca II", x: 441, y: 463 },
  { text: "301", x: 439, y: 458 },
  { text: "Japonca Öğretim Üyesi", x: 457, y: 458 },
  { text: "Rusça II", x: 451, y: 432 },
  { text: "105", x: 439, y: 428 },
  { text: "Ruşça Öğretim Elemanı", x: 455, y: 428 },
  { text: "Almanca II - A", x: 442, y: 404 },
  { text: "101", x: 439, y: 398 },
  { text: "Metin Gülel", x: 500, y: 398 },
  { text: "Arkeoloji", x: 279, y: 432 },
  { text: "103", x: 269, y: 401 },
  { text: "Serkan TÜRKMEN", x: 304, y: 401 },
  { text: "İngilizce II", x: 581, y: 455 },
  { text: "105", x: 555, y: 444 },
  { text: "İng. Öğr. Elm.", x: 658, y: 444 },
  { text: "Mesleki İngilizce", x: 560, y: 421 },
  { text: "II", x: 624, y: 400 },
  { text: "106", x: 555, y: 398 },
  { text: "M. İng. Öğr. Elm.", x: 647, y: 398 },
] as const;

const teacherScheduleItems = [
  { text: "Öğretmen Sinan GÖKDEMİR", x: 211, y: 554 },
  { text: "8:10 - 8:55", x: 107, y: 489 },
  { text: "Pa", x: 33, y: 428 },
  { text: "Sa", x: 33, y: 337 },
  { text: "Ça", x: 32, y: 246 },
  { text: "Pe", x: 33, y: 155 },
  { text: "Cu", x: 32, y: 64 },
  { text: "Çanakkale'nin Yerel Değerleri", x: 156, y: 200 },
  { text: "Seyahat 3", x: 159, y: 159 },
  { text: "102", x: 244, y: 200 },
  { text: "Turizm Rehberliği", x: 269, y: 200 },
  { text: "Seyahat 2", x: 272, y: 159 },
  { text: "105", x: 358, y: 200 },
  { text: "Türk Tarihi ve Kültürü", x: 439, y: 200 },
  { text: "Seyahat 3", x: 442, y: 159 },
  { text: "102", x: 528, y: 200 },
] as const;

const teacherMergedRoomItems = [
  { text: "Öğretmen Yavuz ERDİHAN", x: 223, y: 554 },
  { text: "8:10 - 8:55", x: 107, y: 489 },
  { text: "Pa", x: 33, y: 428 },
  { text: "Sa", x: 33, y: 337 },
  { text: "Ça", x: 32, y: 246 },
  { text: "Pe", x: 33, y: 155 },
  { text: "Cu", x: 32, y: 64 },
  { text: "Roma ve Bizans Sanatı 103", x: 439, y: 291 },
  { text: "Seyahat 3", x: 442, y: 250 },
] as const;

const teacherMixedRoomItems = [
  { text: "Öğretmen Durgut ERDİM", x: 240, y: 554 },
  { text: "8:10 - 8:55", x: 107, y: 489 },
  { text: "Pa", x: 33, y: 428 },
  { text: "Sa", x: 33, y: 337 },
  { text: "Ça", x: 32, y: 246 },
  { text: "Pe", x: 33, y: 155 },
  { text: "Cu", x: 32, y: 64 },
  { text: "Satış İlkeleri ve Yönetimi101", x: 552, y: 474 },
  { text: "Seyahat 4", x: 555, y: 432 },
  { text: "Turizmde Halkla İlişkiler 102", x: 439, y: 291 },
  { text: "Girişimcilik", x: 552, y: 291 },
  { text: "101", x: 641, y: 291 },
  { text: "Seyahat 4", x: 442, y: 250 },
  { text: "Seyahat 3", x: 555, y: 250 },
] as const;

const teacherNoiseItems = [
  { text: "Öğretmen Tülay TÜTENOCAKLI", x: 188, y: 554 },
  { text: "8:10 - 8:55", x: 107, y: 489 },
  { text: "Pa", x: 33, y: 428 },
  { text: "Sa", x: 33, y: 337 },
  { text: "Ça", x: 32, y: 246 },
  { text: "Pe", x: 33, y: 155 },
  { text: "Cu", x: 32, y: 64 },
  { text: "TFVFa", x: 269, y: 109 },
  { text: "102", x: 358, y: 109 },
  { text: "Seyahat 3", x: 272, y: 68 },
  { text: "Grup A", x: 307, y: 36 },
] as const;

const crowdedRoomScheduleItems = [
  { text: "Seyahat 4", x: 344, y: 554 },
  { text: "101, 102, 103, Lab, 105, 106, 301, 302, 303", x: 650, y: 538 },
  { text: "8:10 - 8:55", x: 107, y: 489 },
  { text: "Pa", x: 33, y: 428 },
  { text: "Sa", x: 33, y: 337 },
  { text: "Ça", x: 32, y: 246 },
  { text: "Pe", x: 33, y: 155 },
  { text: "Cu", x: 32, y: 64 },
  { text: "Sosyal", x: 459, y: 465 },
  { text: "Davranış ve", x: 437, y: 444 },
  { text: "Protokol", x: 452, y: 423 },
  { text: "302", x: 439, y: 401 },
  { text: "Kuralları", x: 455, y: 401 },
  { text: "Şefik Okan Mercan", x: 473, y: 401 },
  { text: "Satış", x: 576, y: 456 },
  { text: "İlkeleri ve", x: 555, y: 432 },
  { text: "Yönetimi", x: 562, y: 409 },
  { text: "101", x: 552, y: 401 },
  { text: "D", x: 648, y: 401 },
  { text: "Almanca VIII", x: 444, y: 374 },
  { text: "101", x: 439, y: 367 },
  { text: "Metin Gülel", x: 500, y: 367 },
  { text: "Tur Opera", x: 555, y: 353 },
  { text: "törlüğü", x: 571, y: 330 },
  { text: "105", x: 552, y: 309 },
  { text: "Lütfi Atay", x: 621, y: 309 },
] as const;

describe("pdf grid extraction", () => {
  it("infers class year from Seyahat labels", () => {
    expect(__testables.inferClassYear("Seyahat 3")).toBe("3.S");
  });

  it("extracts class schedule pages into structured rows", () => {
    const text = __testables.extractGridPageFromItems([...roomScheduleItems]);

    expect(text).toContain("Sınıf | Ders | Öğretim Üyesi | Derslik");
    expect(text).toContain("Seyahat 1 | Japonca II | Japonca Öğretim Üyesi | 301");
    expect(text).toContain("Seyahat 1 | Almanca II - A | Metin Gülel | 101");
    expect(text).toContain("Seyahat 1 | Arkeoloji | Serkan TÜRKMEN | 103");
    expect(text).toContain("Seyahat 1 | Mesleki İngilizce II | M. İng. Öğr. Elm. | 106");
  });

  it("extracts teacher schedule pages with nearby class hints", () => {
    const text = __testables.extractGridPageFromItems([...teacherScheduleItems]);

    expect(text).toContain("Sınıf | Ders | Öğretim Üyesi | Derslik");
    expect(text).toContain("Seyahat 3 | Çanakkale'nin Yerel Değerleri | Sinan GÖKDEMİR | 102");
    expect(text).toContain("Seyahat 2 | Turizm Rehberliği | Sinan GÖKDEMİR | 105");
    expect(text).toContain("Seyahat 3 | Türk Tarihi ve Kültürü | Sinan GÖKDEMİR | 102");
  });

  it("extracts teacher rows when course and room are merged into one text item", () => {
    const text = __testables.extractGridPageFromItems([...teacherMergedRoomItems]);

    expect(text).toContain("Seyahat 3 | Roma ve Bizans Sanatı | Yavuz ERDİHAN | 103");
  });

  it("extracts teacher rows with mixed merged and split room anchors", () => {
    const text = __testables.extractGridPageFromItems([...teacherMixedRoomItems]);

    expect(text).toContain("Seyahat 4 | Satış İlkeleri ve Yönetimi | Durgut ERDİM | 101");
    expect(text).toContain("Seyahat 4 | Turizmde Halkla İlişkiler | Durgut ERDİM | 102");
    expect(text).toContain("Seyahat 3 | Girişimcilik | Durgut ERDİM | 101");
  });

  it("skips teacher-page group placeholders that are not real courses", () => {
    const text = __testables.extractGridPageFromItems([...teacherNoiseItems]);

    expect(text).toBeNull();
  });

  it("keeps crowded room rows from leaking into neighboring cells", () => {
    const text = __testables.extractGridPageFromItems([...crowdedRoomScheduleItems]);

    expect(text).toContain("Seyahat 4 | Sosyal Davranış ve Protokol Kuralları | Şefik Okan Mercan | 302");
    expect(text).toContain("Seyahat 4 | Satış İlkeleri ve Yönetimi | - | 101");
    expect(text).toContain("Seyahat 4 | Almanca VIII | Metin Gülel | 101");
    expect(text).toContain("Seyahat 4 | Tur Operatörlüğü | Lütfi Atay | 105");
    expect(text).not.toContain("Metin Gülel Tur Operatörlüğü");
  });
});
