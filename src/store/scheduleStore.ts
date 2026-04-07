import { create } from "zustand";
import { serializeScheduleDocument } from "../lib/document";
import {
  ACTIVE_PROFILE_STORAGE_KEY,
  PROFILE_STORAGE_KEY,
  normalizeSchoolProfile,
} from "../lib/profiles";
import {
  ACTIVE_SAVED_RECORD_STORAGE_KEY,
  SAVED_RECORDS_STORAGE_KEY,
  STORAGE_KEY,
  UI_SCALE_STORAGE_KEY,
  createBlankExam,
  createViews,
  getDefaultSlotKey,
  insertTimeSorted,
  normalizeClassYear,
  normalizePrograms,
  normalizeDocument,
} from "../lib/schedule";
import type {
  ExamCard,
  SavedScheduleRecord,
  ScheduleDocument,
  SchoolProfile,
  UiScale,
} from "../types/schedule";

const HISTORY_LIMIT = 60;

const isUiScale = (value: string | null): value is UiScale =>
  value === "small" || value === "normal" || value === "large";

interface ScheduleState {
  document: ScheduleDocument | null;
  history: ScheduleDocument[];
  savedRecords: SavedScheduleRecord[];
  profiles: SchoolProfile[];
  activeSavedRecordId: string | null;
  activeProfileId: string | null;
  activeViewId: string;
  selectedCardId: string | null;
  conflictsOpen: boolean;
  uiScale: UiScale;
  loadDocument: (document: ScheduleDocument, options?: { savedRecordId?: string | null }) => void;
  hydrateFromStorage: () => boolean;
  saveProfile: (profile: SchoolProfile) => { ok: boolean; message: string; profileId?: string };
  deleteProfile: (profileId: string) => { ok: boolean; message: string };
  setActiveProfile: (profileId: string | null) => void;
  setActiveView: (viewId: string) => void;
  selectCard: (cardId: string | null) => void;
  moveExam: (cardId: string, slotKey: string) => void;
  updateExam: (cardId: string, patch: Partial<ExamCard>) => void;
  addExam: (slotKey?: string, classYear?: string | null) => void;
  duplicateExam: (cardId: string) => void;
  deleteExam: (cardId: string) => void;
  addTimeBlock: (time: string) => { ok: boolean; message: string; normalizedTime?: string };
  saveCurrentDocument: (name: string) => { ok: boolean; message: string; savedRecordId?: string };
  loadSavedRecord: (savedRecordId: string) => { ok: boolean; message: string };
  newDocument: () => void;
  deleteSavedRecord: (savedRecordId: string) => void;
  clearAllRecords: () => void;
  toggleConflicts: () => void;
  undo: () => void;
  setUiScale: (uiScale: UiScale) => void;
  resetForTests: (document?: ScheduleDocument | null) => void;
}

type DesktopStateSnapshot = {
  version?: number;
  document?: ScheduleDocument | null;
  savedRecords?: SavedScheduleRecord[];
  activeSavedRecordId?: string | null;
  profiles?: SchoolProfile[];
  activeProfileId?: string | null;
  uiScale?: UiScale;
};

const getDesktopStorageBridge = () =>
  typeof window !== "undefined" ? window.sinavProgramiRobotu?.storage ?? null : null;

const readDesktopStateSnapshot = (): DesktopStateSnapshot | null => {
  const bridge = getDesktopStorageBridge();

  if (!bridge?.readSync) {
    return null;
  }

  try {
    const snapshot = bridge.readSync();
    return snapshot && typeof snapshot === "object" ? (snapshot as DesktopStateSnapshot) : null;
  } catch {
    return null;
  }
};

const persistDesktopStatePatch = (patch: Partial<DesktopStateSnapshot>) => {
  const bridge = getDesktopStorageBridge();

  if (!bridge?.readSync || !bridge.writeSync) {
    return;
  }

  try {
    const current = readDesktopStateSnapshot() ?? {};
    bridge.writeSync({
      ...current,
      version: 1,
      ...patch,
    });
  } catch {
    // Masaüstü dosya yedeği başarısız olsa da localStorage çalışmaya devam eder.
  }
};

