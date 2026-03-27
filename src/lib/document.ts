import { normalizeDocument } from "./schedule";
import type { ScheduleDocument, ScheduleJsonEnvelope } from "../types/schedule";

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export const serializeScheduleDocument = (document: ScheduleDocument) =>
  JSON.stringify(
    {
      version: 1,
      document,
    } satisfies ScheduleJsonEnvelope,
    null,
    2,
  );

export const parseScheduleDocumentJson = (rawText: string) => {
  const parsed = JSON.parse(rawText) as ScheduleJsonEnvelope | ScheduleDocument;
  const document =
    "document" in parsed && parsed.document
      ? parsed.document
      : (parsed as ScheduleDocument);

  if (
    !document ||
    !document.template ||
    !isStringArray(document.template.dates) ||
    !isStringArray(document.template.times) ||
    !Array.isArray(document.exams)
  ) {
    throw new Error("JSON dosyası beklenen çizelge formatında değil.");
  }

  return normalizeDocument(document);
};
