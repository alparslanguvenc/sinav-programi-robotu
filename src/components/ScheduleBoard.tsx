import { useDroppable } from "@dnd-kit/core";
import clsx from "clsx";
import { useMemo } from "react";
import {
  UNOFFERED_SECTION_TITLE,
  UNOFFERED_SLOT_KEY,
  createSlotKey,
  groupExamsBySlot,
} from "../lib/schedule";
import type { ExamCard, ScheduleDocument } from "../types/schedule";
import { ExamCardView } from "./ExamCardView";

interface ScheduleBoardProps {
  document: ScheduleDocument;
  exams: ExamCard[];
  selectedCardId: string | null;
  conflictedCardIds: Set<string>;
  conflictedSlotKeys: Set<string>;
  activeViewId: string;
  onSelectCard: (cardId: string) => void;
  onAddExam: (slotKey: string) => void;
  onCardContextMenu?: (examId: string, x: number, y: number) => void;
}

interface SlotCellProps {
  slotKey: string;
  exams: ExamCard[];
  selectedCardId: string | null;
  conflictedCardIds: Set<string>;
  conflictedSlotKeys: Set<string>;
  compactClassLabel: boolean;
  onSelectCard: (cardId: string) => void;
  onAddExam: (slotKey: string) => void;
  onCardContextMenu?: (examId: string, x: number, y: number) => void;
}

const SlotCell = ({
  slotKey,
  exams,
  selectedCardId,
  conflictedCardIds,
  conflictedSlotKeys,
  compactClassLabel,
  onSelectCard,
  onAddExam,
  onCardContextMenu,
}: SlotCellProps) => {
  const { isOver, setNodeRef } = useDroppable({
    id: slotKey,
    data: {
      type: "slot",
      slotKey,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={clsx("board__cell", {
        "board__cell--over": isOver,
        "board__cell--conflicted": conflictedSlotKeys.has(slotKey),
      })}
      data-slot-key={slotKey}
      data-testid={`slot-cell-${slotKey}`}
    >
      <button
        type="button"
        className="board__add"
        onClick={() => onAddExam(slotKey)}
        aria-label="Bu slota kart ekle"
      >
        +
      </button>
      <div className="board__card-list">
        {exams.map((exam) => (
          <ExamCardView
            key={exam.id}
            exam={exam}
            selected={selectedCardId === exam.id}
            conflicted={conflictedCardIds.has(exam.id)}
            compactClassLabel={compactClassLabel}
            onSelect={onSelectCard}
            onContextMenu={onCardContextMenu}
          />
        ))}
      </div>
    </div>
  );
};

interface SecondarySlotProps {
  title: string;
  slotKey: string;
  exams: ExamCard[];
  selectedCardId: string | null;
  conflictedCardIds: Set<string>;
  compactClassLabel: boolean;
  onSelectCard: (cardId: string) => void;
  onAddExam: (slotKey: string) => void;
  minContentWidth: number;
  onCardContextMenu?: (examId: string, x: number, y: number) => void;
}

const SecondarySlot = ({
  title,
  slotKey,
  exams,
  selectedCardId,
  conflictedCardIds,
  compactClassLabel,
  onSelectCard,
  onAddExam,
  minContentWidth,
  onCardContextMenu,
}: SecondarySlotProps) => {
  const { isOver, setNodeRef } = useDroppable({
    id: slotKey,
    data: {
      type: "slot",
      slotKey,
    },
  });

  return (
    <div
      className="board-secondary"
      style={{
        gridTemplateColumns: `var(--board-time-width) minmax(${minContentWidth}px, 1fr)`,
      }}
    >
      <div className="board-secondary__label">{title}</div>
      <div
        ref={setNodeRef}
        className={clsx("board-secondary__cell", {
          "board-secondary__cell--over": isOver,
        })}
        data-slot-key={slotKey}
      >
        <button
          type="button"
          className="board__add"
          onClick={() => onAddExam(slotKey)}
          aria-label={`${title} bölümüne kart ekle`}
        >
          +
        </button>
        <div className="board__card-list">
          {exams.map((exam) => (
            <ExamCardView
              key={exam.id}
              exam={exam}
              selected={selectedCardId === exam.id}
              conflicted={conflictedCardIds.has(exam.id)}
              compactClassLabel={compactClassLabel}
              onSelect={onSelectCard}
              onContextMenu={onCardContextMenu}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export const ScheduleBoard = ({
  document,
  exams,
  selectedCardId,
  conflictedCardIds,
  conflictedSlotKeys,
  activeViewId,
  onSelectCard,
  onAddExam,
  onCardContextMenu,
}: ScheduleBoardProps) => {
  const groupedExams = useMemo(() => groupExamsBySlot(document, exams), [document, exams]);
  const compactClassLabel = activeViewId !== "genel";
  const minContentWidth = document.template.dates.length * 154;

  return (
    <div className="board-stack">
      <div
        className="board"
        style={{
          gridTemplateColumns: `var(--board-time-width) repeat(${document.template.dates.length}, minmax(var(--board-cell-min-width), 1fr))`,
        }}
      >
        <div className="board__corner">Saat</div>
        {document.template.dates.map((date) => (
          <div key={date} className="board__day">
            {date}
          </div>
        ))}

        {document.template.times.flatMap((time) => [
          <div key={`time:${time}`} className="board__time">
            {time}
          </div>,
          ...document.template.dates.map((date) => {
            const slotKey = createSlotKey(date, time);
            return (
              <SlotCell
                key={slotKey}
                slotKey={slotKey}
                exams={groupedExams.get(slotKey) ?? []}
                selectedCardId={selectedCardId}
                conflictedCardIds={conflictedCardIds}
                conflictedSlotKeys={conflictedSlotKeys}
                compactClassLabel={compactClassLabel}
                onSelectCard={onSelectCard}
                onAddExam={onAddExam}
                onCardContextMenu={onCardContextMenu}
              />
            );
          }),
        ])}
      </div>

      <SecondarySlot
        title={UNOFFERED_SECTION_TITLE}
        slotKey={UNOFFERED_SLOT_KEY}
        exams={groupedExams.get(UNOFFERED_SLOT_KEY) ?? []}
        selectedCardId={selectedCardId}
        conflictedCardIds={conflictedCardIds}
        compactClassLabel={compactClassLabel}
        onSelectCard={onSelectCard}
        onAddExam={onAddExam}
        minContentWidth={minContentWidth}
        onCardContextMenu={onCardContextMenu}
      />
    </div>
  );
};
