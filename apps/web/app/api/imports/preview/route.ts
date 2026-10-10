import type { JournalImportPreviewResponse } from "@journal/contracts";
import { parseJournalWorkbook, toPreviewEntry, IMPORT_TIMEZONE, JOURNAL_SHEET_NAME } from "../../../../lib/import/journal-workbook";
import { requireUser, type AuthContext } from "../../../../lib/supabase-server";

export const runtime = "nodejs";

async function existingFingerprints(auth: AuthContext, fingerprints: string[]): Promise<Set<string> | Response> {
  const existing = new Set<string>();
  for (let index = 0; index < fingerprints.length; index += 100) {
    const chunk = fingerprints.slice(index, index + 100);
    if (!chunk.length) continue;
    const { data, error } = await auth.client
      .from("entry_import_sources")
      .select("source_fingerprint")
      .eq("user_id", auth.userId)
      .in("source_fingerprint", chunk);
    if (error) {
      const schemaOutdated = error.code === "42P01" || error.code === "PGRST205";
      return Response.json(
        { message: schemaOutdated ? "数据库需要执行历史日记导入迁移" : "暂时无法检查重复日记" },
        { status: schemaOutdated ? 503 : 500 },
      );
    }
    for (const row of data ?? []) existing.add(row.source_fingerprint);
  }
  return existing;
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ message: "请选择要导入的 Excel 文件" }, { status: 400 });

  try {
    const parsed = await parseJournalWorkbook(file.name, Buffer.from(await file.arrayBuffer()));
    const duplicates = await existingFingerprints(auth, parsed.rows.map((row) => row.fingerprint));
    if (duplicates instanceof Response) return duplicates;
    const seen = new Set<string>();
    const duplicateSourceRows = new Set<number>();
    for (const row of parsed.rows) {
      if (duplicates.has(row.fingerprint) || seen.has(row.fingerprint)) duplicateSourceRows.add(row.sourceRow);
      else seen.add(row.fingerprint);
    }
    const response: JournalImportPreviewResponse = {
      fileName: parsed.fileName,
      sheetName: JOURNAL_SHEET_NAME,
      assumedTimezone: IMPORT_TIMEZONE,
      totalRows: parsed.totalRows,
      importableRows: parsed.rows.filter((row) => !duplicateSourceRows.has(row.sourceRow)).length,
      duplicateRows: duplicateSourceRows.size,
      invalidRows: parsed.errors.length,
      entries: parsed.rows.slice(0, 20).map((row) => toPreviewEntry(row, duplicateSourceRows.has(row.sourceRow))),
      errors: parsed.errors.slice(0, 20),
    };
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "Excel 文件解析失败" }, { status: 400 });
  }
}
