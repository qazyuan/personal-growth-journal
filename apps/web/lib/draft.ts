const DRAFT_KEY = "journal:draft:v1";

export function loadDraft(): string {
  return window.localStorage.getItem(DRAFT_KEY) ?? "";
}

export function saveDraft(content: string): void {
  if (content) window.localStorage.setItem(DRAFT_KEY, content);
  else window.localStorage.removeItem(DRAFT_KEY);
}
