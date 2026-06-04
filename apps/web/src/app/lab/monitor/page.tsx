"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { auditApi, type AuditReport, type Finding } from "@/lib/audit-api";
import {
  ShieldCheck,
  RefreshCw,
  Loader2,
  AlertTriangle,
  AlertOctagon,
  Info,
  ChevronRight,
  ChevronDown,
  Bot,
  Send,
  Trash2,
  Brain,
  Wrench,
  Eye,
  Sparkles,
  Clock,
  ToggleLeft,
  ToggleRight,
  Zap,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type PriorityFilter = "all" | "critical" | "high" | "medium" | "low" | "info";
type EventType = "thought" | "action" | "observation" | "answer" | "error" | "session" | "navigate";

interface AgentEvent {
  type: EventType;
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  session_id?: string;
  path?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  events?: AgentEvent[];
  loading?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-300 border-red-500/30",
  high: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  low: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  info: "bg-slate-700/50 text-slate-400 border-slate-600/30",
};

const PRIORITY_ICONS: Record<string, React.ElementType> = {
  critical: AlertOctagon,
  high: AlertTriangle,
  medium: AlertTriangle,
  low: Info,
  info: Info,
};

const PRIORITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-500",
  info: "bg-slate-500",
};

const AUDIT_SUGGESTIONS = [
  "Run a full platform audit",
  "What are the most critical security issues?",
  "Fix all TODO comments in the codebase",
  "Are there any hardcoded secrets?",
  "Show me the latest git changes",
  "Check if TypeScript compiles without errors",
];

const SIGNAL_BASE =
  process.env.NEXT_PUBLIC_SIGNAL_SERVICE_URL ?? "http://localhost:8001";

const AUTO_RUN_KEY = "audit_auto_run_enabled";

// ─── Streaming agent chat ─────────────────────────────────────────────────────

async function* streamAgent(
  message: string,
  sessionId: string | null
): AsyncGenerator<AgentEvent> {
  const params = new URLSearchParams({ message });
  if (sessionId) params.set("session_id", sessionId);
  let response: Response;
  try {
    response = await fetch(`${SIGNAL_BASE}/api/v1/agent/stream?${params}`, {
      headers: { Accept: "text/event-stream" },
    });
  } catch {
    yield { type: "error", content: "Cannot reach signal service." };
    return;
  }
  if (!response.ok) {
    yield { type: "error", content: `Server error ${response.status}` };
    return;
  }
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") return;
      try {
        yield JSON.parse(raw) as AgentEvent;
      } catch {
        // ignore malformed lines
      }
    }
  }
}

// ─── ThinkingStep ─────────────────────────────────────────────────────────────

function ThinkingStep({ events }: { events: AgentEvent[] }) {
  const [open, setOpen] = useState(false);
  const thoughtCount = events.filter((e) => e.type === "thought").length;
  const actionCount = events.filter((e) => e.type === "action").length;
  if (!events.length) return null;
  return (
    <div className="mt-2 text-xs">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Brain className="w-3 h-3 text-violet-400" />
        <span>
          {thoughtCount} thought{thoughtCount !== 1 ? "s" : ""} · {actionCount} tool call
          {actionCount !== 1 ? "s" : ""}
        </span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2 pl-4 border-l-2 border-slate-800">
          {events.map((ev, i) => {
            if (ev.type === "thought")
              return (
                <div key={i} className="flex gap-2 text-slate-400">
                  <Brain className="w-3 h-3 text-violet-400 mt-0.5 shrink-0" />
                  <span className="italic">{ev.content}</span>
                </div>
              );
            if (ev.type === "action")
              return (
                <div key={i} className="flex gap-2 text-cyan-300">
                  <Wrench className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>
                    <span className="font-mono font-semibold">{ev.tool}</span>
                    {ev.args && Object.keys(ev.args).length > 0 && (
                      <span className="text-slate-500 font-mono">
                        ({JSON.stringify(ev.args)})
                      </span>
                    )}
                  </span>
                </div>
              );
            if (ev.type === "observation")
              return (
                <div key={i} className="flex gap-2 text-slate-500">
                  <Eye className="w-3 h-3 mt-0.5 shrink-0" />
                  <pre className="whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed max-h-32 overflow-y-auto">
                    {ev.content}
                  </pre>
                </div>
              );
            return null;
          })}
        </div>
      )}
    </div>
  );
}

