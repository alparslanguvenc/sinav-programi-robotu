import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { AppShell } from "../App";
import * as sourceImport from "../lib/source-import";
import { UNOFFERED_SLOT_KEY } from "../lib/schedule";
import { useScheduleStore } from "../store/scheduleStore";
import { loadFixtureDocument } from "./fixture";
import type { SchoolProfile } from "../types/schedule";

afterEach(() => {
  vi.restoreAllMocks();
  delete window.sinavProgramiRobotu;
});

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

const buildTestProfile = (): SchoolProfile => ({
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
});

describe("app shell", () => {
  it("opens the inspector when a card is selected and lets the user edit it", () => {
    useScheduleStore.getState().resetForTests(loadFixtureDocument());

    const { container } = render(<AppShell bootstrapFromStorage={false} />);

    const archaeologyCard = container.querySelector('[data-course-name="Arkeoloji"]') as HTMLButtonElement;
    fireEvent.click(archaeologyCard);
    expect(screen.getByDisplayValue("Arkeoloji")).toBeInTheDocument();
    expect(archaeologyCard.textContent).toContain("1. Sınıf");
    expect(archaeologyCard.textContent).toContain("102-103");
    const classBadge = archaeologyCard.querySelector(".exam-card__class-badge") as HTMLSpanElement;
    expect(classBadge).toBeInTheDocument();
    expect(classBadge.style.backgroundColor).not.toBe("");
    expect(classBadge.style.borderColor).not.toBe("");

    const parallelGroupInput = screen.getByLabelText("Paralel grup");
    fireEvent.change(parallelGroupInput, { target: { value: "dil-1" } });

    expect(screen.getByDisplayValue("dil-1")).toBeInTheDocument();

    const programsInput = screen.getByLabelText("Bölüm / Programlar");
    fireEvent.change(programsInput, { target: { value: "Gazetecilik, Halkla İlişkiler" } });

    const classInput = screen.getByLabelText("Sınıf");
    fireEvent.change(classInput, { target: { value: "Hazırlık Grubu" } });
    expect(screen.getByDisplayValue("Hazırlık Grubu")).toBeInTheDocument();

    const locationInput = screen.getByLabelText("Derslik / Açıklama");
    fireEvent.change(locationInput, { target: { value: "Hoca ile gorusulecek" } });

    expect(screen.getByDisplayValue("Hoca ile gorusulecek")).toBeInTheDocument();
    expect(archaeologyCard.textContent).toContain("Hazırlık Grubu");
    expect(archaeologyCard.textContent).toContain("Gazetecilik, Halkla İlişkiler");
    expect(archaeologyCard.textContent).toContain("Hoca ile gorusulecek");

    const updatedExam = useScheduleStore
      .getState()
      .document?.exams.find((exam) => exam.courseName === "Arkeoloji");

    expect(updatedExam?.classYear).toBe("Hazırlık Grubu");
    expect(updatedExam?.programs).toEqual(["Gazetecilik", "Halkla İlişkiler"]);
    expect(updatedExam?.locationText).toBe("Hoca ile gorusulecek");
  });

  it("adds new cards to the unassigned pool and can undo the last move", () => {
    useScheduleStore.getState().resetForTests(loadFixtureDocument());

    const { container } = render(<AppShell bootstrapFromStorage={false} />);

    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Yeni kart") as HTMLButtonElement,
    );
    expect(container.textContent).toContain("Yerleştirilmeyen Kartlar");
    expect(container.querySelector('[data-course-name="Yeni Sınav"]')).toBeInTheDocument();

    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Geri al") as HTMLButtonElement,
    );
    expect(container.querySelector('[data-course-name="Yeni Sınav"]')).not.toBeInTheDocument();
  });

  it("adds a new time block from the toolbar", () => {
    vi.spyOn(window, "prompt").mockReturnValue("17:00");
    useScheduleStore.getState().resetForTests(loadFixtureDocument());
    const { container } = render(<AppShell bootstrapFromStorage={false} />);

    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Saat ekle",
      ) as HTMLButtonElement,
    );

    expect(container.textContent).toContain("17:00");
    expect(useScheduleStore.getState().document?.template.times).toContain("17:00");
  });

  it("shows class schedule list in the view area and switches views from it", () => {
    useScheduleStore.getState().resetForTests(loadFixtureDocument());
    const { container } = render(<AppShell bootstrapFromStorage={false} />);

    const secondClassView = container.querySelector('[data-view-id="class:2.S"]') as HTMLButtonElement;

    expect(secondClassView).toBeInTheDocument();
    expect(secondClassView.textContent).toContain("2. Sınıf");

    fireEvent.click(secondClassView);

    expect(useScheduleStore.getState().activeViewId).toBe("class:2.S");
    expect(container.querySelector('[data-course-name="Arkeoloji"]')).not.toBeInTheDocument();
  });

  it("renders the unopened-course row in general and class views", () => {
    const document = loadFixtureDocument();
    document.exams.push({
      id: "unoffered-row-card",
      classYear: "3.S",
      programs: ["Radyo TV"],
      courseName: "Eski Dönem Seçmeli",
      slotKey: UNOFFERED_SLOT_KEY,
      rooms: ["Öğrenci ile belirlenecek"],
      locationText: "Öğrenci ile belirlenecek",
      parallelGroupId: null,
      notes: null,
    });
    useScheduleStore.getState().resetForTests(document);

    const { container } = render(<AppShell bootstrapFromStorage={false} />);
    const unofferedCell = container.querySelector('[data-slot-key="__unoffered__"]');

    expect(container.textContent).toContain("Açılmayan Dersler");
    expect(unofferedCell?.textContent).toContain("Eski Dönem Seçmeli");

    fireEvent.click(container.querySelector('[data-view-id="class:3.S"]') as HTMLButtonElement);

    expect(useScheduleStore.getState().activeViewId).toBe("class:3.S");
    expect(container.querySelector('[data-slot-key="__unoffered__"]')?.textContent).toContain(
      "Eski Dönem Seçmeli",
    );
  });

  it("saves records without relying on prompt and restores them from the record list after reopen", async () => {
    const fixtureDocument = loadFixtureDocument();
    const expectedRecordName = fixtureDocument.sourceMeta.generalTitle ?? "Vize Programı 1";

    useScheduleStore.getState().resetForTests(fixtureDocument);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const readSync = vi.fn(() => ({}));
    const writeSync = vi.fn(() => ({ ok: true }));
    window.sinavProgramiRobotu = {
      storage: {
        readSync,
        writeSync,
      },
    };

    const { container, unmount } = render(<AppShell bootstrapFromStorage={false} />);
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Kaydet",
    ) as HTMLButtonElement;

    fireEvent.click(saveButton);
    expect(alertSpy).toHaveBeenCalledWith(`${expectedRecordName} kaydı oluşturuldu.`);
    expect(writeSync).toHaveBeenCalled();
    expect(
      writeSync.mock.calls.some(
        ([payload]) =>
          typeof payload === "object" &&
          payload !== null &&
          Array.isArray((payload as { savedRecords?: unknown[] }).savedRecords) &&
          ((payload as { savedRecords?: Array<{ name: string }> }).savedRecords?.some(
            (record) => record.name === expectedRecordName,
          ) ?? false),
      ),
    ).toBe(true);

    const recordsSelect = container.querySelector('select[aria-label="Kayıtlar"]') as HTMLSelectElement;
    expect(Array.from(recordsSelect.options).some((option) => option.text === expectedRecordName)).toBe(true);

    const archaeologyCard = container.querySelector('[data-course-name="Arkeoloji"]') as HTMLButtonElement;
    fireEvent.click(archaeologyCard);
    fireEvent.change(container.querySelector(".inspector input") as HTMLInputElement, {
      target: { value: "Arkeoloji Taslak B" },
    });
    fireEvent.click(saveButton);
    expect(alertSpy).toHaveBeenCalledWith(`${expectedRecordName} kaydı güncellendi.`);

    expect(
      useScheduleStore.getState().savedRecords.filter((record) => record.name === expectedRecordName),
    ).toHaveLength(1);

    const firstRecordId = useScheduleStore
      .getState()
      .savedRecords.find((record) => record.name === expectedRecordName)?.id as string;

    fireEvent.change(recordsSelect, { target: { value: firstRecordId } });

    expect(container.querySelector('[data-course-name="Arkeoloji"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-course-name="Arkeoloji Taslak B"]')).toBeInTheDocument();
    expect(
      useScheduleStore.getState().document?.exams.some((exam) => exam.courseName === "Arkeoloji Taslak B"),
    ).toBe(true);

    unmount();
    useScheduleStore.setState({
      document: null,
      history: [],
      savedRecords: [],
      activeSavedRecordId: null,
      activeViewId: "genel",
      selectedCardId: null,
      conflictsOpen: true,
      uiScale: "normal",
    });

    render(<AppShell bootstrapFromStorage />);

    await waitFor(() => {
      const reopenedRecordsSelect = document.body.querySelector(
        'select[aria-label="Kayıtlar"]',
      ) as HTMLSelectElement;
      expect(Array.from(reopenedRecordsSelect.options).some((option) => option.text === expectedRecordName)).toBe(
        true,
      );
    });

    const reopenedRecordsSelect = document.body.querySelector(
      'select[aria-label="Kayıtlar"]',
    ) as HTMLSelectElement;
    const reopenedRecordId = Array.from(reopenedRecordsSelect.options).find(
      (option) => option.text === expectedRecordName,
    )?.value as string;

    fireEvent.change(reopenedRecordsSelect, { target: { value: reopenedRecordId } });

    expect(
      useScheduleStore.getState().document?.exams.some((exam) => exam.courseName === "Arkeoloji Taslak B"),
    ).toBe(true);
  });

  it("hydrates saved records from the desktop backup store when local storage is empty", async () => {
    const backupDocument = loadFixtureDocument();
    const backupRecordId = "backup-record-1";

    window.sinavProgramiRobotu = {
      storage: {
        readSync: vi.fn(() => ({
          version: 1,
          savedRecords: [
            {
              id: backupRecordId,
              name: "Kalıcı Kayıt",
              updatedAt: new Date().toISOString(),
              document: backupDocument,
            },
          ],
          activeSavedRecordId: backupRecordId,
        })),
        writeSync: vi.fn(() => ({ ok: true })),
      },
    };

    useScheduleStore.getState().resetForTests(null);

    const { container } = render(<AppShell />);

    await waitFor(() => {
      const recordsSelect = container.querySelector('select[aria-label="Kayıtlar"]') as HTMLSelectElement;
      expect(Array.from(recordsSelect.options).some((option) => option.text === "Kalıcı Kayıt")).toBe(true);
      expect(recordsSelect.value).toBe(backupRecordId);
    });
  });

  it("shows the attribution banner and lets the user save a school profile", () => {
    useScheduleStore.getState().resetForTests(null);

    const { container } = render(<AppShell bootstrapFromStorage={false} />);
    const currentRender = within(container);

    expect(
      screen.getAllByText(
        /bu program tüm sınav koordinatörlerinin işlerini kolaylaştırmak için ALPARSLAN GÜVENÇ/i,
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("LinkedIn")[0]).toHaveAttribute(
      "href",
      "https://www.linkedin.com/in/alparslanguvenc/",
    );
    expect(screen.getAllByLabelText("ORCID")[0]).toHaveAttribute(
      "href",
      "https://orcid.org/0000-0002-6195-0654",
    );
    expect(screen.getAllByLabelText("X")[0]).toHaveAttribute("href", "https://x.com/AlparslanGvnc");

    // Step 0: Temel bilgiler
    fireEvent.change(currentRender.getByLabelText("Profil adı"), {
      target: { value: "İletişim Fakültesi" },
    });
    fireEvent.change(currentRender.getByLabelText("Sınav tarihleri"), {
      target: { value: "Pzt 23.03.2026\nSal 24.03.2026" },
    });
    fireEvent.change(currentRender.getByLabelText("Saatler"), {
      target: { value: "09:00\n11:00" },
    });

    // Navigate to Step 1: Bölümler
    fireEvent.click(currentRender.getByText("İleri →"));

    // Add programs via chip interface
    const programInput = currentRender.getByPlaceholderText("örn. Gazetecilik");
    fireEvent.change(programInput, { target: { value: "Gazetecilik" } });
    fireEvent.click(currentRender.getAllByText("Ekle")[0]);

    fireEvent.change(programInput, { target: { value: "Radyo TV" } });
    fireEvent.click(currentRender.getAllByText("Ekle")[0]);

    // Save profile (button is always visible)
    fireEvent.click(currentRender.getByText("Profili Kaydet"));

    expect(useScheduleStore.getState().profiles).toHaveLength(1);
    expect(useScheduleStore.getState().profiles[0]?.name).toBe("İletişim Fakültesi");
    expect(useScheduleStore.getState().profiles[0]?.programs).toEqual(["Gazetecilik", "Radyo TV"]);

    const profileSelect = container.querySelector('select[aria-label="Okul profili"]') as HTMLSelectElement;
    expect(Array.from(profileSelect.options).some((option) => option.text.includes("İletişim Fakültesi"))).toBe(
      true,
    );
  });

  it("uses unsaved draft times when regenerating from the right panel", async () => {
    const document = loadFixtureDocument();
    useScheduleStore.getState().resetForTests(document);
    useScheduleStore.getState().saveProfile(buildTestProfile());

    const { container } = render(<AppShell bootstrapFromStorage={false} />);
    const currentRender = within(container);

    fireEvent.change(currentRender.getByLabelText("Saatler"), {
      target: { value: "10:00\n14:00" },
    });

    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Yeniden oluştur",
      ) as HTMLButtonElement,
    );

    await waitFor(() => {
      expect(useScheduleStore.getState().document?.template.times).toEqual(["10:00", "14:00"]);
    });
  });

  it("uses unsaved draft times while importing a workbook", async () => {
    useScheduleStore.getState().resetForTests(null);
    useScheduleStore.getState().saveProfile(buildTestProfile());

    const { container } = render(<AppShell bootstrapFromStorage={false} />);
    const currentRender = within(container);

    fireEvent.change(currentRender.getByLabelText("Saatler"), {
      target: { value: "10:00\n14:00" },
    });

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = buildGenericWorkbookFile();
    fireEvent.change(input, { target: { files: [file] } });

    await screen.findByText(/otomatik sınav taslağı üretildi/i);

    expect(useScheduleStore.getState().document?.template.times).toEqual(["10:00", "14:00"]);
  });

  it("passes toolbar instructions into regenerate scheduling", async () => {
    const document = loadFixtureDocument();
    const instruction = "İngilizce sınavı son gün olsun.";
    const buildSpy = vi.spyOn(sourceImport, "buildAutoScheduleDocumentWithAI").mockResolvedValue({
      document,
      instructionAiStatus: { used: true, error: null, provider: "Groq" },
    });

    useScheduleStore.getState().resetForTests(document);

    const { container } = render(<AppShell bootstrapFromStorage={false} />);
    const currentRender = within(container);

    fireEvent.click(currentRender.getByText(/AI'ya talimat ver|AI talimatı var/i));
    fireEvent.change(currentRender.getByLabelText("AI talimatı"), {
      target: { value: instruction },
    });

    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Yeniden oluştur",
      ) as HTMLButtonElement,
    );

    await waitFor(() => expect(buildSpy).toHaveBeenCalled());
    const lastCall = buildSpy.mock.calls.at(-1);
    expect(lastCall?.[2]?.userInstructions).toBe(instruction);
    expect(lastCall?.[2]?.useAI).toBe(true);
    expect(currentRender.getByText(/Talimat uygulandı/i)).toBeInTheDocument();
  });

  it("passes toolbar instructions into file import", async () => {
    const instruction = "Almanca sınavları 14.05.2026 tarihinde olsun.";
    const importSpy = vi.spyOn(sourceImport, "importScheduleFromFile").mockResolvedValue({
      document: loadFixtureDocument(),
      mode: "auto-generated",
      message: "PDF içeriğinden otomatik sınav taslağı üretildi.",
      aiStatus: { used: false, seedCount: 0, error: null },
    });

    useScheduleStore.getState().resetForTests(null);

    const { container } = render(<AppShell bootstrapFromStorage={false} />);
    const currentRender = within(container);

    fireEvent.click(currentRender.getByText(/AI'ya talimat ver|AI talimatı var/i));
    fireEvent.change(currentRender.getByLabelText("AI talimatı"), {
      target: { value: instruction },
    });

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = buildGenericWorkbookFile();
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(importSpy).toHaveBeenCalled());
    const lastCall = importSpy.mock.calls.at(-1);
    expect(lastCall?.[1]?.userInstructions).toBe(instruction);
    expect(currentRender.getByText(/Talimat uygulandı/i)).toBeInTheDocument();
  });
});
