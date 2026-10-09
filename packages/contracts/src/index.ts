export const ENTRY_SOURCES = ["iphone", "mac_web", "ipad_web", "import"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const ENTRY_MODES = ["record_only", "record_and_analyze"] as const;
export type EntryMode = (typeof ENTRY_MODES)[number];

export interface CreateEntryRequest {
  id: string;
  operationId: string;
  occurredAt: string;
  source: EntrySource;
  mode: EntryMode;
  content: string;
}

export interface EntryDto {
  id: string;
  revision: number;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  source: EntrySource;
  mode: EntryMode;
  status: "active" | "deleted";
  content: string;
}

export interface CreateEntryResponse extends EntryDto {
  receivedAt: string;
  archiveStatus: "not_implemented" | "queued" | "archived" | "failed";
  analysisStatus: "not_requested" | "queued" | "completed" | "failed";
}

export interface EntryListResponse {
  entries: EntryDto[];
}

export interface ApiError {
  error: string;
  message: string;
}
