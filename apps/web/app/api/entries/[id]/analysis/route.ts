import type { AnalysisStateDto } from "@journal/contracts";
import { generateInstantAnalysis } from "../../../../../lib/ai/analysis";
import { AiProviderError } from "../../../../../lib/ai/provider";
import { requireUser } from "../../../../../lib/supabase-server";

export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StartResult = {
  status: "started" | "running" | "completed";
  requestId: string;
  entryId: string;
  revision: number;
  content?: string;
  result?: AnalysisStateDto["result"];
};

function errorResponse(error: { code?: string; message?: string }) {
  const migrationMissing = error.code === "PGRST202" || error.code === "42883" || error.code === "42P01";
  const notRequested = error.message?.includes("analysis_not_requested");
  return Response.json(
    { message: migrationMissing ? "数据库需要执行 AI 分析增量迁移" : notRequested ? "这条记录没有请求 AI 分析" : "无法开始 AI 分析" },
    { status: migrationMissing ? 503 : notRequested ? 404 : 500 },
  );
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return Response.json({ message: "记录编号无效" }, { status: 400 });

  const { data, error } = await auth.client.rpc("start_analysis", { p_entry_id: id });
  if (error) return errorResponse(error);
  const started = data as StartResult;

  if (started.status === "completed") {
    return Response.json({ entryId: id, status: "completed", result: started.result } satisfies AnalysisStateDto);
  }
  if (started.status === "running") {
    return Response.json({ entryId: id, status: "running" } satisfies AnalysisStateDto, { status: 202 });
  }
  if (!started.content) return Response.json({ message: "没有找到待分析的日记原文" }, { status: 500 });

  try {
    const analysis = await generateInstantAnalysis(started.content);
    const { error: completeError } = await auth.client.rpc("complete_analysis", {
      p_request_id: started.requestId,
      p_provider: analysis.provider,
      p_model: analysis.model,
      p_prompt_version: analysis.promptVersion,
      p_result: analysis.result,
    });
    if (completeError) return Response.json({ message: "分析已经生成，但保存结果失败，请重试" }, { status: 503 });
    return Response.json({ entryId: id, status: "completed", result: analysis.result } satisfies AnalysisStateDto);
  } catch (error) {
    const code = error instanceof AiProviderError ? error.code : "unavailable";
    await auth.client.rpc("fail_analysis", { p_request_id: started.requestId, p_error_code: code });
    const message = error instanceof AiProviderError ? error.message : "AI 分析暂时不可用";
    return Response.json({ message }, { status: code === "not_configured" ? 503 : 502 });
  }
}
