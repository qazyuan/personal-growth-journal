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
  total: number;
  nextOffset: number | null;
}

export interface OnThisDayResponse {
  monthDay: string;
  entries: EntryDto[];
}

export interface ArchiveResponse {
  startDate: string;
  endDate: string;
  entries: EntryDto[];
  truncated: boolean;
}

export type PeriodicReviewKind = "half_year" | "custom" | "year";
export type PeriodicReviewStatus = "running" | "completed" | "failed";

export interface PeriodicReviewEvidence {
  entryId: string;
  localDate: string;
  quote: string;
}

export interface PeriodicReviewTheme {
  title: string;
  observation: string;
  evidence: PeriodicReviewEvidence[];
}

export interface PeriodicReviewTurningPoint {
  title: string;
  observation: string;
  evidence: PeriodicReviewEvidence;
}

export interface PeriodicReviewResult {
  overview: string;
  themes: PeriodicReviewTheme[];
  turningPoints: PeriodicReviewTurningPoint[];
  changes: string[];
  unresolved: string[];
  question?: string;
}

export interface PeriodicReviewDto {
  id: string;
  kind: PeriodicReviewKind;
  startDate: string;
  endDate: string;
  entryCount: number;
  status: PeriodicReviewStatus;
  result?: PeriodicReviewResult;
  createdAt: string;
  updatedAt: string;
  message?: string;
}

export interface PeriodicReviewListResponse {
  reviews: PeriodicReviewDto[];
}

export interface GeneratePeriodicReviewRequest {
  kind: PeriodicReviewKind;
  startDate: string;
  endDate: string;
}

export interface DeleteEntryResponse {
  id: string;
  status: "deleted";
}

export interface JournalImportPreviewEntry {
  rowNumber: number;
  occurredAt: string;
  localDate: string;
  contentPreview: string;
  address?: string;
  tags?: string;
  duplicate: boolean;
}

export interface JournalImportRowError {
  rowNumber: number;
  message: string;
}

export interface JournalImportPreviewResponse {
  fileName: string;
  sheetName: "日记";
  assumedTimezone: string;
  totalRows: number;
  importableRows: number;
  duplicateRows: number;
  invalidRows: number;
  entries: JournalImportPreviewEntry[];
  errors: JournalImportRowError[];
}

export interface JournalImportResult {
  batchId: string;
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  invalidRows: number;
  replayed: boolean;
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
