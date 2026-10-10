import type { AnalysisListResponse, AnalysisResultDto, AnalysisStateDto, AnalysisStatus } from "@journal/contracts";
import { requireUser } from "../../../lib/supabase-server";

type RequestRow = {
  id: string;
  entry_id: string;
  status: string;
  last_error_code: string | null;
};

type ResultRow = {
  request_id: string;
  result: AnalysisResultDto;
};

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "AI 服务尚未配置，可以稍后重试",
  timeout: "AI 响应超时，可以稍后重试",
  invalid_response: "AI 返回的内容未通过校验，可以重试",
  unavailable: "AI 服务暂时不可用，可以稍后重试",
};

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data: requests, error } = await auth.client
    .from("analysis_requests")
    .select("id,entry_id,status,last_error_code")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    const migrationMissing = error.code === "42703" || error.code === "42P01" || error.code === "PGRST204";
    return Response.json(
      { message: migrationMissing ? "数据库需要执行 AI 分析增量迁移" : "读取 AI 分析状态失败" },
      { status: migrationMissing ? 503 : 500 },
    );
  }

  const rows = (requests ?? []) as RequestRow[];
  const requestIds = rows.map((item) => item.id);
  let resultRows: ResultRow[] = [];
  if (requestIds.length) {
    const { data: results, error: resultError } = await auth.client
      .from("analysis_results")
      .select("request_id,result")
      .in("request_id", requestIds);
    if (resultError) return Response.json({ message: "读取 AI 分析结果失败" }, { status: 500 });
    resultRows = (results ?? []) as ResultRow[];
  }

  const resultByRequest = new Map(resultRows.map((item) => [item.request_id, item.result]));
  const analyses: Record<string, AnalysisStateDto> = {};
  for (const row of rows) {
    const status: AnalysisStatus = ["queued", "running", "completed", "failed"].includes(row.status)
      ? row.status as AnalysisStatus
      : "failed";
    analyses[row.entry_id] = {
      entryId: row.entry_id,
      status,
      ...(status === "completed" ? { result: resultByRequest.get(row.id) } : {}),
      ...(status === "failed" ? { message: ERROR_MESSAGES[row.last_error_code ?? ""] ?? "AI 分析失败，可以重试" } : {}),
    };
  }

  return Response.json({ analyses } satisfies AnalysisListResponse, { headers: { "Cache-Control": "no-store" } });
}
