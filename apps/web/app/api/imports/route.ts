import type { JournalImportResult } from "@journal/contracts";
import { IMPORT_TIMEZONE, parseJournalWorkbook } from "../../../lib/import/journal-workbook";
import { requireUser } from "../../../lib/supabase-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ message: "请选择要导入的 Excel 文件" }, { status: 400 });

  try {
    const parsed = await parseJournalWorkbook(file.name, Buffer.from(await file.arrayBuffer()));
    if (!parsed.rows.length) return Response.json({ message: "没有可导入的日记，请先修正 Excel 中的错误" }, { status: 400 });
    const batchId = crypto.randomUUID();
    const { data, error } = await auth.client.rpc("import_journal_entries", {
      p_batch_id: batchId,
      p_source_file_name: parsed.fileName,
      p_source_file_sha256: parsed.fileSha256,
      p_timezone: IMPORT_TIMEZONE,
      p_rows: parsed.rows.map((row) => ({
        source_row: row.sourceRow,
        occurred_at: row.occurredAt,
        local_date: row.localDate,
        content: row.content,
        address: row.address,
        tags: row.tags,
        source_updated_at: row.sourceUpdatedAt,
        fingerprint: row.fingerprint,
      })),
    });
    if (error) {
      const schemaOutdated = error.code === "PGRST202" || error.code === "42883" || error.code === "42P01";
      return Response.json(
        { message: schemaOutdated ? "数据库需要执行历史日记导入迁移" : "导入失败，请稍后重试" },
        { status: schemaOutdated ? 503 : 500 },
      );
    }
    const result = data as {
      batch_id: string;
      total_rows: number;
      imported_rows: number;
      duplicate_rows: number;
      replayed?: boolean;
    };
    const response: JournalImportResult = {
      batchId: result.batch_id,
      totalRows: parsed.totalRows,
      importedRows: result.imported_rows,
      duplicateRows: result.duplicate_rows,
      invalidRows: parsed.errors.length,
      replayed: Boolean(result.replayed),
    };
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "Excel 文件解析失败" }, { status: 400 });
  }
}
