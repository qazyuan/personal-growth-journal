import { createHash } from "node:crypto";
import type { JournalImportPreviewEntry, JournalImportRowError } from "@journal/contracts";
import { readSheet, type CellValue, type SheetData } from "read-excel-file/node";

export const JOURNAL_SHEET_NAME = "日记" as const;
export const IMPORT_TIMEZONE = "Asia/Shanghai";
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 1_000;

const REQUIRED_HEADERS = ["时间", "文本内容"] as const;
const OPTIONAL_HEADERS = ["地址", "标签", "更新时间"] as const;

export type NormalizedImportRow = {
  sourceRow: number;
  occurredAt: string;
  localDate: string;
  content: string;
  address: string | null;
  tags: string | null;
  sourceUpdatedAt: string | null;
  fingerprint: string;
};

export type ParsedJournalWorkbook = {
  fileName: string;
  fileSha256: string;
  totalRows: number;
  rows: NormalizedImportRow[];
  errors: JournalImportRowError[];
};

function cellText(value: CellValue | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    const hour = String(value.getUTCHours()).padStart(2, "0");
    const minute = String(value.getUTCMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }
  return String(value).trim();
}

function parseLocalDateTime(value: CellValue | null | undefined): { occurredAt: string; localDate: string } | null {
  const text = cellText(value);
  const match = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText = "0", minuteText = "0", secondText = "0"] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const validation = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    validation.getUTCFullYear() !== year
    || validation.getUTCMonth() !== month - 1
    || validation.getUTCDate() !== day
    || hour > 23
    || minute > 59
    || second > 59
  ) return null;
  const localDate = `${yearText}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const localTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  return { occurredAt: new Date(`${localDate}T${localTime}+08:00`).toISOString(), localDate };
}

function fingerprintFor(row: Omit<NormalizedImportRow, "fingerprint" | "sourceRow" | "sourceUpdatedAt">): string {
  return createHash("sha256").update(JSON.stringify([
    "excel_diary_v1",
    row.occurredAt,
    row.content,
    row.address ?? "",
    row.tags ?? "",
  ])).digest("hex");
}

export function normalizeJournalSheet(data: SheetData): Omit<ParsedJournalWorkbook, "fileName" | "fileSha256"> {
  if (!data.length) throw new Error("第 3 个工作表没有内容");
  const headers = data[0]!.map((value) => cellText(value));
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const missing = REQUIRED_HEADERS.filter((header) => !headerIndex.has(header));
  if (missing.length) throw new Error(`“日记”工作表缺少列：${missing.join("、")}`);

  const knownHeaders = [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS];
  const indexes = Object.fromEntries(knownHeaders.map((header) => [header, headerIndex.get(header)])) as Record<(typeof knownHeaders)[number], number | undefined>;
  const rows: NormalizedImportRow[] = [];
  const errors: JournalImportRowError[] = [];
  let totalRows = 0;

  for (let index = 1; index < data.length; index += 1) {
    const source = data[index]!;
    const rowNumber = index + 1;
    const hasValue = source.some((value) => cellText(value) !== "");
    if (!hasValue) continue;
    totalRows += 1;
    const date = parseLocalDateTime(source[indexes["时间"]!]);
    const content = cellText(source[indexes["文本内容"]!]).trim();
    if (!date) {
      errors.push({ rowNumber, message: "时间格式无法识别，应为 YYYY/MM/DD HH:mm" });
      continue;
    }
    if (!content) {
      errors.push({ rowNumber, message: "文本内容为空" });
      continue;
    }
    if (content.length > 20_000) {
      errors.push({ rowNumber, message: "文本内容超过 20000 字" });
      continue;
    }
    const address = indexes["地址"] === undefined ? null : cellText(source[indexes["地址"]]).trim() || null;
    const tags = indexes["标签"] === undefined ? null : cellText(source[indexes["标签"]]).trim() || null;
    const updated = indexes["更新时间"] === undefined ? null : parseLocalDateTime(source[indexes["更新时间"]]);
    const normalized = {
      occurredAt: date.occurredAt,
      localDate: date.localDate,
      content,
      address,
      tags,
    };
    rows.push({
      sourceRow: rowNumber,
      ...normalized,
      sourceUpdatedAt: updated?.occurredAt ?? null,
      fingerprint: fingerprintFor(normalized),
    });
  }

  if (totalRows > MAX_IMPORT_ROWS) throw new Error(`单次最多导入 ${MAX_IMPORT_ROWS} 条日记`);
  return { totalRows, rows, errors };
}

export async function parseJournalWorkbook(fileName: string, buffer: Buffer): Promise<ParsedJournalWorkbook> {
  if (!/\.xlsx$/i.test(fileName)) throw new Error("请选择 .xlsx 格式的 Excel 文件");
  if (!buffer.length) throw new Error("Excel 文件为空");
  if (buffer.length > MAX_IMPORT_FILE_BYTES) throw new Error("Excel 文件不能超过 10 MB");
  let data: SheetData;
  try {
    data = await readSheet(buffer, 3);
  } catch {
    throw new Error("无法读取第 3 个工作表，请确认文件未损坏且包含“日记”页");
  }
  const parsed = normalizeJournalSheet(data);
  return {
    fileName: fileName.slice(0, 255),
    fileSha256: createHash("sha256").update(buffer).digest("hex"),
    ...parsed,
  };
}

export function toPreviewEntry(row: NormalizedImportRow, duplicate: boolean): JournalImportPreviewEntry {
  return {
    rowNumber: row.sourceRow,
    occurredAt: row.occurredAt,
    localDate: row.localDate,
    contentPreview: row.content.length > 140 ? `${row.content.slice(0, 140)}…` : row.content,
    address: row.address ?? undefined,
    tags: row.tags ?? undefined,
    duplicate,
  };
}
