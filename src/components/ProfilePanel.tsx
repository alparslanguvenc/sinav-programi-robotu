import { useEffect, useState } from "react";
import {
  buildProfileFromDocument,
  createBlankProfile,
  normalizeSchoolProfile,
  parseCourseTemplatesInput,
  parseMultilineList,
  stringifyCourseTemplates,
  stringifyMultilineList,
} from "../lib/profiles";
import { buildAutoScheduleDocument } from "../lib/source-import";
import type { ScheduleDocument, SchoolProfile } from "../types/schedule";

interface ProfilePanelProps {
  activeProfile: SchoolProfile | null;
  document: ScheduleDocument | null;
  onSaveProfile: (profile: SchoolProfile) => { ok: boolean; message: string; profileId?: string };
  onDeleteProfile: (profileId: string) => { ok: boolean; message: string };
  onLoadDocument: (document: ScheduleDocument, message: string) => void;
  onStatus: (tone: "info" | "error", message: string) => void;
}

interface ProfileFormState {
  id: string;
  name: string;
  dates: string;
  times: string;
  classYears: string;
  rooms: string;
  instructors: string;
  courseTemplates: string;
}

const toFormState = (profile: SchoolProfile | null): ProfileFormState => {
  const source = profile ?? createBlankProfile();

  return {
    id: source.id,
    name: source.name,
    dates: stringifyMultilineList(source.dates),
    times: stringifyMultilineList(source.times),
    classYears: stringifyMultilineList(source.classYears),
    rooms: stringifyMultilineList(source.rooms),
    instructors: stringifyMultilineList(source.instructors),
    courseTemplates: stringifyCourseTemplates(source.courseTemplates),
  };
};

export const ProfilePanel = ({
  activeProfile,
  document,
  onSaveProfile,
  onDeleteProfile,
  onLoadDocument,
  onStatus,
}: ProfilePanelProps) => {
  const [formState, setFormState] = useState<ProfileFormState>(() => toFormState(activeProfile));

  useEffect(() => {
    setFormState(toFormState(activeProfile));
  }, [activeProfile]);

  const handleFieldChange = (field: keyof ProfileFormState, value: string) => {
    setFormState((currentState) => ({
      ...currentState,
      [field]: value,
    }));
  };

  const buildProfileFromForm = () =>
    normalizeSchoolProfile({
      id: formState.id || crypto.randomUUID(),
      name: formState.name,
      updatedAt: new Date().toISOString(),
      dates: parseMultilineList(formState.dates),
      times: parseMultilineList(formState.times),
      classYears: parseMultilineList(formState.classYears),
      rooms: parseMultilineList(formState.rooms),
      instructors: parseMultilineList(formState.instructors),
      courseTemplates: parseCourseTemplatesInput(formState.courseTemplates),
    });

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Okul profili</h2>
        <span className="panel__badge">{activeProfile?.courseTemplates.length ?? 0}</span>
      </div>

      <p className="panel__muted">
        Tarih, saat, ders, hoca, derslik ve sınıf şablonlarını saklayın. PDF, Word veya Excel
        ders programı yüklenince otomatik sınav taslağı bu profille zenginleştirilir.
      </p>

      <form className="inspector profile-form" onSubmit={(event) => event.preventDefault()}>
        <label>
          Profil adı
          <input
            value={formState.name}
            placeholder="örn. İletişim Fakültesi Bahar"
            onChange={(event) => handleFieldChange("name", event.target.value)}
          />
        </label>

        <label>
          Tarihler
          <textarea
            rows={4}
            value={formState.dates}
            placeholder={"Her satıra bir tarih\nPzt 23.03.2026"}
            onChange={(event) => handleFieldChange("dates", event.target.value)}
          />
        </label>

        <label>
          Saatler
          <textarea
            rows={4}
            value={formState.times}
            placeholder={"Her satıra bir saat\n09:00"}
            onChange={(event) => handleFieldChange("times", event.target.value)}
          />
        </label>

        <label>
          Sınıflar
          <textarea
            rows={4}
            value={formState.classYears}
            placeholder={"Her satıra bir sınıf\n1.S"}
            onChange={(event) => handleFieldChange("classYears", event.target.value)}
          />
        </label>

        <label>
          Derslikler
          <textarea
            rows={4}
            value={formState.rooms}
            placeholder={"Her satıra bir derslik\n102-103"}
            onChange={(event) => handleFieldChange("rooms", event.target.value)}
          />
        </label>

        <label>
          Hocalar
          <textarea
            rows={4}
            value={formState.instructors}
            placeholder={"Her satıra bir hoca\nDr. Ayşe Kaya"}
            onChange={(event) => handleFieldChange("instructors", event.target.value)}
          />
        </label>

        <label>
          Ders şablonları
          <textarea
            rows={7}
            value={formState.courseTemplates}
            placeholder={
              "Biçim: sınıf | ders | hoca | derslik\n1.S | Arkeoloji | Dr. Ayşe Kaya | 102-103"
            }
            onChange={(event) => handleFieldChange("courseTemplates", event.target.value)}
          />
        </label>

        <div className="inspector__actions">
          <button
            type="button"
            className="button button--accent"
            onClick={() => {
              const result = onSaveProfile(buildProfileFromForm());
              onStatus(result.ok ? "info" : "error", result.message);
            }}
          >
            Profili kaydet
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              if (!document) {
                onStatus("error", "Önce bir çizelge yükleyin ya da açın.");
                return;
              }

              const nextProfile = formState.name.trim()
                ? buildProfileFromDocument(document, formState.name.trim())
                : buildProfileFromDocument(document);
              setFormState(toFormState(nextProfile));
              onStatus("info", "Mevcut çizelgeden profil taslağı dolduruldu.");
            }}
          >
            Çizelgeden doldur
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              const profile = buildProfileFromForm();

              if (profile.courseTemplates.length === 0) {
                onStatus("error", "Önce profile en az bir ders şablonu ekleyin.");
                return;
              }

              const documentFromProfile = buildAutoScheduleDocument(
                profile.courseTemplates.map((courseTemplate) => ({
                  classYear: courseTemplate.classYear,
                  courseName: courseTemplate.courseName,
                  instructorText: courseTemplate.instructorText,
                  locationText: courseTemplate.locationText,
                })),
                `${profile.name} profili`,
                {
                  profile,
                  fallbackTemplate: document?.template ?? null,
                },
              );

              onLoadDocument(documentFromProfile, `${profile.name} profilinden sınav taslağı üretildi.`);
            }}
          >
            Profilden taslak oluştur
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              setFormState(toFormState(null));
              onStatus("info", "Yeni profil için boş form hazır.");
            }}
          >
            Yeni profil
          </button>
          <button
            type="button"
            className="button button--danger"
            disabled={!activeProfile}
            onClick={() => {
              if (!activeProfile) {
                return;
              }

              const result = onDeleteProfile(activeProfile.id);
              onStatus(result.ok ? "info" : "error", result.message);
              setFormState(toFormState(null));
            }}
          >
            Profili sil
          </button>
        </div>
      </form>
    </section>
  );
};
