"use client";

import { useState } from "react";
import {
  Youtube,
  Loader2,
  TrendingUp,
  TrendingDown,
  FlaskConical,
  ExternalLink,
  Bot,
  Regex,
  Sparkles,
  Wand2,
  Percent,
  ShieldAlert,
  Target,
  Zap,
  User,
  Users,
  Clock,
  History,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { resolveAvatarUrl } from "@/lib/avatar";

// ─── Types (mirror /api/v1/scout payloads) ────────────────────────────────

interface ScoutSignal {
  asset: string;
  direction: "buy" | "sell";
  confidence: number;
  reasoning: string;
  timestamp_s?: number | null;
}

interface StrategySuggestion {
  strategy: string;
  why: string;
  params: Record<string, number>;
  timestamp_s?: number | null;
}

interface StrategyModel {
  name: string;
  trader: string;
  strategy: string;
  label: string;
  why: string;
  params: Record<string, number>;
  pairs: string[];
  position_pct: number | null;
  risk_pct: number | null;
  stop_loss_pct: number | null;
  take_profit_pct: number | null;
  leverage: number | null;
  timestamp_s?: number | null;
  kind?: "technical" | "sentiment";
}

export interface Analysis {
  id: number;
  video_id: string;
  url: string;
  title: string;
  channel: string;
  video_thumbnail?: string | null;
  analyzed_at: number;
  published_at?: string | null;
  transcript_chars: number;
  transcript_error: string | null;
  analysis_source?: "transcript" | "vision" | "audio" | "title";
  engine: "llm" | "heuristic";
  assets: { symbol: string; mentions: number }[];
  sentiment: number;
  signals: ScoutSignal[];
  strategies: StrategySuggestion[];
  models: StrategyModel[];
  multi_speaker?: boolean;
  guest_note?: string | null;
  frame_findings?: {
    assets: { symbol: string; mentions: number }[];
    clues: Record<string, number | null>;
  } | null;
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

interface AnchoredBacktestResult {
  symbol: string;
  direction: "buy" | "sell";
  entry_time: string;
  entry_price: number;
  exit_time: string;
  exit_price: number;
  outcome: "target_hit" | "stop_hit" | "timeout" | "open";
  pnl_pct: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  defaulted_risk_params: boolean;
  bars_examined: number;
}

// mm:ss into the video a signal/strategy/clue was actually said.
function fmtClock(s: number): string {
  const total = Math.max(0, Math.round(s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const OUTCOME_LABEL: Record<AnchoredBacktestResult["outcome"], string> = {
  target_hit: "hit target",
  stop_hit: "hit stop",
  timeout: "still open at window end",
  open: "still open",
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/scout${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status}`);
  }
  return res.json();
}

export const timeAgo = (ts: number) => {
  const s = Math.max(1, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

// ─── Small building blocks ─────────────────────────────────────────────────

function Clue({
  label,
  value,
  tone = "zinc",
  icon: Icon,
}: {
  label: string;
  value: string;
  tone?: "zinc" | "red" | "emerald" | "amber" | "cyan";
  icon: React.ElementType;
}) {
  const tones: Record<string, string> = {
    zinc: "bg-zinc-800/80 text-zinc-300 border-zinc-700",
    red: "bg-red-950/60 text-red-300 border-red-900",
    emerald: "bg-emerald-950/60 text-emerald-300 border-emerald-900",
    amber: "bg-amber-950/50 text-amber-300 border-amber-900",
    cyan: "bg-cyan-950/50 text-cyan-300 border-cyan-900",
  };
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        tones[tone]
      )}
      title={label}
    >
      <Icon size={10} />
      {value}
    </span>
  );
}

// ─── Strategy model card ────────────────────────────────────────────────────

function TraderAvatarLink({
  trader,
  avatarUrl,
  size = "h-12 w-12",
}: {
  trader: string;
  avatarUrl?: string | null;
  size?: string;
}) {
  return (
    <Link
      href={`/lab/scout/traders/${encodeURIComponent(trader)}`}
      className={cn(size, "shrink-0 overflow-hidden rounded-full border border-zinc-700 bg-zinc-800")}
      title={`View ${trader}'s profile`}
    >
      <img
        src={resolveAvatarUrl(trader, avatarUrl)}
        alt={trader}
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
      />
    </Link>
  );
}

function ModelCard({
  model,
  idx,
  bt,
  avatarUrl,
  onBacktest,
}: {
  model: StrategyModel;
  idx: number;
  bt: Record<number, BacktestResult | "loading" | string>;
  avatarUrl?: string | null;
  onBacktest: (idx: number) => void;
}) {
  const r = bt[idx];
  const hasClues =
    model.position_pct != null ||
    model.risk_pct != null ||
    model.stop_loss_pct != null ||
    model.take_profit_pct != null ||
    model.leverage != null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-gradient-to-b from-zinc-900/80 to-zinc-950/80 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <TraderAvatarLink trader={model.trader} avatarUrl={avatarUrl} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate text-sm font-semibold text-cyan-200">
              <Wand2 size={13} className="shrink-0 text-cyan-400" />
              <span className="truncate">{model.name}</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-zinc-500">{model.label}</div>
          </div>
        </div>
        <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">
          {model.strategy}
        </span>
      </div>

      <p className="mt-2 text-[11px] text-zinc-500">{model.why}</p>

      {model.pairs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {model.pairs.map((p) => (
            <span
              key={p}
              className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-zinc-300"
            >
              {p}
            </span>
          ))}
        </div>
      )}

      {hasClues && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {model.position_pct != null && (
            <Clue label="position size" value={`${model.position_pct}% size`} icon={Percent} tone="cyan" />
          )}
          {model.risk_pct != null && (
            <Clue label="risk per trade" value={`${model.risk_pct}% risk`} icon={ShieldAlert} tone="amber" />
          )}
          {model.stop_loss_pct != null && (
            <Clue label="stop loss" value={`SL ${model.stop_loss_pct}%`} icon={TrendingDown} tone="red" />
          )}
          {model.take_profit_pct != null && (
            <Clue label="take profit" value={`TP ${model.take_profit_pct}%`} icon={Target} tone="emerald" />
          )}
          {model.leverage != null && (
            <Clue label="leverage" value={`${model.leverage}x lev`} icon={Zap} tone="amber" />
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-zinc-800/60 pt-2">
        {r === undefined && (
          <button
            onClick={() => onBacktest(idx)}
            className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            <FlaskConical size={11} /> Backtest now
          </button>
        )}
        {r === "loading" && <Loader2 size={13} className="animate-spin text-zinc-400" />}
        {typeof r === "string" && r !== "loading" && <span className="text-[11px] text-red-400">{r}</span>}
        {typeof r === "object" && (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] tabular-nums">
            <span className="text-zinc-500">
              {r.symbol} {r.interval}
            </span>
            <span className={r.total_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}>
              {r.total_return_pct >= 0 ? "+" : ""}
              {r.total_return_pct}%
            </span>
            <span className="text-zinc-400">sharpe {r.sharpe_ratio}</span>
            <span className="text-zinc-500">{r.total_trades} trades</span>
          </span>
        )}
      </div>
    </div>
  );
}

// A stance-only mention ("I'm holding BTC long-term") — not a real,
// mechanically backtestable strategy, so this deliberately has no
// "Backtest now" button, unlike ModelCard.
function SentimentCard({ model, avatarUrl }: { model: StrategyModel; avatarUrl?: string | null }) {
  return (
    <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <TraderAvatarLink trader={model.trader} avatarUrl={avatarUrl} />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-zinc-300">{model.name}</p>
            <p className="text-[10px] text-zinc-500">{model.label}</p>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full border border-amber-800/50 bg-amber-950/40 px-2 py-0.5 text-[10px] font-medium text-amber-400">
          Sentiment stance
        </span>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">{model.why}</p>
    </div>
  );
}

// ─── Signal row (with timestamp + anchored backtest) ───────────────────────

function SignalRow({
  signal,
  idx,
  videoUrl,
  abt,
  onBacktest,
}: {
  signal: ScoutSignal;
  idx: number;
  videoUrl: string;
  abt: Record<number, AnchoredBacktestResult | "loading" | string>;
  onBacktest: (idx: number) => void;
}) {
  const r = abt[idx];
  const ts = signal.timestamp_s;
  const tsHref = ts != null ? `${videoUrl}&t=${Math.floor(ts)}s` : null;

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium ${
        signal.direction === "buy" ? "bg-emerald-950/60 text-emerald-300" : "bg-red-950/60 text-red-300"
      }`}
    >
      <span className="flex items-center gap-1.5" title={signal.reasoning}>
        {signal.direction === "buy" ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        {signal.direction.toUpperCase()} {signal.asset}
        <span className="opacity-70">{(signal.confidence * 100).toFixed(0)}%</span>
      </span>

      {tsHref && (
        <a
          href={tsHref}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-[10px] font-normal opacity-80 hover:opacity-100"
          title="Jump to the moment this was said"
        >
          <Clock size={10} /> {fmtClock(ts!)}
        </a>
      )}

      {r === undefined && (
        <button
          onClick={() => onBacktest(idx)}
          className="flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-normal opacity-80 hover:bg-black/20 hover:opacity-100"
        >
          <History size={10} /> Backtest this call
        </button>
      )}
      {r === "loading" && <Loader2 size={12} className="animate-spin opacity-70" />}
      {typeof r === "string" && r !== "loading" && (
        <span className="text-[10px] font-normal text-red-300/90">{r}</span>
      )}
      {typeof r === "object" && (
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded border border-white/10 bg-black/20 px-1.5 py-0.5 font-mono text-[10px] font-normal tabular-nums opacity-90">
          <span className={r.pnl_pct >= 0 ? "text-emerald-300" : "text-red-300"}>
            {r.pnl_pct >= 0 ? "+" : ""}
            {r.pnl_pct}%
          </span>
          <span className="opacity-70">{OUTCOME_LABEL[r.outcome]}</span>
          <span className="opacity-60">
            @{r.entry_price} → {r.exit_price}
          </span>
          {r.defaulted_risk_params && (
            <span className="opacity-50" title="Trader didn't state a stop/target — used 5%/10% defaults">
              (assumed risk)
            </span>
          )}
        </span>
      )}
    </div>
  );
}

// ─── Feed card ──────────────────────────────────────────────────────────────

export function AnalysisCard({ a, avatarMap }: { a: Analysis; avatarMap?: Record<string, string> }) {
  const [bt, setBt] = useState<Record<number, BacktestResult | "loading" | string>>({});
  const [abt, setAbt] = useState<Record<number, AnchoredBacktestResult | "loading" | string>>({});

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

  const runAnchoredBacktest = async (idx: number) => {
    setAbt((m) => ({ ...m, [idx]: "loading" }));
    try {
      const res = await api<AnchoredBacktestResult>("/backtest/anchored", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis_id: a.id, signal_index: idx }),
      });
      setAbt((m) => ({ ...m, [idx]: res }));
    } catch (e) {
      setAbt((m) => ({ ...m, [idx]: e instanceof Error ? e.message : String(e) }));
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
        <span className="flex items-center gap-1 text-xs text-zinc-500">
          <User size={11} /> {a.channel}
        </span>
        {a.multi_speaker && (
          <span
            className="flex items-center gap-1 rounded-full bg-violet-950/60 px-2 py-0.5 text-xs text-violet-300"
            title={a.guest_note ?? "Multiple speakers detected"}
          >
            <Users size={11} /> guest
          </span>
        )}
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
        {a.transcript_error && a.analysis_source === "vision" && (
          <span className="text-cyan-500/80" title={a.transcript_error}>
            no transcript — read from on-screen chart/ticker
          </span>
        )}
        {a.transcript_error && a.analysis_source === "audio" && (
          <span className="text-cyan-500/80" title={a.transcript_error}>
            no transcript — transcribed from audio
          </span>
        )}
        {a.transcript_error && (a.analysis_source === "title" || a.analysis_source === undefined) && (
          <span className="text-amber-500/80" title={a.transcript_error}>
            no transcript — title-only analysis
          </span>
        )}
      </div>

      {a.signals.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {a.signals.map((s, i) => (
            <SignalRow key={i} signal={s} idx={i} videoUrl={a.url} abt={abt} onBacktest={runAnchoredBacktest} />
          ))}
        </div>
      )}

      {a.models && a.models.length > 0 && (
        <div className="mt-3 border-t border-zinc-800/60 pt-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            <Sparkles size={11} /> Strategy models built from this video
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {a.models.map((m, i) =>
              m.kind === "sentiment" ? (
                <SentimentCard key={i} model={m} avatarUrl={avatarMap?.[m.trader]} />
              ) : (
                <ModelCard
                  key={i}
                  model={m}
                  idx={i}
                  bt={bt}
                  avatarUrl={avatarMap?.[m.trader]}
                  onBacktest={runBacktest}
                />
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
