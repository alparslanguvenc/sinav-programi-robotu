import { DEFAULT_EXAM_DURATION, formatAudienceLabel, formatPrograms, parseProgramsInput, splitRooms } from "../lib/schedule";
import type { ExamCard } from "../types/schedule";

const DURATION_OPTIONS = [30, 45, 60, 75, 90, 120];

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
        Bir sınav kartı seçerek ders, bölüm, sınıf, derslik, süre ve öğrenci sayısını buradan düzenleyebilirsiniz.
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <label>
            Sınav süresi (dk)
            <select
              value={exam.durationMinutes ?? DEFAULT_EXAM_DURATION}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (value > 0) {
                  onUpdateExam(exam.id, { durationMinutes: value });
                }
              }}
            >
              {DURATION_OPTIONS.map((duration) => (
                <option key={duration} value={duration}>
                  {duration} dakika
                </option>
              ))}
              {!DURATION_OPTIONS.includes(exam.durationMinutes ?? DEFAULT_EXAM_DURATION) && (
                <option value={exam.durationMinutes ?? DEFAULT_EXAM_DURATION}>
                  {exam.durationMinutes ?? DEFAULT_EXAM_DURATION} dakika
                </option>
              )}
            </select>
          </label>

          <label>
            Öğrenci sayısı
            <input
              type="number"
              min="0"
              value={exam.studentCount ?? ""}
              placeholder="örn. 85"
              onChange={(event) => {
                const value = event.target.value.trim();
                onUpdateExam(exam.id, {
                  studentCount: value ? Number(value) || null : null,
                });
              }}
            />
          </label>
        </div>

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
          Seçmeli grup
          <input
            value={exam.electiveGroupId ?? ""}
            placeholder="örn. yabancidil-2"
            onChange={(event) =>
              onUpdateExam(exam.id, {
                electiveGroupId: event.target.value.trim() || null,
              })
            }
          />
          <span style={{ fontSize: "0.8em", color: "var(--muted)", marginTop: "4px", display: "block", lineHeight: 1.4 }}>
            Aynı gruptaki sınavlar arasında sınıf çakışması algılanmaz.
          </span>
        </label>

        <label>
          Not
          <textarea
            rows={3}
            value={exam.notes ?? ""}
            onChange={(event) =>
              onUpdateExam(exam.id, {
                notes: event.target.value.trim() || null,
              })
            }
          />
        </label>

        <div className="inspector__actions">
          <button type="button" className="button button--ghost" onClick={() => onDuplicateExam(exam.id)}>
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
