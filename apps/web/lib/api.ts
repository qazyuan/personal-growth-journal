import type { CreateEntryRequest, CreateEntryResponse, EntryListResponse } from "@journal/contracts";
import { getBrowserSupabase } from "./supabase-browser";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
