"use client";

import type {
  AnalysisStateDto,
  CreateEntryRequest,
  EntryDto,
  EntryMode,
  EntrySource,
  JournalImportPreviewResponse,
  JournalImportResult,
  MonthArchiveResponse,
  OnThisDayResponse,
  ReflectionConversationDto,
  ReflectionMessageDto,
} from "@journal/contracts";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createEntry,
  deleteEntry,
  fetchAnalyses,
  fetchEntries,
  fetchMonthArchive,
  fetchOnThisDay,
  fetchReflectionConversation,
  importJournal,
  previewJournalImport,
  requestAnalysis,
  sendReflectionMessage,
} from "../lib/api";
import { loadDraft, saveDraft } from "../lib/draft";
import { enqueueEntry, loadOutbox, removePendingEntry } from "../lib/outbox";
import { getBrowserSupabase } from "../lib/supabase-browser";

type SaveState = "idle" | "saving" | "saved" | "queued" | "error";
const TIMELINE_PAGE_SIZE = 20;

function sourceForDevice(): EntrySource {
  if (/iPhone|iPod/.test(navigator.userAgent)) return "iphone";
  if (navigator.maxTouchPoints > 1 && /Macintosh|iPad/.test(navigator.userAgent)) return "ipad_web";
  return "mac_web";
}

function dateKey(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  }).format(new Date(value));
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function currentLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonth(): string {
  return currentLocalDate().slice(0, 7);
}

function monthTitle(month: string): string {
  const [year, numericMonth] = month.split("-");
  return `${year}年${Number(numericMonth)}月`;
}

