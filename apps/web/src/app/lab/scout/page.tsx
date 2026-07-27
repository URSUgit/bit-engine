"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Youtube,
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  TrendingUp,
  TrendingDown,
  FlaskConical,
  ExternalLink,
  Radar,
  Bot,
  Regex,
} from "lucide-react";

// ─── Types (mirror /api/v1/scout payloads) ────────────────────────────────────

interface Channel {
  id: string;
  name: string;
}

interface ScoutSignal {
  asset: string;
  direction: "buy" | "sell";
  confidence: number;
  reasoning: string;
}

interface StrategySuggestion {
  strategy: string;
  why: string;
  params: Record<string, number>;
}

interface Analysis {
  id: number;
  video_id: string;
  url: string;
  title: string;
  channel: string;
  analyzed_at: number;
  transcript_chars: number;
  transcript_error: string | null;
  engine: "llm" | "heuristic";
  assets: { symbol: string; mentions: number }[];
  sentiment: number;
  signals: ScoutSignal[];
  strategies: StrategySuggestion[];
}

interface BacktestResult {
  strategy: string;
  symbol: string;
  interval: string;
  bars: number;
  total_return_pct: number;
  sharpe_ratio: number;
  max_drawdown_pct: number;
  total_trades: number;
  win_rate: number;
}