const persistDocument = (document: ScheduleDocument | null) => {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  if (!document) {
    window.localStorage.removeItem(STORAGE_KEY);
    persistDesktopStatePatch({ document: null });
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, serializeScheduleDocument(document));
  persistDesktopStatePatch({ document });
};

const sortSavedRecords = (savedRecords: SavedScheduleRecord[]) =>
  [...savedRecords].sort((left, right) => {
    const updatedDelta = right.updatedAt.localeCompare(left.updatedAt, "tr");
    return updatedDelta !== 0 ? updatedDelta : left.name.localeCompare(right.name, "tr");
  });

const readSavedRecords = (): SavedScheduleRecord[] => {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }

  const raw = window.localStorage.getItem(SAVED_RECORDS_STORAGE_KEY);
  const backupRecords = readDesktopStateSnapshot()?.savedRecords;

  if (!raw) {
    return Array.isArray(backupRecords)
      ? sortSavedRecords(
          backupRecords
            .filter(
              (record) =>
                record &&
                typeof record.id === "string" &&
                typeof record.name === "string" &&
                typeof record.updatedAt === "string" &&
                record.document,
            )
            .map((record) => ({
              ...record,
              name: record.name.trim(),
              document: normalizeDocument(record.document),
            })),
        )
      : [];
  }

  try {
    const parsed = JSON.parse(raw) as { records?: SavedScheduleRecord[] } | SavedScheduleRecord[];
    const records = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.records)
        ? parsed.records
        : [];

    return sortSavedRecords(
      records
        .filter(
          (record) =>
            record &&
            typeof record.id === "string" &&
            typeof record.name === "string" &&
            typeof record.updatedAt === "string" &&
            record.document,
        )
        .map((record) => ({
          ...record,
          name: record.name.trim(),
          document: normalizeDocument(record.document),
        })),
    );
  } catch {
    return [];
  }
};

const persistSavedRecords = (savedRecords: SavedScheduleRecord[]) => {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  if (savedRecords.length === 0) {
    window.localStorage.removeItem(SAVED_RECORDS_STORAGE_KEY);
    persistDesktopStatePatch({ savedRecords: [] });
    return;
  }

  window.localStorage.setItem(
    SAVED_RECORDS_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      records: savedRecords,
    }),
  );
  persistDesktopStatePatch({ savedRecords });
};

const readActiveSavedRecordId = () => {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  return window.localStorage.getItem(ACTIVE_SAVED_RECORD_STORAGE_KEY) ?? readDesktopStateSnapshot()?.activeSavedRecordId ?? null;
};

const persistActiveSavedRecordId = (savedRecordId: string | null) => {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  if (!savedRecordId) {
    window.localStorage.removeItem(ACTIVE_SAVED_RECORD_STORAGE_KEY);
    persistDesktopStatePatch({ activeSavedRecordId: null });
    return;
  }

  window.localStorage.setItem(ACTIVE_SAVED_RECORD_STORAGE_KEY, savedRecordId);
  persistDesktopStatePatch({ activeSavedRecordId: savedRecordId });
};

const readUiScale = (): UiScale => {
  if (typeof window === "undefined" || !window.localStorage) {
    return "normal";
  }

  const stored = window.localStorage.getItem(UI_SCALE_STORAGE_KEY);
  if (isUiScale(stored)) {
    return stored;
  }

  const backupUiScale = readDesktopStateSnapshot()?.uiScale ?? null;
  return isUiScale(backupUiScale) ? backupUiScale : "normal";
};

const persistUiScale = (uiScale: UiScale) => {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  window.localStorage.setItem(UI_SCALE_STORAGE_KEY, uiScale);
  persistDesktopStatePatch({ uiScale });
};

