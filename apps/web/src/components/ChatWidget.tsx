"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Bot,
  Send,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Wrench,
  Eye,
  Brain,
  Sparkles,
  X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type EventType = "thought" | "action" | "observation" | "answer" | "error" | "session" | "navigate";

interface AgentEvent {
  type: EventType;
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  session_id?: string;
  path?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  events?: AgentEvent[];
  loading?: boolean;
}

// ─── Suggested prompts ────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "What's the current BTC price and market sentiment?",
  "Backtest a momentum strategy on ETH for the last 90 days",
  "Give me an overview of the crypto market right now",
  "What are the latest buy signals for SOL?",
  "Compare whale flows and funding rate for BTC",
  "Which strategy has the best Sharpe ratio for ETH?",
];

const SIGNAL_BASE = process.env.NEXT_PUBLIC_SIGNAL_SERVICE_URL ?? "http://localhost:8001";

// ─── Streaming chat ────────────────────────────────────────────────────────────

async function* streamChat(
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
    yield { type: "error", content: "Cannot reach signal service — check that it's running." };
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

// ─── ObservationCard ──────────────────────────────────────────────────────────

function ObservationCard({ content }: { content: string }) {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    data = null;
  }

  // Price card
  if (data && typeof data === "object" && !Array.isArray(data) && "price_usd" in data) {
    const d = data as Record<string, unknown>;
    const change = d.change_24h_pct as number;
    const isPos = change >= 0;
    return (
      <div className="mt-1 rounded-lg bg-slate-900 border border-slate-700/50 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-slate-400 font-mono">{String(d.asset)}</span>
          <span
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded font-mono",
              isPos ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
            )}
          >
            {isPos ? "+" : ""}
            {typeof change === "number" ? change.toFixed(2) : "—"}%
          </span>
        </div>
        <div className="text-lg font-bold text-slate-50 mt-0.5">
          ${typeof d.price_usd === "number" ? d.price_usd.toLocaleString() : "—"}
        </div>
      </div>
    );
  }

  // Backtest card
  if (data && typeof data === "object" && !Array.isArray(data) && "total_return_pct" in data) {
    const d = data as Record<string, unknown>;
    const metrics = [
      { label: "Return", value: `${d.total_return_pct}%` },
      { label: "Sharpe", value: String(d.sharpe_ratio ?? "—") },
      { label: "Trades", value: String(d.total_trades ?? "—") },
      { label: "Win %", value: `${d.win_rate_pct ?? "—"}%` },
      { label: "Drawdown", value: `${d.max_drawdown_pct ?? "—"}%` },
    ];
    return (
      <div className="mt-1 rounded-lg bg-slate-900 border border-slate-700/50 p-3">
        <div className="text-[10px] text-slate-500 mb-2 font-mono">
          {String(d.asset)} · {String(d.strategy)} · {String(d.period_days)}d
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {metrics.map((m) => (
            <div key={m.label} className="bg-slate-800/60 rounded p-1.5 text-center">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">{m.label}</div>
              <div className="text-xs font-mono text-slate-100 mt-0.5">{m.value}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Signals list
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null && "direction" in data[0]) {
    const signals = data as Array<Record<string, unknown>>;
    return (
      <div className="mt-1 flex flex-wrap gap-1.5">
        {signals.slice(0, 6).map((sig, i) => {
          const dir = String(sig.direction ?? "hold");
          return (
            <span
              key={i}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded-full font-mono border",
                dir === "buy"
                  ? "bg-green-500/15 text-green-400 border-green-500/30"
                  : dir === "sell"
                  ? "bg-red-500/15 text-red-400 border-red-500/30"
                  : "bg-slate-700/50 text-slate-400 border-slate-600/30"
              )}
            >
              {String(sig.asset ?? "?")} {dir.toUpperCase()}
            </span>
          );
        })}
      </div>
    );
  }

  // Market overview card
  if (data && typeof data === "object" && !Array.isArray(data) && "btc_dominance_pct" in data) {
    const d = data as Record<string, unknown>;
    const fg = d.fear_greed_index as number | null;
    const top = d.top_assets as Record<string, number> | undefined;
    return (
      <div className="mt-1 rounded-lg bg-slate-900 border border-slate-700/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-slate-400">BTC Dom</span>
          <span className="text-xs font-mono text-slate-100">{String(d.btc_dominance_pct)}%</span>
        </div>
        {fg !== null && fg !== undefined && (
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-slate-400">Fear &amp; Greed</span>
            <span
              className={cn(
                "text-xs font-mono px-1.5 py-0.5 rounded",
                fg > 55 ? "bg-green-500/15 text-green-400" : fg < 40 ? "bg-red-500/15 text-red-400" : "bg-yellow-500/15 text-yellow-400"
              )}
            >
              {fg}
            </span>
          </div>
        )}
        {top && (
          <div className="flex flex-wrap gap-1 mt-1">
            {Object.entries(top)
              .slice(0, 3)
              .map(([sym, price]) => (
                <span key={sym} className="text-[10px] font-mono bg-slate-800 rounded px-1.5 py-0.5 text-slate-300">
                  {sym} ${typeof price === "number" ? price.toLocaleString() : price}
                </span>
              ))}
          </div>
        )}
      </div>
    );
  }

  // Default: raw pre block
  const lines = content.split("\n");
  const truncated = lines.slice(0, 8).join("\n");
  const hasMore = lines.length > 8;
  return (
    <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed max-h-28 overflow-y-auto bg-slate-900 border border-slate-700/50 rounded-lg p-2 text-slate-400">
      {truncated}
      {hasMore && "\n…"}
    </pre>
  );
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
                      <span className="text-slate-500 font-mono">({JSON.stringify(ev.args)})</span>
                    )}
                  </span>
                </div>
              );
            if (ev.type === "observation")
              return (
                <div key={i} className="flex gap-2 text-slate-500">
                  <Eye className="w-3 h-3 mt-0.5 shrink-0" />
                  <ObservationCard content={ev.content ?? ""} />
                </div>
              );
            return null;
          })}
        </div>
      )}
    </div>
  );
}

