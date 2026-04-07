import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type { ScheduleView, UiScale } from "../types/schedule";

interface ViewSummary extends ScheduleView {
  examCount: number;
}

interface SavedRecordSummary {
  id: string;
  name: string;
  updatedAt: string;
}

interface ProfileSummary {
  id: string;
  name: string;
  courseCount: number;
}

interface ToolbarProps {
  viewSummaries: ViewSummary[];
  savedRecordSummaries: SavedRecordSummary[];
  profileSummaries: ProfileSummary[];
  programOptions: string[];
  activeProgramFilter: string | null;
  activeViewId: string;
  activeSavedRecordId: string | null;
  activeProfileId: string | null;
  visibleExamCount: number;
  totalExamCount: number;
  visibleConflictCount: number;
  conflictsOpen: boolean;
  busy: boolean;
  canUndo: boolean;
  canRegenerate: boolean;
  uiScale: UiScale;
  useAI: boolean;
  hasGeminiKey: boolean;
  onViewChange: (viewId: string) => void;
  onOpenSource: () => void;
  onNewDocument: () => void;
  onSaveRecord: () => void;
  onSavedRecordChange: (savedRecordId: string) => void;
  onDeleteSavedRecord: (savedRecordId: string) => void;
  onProfileChange: (profileId: string | null) => void;
  onProgramFilterChange: (program: string | null) => void;
  onAddProgram: () => void;
  onExportExcel: () => void;
  onToggleConflicts: () => void;
  onAddExam: () => void;
  onAddTimeBlock: () => void;
  onUndo: () => void;
  onRegenerate: () => void;
  onUiScaleChange: (uiScale: UiScale) => void;
  onToggleAI: () => void;
  userPrompt: string;
  onUserPromptChange: (value: string) => void;
}

