import type {
  GeneratePeriodicReviewRequest,
  PeriodicReviewDto,
  PeriodicReviewKind,
  PeriodicReviewListResponse,
  PeriodicReviewResult,
  PeriodicReviewStatus,
} from "@journal/contracts";
import { generatePeriodicReview, type PeriodicReviewSourceEntry } from "../../../lib/ai/periodic-review";
import { AiProviderError } from "../../../lib/ai/provider";
import { requireUser, type AuthContext } from "../../../lib/supabase-server";

export const maxDuration = 300;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ENTRY_LIMIT = 500;
const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "AI 服务尚未配置，可以稍后再生成",
  timeout: "这次回顾生成超时，可以稍后重试",
  invalid_response: "AI 返回的回顾没有通过原文校验，可以重新生成",
  unavailable: "AI 服务暂时不可用，可以稍后重试",
  empty_scope: "这段时间还没有可以回顾的日记",
  too_many_entries: "这段时间的日记较多，请先缩短回顾范围",
};

type ReviewRow = {
  id: string;
  kind: PeriodicReviewKind;
  start_date: string;
  end_date: string;
  entry_count: number;
  status: PeriodicReviewStatus;
  result: PeriodicReviewResult | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
};

type StartedReview = {
  status: "started" | "running" | "completed";
  reviewId: string;
  entryCount: number;
  result?: PeriodicReviewResult;
  createdAt: string;
  updatedAt: string;
};

type EntryRow = {
  id: string;
  current_revision: number;
  local_date: string;
};

function toDto(row: ReviewRow): PeriodicReviewDto {
  return {
    id: row.id,
    kind: row.kind,
    startDate: row.start_date,
    endDate: row.end_date,
    entryCount: row.entry_count,
    status: row.status,
    ...(row.result ? { result: row.result } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.status === "failed"
      ? { message: ERROR_MESSAGES[row.last_error_code ?? ""] ?? "阶段回顾生成失败，可以重试" }
      : {}),
  };
}

function rpcDto(started: StartedReview, body: GeneratePeriodicReviewRequest): PeriodicReviewDto {
  return {
    id: started.reviewId,
    kind: body.kind,
    startDate: body.startDate,
    endDate: body.endDate,
    entryCount: started.entryCount,
    status: started.status === "completed" ? "completed" : "running",
    ...(started.result ? { result: started.result } : {}),
    createdAt: started.createdAt,
    updatedAt: started.updatedAt,
  };
}

function migrationResponse(message = "数据库需要执行阶段回顾增量迁移") {
  return Response.json({ message }, { status: 503 });
}

async function loadEntries(
  auth: AuthContext,
  startDate: string,
  endDate: string,
): Promise<PeriodicReviewSourceEntry[] | Response> {
  const { data, error, count } = await auth.client
    .from("entries")
    .select("id,current_revision,local_date", { count: "exact" })
    .eq("user_id", auth.userId)
    .eq("status", "active")
    .gte("local_date", startDate)
    .lte("local_date", endDate)
    .order("local_date", { ascending: true })
    .order("occurred_at", { ascending: true })
    .limit(ENTRY_LIMIT);
  if (error) return Response.json({ message: "读取阶段回顾日记失败" }, { status: 500 });
  const entries = (data ?? []) as EntryRow[];
  if ((count ?? 0) > entries.length) {
    return Response.json({ message: ERROR_MESSAGES.too_many_entries }, { status: 413 });
  }
  if (!entries.length) return [];

  const { data: revisions, error: revisionError } = await auth.client
    .from("entry_revisions")
    .select("entry_id,revision,content")
    .in("entry_id", entries.map((entry) => entry.id));
  if (revisionError) return Response.json({ message: "读取阶段回顾正文失败" }, { status: 500 });
  const contentByEntry = new Map<string, { revision: number; content: string }>();
  for (const revision of revisions ?? []) {
    const current = contentByEntry.get(revision.entry_id);
    if (!current || revision.revision > current.revision) contentByEntry.set(revision.entry_id, revision);
  }
  return entries.map((entry) => ({
    id: entry.id,
    localDate: entry.local_date,
    content: contentByEntry.get(entry.id)?.content ?? "",
  })).filter((entry) => entry.content.trim());
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const { data, error } = await auth.client
    .from("periodic_reviews")
    .select("id,kind,start_date,end_date,entry_count,status,result,last_error_code,created_at,updated_at")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) {
    const missing = error.code === "42P01" || error.code === "PGRST205";
    return missing ? migrationResponse() : Response.json({ message: "读取阶段回顾失败" }, { status: 500 });
  }
  return Response.json({ reviews: ((data ?? []) as ReviewRow[]).map(toDto) } satisfies PeriodicReviewListResponse, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null) as GeneratePeriodicReviewRequest | null;
  if (!body || !["half_year", "custom", "year"].includes(body.kind)
      || !DATE_PATTERN.test(body.startDate) || !DATE_PATTERN.test(body.endDate)
      || body.startDate > body.endDate) {
    return Response.json({ message: "阶段回顾时间范围无效" }, { status: 400 });
  }

  const { data, error } = await auth.client.rpc("start_periodic_review", {
    p_kind: body.kind,
    p_start_date: body.startDate,
    p_end_date: body.endDate,
  });
  if (error) {
    const missing = error.code === "PGRST202" || error.code === "42883" || error.code === "42P01";
    return missing ? migrationResponse() : Response.json({ message: "无法开始阶段回顾" }, { status: 500 });
  }
  const started = data as StartedReview;
  if (started.status === "completed") return Response.json(rpcDto(started, body));
  if (started.status === "running") return Response.json(rpcDto(started, body), { status: 202 });

  const entries = await loadEntries(auth, body.startDate, body.endDate);
  if (entries instanceof Response) {
    const code = entries.status === 413 ? "too_many_entries" : "unavailable";
    await auth.client.rpc("fail_periodic_review", { p_review_id: started.reviewId, p_error_code: code });
    return entries;
  }
  if (!entries.length) {
    await auth.client.rpc("fail_periodic_review", { p_review_id: started.reviewId, p_error_code: "empty_scope" });
    return Response.json({ message: ERROR_MESSAGES.empty_scope }, { status: 400 });
  }

  try {
    const generated = await generatePeriodicReview(entries);
    const { data: completed, error: completeError } = await auth.client.rpc("complete_periodic_review", {
      p_review_id: started.reviewId,
      p_provider: generated.provider,
      p_model: generated.model,
      p_prompt_version: generated.promptVersion,
      p_result: generated.result,
    });
    if (completeError) return Response.json({ message: "回顾已经生成，但保存失败" }, { status: 500 });
    return Response.json(rpcDto(completed as StartedReview, body));
  } catch (error) {
    const code = error instanceof AiProviderError ? error.code : "unavailable";
    console.warn("[periodic-review] generation failed", {
      reviewId: started.reviewId,
      code,
      reason: error instanceof Error ? error.message : "unknown_error",
    });
    await auth.client.rpc("fail_periodic_review", { p_review_id: started.reviewId, p_error_code: code });
    return Response.json({ message: ERROR_MESSAGES[code] ?? "阶段回顾生成失败，可以重试" }, { status: 502 });
  }
}
