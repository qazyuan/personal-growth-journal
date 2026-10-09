import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";

const SESSION_COOKIE = "journal_session";
const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function registerAuth(app: FastifyInstance, sessionTtlDays: number, nodeEnv: string) {
  app.decorateRequest("userId", "");

  app.decorate("authenticate", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
      await reply.code(401).send({ error: "unauthorized", message: "请先登录" });
      return;
    }

    const result = await app.db.query<{ user_id: string }>(
      `SELECT user_id
       FROM sessions
       WHERE token_hash = $1 AND expires_at > now()`,
      [hashToken(token)],
    );

    const session = result.rows[0];
    if (!session) {
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      await reply.code(401).send({ error: "session_expired", message: "登录已过期" });
      return;
    }

    request.userId = session.user_id;
  });

  app.post("/v1/auth/dev-login", async (_request, reply) => {
    if (nodeEnv === "production") {
      return reply.code(404).send({ error: "not_found", message: "Not found" });
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + sessionTtlDays * 86_400_000);
    await app.db.query(
      "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
      [DEV_USER_ID, hashToken(token), expiresAt],
    );

    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: nodeEnv === "production",
      expires: expiresAt,
    });

    return { ok: true, userId: DEV_USER_ID };
  });
}
