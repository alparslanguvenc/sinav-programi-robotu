import { formatRooms, normalizeClassYear, normalizeTimeInput, sortClassYears } from "./schedule";
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
  classYears: [],
  rooms: [],
  instructors: [],
  courseTemplates: [],
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

      return left.courseName.localeCompare(right.courseName, "tr");
    });

  return {
    ...profile,
    id: profile.id || crypto.randomUUID(),
    name: profile.name.trim() || "Adsız Profil",
    updatedAt: profile.updatedAt || new Date().toISOString(),
    dates,
    times,
    classYears,
    rooms,
    instructors,
    courseTemplates,
  };
};

export const parseCourseTemplatesInput = (raw: string) =>
  raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [classYear = "", courseName = "", instructorText = "", locationText = ""] = line
        .split("|")
        .map((part) => part.trim());

      return normalizeCourseTemplate({
        id: crypto.randomUUID(),
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
    classYears,
    rooms,
    instructors,
    courseTemplates,
  });
};
