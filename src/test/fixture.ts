import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { parseWorkbook, parseWorkbookArrayBuffer } from "../lib/xlsx-parser";

const bufferToArrayBuffer = (buffer: Buffer) =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

export const getFixturePath = () =>
  resolve(process.cwd(), "fixtures", "vize_programi_ders_programi_gorunumu.xlsx");

export const readFixtureBuffer = () => readFileSync(getFixturePath());

export const readFixtureArrayBuffer = () => bufferToArrayBuffer(readFixtureBuffer());

export const readFixtureWorkbook = () =>
  XLSX.read(readFixtureBuffer(), {
    type: "buffer",
  });

export const loadFixtureDocument = () => parseWorkbookArrayBuffer(readFixtureArrayBuffer());

export const loadFixtureDocumentFromWorkbook = () => parseWorkbook(readFixtureWorkbook());
