"use client";

import { useEffect, useRef, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
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
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type EventType = "thought" | "action" | "observation" | "answer" | "error" | "session";

interface AgentEvent {
  type: EventType;
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  session_id?: string;
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

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0 border",
          isUser
            ? "bg-cyan-500/15 border-cyan-500/30 text-cyan-400"
            : "bg-violet-500/15 border-violet-500/30 text-violet-400"
        )}
      >
        {isUser ? (
          <span className="text-xs font-bold">You</span>
        ) : (
          <Bot className="w-4 h-4" />
        )}
      </div>

      {/* Bubble */}
      <div className={cn("flex flex-col max-w-[80%]", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "px-4 py-3 rounded-xl text-sm leading-relaxed",
            isUser
              ? "bg-cyan-500/10 border border-cyan-500/20 text-slate-100"
              : "bg-slate-800/80 border border-slate-700/50 text-slate-100"
          )}
        >
          {msg.loading ? (
            <span className="flex items-center gap-2 text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
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

// Minimal markdown renderer (bold, code, headings, lists)
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
  // bold **...**
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**"))
      return <strong key={i} className="font-semibold text-slate-50">{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`"))
      return <code key={i} className="font-mono text-cyan-300 bg-slate-900 px-1 rounded text-[11px]">{p.slice(1, -1)}</code>;
    return p;
  });
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AgentPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      } else if (event.type === "thought" || event.type === "action" || event.type === "observation") {
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
      return [...next.slice(0, -1), { ...last, content: answer, loading: false, events }];
    });

    setBusy(false);
  };

  const clearSession = () => {
    if (sessionId) {
      fetch(`${SIGNAL_BASE}/api/v1/agent/session/${sessionId}`, { method: "DELETE" }).catch(() => {});
    }
    setMessages([]);
    setSessionId(null);
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col h-[calc(100vh-0px)] max-h-screen">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-50">BitAgent</h1>
              <p className="text-xs text-slate-500">AI trading analyst · ReAct agent</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {sessionId && (
              <span className="text-[10px] font-mono text-slate-600 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                {sessionId.slice(0, 8)}
              </span>
            )}
            <button
              onClick={clearSession}
              disabled={!messages.length}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-red-400 transition-colors rounded-md hover:bg-red-500/10 disabled:opacity-40 disabled:pointer-events-none"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center flex-1 gap-6 text-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                <Bot className="w-8 h-8 text-violet-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-100">Ask BitAgent anything</h2>
                <p className="text-sm text-slate-400 mt-1 max-w-sm">
                  Natural language trading analysis powered by a ReAct agent with live market tools.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl w-full">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-left px-4 py-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-violet-500/30 hover:bg-violet-500/5 transition-all text-sm text-slate-300"
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
        <div className="px-6 py-4 border-t border-slate-800 shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-3 items-end"
          >
            <div className="flex-1 relative">
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
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-violet-500/50 focus:outline-none resize-none leading-relaxed"
                style={{ maxHeight: 120, overflowY: "auto" }}
              />
            </div>
            <button
              type="submit"
              disabled={!input.trim() || busy}
              className="w-10 h-10 rounded-xl bg-violet-500 text-white flex items-center justify-center hover:bg-violet-400 transition-colors disabled:opacity-40 disabled:pointer-events-none shadow-[0_0_20px_-5px_rgba(139,92,246,0.6)] shrink-0"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
          <p className="text-[10px] text-slate-600 mt-2 text-center">
            Enter to send · Shift+Enter for newline · Powered by ReAct agent with 6 trading tools
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
