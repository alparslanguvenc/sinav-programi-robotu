import { formatAudienceLabel, formatPrograms, parseProgramsInput, splitRooms } from "../lib/schedule";
import type { ExamCard } from "../types/schedule";

interface InspectorPanelProps {
  exam: ExamCard | null;
  classYearOptions: string[];
  onUpdateExam: (cardId: string, patch: Partial<ExamCard>) => void;
  onDuplicateExam: (cardId: string) => void;
  onDeleteExam: (cardId: string) => void;
}

export const InspectorPanel = ({
  exam,
  classYearOptions,
  onUpdateExam,
  onDuplicateExam,
  onDeleteExam,
}: InspectorPanelProps) => (
  <section className="panel">
    <div className="panel__header">
      <h2>Kart düzenleyici</h2>
      {exam ? <span className="panel__badge">{formatAudienceLabel(exam)}</span> : null}
    </div>

    {!exam ? (
      <p className="panel__muted">
        Sağdaki kartları düzenlemek için bir sınav seçin. Bölüm, sınıf, derslik, paralel grup ve not alanları burada değişir.
      </p>
    ) : (
      <form className="inspector" onSubmit={(event) => event.preventDefault()}>
        <label>
          Ders adı
          <input
            value={exam.courseName}
            onChange={(event) => onUpdateExam(exam.id, { courseName: event.target.value })}
          />
        </label>

        <label>
          Bölüm / Programlar
          <input
            value={formatPrograms(exam.programs)}
            placeholder="örn. Gazetecilik, Halkla İlişkiler"
            onChange={(event) =>
              onUpdateExam(exam.id, {
                programs: parseProgramsInput(event.target.value),
              })
            }
          />
        </label>

        <label>
          Sınıf
          <input
            value={exam.classYear}
            list="class-year-options"
            placeholder="orn. 1.S veya Hazirlik"
            onChange={(event) => onUpdateExam(exam.id, { classYear: event.target.value })}
          />
          <datalist id="class-year-options">
            {classYearOptions.map((classYear) => (
              <option key={classYear} value={classYear} />
            ))}
          </datalist>
        </label>

        <label>
          Derslik / Açıklama
          <input
            value={exam.locationText ?? ""}
            placeholder="orn. 102-103 veya Hoca ile gorusulecek"
            onChange={(event) =>
              onUpdateExam(exam.id, {
                locationText: event.target.value,
                rooms: splitRooms(event.target.value),
              })
            }
          />
        </label>

        <label>
          Hoca / Gözetmen
          <input
            value={exam.instructorText ?? ""}
            placeholder="örn. Dr. Ayşe Kaya"
            onChange={(event) =>
              onUpdateExam(exam.id, {
                instructorText: event.target.value.trim() || null,
              })
            }
          />
        </label>

        <label>
          Paralel grup
          <input
            value={exam.parallelGroupId ?? ""}
            placeholder="örn. dil-1"
            onChange={(event) =>
              onUpdateExam(exam.id, {
                parallelGroupId: event.target.value.trim() || null,
              })
            }
          />
        </label>

        <label>
          Not
          <textarea
            rows={4}
            value={exam.notes ?? ""}
            onChange={(event) =>
              onUpdateExam(exam.id, {
                notes: event.target.value.trim() || null,
              })
            }
          />
        </label>

        <div className="inspector__actions">
          <button type="button" className="button" onClick={() => onDuplicateExam(exam.id)}>
            Çoğalt
          </button>
          <button type="button" className="button button--danger" onClick={() => onDeleteExam(exam.id)}>
            Sil
          </button>
        </div>
      </form>
    )}
  </section>
);