export const Toolbar = ({
  viewSummaries,
  savedRecordSummaries,
  profileSummaries,
  programOptions,
  activeProgramFilter,
  activeViewId,
  activeSavedRecordId,
  activeProfileId,
  visibleExamCount,
  totalExamCount,
  visibleConflictCount,
  conflictsOpen,
  busy,
  canUndo,
  canRegenerate,
  uiScale,
  useAI,
  hasGeminiKey,
  onViewChange,
  onOpenSource,
  onNewDocument,
  onSaveRecord,
  onSavedRecordChange,
  onDeleteSavedRecord,
  onProfileChange,
  onProgramFilterChange,
  onAddProgram,
  onExportExcel,
  onToggleConflicts,
  onAddExam,
  onAddTimeBlock,
  onUndo,
  onRegenerate,
  onUiScaleChange,
  onToggleAI,
  userPrompt,
  onUserPromptChange,
}: ToolbarProps) => {
  const headerRef = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 55);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
  <header ref={headerRef} className={clsx("toolbar", { "toolbar--compact": compact })}>
    <div className="toolbar__brand">
      <p className="toolbar__eyebrow">Üniversite Sınav Planlama Aracı</p>
      <h1>Sınav Programı Robotu</h1>
      <p className="toolbar__summary">
        {visibleExamCount}/{totalExamCount} sınav{" "}
        {visibleConflictCount > 0 ? (
          <span style={{ color: "var(--danger)", fontWeight: 700 }}>
            · {visibleConflictCount} çakışma
          </span>
        ) : (
          <span style={{ color: "var(--success)" }}>· Çakışma yok</span>
        )}
      </p>
    </div>

    <div className="toolbar__controls">
      {/* ── Satır 1: Görünüm pill'leri ── */}
      <div className="toolbar__view-row">
        <span className="toolbar__view-label">Görünüm</span>
        <div className="toolbar__view-list" aria-label="Sınıf sınav programları">
          {viewSummaries.map((view) => (
            <button
              key={view.id}
              type="button"
              data-view-id={view.id}
              className={clsx("toolbar__view-chip", {
                "toolbar__view-chip--active": view.id === activeViewId,
              })}
              onClick={() => onViewChange(view.id)}
              title={`${view.label} · ${view.examCount} sınav`}
            >
              {view.label}
              <span className="toolbar__view-chip-count">{view.examCount}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Satır 2: Seçiciler + aksiyonlar ── */}
      <div className="toolbar__bottom-row">
        <div className="toolbar__selects">
          <div className="toolbar__record-block">
            <label className="toolbar__select toolbar__select--inline">
              <span>Kayıt</span>
              <select
                aria-label="Kayıtlar"
                value={activeSavedRecordId ?? ""}
                onChange={(event) => { if (event.target.value) onSavedRecordChange(event.target.value); }}
              >
                <option value="">— Geçici —</option>
                {savedRecordSummaries.map((record) => (
                  <option key={record.id} value={record.id}>{record.name}</option>
                ))}
              </select>
            </label>
            <button type="button" className="button button--ghost toolbar__inline-btn" title="Yeni boş program" onClick={onNewDocument}>+</button>
            {activeSavedRecordId && (
              <button type="button" className="button button--danger-ghost toolbar__inline-btn" title="Kaydı sil" onClick={() => onDeleteSavedRecord(activeSavedRecordId)}>×</button>
            )}
          </div>

          <label className="toolbar__select toolbar__select--inline">
            <span>Profil</span>
            <select aria-label="Okul profili" value={activeProfileId ?? ""} onChange={(e) => onProfileChange(e.target.value || null)}>
              <option value="">— Profil yok —</option>
              {profileSummaries.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.courseCount})</option>
              ))}
            </select>
          </label>

          {programOptions.length > 0 && (
            <div className="toolbar__record-block">
              <label className="toolbar__select toolbar__select--inline">
                <span>Bölüm</span>
                <select aria-label="Bölüm filtresi" value={activeProgramFilter ?? ""} onChange={(e) => onProgramFilterChange(e.target.value || null)}>
                  <option value="">Tümü</option>
                  {programOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <button type="button" className="button button--ghost toolbar__inline-btn" title="Bölüm ekle" onClick={onAddProgram}>+</button>
            </div>
          )}

          <label className="toolbar__select toolbar__select--inline">
            <span>Boyut</span>
            <select value={uiScale} onChange={(e) => onUiScaleChange(e.target.value as UiScale)}>
              <option value="small">K</option>
              <option value="normal">N</option>
              <option value="large">B</option>
            </select>
          </label>
        </div>

        <div className="toolbar__actions">
        {/* Dosya grubu */}
        <button type="button" className="button button--ghost" onClick={onOpenSource}>
          Dosya yükle
        </button>
        <button
          type="button"
          className="button button--accent"
          disabled={!canRegenerate || busy}
          title="Mevcut dersleri yeni saatler ve bölümlerle çakışmasız yeniden çizelgele"
          onClick={onRegenerate}
        >
          Yeniden oluştur
        </button>
        <button type="button" className="button button--accent" onClick={onSaveRecord}>
          Kaydet
        </button>
        <button type="button" className="button" onClick={onExportExcel}>
          Excel aktar
        </button>

        {/* Düzenleme grubu */}
        <button type="button" className="button button--ghost" onClick={onAddExam}>
          Yeni kart
        </button>
        <button type="button" className="button button--ghost" onClick={onAddTimeBlock}>
          Saat ekle
        </button>
        <button type="button" className="button button--ghost" onClick={onUndo} disabled={!canUndo}>
          Geri al
        </button>

        {/* AI toggle */}
        {hasGeminiKey ? (
          <button
            type="button"
            className={clsx("button", {
              "button--accent": useAI,
              "button--ghost": !useAI,
            })}
            onClick={onToggleAI}
            title={useAI ? "AI destekli ayrıştırma açık" : "AI destekli ayrıştırma kapalı"}
          >
            AI {useAI ? "Açık" : "Kapalı"}
          </button>
        ) : null}

        {/* Çakışma butonu */}
        <button
          type="button"
          className={clsx("button", {
            "button--warning": visibleConflictCount > 0,
            "button--ghost": visibleConflictCount === 0,
          })}
          onClick={onToggleConflicts}
        >
          Çakışmalar ({visibleConflictCount}) {conflictsOpen ? "▲" : "▼"}
        </button>
      </div>
      </div>{/* toolbar__bottom-row */}
    </div>{/* toolbar__controls */}

    {/* AI prompt satırı */}
    <div className={clsx("toolbar__prompt-row", { "toolbar__prompt-row--open": promptOpen || userPrompt.trim() })}>
      <button
        type="button"
        className={clsx("toolbar__prompt-toggle", { "toolbar__prompt-toggle--active": userPrompt.trim() })}
        onClick={() => setPromptOpen((o) => !o)}
        title="Yapay zekaya ek talimat ekle"
      >
        {userPrompt.trim() ? "✦ AI talimatı var" : "✦ AI'ya talimat ver"}
        <span className="toolbar__prompt-chevron">{promptOpen ? "▲" : "▼"}</span>
      </button>

      {(promptOpen || userPrompt.trim()) && (
        <div className="toolbar__prompt-body">
          <textarea
            className="toolbar__prompt-input"
            aria-label="AI talimatı"
            value={userPrompt}
            rows={2}
            placeholder="örn. Fizik sınavı Cuma olmasın · 1. ve 2. sınıf aynı güne denk gelmesin · Dr. Kaya'nın sınavları Çarşamba sabah..."
            onChange={(e) => onUserPromptChange(e.target.value)}
          />
          <span style={{ color: "var(--muted)", fontSize: "0.84rem" }}>
            Talimatlar yalnızca "Dosya yükle" ve "Yeniden oluştur" işlemleri sırasında uygulanır.
          </span>
          {userPrompt.trim() && (
            <button
              type="button"
              className="button button--ghost toolbar__prompt-clear"
              onClick={() => { onUserPromptChange(""); setPromptOpen(false); }}
            >
              Temizle
            </button>
          )}
        </div>
      )}
    </div>

    {busy ? <div className="toolbar__busy">Dosya işleniyor...</div> : null}
  </header>
  );
};
