"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let refreshInFlight: Promise<Session | null> | null = null;

export function sessionNeedsRefresh(session: Session, nowMilliseconds = Date.now()): boolean {
  if (!session.expires_at) return false;
  return session.expires_at * 1000 <= nowMilliseconds + 60_000;
}

export function getBrowserSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  if (!client) client = createClient(url, key);
  return client;
}

export async function getValidBrowserSession(forceRefresh = false): Promise<Session | null> {
  const supabase = getBrowserSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  if (!forceRefresh && !sessionNeedsRefresh(data.session)) return data.session;

  if (!refreshInFlight) {
    refreshInFlight = supabase.auth.refreshSession()
      .then(({ data: refreshed, error: refreshError }) => {
        if (refreshError) throw refreshError;
        return refreshed.session;
      })
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}
