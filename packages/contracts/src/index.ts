export const ENTRY_SOURCES = ["iphone", "mac_web", "ipad_web", "import"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const ENTRY_MODES = ["record_only", "record_and_analyze"] as const;
export type EntryMode = (typeof ENTRY_MODES)[number];

export interface CreateEntryRequest {
  id: string;
  operationId: string;
  occurredAt: string;
  localDate: string;
  timezone: string;
  source: EntrySource;
  mode: EntryMode;
  content: string;
}

export interface EntryDto {
  id: string;
  revision: number;
  occurredAt: string;
  localDate: string;
  timezone: string;
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

export type AnalysisStatus = "queued" | "running" | "completed" | "failed";

export interface ReflectionObservation {
  text: string;
  evidence: string;
}

export interface ReflectionAnalysisResult {
  kind: "reflection";
  observations: ReflectionObservation[];
  question?: string;
}

export interface SafetyAnalysisResult {
  kind: "safety";
  message: string;
}

export type AnalysisResultDto = ReflectionAnalysisResult | SafetyAnalysisResult;

export interface AnalysisStateDto {
  entryId: string;
  status: AnalysisStatus;
  result?: AnalysisResultDto;
  message?: string;
}

export interface AnalysisListResponse {
  analyses: Record<string, AnalysisStateDto>;
}

export type ReflectionMessageRole = "user" | "assistant";

export interface ReflectionMessageDto {
  id: string;
  role: ReflectionMessageRole;
  content: string;
  createdAt: string;
}

export interface ReflectionConversationDto {
  entryId: string;
  conversationId?: string;
  status: "empty" | "active";
  messages: ReflectionMessageDto[];
}

export interface SendReflectionMessageRequest {
  messageId: string;
  content: string;
}

export interface ApiError {
  error: string;
  message: string;
}
