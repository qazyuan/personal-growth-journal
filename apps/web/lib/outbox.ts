import type { CreateEntryRequest } from "@journal/contracts";

const OUTBOX_KEY = "journal:outbox:v1";

export interface PendingEntry extends CreateEntryRequest {
  queuedAt: string;
}

export function loadOutbox(): PendingEntry[] {
  try {
    const value = window.localStorage.getItem(OUTBOX_KEY);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as PendingEntry[]) : [];
  } catch {
    return [];
  }
}

function storeOutbox(entries: PendingEntry[]) {
  if (entries.length === 0) window.localStorage.removeItem(OUTBOX_KEY);
  else window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
}

export function enqueueEntry(entry: CreateEntryRequest): PendingEntry {
  const pending = { ...entry, queuedAt: new Date().toISOString() };
  const current = loadOutbox().filter((item) => item.operationId !== entry.operationId);
  storeOutbox([...current, pending]);
  return pending;
}

export function removePendingEntry(operationId: string) {
  storeOutbox(loadOutbox().filter((item) => item.operationId !== operationId));
}
