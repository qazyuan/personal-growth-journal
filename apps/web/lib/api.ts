import type {
  AnalysisListResponse,
  AnalysisStateDto,
  CreateEntryRequest,
  CreateEntryResponse,
  DeleteEntryResponse,
  EntryListResponse,
  ReflectionConversationDto,
  SendReflectionMessageRequest,
} from "@journal/contracts";
import { getBrowserSupabase } from "./supabase-browser";

async function request<T>(path: string, init?: RequestInit, allowRefresh = true): Promise<T> {
  const supabase = getBrowserSupabase();
  const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
  const token = data.session?.access_token;
  if (!token) throw new Error("请先登录");

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("无法连接记录服务");
  }

  if (response.status === 401 && supabase && allowRefresh) {
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    if (refreshed.session && !error) return request<T>(path, init, false);
    await supabase.auth.signOut({ scope: "local" });
  }

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message ?? `请求失败（${response.status}）`);
  }
  return (await response.json()) as T;
}

export function fetchEntries(): Promise<EntryListResponse> {
  return request<EntryListResponse>("/api/entries");
}

export function createEntry(body: CreateEntryRequest): Promise<CreateEntryResponse> {
  return request<CreateEntryResponse>("/api/entries", { method: "POST", body: JSON.stringify(body) });
}

export function deleteEntry(entryId: string): Promise<DeleteEntryResponse> {
  return request<DeleteEntryResponse>(`/api/entries/${entryId}`, { method: "DELETE" });
}

export function fetchAnalyses(): Promise<AnalysisListResponse> {
  return request<AnalysisListResponse>("/api/analyses");
}

export function requestAnalysis(entryId: string): Promise<AnalysisStateDto> {
  return request<AnalysisStateDto>(`/api/entries/${entryId}/analysis`, { method: "POST" });
}

export function fetchReflectionConversation(entryId: string): Promise<ReflectionConversationDto> {
  return request<ReflectionConversationDto>(`/api/entries/${entryId}/conversation`);
}

export function sendReflectionMessage(entryId: string, body: SendReflectionMessageRequest): Promise<ReflectionConversationDto> {
  return request<ReflectionConversationDto>(`/api/entries/${entryId}/conversation`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
