import { ENTRY_MODES, ENTRY_SOURCES, type CreateEntryRequest } from "@journal/contracts";
import type { FastifyInstance } from "fastify";
import {
  createEntry,
  EntryAlreadyExistsError,
  getEntry,
  IdempotencyConflictError,
  listEntries,
} from "../entries.js";

const uuidPattern = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

const createEntrySchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["id", "operationId", "occurredAt", "source", "mode", "content"],
    properties: {
      id: { type: "string", pattern: uuidPattern },
      operationId: { type: "string", pattern: uuidPattern },
      occurredAt: { type: "string", format: "date-time" },
      source: { type: "string", enum: [...ENTRY_SOURCES] },
      mode: { type: "string", enum: [...ENTRY_MODES] },
      content: { type: "string", minLength: 1, maxLength: 100_000 },
    },
  },
} as const;

export async function entryRoutes(app: FastifyInstance) {
  app.get("/v1/entries", { preHandler: app.authenticate }, async (request) => ({
    entries: await listEntries(app.db, request.userId),
  }));

  app.get<{ Params: { id: string } }>(
    "/v1/entries/:id",
    {
      preHandler: app.authenticate,
      schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", pattern: uuidPattern } } } },
    },
    async (request, reply) => {
      const entry = await getEntry(app.db, request.userId, request.params.id);
      if (!entry) {
        return reply.code(404).send({ error: "not_found", message: "记录不存在" });
      }
      return entry;
    },
  );

  app.post<{ Body: CreateEntryRequest }>(
    "/v1/entries",
    { preHandler: app.authenticate, schema: createEntrySchema },
    async (request, reply) => {
      if (!request.body.content.trim()) {
        return reply.code(400).send({ error: "empty_content", message: "记录内容不能为空" });
      }
      if (request.body.mode === "record_and_analyze") {
        return reply.code(501).send({ error: "feature_not_available", message: "AI 分析将在后续阶段开放" });
      }

      try {
        const result = await createEntry(app.db, request.userId, request.body);
        return reply.code(result.duplicate ? 200 : 201).send(result.response);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          return reply.code(409).send({ error: "idempotency_conflict", message: error.message });
        }
        if (error instanceof EntryAlreadyExistsError) {
          return reply.code(409).send({ error: "entry_exists", message: error.message });
        }
        throw error;
      }
    },
  );
}
