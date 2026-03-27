export interface ScheduleView {
  id: string;
  label: string;
  classYear: string | null;
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
  slotKey: string;
  rooms: string[];
  locationText?: string | null;
  instructorText?: string | null;
  parallelGroupId: string | null;
  notes: string | null;
}

export interface Conflict {
  id: string;
  type: "room" | "class";
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
  classYears: string[];
  rooms: string[];
  instructors: string[];
  courseTemplates: ProfileCourseTemplate[];
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
