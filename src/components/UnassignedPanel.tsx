import { useDroppable } from "@dnd-kit/core";
import clsx from "clsx";
import { UNASSIGNED_SLOT_KEY, groupExamsByAudience } from "../lib/schedule";
import type { ExamCard } from "../types/schedule";
import { ExamCardView } from "./ExamCardView";

interface UnassignedPanelProps {
  exams: ExamCard[];
  selectedCardId: string | null;
  conflictedCardIds: Set<string>;
  onSelectCard: (cardId: string) => void;
  onCardContextMenu?: (examId: string, x: number, y: number) => void;
}

export const UnassignedPanel = ({
  exams,
  selectedCardId,
  conflictedCardIds,
  onSelectCard,
  onCardContextMenu,
}: UnassignedPanelProps) => {
  const { isOver, setNodeRef } = useDroppable({
    id: UNASSIGNED_SLOT_KEY,
    data: {
      type: "slot",
      slotKey: UNASSIGNED_SLOT_KEY,
    },
  });
  const groups = groupExamsByAudience(exams);

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Yerleştirilmeyen Kartlar</h2>
        <span className="panel__badge">{exams.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={clsx("unassigned-dropzone", {
          "unassigned-dropzone--over": isOver,
        })}
      >
        {groups.length === 0 ? (
          <p className="panel__muted">
            Boşta kart yok. `Yeni kart` ile havuza ekleyip daha sonra çizelgeye sürükleyebilirsiniz.
          </p>
        ) : (
          <div className="unassigned-groups">
            {groups.map((group) => (
              <section key={group.sortKey} className="unassigned-group">
                <div className="unassigned-group__header">
                  <strong>{group.label}</strong>
                  <span>{group.exams.length} kart</span>
                </div>
                <div className="unassigned-group__cards">
                  {group.exams.map((exam) => (
                    <ExamCardView
                      key={exam.id}
                      exam={exam}
                      selected={selectedCardId === exam.id}
                      conflicted={conflictedCardIds.has(exam.id)}
                      compactClassLabel
                      onSelect={onSelectCard}
                      onContextMenu={onCardContextMenu}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
