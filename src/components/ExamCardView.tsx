import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import type { PropsWithChildren } from "react";
import { formatClassLabel, formatLocationText, formatPrograms } from "../lib/schedule";
import type { ExamCard } from "../types/schedule";

interface ExamCardBaseProps {
  exam: ExamCard;
  selected: boolean;
  conflicted: boolean;
  compactClassLabel: boolean;
}

interface ExamCardViewProps extends ExamCardBaseProps {
  onSelect: (cardId: string) => void;
}

const ExamCardBody = ({
  exam,
  children,
}: PropsWithChildren<ExamCardBaseProps>) => {
  const programsText = formatPrograms(exam.programs);

  return (
    <>
      <span className="exam-card__course">{exam.courseName}</span>
      {programsText ? <span className="exam-card__programs">{programsText}</span> : null}
      <span className="exam-card__class">{formatClassLabel(exam.classYear)}</span>
      <span className="exam-card__location">{formatLocationText(exam)}</span>
      {exam.instructorText ? (
        <span className="exam-card__instructor">{exam.instructorText}</span>
      ) : null}
      {exam.parallelGroupId ? (
        <span className="exam-card__group">Paralel: {exam.parallelGroupId}</span>
      ) : null}
      {children}
    </>
  );
};

export const ExamCardView = ({
  exam,
  selected,
  conflicted,
  compactClassLabel,
  onSelect,
}: ExamCardViewProps) => {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: exam.id,
    data: {
      type: "exam-card",
      cardId: exam.id,
    },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={clsx("exam-card", {
        "exam-card--selected": selected,
        "exam-card--conflicted": conflicted,
      })}
      style={{ transform: CSS.Translate.toString(transform) }}
      onClick={() => onSelect(exam.id)}
      data-testid={`exam-card-${exam.id}`}
      data-course-name={exam.courseName}
      {...listeners}
      {...attributes}
    >
      <ExamCardBody
        exam={exam}
        selected={selected}
        conflicted={conflicted}
        compactClassLabel={compactClassLabel}
      />
    </button>
  );
};

export const ExamCardPreview = ({
  exam,
  conflicted,
  compactClassLabel,
}: Omit<ExamCardBaseProps, "selected">) => (
  <div
    className={clsx("exam-card", "exam-card--overlay", {
      "exam-card--conflicted": conflicted,
    })}
  >
    <ExamCardBody
      exam={exam}
      selected={false}
      conflicted={conflicted}
      compactClassLabel={compactClassLabel}
    />
  </div>
);
