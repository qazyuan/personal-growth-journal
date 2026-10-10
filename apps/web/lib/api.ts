import type {
  AnalysisListResponse,
  AnalysisStateDto,
  CreateEntryRequest,
  CreateEntryResponse,
  DeleteEntryResponse,
  EntryListResponse,
  JournalImportPreviewResponse,
  JournalImportResult,
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
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers,
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

export function fetchEntries(options: { limit?: number; offset?: number } = {}): Promise<EntryListResponse> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.offset) params.set("offset", String(options.offset));
  const query = params.size ? `?${params.toString()}` : "";
  return request<EntryListResponse>(`/api/entries${query}`);
}

export function createEntry(body: CreateEntryRequest): Promise<CreateEntryResponse> {
  return request<CreateEntryResponse>("/api/entries", { method: "POST", body: JSON.stringify(body) });
}

export function deleteEntry(entryId: string): Promise<DeleteEntryResponse> {
  return request<DeleteEntryResponse>(`/api/entries/${entryId}`, { method: "DELETE" });
}

function journalImportForm(file: File): FormData {
  const form = new FormData();
  form.set("file", file);
  return form;
}

export function previewJournalImport(file: File): Promise<JournalImportPreviewResponse> {
  return request<JournalImportPreviewResponse>("/api/imports/preview", { method: "POST", body: journalImportForm(file) });
}

export function importJournal(file: File): Promise<JournalImportResult> {
  return request<JournalImportResult>("/api/imports", { method: "POST", body: journalImportForm(file) });
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
