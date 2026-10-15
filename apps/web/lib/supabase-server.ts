import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AuthContext = { client: SupabaseClient; userId: string };

type AuthFailure = { name?: string; status?: number; code?: string; message?: string };

export function isRetryableAuthFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as AuthFailure;
  return failure.name === "AuthRetryableFetchError" || failure.status === 0;
}

async function verifyUser(client: SupabaseClient, token: string) {
  let result = await client.auth.getUser(token);
  for (const delay of [180, 520]) {
    if (!result.error || !isRetryableAuthFailure(result.error)) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
    result = await client.auth.getUser(token);
  }
  return result;
}

export async function requireUser(request: Request): Promise<AuthContext | Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Response.json({ message: "Supabase 尚未配置" }, { status: 503 });

  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return Response.json({ message: "请先登录" }, { status: 401 });

  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await verifyUser(client, token);
  if (error || !data.user) {
    console.warn("[auth] access token rejected", {
      name: error?.name ?? "missing_user",
      status: error && "status" in error ? error.status : undefined,
      code: error && "code" in error ? error.code : undefined,
      message: error?.message ?? "Supabase returned no user",
    });
    if (isRetryableAuthFailure(error)) {
      return Response.json(
        { message: "暂时无法连接 Supabase，登录状态仍会保留，请稍后重试" },
        { status: 503, headers: { "Retry-After": "3" } },
      );
    }
    return Response.json({ message: "登录已过期，请重新登录" }, { status: 401 });
  }
  return { client, userId: data.user.id };
}
