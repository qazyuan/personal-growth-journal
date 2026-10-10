import assert from "node:assert/strict";
import test from "node:test";
import { normalizeJournalSheet } from "../lib/import/journal-workbook";

test("normalizes the third-sheet journal export format", () => {
  const result = normalizeJournalSheet([
    ["时间", "文本内容", "地址", "标签", "更新时间"],
    ["2026/10/07 21:04", " 今天很好。 ", "上海", "生活", "2026-10-07 22:05"],
  ]);
  assert.equal(result.totalRows, 1);
  assert.equal(result.errors.length, 0);
  const imported = result.rows[0]!;
  assert.deepEqual(imported, {
    sourceRow: 2,
    occurredAt: "2026-10-07T13:04:00.000Z",
    localDate: "2026-10-07",
    content: "今天很好。",
    address: "上海",
    tags: "生活",
    sourceUpdatedAt: "2026-10-07T14:05:00.000Z",
    fingerprint: imported.fingerprint,
  });
  assert.match(imported.fingerprint, /^[0-9a-f]{64}$/);
});

test("reports invalid rows without discarding valid rows", () => {
  const result = normalizeJournalSheet([
    ["时间", "文本内容", "地址", "标签", "更新时间"],
    ["时间不正确", "保留我", null, null, null],
    ["2026/10/05 16:19", "可以导入", null, null, null],
  ]);
  assert.equal(result.totalRows, 2);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.errors, [{ rowNumber: 2, message: "时间格式无法识别，应为 YYYY/MM/DD HH:mm" }]);
});

test("uses a stable fingerprint for the same source row", () => {
  const sheet = [
    ["时间", "文本内容", "地址", "标签", "更新时间"],
    ["2026/10/05 16:19", "同一条日记", null, null, "2026-10-05 17:00"],
  ];
  const first = normalizeJournalSheet(sheet);
  sheet[1]![4] = "2026-10-06 09:00";
  const second = normalizeJournalSheet(sheet);
  assert.equal(first.rows[0]!.fingerprint, second.rows[0]!.fingerprint);
});
