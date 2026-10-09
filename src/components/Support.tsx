// FestivaLGU — chat support: the floating user widget and the admin Support Inbox.
//
// Real-time: Supabase `postgres_changes` on support_messages / support_conversations
// (RLS decides what each viewer receives) plus a polling fallback, the same
// approach as `useSalesLive` in App.tsx. Bot replies come from the server
// (/api/chat); the AI key never reaches the browser.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import {
  MessageCircle, X, Send, Loader2, Bot, UserRound, ShieldCheck, CheckCircle2,
  RotateCcw, Sparkles, FileText, ArrowLeft, Inbox,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type Sender = "user" | "bot" | "admin";
type Status = "open" | "escalated" | "resolved";

interface Msg {
  id: number | string;
  conversation_id: number;
  sender: Sender;
  body: string;
  read_by_user: boolean;
  read_by_admin: boolean;
  created_at: string;
}
interface Conv {
  id: number;
  user_id: string;
  municipality: string | null;
  status: Status;
  last_message_at: string;
  created_at: string;
}

const POLL_MS = 20000;
const MAX_LEN = 1000;

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  return { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}` };
}

async function callApi(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  try {
    const res = await fetch(path, { method: "POST", headers: await authHeader(), body: JSON.stringify(body) });
    let json: any = {};
    try { json = await res.json(); } catch { /* non-JSON error page */ }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: {} };
  }
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === today.toDateString()
    ? time
    : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

const STATUS_STYLE: Record<Status, string> = {
  open: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  escalated: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  resolved: "bg-green-500/15 text-green-600 dark:text-green-400",
};

function StatusPill({ status }: { status: Status }) {
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[status]}`}>{status}</span>;
}

function Bubble({ m, viewer }: { m: Msg; viewer: "user" | "admin" }) {
  const mine = m.sender === viewer;
  const Icon = m.sender === "bot" ? Bot : m.sender === "admin" ? ShieldCheck : UserRound;
  const label = m.sender === "bot" ? "Assistant" : m.sender === "admin" ? "Admin" : "User";
  const tone = mine
    ? "bg-primary text-primary-foreground rounded-br-md"
    : m.sender === "admin"
      ? "bg-amber-500/15 text-foreground border border-amber-500/30 rounded-bl-md"
      : "bg-muted text-foreground rounded-bl-md";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%]">
        {!mine && (
          <p className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5 ml-1">
            <Icon className="w-3 h-3" /> {label}
          </p>
        )}
        <div className={`px-3.5 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${tone}`}>{m.body}</div>
        <p className={`text-[10px] text-muted-foreground mt-0.5 ${mine ? "text-right mr-1" : "ml-1"}`}>{fmtTime(m.created_at)}</p>
      </div>
    </div>
  );
}

