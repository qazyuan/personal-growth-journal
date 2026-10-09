import type {
  CreateEntryRequest,
  CreateEntryResponse,
  EntryDto,
  EntryMode,
  EntrySource,
} from "@journal/contracts";
import { requireUser, type AuthContext } from "../../../lib/supabase-server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCES = new Set<EntrySource>(["iphone", "mac_web", "ipad_web", "import"]);
const MODES = new Set<EntryMode>(["record_only", "record_and_analyze"]);

type EntryRow = {
  id: string;
  current_revision: number;
  occurred_at: string;
  created_at: string;
  updated_at: string;
  source: EntrySource;
  mode: EntryMode;
  status: "active" | "deleted";
};

function toDto(entry: EntryRow, content: string): EntryDto {
  return {
    id: entry.id,
    revision: entry.current_revision,
    occurredAt: entry.occurred_at,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    source: entry.source,
    mode: entry.mode,
    status: entry.status,
    content,
  };
}

async function loadEntries(auth: AuthContext): Promise<EntryDto[] | Response> {
  const { data: entries, error } = await auth.client
    .from("entries")
    .select("id,current_revision,occurred_at,created_at,updated_at,source,mode,status")
    .eq("user_id", auth.userId)
    .eq("status", "active")
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (error) return Response.json({ message: "读取记录失败，请确认数据库迁移已完成" }, { status: 503 });
  if (!entries?.length) return [];

  const { data: revisions, error: revisionError } = await auth.client
    .from("entry_revisions")
    .select("entry_id,revision,content")
    .in("entry_id", entries.map((entry) => entry.id));
  if (revisionError) return Response.json({ message: "读取记录版本失败" }, { status: 500 });

  const contentByEntry = new Map<string, { revision: number; content: string }>();
  for (const revision of revisions ?? []) {
    const current = contentByEntry.get(revision.entry_id);
    if (!current || revision.revision > current.revision) contentByEntry.set(revision.entry_id, revision);
  }
  return (entries as EntryRow[]).map((entry) => toDto(entry, contentByEntry.get(entry.id)?.content ?? ""));
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const result = await loadEntries(auth);
  if (result instanceof Response) return result;
  return Response.json({ entries: result }, { headers: { "Cache-Control": "no-store" } });
}

function parseBody(value: unknown): CreateEntryRequest | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Partial<CreateEntryRequest>;
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const occurredAt = typeof body.occurredAt === "string" ? new Date(body.occurredAt) : null;
  if (!body.id || !UUID_PATTERN.test(body.id) || !body.operationId || !UUID_PATTERN.test(body.operationId)) return null;
  if (!body.source || !SOURCES.has(body.source) || !body.mode || !MODES.has(body.mode)) return null;
  if (!content || content.length > 20_000 || !occurredAt || Number.isNaN(occurredAt.getTime())) return null;
  return { ...body, content, occurredAt: occurredAt.toISOString() } as CreateEntryRequest;
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const body = parseBody(await request.json().catch(() => null));
  if (!body) return Response.json({ message: "记录内容或请求参数无效" }, { status: 400 });

  const { error } = await auth.client.rpc("create_entry", {
    p_entry_id: body.id,
    p_operation_id: body.operationId,
    p_occurred_at: body.occurredAt,
    p_source: body.source,
    p_mode: body.mode,
    p_content: body.content,
  });
  if (error) {
    const conflict = error.message.includes("operation_id_conflict");
    return Response.json(
      { message: conflict ? "这次保存编号已用于另一条内容" : "保存失败，请稍后重试" },
      { status: conflict ? 409 : 500 },
    );
  }

  const { data: entry, error: entryError } = await auth.client
    .from("entries")
    .select("id,current_revision,occurred_at,created_at,updated_at,source,mode,status")
    .eq("id", body.id)
    .single();
  const { data: revision, error: revisionError } = await auth.client
    .from("entry_revisions")
    .select("content")
    .eq("entry_id", body.id)
    .eq("revision", 1)
    .single();
  if (entryError || revisionError || !entry || !revision) {
    return Response.json({ message: "记录可能已接收，确认失败；客户端会安全重试" }, { status: 503 });
  }

  const response: CreateEntryResponse = {
    ...toDto(entry as EntryRow, revision.content),
    receivedAt: new Date().toISOString(),
    archiveStatus: "not_implemented",
    analysisStatus: body.mode === "record_and_analyze" ? "queued" : "not_requested",
  };
  return Response.json(response, { status: 201, headers: { "Cache-Control": "no-store" } });
}
