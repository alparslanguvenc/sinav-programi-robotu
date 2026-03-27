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
import { ExamCardPreview } from "./components/ExamCardView";
import { InspectorPanel } from "./components/InspectorPanel";
import { ProfilePanel } from "./components/ProfilePanel";
import { ScheduleBoard } from "./components/ScheduleBoard";
import { Toolbar } from "./components/Toolbar";
import { UnassignedPanel } from "./components/UnassignedPanel";
import { downloadBlob } from "./lib/browser";
import { createConflictIndex, detectConflicts } from "./lib/conflicts";
import { parseScheduleDocumentJson, serializeScheduleDocument } from "./lib/document";
import { importScheduleFromFile } from "./lib/source-import";
import {
  SAMPLE_FIXTURE_URL,
  UI_SCALE_VALUES,
  getActiveViewClassYear,
  isUnofferedSlot,
  isUnassignedSlot,
} from "./lib/schedule";
import { exportWorkbookArrayBuffer } from "./lib/xlsx-export";
import { parseWorkbookArrayBuffer } from "./lib/xlsx-parser";
import { useScheduleStore } from "./store/scheduleStore";
import type { ExamCard, ScheduleDocument } from "./types/schedule";

type StatusBanner = {
  tone: "info" | "error";
  message: string;
};

interface AppProps {
  sampleUrl?: string | null;
  bootstrapFromStorage?: boolean;
}

const getDocumentFileStem = (document: ScheduleDocument | null) =>
  document?.sourceMeta.generalTitle
    ?.toLocaleLowerCase("tr")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "vize-programi";

const filterVisibleExams = (document: ScheduleDocument, activeViewId: string) => {
  const activeView = document.template.views.find((view) => view.id === activeViewId);
  return activeView?.classYear
    ? document.exams.filter((exam) => exam.classYear === activeView.classYear)
    : document.exams;
};

