import { createHash } from "node:crypto";
import type {
  CreateEntryRequest,
  CreateEntryResponse,
  EntryDto,
  EntryMode,
  EntrySource,
} from "@journal/contracts";
import type { DatabaseClient, DatabasePool } from "@journal/database";

interface EntryRow {
  id: string;
  current_revision: number;
  occurred_at: Date;
  created_at: Date;
  updated_at: Date;
  source: EntrySource;
  mode: EntryMode;
  status: "active" | "deleted";
  content: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requestHash(body: CreateEntryRequest, normalizedContent: string): string {
  return sha256(
    JSON.stringify({
      id: body.id,
      operationId: body.operationId,
      occurredAt: new Date(body.occurredAt).toISOString(),
      source: body.source,
      mode: body.mode,
      content: normalizedContent,
    }),
  );
}

function toEntryDto(row: EntryRow): EntryDto {
  return {
    id: row.id,
    revision: row.current_revision,
    occurredAt: row.occurred_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    source: row.source,
    mode: row.mode,
    status: row.status,
    content: row.content,
  };
}

export async function listEntries(db: DatabasePool, ownerId: string): Promise<EntryDto[]> {
  const result = await db.query<EntryRow>(
    `SELECT e.id, e.current_revision, e.occurred_at, e.created_at, e.updated_at,
            e.source, e.mode, e.status, r.content
     FROM entries e
     JOIN entry_revisions r
       ON r.entry_id = e.id AND r.revision = e.current_revision
     WHERE e.owner_id = $1 AND e.status = 'active'
     ORDER BY e.occurred_at DESC, e.id DESC`,
    [ownerId],
  );
  return result.rows.map(toEntryDto);
}

export async function getEntry(
  db: DatabasePool,
  ownerId: string,
  entryId: string,
): Promise<EntryDto | null> {
  const result = await db.query<EntryRow>(
    `SELECT e.id, e.current_revision, e.occurred_at, e.created_at, e.updated_at,
            e.source, e.mode, e.status, r.content
     FROM entries e
     JOIN entry_revisions r
       ON r.entry_id = e.id AND r.revision = e.current_revision
     WHERE e.owner_id = $1 AND e.id = $2`,
    [ownerId, entryId],
  );
  return result.rows[0] ? toEntryDto(result.rows[0]) : null;
}

async function loadOperation(
  client: DatabaseClient,
  ownerId: string,
  operationId: string,
): Promise<{ request_hash: string; response_json: CreateEntryResponse | null } | null> {
  const result = await client.query<{
    request_hash: string;
    response_json: CreateEntryResponse | null;
  }>(
    `SELECT request_hash, response_json
     FROM client_operations
     WHERE owner_id = $1 AND operation_id = $2`,
    [ownerId, operationId],
  );
  return result.rows[0] ?? null;
}

export class IdempotencyConflictError extends Error {}
export class EntryAlreadyExistsError extends Error {}

export async function createEntry(
  db: DatabasePool,
  ownerId: string,
  body: CreateEntryRequest,
): Promise<{ response: CreateEntryResponse; duplicate: boolean }> {
  const content = body.content.trim();
  const hash = requestHash(body, content);
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const reserved = await client.query(
      `INSERT INTO client_operations
         (owner_id, operation_id, operation_type, entity_id, request_hash)
       VALUES ($1, $2, 'create_entry', $3, $4)
       ON CONFLICT (owner_id, operation_id) DO NOTHING
       RETURNING operation_id`,
      [ownerId, body.operationId, body.id, hash],
    );

    if (!reserved.rowCount) {
      const existing = await loadOperation(client, ownerId, body.operationId);
      if (!existing || existing.request_hash !== hash) {
        throw new IdempotencyConflictError("operationId 已被其他请求使用");
      }
      if (!existing.response_json) {
        throw new Error("Idempotent operation is missing its stored response");
      }
      await client.query("COMMIT");
      return { response: existing.response_json, duplicate: true };
    }

    const inserted = await client.query<EntryRow>(
      `INSERT INTO entries (id, owner_id, current_revision, occurred_at, source, mode)
       VALUES ($1, $2, 1, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING
       RETURNING id, current_revision, occurred_at, created_at, updated_at, source, mode, status,
                 $6::text AS content`,
      [body.id, ownerId, body.occurredAt, body.source, body.mode, content],
    );

    const entry = inserted.rows[0];
    if (!entry) {
      throw new EntryAlreadyExistsError("entry id 已存在");
    }

    await client.query(
      `INSERT INTO entry_revisions
         (entry_id, revision, content, content_hash, created_by_device)
       VALUES ($1, 1, $2, $3, $4)`,
      [body.id, content, sha256(content), body.source],
    );

    const dto = toEntryDto(entry);
    const response: CreateEntryResponse = {
      ...dto,
      receivedAt: dto.createdAt,
      archiveStatus: "not_implemented",
      analysisStatus: "not_requested",
    };

    await client.query(
      `UPDATE client_operations
       SET response_json = $3::jsonb
       WHERE owner_id = $1 AND operation_id = $2`,
      [ownerId, body.operationId, JSON.stringify(response)],
    );
    await client.query("COMMIT");
    return { response, duplicate: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
