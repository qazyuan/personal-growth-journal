import type {
  AnalysisListResponse,
  AnalysisStateDto,
  CreateEntryRequest,
  CreateEntryResponse,
  DeleteEntryResponse,
  EntryListResponse,
  GeneratePeriodicReviewRequest,
  JournalImportPreviewResponse,
  JournalImportResult,
  ArchiveResponse,
  OnThisDayResponse,
  PeriodicReviewDto,
  PeriodicReviewListResponse,
  ReflectionConversationDto,
  SendReflectionMessageRequest,
} from "@journal/contracts";
import { getBrowserSupabase, getValidBrowserSession } from "./supabase-browser";

async function send(path: string, init: RequestInit | undefined, token: string): Promise<Response> {
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
  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = getBrowserSupabase();
  const session = await getValidBrowserSession();
  if (!supabase || !session?.access_token) throw new Error("请先登录");

  let response = await send(path, init, session.access_token);

  if (response.status === 401) {
    try {
      const refreshed = await getValidBrowserSession(true);
      if (!refreshed?.access_token) throw new Error("missing_refreshed_session");
      response = await send(path, init, refreshed.access_token);
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
      if (status === 400 || status === 401) await supabase.auth.signOut({ scope: "local" });
      throw new Error(status === 400 || status === 401
        ? "登录状态已失效，请重新登录"
        : "登录刷新失败，请检查网络后重试");
    }
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

export function fetchOnThisDay(localDate: string): Promise<OnThisDayResponse> {
  return request<OnThisDayResponse>(`/api/reviews?kind=on_this_day&date=${encodeURIComponent(localDate)}`);
}

export function fetchArchive(startDate: string, endDate: string): Promise<ArchiveResponse> {
  const params = new URLSearchParams({ kind: "archive", start: startDate, end: endDate });
  return request<ArchiveResponse>(`/api/reviews?${params.toString()}`);
}

export function fetchPeriodicReviews(): Promise<PeriodicReviewListResponse> {
  return request<PeriodicReviewListResponse>("/api/periodic-reviews");
}

export function generatePeriodicReview(body: GeneratePeriodicReviewRequest): Promise<PeriodicReviewDto> {
  return request<PeriodicReviewDto>("/api/periodic-reviews", { method: "POST", body: JSON.stringify(body) });
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
