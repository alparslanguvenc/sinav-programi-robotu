import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../App";
import { UNOFFERED_SLOT_KEY } from "../lib/schedule";
import { useScheduleStore } from "../store/scheduleStore";
import { loadFixtureDocument } from "./fixture";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("app shell", () => {
  it("opens the inspector when a card is selected and lets the user edit it", () => {
    useScheduleStore.getState().resetForTests(loadFixtureDocument());

    const { container } = render(<AppShell sampleUrl={null} bootstrapFromStorage={false} />);

    const archaeologyCard = container.querySelector('[data-course-name="Arkeoloji"]') as HTMLButtonElement;
    fireEvent.click(archaeologyCard);
    expect(screen.getByDisplayValue("Arkeoloji")).toBeInTheDocument();
    expect(archaeologyCard.textContent).toContain("1.Sınıf");
    expect(archaeologyCard.textContent).toContain("102-103");

    const parallelGroupInput = screen.getByLabelText("Paralel grup");
    fireEvent.change(parallelGroupInput, { target: { value: "dil-1" } });

    expect(screen.getByDisplayValue("dil-1")).toBeInTheDocument();

    const classInput = screen.getByLabelText("Sınıf");
    fireEvent.change(classInput, { target: { value: "Hazırlık Grubu" } });
    expect(screen.getByDisplayValue("Hazırlık Grubu")).toBeInTheDocument();

    const locationInput = screen.getByLabelText("Derslik / Açıklama");
    fireEvent.change(locationInput, { target: { value: "Hoca ile gorusulecek" } });

    expect(screen.getByDisplayValue("Hoca ile gorusulecek")).toBeInTheDocument();
    expect(archaeologyCard.textContent).toContain("Hazırlık Grubu");
    expect(archaeologyCard.textContent).toContain("Hoca ile gorusulecek");

    const updatedExam = useScheduleStore
      .getState()
      .document?.exams.find((exam) => exam.courseName === "Arkeoloji");

    expect(updatedExam?.classYear).toBe("Hazırlık Grubu");
    expect(updatedExam?.locationText).toBe("Hoca ile gorusulecek");
  });

  it("adds new cards to the unassigned pool and can undo the last move", () => {
    useScheduleStore.getState().resetForTests(loadFixtureDocument());

    const { container } = render(<AppShell sampleUrl={null} bootstrapFromStorage={false} />);

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
    const { container } = render(<AppShell sampleUrl={null} bootstrapFromStorage={false} />);

    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Saat bloğu ekle",
      ) as HTMLButtonElement,
    );

    expect(container.textContent).toContain("17:00");
    expect(useScheduleStore.getState().document?.template.times).toContain("17:00");
  });

  it("shows class schedule list in the view area and switches views from it", () => {
    useScheduleStore.getState().resetForTests(loadFixtureDocument());
    const { container } = render(<AppShell sampleUrl={null} bootstrapFromStorage={false} />);

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
      courseName: "Eski Dönem Seçmeli",
      slotKey: UNOFFERED_SLOT_KEY,
      rooms: ["Öğrenci ile belirlenecek"],
      locationText: "Öğrenci ile belirlenecek",
      parallelGroupId: null,
      notes: null,
    });
    useScheduleStore.getState().resetForTests(document);

    const { container } = render(<AppShell sampleUrl={null} bootstrapFromStorage={false} />);
    const unofferedCell = container.querySelector('[data-slot-key="__unoffered__"]');

    expect(container.textContent).toContain("Açılmayan Dersler");
    expect(unofferedCell?.textContent).toContain("Eski Dönem Seçmeli");

    fireEvent.click(container.querySelector('[data-view-id="class:3.S"]') as HTMLButtonElement);

    expect(useScheduleStore.getState().activeViewId).toBe("class:3.S");
    expect(container.querySelector('[data-slot-key="__unoffered__"]')?.textContent).toContain(
      "Eski Dönem Seçmeli",
    );
  });

  it("saves named records and restores them from the record list after reopen", () => {
    useScheduleStore.getState().resetForTests(loadFixtureDocument());
    vi.spyOn(window, "prompt")
      .mockReturnValueOnce("Taslak A")
      .mockReturnValueOnce("Taslak B");

    const { container, unmount } = render(<AppShell sampleUrl={null} bootstrapFromStorage={false} />);
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Kaydet",
    ) as HTMLButtonElement;

    fireEvent.click(saveButton);

    const recordsSelect = container.querySelector('select[aria-label="Kayıtlar"]') as HTMLSelectElement;
    expect(Array.from(recordsSelect.options).some((option) => option.text === "Taslak A")).toBe(true);

    const archaeologyCard = container.querySelector('[data-course-name="Arkeoloji"]') as HTMLButtonElement;
    fireEvent.click(archaeologyCard);
    fireEvent.change(container.querySelector(".inspector input") as HTMLInputElement, {
      target: { value: "Arkeoloji Taslak B" },
    });
    fireEvent.click(saveButton);

    expect(Array.from(recordsSelect.options).some((option) => option.text === "Taslak B")).toBe(true);

    const firstRecordId = useScheduleStore
      .getState()
      .savedRecords.find((record) => record.name === "Taslak A")?.id as string;

    fireEvent.change(recordsSelect, { target: { value: firstRecordId } });

    expect(container.querySelector('[data-course-name="Arkeoloji"]')).toBeInTheDocument();
    expect(container.querySelector('[data-course-name="Arkeoloji Taslak B"]')).not.toBeInTheDocument();
    expect(
      useScheduleStore.getState().document?.exams.some((exam) => exam.courseName === "Arkeoloji"),
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

    render(<AppShell sampleUrl={null} bootstrapFromStorage />);

    const reopenedRecordsSelect = document.body.querySelector(
      'select[aria-label="Kayıtlar"]',
    ) as HTMLSelectElement;
    expect(Array.from(reopenedRecordsSelect.options).some((option) => option.text === "Taslak A")).toBe(
      true,
    );
    expect(Array.from(reopenedRecordsSelect.options).some((option) => option.text === "Taslak B")).toBe(
      true,
    );
  });

  it("shows the attribution banner and lets the user save a school profile", () => {
    useScheduleStore.getState().resetForTests(null);

    const { container } = render(<AppShell sampleUrl={null} bootstrapFromStorage={false} />);
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

    fireEvent.change(currentRender.getByLabelText("Profil adı"), {
      target: { value: "İletişim Fakültesi" },
    });
    fireEvent.change(currentRender.getByLabelText("Tarihler"), {
      target: { value: "Pzt 23.03.2026\nSal 24.03.2026" },
    });
    fireEvent.change(currentRender.getByLabelText("Saatler"), {
      target: { value: "09:00\n11:00" },
    });
    fireEvent.change(currentRender.getByLabelText("Sınıflar"), {
      target: { value: "1.S\n2.S" },
    });
    fireEvent.change(currentRender.getByLabelText("Ders şablonları"), {
      target: {
        value: "1.S | Arkeoloji | Dr. Ayşe Kaya | 102-103\n2.S | Medya Yönetimi | Öğr. Gör. Ali Demir | 104",
      },
    });

    fireEvent.click(currentRender.getByText("Profili kaydet"));

    expect(useScheduleStore.getState().profiles).toHaveLength(1);
    expect(useScheduleStore.getState().profiles[0]?.name).toBe("İletişim Fakültesi");

    const profileSelect = container.querySelector('select[aria-label="Okul profili"]') as HTMLSelectElement;
    expect(Array.from(profileSelect.options).some((option) => option.text.includes("İletişim Fakültesi"))).toBe(
      true,
    );
  });
});
