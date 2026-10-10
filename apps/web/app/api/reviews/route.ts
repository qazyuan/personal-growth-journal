import type {
  EntryDto,
  EntryMode,
  EntrySource,
  MonthArchiveDay,
  MonthArchiveResponse,
  OnThisDayResponse,
} from "@journal/contracts";
import { requireUser, type AuthContext } from "../../../lib/supabase-server";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const ON_THIS_DAY_SCAN_LIMIT = 5000;
const MONTH_ENTRY_LIMIT = 500;

type EntryRow = {
  id: string;
  current_revision: number;
  occurred_at: string;
  local_date: string;
  timezone: string;
  created_at: string;
  updated_at: string;
  source: EntrySource;
  mode: EntryMode;
  status: "active" | "deleted";
};

const ENTRY_COLUMNS = "id,current_revision,occurred_at,local_date,timezone,created_at,updated_at,source,mode,status";

function toDto(entry: EntryRow, content: string): EntryDto {
  return {
    id: entry.id,
    revision: entry.current_revision,
    occurredAt: entry.occurred_at,
    localDate: entry.local_date,
    timezone: entry.timezone,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    source: entry.source,
    mode: entry.mode,
    status: entry.status,
    content,
  };
}

async function hydrateEntries(auth: AuthContext, entries: EntryRow[]): Promise<EntryDto[] | Response> {
  if (!entries.length) return [];
  const { data: revisions, error } = await auth.client
    .from("entry_revisions")
    .select("entry_id,revision,content")
    .in("entry_id", entries.map((entry) => entry.id));
  if (error) return Response.json({ message: "读取历史日记正文失败" }, { status: 500 });

  const latest = new Map<string, { revision: number; content: string }>();
  for (const revision of revisions ?? []) {
    const current = latest.get(revision.entry_id);
    if (!current || revision.revision > current.revision) latest.set(revision.entry_id, revision);
  }
  return entries.map((entry) => toDto(entry, latest.get(entry.id)?.content ?? ""));
}

function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const numericMonth = Number(month.slice(5, 7));
  const next = new Date(Date.UTC(year, numericMonth, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

async function onThisDay(auth: AuthContext, localDate: string): Promise<Response> {
  const monthDay = localDate.slice(5);
  const currentYear = Number(localDate.slice(0, 4));
  const { data, error } = await auth.client
    .from("entries")
    .select(ENTRY_COLUMNS)
    .eq("user_id", auth.userId)
    .eq("status", "active")
    .lt("local_date", `${currentYear}-01-01`)
    .order("local_date", { ascending: false })
    .order("occurred_at", { ascending: false })
    .limit(ON_THIS_DAY_SCAN_LIMIT);
  if (error) return Response.json({ message: "读取那年今日失败" }, { status: 500 });

  const matches = ((data ?? []) as EntryRow[]).filter((entry) => entry.local_date.slice(5) === monthDay);
  const hydrated = await hydrateEntries(auth, matches);
  if (hydrated instanceof Response) return hydrated;
  return Response.json({ monthDay, entries: hydrated } satisfies OnThisDayResponse, {
    headers: { "Cache-Control": "no-store" },
  });
}

async function monthArchive(auth: AuthContext, month: string): Promise<Response> {
  const start = `${month}-01`;
  const end = nextMonth(month);
  const { data, error, count } = await auth.client
    .from("entries")
    .select(ENTRY_COLUMNS, { count: "exact" })
    .eq("user_id", auth.userId)
    .eq("status", "active")
    .gte("local_date", start)
    .lt("local_date", end)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MONTH_ENTRY_LIMIT);
  if (error) return Response.json({ message: "读取月份日记失败" }, { status: 500 });

  const rows = (data ?? []) as EntryRow[];
  const hydrated = await hydrateEntries(auth, rows);
  if (hydrated instanceof Response) return hydrated;
  const counts = new Map<string, number>();
  for (const entry of rows) counts.set(entry.local_date, (counts.get(entry.local_date) ?? 0) + 1);
  const days: MonthArchiveDay[] = [...counts].map(([localDate, dayCount]) => ({ localDate, count: dayCount }));
  return Response.json({
    month,
    entries: hydrated,
    days,
    truncated: (count ?? 0) > rows.length,
  } satisfies MonthArchiveResponse, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  if (kind === "on_this_day") {
    const localDate = url.searchParams.get("date") ?? "";
    if (!DATE_PATTERN.test(localDate)) return Response.json({ message: "日期格式无效" }, { status: 400 });
    return onThisDay(auth, localDate);
  }
  if (kind === "month") {
    const month = url.searchParams.get("month") ?? "";
    if (!MONTH_PATTERN.test(month)) return Response.json({ message: "月份格式无效" }, { status: 400 });
    return monthArchive(auth, month);
  }
  return Response.json({ message: "未知的回看方式" }, { status: 400 });
}
