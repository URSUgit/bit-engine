"use client";

import { useEffect, useRef, useState } from "react";
import type { BacktestResult } from "@/lib/backtest-api";

const SIGNAL_BASE =
  process.env.NEXT_PUBLIC_SIGNAL_SERVICE_URL ?? "http://localhost:8001";

interface BacktesterChatProps {
  symbol: string;
  strategy: string;
  strategyParams: Record<string, number>;
  periodDays: number;
  interval: string;
  commissionPct: number;
  slippagePct: number;
  result: BacktestResult | null;
  onApplyParams?: (params: {
    strategy?: string;
    periodDays?: number;
    interval?: string;
    strategyParams?: Record<string, number>;
  }) => void;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
  actions?: string[];
}

const SUGGESTED_PROMPTS = [
  "Explain my Sharpe ratio and how to improve it",
  "What does max drawdown mean for my risk?",
  "Suggest better parameters for this strategy",
  "Is this strategy better than buy-and-hold?",
  "What's the best interval for this symbol?",
];

function buildMarkdown(text: string): string {
  // Convert **bold** → <strong> and *italic* → <em>
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+?)\*/g, "<em>$1</em>");
}

export function BacktesterChat({
  symbol,
  strategy,
  strategyParams,
  periodDays,
  interval,
  commissionPct,
  slippagePct,
  result,
  onApplyParams,
}: BacktesterChatProps) {
  const [expanded, setExpanded] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId] = useState(() => `bt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function buildContextPrefix(): string {
    let ctx = `Current setup: ${symbol} · ${strategy} strategy · ${periodDays}d period · ${interval} bars\nFees: ${commissionPct}% commission, ${slippagePct}% slippage`;
    if (Object.keys(strategyParams).length > 0) {
      const paramStr = Object.entries(strategyParams)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      ctx += `\nStrategy params: ${paramStr}`;
    }
    if (result) {
      const m = result.metrics;
      ctx += `\nLast results: ${m.total_return_pct.toFixed(2)}% return · Sharpe ${m.sharpe_ratio.toFixed(2)} · Max DD -${m.max_drawdown_pct.toFixed(1)}% · ${m.total_trades} trades · Win rate ${m.win_rate_pct.toFixed(1)}%`;
    }
    return ctx;
  }

  async function sendMessage(userText: string) {
    if (!userText.trim()) return;
    setInput("");
    setApiKeyMissing(false);

    const userMsg: ChatMessage = { role: "user", content: userText };
    const loadingMsg: ChatMessage = { role: "assistant", content: "", loading: true, actions: [] };
    setMessages((prev) => [...prev, userMsg, loadingMsg]);

    const contextPrefix = buildContextPrefix();
    const fullMessage = `${contextPrefix}\n\n${userText}`;
    const url = `${SIGNAL_BASE}/api/v1/agent/stream?message=${encodeURIComponent(fullMessage)}&session_id=${encodeURIComponent(sessionId)}`;

    try {
      const res = await fetch(url);

      if (res.status === 401 || res.status === 403) {
        setApiKeyMissing(true);
        setMessages((prev) => prev.slice(0, -1));
        return;
      }

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => res.statusText);
        if (errText.toLowerCase().includes("api key") || errText.toLowerCase().includes("anthropic")) {
          setApiKeyMissing(true);
          setMessages((prev) => prev.slice(0, -1));
          return;
        }
        throw new Error(`${res.status}: ${errText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalAnswer = "";
      let currentActions: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;

          let event: { type: string; content?: string; thought?: string; tool?: string; result?: string; message?: string; session_id?: string };
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }

          if (event.type === "error") {
            const errMsg = event.message ?? "Unknown error";
            if (errMsg.toLowerCase().includes("api key") || errMsg.toLowerCase().includes("anthropic")) {
              setApiKeyMissing(true);
              setMessages((prev) => prev.slice(0, -1));
              return;
            }
            throw new Error(errMsg);
          }

          if (event.type === "thought") {
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.loading) {
                copy[copy.length - 1] = { ...last, content: "thinking…", actions: currentActions };
              }
              return copy;
            });
          } else if (event.type === "action") {
            const toolName = event.tool ?? "tool";
            currentActions = [...currentActions, toolName];
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.loading) {
                copy[copy.length - 1] = { ...last, content: "thinking…", actions: currentActions };
              }
              return copy;
            });
          } else if (event.type === "answer") {
            finalAnswer = event.content ?? "";
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = {
                role: "assistant",
                content: finalAnswer,
                loading: false,
                actions: currentActions,
              };
              return copy;
            });
          }
        }
      }

      // If we got a response but no answer event, show a fallback
      if (!finalAnswer) {
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.loading) {
            copy[copy.length - 1] = {
              role: "assistant",
              content: "No response received from the agent.",
              loading: false,
            };
          }
          return copy;
        });
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: `Error: ${errMsg}`,
          loading: false,
        };
        return copy;
      });
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/40 transition text-left"
      >
        <div className="flex items-center gap-2">
          {/* Bot icon (simple SVG) */}
          <svg className="w-4 h-4 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <circle cx="12" cy="5" r="2" />
            <line x1="12" y1="7" x2="12" y2="11" />
            <line x1="8" y1="15" x2="8" y2="15" strokeWidth="3" strokeLinecap="round" />
            <line x1="16" y1="15" x2="16" y2="15" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span className="text-sm font-semibold text-zinc-200">AI Backtest Advisor</span>
          {messages.length > 0 && (
            <span className="text-xs text-zinc-500">· {messages.length} messages</span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-zinc-800">
          {/* API key missing banner */}
          {apiKeyMissing && (
            <div className="px-4 py-3 bg-amber-950/40 border-b border-amber-800/40 text-amber-300 text-xs">
              Add <code className="font-mono bg-amber-950/60 px-1 rounded">ANTHROPIC_API_KEY</code> to{" "}
              <code className="font-mono bg-amber-950/60 px-1 rounded">apps/signal-service/.env</code> to enable AI features.
            </div>
          )}

          {/* Messages area */}
          <div
            ref={scrollRef}
            className="overflow-y-auto px-4 py-3 space-y-3"
            style={{ maxHeight: "400px" }}
          >
            {isEmpty && (
              <div className="text-center py-4">
                <p className="text-xs text-zinc-500 mb-3">Ask anything about your backtest results</p>
                {/* Suggested prompts */}
                <div className="flex flex-wrap gap-2 justify-center">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => sendMessage(prompt)}
                      className="px-2.5 py-1.5 rounded text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 border border-zinc-700 transition text-left"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "user" ? (
                  <div className="max-w-[80%] px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-zinc-200 text-sm">
                    {msg.content}
                  </div>
                ) : (
                  <div className="max-w-[90%] space-y-1.5">
                    {/* Action badges */}
                    {msg.actions && msg.actions.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {msg.actions.map((action, ai) => (
                          <span
                            key={ai}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700"
                          >
                            {action}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-200 text-sm">
                      {msg.loading ? (
                        <span className="text-zinc-400 italic animate-pulse">{msg.content || "thinking…"}</span>
                      ) : (
                        <span
                          style={{ whiteSpace: "pre-wrap" }}
                          dangerouslySetInnerHTML={{ __html: buildMarkdown(msg.content) }}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Input area */}
          <div className="border-t border-zinc-800 p-3 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
              placeholder="Ask about your strategy, metrics, or results…"
              className="flex-1 px-3 py-2 text-sm bg-zinc-950 border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim()}
              className="px-3 py-2 rounded-md bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-semibold text-sm transition"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
