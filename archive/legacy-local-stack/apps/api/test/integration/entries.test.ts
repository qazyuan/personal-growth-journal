import { randomUUID } from "node:crypto";
import type { CreateEntryRequest } from "@journal/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const run = databaseUrl ? describe : describe.skip;

run("entries API", () => {
  const appPromise = buildApp({
    databaseUrl: databaseUrl!,
    host: "127.0.0.1",
    port: 0,
    webOrigin: "http://localhost:3000",
    sessionTtlDays: 1,
    nodeEnv: "test",
  });
  let cookie = "";

  beforeAll(async () => {
    const app = await appPromise;
    await app.ready();
    await app.db.query("TRUNCATE sessions, client_operations, entry_revisions, entries CASCADE");
    const login = await app.inject({ method: "POST", url: "/v1/auth/dev-login" });
    const setCookie = login.headers["set-cookie"];
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";")[0] ?? "";
  });

  afterAll(async () => {
    const app = await appPromise;
    await app.close();
  });

  it("creates one revision when the same operation is retried", async () => {
    const app = await appPromise;
    const body: CreateEntryRequest = {
      id: randomUUID(),
      operationId: randomUUID(),
      occurredAt: new Date().toISOString(),
      source: "mac_web",
      mode: "record_only",
      content: "今天完成了第一条记录。",
    };

    const first = await app.inject({ method: "POST", url: "/v1/entries", headers: { cookie }, payload: body });
    const second = await app.inject({ method: "POST", url: "/v1/entries", headers: { cookie }, payload: body });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());

    const count = await app.db.query<{ count: string }>(
      "SELECT count(*) FROM entry_revisions WHERE entry_id = $1",
      [body.id],
    );
    expect(Number(count.rows[0]?.count)).toBe(1);
  });

  it("rejects the same operation id with different content", async () => {
    const app = await appPromise;
    const operationId = randomUUID();
    const body: CreateEntryRequest = {
      id: randomUUID(), operationId, occurredAt: new Date().toISOString(),
      source: "ipad_web", mode: "record_only", content: "第一份内容",
    };
    await app.inject({ method: "POST", url: "/v1/entries", headers: { cookie }, payload: body });
    const conflict = await app.inject({
      method: "POST", url: "/v1/entries", headers: { cookie },
      payload: { ...body, content: "不同内容" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe("idempotency_conflict");
  });

  it("rejects whitespace-only content", async () => {
    const app = await appPromise;
    const response = await app.inject({
      method: "POST", url: "/v1/entries", headers: { cookie },
      payload: {
        id: randomUUID(), operationId: randomUUID(), occurredAt: new Date().toISOString(),
        source: "mac_web", mode: "record_only", content: "   ",
      },
    });
    expect(response.statusCode).toBe(400);
  });
});