function shiftMonth(month: string, amount: number): string {
  const year = Number(month.slice(0, 4));
  const numericMonth = Number(month.slice(5, 7));
  const date = new Date(year, numericMonth - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function localDateTitle(localDate: string): string {
  const [year, month, day] = localDate.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function AnalysisCard({
  analysis,
  onRetry,
  onContinue,
  conversationOpen,
}: {
  analysis?: AnalysisStateDto;
  onRetry: () => void;
  onContinue: () => void;
  conversationOpen: boolean;
}) {
  if (!analysis || analysis.status === "queued" || analysis.status === "running") {
    return <div className="analysis-card pending"><span className="analysis-dot" />正在生成这一次的回望……</div>;
  }
  if (analysis.status === "failed") {
    return <div className="analysis-card failed"><p>{analysis.message ?? "AI 分析暂时没有完成"}</p><button type="button" onClick={onRetry}>重新分析</button></div>;
  }
  if (!analysis.result) {
    return <div className="analysis-card failed"><p>分析结果暂时无法读取</p><button type="button" onClick={onRetry}>重新分析</button></div>;
  }
  if (analysis.result.kind === "safety") {
    return <div className="analysis-card safety"><p>{analysis.result.message}</p></div>;
  }
  return (
    <div className="analysis-card complete">
      <p className="analysis-title">此刻的回望</p>
      {analysis.result.observations.map((observation, index) => (
        <div className="observation" key={`${observation.evidence}-${index}`}>
          <p>{observation.text}</p>
          <blockquote>“{observation.evidence}”</blockquote>
        </div>
      ))}
      {analysis.result.question ? <p className="reflection-question">想一想：{analysis.result.question}</p> : null}
      <div className="analysis-actions">
        <button type="button" onClick={onContinue}>{conversationOpen ? "收起对话" : "继续聊聊"}</button>
        <span>只参考这篇记录</span>
      </div>
    </div>
  );
}

function ReflectionConversation({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const [conversation, setConversation] = useState<ReflectionConversationDto | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [failedSubmission, setFailedSubmission] = useState<{ id: string; content: string } | null>(null);

  useEffect(() => {
    let active = true;
    void fetchReflectionConversation(entryId)
      .then((result) => { if (active) setConversation(result); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "无法读取回望对话"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [entryId]);

  async function submitTurn(retry?: { id: string; content: string }) {
    const content = (retry?.content ?? draft).trim();
    if (!content || sending) return;
    const messageId = retry?.id ?? crypto.randomUUID();
    if (!retry) {
      const optimistic: ReflectionMessageDto = {
        id: messageId,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };
      setConversation((current) => ({
        entryId,
        conversationId: current?.conversationId,
        status: "active",
        messages: [...(current?.messages ?? []), optimistic],
      }));
      setDraft("");
    }
    setSending(true);
    setError("");
    setFailedSubmission(null);
    try {
      setConversation(await sendReflectionMessage(entryId, { messageId, content }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI 回望暂时不可用");
      setFailedSubmission({ id: messageId, content });
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="conversation-panel" aria-label="回望对话">
      <div className="conversation-heading">
        <div><h4>继续回望</h4><p>AI 只会参考这篇记录、即时回望和下面的对话。</p></div>
        <button className="text-button" type="button" onClick={onClose}>收起</button>
      </div>
      {loading ? <p className="conversation-status">正在读取对话……</p> : null}
      {!loading && !conversation?.messages.length ? <p className="conversation-empty">可以回答上面的问题，也可以从任何你想说的地方开始。</p> : null}
      <div className="conversation-messages" aria-live="polite">
        {conversation?.messages.map((item) => (
          <div className={`conversation-message ${item.role}`} key={item.id}>
            <span aria-label={item.role === "user" ? "你" : "来时路"} title={item.role === "user" ? "你" : "来时路"}>
              {item.role === "user" ? "你" : "路"}
            </span>
            <p>{item.content}</p>
          </div>
        ))}
        {sending ? <div className="conversation-message assistant thinking"><span aria-label="来时路" title="来时路">路</span><p><i />正在回应……</p></div> : null}
      </div>
      {error ? <div className="conversation-error"><span>{error}</span>{failedSubmission ? <button type="button" onClick={() => void submitTurn(failedSubmission)}>重试</button> : null}</div> : null}
      <div className="conversation-composer">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && event.metaKey) { event.preventDefault(); void submitTurn(); } }}
          placeholder="把刚才想到的继续说下去……"
          maxLength={4000}
          rows={3}
        />
        <div><span>⌘ Enter 发送 · 随时可以停下</span><button type="button" onClick={() => void submitTurn()} disabled={!draft.trim() || sending}>{sending ? "回应中" : "发送"}</button></div>
      </div>
    </section>
  );
}

function DeleteEntryDialog({
  entry,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  entry?: EntryDto;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!entry) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, entry, onCancel]);

  if (!entry) return null;

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <section
        className="delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <h2 id="delete-dialog-title">确定删除这条记录吗？</h2>
        <p id="delete-dialog-description">删除后会从时间线移除，当前版本无法恢复。</p>
        <p className="delete-dialog-preview">{entry.content}</p>
        {error ? <p className="delete-dialog-error" role="alert">{error}</p> : null}
        <div className="delete-dialog-actions">
          <button type="button" onClick={onCancel} disabled={busy} autoFocus>取消</button>
          <button className="danger-button" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? "删除中" : "确认删除"}
          </button>
        </div>
      </section>
    </div>
  );
}

function JournalImportDialog({
  onCancel,
  onImported,
}: {
  onCancel: () => void;
  onImported: (result: JournalImportResult) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<JournalImportPreviewResponse | null>(null);
  const [state, setState] = useState<"idle" | "previewing" | "ready" | "importing">("idle");
  const [error, setError] = useState("");
  const busy = state === "previewing" || state === "importing";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);

  async function inspectFile(selected: File) {
    setFile(selected);
    setPreview(null);
    setError("");
    setState("previewing");
    try {
      setPreview(await previewJournalImport(selected));
      setState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Excel 文件读取失败");
      setState("idle");
    }
  }

  async function confirmImport() {
    if (!file || !preview?.importableRows || busy) return;
    setState("importing");
    setError("");
    try {
      onImported(await importJournal(file));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "历史日记导入失败");
      setState("ready");
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title">
        <div className="import-dialog-heading">
          <div>
            <h2 id="import-dialog-title">导入历史日记</h2>
            <p>读取 Excel 第 3 个工作表“日记”，先预览，再写入时间线。</p>
          </div>
          <button className="text-button" type="button" onClick={onCancel} disabled={busy}>关闭</button>
        </div>

        <label className={`import-file-field ${busy ? "busy" : ""}`}>
          <span>{state === "previewing" ? "正在读取 Excel…" : file ? file.name : "选择 Excel 文件"}</span>
          <small>.xlsx · 最大 10 MB</small>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) void inspectFile(selected);
            }}
            disabled={busy}
          />
        </label>

        {preview ? (
          <div className="import-preview" aria-live="polite">
            <dl className="import-summary">
              <div><dt>将导入</dt><dd>{preview.importableRows} 条</dd></div>
              <div><dt>已存在</dt><dd>{preview.duplicateRows} 条</dd></div>
              <div><dt>需修正</dt><dd>{preview.invalidRows} 条</dd></div>
            </dl>
            <p className="import-note">时间按 Asia/Shanghai 解释；历史记录只保存原文，不自动发起 AI 分析。</p>
            {preview.entries.length ? (
              <div className="import-entry-list">
                {preview.entries.map((entry) => (
                  <div className={entry.duplicate ? "duplicate" : ""} key={entry.rowNumber}>
                    <div>
                      <time dateTime={entry.occurredAt}>{entry.localDate} · {timeLabel(entry.occurredAt)}</time>
                      {entry.duplicate ? <span>已存在</span> : null}
                    </div>
                    <p>{entry.contentPreview}</p>
                    {entry.address || entry.tags ? <small>{[entry.address, entry.tags].filter(Boolean).join(" · ")}</small> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {preview.errors.length ? (
              <div className="import-errors">
                <p>以下内容需要先修正：</p>
                <ul>{preview.errors.map((item) => <li key={item.rowNumber}>第 {item.rowNumber} 行：{item.message}</li>)}</ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="import-error" role="alert">{error}</p> : null}
        <div className="import-dialog-actions">
          <button type="button" onClick={onCancel} disabled={busy}>取消</button>
          <button className="primary-button" type="button" onClick={() => void confirmImport()} disabled={!preview?.importableRows || busy}>
            {state === "importing" ? "正在导入…" : preview?.importableRows ? `导入 ${preview.importableRows} 条` : "确认导入"}
          </button>
        </div>
      </section>
    </div>
  );
}

type AuthMode = "login" | "register" | "forgot";

function friendlyAuthError(message: string): string {
  if (/failed to fetch|network/i.test(message)) return "无法连接登录服务，请检查网络后重试";
  if (/invalid login credentials/i.test(message)) return "邮箱或密码不正确";
  if (/email not confirmed/i.test(message)) return "请先完成邮箱验证";
  if (/expired|invalid.*token|otp/i.test(message)) return "链接无效或已经过期，请重新发送密码重置邮件";
  return message;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (session: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<AuthMode>("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/?recovery=1`,
      });
      setBusy(false);
      setMessage(error
        ? friendlyAuthError(error.message)
        : "如果这个邮箱已注册，你会收到一封密码重置邮件。请在同一台设备上打开链接。");
      return;
    }
    const result = mode === "register"
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) return setMessage(friendlyAuthError(result.error.message));
    if (result.data.session) onAuthenticated(result.data.session);
    else setMessage("注册完成，请按邮箱中的确认链接激活账号。");
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">PERSONAL GROWTH JOURNAL</p>
        <h1>来时路</h1>
        <p className="auth-intro">{mode === "forgot" ? "输入注册邮箱，我们会发送密码重置链接。" : "记录此刻，看见一路走来的自己。"}</p>
        <form onSubmit={submit}>
          <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          {mode !== "forgot" ? <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label> : null}
          <button type="submit" disabled={busy}>{busy ? "请稍候" : mode === "register" ? "创建账号" : mode === "forgot" ? "发送重置邮件" : "登录"}</button>
        </form>
        {message ? <p className="auth-message">{message}</p> : null}
        <div className="auth-links">
          <button className="text-button" type="button" onClick={() => { setMode(mode === "register" ? "login" : "register"); setMessage(""); }}>
            {mode === "register" ? "已有账号，直接登录" : "第一次使用？创建账号"}
          </button>
          <button className="text-button" type="button" onClick={() => { setMode(mode === "forgot" ? "login" : "forgot"); setMessage(""); }}>
            {mode === "forgot" ? "返回登录" : "忘记密码"}
          </button>
        </div>
      </section>
    </main>
  );
}

function ResetPasswordScreen({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmation) return setMessage("两次输入的密码不一致");
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      setMessage(friendlyAuthError(error.message));
      return;
    }
    await supabase.auth.signOut();
    window.history.replaceState({}, "", "/");
    setBusy(false);
    onDone();
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">ACCOUNT SECURITY</p>
        <h1>设置新密码</h1>
        <p className="auth-intro">更新成功后，需要使用新密码重新登录。</p>
        <form onSubmit={submit}>
          <label>新密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} autoComplete="new-password" required /></label>
          <label>再次输入<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={8} autoComplete="new-password" required /></label>
          <button type="submit" disabled={busy}>{busy ? "正在更新" : "确认修改密码"}</button>
        </form>
        {message ? <p className="auth-message">{message}</p> : null}
        <button className="text-button" type="button" onClick={onCancel}>取消</button>
      </section>
    </main>
  );
}

function OnThisDay({ state, loading, error }: {
  state: OnThisDayResponse | null;
  loading: boolean;
  error: string;
}) {
  return (
    <section className="on-this-day" aria-labelledby="on-this-day-title">
      <div className="on-this-day-heading">
        <div>
          <h2 id="on-this-day-title">那年今日</h2>
          <p>同一个日子，看看过去的自己正在经历什么。</p>
        </div>
        <time dateTime={currentLocalDate()}>{Number(currentLocalDate().slice(5, 7))}月{Number(currentLocalDate().slice(8, 10))}日</time>
      </div>
      {loading ? <p className="memory-state">正在翻找过去的今天……</p> : null}
      {!loading && error ? <p className="memory-state error">{error}</p> : null}
      {!loading && !error && !state?.entries.length ? (
        <p className="memory-state">过去的今天还没有记录。时间再走远一些，这里会慢慢有内容。</p>
      ) : null}
      {state?.entries.map((entry) => (
        <article className="memory-entry" key={entry.id}>
          <div>
            <strong>{entry.localDate.slice(0, 4)}</strong>
            <span>{timeLabel(entry.occurredAt)}</span>
          </div>
          <p>{entry.content}</p>
        </article>
      ))}
    </section>
  );
}

function MonthCalendar({ month, days, selectedDate, onSelect }: {
  month: string;
  days: MonthArchiveResponse["days"];
  selectedDate: string | null;
  onSelect: (date: string | null) => void;
}) {
  const year = Number(month.slice(0, 4));
  const numericMonth = Number(month.slice(5, 7));
  const dayCount = new Date(year, numericMonth, 0).getDate();
  const leadingBlanks = (new Date(year, numericMonth - 1, 1).getDay() + 6) % 7;
  const counts = new Map(days.map((day) => [day.localDate, day.count]));
  const cells = Array.from({ length: leadingBlanks + dayCount }, (_, index) => index < leadingBlanks ? null : index - leadingBlanks + 1);
  return (
    <div className="history-calendar" aria-label={`${monthTitle(month)}日历`}>
      <div className="calendar-weekdays" aria-hidden="true">
        {['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="calendar-grid">
        {cells.map((day, index) => {
          if (!day) return <span className="calendar-blank" key={`blank-${index}`} />;
          const localDate = `${month}-${String(day).padStart(2, "0")}`;
          const count = counts.get(localDate) ?? 0;
          return (
            <button
              className={selectedDate === localDate ? "selected" : count ? "has-entry" : ""}
              type="button"
              key={localDate}
              onClick={() => onSelect(selectedDate === localDate ? null : localDate)}
              aria-pressed={selectedDate === localDate}
              aria-label={`${day}日${count ? `，${count}条记录` : "，没有记录"}`}
            >
              <span>{day}</span>{count ? <i>{count}</i> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HistoryArchive({ onClose }: { onClose: () => void }) {
  const [month, setMonth] = useState(currentMonth);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [archive, setArchive] = useState<MonthArchiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetchMonthArchive(month)
      .then((result) => { if (active) setArchive(result); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "无法读取这个月的记录"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [month]);

  const visibleEntries = selectedDate
    ? (archive?.entries ?? []).filter((entry) => entry.localDate === selectedDate)
    : archive?.entries ?? [];

  function chooseMonth(nextMonth: string) {
    if (!nextMonth || nextMonth === month) return;
    setLoading(true);
    setError("");
    setArchive(null);
    setSelectedDate(null);
    setMonth(nextMonth);
  }

  return (
    <section className="history-view" aria-labelledby="history-title">
      <div className="history-title-row">
        <div>
          <button className="history-back" type="button" onClick={onClose}>返回记录</button>
          <h2 id="history-title">完整历史</h2>
          <p>按月份和日期回到任何一段已经写下的生活。</p>
        </div>
        <label className="month-picker">选择月份<input type="month" value={month} onChange={(event) => chooseMonth(event.target.value)} /></label>
      </div>
      <div className="history-browser">
        <aside>
          <div className="month-switcher">
            <button type="button" onClick={() => chooseMonth(shiftMonth(month, -1))} aria-label="上一个月">上一月</button>
            <strong>{monthTitle(month)}</strong>
            <button type="button" onClick={() => chooseMonth(shiftMonth(month, 1))} aria-label="下一个月">下一月</button>
          </div>
          <MonthCalendar month={month} days={archive?.days ?? []} selectedDate={selectedDate} onSelect={setSelectedDate} />
          {selectedDate ? <button className="show-month" type="button" onClick={() => setSelectedDate(null)}>查看整月</button> : null}
        </aside>
        <div className="history-results">
          <div className="history-results-heading">
            <h3>{selectedDate ? localDateTitle(selectedDate) : monthTitle(month)}</h3>
            <span>{visibleEntries.length} 条</span>
          </div>
          {loading ? <p className="history-state">正在读取记录……</p> : null}
          {!loading && error ? <p className="history-state error">{error}</p> : null}
          {!loading && !error && !visibleEntries.length ? <p className="history-state">这个时间还没有记录。</p> : null}
          {!loading && !error ? visibleEntries.map((entry) => (
            <article className="history-entry" key={entry.id}>
              <time dateTime={entry.occurredAt}>{localDateTitle(entry.localDate)} · {timeLabel(entry.occurredAt)}</time>
              <p>{entry.content}</p>
            </article>
          )) : null}
          {archive?.truncated ? <p className="history-limit">这个月的记录超过 500 条，目前先显示前 500 条。</p> : null}
        </div>
      </div>
    </section>
  );
}

function Journal({ session, onChangePassword }: { session: Session; onChangePassword: () => void }) {
  const [content, setContent] = useState(() => typeof window === "undefined" ? "" : loadDraft());
  const [entries, setEntries] = useState<EntryDto[]>([]);
  const [entryTotal, setEntryTotal] = useState(0);
  const [analyses, setAnalyses] = useState<Record<string, AnalysisStateDto>>({});
  const [onThisDay, setOnThisDay] = useState<OnThisDayResponse | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(true);
  const [memoryError, setMemoryError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [serviceOnline, setServiceOnline] = useState<boolean | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [openConversationEntryId, setOpenConversationEntryId] = useState<string | null>(null);
  const [savingMode, setSavingMode] = useState<EntryMode | null>(null);
  const [confirmDeleteEntryId, setConfirmDeleteEntryId] = useState<string | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [toast, setToast] = useState<{ id: string; message: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const runAnalysis = useCallback(async (entryId: string) => {
    setAnalyses((current) => ({ ...current, [entryId]: { entryId, status: "running" } }));
    try {
      const result = await requestAnalysis(entryId);
      setAnalyses((current) => ({ ...current, [entryId]: result }));
    } catch (error) {
      const failure: AnalysisStateDto = {
        entryId,
        status: "failed",
        message: error instanceof Error ? error.message : "AI 分析暂时不可用，可以稍后重试",
      };
      setAnalyses((current) => ({ ...current, [entryId]: failure }));
    }
  }, []);

  const refresh = useCallback(async () => {
    const result = await fetchEntries({ limit: TIMELINE_PAGE_SIZE });
    setEntries(result.entries);
    setEntryTotal(result.total);
    setServiceOnline(true);
    try {
      const analysisResult = await fetchAnalyses();
      setAnalyses(analysisResult.analyses);
      for (const analysis of Object.values(analysisResult.analyses)) {
        if (analysis.status === "queued") void runAnalysis(analysis.entryId);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI 分析状态暂时无法读取");
    }
  }, [runAnalysis]);

  const loadOnThisDay = useCallback(async () => {
    setMemoryLoading(true);
    setMemoryError("");
    try {
      setOnThisDay(await fetchOnThisDay(currentLocalDate()));
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "无法读取那年今日");
    } finally {
      setMemoryLoading(false);
    }
  }, []);

  const flushOutbox = useCallback(async () => {
    const pending = loadOutbox();
    setPendingCount(pending.length);
    for (const item of pending) {
      try {
        await createEntry(item);
        removePendingEntry(item.operationId);
      } catch (error) {
        setPendingCount(loadOutbox().length);
        setServiceOnline(false);
        setMessage(error instanceof Error ? `${error.message}；记录仍在本机` : "同步暂不可用；记录仍在本机");
        return;
      }
    }
    setPendingCount(0);
    if (pending.length) await refresh();
  }, [refresh]);

  useEffect(() => {
    const initializationTimer = window.setTimeout(() => {
      void loadOnThisDay();
      void refresh()
        .then(flushOutbox)
        .catch((error: unknown) => {
          setServiceOnline(false);
          setPendingCount(loadOutbox().length);
          setMessage(error instanceof Error ? error.message : "加载失败");
        })
        .finally(() => setLoading(false));
    }, 0);
    const retry = () => void flushOutbox();
    window.addEventListener("online", retry);
    return () => {
      window.clearTimeout(initializationTimer);
      window.removeEventListener("online", retry);
    };
  }, [flushOutbox, loadOnThisDay, refresh, session.user.id]);

  useEffect(() => { saveDraft(content); }, [content]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast((current) => current?.id === toast.id ? null : current);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const groups = useMemo(() => {
    const grouped = new Map<string, EntryDto[]>();
    for (const entry of entries) {
      const key = dateKey(entry.occurredAt);
      grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    }
    return [...grouped.entries()];
  }, [entries]);

  const entryToDelete = entries.find((entry) => entry.id === confirmDeleteEntryId);

  async function submit(mode: EntryMode) {
    const normalized = content.trim();
    if (!normalized || saveState === "saving") return;
    const request: CreateEntryRequest = {
      id: crypto.randomUUID(), operationId: crypto.randomUUID(), occurredAt: new Date().toISOString(),
      localDate: currentLocalDate(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      source: sourceForDevice(), mode, content: normalized,
    };
    try {
      enqueueEntry(request);
    } catch {
      setSaveState("error");
      setMessage("本机空间不足，尚未发送；文字仍留在输入框");
      return;
    }

    setPendingCount(loadOutbox().length);
    setContent("");
    saveDraft("");
    setSavingMode(mode);
    setSaveState("saving");
    setMessage("已留在本机，正在同步…");
    try {
      const saved = await createEntry(request);
      removePendingEntry(request.operationId);
      setPendingCount(loadOutbox().length);
      setEntries((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)]);
      setEntryTotal((current) => current + 1);
      setServiceOnline(true);
      setSaveState("saved");
      setMessage(request.mode === "record_and_analyze" ? "记录已保存，正在生成回望" : "记录已保存");
      if (request.mode === "record_and_analyze") void runAnalysis(saved.id);
    } catch (error) {
      setServiceOnline(false);
      setSaveState("queued");
      setMessage(error instanceof Error ? `${error.message}；已留在本机，稍后可安全重试` : "同步暂不可用，已留在本机");
    } finally {
      setSavingMode(null);
    }
  }

  async function removeEntry(entryId: string) {
    if (deletingEntryId) return;
    setDeletingEntryId(entryId);
    setDeleteError("");
    try {
      await deleteEntry(entryId);
      setEntries((current) => current.filter((entry) => entry.id !== entryId));
      setEntryTotal((current) => Math.max(0, current - 1));
      setAnalyses((current) => {
        const next = { ...current };
        delete next[entryId];
        return next;
      });
      if (openConversationEntryId === entryId) setOpenConversationEntryId(null);
      setConfirmDeleteEntryId(null);
      setServiceOnline(true);
      setToast({ id: crypto.randomUUID(), message: "记录已删除" });
      setDeletingEntryId(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除失败，请稍后重试");
    } finally {
      setDeletingEntryId((current) => current === entryId ? null : current);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && event.metaKey) { event.preventDefault(); void submit("record_only"); }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div><p className="eyebrow">PERSONAL GROWTH JOURNAL</p><h1>来时路</h1></div>
        <div className="account-actions">
          <div className={`sync-mark ${serviceOnline === false ? "offline" : ""}`}>
            <span />{pendingCount ? `${pendingCount} 条待同步` : serviceOnline === false ? "同步待恢复" : "Supabase 已连接"}
          </div>
          <button className="text-button" type="button" onClick={onChangePassword}>修改密码</button>
          <button className="text-button" type="button" onClick={() => void getBrowserSupabase()?.auth.signOut()}>退出</button>
        </div>
      </header>

      {historyOpen ? <HistoryArchive onClose={() => setHistoryOpen(false)} /> : <div className="workspace">
        <section className="composer" aria-labelledby="composer-title">
          <p className="section-label">此刻</p>
          <h2 id="composer-title">有什么想记下来的？</h2>
          <textarea value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={onKeyDown}
            placeholder="不用整理，先写下来……" rows={8} autoFocus />
          <div className="composer-footer">
            <span className={`save-message ${saveState}`}>{message || "输入内容会先留在当前设备"}</span>
            <div className="save-actions" role="group" aria-label="保存记录">
              <button className="secondary-button" type="button" onClick={() => void submit("record_only")} disabled={!content.trim() || saveState === "saving"}>
                {savingMode === "record_only" ? "保存中" : "只保存"}
              </button>
              <button className="primary-button" type="button" onClick={() => void submit("record_and_analyze")} disabled={!content.trim() || saveState === "saving"}>
                {savingMode === "record_and_analyze" ? "保存中" : "保存并分析"}
              </button>
            </div>
          </div>
          <p className="shortcut">⌘ Enter 只保存 · AI 分析与原始记录分开保存</p>
        </section>

        <section className="timeline" aria-labelledby="timeline-title">
          <div className="timeline-heading">
            <div><p className="section-label">时间线</p><h2 id="timeline-title">最近的记录</h2></div>
            <div className="timeline-heading-actions">
              <span>{entryTotal} 条</span>
              <button type="button" onClick={() => setHistoryOpen(true)}>完整历史</button>
              <button type="button" onClick={() => setImportOpen(true)}>导入日记</button>
            </div>
          </div>
          {loading ? <p className="empty">正在载入记录……</p> : null}
          {!loading && entries.length === 0 ? <div className="empty-state"><span>○</span><p>第一条记录会出现在这里。</p></div> : null}
          {groups.map(([day, dayEntries]) => (
            <div className="day" key={day}><h3>{day}</h3>
              {dayEntries.map((entry) => <article key={entry.id}>
                <time dateTime={entry.occurredAt}>{timeLabel(entry.occurredAt)}</time>
                <div className="entry-body">
                  <p>{entry.content}</p>
                  {entry.mode === "record_and_analyze" ? <AnalysisCard
                    analysis={analyses[entry.id]}
                    onRetry={() => void runAnalysis(entry.id)}
                    onContinue={() => setOpenConversationEntryId((current) => current === entry.id ? null : entry.id)}
                    conversationOpen={openConversationEntryId === entry.id}
                  /> : null}
                  {openConversationEntryId === entry.id ? <ReflectionConversation entryId={entry.id} onClose={() => setOpenConversationEntryId(null)} /> : null}
                  <div className="entry-actions">
                    <button className="delete-trigger" type="button" onClick={() => {
                      setDeleteError("");
                      setConfirmDeleteEntryId(entry.id);
                    }}>删除</button>
                  </div>
                </div>
              </article>)}
            </div>
          ))}
          <OnThisDay state={onThisDay} loading={memoryLoading} error={memoryError} />
        </section>
      </div>}
      <DeleteEntryDialog
        entry={entryToDelete}
        busy={Boolean(deletingEntryId)}
        error={deleteError}
        onCancel={() => {
          setDeleteError("");
          setConfirmDeleteEntryId(null);
        }}
        onConfirm={() => {
          if (entryToDelete) void removeEntry(entryToDelete.id);
        }}
      />
      {importOpen ? <JournalImportDialog
        onCancel={() => setImportOpen(false)}
        onImported={(result) => {
          setImportOpen(false);
          const message = result.replayed
            ? "这份 Excel 此前已经导入"
            : `已导入 ${result.importedRows} 条${result.duplicateRows ? `，跳过 ${result.duplicateRows} 条重复` : ""}`;
          setToast({ id: crypto.randomUUID(), message });
          void loadOnThisDay();
          void refresh().catch((reason: unknown) => {
            setMessage(reason instanceof Error ? reason.message : "导入完成，列表稍后刷新");
          });
        }}
      /> : null}
      {toast ? <div className="status-toast" role="status">{toast.message}</div> : null}
    </main>
  );
}

export default function Home() {
  const [recoveryMode, setRecoveryMode] = useState(() => typeof window !== "undefined" && (
    new URLSearchParams(window.location.search).get("recovery") === "1"
    || new URLSearchParams(window.location.hash.replace(/^#/, "")).get("type") === "recovery"
  ));
  const [session, setSession] = useState<Session | null>(null);
  const supabase = getBrowserSupabase();
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  if (!supabase) return <main className="auth-shell"><section className="auth-card"><h1>来时路</h1><p className="auth-intro">记录此刻，看见一路走来的自己。</p><p>尚未配置 Supabase。请先填写本地环境变量。</p></section></main>;
  if (loading) return <main className="auth-shell"><p>正在检查登录状态……</p></main>;
  if (recoveryMode && session) return <ResetPasswordScreen onDone={() => { setRecoveryMode(false); setSession(null); }} onCancel={() => { window.history.replaceState({}, "", "/"); setRecoveryMode(false); }} />;
  if (recoveryMode && !session) return <main className="auth-shell"><section className="auth-card"><h1>链接已失效</h1><p className="auth-intro">请返回登录页，重新发送密码重置邮件。</p><button className="text-button" type="button" onClick={() => { window.history.replaceState({}, "", "/"); setRecoveryMode(false); }}>返回登录</button></section></main>;
  if (!session) return <AuthScreen onAuthenticated={setSession} />;
  return <Journal session={session} onChangePassword={() => setRecoveryMode(true)} />;
}