const sortProfiles = (profiles: SchoolProfile[]) =>
  [...profiles].sort((left, right) => {
    const updatedDelta = right.updatedAt.localeCompare(left.updatedAt, "tr");
    return updatedDelta !== 0 ? updatedDelta : left.name.localeCompare(right.name, "tr");
  });

const readProfiles = (): SchoolProfile[] => {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }

  const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
  const backupProfiles = readDesktopStateSnapshot()?.profiles;

  if (!raw) {
    return Array.isArray(backupProfiles)
      ? sortProfiles(
          backupProfiles
            .filter(
              (profile) =>
                profile &&
                typeof profile.id === "string" &&
                typeof profile.name === "string" &&
                Array.isArray(profile.dates) &&
                Array.isArray(profile.times),
            )
            .map((profile) => normalizeSchoolProfile(profile)),
        )
      : [];
  }

  try {
    const parsed = JSON.parse(raw) as { profiles?: SchoolProfile[] } | SchoolProfile[];
    const profiles = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.profiles)
        ? parsed.profiles
        : [];

    return sortProfiles(
      profiles
        .filter(
          (profile) =>
            profile &&
            typeof profile.id === "string" &&
            typeof profile.name === "string" &&
            Array.isArray(profile.dates) &&
            Array.isArray(profile.times),
        )
        .map((profile) => normalizeSchoolProfile(profile)),
    );
  } catch {
    return [];
  }
};

const persistProfiles = (profiles: SchoolProfile[]) => {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  if (profiles.length === 0) {
    window.localStorage.removeItem(PROFILE_STORAGE_KEY);
    persistDesktopStatePatch({ profiles: [] });
    return;
  }

  window.localStorage.setItem(
    PROFILE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      profiles,
    }),
  );
  persistDesktopStatePatch({ profiles });
};

const readActiveProfileId = () => {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  return window.localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY) ?? readDesktopStateSnapshot()?.activeProfileId ?? null;
};

const persistActiveProfileId = (profileId: string | null) => {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  if (!profileId) {
    window.localStorage.removeItem(ACTIVE_PROFILE_STORAGE_KEY);
    persistDesktopStatePatch({ activeProfileId: null });
    return;
  }

  window.localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, profileId);
  persistDesktopStatePatch({ activeProfileId: profileId });
};

const ensureViews = (document: ScheduleDocument) => {
  const classYears = [
    ...new Set([
      ...Object.keys(document.sourceMeta.classSheetTitles),
      ...document.exams.map((exam) => normalizeClassYear(exam.classYear)),
    ]),
  ];

  return normalizeDocument({
    ...document,
    template: {
      ...document.template,
      views: createViews(classYears),
    },
  });
};

const getFallbackClassYear = (document: ScheduleDocument) =>
  document.template.views.find((view) => view.classYear)?.classYear ?? "1.S";

const pushHistory = (history: ScheduleDocument[], document: ScheduleDocument | null) => {
  if (!document) {
    return history;
  }

  return [...history.slice(-(HISTORY_LIMIT - 1)), document];
};

