import { useDroppable } from "@dnd-kit/core";
import clsx from "clsx";
import {
  UNASSIGNED_SLOT_KEY,
  formatClassLabel,
  groupExamsByClassYear,
  sortClassYears,
} from "../lib/schedule";
import type { ExamCard } from "../types/schedule";
import { ExamCardView } from "./ExamCardView";

interface UnassignedPanelProps {
  exams: ExamCard[];
  selectedCardId: string | null;
  conflictedCardIds: Set<string>;
  onSelectCard: (cardId: string) => void;
}

export const UnassignedPanel = ({
  exams,
  selectedCardId,
  conflictedCardIds,
  onSelectCard,
}: UnassignedPanelProps) => {
  const { isOver, setNodeRef } = useDroppable({
    id: UNASSIGNED_SLOT_KEY,
    data: {
      type: "slot",
      slotKey: UNASSIGNED_SLOT_KEY,
    },
  });
  const groups = groupExamsByClassYear(exams);
  const classYears = sortClassYears([...groups.keys()]);

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
        {classYears.length === 0 ? (
          <p className="panel__muted">
            Boşta kart yok. `Yeni kart` ile havuza ekleyip daha sonra çizelgeye sürükleyebilirsiniz.
          </p>
        ) : (
          <div className="unassigned-groups">
            {classYears.map((classYear) => (
              <section key={classYear} className="unassigned-group">
                <div className="unassigned-group__header">
                  <strong>{formatClassLabel(classYear)}</strong>
                  <span>{groups.get(classYear)?.length ?? 0} kart</span>
                </div>
                <div className="unassigned-group__cards">
                  {(groups.get(classYear) ?? []).map((exam) => (
                    <ExamCardView
                      key={exam.id}
                      exam={exam}
                      selected={selectedCardId === exam.id}
                      conflicted={conflictedCardIds.has(exam.id)}
                      compactClassLabel
                      onSelect={onSelectCard}
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
