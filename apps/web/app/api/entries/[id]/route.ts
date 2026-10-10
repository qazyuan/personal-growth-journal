import type { DeleteEntryResponse } from "@journal/contracts";
import { requireUser } from "../../../../lib/supabase-server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return Response.json({ message: "记录编号无效" }, { status: 400 });

  const { data, error } = await auth.client.rpc("delete_entry", { p_entry_id: id });
  if (error) {
    const migrationMissing = error.code === "PGRST202" || error.code === "42883";
    const notFound = error.message.includes("entry_not_found");
    return Response.json({
      message: migrationMissing
        ? "数据库需要执行记录删除增量迁移"
        : notFound ? "没有找到这条记录，可能已经删除"
        : "删除失败，请稍后重试",
    }, { status: migrationMissing ? 503 : notFound ? 404 : 500 });
  }

  return Response.json(data as DeleteEntryResponse, { headers: { "Cache-Control": "no-store" } });
}