// ─── ChatBubble ────────────────────────────────────────────────────────────────

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-2", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center shrink-0 border text-xs",
          isUser
            ? "bg-cyan-500/15 border-cyan-500/30 text-cyan-400"
            : "bg-violet-500/15 border-violet-500/30 text-violet-400"
        )}
      >
        {isUser ? "You" : <Bot className="w-3.5 h-3.5" />}
      </div>
      <div className={cn("flex flex-col max-w-[85%]", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "px-3 py-2.5 rounded-xl text-xs leading-relaxed",
            isUser
              ? "bg-cyan-500/10 border border-cyan-500/20 text-slate-100"
              : "bg-slate-800/80 border border-slate-700/50 text-slate-100"
          )}
        >
          {msg.loading ? (
            <span className="flex items-center gap-2 text-slate-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              Thinking…
            </span>
          ) : (
            <span className="whitespace-pre-wrap">{msg.content}</span>
          )}
        </div>
        {!isUser && msg.events && <ThinkingStep events={msg.events} />}
      </div>
    </div>
  );
}

// ─── FindingRow ────────────────────────────────────────────────────────────────

function FindingRow({
  finding,
  onAskFix,
}: {
  finding: Finding;
  onAskFix: (prompt: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const PriorityIcon = PRIORITY_ICONS[finding.priority] ?? Info;

  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((o) => !o)}
        className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-slate-900/60 transition-colors text-left"
      >
        <span
          className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border uppercase shrink-0 mt-0.5",
            PRIORITY_COLORS[finding.priority] ?? "bg-slate-700 text-slate-400 border-slate-600"
          )}
        >
          <PriorityIcon className="w-2.5 h-2.5" />
          {finding.priority}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-200 font-medium truncate">{finding.title}</p>
          {finding.file && (
            <p className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
              {finding.file}
              {finding.line > 0 ? `:${finding.line}` : ""}
            </p>
          )}
        </div>
        <span className="text-[10px] text-slate-600 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded shrink-0">
          {finding.category}
        </span>
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-slate-600 shrink-0 mt-0.5" />
        ) : (
          <ChevronRight className="w-3 h-3 text-slate-600 shrink-0 mt-0.5" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-slate-800 bg-slate-950/50">
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">{finding.detail}</p>
          {finding.fix_hint && (
            <p className="text-[11px] text-cyan-400/80 mt-1.5 italic">
              Hint: {finding.fix_hint}
            </p>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAskFix(
                `Fix this issue: ${finding.title}${finding.file ? ` in ${finding.file}` : ""}. ${finding.fix_hint}`
              );
            }}
            className="mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] hover:bg-violet-500/20 transition-colors"
          >
            <Sparkles className="w-3 h-3" />
            Ask agent to fix
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MonitorPage() {
  // Audit state
  const [report, setReport] = useState<AuditReport | null>(null);
  const [running, setRunning] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [filter, setFilter] = useState<PriorityFilter>("all");
  const [autoRun, setAutoRun] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Load auto-run preference
  useEffect(() => {
    try {
      setAutoRun(localStorage.getItem(AUTO_RUN_KEY) === "true");
    } catch {}
  }, []);

  const toggleAutoRun = () => {
    setAutoRun((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTO_RUN_KEY, String(next));
      } catch {}
      return next;
    });
  };

  // Load latest report on mount (don't auto-run)
  useEffect(() => {
    auditApi
      .latestReport()
      .then((r) => {
        if (r) setReport(r);
      })
      .catch(() => {});
  }, []);

  // Auto-run every 24h if enabled
  useEffect(() => {
    if (!autoRun) return;
    const INTERVAL_MS = 24 * 60 * 60 * 1000;
    const lastRun = report?.checked_at ? new Date(report.checked_at).getTime() : 0;
    const now = Date.now();
    if (now - lastRun > INTERVAL_MS) {
      handleRunAudit();
    }
    const timer = setInterval(handleRunAudit, INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  // Scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleRunAudit = async () => {
    setRunning(true);
    setAuditError(null);
    try {
      const r = await auditApi.runAudit();
      setReport(r);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : "Audit failed");
    } finally {
      setRunning(false);
    }
  };

  const sendChat = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || chatBusy) return;
      setInput("");
      setChatBusy(true);

      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed },
        { role: "assistant", content: "", loading: true, events: [] },
      ]);

      const events: AgentEvent[] = [];
      let answer = "";
      let sid = sessionId;

      for await (const event of streamAgent(trimmed, sid)) {
        if (event.type === "session" && event.session_id) {
          sid = event.session_id;
          setSessionId(sid);
        } else if (
          event.type === "thought" ||
          event.type === "action" ||
          event.type === "observation"
        ) {
          events.push(event);
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1]!;
            return [...next.slice(0, -1), { ...last, events: [...events] }];
          });
        } else if (event.type === "answer") {
          answer = event.content ?? "";
        } else if (event.type === "error") {
          answer = `Error: ${event.content}`;
        }
      }

      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1]!;
        return [
          ...next.slice(0, -1),
          { ...last, content: answer, loading: false, events },
        ];
      });

      setChatBusy(false);
    },
    [chatBusy, sessionId]
  );

  const clearChat = () => {
    if (sessionId) {
      fetch(`${SIGNAL_BASE}/api/v1/agent/session/${sessionId}`, {
        method: "DELETE",
      }).catch(() => {});
    }
    setMessages([]);
    setSessionId(null);
  };

  // Derive filtered findings
  const findings = report?.findings ?? [];
  const filtered =
    filter === "all"
      ? findings
      : findings.filter((f) => f.priority === filter);

  const byPriority = (report?.summary as { by_priority?: Record<string, number> })
    ?.by_priority ?? {};

  const PRIORITY_FILTERS: PriorityFilter[] = [
    "all",
    "critical",
    "high",
    "medium",
    "low",
    "info",
  ];

  return (
    <div className="flex h-[calc(100vh-0px)] overflow-hidden">
      {/* ── Left panel: audit report ─────────────────────────────────────────── */}
      <div className="w-[52%] flex flex-col border-r border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-sm font-semibold text-slate-50">Platform Monitor</h1>
                <p className="text-[10px] text-slate-500">Codebase audit bot</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Auto-run toggle */}
              <button
                onClick={toggleAutoRun}
                className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
                title="Auto-run every 24h"
              >
                {autoRun ? (
                  <ToggleRight className="w-4 h-4 text-emerald-400" />
                ) : (
                  <ToggleLeft className="w-4 h-4" />
                )}
                Auto 24h
              </button>
              <button
                onClick={handleRunAudit}
                disabled={running}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:pointer-events-none"
              >
                {running ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                {running ? "Running…" : "Run Audit"}
              </button>
            </div>
          </div>

          {/* Last run + summary stats */}
          {report && (
            <>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-2">
                <Clock className="w-3 h-3" />
                Last run:{" "}
                {new Date(report.checked_at).toLocaleString()}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(byPriority)
                  .sort(([a], [b]) => (PRIORITY_ORDER[a] ?? 9) - (PRIORITY_ORDER[b] ?? 9))
                  .map(([priority, count]) => (
                    <span
                      key={priority}
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border",
                        PRIORITY_COLORS[priority] ?? "bg-slate-700 text-slate-400 border-slate-600"
                      )}
                    >
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          PRIORITY_DOT[priority] ?? "bg-slate-500"
                        )}
                      />
                      {count} {priority}
                    </span>
                  ))}
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border bg-slate-800 text-slate-300 border-slate-700">
                  <Zap className="w-2.5 h-2.5" />
                  {findings.length} total
                </span>
              </div>
            </>
          )}

          {auditError && (
            <p className="mt-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">
              {auditError}
            </p>
          )}
        </div>

        {/* Priority filter pills */}
        <div className="px-5 py-2.5 border-b border-slate-800 shrink-0 flex gap-1.5 flex-wrap">
          {PRIORITY_FILTERS.map((p) => (
            <button
              key={p}
              onClick={() => setFilter(p)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border",
                filter === p
                  ? "bg-cyan-500/15 border-cyan-500/30 text-cyan-300"
                  : "bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300"
              )}
            >
              {p === "all" ? `All (${findings.length})` : p}
            </button>
          ))}
        </div>

        {/* Findings list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-2">
          {!report && !running && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center py-12">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-emerald-400/60" />
              </div>
              <p className="text-sm text-slate-400">No audit report yet.</p>
              <p className="text-xs text-slate-600">Click "Run Audit" to scan the codebase.</p>
            </div>
          )}

          {running && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 py-12">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
              <p className="text-sm text-slate-400">Running audit checks…</p>
              <p className="text-xs text-slate-600">
                Checking syntax, security, deps, dead code…
              </p>
            </div>
          )}

          {!running && filtered.length === 0 && report && (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 py-8 text-center">
              <ShieldCheck className="w-8 h-8 text-emerald-400" />
              <p className="text-sm text-slate-300">
                {filter === "all" ? "No findings!" : `No ${filter} findings.`}
              </p>
            </div>
          )}

          {!running &&
            filtered.map((finding) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                onAskFix={(prompt) => {
                  setInput(prompt);
                  sendChat(prompt);
                }}
              />
            ))}
        </div>
      </div>

      {/* ── Right panel: agent chat ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Chat header */}
        <div className="px-5 py-4 border-b border-slate-800 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-50">BitAgent</h2>
              <p className="text-[10px] text-slate-500">Audit assistant · ReAct agent</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {sessionId && (
              <span className="text-[10px] font-mono text-slate-600 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                {sessionId.slice(0, 8)}
              </span>
            )}
            <button
              onClick={clearChat}
              disabled={!messages.length}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-400 hover:text-red-400 transition-colors rounded-md hover:bg-red-500/10 disabled:opacity-40 disabled:pointer-events-none"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          </div>
        </div>

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center flex-1 gap-5 text-center py-8">
              <div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                <Bot className="w-6 h-6 text-violet-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-200">Audit assistant</p>
                <p className="text-xs text-slate-500 mt-1 max-w-xs">
                  Ask about findings, request fixes, or explore the codebase.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-1.5 w-full">
                {AUDIT_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendChat(s)}
                    className="text-left px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-violet-500/30 hover:bg-violet-500/5 transition-all text-xs text-slate-300"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatBubble key={i} msg={msg} />
          ))}

          <div ref={chatBottomRef} />
        </div>

        {/* Chat input */}
        <div className="px-5 py-3 border-t border-slate-800 shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendChat(input);
            }}
            className="flex gap-2 items-end"
          >
            <div className="flex-1">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChat(input);
                  }
                }}
                placeholder="Ask about the audit, request a fix…"
                rows={1}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-violet-500/50 focus:outline-none resize-none leading-relaxed"
                style={{ maxHeight: 100, overflowY: "auto" }}
              />
            </div>
            <button
              type="submit"
              disabled={!input.trim() || chatBusy}
              className="w-9 h-9 rounded-xl bg-violet-500 text-white flex items-center justify-center hover:bg-violet-400 transition-colors disabled:opacity-40 disabled:pointer-events-none shadow-[0_0_16px_-4px_rgba(139,92,246,0.5)] shrink-0"
            >
              {chatBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
