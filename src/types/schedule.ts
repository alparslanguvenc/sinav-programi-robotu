export interface ScheduleView {
  id: string;
  label: string;
  classYear: string | null;
  /** Bölüm/program filtresi (null = tüm bölümler) */
  program?: string | null;
}

export interface ScheduleTemplate {
  dates: string[];
  times: string[];
  views: ScheduleView[];
}

export interface ExamCard {
  id: string;
  courseName: string;
  classYear: string;
  programs: string[];
  slotKey: string;
  rooms: string[];
  locationText?: string | null;
  instructorText?: string | null;
  parallelGroupId: string | null;
  notes: string | null;
  /** Sınav süresi (dakika). Varsayılan: 60 */
  durationMinutes?: number;
  /** Sınava girecek öğrenci sayısı (kapasite kontrolü için) */
  studentCount?: number | null;
  /** Seçmeli grup kimliği: aynı gruptaki sınavlar arasında sınıf çakışması algılanmaz */
  electiveGroupId?: string | null;
}

export interface Conflict {
  id: string;
  type: "room" | "class" | "instructor" | "capacity" | "duration-overlap";
  slotKey: string;
  resourceKey: string;
  cardIds: string[];
  severity: "warning";
}

export interface SourceWorkbookMeta {
  generalTitle: string | null;
  classSheetTitles: Record<string, string>;
  notesRows: Array<string | null>;
  sourceFileName?: string | null;
  importedFrom?: "exam-workbook" | "auto-generated";
}

export interface ScheduleDocument {
  template: ScheduleTemplate;
  exams: ExamCard[];
  sourceMeta: SourceWorkbookMeta;
}

export interface ProfileCourseTemplate {
  id: string;
  programs: string[];
  classYear: string;
  courseName: string;
  instructorText: string | null;
  locationText: string | null;
}

export interface SchoolProfile {
  id: string;
  name: string;
  updatedAt: string;
  dates: string[];
  times: string[];
  programs: string[];
  classYears: string[];
  rooms: string[];
  instructors: string[];
  courseTemplates: ProfileCourseTemplate[];
  /** Varsayılan sınav süresi (dakika). Varsayılan: 60 */
  defaultExamDuration?: number;
  /** Derslik adı → kapasite eşlemesi */
  roomCapacities?: Record<string, number>;
  /** Opsiyonel Google Gemini API anahtarı */
  geminiApiKey?: string;
}

export interface SavedScheduleRecord {
  id: string;
  name: string;
  updatedAt: string;
  document: ScheduleDocument;
}

export interface ScheduleJsonEnvelope {
  version: 1;
  document: ScheduleDocument;
}

export type UiScale = "small" | "normal" | "large";
