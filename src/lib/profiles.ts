import {
  DEFAULT_EXAM_DURATION,
  formatPrograms,
  formatRooms,
  normalizeClassYear,
  normalizePrograms,
  normalizeTimeInput,
  parseProgramsInput,
  sortClassYears,
} from "./schedule";
import type {
  ProfileCourseTemplate,
  ScheduleDocument,
  SchoolProfile,
} from "../types/schedule";

export const PROFILE_STORAGE_KEY = "vize-programi-editor.school-profiles";
export const ACTIVE_PROFILE_STORAGE_KEY = "vize-programi-editor.active-profile";

const sanitizeList = (values: string[]) =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

export const parseMultilineList = (raw: string) =>
  sanitizeList(
    raw
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean),
  );

export const stringifyMultilineList = (values: string[]) => sanitizeList(values).join("\n");

export const createBlankProfile = (name = "Yeni Okul Profili"): SchoolProfile => ({
  id: crypto.randomUUID(),
  name,
  updatedAt: new Date().toISOString(),
  dates: [],
  times: [],
  programs: [],
  classYears: [],
  rooms: [],
  instructors: [],
  courseTemplates: [],
  defaultExamDuration: DEFAULT_EXAM_DURATION,
  roomCapacities: {},
  geminiApiKey: undefined,
});

const normalizeCourseTemplate = (
  courseTemplate: ProfileCourseTemplate,
): ProfileCourseTemplate | null => {
  const courseName = courseTemplate.courseName.trim();

  if (!courseName) {
    return null;
  }

  return {
    id: courseTemplate.id || crypto.randomUUID(),
    programs: normalizePrograms(courseTemplate.programs ?? []),
    classYear: normalizeClassYear(courseTemplate.classYear),
    courseName,
    instructorText: courseTemplate.instructorText?.trim() || null,
    locationText: courseTemplate.locationText?.trim() || null,
  };
};

export const normalizeSchoolProfile = (profile: SchoolProfile): SchoolProfile => {
  const dates = sanitizeList(profile.dates);
  const times = sanitizeList(profile.times)
    .map((time) => normalizeTimeInput(time) ?? time.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "tr"));
  const classYears = sortClassYears(profile.classYears);
  const programs = sanitizeList(profile.programs ?? []);
  const rooms = sanitizeList(profile.rooms);
  const instructors = sanitizeList(profile.instructors);
  const courseTemplates = profile.courseTemplates
    .map(normalizeCourseTemplate)
    .filter((courseTemplate): courseTemplate is ProfileCourseTemplate => Boolean(courseTemplate))
    .sort((left, right) => {
      const classDelta = normalizeClassYear(left.classYear).localeCompare(
        normalizeClassYear(right.classYear),
        "tr",
      );

      if (classDelta !== 0) {
        return classDelta;
      }

      const programDelta = formatPrograms(left.programs).localeCompare(formatPrograms(right.programs), "tr");

      if (programDelta !== 0) {
        return programDelta;
      }

      return left.courseName.localeCompare(right.courseName, "tr");
    });

  const duration = profile.defaultExamDuration;
  const defaultExamDuration =
    typeof duration === "number" && duration > 0 ? duration : DEFAULT_EXAM_DURATION;

  const rawCapacities = profile.roomCapacities ?? {};
  const roomCapacities: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawCapacities)) {
    const trimmedKey = key.trim();
    if (trimmedKey && typeof value === "number" && value > 0) {
      roomCapacities[trimmedKey] = value;
    }
  }

  return {
    ...profile,
    id: profile.id || crypto.randomUUID(),
    name: profile.name.trim() || "Adsız Profil",
    updatedAt: profile.updatedAt || new Date().toISOString(),
    dates,
    times,
    programs,
    classYears,
    rooms,
    instructors,
    courseTemplates,
    defaultExamDuration,
    roomCapacities,
    geminiApiKey: profile.geminiApiKey?.trim() || undefined,
  };
};

export const parseCourseTemplatesInput = (raw: string) =>
  raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      const [programsPart = "", classYear = "", courseName = "", instructorText = "", locationText = ""] =
        parts.length >= 5
          ? parts
          : ["", parts[0] ?? "", parts[1] ?? "", parts[2] ?? "", parts[3] ?? ""];

      return normalizeCourseTemplate({
        id: crypto.randomUUID(),
        programs: parseProgramsInput(programsPart),
        classYear,
        courseName,
        instructorText: instructorText || null,
        locationText: locationText || null,
      });
    })
    .filter((courseTemplate): courseTemplate is ProfileCourseTemplate => Boolean(courseTemplate));

export const stringifyCourseTemplates = (courseTemplates: ProfileCourseTemplate[]) =>
  courseTemplates
    .map((courseTemplate) =>
      [
        formatPrograms(courseTemplate.programs),
        courseTemplate.classYear,
        courseTemplate.courseName,
        courseTemplate.instructorText ?? "",
        courseTemplate.locationText ?? "",
      ].join(" | "),
    )
    .join("\n");

export const buildProfileFromDocument = (
  document: ScheduleDocument,
  name = document.sourceMeta.generalTitle ?? "Mevcut Çizelge Profili",
): SchoolProfile => {
  const programs = sanitizeList(document.exams.flatMap((exam) => exam.programs));
  const classYears = sortClassYears(document.exams.map((exam) => exam.classYear));
  const rooms = sanitizeList(
    document.exams.flatMap((exam) => {
      const locationText = exam.locationText?.trim();
      return locationText ? [locationText] : exam.rooms;
    }),
  );
  const instructors = sanitizeList(
    document.exams.map((exam) => exam.instructorText?.trim() || "").filter(Boolean),
  );
  const courseTemplates = document.exams.map((exam) => ({
    id: crypto.randomUUID(),
    programs: normalizePrograms(exam.programs),
    classYear: normalizeClassYear(exam.classYear),
    courseName: exam.courseName,
    instructorText: exam.instructorText?.trim() || null,
    locationText: exam.locationText?.trim() || formatRooms(exam.rooms) || null,
  }));

  return normalizeSchoolProfile({
    id: crypto.randomUUID(),
    name,
    updatedAt: new Date().toISOString(),
    dates: document.template.dates,
    times: document.template.times,
    programs,
    classYears,
    rooms,
    instructors,
    courseTemplates,
    defaultExamDuration: DEFAULT_EXAM_DURATION,
    roomCapacities: {},
  });
};
