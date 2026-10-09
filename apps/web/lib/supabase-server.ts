import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AuthContext = { client: SupabaseClient; userId: string };

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
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    return Response.json({ message: "登录已过期，请重新登录" }, { status: 401 });
  }
  return { client, userId: data.user.id };
}
