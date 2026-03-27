import clsx from "clsx";
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
  activeViewId: string;
  activeSavedRecordId: string | null;
  activeProfileId: string | null;
  visibleExamCount: number;
  totalExamCount: number;
  visibleConflictCount: number;
  conflictsOpen: boolean;
  busy: boolean;
  canUndo: boolean;
  uiScale: UiScale;
  onViewChange: (viewId: string) => void;
  onOpenSource: () => void;
  onOpenJson: () => void;
  onSaveRecord: () => void;
  onSavedRecordChange: (savedRecordId: string) => void;
  onProfileChange: (profileId: string | null) => void;
  onSaveJson: () => void;
  onExportExcel: () => void;
  onToggleConflicts: () => void;
  onAddExam: () => void;
  onAddTimeBlock: () => void;
  onUndo: () => void;
  onUiScaleChange: (uiScale: UiScale) => void;
}

export const Toolbar = ({
  viewSummaries,
  savedRecordSummaries,
  profileSummaries,
  activeViewId,
  activeSavedRecordId,
  activeProfileId,
  visibleExamCount,
  totalExamCount,
  visibleConflictCount,
  conflictsOpen,
  busy,
  canUndo,
  uiScale,
  onViewChange,
  onOpenSource,
  onOpenJson,
  onSaveRecord,
  onSavedRecordChange,
  onProfileChange,
  onSaveJson,
  onExportExcel,
  onToggleConflicts,
  onAddExam,
  onAddTimeBlock,
  onUndo,
  onUiScaleChange,
}: ToolbarProps) => (
  <header className="toolbar">
    <div className="toolbar__brand">
      <p className="toolbar__eyebrow">Kurum profilli masaüstü çizelge aracı</p>
      <h1>Sınav Programı Robotu</h1>
      <p className="toolbar__summary">
        {visibleExamCount}/{totalExamCount} kart görünür · {visibleConflictCount} aktif uyarı
      </p>
    </div>

    <div className="toolbar__controls">
      <div className="toolbar__view-block">
        <label className="toolbar__select">
          Görünüm
          <select value={activeViewId} onChange={(event) => onViewChange(event.target.value)}>
            {viewSummaries.map((view) => (
              <option key={view.id} value={view.id}>
                {view.label}
              </option>
            ))}
          </select>
        </label>

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
            >
              <span className="toolbar__view-chip-label">{view.label}</span>
              <span className="toolbar__view-chip-meta">
                {view.classYear ? `${view.examCount} sınav` : `Genel görünüm · ${view.examCount} sınav`}
              </span>
            </button>
          ))}
        </div>
      </div>

      <label className="toolbar__select">
        Kayıtlar
        <select
          aria-label="Kayıtlar"
          value={activeSavedRecordId ?? ""}
          onChange={(event) => {
            if (event.target.value) {
              onSavedRecordChange(event.target.value);
            }
          }}
        >
          <option value="">Geçici çalışma</option>
          {savedRecordSummaries.map((record) => (
            <option key={record.id} value={record.id}>
              {record.name}
            </option>
          ))}
        </select>
      </label>

      <label className="toolbar__select">
        Okul profili
        <select
          aria-label="Okul profili"
          value={activeProfileId ?? ""}
          onChange={(event) => onProfileChange(event.target.value || null)}
        >
          <option value="">Profil seçilmedi</option>
          {profileSummaries.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name} ({profile.courseCount})
            </option>
          ))}
        </select>
      </label>

      <label className="toolbar__select">
        Boyut
        <select value={uiScale} onChange={(event) => onUiScaleChange(event.target.value as UiScale)}>
          <option value="small">Küçük</option>
          <option value="normal">Normal</option>
          <option value="large">Büyük</option>
        </select>
      </label>

      <div className="toolbar__actions">
        <button type="button" className="button button--ghost" onClick={onOpenSource}>
          Dosya yükle
        </button>
        <button type="button" className="button button--ghost" onClick={onOpenJson}>
          JSON yükle
        </button>
        <button type="button" className="button button--accent" onClick={onSaveRecord}>
          Kaydet
        </button>
        <button type="button" className="button" onClick={onSaveJson}>
          JSON kaydet
        </button>
        <button type="button" className="button" onClick={onExportExcel}>
          Excel dışa aktar
        </button>
        <button type="button" className="button button--ghost" onClick={onAddExam}>
          Yeni kart
        </button>
        <button type="button" className="button button--ghost" onClick={onAddTimeBlock}>
          Saat bloğu ekle
        </button>
        <button type="button" className="button button--ghost" onClick={onUndo} disabled={!canUndo}>
          Geri al
        </button>
        <button
          type="button"
          className={clsx("button", "button--ghost", {
            "button--warning": visibleConflictCount > 0,
          })}
          onClick={onToggleConflicts}
        >
          Çakışmalar {conflictsOpen ? "kapat" : "aç"}
        </button>
      </div>
    </div>

    {busy ? <div className="toolbar__busy">Dosya işleniyor…</div> : null}
  </header>
);