// ─── Markdown ─────────────────────────────────────────────────────────────────

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="flex flex-col gap-1">
      {lines.map((line, i) => {
        if (line.startsWith("### "))
          return <p key={i} className="font-bold text-slate-100 text-sm mt-1">{line.slice(4)}</p>;
        if (line.startsWith("## "))
          return <p key={i} className="font-bold text-slate-50 text-base mt-1">{line.slice(3)}</p>;
        if (line.startsWith("- ") || line.startsWith("* "))
          return (
            <div key={i} className="flex gap-1.5">
              <span className="text-cyan-400 mt-0.5">·</span>
              <span>{renderInline(line.slice(2))}</span>
            </div>
          );
        if (line.trim() === "") return <div key={i} className="h-1" />;
        return <p key={i}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**"))
      return <strong key={i} className="font-semibold text-slate-50">{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`"))
      return <code key={i} className="font-mono text-cyan-300 bg-slate-900 px-1 rounded text-[11px]">{p.slice(1, -1)}</code>;
    return p;
  });
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";

  return (
    <div className={cn("flex gap-2", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center shrink-0 border",
          isUser
            ? "bg-cyan-500/15 border-cyan-500/30 text-cyan-400"
            : "bg-violet-500/15 border-violet-500/30 text-violet-400"
        )}
      >
        {isUser ? (
          <span className="text-[9px] font-bold">You</span>
        ) : (
          <Bot className="w-3.5 h-3.5" />
        )}
      </div>

      {/* Bubble */}
      <div className={cn("flex flex-col max-w-[85%]", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "px-3 py-2 rounded-xl text-sm leading-relaxed",
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
            <MarkdownContent content={msg.content} />
          )}
        </div>

        {!isUser && msg.events && <ThinkingStep events={msg.events} />}
      </div>
    </div>
  );
}

// ─── ChatWidget ───────────────────────────────────────────────────────────────

export function ChatWidget() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Clear unread badge when opened
  useEffect(() => {
    if (isOpen) setHasUnread(false);
  }, [isOpen]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    setBusy(true);

    setMessages((prev) => [
      ...prev,
      { role: "user", content: trimmed },
      { role: "assistant", content: "", loading: true, events: [] },
    ]);

    const events: AgentEvent[] = [];
    let answer = "";
    let sid = sessionId;

    for await (const event of streamChat(trimmed, sid)) {
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
      } else if (event.type === "navigate" && event.path) {
        router.push(event.path);
        setIsOpen(false);
      } else if (event.type === "answer") {
        answer = event.content ?? "";
      } else if (event.type === "error") {
        answer = `Error: ${event.content}`;
      }
    }

    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1]!;
      return [...next.slice(0, -1), { ...last, content: answer, loading: false, events }];
    });

    setBusy(false);

    // Mark unread if panel is closed
    if (!isOpen) setHasUnread(true);
  };

  const clearSession = () => {
    if (sessionId) {
      fetch(`${SIGNAL_BASE}/api/v1/agent/session/${sessionId}`, { method: "DELETE" }).catch(() => {});
    }
    setMessages([]);
    setSessionId(null);
  };

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        aria-label="Toggle AI chat"
        className={cn(
          "fixed right-6 bottom-6 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-lg",
          "bg-gradient-to-br from-violet-600 to-purple-600 text-white",
          "hover:from-violet-500 hover:to-purple-500 transition-all duration-200",
          "shadow-[0_0_24px_-4px_rgba(139,92,246,0.7)]",
          isOpen && "opacity-0 pointer-events-none"
        )}
      >
        <Sparkles className="w-6 h-6" />
        {hasUnread && (
          <span className="absolute top-1 right-1 w-3 h-3 rounded-full bg-cyan-400 border-2 border-slate-950" />
        )}
      </button>

      {/* Sliding panel */}
      <div
        className={cn(
          "fixed right-0 top-0 h-full w-[420px] z-50",
          "bg-slate-950 border-l border-slate-800",
          "flex flex-col",
          "transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-violet-400" />
            </div>
            <span className="text-sm font-semibold text-slate-50">BitAgent</span>
            {sessionId && (
              <span className="text-[10px] font-mono text-slate-600 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                {sessionId.slice(0, 8)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={clearSession}
              disabled={!messages.length}
              title="Clear conversation"
              className="p-1.5 text-slate-500 hover:text-red-400 transition-colors rounded-md hover:bg-red-500/10 disabled:opacity-30 disabled:pointer-events-none"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsOpen(false)}
              title="Close"
              className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors rounded-md hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center flex-1 gap-4 text-center py-8">
              <div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                <Bot className="w-6 h-6 text-violet-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-100">Ask BitAgent anything</h2>
                <p className="text-xs text-slate-400 mt-1 max-w-xs">
                  Live market tools: prices, signals, backtests, on-chain data &amp; more.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 w-full">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-left px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-violet-500/30 hover:bg-violet-500/5 transition-all text-xs text-slate-300"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-slate-800 shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
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
                    send(input);
                  }
                }}
                placeholder="Ask about markets, signals, strategies…"
                rows={1}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-violet-500/50 focus:outline-none resize-none leading-relaxed"
                style={{ maxHeight: 100, overflowY: "auto" }}
              />
            </div>
            <button
              type="submit"
              disabled={!input.trim() || busy}
              className="w-9 h-9 rounded-xl bg-violet-500 text-white flex items-center justify-center hover:bg-violet-400 transition-colors disabled:opacity-40 disabled:pointer-events-none shadow-[0_0_16px_-4px_rgba(139,92,246,0.6)] shrink-0"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </form>
          <p className="text-[10px] text-slate-600 mt-1.5 text-center">
            Enter to send · Shift+Enter for newline
          </p>
        </div>
      </div>

      {/* Backdrop (mobile) */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 sm:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