export function AppShell({
  sampleUrl = SAMPLE_FIXTURE_URL,
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
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);
  const [status, setStatus] = useState<StatusBanner | null>(null);
  const [activeDraggedExam, setActiveDraggedExam] = useState<ExamCard | null>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (bootstrapFromStorage && hydrateFromStorage()) {
        if (!cancelled) {
          setBooting(false);
          setStatus({
            tone: "info",
            message: "Son otomatik kayıt yüklendi.",
          });
        }
        return;
      }

      if (!sampleUrl) {
        if (!cancelled) {
          setBooting(false);
        }
        return;
      }

      try {
        const response = await fetch(sampleUrl);

        if (!response.ok) {
          throw new Error("Örnek Excel dosyası alınamadı.");
        }

        const nextDocument = parseWorkbookArrayBuffer(await response.arrayBuffer());

        if (cancelled) {
          return;
        }

        startTransition(() => loadDocument(nextDocument));
        setStatus({
          tone: "info",
          message: "Örnek vize programı açıldı. Kartları taşıyıp düzenleyebilirsiniz.",
        });
      } catch (error) {
        if (!cancelled) {
          setStatus({
            tone: "error",
            message: error instanceof Error ? error.message : "Örnek dosya yüklenemedi.",
          });
        }
      } finally {
        if (!cancelled) {
          setBooting(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [bootstrapFromStorage, hydrateFromStorage, loadDocument, sampleUrl]);

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
  const visibleConflicts = useMemo(() => {
    if (!document) {
      return [];
    }

    const visibleIds = new Set(visibleExams.map((exam) => exam.id));
    return detectConflicts(document.exams).filter((conflict) =>
      conflict.cardIds.some((cardId) => visibleIds.has(cardId)),
    );
  }, [document, visibleExams]);
  const { conflictedCardIds, conflictedSlotKeys } = useMemo(
    () => createConflictIndex(visibleConflicts),
    [visibleConflicts],
  );
  const examLookup = useMemo(
    () => new Map(document?.exams.map((exam) => [exam.id, exam]) ?? []),
    [document],
  );
  const selectedExam = selectedCardId ? examLookup.get(selectedCardId) ?? null : null;
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
    for (const exam of document.exams) {
      countsByClassYear.set(exam.classYear, (countsByClassYear.get(exam.classYear) ?? 0) + 1);
    }

    return document.template.views.map((view) => ({
      ...view,
      examCount: view.classYear ? (countsByClassYear.get(view.classYear) ?? 0) : document.exams.length,
    }));
  }, [document]);
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

    try {
      const result = await importScheduleFromFile(file, {
        profile: activeProfile,
        fallbackTemplate: document?.template ?? null,
      });
      setDocumentFromFile(result.document, result.message);
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

  const handleJsonUpload = async (file: File) => {
    setBusy(true);

    try {
      const nextDocument = parseScheduleDocumentJson(await file.text());
      setDocumentFromFile(nextDocument, `${file.name} içeriği açıldı.`);
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "JSON dosyası okunamadı.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveJson = () => {
    if (!document) {
      return;
    }

    downloadBlob(
      new Blob([serializeScheduleDocument(document)], { type: "application/json" }),
      `${getDocumentFileStem(document)}.json`,
    );
    setStatus({
      tone: "info",
      message: "JSON çıktısı indirildi.",
    });
  };

  const handleSaveRecord = () => {
    if (!document) {
      return;
    }

    const suggestedName =
      activeSavedRecord?.name ??
      document.sourceMeta.generalTitle ??
      `Vize Programı ${savedRecords.length + 1}`;
    const input = window.prompt("Kaydetmek istediğiniz kayıt adını girin", suggestedName);

    if (input === null || input === undefined) {
      return;
    }

    const result = saveCurrentDocument(input);
    setStatus({
      tone: result.ok ? "info" : "error",
      message: result.message,
    });
  };

  const handleSavedRecordChange = (savedRecordId: string) => {
    const result = loadSavedRecord(savedRecordId);
    setStatus({
      tone: result.ok ? "info" : "error",
      message: result.message,
    });
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

  const handleDragStart = (event: DragStartEvent) => {
    if (!document) {
      return;
    }

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
      <input
        ref={jsonInputRef}
        hidden
        type="file"
        accept=".json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            void handleJsonUpload(file);
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
        activeViewId={activeViewId}
        activeSavedRecordId={activeSavedRecordId}
        activeProfileId={activeProfileId}
        visibleExamCount={visibleExams.length}
        totalExamCount={document?.exams.length ?? 0}
        visibleConflictCount={visibleConflicts.length}
        conflictsOpen={conflictsOpen}
        busy={busy || booting}
        canUndo={historyCount > 0}
        uiScale={uiScale}
        onViewChange={setActiveView}
        onOpenSource={() => sourceInputRef.current?.click()}
        onOpenJson={() => jsonInputRef.current?.click()}
        onSaveRecord={handleSaveRecord}
        onSavedRecordChange={handleSavedRecordChange}
        onProfileChange={(profileId) => {
          setActiveProfile(profileId);
          setStatus({
            tone: "info",
            message: profileId
              ? `${profiles.find((profile) => profile.id === profileId)?.name ?? "Profil"} seçildi.`
              : "Profil seçimi temizlendi.",
          });
        }}
        onSaveJson={handleSaveJson}
        onExportExcel={handleExportExcel}
        onToggleConflicts={toggleConflicts}
        onAddExam={handleToolbarAddExam}
        onAddTimeBlock={handleAddTimeBlock}
        onUndo={handleUndo}
        onUiScaleChange={setUiScale}
      />

      {status ? (
        <div className={`status-banner status-banner--${status.tone}`}>{status.message}</div>
      ) : null}

      {!document ? (
        <main className="workspace workspace--empty">
          <section className="empty-state">
            <h2>Başlamak için bir ders programı ya da sınav çizelgesi yükleyin</h2>
            <p>
              Excel, PDF veya Word dosyasını sürükleyip bırakabilirsiniz. Sınav çizelgesi gelirse
              doğrudan açılır; ders programı gelirse aktif okul profiline göre otomatik sınav taslağı
              üretilir.
            </p>
          </section>

          <aside className="workspace__sidebar">
            <ProfilePanel
              activeProfile={activeProfile}
              document={null}
              onSaveProfile={saveProfile}
              onDeleteProfile={deleteProfile}
              onLoadDocument={setDocumentFromFile}
              onStatus={(tone, message) => setStatus({ tone, message })}
            />
          </aside>
        </main>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <main className="workspace">
            <section className="workspace__board">
              <div className="workspace__board-header">
                <div>
                  <h2>Çizelge</h2>
                  <p>
                    Kartları havuzdan çizelgeye, çizelgeden tekrar havuza veya başka bir slota taşıyabilirsiniz. Aynı sınıf yılı farklı bölümlerde paylaşılıyorsa kart üstündeki program bilgisi çakışma hesabına dahil edilir.
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
                />
              </div>
            </section>

            <aside className="workspace__sidebar">
              <UnassignedPanel
                exams={unassignedVisibleExams}
                selectedCardId={selectedCardId}
                conflictedCardIds={conflictedCardIds}
                onSelectCard={selectCard}
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
    </div>
  );
}

export default function App() {
  return <AppShell />;
}
