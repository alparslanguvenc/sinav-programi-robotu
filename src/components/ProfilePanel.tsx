// ProfilePanel — 6-step wizard for school profile editing
import { useEffect, useState } from "react";
import {
  buildProfileFromDocument,
  createBlankProfile,
  normalizeSchoolProfile,
  parseMultilineList,
  stringifyMultilineList,
} from "../lib/profiles";
import { DEFAULT_EXAM_DURATION, parseProgramsInput } from "../lib/schedule";
import { buildAutoScheduleDocument } from "../lib/source-import";
import type { ScheduleDocument, SchoolProfile } from "../types/schedule";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ProfilePanelProps {
  activeProfile: SchoolProfile | null;
  document: ScheduleDocument | null;
  onSaveProfile: (profile: SchoolProfile) => { ok: boolean; message: string; profileId?: string };
  onDeleteProfile: (profileId: string) => { ok: boolean; message: string };
  onLoadDocument: (document: ScheduleDocument, message: string) => void;
  onStatus: (tone: "info" | "error", message: string) => void;
  onDraftProfileChange?: (profile: SchoolProfile) => void;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RoomEntry {
  name: string;
  capacity: string;
}

interface CourseRow {
  id: string;
  programs: string;
  classYear: string;
  courseName: string;
  instructorText: string;
  locationText: string;
}

interface WizardState {
  id: string;
  name: string;
  dates: string;
  times: string;
  defaultExamDuration: string;
  geminiApiKey: string;
  programs: string[];
  classYears: string[];
  rooms: RoomEntry[];
  instructors: string[];
  courses: CourseRow[];
}

// ---------------------------------------------------------------------------
// Step labels
// ---------------------------------------------------------------------------

const STEP_LABELS = ["Temel Bilgiler", "Bölümler", "Sınıflar", "Derslikler", "Hocalar", "Dersler"];

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

function toWizardState(profile: SchoolProfile | null): WizardState {
  const src = profile ?? createBlankProfile();

  const rooms: RoomEntry[] = src.rooms.map((r) => ({
    name: r,
    capacity: String(src.roomCapacities?.[r] ?? ""),
  }));

  const courses: CourseRow[] = src.courseTemplates.map((ct) => ({
    id: crypto.randomUUID(),
    programs: ct.programs.join(", "),
    classYear: ct.classYear,
    courseName: ct.courseName,
    instructorText: ct.instructorText ?? "",
    locationText: ct.locationText ?? "",
  }));

  return {
    id: src.id,
    name: src.name,
    dates: stringifyMultilineList(src.dates),
    times: stringifyMultilineList(src.times),
    defaultExamDuration: String(src.defaultExamDuration ?? DEFAULT_EXAM_DURATION),
    geminiApiKey: src.geminiApiKey ?? "",
    programs: [...src.programs],
    classYears: [...src.classYears],
    rooms,
    instructors: [...src.instructors],
    courses,
  };
}

function buildProfileFromWizard(state: WizardState): SchoolProfile {
  const roomCapacities: Record<string, number> = {};
  const roomNames: string[] = [];

  for (const r of state.rooms) {
    const trimmed = r.name.trim();
    if (!trimmed) continue;
    roomNames.push(trimmed);
    const cap = Number(r.capacity);
    if (cap > 0) {
      roomCapacities[trimmed] = cap;
    }
  }

  const courseTemplates = state.courses
    .filter((c) => c.courseName.trim() !== "")
    .map((c) => ({
      id: c.id,
      programs: parseProgramsInput(c.programs),
      classYear: c.classYear,
      courseName: c.courseName.trim(),
      instructorText: c.instructorText.trim() || null,
      locationText: c.locationText.trim() || null,
    }));

  return normalizeSchoolProfile({
    id: state.id || crypto.randomUUID(),
    name: state.name,
    updatedAt: new Date().toISOString(),
    dates: parseMultilineList(state.dates),
    times: parseMultilineList(state.times),
    programs: state.programs,
    classYears: state.classYears,
    rooms: roomNames,
    instructors: state.instructors,
    courseTemplates,
    defaultExamDuration: Number(state.defaultExamDuration) || DEFAULT_EXAM_DURATION,
    roomCapacities,
    geminiApiKey: state.geminiApiKey.trim() || undefined,
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ProfilePanel = ({
  activeProfile,
  document,
  onSaveProfile,
  onDeleteProfile,
  onLoadDocument,
  onStatus,
  onDraftProfileChange,
}: ProfilePanelProps) => {
  const [wizardState, setWizardState] = useState<WizardState>(() => toWizardState(activeProfile));
  const [step, setStep] = useState(0);
  const [newProgram, setNewProgram] = useState("");
  const [newClassYear, setNewClassYear] = useState("");
  const [newInstructor, setNewInstructor] = useState("");

  // Sync when active profile changes from outside
  useEffect(() => {
    setWizardState(toWizardState(activeProfile));
    setStep(0);
  }, [activeProfile]);

  useEffect(() => {
    onDraftProfileChange?.(buildProfileFromWizard(wizardState));
  }, [onDraftProfileChange, wizardState]);

  // -------------------------------------------------------------------------
  // State helpers
  // -------------------------------------------------------------------------

  const updateField = <K extends keyof WizardState>(key: K, value: WizardState[K]) => {
    setWizardState((prev) => ({ ...prev, [key]: value }));
  };

  const addProgram = () => {
    const val = newProgram.trim();
    if (!val || wizardState.programs.includes(val)) return;
    updateField("programs", [...wizardState.programs, val]);
    setNewProgram("");
  };

  const removeProgram = (idx: number) => {
    updateField("programs", wizardState.programs.filter((_, i) => i !== idx));
  };

  const addClassYear = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed || wizardState.classYears.includes(trimmed)) return;
    updateField("classYears", [...wizardState.classYears, trimmed]);
  };

  const removeClassYear = (idx: number) => {
    updateField("classYears", wizardState.classYears.filter((_, i) => i !== idx));
  };

  const addInstructor = () => {
    const val = newInstructor.trim();
    if (!val || wizardState.instructors.includes(val)) return;
    updateField("instructors", [...wizardState.instructors, val]);
    setNewInstructor("");
  };

  const removeInstructor = (idx: number) => {
    updateField("instructors", wizardState.instructors.filter((_, i) => i !== idx));
  };

  const addRoom = () => {
    updateField("rooms", [...wizardState.rooms, { name: "", capacity: "" }]);
  };

  const updateRoom = (idx: number, field: keyof RoomEntry, value: string) => {
    const next = wizardState.rooms.map((r, i) => (i === idx ? { ...r, [field]: value } : r));
    updateField("rooms", next);
  };

  const removeRoom = (idx: number) => {
    updateField("rooms", wizardState.rooms.filter((_, i) => i !== idx));
  };

  const addCourse = () => {
    const newRow: CourseRow = {
      id: crypto.randomUUID(),
      programs: "",
      classYear: "",
      courseName: "",
      instructorText: "",
      locationText: "",
    };
    updateField("courses", [...wizardState.courses, newRow]);
  };

  const updateCourse = (idx: number, field: keyof CourseRow, value: string) => {
    const next = wizardState.courses.map((c, i) => (i === idx ? { ...c, [field]: value } : c));
    updateField("courses", next);
  };

  const removeCourse = (idx: number) => {
    updateField("courses", wizardState.courses.filter((_, i) => i !== idx));
  };

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  const handleSave = () => {
    const profile = buildProfileFromWizard(wizardState);
    const result = onSaveProfile(profile);
    onStatus(result.ok ? "info" : "error", result.message);
  };

  // -------------------------------------------------------------------------
  // Step content
  // -------------------------------------------------------------------------

  const renderStep = () => {
    switch (step) {
      // ── Step 0: Temel Bilgiler ──────────────────────────────────────────
      case 0:
        return (
          <div className="wizard-step-content">
            <label>
              Profil adı
              <input
                value={wizardState.name}
                placeholder="örn. İletişim Fakültesi Bahar 2026"
                onChange={(e) => updateField("name", e.target.value)}
              />
            </label>

            <label>
              Sınav tarihleri
              <textarea
                rows={4}
                value={wizardState.dates}
                placeholder={"Her satıra bir tarih\nPzt 23.03.2026"}
                onChange={(e) => updateField("dates", e.target.value)}
              />
            </label>

            <label>
              Saatler
              <textarea
                rows={3}
                value={wizardState.times}
                placeholder={"Her satıra bir saat\n09:00"}
                onChange={(e) => updateField("times", e.target.value)}
              />
            </label>

            <label>
              Varsayılan sınav süresi
              <select
                value={wizardState.defaultExamDuration}
                onChange={(e) => updateField("defaultExamDuration", e.target.value)}
              >
                <option value="30">30 dk</option>
                <option value="45">45 dk</option>
                <option value="60">60 dk</option>
                <option value="75">75 dk</option>
                <option value="90">90 dk</option>
                <option value="120">120 dk</option>
              </select>
            </label>

            <label>
              AI API Anahtarı
              <input
                type="password"
                value={wizardState.geminiApiKey}
                placeholder="gsk_... (Groq) veya AIza... (Gemini)"
                onChange={(e) => updateField("geminiApiKey", e.target.value)}
              />
              <small style={{ color: "var(--muted)", marginTop: "4px", display: "block", lineHeight: 1.4 }}>
                <strong>Groq</strong> (ücretsiz):{" "}
                <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  console.groq.com/keys
                </a>
                {" · "}
                <strong>Gemini</strong>:{" "}
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  aistudio.google.com
                </a>
              </small>
            </label>
          </div>
        );

      // ── Step 1: Bölümler ──────────────────────────────────────────────
      case 1:
        return (
          <div className="wizard-step-content">
            <p className="wizard-hint">Her bölümü ayrı ayrı ekleyin. Dersler son adımda bölüme atanır.</p>

            <div className="tag-list">
              {wizardState.programs.map((prog, idx) => (
                <span key={idx} className="tag-chip">
                  {prog}
                  <button
                    type="button"
                    className="tag-chip__remove"
                    onClick={() => removeProgram(idx)}
                    aria-label={`${prog} kaldır`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className="tag-input-row">
              <input
                value={newProgram}
                placeholder="örn. Gazetecilik"
                onChange={(e) => setNewProgram(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addProgram();
                  }
                }}
              />
              <button type="button" className="button button--ghost" onClick={addProgram}>
                Ekle
              </button>
            </div>
          </div>
        );

      // ── Step 2: Sınıflar ──────────────────────────────────────────────
      case 2:
        return (
          <div className="wizard-step-content">
            <p className="wizard-hint">Kaç sınıf varsa hepsini ekleyin.</p>

            <div className="tag-list">
              {wizardState.classYears.map((cy, idx) => (
                <span key={idx} className="tag-chip">
                  {cy}
                  <button
                    type="button"
                    className="tag-chip__remove"
                    onClick={() => removeClassYear(idx)}
                    aria-label={`${cy} kaldır`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className="quick-add-row">
              {["1.S", "2.S", "3.S", "4.S", "Hazırlık"].map((label) => (
                <button
                  key={label}
                  type="button"
                  className="button button--ghost"
                  onClick={() => addClassYear(label)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="tag-input-row">
              <input
                value={newClassYear}
                placeholder="örn. 5.S"
                onChange={(e) => setNewClassYear(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addClassYear(newClassYear);
                    setNewClassYear("");
                  }
                }}
              />
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  addClassYear(newClassYear);
                  setNewClassYear("");
                }}
              >
                Ekle
              </button>
            </div>
          </div>
        );

      // ── Step 3: Derslikler ────────────────────────────────────────────
      case 3:
        return (
          <div className="wizard-step-content">
            <p className="wizard-hint">Derslik adı ve kapasitesini girin. Kapasite boş bırakılabilir.</p>

            <div className="room-list">
              {wizardState.rooms.map((room, idx) => (
                <div key={idx} className="room-row">
                  <input
                    className="room-row__name"
                    value={room.name}
                    placeholder="Derslik adı (örn. 102)"
                    onChange={(e) => updateRoom(idx, "name", e.target.value)}
                  />
                  <input
                    className="room-row__capacity"
                    type="number"
                    min={0}
                    value={room.capacity}
                    placeholder="Kapasite"
                    onChange={(e) => updateRoom(idx, "capacity", e.target.value)}
                  />
                  <button
                    type="button"
                    className="room-row__remove"
                    onClick={() => removeRoom(idx)}
                    aria-label="Dersliği kaldır"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <button type="button" className="button button--ghost" onClick={addRoom}>
              ＋ Derslik Ekle
            </button>
          </div>
        );

      // ── Step 4: Hocalar ───────────────────────────────────────────────
      case 4:
        return (
          <div className="wizard-step-content">
            <p className="wizard-hint">Öğretim üyelerini ekleyin.</p>

            <div className="tag-list">
              {wizardState.instructors.map((inst, idx) => (
                <span key={idx} className="tag-chip">
                  {inst}
                  <button
                    type="button"
                    className="tag-chip__remove"
                    onClick={() => removeInstructor(idx)}
                    aria-label={`${inst} kaldır`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className="tag-input-row">
              <input
                value={newInstructor}
                placeholder="örn. Dr. Ayşe Kaya"
                onChange={(e) => setNewInstructor(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addInstructor();
                  }
                }}
              />
              <button type="button" className="button button--ghost" onClick={addInstructor}>
                Ekle
              </button>
            </div>
          </div>
        );

      // ── Step 5: Dersler ───────────────────────────────────────────────
      case 5:
        return (
          <div className="wizard-step-content">
            <p className="wizard-hint">Her ders için bölüm, sınıf, hoca ve derslik atayın.</p>

            {wizardState.courses.map((course, idx) => (
              <div key={course.id} className="course-card">
                {/* Row 1: Ders adı */}
                <div className="course-card__header">
                  <input
                    value={course.courseName}
                    placeholder="Ders adı"
                    style={{ flex: 1 }}
                    onChange={(e) => updateCourse(idx, "courseName", e.target.value)}
                  />
                  <button
                    type="button"
                    className="course-card__remove"
                    onClick={() => removeCourse(idx)}
                    aria-label="Dersi kaldır"
                  >
                    ×
                  </button>
                </div>

                {/* Row 2: Bölüm + Sınıf */}
                <div className="course-card__row">
                  <input
                    value={course.programs}
                    placeholder="Bölüm(ler)"
                    list={`dl-programs-${course.id}`}
                    style={{ flex: 2 }}
                    onChange={(e) => updateCourse(idx, "programs", e.target.value)}
                  />
                  <datalist id={`dl-programs-${course.id}`}>
                    {wizardState.programs.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>

                  <select
                    value={course.classYear}
                    style={{ flex: 1 }}
                    onChange={(e) => updateCourse(idx, "classYear", e.target.value)}
                  >
                    <option value="">— Sınıf —</option>
                    {wizardState.classYears.map((cy) => (
                      <option key={cy} value={cy}>
                        {cy}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Row 3: Hoca + Derslik */}
                <div className="course-card__row">
                  <input
                    value={course.instructorText}
                    placeholder="Hoca"
                    list={`dl-instructors-${course.id}`}
                    style={{ flex: 1 }}
                    onChange={(e) => updateCourse(idx, "instructorText", e.target.value)}
                  />
                  <datalist id={`dl-instructors-${course.id}`}>
                    {wizardState.instructors.map((inst) => (
                      <option key={inst} value={inst} />
                    ))}
                  </datalist>

                  <input
                    value={course.locationText}
                    placeholder="Derslik"
                    list={`dl-rooms-${course.id}`}
                    style={{ flex: 1 }}
                    onChange={(e) => updateCourse(idx, "locationText", e.target.value)}
                  />
                  <datalist id={`dl-rooms-${course.id}`}>
                    {wizardState.rooms.map((r) => (
                      <option key={r.name} value={r.name} />
                    ))}
                  </datalist>
                </div>
              </div>
            ))}

            <button type="button" className="button button--ghost" onClick={addCourse}>
              ＋ Ders Ekle
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Okul profili</h2>
        <span className="panel__badge">{wizardState.courses.filter((c) => c.courseName.trim()).length}</span>
      </div>

      <form className="inspector profile-form" onSubmit={(e) => e.preventDefault()}>
        {/* Step indicator */}
        <div className="wizard-steps">
          {STEP_LABELS.map((label, i) => (
            <button
              key={i}
              type="button"
              className={`wizard-step-dot${step === i ? " wizard-step-dot--active" : step > i ? " wizard-step-dot--done" : ""}`}
              onClick={() => setStep(i)}
              title={label}
              aria-label={`${i + 1}. adım: ${label}`}
            >
              <span>{i + 1}</span>
              <span className="wizard-step-label">{label}</span>
            </button>
          ))}
        </div>

        {/* Step content */}
        {renderStep()}

        {/* Navigation bar */}
        <div className="wizard-nav">
          <div>
            {step > 0 && (
              <button type="button" className="button button--ghost" onClick={() => setStep((s) => s - 1)}>
                ← Geri
              </button>
            )}
          </div>

          <button type="button" className="button button--accent" onClick={handleSave}>
            Profili Kaydet
          </button>

          <div>
            {step < STEP_LABELS.length - 1 && (
              <button type="button" className="button button--ghost" onClick={() => setStep((s) => s + 1)}>
                İleri →
              </button>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="wizard-actions">
          <button
            type="button"
            className="button button--ghost"
            disabled={!document}
            onClick={() => {
              if (!document) {
                onStatus("error", "Önce bir çizelge yükleyin ya da açın.");
                return;
              }
              const nextProfile = wizardState.name.trim()
                ? buildProfileFromDocument(document, wizardState.name.trim())
                : buildProfileFromDocument(document);
              setWizardState(toWizardState(nextProfile));
              onStatus("info", "Mevcut çizelgeden profil taslağı dolduruldu.");
            }}
          >
            Çizelgeden Doldur
          </button>

          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              const profile = buildProfileFromWizard(wizardState);

              if (profile.courseTemplates.length === 0) {
                onStatus("error", "Önce profile en az bir ders ekleyin.");
                return;
              }

              const doc = buildAutoScheduleDocument(
                profile.courseTemplates.map((ct) => ({
                  programs: ct.programs,
                  classYear: ct.classYear,
                  courseName: ct.courseName,
                  instructorText: ct.instructorText,
                  locationText: ct.locationText,
                })),
                `${profile.name} profili`,
                {
                  profile,
                  fallbackTemplate: document?.template ?? null,
                },
              );

              onLoadDocument(doc, `${profile.name} profilinden sınav taslağı üretildi.`);
            }}
          >
            Taslak Oluştur
          </button>

          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              setWizardState(toWizardState(null));
              setStep(0);
              onStatus("info", "Yeni profil için boş form hazır.");
            }}
          >
            Yeni Profil
          </button>

          <button
            type="button"
            className="button button--danger"
            disabled={!activeProfile}
            onClick={() => {
              if (!activeProfile) return;
              const result = onDeleteProfile(activeProfile.id);
              onStatus(result.ok ? "info" : "error", result.message);
              setWizardState(toWizardState(null));
              setStep(0);
            }}
          >
            Profili Sil
          </button>
        </div>
      </form>
    </section>
  );
};
