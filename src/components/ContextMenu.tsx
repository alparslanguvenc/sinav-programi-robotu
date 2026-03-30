import { useEffect, useRef, useState } from "react";
import { DEFAULT_EXAM_DURATION } from "../lib/schedule";
import type { ExamCard } from "../types/schedule";

const DURATION_OPTIONS = [30, 45, 60, 75, 90, 120];

export interface ContextMenuState {
  x: number;
  y: number;
  exam: ExamCard;
}

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onSetDuration: (examId: string, duration: number) => void;
  onSetElectiveGroup: (examId: string, groupId: string | null) => void;
}

export const ContextMenu = ({ state, onClose, onSetDuration, onSetElectiveGroup }: ContextMenuProps) => {
  const { x, y, exam } = state;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [electiveInput, setElectiveInput] = useState(exam.electiveGroupId ?? "");
  const currentDuration = exam.durationMinutes ?? DEFAULT_EXAM_DURATION;

  // Close on outside click or Escape key
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Adjust position so menu stays inside viewport
  const adjustedX = Math.min(x, window.innerWidth - 220);
  const adjustedY = Math.min(y, window.innerHeight - 280);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: adjustedX, top: adjustedY }}
    >
      <div className="context-menu__header">{exam.courseName}</div>

      <div className="context-menu__section-label">Sınav süresi</div>
      <div className="context-menu__duration-grid">
        {DURATION_OPTIONS.map((duration) => (
          <button
            key={duration}
            type="button"
            className={`context-menu__duration-btn${duration === currentDuration ? " context-menu__duration-btn--active" : ""}`}
            onClick={() => {
              onSetDuration(exam.id, duration);
              onClose();
            }}
          >
            {duration} dk
          </button>
        ))}
      </div>

      <div className="context-menu__divider" />

      <div className="context-menu__section-label">Seçmeli grup</div>
      <p className="context-menu__hint">
        Aynı gruptaki sınavlar arasında sınıf çakışması algılanmaz (örn. 2. yabancı dil seçmelileri).
      </p>
      <div className="context-menu__elective-row">
        <input
          className="context-menu__elective-input"
          value={electiveInput}
          placeholder="örn. yabancidil-2"
          onChange={(event) => setElectiveInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onSetElectiveGroup(exam.id, electiveInput.trim() || null);
              onClose();
            }
          }}
        />
        <button
          type="button"
          className="button button--accent context-menu__elective-save"
          onClick={() => {
            onSetElectiveGroup(exam.id, electiveInput.trim() || null);
            onClose();
          }}
        >
          Uygula
        </button>
      </div>
      {exam.electiveGroupId ? (
        <button
          type="button"
          className="context-menu__elective-clear"
          onClick={() => {
            onSetElectiveGroup(exam.id, null);
            onClose();
          }}
        >
          Grubu kaldır ({exam.electiveGroupId})
        </button>
      ) : null}
    </div>
  );
};
