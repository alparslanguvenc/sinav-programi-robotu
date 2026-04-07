import {
  DndContext,
  DragOverlay,
  MouseSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import "./App.css";
import { AttributionBanner } from "./components/AttributionBanner";
import { ConflictList } from "./components/ConflictList";
import { ContextMenu } from "./components/ContextMenu";
import type { ContextMenuState } from "./components/ContextMenu";
import { ExamCardPreview } from "./components/ExamCardView";
import { InspectorPanel } from "./components/InspectorPanel";
import { ProfilePanel } from "./components/ProfilePanel";
import { ScheduleBoard } from "./components/ScheduleBoard";
import { Toolbar } from "./components/Toolbar";
import { UnassignedPanel } from "./components/UnassignedPanel";
import { downloadBlob } from "./lib/browser";
import { createConflictIndex, detectConflicts } from "./lib/conflicts";
import {
  buildAutoScheduleDocumentWithAI,
  importScheduleFromFile,
  extractCourseSeeds,
} from "./lib/source-import";
import {
  UI_SCALE_VALUES,
  getActiveViewClassYear,
  isUnofferedSlot,
  isUnassignedSlot,
} from "./lib/schedule";
import { exportWorkbookArrayBuffer } from "./lib/xlsx-export";
import { useScheduleStore } from "./store/scheduleStore";
import type { ExamCard, ScheduleDocument, SchoolProfile } from "./types/schedule";

type StatusBanner = {
  tone: "info" | "error";
  message: string;
};

interface AppProps {
  bootstrapFromStorage?: boolean;
}

const getDocumentFileStem = (document: ScheduleDocument | null) =>
  document?.sourceMeta.generalTitle
    ?.toLocaleLowerCase("tr")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "vize-programi";

const getSuggestedRecordName = (
  document: ScheduleDocument | null,
  activeRecordName: string | null,
  savedRecordCount: number,
) =>
  activeRecordName ??
  document?.sourceMeta.generalTitle?.trim() ??
  `Vize Programı ${savedRecordCount + 1}`;

const filterVisibleExams = (document: ScheduleDocument, activeViewId: string) => {
  // Program-prefixed view IDs filter by program name
  if (activeViewId.startsWith("program:")) {
    const program = activeViewId.slice("program:".length);
    return document.exams.filter((exam) =>
      exam.programs.some((p) => p.toLocaleLowerCase("tr") === program.toLocaleLowerCase("tr")),
    );
  }
  const activeView = document.template.views.find((view) => view.id === activeViewId);
  return activeView?.classYear
    ? document.exams.filter((exam) => exam.classYear === activeView.classYear)
    : document.exams;
};

export function AppShell({
  bootstrapFromStorage = true,
}: AppProps) {
  const document = useScheduleStore((state) => state.document);
  const historyCount = useScheduleStore((state) => state.history.length);
  const savedRecords = useScheduleStore((state) => state.savedRecords);
  const profiles = useScheduleStore((state) => state.profiles);
  const activeSavedRecordId = useScheduleStore((state) => state.activeSavedRecordId);
  const activeProfileId = useScheduleStore((state) => state.activeProfileId);
  const activeViewId = useScheduleStore((state) => state.activeViewId);
  const selectedCardId = useScheduleStore((state) => state.selectedCardId);
  const conflictsOpen = useScheduleStore((state) => state.conflictsOpen);
  const uiScale = useScheduleStore((state) => state.uiScale);
  const loadDocument = useScheduleStore((state) => state.loadDocument);
  const hydrateFromStorage = useScheduleStore((state) => state.hydrateFromStorage);
  const saveCurrentDocument = useScheduleStore((state) => state.saveCurrentDocument);
  const loadSavedRecord = useScheduleStore((state) => state.loadSavedRecord);
  const newDocument = useScheduleStore((state) => state.newDocument);
  const deleteSavedRecord = useScheduleStore((state) => state.deleteSavedRecord);
  const clearAllRecords = useScheduleStore((state) => state.clearAllRecords);
  const saveProfile = useScheduleStore((state) => state.saveProfile);
  const deleteProfile = useScheduleStore((state) => state.deleteProfile);
  const setActiveProfile = useScheduleStore((state) => state.setActiveProfile);
  const setActiveView = useScheduleStore((state) => state.setActiveView);
  const selectCard = useScheduleStore((state) => state.selectCard);
  const moveExam = useScheduleStore((state) => state.moveExam);
  const updateExam = useScheduleStore((state) => state.updateExam);
  const addExam = useScheduleStore((state) => state.addExam);
  const duplicateExam = useScheduleStore((state) => state.duplicateExam);
  const deleteExam = useScheduleStore((state) => state.deleteExam);
  const addTimeBlock = useScheduleStore((state) => state.addTimeBlock);
  const toggleConflicts = useScheduleStore((state) => state.toggleConflicts);
  const undo = useScheduleStore((state) => state.undo);
  const setUiScale = useScheduleStore((state) => state.setUiScale);
  const sourceInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);
  const [status, setStatus] = useState<StatusBanner | null>(null);
  const [activeDraggedExam, setActiveDraggedExam] = useState<ExamCard | null>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [draftProfile, setDraftProfile] = useState<SchoolProfile | null>(null);
  const [useAI, setUseAI] = useState(true);
  const [userPrompt, setUserPrompt] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
  );

  useEffect(() => {
    if (bootstrapFromStorage) {
      hydrateFromStorage();
    }
    setBooting(false);
  }, [bootstrapFromStorage, hydrateFromStorage]);

  useEffect(() => {
    if (!status) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setStatus(null);
    }, 4500);

    return () => window.clearTimeout(timeoutId);
  }, [status]);

  useEffect(() => {
    if (document && !document.template.views.some((view) => view.id === activeViewId)) {
      setActiveView("genel");
    }
  }, [activeViewId, document, setActiveView]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((!event.metaKey && !event.ctrlKey) || event.shiftKey || event.altKey || event.key !== "z") {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }

      if (historyCount === 0) {
        return;
      }

      event.preventDefault();
      undo();
      setStatus({
        tone: "info",
        message: "Son hamle geri alındı.",
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [historyCount, undo]);

  const deferredActiveViewId = useDeferredValue(activeViewId);
  const visibleExams = useMemo(
    () => (document ? filterVisibleExams(document, deferredActiveViewId) : []),
    [deferredActiveViewId, document],
  );
  const scheduledVisibleExams = useMemo(
    () =>
      visibleExams.filter(
        (exam) => !isUnassignedSlot(exam.slotKey) && !isUnofferedSlot(exam.slotKey),
      ),
    [visibleExams],
  );
  const unofferedVisibleExams = useMemo(
    () => visibleExams.filter((exam) => isUnofferedSlot(exam.slotKey)),
    [visibleExams],
  );
  const unassignedVisibleExams = useMemo(
    () => visibleExams.filter((exam) => isUnassignedSlot(exam.slotKey)),
    [visibleExams],
  );
  const activeSavedRecord = useMemo(
    () =>
      activeSavedRecordId
        ? savedRecords.find((record) => record.id === activeSavedRecordId) ?? null
        : null,
    [activeSavedRecordId, savedRecords],
  );
  const activeProfile = useMemo(
    () => (activeProfileId ? profiles.find((profile) => profile.id === activeProfileId) ?? null : null),
    [activeProfileId, profiles],
  );
  const planningProfile = useMemo(() => draftProfile ?? activeProfile, [activeProfile, draftProfile]);
  const visibleConflicts = useMemo(() => {
    if (!document) {
      return [];
    }

    const visibleIds = new Set(visibleExams.map((exam) => exam.id));
    return detectConflicts(document.exams, { profile: activeProfile }).filter((conflict) =>
      conflict.cardIds.some((cardId) => visibleIds.has(cardId)),
    );
  }, [document, visibleExams, activeProfile]);
  const { conflictedCardIds, conflictedSlotKeys } = useMemo(
    () => createConflictIndex(visibleConflicts),
    [visibleConflicts],
  );
  const examLookup = useMemo(
    () => new Map(document?.exams.map((exam) => [exam.id, exam]) ?? []),
    [document],
  );
  const selectedExam = selectedCardId ? examLookup.get(selectedCardId) ?? null : null;
  const classYearOptions = useMemo(
    () =>
      [
        ...new Set([
          ...(document
            ? document.template.views
                .map((view) => view.classYear)
                .filter((classYear): classYear is string => Boolean(classYear))
            : []),
          ...(activeProfile?.classYears ?? []),
        ]),
      ],
    [activeProfile?.classYears, document],
  );
  const savedRecordSummaries = useMemo(
    () =>
      savedRecords.map((record) => ({
        id: record.id,
        name: record.name,
        updatedAt: record.updatedAt,
      })),
    [savedRecords],
  );
  const profileSummaries = useMemo(
    () =>
      profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        courseCount: profile.courseTemplates.length,
      })),
    [profiles],
  );
  const viewSummaries = useMemo(() => {
    if (!document) {
      return [{ id: "genel", label: "Genel", classYear: null, examCount: 0 }];
    }

    const countsByClassYear = new Map<string, number>();
    const countsByProgram = new Map<string, number>();
    for (const exam of document.exams) {
      countsByClassYear.set(exam.classYear, (countsByClassYear.get(exam.classYear) ?? 0) + 1);
      for (const program of exam.programs) {
        const key = program.toLocaleLowerCase("tr");
        countsByProgram.set(key, (countsByProgram.get(key) ?? 0) + 1);
      }
    }

    const classYearViews = document.template.views.map((view) => ({
      ...view,
      examCount: view.classYear ? (countsByClassYear.get(view.classYear) ?? 0) : document.exams.length,
    }));

    // Dynamically add program views when there are multiple programs
    const allPrograms = [...countsByProgram.entries()]
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b, "tr"));

    if (allPrograms.length <= 1) {
      return classYearViews;
    }

    const programViews = allPrograms.map(([programLower, count]) => {
      // Find the original casing from any exam
      const originalName =
        document.exams
          .flatMap((exam) => exam.programs)
          .find((p) => p.toLocaleLowerCase("tr") === programLower) ?? programLower;
      return {
        id: `program:${programLower}`,
        label: originalName,
        classYear: null as string | null,
        examCount: count,
      };
    });

    return [...classYearViews, ...programViews];
  }, [document]);
  const activeProgramFilter = activeViewId.startsWith("program:")
    ? activeViewId.slice("program:".length)
    : null;

  const programOptions = useMemo(() => {
    const fromProfile = activeProfile?.programs ?? [];
    const fromExams = document
      ? [...new Set(document.exams.flatMap((e) => e.programs))]
      : [];
    return [...new Set([...fromProfile, ...fromExams])].sort((a, b) => a.localeCompare(b, "tr"));
  }, [activeProfile, document]);

  const shellStyle = useMemo(
    () =>
      ({
        "--ui-scale": `${UI_SCALE_VALUES[uiScale]}`,
        "--board-time-width": `calc(76px * ${UI_SCALE_VALUES[uiScale]})`,
        "--board-cell-min-width": `calc(154px * ${UI_SCALE_VALUES[uiScale]})`,
        "--board-cell-min-height": `calc(124px * ${UI_SCALE_VALUES[uiScale]})`,
        "--card-padding": `calc(10px * ${UI_SCALE_VALUES[uiScale]})`,
        "--sidebar-width": `calc(420px * ${UI_SCALE_VALUES[uiScale]})`,
      }) as CSSProperties,
    [uiScale],
  );

  const setDocumentFromFile = (nextDocument: ScheduleDocument, message: string) => {
    startTransition(() => loadDocument(nextDocument));
    setStatus({
      tone: "info",
      message,
    });
  };

  const handleSourceUpload = async (file: File) => {
    setBusy(true);
    const trimmedInstructions = userPrompt.trim();
    const hasInstructions = Boolean(trimmedInstructions);

    try {
      const result = await importScheduleFromFile(file, {
        profile: planningProfile,
        fallbackTemplate: document?.template ?? null,
        useAI,
        userInstructions: trimmedInstructions || undefined,
      });

      let message = `${result.message}${hasInstructions ? " Talimat uygulandı." : ""}`;

      if (hasInstructions && result.instructionAiStatus?.used) {
        message += ` ✓ ${result.instructionAiStatus.provider ?? "AI"} ile talimat yorumlandı.`;
      } else if (hasInstructions && result.instructionAiStatus?.error) {
        message += ` ⚠️ AI talimatı yorumlayamadı (${result.instructionAiStatus.error}), kural tabanlı talimat kullanıldı.`;
      }

      // AI denendi ama başarısız olduysa uyarı ver, kural tabanlı ile devam et
      if (result.aiStatus && !result.aiStatus.used && result.aiStatus.error) {
        setDocumentFromFile(
          result.document,
          `${message} ⚠️ AI analiz edemedi (${result.aiStatus.error}), kural tabanlı ayrıştırma kullanıldı.`,
        );
      } else {
        setDocumentFromFile(result.document, message);
      }
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Dosya okunamadı.",
      });
    } finally {
      setBusy(false);
    }
  };
  const handleSourceFileDrop = useEffectEvent((file: File) => {
    void handleSourceUpload(file);
  });

  useEffect(() => {
    const handleWindowDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) {
        return;
      }

      event.preventDefault();
      dragDepthRef.current += 1;
      setFileDragActive(true);
    };

    const handleWindowDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setFileDragActive(true);
    };

    const handleWindowDragLeave = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) {
        return;
      }

      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

      if (dragDepthRef.current === 0) {
        setFileDragActive(false);
      }
    };

    const handleWindowDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.files?.length) {
        return;
      }

      event.preventDefault();
      dragDepthRef.current = 0;
      setFileDragActive(false);
      const [file] = Array.from(event.dataTransfer.files);

      if (file) {
        handleSourceFileDrop(file);
      }
    };

    window.addEventListener("dragenter", handleWindowDragEnter);
    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("dragleave", handleWindowDragLeave);
    window.addEventListener("drop", handleWindowDrop);

    return () => {
      window.removeEventListener("dragenter", handleWindowDragEnter);
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("dragleave", handleWindowDragLeave);
      window.removeEventListener("drop", handleWindowDrop);
    };
  }, []);

  const handleSaveRecord = () => {
    if (!document) {
      return;
    }

    const result = saveCurrentDocument(
      getSuggestedRecordName(document, activeSavedRecord?.name ?? null, savedRecords.length),
    );
    setStatus({
      tone: result.ok ? "info" : "error",
      message: result.message,
    });

    if (result.ok) {
      window.alert(result.message);
    }
  };

  const handleSavedRecordChange = (savedRecordId: string) => {
    const result = loadSavedRecord(savedRecordId);
    setStatus({
      tone: result.ok ? "info" : "error",
      message: result.message,
    });
  };

  const handleNewDocument = () => {
    if (document) {
      const confirmed = window.confirm("Mevcut program kapatılacak. Kaydedilmemiş değişiklikler kaybolur. Devam edilsin mi?");
      if (!confirmed) return;
    }
    newDocument();
    setStatus({ tone: "info", message: "Yeni boş program oluşturuldu." });
  };

  const handleDeleteSavedRecord = (savedRecordId: string) => {
    const record = savedRecords.find((r) => r.id === savedRecordId);
    if (!record) return;
    const confirmed = window.confirm(`"${record.name}" kaydı silinsin mi? Bu işlem geri alınamaz.`);
    if (!confirmed) return;
    deleteSavedRecord(savedRecordId);
    setStatus({ tone: "info", message: `"${record.name}" kaydı silindi.` });
  };

  const handleExportExcel = () => {
    if (!document) {
      return;
    }

    downloadBlob(
      new Blob([exportWorkbookArrayBuffer(document)], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      `${getDocumentFileStem(document)}.xlsx`,
    );
    setStatus({
      tone: "info",
      message: "Excel çıktısı oluşturuldu.",
    });
  };

  const handleToolbarAddExam = () => {
    if (!document) {
      return;
    }

    addExam(undefined, getActiveViewClassYear(document, activeViewId));
    setStatus({
      tone: "info",
      message: "Yeni kart yerleştirilmeyenler havuzuna eklendi.",
    });
  };

  const handleDeleteExam = (cardId: string) => {
    deleteExam(cardId);
    setStatus({
      tone: "info",
      message: "Kart silindi.",
    });
  };

  const handleSelectConflictCard = (cardId: string) => {
    selectCard(cardId);
  };

  const handleUndo = () => {
    if (historyCount === 0) {
      return;
    }

    undo();
    setStatus({
      tone: "info",
      message: "Son hamle geri alındı.",
    });
  };

  const handleAddTimeBlock = () => {
    if (!document) {
      return;
    }

    const input = window.prompt("Yeni sınav saatini HH:MM biçiminde girin", "17:00");

    if (input === null) {
      return;
    }

    const result = addTimeBlock(input);
    setStatus({
      tone: result.ok ? "info" : "error",
      message: result.ok
        ? `${result.normalizedTime} saat bloğu eklendi.`
        : result.message,
    });
  };

  const handleRegenerate = async () => {
    if (!document) return;

    setBusy(true);
    const trimmedInstructions = userPrompt.trim();
    const seeds = extractCourseSeeds(document.exams);

    try {
      const result = await buildAutoScheduleDocumentWithAI(
        seeds,
        document.sourceMeta.sourceFileName ?? "program",
        {
          profile: planningProfile,
          fallbackTemplate: document.template,
          useAI,
          userInstructions: trimmedInstructions || undefined,
        },
      );

      startTransition(() => loadDocument(result.document));

      let message = `Program çakışmasız olarak yeniden oluşturuldu.${trimmedInstructions ? " Talimat uygulandı." : ""}`;

      if (trimmedInstructions && result.instructionAiStatus.used) {
        message += ` ✓ ${result.instructionAiStatus.provider ?? "AI"} ile talimat yorumlandı.`;
      } else if (trimmedInstructions && result.instructionAiStatus.error) {
        message += ` ⚠️ AI talimatı yorumlayamadı (${result.instructionAiStatus.error}), kural tabanlı talimat kullanıldı.`;
      }

      setStatus({
        tone: "info",
        message,
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Program yeniden oluşturulamadı.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleProgramFilterChange = (program: string | null) => {
    if (!program) {
      setActiveView("genel");
    } else {
      setActiveView(`program:${program.toLocaleLowerCase("tr")}`);
    }
  };

  const handleAddProgram = () => {
    if (!activeProfile) {
      setStatus({ tone: "error", message: "Önce bir okul profili seçin veya oluşturun." });
      return;
    }
    const name = window.prompt("Yeni bölüm adını girin:");
    if (!name?.trim()) return;
    const trimmed = name.trim();
    if (activeProfile.programs.some((p) => p.toLocaleLowerCase("tr") === trimmed.toLocaleLowerCase("tr"))) {
      setStatus({ tone: "info", message: `"${trimmed}" bölümü zaten tanımlı.` });
      return;
    }
    saveProfile({ ...activeProfile, programs: [...activeProfile.programs, trimmed] });
    setStatus({ tone: "info", message: `"${trimmed}" bölümü profile eklendi.` });
  };

  const handleCardContextMenu = (examId: string, x: number, y: number) => {
    const exam = document?.exams.find((e) => e.id === examId);
    if (exam) {
      setContextMenu({ x, y, exam });
      selectCard(examId);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    if (!document) {
      return;
    }

    setContextMenu(null);
    const draggedExam = document.exams.find((exam) => exam.id === String(event.active.id));
    setActiveDraggedExam(draggedExam ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDraggedExam(null);

    if (!event.over) {
      return;
    }

    const cardId = String(event.active.id);
    const slotKey = String(event.over.id);

    if (cardId && slotKey) {
      moveExam(cardId, slotKey);
    }
  };

  return (
    <div className="app-shell" style={shellStyle}>
      <AttributionBanner />
      <input
        ref={sourceInputRef}
        hidden
        type="file"
        accept=".xlsx,.xls,.pdf,.doc,.docx"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            void handleSourceUpload(file);
          }
        }}
      />
      {fileDragActive ? (
        <div className="file-drop-overlay">
          <div className="file-drop-overlay__panel">
            <strong>Ders programını buraya bırakın</strong>
            <span>Excel, PDF ve Word dosyalarından otomatik sınav taslağı oluşturulur.</span>
            <span>Aktif okul profili varsa bölüm, ders, sınıf, hoca ve derslik bilgileri onunla eşleştirilir.</span>
          </div>
        </div>
      ) : null}

      <Toolbar
        viewSummaries={viewSummaries}
        savedRecordSummaries={savedRecordSummaries}
        profileSummaries={profileSummaries}
        programOptions={programOptions}
        activeProgramFilter={activeProgramFilter}
        activeViewId={activeViewId}
        activeSavedRecordId={activeSavedRecordId}
        activeProfileId={activeProfileId}
        visibleExamCount={visibleExams.length}
        totalExamCount={document?.exams.length ?? 0}
        visibleConflictCount={visibleConflicts.length}
        conflictsOpen={conflictsOpen}
        busy={busy || booting}
        canUndo={historyCount > 0}
        canRegenerate={Boolean(document)}
        uiScale={uiScale}
        useAI={useAI}
        hasGeminiKey={Boolean(planningProfile?.geminiApiKey?.trim())}
        onViewChange={setActiveView}
        onOpenSource={() => sourceInputRef.current?.click()}
        onNewDocument={handleNewDocument}
        onSaveRecord={handleSaveRecord}
        onSavedRecordChange={handleSavedRecordChange}
        onDeleteSavedRecord={handleDeleteSavedRecord}
        onProfileChange={(profileId) => {
          setActiveProfile(profileId);
          setStatus({
            tone: "info",
            message: profileId
              ? `${profiles.find((profile) => profile.id === profileId)?.name ?? "Profil"} seçildi.`
              : "Profil seçimi temizlendi.",
          });
        }}
        onExportExcel={handleExportExcel}
        onProgramFilterChange={handleProgramFilterChange}
        onAddProgram={handleAddProgram}
        onToggleConflicts={toggleConflicts}
        onAddExam={handleToolbarAddExam}
        onAddTimeBlock={handleAddTimeBlock}
        onUndo={handleUndo}
        onRegenerate={handleRegenerate}
        onUiScaleChange={setUiScale}
        onToggleAI={() => setUseAI((prev) => !prev)}
        userPrompt={userPrompt}
        onUserPromptChange={setUserPrompt}
      />

      {status ? (
        <div className={`status-banner status-banner--${status.tone}`}>{status.message}</div>
      ) : null}

      {!document ? (
        <main className="workspace workspace--empty">
          <section className="empty-state">
            <h2>Sınav Programı Oluşturmaya Başlayın</h2>
            <p style={{ marginBottom: "16px" }}>
              Okulunuzun ders programını (Excel, PDF veya Word) sürükleyip bırakın.
              Dersler otomatik olarak sınav takviminde çakışmasız biçimde yerleştirilir.
            </p>

            <div style={{ display: "flex", gap: "10px", justifyContent: "center", marginBottom: "24px" }}>
              <button
                type="button"
                className="button button--accent"
                style={{ padding: "10px 24px", fontSize: "1em" }}
                onClick={() => sourceInputRef.current?.click()}
              >
                Dosya Yükle
              </button>
            </div>

            {savedRecordSummaries.length > 0 ? (
              <div className="saved-records-grid">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: "480px", margin: "0 auto 12px" }}>
                  <h3 style={{ margin: 0, fontSize: "1em", color: "var(--ink)" }}>
                    Kayıtlı Programlar
                  </h3>
                  <button
                    type="button"
                    className="button button--danger-ghost"
                    style={{ fontSize: "0.8em", padding: "4px 10px" }}
                    onClick={() => {
                      if (window.confirm("Tüm kayıtlı programlar silinsin mi? Bu işlem geri alınamaz.")) {
                        clearAllRecords();
                        setStatus({ tone: "info", message: "Tüm kayıtlar silindi." });
                      }
                    }}
                  >
                    Tümünü sil
                  </button>
                </div>
                <div style={{ display: "grid", gap: "8px", maxWidth: "480px", margin: "0 auto" }}>
                  {savedRecordSummaries.map((record) => (
                    <div key={record.id} className="saved-record-card-row">
                      <button
                        type="button"
                        className="saved-record-card"
                        onClick={() => handleSavedRecordChange(record.id)}
                      >
                        <span className="saved-record-card__name">{record.name}</span>
                        <span className="saved-record-card__date">
                          {new Date(record.updatedAt).toLocaleDateString("tr-TR", {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="saved-record-card__delete"
                        title="Bu kaydı sil"
                        onClick={() => handleDeleteSavedRecord(record.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div style={{ display: "grid", gap: "10px", maxWidth: "420px", margin: "24px auto 0", textAlign: "left" }}>
              <h3 style={{ margin: "0 0 4px", fontSize: "0.95em", color: "var(--muted)", textAlign: "center" }}>
                Nasıl Kullanılır?
              </h3>
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <span style={{ background: "var(--accent-bg)", color: "var(--accent)", borderRadius: "6px", padding: "2px 8px", fontWeight: 700, flexShrink: 0 }}>1</span>
                <span style={{ color: "var(--muted)", fontSize: "0.92em" }}>Sağdaki panelden bir <strong>okul profili</strong> oluşturun (bölümler, derslikler, saatler)</span>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <span style={{ background: "var(--accent-bg)", color: "var(--accent)", borderRadius: "6px", padding: "2px 8px", fontWeight: 700, flexShrink: 0 }}>2</span>
                <span style={{ color: "var(--muted)", fontSize: "0.92em" }}>Ders programı dosyasını <strong>sürükleyip bırakın</strong> veya "Dosya yükle" butonunu kullanın</span>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <span style={{ background: "var(--accent-bg)", color: "var(--accent)", borderRadius: "6px", padding: "2px 8px", fontWeight: 700, flexShrink: 0 }}>3</span>
                <span style={{ color: "var(--muted)", fontSize: "0.92em" }}>Sınavları <strong>sürükleyerek</strong> düzenleyin, çakışmaları kontrol edin ve Excel olarak dışa aktarın</span>
              </div>
            </div>
          </section>

          <aside className="workspace__sidebar">
            <ProfilePanel
              activeProfile={activeProfile}
              document={null}
              onSaveProfile={saveProfile}
              onDeleteProfile={deleteProfile}
              onLoadDocument={setDocumentFromFile}
              onStatus={(tone, message) => setStatus({ tone, message })}
              onDraftProfileChange={setDraftProfile}
            />
          </aside>
        </main>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <main className="workspace">
            <section className="workspace__board">
              <div className="workspace__board-header">
                <div>
                  <h2>Sınav Çizelgesi</h2>
                  <p>
                    Kartları sürükleyerek taşıyın. Derslik, sınıf, hoca ve süre çakışmaları otomatik tespit edilir.
                  </p>
                </div>
              </div>

              <div className="workspace__board-scroller">
                <ScheduleBoard
                  document={document}
                  exams={[...scheduledVisibleExams, ...unofferedVisibleExams]}
                  selectedCardId={selectedCardId}
                  conflictedCardIds={conflictedCardIds}
                  conflictedSlotKeys={conflictedSlotKeys}
                  activeViewId={activeViewId}
                  onSelectCard={selectCard}
                  onAddExam={(slotKey) =>
                    addExam(slotKey, getActiveViewClassYear(document, activeViewId))
                  }
                  onCardContextMenu={handleCardContextMenu}
                />
              </div>
            </section>

            <aside className="workspace__sidebar">
              <UnassignedPanel
                exams={unassignedVisibleExams}
                selectedCardId={selectedCardId}
                conflictedCardIds={conflictedCardIds}
                onSelectCard={selectCard}
                onCardContextMenu={handleCardContextMenu}
              />
              <InspectorPanel
                exam={selectedExam}
                classYearOptions={classYearOptions}
                onUpdateExam={updateExam}
                onDuplicateExam={duplicateExam}
                onDeleteExam={handleDeleteExam}
              />
              <ProfilePanel
                activeProfile={activeProfile}
                document={document}
                onSaveProfile={saveProfile}
                onDeleteProfile={deleteProfile}
                onLoadDocument={setDocumentFromFile}
                onStatus={(tone, message) => setStatus({ tone, message })}
                onDraftProfileChange={setDraftProfile}
              />
              <ConflictList
                conflicts={visibleConflicts}
                examLookup={examLookup}
                open={conflictsOpen}
                onSelectCard={handleSelectConflictCard}
              />
            </aside>
          </main>

          <DragOverlay>
            {activeDraggedExam ? (
              <ExamCardPreview
                exam={activeDraggedExam}
                conflicted={conflictedCardIds.has(activeDraggedExam.id)}
                compactClassLabel={activeViewId !== "genel"}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {contextMenu ? (
        <ContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onSetDuration={(examId, duration) => {
            updateExam(examId, { durationMinutes: duration });
            setStatus({ tone: "info", message: `Sınav süresi ${duration} dakika olarak güncellendi.` });
          }}
          onSetElectiveGroup={(examId, groupId) => {
            updateExam(examId, { electiveGroupId: groupId });
            setStatus({
              tone: "info",
              message: groupId
                ? `Seçmeli grup "${groupId}" olarak ayarlandı.`
                : "Seçmeli grup kaldırıldı.",
            });
          }}
        />
      ) : null}
    </div>
  );
}

export default function App() {
  return <AppShell />;
}
