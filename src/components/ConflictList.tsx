import { parseSlotKey } from "../lib/schedule";
import type { Conflict, ExamCard } from "../types/schedule";

interface ConflictListProps {
  conflicts: Conflict[];
  examLookup: Map<string, ExamCard>;
  open: boolean;
  onSelectCard: (cardId: string) => void;
}

const CONFLICT_TYPE_LABELS: Record<Conflict["type"], string> = {
  room: "Derslik",
  class: "Sınıf",
  instructor: "Hoca",
  capacity: "Kapasite",
  "duration-overlap": "Süre",
};

const getConflictTitle = (conflict: Conflict) => {
  const { date, time } = parseSlotKey(conflict.slotKey);
  return `${date} · ${time}`;
};

const getConflictDescription = (conflict: Conflict, examLookup: Map<string, ExamCard>) => {
  const names = conflict.cardIds
    .map((cardId) => examLookup.get(cardId)?.courseName)
    .filter(Boolean)
    .join(", ");

  switch (conflict.type) {
    case "room":
      return `Derslik ${conflict.resourceKey} birden fazla sınav tarafından kullanılıyor: ${names}`;
    case "class":
      return `${conflict.resourceKey} öğrenci kitlesi çakışıyor: ${names}`;
    case "instructor":
      return `${conflict.resourceKey} aynı anda birden fazla sınava atanmış: ${names}`;
    case "capacity":
      return `${conflict.resourceKey} — ${names}`;
    case "duration-overlap":
      return `${conflict.resourceKey}: ${names}`;
    default:
      return names;
  }
};

export const ConflictList = ({
  conflicts,
  examLookup,
  open,
  onSelectCard,
}: ConflictListProps) => (
  <section className="panel">
    <div className="panel__header">
      <h2>Çakışmalar</h2>
      <span className="panel__badge">{conflicts.length}</span>
    </div>

    {!open ? (
      <p className="panel__muted">Panel kapalı. Üst çubuktan yeniden açabilirsiniz.</p>
    ) : conflicts.length === 0 ? (
      <p className="panel__muted">Bu görünüm için aktif uyarı yok.</p>
    ) : (
      <ul className="conflict-list">
        {conflicts.map((conflict) => (
          <li key={conflict.id} className="conflict-list__item">
            <button
              type="button"
              className="conflict-list__button"
              onClick={() => onSelectCard(conflict.cardIds[0])}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className={`conflict-list__type-badge conflict-list__type-badge--${conflict.type}`}>
                  {CONFLICT_TYPE_LABELS[conflict.type]}
                </span>
                <strong>{getConflictTitle(conflict)}</strong>
              </div>
              <span>{getConflictDescription(conflict, examLookup)}</span>
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
);
