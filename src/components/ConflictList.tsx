import { parseSlotKey } from "../lib/schedule";
import type { Conflict, ExamCard } from "../types/schedule";

interface ConflictListProps {
  conflicts: Conflict[];
  examLookup: Map<string, ExamCard>;
  open: boolean;
  onSelectCard: (cardId: string) => void;
}

const getConflictTitle = (conflict: Conflict) => {
  const { date, time } = parseSlotKey(conflict.slotKey);
  const target =
    conflict.type === "room"
      ? `Derslik ${conflict.resourceKey}`
      : `${conflict.resourceKey} grubu`;
  return `${date} · ${time} · ${target}`;
};

const getConflictDescription = (conflict: Conflict, examLookup: Map<string, ExamCard>) => {
  const names = conflict.cardIds
    .map((cardId) => examLookup.get(cardId)?.courseName)
    .filter(Boolean)
    .join(", ");

  return conflict.type === "room"
    ? `Aynı derslik birden fazla kart tarafından kullanılıyor: ${names}`
    : `Ortak öğrenci kitlesi çakışıyor ve paralel istisnası yok: ${names}`;
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
              <strong>{getConflictTitle(conflict)}</strong>
              <span>{getConflictDescription(conflict, examLookup)}</span>
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
);