const buildLoadedDocumentState = (
  currentActiveViewId: string,
  document: ScheduleDocument,
  savedRecordId: string | null,
) => ({
  document,
  history: [],
  activeViewId: document.template.views.some((view) => view.id === currentActiveViewId)
    ? currentActiveViewId
    : "genel",
  selectedCardId: null,
  activeSavedRecordId: savedRecordId,
});

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  document: null,
  history: [],
  savedRecords: readSavedRecords(),
  profiles: readProfiles(),
  activeSavedRecordId: readActiveSavedRecordId(),
  activeProfileId: readActiveProfileId(),
  activeViewId: "genel",
  selectedCardId: null,
  conflictsOpen: true,
  uiScale: readUiScale(),
  loadDocument: (document, options) => {
    const normalized = ensureViews(document);
    const savedRecordId = options?.savedRecordId ?? null;
    persistDocument(normalized);
    persistActiveSavedRecordId(savedRecordId);
    set({
      ...buildLoadedDocumentState(get().activeViewId, normalized, savedRecordId),
    });
  },
  hydrateFromStorage: () => {
    if (typeof window === "undefined" || !window.localStorage) {
      return false;
    }

    const savedRecords = readSavedRecords();
    const profiles = readProfiles();
    const activeSavedRecordId = readActiveSavedRecordId();
    const activeProfileId = readActiveProfileId();

    // Sadece profilleri ve kayıtları yükle — belge açma, kullanıcı seçsin
    set({
      savedRecords,
      profiles,
      activeSavedRecordId:
        activeSavedRecordId && savedRecords.some((record) => record.id === activeSavedRecordId)
          ? activeSavedRecordId
          : null,
      activeProfileId,
    });
    return savedRecords.length > 0 || profiles.length > 0;
  },
  saveProfile: (profile) => {
    const normalized = normalizeSchoolProfile({
      ...profile,
      updatedAt: new Date().toISOString(),
    });

    if (!normalized.name.trim()) {
      return {
        ok: false,
        message: "Profil adı boş olamaz.",
      };
    }

    const state = get();
    const nextProfiles = sortProfiles([
      ...state.profiles.filter((item) => item.id !== normalized.id),
      normalized,
    ]);

    persistProfiles(nextProfiles);
    persistActiveProfileId(normalized.id);
    set({
      profiles: nextProfiles,
      activeProfileId: normalized.id,
    });

    return {
      ok: true,
      message: `${normalized.name} profili kaydedildi.`,
      profileId: normalized.id,
    };
  },
  deleteProfile: (profileId) => {
    const state = get();
    const target = state.profiles.find((profile) => profile.id === profileId);

    if (!target) {
      return {
        ok: false,
        message: "Silinecek profil bulunamadı.",
      };
    }

    const nextProfiles = state.profiles.filter((profile) => profile.id !== profileId);
    const nextActiveProfileId =
      state.activeProfileId === profileId ? nextProfiles[0]?.id ?? null : state.activeProfileId;

    persistProfiles(nextProfiles);
    persistActiveProfileId(nextActiveProfileId);
    set({
      profiles: nextProfiles,
      activeProfileId: nextActiveProfileId,
    });

    return {
      ok: true,
      message: `${target.name} profili silindi.`,
    };
  },
  setActiveProfile: (profileId) => {
    persistActiveProfileId(profileId);
    set({ activeProfileId: profileId });
  },
  setActiveView: (activeViewId) => set({ activeViewId }),
  selectCard: (selectedCardId) => set({ selectedCardId }),
  moveExam: (cardId, slotKey) =>
    set((state) => {
      if (!state.document) {
        return state;
      }

      const sourceExam = state.document.exams.find((exam) => exam.id === cardId);
      if (!sourceExam || sourceExam.slotKey === slotKey) {
        return state;
      }

      const document = ensureViews({
        ...state.document,
        exams: state.document.exams.map((exam) =>
          exam.id === cardId ? { ...exam, slotKey } : exam,
        ),
      });

      persistDocument(document);
      return { ...state, document, history: pushHistory(state.history, state.document) };
    }),
  updateExam: (cardId, patch) =>
    set((state) => {
      if (!state.document) {
        return state;
      }

      const document = ensureViews({
        ...state.document,
        exams: state.document.exams.map((exam) =>
          exam.id === cardId
            ? {
                ...exam,
                ...patch,
                classYear: normalizeClassYear(patch.classYear ?? exam.classYear),
                programs: normalizePrograms(patch.programs ?? exam.programs),
                rooms: patch.rooms ?? exam.rooms,
              }
            : exam,
        ),
      });

      persistDocument(document);
      return { ...state, document, history: pushHistory(state.history, state.document) };
    }),
  addExam: (slotKey, classYear) =>
    set((state) => {
      if (!state.document) {
        return state;
      }

      const effectiveSlotKey = slotKey || getDefaultSlotKey(state.document);
      const effectiveClassYear = normalizeClassYear(classYear || getFallbackClassYear(state.document));
      const newExam = createBlankExam(effectiveSlotKey, effectiveClassYear);
      const document = ensureViews({
        ...state.document,
        exams: [...state.document.exams, newExam],
      });

      persistDocument(document);
      return {
        ...state,
        document,
        history: pushHistory(state.history, state.document),
        selectedCardId: newExam.id,
        activeViewId:
          classYear && document.template.views.some((view) => view.classYear === effectiveClassYear)
            ? `class:${effectiveClassYear}`
            : state.activeViewId,
      };
    }),
  duplicateExam: (cardId) =>
    set((state) => {
      if (!state.document) {
        return state;
      }

      const sourceExam = state.document.exams.find((exam) => exam.id === cardId);
      if (!sourceExam) {
        return state;
      }

      const duplicate: ExamCard = {
        ...sourceExam,
        id: crypto.randomUUID(),
      };
      const document = ensureViews({
        ...state.document,
        exams: [...state.document.exams, duplicate],
      });

      persistDocument(document);
      return {
        ...state,
        document,
        history: pushHistory(state.history, state.document),
        selectedCardId: duplicate.id,
      };
    }),
  deleteExam: (cardId) =>
    set((state) => {
      if (!state.document) {
        return state;
      }

      const document = ensureViews({
        ...state.document,
        exams: state.document.exams.filter((exam) => exam.id !== cardId),
      });

      persistDocument(document);
      return {
        ...state,
        document,
        history: pushHistory(state.history, state.document),
        selectedCardId: state.selectedCardId === cardId ? null : state.selectedCardId,
      };
    }),
  addTimeBlock: (time) => {
    const state = get();

    if (!state.document) {
      return {
        ok: false,
        message: "Önce bir çizelge yükleyin.",
      };
    }

    const inserted = insertTimeSorted(state.document.template.times, time);

    if (!inserted.ok) {
      return inserted;
    }

    const document = ensureViews({
      ...state.document,
      template: {
        ...state.document.template,
        times: inserted.times,
      },
    });

    persistDocument(document);
    set({
      document,
      history: pushHistory(state.history, state.document),
    });

    return {
      ok: true,
      message: "Saat bloğu eklendi.",
      normalizedTime: inserted.normalizedTime,
    };
  },
  saveCurrentDocument: (name) => {
    const state = get();

    if (!state.document) {
      return {
        ok: false,
        message: "Önce bir çizelge yükleyin.",
      };
    }

    const trimmedName = name.trim();

    if (!trimmedName) {
      return {
        ok: false,
        message: "Kayıt adı boş olamaz.",
      };
    }

    const activeRecord =
      state.activeSavedRecordId
        ? state.savedRecords.find((record) => record.id === state.activeSavedRecordId) ?? null
        : null;
    const sameNameRecord =
      state.savedRecords.find(
        (record) => record.name.localeCompare(trimmedName, "tr", { sensitivity: "base" }) === 0,
      ) ?? null;

    const targetRecordId =
      activeRecord &&
      activeRecord.name.localeCompare(trimmedName, "tr", { sensitivity: "base" }) === 0
        ? activeRecord.id
        : sameNameRecord?.id ?? crypto.randomUUID();

    const nextRecords = sortSavedRecords([
      ...state.savedRecords.filter((record) => record.id !== targetRecordId),
      {
        id: targetRecordId,
        name: trimmedName,
        updatedAt: new Date().toISOString(),
        document: state.document,
      },
    ]);

    persistSavedRecords(nextRecords);
    persistActiveSavedRecordId(targetRecordId);
    set({
      savedRecords: nextRecords,
      activeSavedRecordId: targetRecordId,
    });

    return {
      ok: true,
      message: sameNameRecord || activeRecord?.id === targetRecordId
        ? `${trimmedName} kaydı güncellendi.`
        : `${trimmedName} kaydı oluşturuldu.`,
      savedRecordId: targetRecordId,
    };
  },
  loadSavedRecord: (savedRecordId) => {
    const state = get();
    const savedRecords = state.savedRecords.length > 0 ? state.savedRecords : readSavedRecords();
    const savedRecord = savedRecords.find((record) => record.id === savedRecordId);

    if (!savedRecord) {
      return {
        ok: false,
        message: "Seçilen kayıt bulunamadı.",
      };
    }

    const normalized = ensureViews(savedRecord.document);
    persistDocument(normalized);
    persistActiveSavedRecordId(savedRecord.id);
    set((currentState) => ({
      savedRecords,
      ...buildLoadedDocumentState(currentState.activeViewId, normalized, savedRecord.id),
    }));

    return {
      ok: true,
      message: `${savedRecord.name} açıldı.`,
    };
  },
  newDocument: () => {
    persistDocument(null);
    persistActiveSavedRecordId(null);
    set({
      document: null,
      history: [],
      activeSavedRecordId: null,
      selectedCardId: null,
      activeViewId: "genel",
    });
  },
  deleteSavedRecord: (savedRecordId) => {
    const state = get();
    const nextRecords = state.savedRecords.filter((r) => r.id !== savedRecordId);
    persistSavedRecords(nextRecords);
    const nextActiveSavedRecordId =
      state.activeSavedRecordId === savedRecordId ? null : state.activeSavedRecordId;
    persistActiveSavedRecordId(nextActiveSavedRecordId);
    set({
      savedRecords: nextRecords,
      activeSavedRecordId: nextActiveSavedRecordId,
      ...(state.activeSavedRecordId === savedRecordId
        ? { document: null, history: [], selectedCardId: null, activeViewId: "genel" }
        : {}),
    });
    if (state.activeSavedRecordId === savedRecordId) {
      persistDocument(null);
    }
  },
  clearAllRecords: () => {
    persistSavedRecords([]);
    persistDocument(null);
    persistActiveSavedRecordId(null);
    set({
      savedRecords: [],
      document: null,
      history: [],
      activeSavedRecordId: null,
      selectedCardId: null,
      activeViewId: "genel",
    });
  },
  toggleConflicts: () => set((state) => ({ conflictsOpen: !state.conflictsOpen })),
  undo: () =>
    set((state) => {
      const previous = state.history[state.history.length - 1];

      if (!previous) {
        return state;
      }

      persistDocument(previous);
      return {
        ...state,
        document: previous,
        history: state.history.slice(0, -1),
        selectedCardId:
          state.selectedCardId && previous.exams.some((exam) => exam.id === state.selectedCardId)
            ? state.selectedCardId
            : null,
        activeViewId: previous.template.views.some((view) => view.id === state.activeViewId)
          ? state.activeViewId
          : "genel",
      };
    }),
  setUiScale: (uiScale) => {
    persistUiScale(uiScale);
    set({ uiScale });
  },
  resetForTests: (document) =>
    {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(STORAGE_KEY);
        window.localStorage.removeItem(SAVED_RECORDS_STORAGE_KEY);
        window.localStorage.removeItem(ACTIVE_SAVED_RECORD_STORAGE_KEY);
        window.localStorage.removeItem(PROFILE_STORAGE_KEY);
        window.localStorage.removeItem(ACTIVE_PROFILE_STORAGE_KEY);
      }

      set({
        document: document ? ensureViews(document) : null,
        history: [],
        savedRecords: [],
        profiles: [],
        activeSavedRecordId: null,
        activeProfileId: null,
        activeViewId: "genel",
        selectedCardId: null,
        conflictsOpen: true,
        uiScale: "normal",
      });
    },
}));
