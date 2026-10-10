import type {
  AnalysisResultDto,
  ReflectionConversationDto,
  ReflectionMessageDto,
  SendReflectionMessageRequest,
} from "@journal/contracts";
import { generateReflectionReply } from "../../../../../lib/ai/conversation";
import { AiProviderError } from "../../../../../lib/ai/provider";
import { requireUser, type AuthContext } from "../../../../../lib/supabase-server";

export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ConversationRow = { id: string; status: "active" | "closed" };
type MessageRow = { id: string; role: "user" | "assistant"; content: string; created_at: string };
type StartResult = {
  status: "started" | "completed";
  conversationId: string;
  entryContent?: string;
  analysis?: AnalysisResultDto;
};

function toMessage(row: MessageRow): ReflectionMessageDto {
  return { id: row.id, role: row.role, content: row.content, createdAt: row.created_at };
}

async function loadConversation(auth: AuthContext, entryId: string): Promise<ReflectionConversationDto | Response> {
  const { data: conversation, error } = await auth.client
    .from("reflection_conversations")
    .select("id,status")
    .eq("entry_id", entryId)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (error) {
    const migrationMissing = error.code === "42P01" || error.code === "PGRST205";
    return Response.json(
      { message: migrationMissing ? "数据库需要执行回望对话增量迁移" : "读取回望对话失败" },
      { status: migrationMissing ? 503 : 500 },
    );
  }
  if (!conversation) return { entryId, status: "empty", messages: [] };

  const row = conversation as ConversationRow;
  const { data: messages, error: messageError } = await auth.client
    .from("reflection_messages")
    .select("id,role,content,created_at")
    .eq("conversation_id", row.id)
    .order("sequence", { ascending: true });
  if (messageError) return Response.json({ message: "读取回望消息失败" }, { status: 500 });
  return {
    entryId,
    conversationId: row.id,
    status: "active",
    messages: ((messages ?? []) as MessageRow[]).map(toMessage),
  };
}

function parseBody(value: unknown): SendReflectionMessageRequest | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Partial<SendReflectionMessageRequest>;
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!body.messageId || !UUID_PATTERN.test(body.messageId) || !content || content.length > 4000) return null;
  return { messageId: body.messageId, content };
}

function rpcError(error: { code?: string; message?: string }): Response {
  const message = error.message ?? "";
  const migrationMissing = error.code === "PGRST202" || error.code === "42883" || error.code === "42P01";
  const busy = message.includes("conversation_busy");
  const analysisRequired = message.includes("completed_analysis_required");
  return Response.json({
    message: migrationMissing
      ? "数据库需要执行回望对话增量迁移"
      : busy ? "上一条回应仍在生成，请稍候"
      : analysisRequired ? "请先完成这篇日记的即时回望"
      : "无法发送这条回望消息",
  }, { status: migrationMissing ? 503 : busy ? 409 : analysisRequired ? 400 : 500 });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return Response.json({ message: "记录编号无效" }, { status: 400 });
  const result = await loadConversation(auth, id);
  if (result instanceof Response) return result;
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return Response.json({ message: "记录编号无效" }, { status: 400 });
  const body = parseBody(await request.json().catch(() => null));
  if (!body) return Response.json({ message: "请输入 1–4000 个字符的内容" }, { status: 400 });

  const { data, error } = await auth.client.rpc("start_reflection_turn", {
    p_entry_id: id,
    p_message_id: body.messageId,
    p_content: body.content,
  });
  if (error) return rpcError(error);
  const started = data as StartResult;
  if (started.status === "completed") {
    const existing = await loadConversation(auth, id);
    return existing instanceof Response ? existing : Response.json(existing);
  }

  const current = await loadConversation(auth, id);
  if (current instanceof Response) return current;
  if (!started.entryContent || !started.analysis) return Response.json({ message: "回望上下文不完整" }, { status: 500 });

  try {
    const reply = await generateReflectionReply({
      entryContent: started.entryContent,
      analysis: started.analysis,
      messages: current.messages,
    });
    const { error: completeError } = await auth.client.rpc("complete_reflection_turn", {
      p_conversation_id: started.conversationId,
      p_user_message_id: body.messageId,
      p_assistant_message_id: crypto.randomUUID(),
      p_content: reply.content,
      p_provider: reply.provider,
      p_model: reply.model,
      p_prompt_version: reply.promptVersion,
    });
    if (completeError) return Response.json({ message: "回应已生成，但保存失败，请重试" }, { status: 503 });
  } catch (error) {
    await auth.client.rpc("fail_reflection_turn", {
      p_conversation_id: started.conversationId,
      p_user_message_id: body.messageId,
    });
    const message = error instanceof AiProviderError ? error.message : "AI 回望暂时不可用";
    return Response.json({ message }, { status: 502 });
  }

  const completed = await loadConversation(auth, id);
  return completed instanceof Response ? completed : Response.json(completed);
}
