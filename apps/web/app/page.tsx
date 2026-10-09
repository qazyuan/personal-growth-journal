"use client";

import type { CreateEntryRequest, EntryDto, EntryMode, EntrySource } from "@journal/contracts";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createEntry, fetchEntries } from "../lib/api";
import { loadDraft, saveDraft } from "../lib/draft";
import { enqueueEntry, loadOutbox, removePendingEntry } from "../lib/outbox";
import { getBrowserSupabase } from "../lib/supabase-browser";

type SaveState = "idle" | "saving" | "saved" | "queued" | "error";

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

function AuthScreen({ onAuthenticated }: { onAuthenticated: (session: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    const result = registering
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) return setMessage(result.error.message);
    if (result.data.session) onAuthenticated(result.data.session);
    else setMessage("注册完成，请按邮箱中的确认链接激活账号。");
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">PERSONAL GROWTH JOURNAL</p>
        <h1>芽儿</h1>
        <p className="auth-intro">一处记录，慢慢看见自己的变化。</p>
        <form onSubmit={submit}>
          <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
          <button type="submit" disabled={busy}>{busy ? "请稍候" : registering ? "创建账号" : "登录"}</button>
        </form>
        {message ? <p className="auth-message">{message}</p> : null}
        <button className="text-button" type="button" onClick={() => { setRegistering(!registering); setMessage(""); }}>
          {registering ? "已有账号，直接登录" : "第一次使用？创建账号"}
        </button>
      </section>
    </main>
  );
}

function Journal({ session }: { session: Session }) {
  const [content, setContent] = useState(() => typeof window === "undefined" ? "" : loadDraft());
  const [mode, setMode] = useState<EntryMode>("record_only");
  const [entries, setEntries] = useState<EntryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [serviceOnline, setServiceOnline] = useState<boolean | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const refresh = useCallback(async () => {
    const result = await fetchEntries();
    setEntries(result.entries);
    setServiceOnline(true);
  }, []);

  const flushOutbox = useCallback(async () => {
    const pending = loadOutbox();
    setPendingCount(pending.length);
    for (const item of pending) {
      try {
        await createEntry(item);
        removePendingEntry(item.operationId);
      } catch {
        setPendingCount(loadOutbox().length);
        setServiceOnline(false);
        return;
      }
    }
    setPendingCount(0);
    if (pending.length) await refresh();
  }, [refresh]);

  useEffect(() => {
    const initializationTimer = window.setTimeout(() => {
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
  }, [flushOutbox, refresh, session.user.id]);

  useEffect(() => { saveDraft(content); }, [content]);

  const groups = useMemo(() => {
    const grouped = new Map<string, EntryDto[]>();
    for (const entry of entries) {
      const key = dateKey(entry.occurredAt);
      grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    }
    return [...grouped.entries()];
  }, [entries]);

  async function submit() {
    const normalized = content.trim();
    if (!normalized || saveState === "saving") return;
    const request: CreateEntryRequest = {
      id: crypto.randomUUID(), operationId: crypto.randomUUID(), occurredAt: new Date().toISOString(),
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
    setSaveState("saving");
    setMessage("已留在本机，正在同步…");
    try {
      const saved = await createEntry(request);
      removePendingEntry(request.operationId);
      setPendingCount(loadOutbox().length);
      setEntries((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)]);
      setServiceOnline(true);
      setSaveState("saved");
      setMessage(mode === "record_and_analyze" ? "记录已保存，AI 分析已排队" : "记录已保存");
    } catch {
      setServiceOnline(false);
      setSaveState("queued");
      setMessage("网络暂不可用，已留在本机，恢复后自动同步");
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && event.metaKey) { event.preventDefault(); void submit(); }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div><p className="eyebrow">PERSONAL GROWTH JOURNAL</p><h1>芽儿</h1></div>
        <div className="account-actions">
          <div className={`sync-mark ${serviceOnline === false ? "offline" : ""}`}>
            <span />{pendingCount ? `${pendingCount} 条待同步` : serviceOnline === false ? "等待网络" : "Supabase 已连接"}
          </div>
          <button className="text-button" type="button" onClick={() => void getBrowserSupabase()?.auth.signOut()}>退出</button>
        </div>
      </header>

      <div className="workspace">
        <section className="composer" aria-labelledby="composer-title">
          <p className="section-label">此刻</p>
          <h2 id="composer-title">有什么想记下来的？</h2>
          <div className="mode-switch" role="group" aria-label="保存模式">
            <button type="button" className={mode === "record_only" ? "active" : ""} onClick={() => setMode("record_only")}>只记录</button>
            <button type="button" className={mode === "record_and_analyze" ? "active" : ""} onClick={() => setMode("record_and_analyze")}>记录并分析</button>
          </div>
          <textarea value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={onKeyDown}
            placeholder="不用整理，先写下来……" rows={8} autoFocus />
          <div className="composer-footer">
            <span className={`save-message ${saveState}`}>{message || "输入内容会先留在当前设备"}</span>
            <button className="primary-button" type="button" onClick={() => void submit()} disabled={!content.trim() || saveState === "saving"}>
              {saveState === "saving" ? "同步中" : "保存记录"}
            </button>
          </div>
          <p className="shortcut">⌘ Enter 快速保存 · AI 任务与原始记录分开保存</p>
        </section>

        <section className="timeline" aria-labelledby="timeline-title">
          <div className="timeline-heading"><div><p className="section-label">时间线</p><h2 id="timeline-title">最近的记录</h2></div><span>{entries.length} 条</span></div>
          {loading ? <p className="empty">正在载入记录……</p> : null}
          {!loading && entries.length === 0 ? <div className="empty-state"><span>○</span><p>第一条记录会出现在这里。</p></div> : null}
          {groups.map(([day, dayEntries]) => (
            <div className="day" key={day}><h3>{day}</h3>
              {dayEntries.map((entry) => <article key={entry.id}>
                <time dateTime={entry.occurredAt}>{timeLabel(entry.occurredAt)}</time>
                <div><p>{entry.content}</p>{entry.mode === "record_and_analyze" ? <small>AI 分析已请求</small> : null}</div>
              </article>)}
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const supabase = getBrowserSupabase();
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  if (!supabase) return <main className="auth-shell"><section className="auth-card"><h1>芽儿</h1><p>尚未配置 Supabase。请先填写本地环境变量。</p></section></main>;
  if (loading) return <main className="auth-shell"><p>正在检查登录状态……</p></main>;
  if (!session) return <AuthScreen onAuthenticated={setSession} />;
  return <Journal session={session} />;
}