interface ScoutStatus {
  channels: Channel[];
  seen_videos: number;
  analyses: number;
  last_poll: number | null;
  poll_interval_s: number;
  running: boolean;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/scout${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status}`);
  }
  return res.json();
}

const timeAgo = (ts: number) => {
  const s = Math.max(1, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

// ─── Feed card ────────────────────────────────────────────────────────────────

function AnalysisCard({ a }: { a: Analysis }) {
  const [bt, setBt] = useState<Record<number, BacktestResult | "loading" | string>>({});

  const runBacktest = async (idx: number) => {
    setBt((m) => ({ ...m, [idx]: "loading" }));
    try {
      const res = await api<BacktestResult>("/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis_id: a.id, strategy_index: idx }),
      });
      setBt((m) => ({ ...m, [idx]: res }));
    } catch (e) {
      setBt((m) => ({ ...m, [idx]: e instanceof Error ? e.message : String(e) }));
    }
  };

  const sentimentColor =
    a.sentiment > 0.15 ? "text-emerald-400" : a.sentiment < -0.15 ? "text-red-400" : "text-zinc-400";

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex flex-wrap items-start gap-2">
        <a
          href={a.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100 hover:text-cyan-300"
        >
          <Youtube size={14} className="shrink-0 text-red-500" />
          {a.title}
          <ExternalLink size={11} className="text-zinc-600" />
        </a>
        <span className="text-xs text-zinc-500">{a.channel}</span>
        <span className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
          <span
            className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5"
            title={a.engine === "llm" ? "Analyzed by LLM" : "Analyzed by heuristic extractor"}
          >
            {a.engine === "llm" ? <Bot size={11} /> : <Regex size={11} />}
            {a.engine}
          </span>
          {timeAgo(a.analyzed_at)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className={`font-medium ${sentimentColor}`}>
          sentiment {a.sentiment > 0 ? "+" : ""}
          {(a.sentiment * 100).toFixed(0)}%
        </span>
        {a.assets.map((as) => (
          <span key={as.symbol} className="rounded-full border border-zinc-700 px-2 py-0.5 text-zinc-300">
            {as.symbol} ×{as.mentions}
          </span>
        ))}
        {a.transcript_error && (
          <span className="text-amber-500/80" title={a.transcript_error}>
            no transcript — title-only analysis
          </span>
        )}
      </div>

      {a.signals.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {a.signals.map((s, i) => (
            <span
              key={i}
              title={s.reasoning}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
                s.direction === "buy"
                  ? "bg-emerald-950/60 text-emerald-300"
                  : "bg-red-950/60 text-red-300"
              }`}
            >
              {s.direction === "buy" ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {s.direction.toUpperCase()} {s.asset}
              <span className="opacity-70">{(s.confidence * 100).toFixed(0)}%</span>
            </span>
          ))}
        </div>
      )}

      {a.strategies.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-zinc-800/60 pt-2">
          {a.strategies.map((s, i) => {
            const r = bt[i];
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                <FlaskConical size={12} className="shrink-0 text-zinc-500" />
                <span className="font-mono text-zinc-200">{s.strategy}</span>
                <span className="text-zinc-500">{s.why}</span>
                <span className="ml-auto">
                  {r === undefined && (
                    <button
                      onClick={() => runBacktest(i)}
                      className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800"
                    >
                      Backtest now
                    </button>
                  )}
                  {r === "loading" && <Loader2 size={12} className="animate-spin text-zinc-400" />}
                  {typeof r === "string" && r !== "loading" && (
                    <span className="text-red-400">{r}</span>
                  )}
                  {typeof r === "object" && (
                    <span className="flex items-center gap-2 font-mono tabular-nums">
                      <span className="text-zinc-500">{r.symbol} {r.interval}</span>
                      <span className={r.total_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {r.total_return_pct >= 0 ? "+" : ""}
                        {r.total_return_pct}%
                      </span>
                      <span className="text-zinc-400">sharpe {r.sharpe_ratio}</span>
                      <span className="text-zinc-500">dd {r.max_drawdown_pct}%</span>
                      <span className="text-zinc-500">{r.total_trades} trades</span>
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ScoutPage() {
  const [status, setStatus] = useState<ScoutStatus | null>(null);
  const [feed, setFeed] = useState<Analysis[]>([]);
  const [channelRef, setChannelRef] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [busy, setBusy] = useState<"" | "channel" | "video" | "poll">("");
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [st, fd] = await Promise.all([
        api<ScoutStatus>("/status"),
        api<Analysis[]>("/feed?limit=50"),
      ]);
      setStatus(st);
      setFeed(fd);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [refresh]);

  const addChannel = async () => {
    if (!channelRef.trim()) return;
    setBusy("channel");
    setError(null);
    try {
      await api("/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: channelRef.trim() }),
      });
      setChannelRef("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const removeChannel = async (cid: string) => {
    await api(`/channels/${cid}`, { method: "DELETE" }).catch(() => undefined);
    await refresh();
  };

  const analyzeVideo = async () => {
    if (!videoUrl.trim()) return;
    setBusy("video");
    setError(null);
    try {
      await api("/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: videoUrl.trim() }),
      });
      setVideoUrl("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const pollNow = async () => {
    setBusy("poll");
    setError(null);
    try {
      await api("/poll", { method: "POST" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex min-h-9 flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
          <Radar size={18} /> YouTube Scout
        </h1>
        <span className="text-xs text-zinc-500">
          watches trading channels → live signals, strategies, instant backtests
        </span>
        {status && (
          <span className="ml-auto flex items-center gap-3 text-xs text-zinc-500">
            {status.channels.length} channels · {status.seen_videos} videos seen
            {status.last_poll && <> · polled {timeAgo(status.last_poll)}</>}
            <button
              onClick={pollNow}
              disabled={busy === "poll"}
              className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              {busy === "poll" ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <RefreshCw size={11} />
              )}
              Poll now
            </button>
          </span>
        )}
        {offline && (
          <span className="rounded bg-red-950 px-2 py-0.5 text-xs text-red-300">
            signal-service unreachable
          </span>
        )}
      </div>

      {/* Inputs: watch a channel / analyze one video */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Watch a channel — new uploads auto-analyzed
          </div>
          <div className="flex gap-2">
            <input
              value={channelRef}
              onChange={(e) => setChannelRef(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addChannel()}
              placeholder="@handle, channel URL, or UC… id"
              className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
            />
            <button
              onClick={addChannel}
              disabled={busy === "channel"}
              className="flex items-center gap-1 rounded bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
            >
              {busy === "channel" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Plus size={12} />
              )}
              Watch
            </button>
          </div>
          {status && status.channels.length > 0 && (
            <ul className="mt-3 space-y-1">
              {status.channels.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-xs text-zinc-300">
                  <Youtube size={12} className="text-red-500" />
                  {c.name}
                  <span className="font-mono text-[10px] text-zinc-600">{c.id.slice(0, 12)}…</span>
                  <button
                    onClick={() => removeChannel(c.id)}
                    className="ml-auto rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                    title="Stop watching"
                  >
                    <Trash2 size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Analyze one video now
          </div>
          <div className="flex gap-2">
            <input
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && analyzeVideo()}
              placeholder="https://www.youtube.com/watch?v=…"
              className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
            />
            <button
              onClick={analyzeVideo}
              disabled={busy === "video"}
              className="flex items-center gap-1 rounded bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
            >
              {busy === "video" ? <Loader2 size={12} className="animate-spin" /> : <Radar size={12} />}
              Analyze
            </button>
          </div>
          <p className="mt-2 text-[11px] text-zinc-600">
            Transcript → assets, sentiment, signals, and strategy configs you can backtest with one
            click. Uses the LLM when an API key is configured, a deterministic extractor otherwise.
          </p>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>
      </div>

      {/* Live feed */}
      <div className="space-y-3">
        {feed.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-center text-xs text-zinc-500">
            No analyses yet — watch a channel or paste a video URL above. New uploads on watched
            channels appear here automatically (checked every{" "}
            {Math.round((status?.poll_interval_s ?? 180) / 60)} min).
          </div>
        ) : (
          feed.map((a) => <AnalysisCard key={a.id} a={a} />)
        )}
      </div>
    </div>
  );
}