// Messages for one conversation, with realtime + polling. `onChange` fires after
// each reload (used to mark messages read while the thread is on screen).
function useThread(convId: number | null, onChange?: () => void) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const cb = useRef(onChange);
  cb.current = onChange;

  const reload = useCallback(async () => {
    if (!convId) { setMessages([]); return; }
    const { data } = await supabase.from("support_messages").select("*")
      .eq("conversation_id", convId).order("created_at", { ascending: true });
    if (data) { setMessages(data as Msg[]); cb.current?.(); }
  }, [convId]);

  useEffect(() => {
    reload();
    if (!convId) return;
    const ch = supabase.channel(`support-thread-${convId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages", filter: `conversation_id=eq.${convId}` },
        () => reload())
      .subscribe();
    const timer = setInterval(reload, POLL_MS);
    return () => { clearInterval(timer); supabase.removeChannel(ch); };
  }, [convId, reload]);

  return { messages, setMessages, reload };
}

function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" }); }, [dep]);
  return ref;
}

// ─── User side: floating widget ──────────────────────────────────────────────

export function SupportWidget({ userId, municipality }: { userId: string; municipality?: string | null }) {
  const [open, setOpen] = useState(false);
  const [conv, setConv] = useState<Conv | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [unread, setUnread] = useState(0);
  const openRef = useRef(open);
  openRef.current = open;

  const loadConv = useCallback(async () => {
    const { data } = await supabase.from("support_conversations").select("*").eq("user_id", userId).maybeSingle();
    setConv((data as Conv) ?? null);
    return (data as Conv) ?? null;
  }, [userId]);

  const markRead = useCallback(async (id: number) => {
    await supabase.rpc("support_mark_read", { p_conversation: id });
    setUnread(0);
  }, []);

  const { messages, setMessages, reload } = useThread(conv?.id ?? null, () => {
    if (openRef.current && conv) markRead(conv.id);
  });
  const scrollRef = useAutoScroll(messages.length + (waiting ? 1 : 0) + (open ? 1 : 0));

  useEffect(() => {
    loadConv();
    const ch = supabase.channel(`support-conv-${userId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "support_conversations", filter: `user_id=eq.${userId}` },
        () => loadConv())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, loadConv]);

  // Unread badge: admin/bot messages the user hasn't seen.
  useEffect(() => {
    if (!open) setUnread(messages.filter(m => m.sender !== "user" && !m.read_by_user).length);
  }, [messages, open]);

  useEffect(() => { if (open && conv) markRead(conv.id); }, [open, conv?.id, messages.length]);

  // Make sure a conversation row exists (needed before escalating / writing directly).
  const ensureConv = async (): Promise<Conv | null> => {
    if (conv) return conv;
    const { data, error } = await supabase.from("support_conversations")
      .insert({ user_id: userId, municipality: municipality || null }).select().single();
    if (error) {
      const existing = await loadConv();
      if (existing) return existing;
      console.error("[support] could not create conversation:", error);
      toast.error(error.code === "PGRST205"
        ? "Chat isn't set up yet — the support tables are missing in the database."
        : "Couldn't start the chat. Please try again.");
      return null;
    }
    setConv(data as Conv);
    return data as Conv;
  };

  const send = async () => {
    const body = text.trim().slice(0, MAX_LEN);
    if (!body || busy) return;
    setBusy(true);
    setText("");
    const c = await ensureConv();
    if (!c) { setBusy(false); setText(body); return; }
    const temp: Msg = { id: `tmp-${Date.now()}`, conversation_id: c.id, sender: "user", body,
      read_by_user: true, read_by_admin: false, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, temp]);

    if (c.status === "escalated") {
      // A human is on it — write straight to the thread (RLS-protected).
      const { error } = await supabase.from("support_messages")
        .insert({ conversation_id: c.id, sender: "user", body });
      if (error) toast.error("Message not sent. Please try again.");
    } else {
      setWaiting(true);
      const r = await callApi("/api/chat", { message: body });
      setWaiting(false);
      if (!r.ok && r.status !== 500) {
        toast.error(r.json?.error || "Chat is unavailable right now. You can talk to an admin instead.");
      } else if (!r.ok || r.json?.ok === false) {
        toast.error("The assistant is unavailable. You can talk to an admin instead.");
      }
    }
    await reload();
    setBusy(false);
  };

  const escalate = async () => {
    const c = await ensureConv();
    if (!c) return;
    const { error } = await supabase.rpc("support_escalate");
    if (error) { toast.error("Couldn't reach an admin. Please try again."); return; }
    toast.success("Sent to the tourism office. An admin will reply here.");
    await loadConv();
    await reload();
  };

  const status = conv?.status ?? "open";

  return (
    <div className="fixed bottom-5 right-5 z-[70] flex flex-col items-end gap-3 print:hidden">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }} transition={{ duration: 0.15 }}
            className="w-[calc(100vw-2.5rem)] sm:w-96 h-[32rem] max-h-[calc(100vh-7rem)] flex flex-col bg-popover text-popover-foreground border border-border rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-gradient-to-r from-primary/15 to-secondary/10">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                {status === "escalated" ? <ShieldCheck className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm font-[Outfit]">FestivaLGU Support</p>
                <p className="text-[11px] text-muted-foreground">
                  {status === "escalated" ? "Waiting for / chatting with an admin" : "Ask about registering, requirements & more"}
                </p>
              </div>
              {conv && <StatusPill status={status} />}
              <button onClick={() => setOpen(false)} aria-label="Close chat" className="p-1.5 rounded-lg hover:bg-muted"><X className="w-4 h-4" /></button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center text-sm text-muted-foreground pt-6 space-y-2">
                  <Bot className="w-8 h-8 mx-auto text-primary" />
                  <p>Hi! I can help with applying, requirements, uploading documents, checking your status, and finding your way around FestivaLGU.</p>
                </div>
              )}
              {messages.map(m => <Bubble key={m.id} m={m} viewer="user" />)}
              {waiting && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground ml-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Assistant is typing…
                </div>
              )}
              {status === "resolved" && (
                <p className="text-center text-xs text-muted-foreground">This conversation was marked resolved. Send a message to reopen it.</p>
              )}
            </div>

            <div className="border-t border-border p-3 space-y-2">
              {status !== "escalated" && (
                <button onClick={escalate} className="w-full flex items-center justify-center gap-2 text-xs font-medium py-1.5 rounded-lg border border-border hover:bg-muted transition-colors">
                  <UserRound className="w-3.5 h-3.5" /> Talk to an admin
                </button>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={text} rows={1} maxLength={MAX_LEN}
                  onChange={e => setText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder={status === "escalated" ? "Message the admin…" : "Type your question…"}
                  className="flex-1 resize-none max-h-24 bg-input-background border border-border rounded-xl px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <button onClick={send} disabled={busy || !text.trim()} aria-label="Send"
                  className="p-2.5 rounded-xl bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button onClick={() => setOpen(o => !o)} aria-label={open ? "Close support chat" : "Open support chat"}
        className="relative w-14 h-14 rounded-full bg-gradient-to-br from-primary to-secondary text-white shadow-lg hover:scale-105 transition-transform flex items-center justify-center">
        {open ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}

// ─── Admin side: Support Inbox ───────────────────────────────────────────────

interface InboxRow extends Conv {
  name: string;
  email: string;
  role: string;
  unread: number;
  preview: string;
}

type Filter = "all" | "escalated" | "open" | "resolved";

export function AdminSupportInbox() {
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [selId, setSelId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { data: convs } = await supabase.from("support_conversations").select("*")
      .order("last_message_at", { ascending: false });
    const list = (convs as Conv[]) ?? [];
    if (!list.length) { setRows([]); setLoading(false); return; }

    const ids = list.map(c => c.id);
    const [{ data: profs }, { data: unreadMsgs }, { data: recent }] = await Promise.all([
      supabase.from("profiles").select("id,fullname,email,role").in("id", list.map(c => c.user_id)),
      supabase.from("support_messages").select("conversation_id").in("conversation_id", ids).eq("read_by_admin", false),
      supabase.from("support_messages").select("conversation_id,body,created_at").in("conversation_id", ids)
        .order("created_at", { ascending: false }).limit(Math.max(50, ids.length * 3)),
    ]);
    const pMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
    const unreadBy = new Map<number, number>();
    (unreadMsgs ?? []).forEach((m: any) => unreadBy.set(m.conversation_id, (unreadBy.get(m.conversation_id) ?? 0) + 1));
    const previewBy = new Map<number, string>();
    (recent ?? []).forEach((m: any) => { if (!previewBy.has(m.conversation_id)) previewBy.set(m.conversation_id, m.body); });

    setRows(list.map(c => {
      const p: any = pMap.get(c.user_id);
      return { ...c, name: p?.fullname || "Unknown user", email: p?.email || "", role: p?.role || "",
        unread: unreadBy.get(c.id) ?? 0, preview: previewBy.get(c.id) ?? "" };
    }));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    let t: ReturnType<typeof setTimeout>;
    const debounced = () => { clearTimeout(t); t = setTimeout(load, 300); };
    const ch = supabase.channel("support-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_messages" }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "support_conversations" }, debounced)
      .subscribe();
    const timer = setInterval(load, POLL_MS);
    return () => { clearTimeout(t); clearInterval(timer); supabase.removeChannel(ch); };
  }, [load]);

  const shown = rows
    .filter(r => filter === "all" || r.status === filter)
    .sort((a, b) => {
      const rank = (r: InboxRow) => (r.status === "escalated" ? 0 : r.status === "open" ? 1 : 2);
      return rank(a) - rank(b) || +new Date(b.last_message_at) - +new Date(a.last_message_at);
    });
  const selected = rows.find(r => r.id === selId) ?? null;
  const totalUnread = rows.reduce((n, r) => n + r.unread, 0);
  const escalatedCount = rows.filter(r => r.status === "escalated").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold font-[Outfit]">Support Inbox</h2>
          <p className="text-sm text-muted-foreground">
            {escalatedCount} escalated · {totalUnread} unread message{totalUnread === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(["all", "escalated", "open", "resolved"] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium capitalize transition-colors ${filter === f ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-[22rem_1fr] gap-4 h-[calc(100vh-14rem)] min-h-[28rem]">
        <div className={`border border-border rounded-2xl bg-card overflow-y-auto ${selected ? "hidden lg:block" : ""}`}>
          {loading ? (
            <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : shown.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Inbox className="w-8 h-8 mx-auto mb-2 opacity-60" /> No conversations here.
            </div>
          ) : shown.map(r => (
            <button key={r.id} onClick={() => setSelId(r.id)}
              className={`w-full text-left px-4 py-3 border-b border-border last:border-0 hover:bg-muted/60 transition-colors ${r.id === selId ? "bg-muted" : ""}`}>
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate flex-1">{r.name}</span>
                {r.unread > 0 && <span className="min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold flex items-center justify-center">{r.unread}</span>}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <StatusPill status={r.status} />
                <span className="text-[11px] text-muted-foreground capitalize">{r.role}</span>
                <span className="text-[11px] text-muted-foreground ml-auto">{fmtTime(r.last_message_at)}</span>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-1">{r.preview}</p>
            </button>
          ))}
        </div>

        <div className={`border border-border rounded-2xl bg-card overflow-hidden ${selected ? "" : "hidden lg:flex"} flex flex-col`}>
          {selected
            ? <AdminThread key={selected.id} row={selected} onBack={() => setSelId(null)} onChanged={load} />
            : <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Select a conversation</div>}
        </div>
      </div>
    </div>
  );
}

function AdminThread({ row, onBack, onChanged }: { row: InboxRow; onBack: () => void; onChanged: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<"draft" | "summary" | null>(null);
  const [summary, setSummary] = useState("");

  const markRead = useCallback(async () => {
    await supabase.rpc("support_mark_read", { p_conversation: row.id });
  }, [row.id]);
  const { messages, reload } = useThread(row.id, () => { markRead().then(onChanged); });
  const scrollRef = useAutoScroll(messages.length);

  const reply = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const { error } = await supabase.from("support_messages").insert({ conversation_id: row.id, sender: "admin", body });
    setBusy(false);
    if (error) { toast.error("Reply not sent."); return; }
    setText("");
    await reload();
    onChanged();
  };

  const setStatus = async (status: Status) => {
    const { error } = await supabase.rpc("support_set_status", { p_conversation: row.id, p_status: status });
    if (error) { toast.error("Couldn't update the conversation."); return; }
    toast.success(status === "resolved" ? "Marked as resolved" : "Conversation reopened");
    onChanged();
  };

  const assist = async (mode: "draft" | "summary") => {
    setAi(mode);
    const r = await callApi("/api/admin-assist", { conversationId: row.id, mode });
    setAi(null);
    if (!r.ok) { toast.error(r.json?.error || "AI assistant is unavailable right now."); return; }
    if (mode === "draft") setText(r.json.text);
    else setSummary(r.json.text);
  };

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <button onClick={onBack} className="lg:hidden p-1.5 rounded-lg hover:bg-muted" aria-label="Back"><ArrowLeft className="w-4 h-4" /></button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{row.name} <span className="text-muted-foreground font-normal">· {row.email}</span></p>
          <div className="flex items-center gap-2 mt-0.5"><StatusPill status={row.status} /><span className="text-[11px] text-muted-foreground capitalize">{row.role}</span></div>
        </div>
        <button onClick={() => assist("summary")} disabled={!!ai}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-50">
          {ai === "summary" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />} Summarize
        </button>
        {row.status === "resolved"
          ? <button onClick={() => setStatus("open")} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted"><RotateCcw className="w-3.5 h-3.5" /> Reopen</button>
          : <button onClick={() => setStatus("resolved")} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90"><CheckCircle2 className="w-3.5 h-3.5" /> Mark resolved</button>}
      </div>

      {summary && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-primary/10 border border-primary/20 text-sm whitespace-pre-wrap relative">
          <button onClick={() => setSummary("")} aria-label="Dismiss summary" className="absolute top-2 right-2 p-1 rounded hover:bg-muted"><X className="w-3.5 h-3.5" /></button>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary mb-1">AI summary</p>
          {summary}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map(m => <Bubble key={m.id} m={m} viewer="admin" />)}
      </div>

      <div className="border-t border-border p-3 space-y-2">
        <button onClick={() => assist("draft")} disabled={!!ai}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-50">
          {ai === "draft" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Draft a reply with AI
        </button>
        <div className="flex items-end gap-2">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
            onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); reply(); } }}
            placeholder="Reply to the user… (Ctrl+Enter to send)"
            className="flex-1 resize-none bg-input-background border border-border rounded-xl px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
          <button onClick={reply} disabled={busy || !text.trim()} aria-label="Send reply"
            className="p-2.5 rounded-xl bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </>
  );
}
