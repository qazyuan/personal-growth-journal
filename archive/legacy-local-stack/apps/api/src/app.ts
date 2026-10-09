import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { createPool } from "@journal/database";
import Fastify from "fastify";
import type { AppConfig } from "./config.js";
import { registerAuth } from "./auth.js";
import { entryRoutes } from "./routes/entries.js";

export async function buildApp(config: AppConfig) {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "test" ? "silent" : "info",
      redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
    },
    bodyLimit: 256 * 1024,
  });

  const db = createPool(config.databaseUrl);
  app.decorate("db", db);
  app.addHook("onClose", async () => db.end());

  await app.register(cookie);
  await app.register(cors, {
    origin: config.webOrigin,
    credentials: true,
  });

  app.get("/health", async () => ({ ok: true }));
  await registerAuth(app, config.sessionTtlDays, config.nodeEnv);
  await app.register(entryRoutes);

  app.setErrorHandler((error, _request, reply) => {
    if (typeof error === "object" && error !== null && "validation" in error) {
      return reply.code(400).send({ error: "invalid_request", message: "请求格式不正确" });
    }
    app.log.error({ err: error }, "request failed");
    return reply.code(500).send({ error: "internal_error", message: "服务暂时不可用" });
  });

  return app;
}
