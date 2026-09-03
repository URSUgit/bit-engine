"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, ArrowUpRight, ArrowDownRight, Loader2, ExternalLink, Link2,
  Play, Square, Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveAvatarUrl } from "@/lib/avatar";

interface VideoMetrics {
  symbol?: string;
  interval?: string;
  bars?: number;
  total_return_pct?: number;
  sharpe_ratio?: number;
  max_drawdown_pct?: number;
  total_trades?: number;
  win_rate?: number;
  error?: string;
}

interface TraderVideo {
  id: number | null;
  video_id: string | null;
  title: string | null;
  url: string | null;
  thumbnail: string | null;
  strategy: string;
  label: string;
  symbol?: string;
  metrics: VideoMetrics;
}

interface ChannelLink {
  title: string;
  url: string;
}

interface TraderProfile {
  trader: string;
  avatar?: string | null;
  channel?: { description: string | null; links: ChannelLink[] };
  period: PeriodKey;
  videos: TraderVideo[];
  summary: {
    video_count: number;
    strategy_count: number;
    avg_return_pct: number | null;
    best_return_pct: number | null;
    worst_return_pct: number | null;
    avg_win_rate: number | null;
  };
}

type PeriodKey = "1m" | "3m" | "6m" | "1y" | "all";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "6m", label: "6M" },
  { key: "1y", label: "1Y" },
  { key: "all", label: "All" },
];

const PERIOD_LABEL: Record<PeriodKey, string> = { "1m": "1M", "3m": "3M", "6m": "6M", "1y": "1Y", all: "10Y" };

// ─── Trading bot ────────────────────────────────────────────────────────────

interface BotStatus {
  bot_id: string;
  mode: "stopped" | "dry_run" | "live";
  trader: string;
  strategy: string;
  symbol: string;
  interval: string;
  bars_seen: number;
  last_signal: string | null;
  last_price: number | null;
  position: { side: string; entry_price: number; size: number; cost: number } | null;
  trades_count: number;
  last_error: string | null;
  uptime_seconds: number;
  server_live_trading_enabled: boolean;
}

interface BotTrade {
  id: string;
  side: string;
  price: number;
  qty: number;
  pnl_usd: number | null;
  dry_run: boolean;
  reason: string;
  at: number;
}

async function cbApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/cryptobot${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status}`);
  }
  return res.json();
}

function ModeBadge({ mode }: { mode: string }) {
  const cfg = {
    dry_run: { cls: "bg-amber-500/15 text-amber-300 border-amber-500/30", label: "Dry Run" },
    live: { cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", label: "Live" },
    stopped: { cls: "bg-slate-800 text-slate-500 border-slate-700", label: "Stopped" },
  }[mode] ?? { cls: "bg-slate-800 text-slate-500 border-slate-700", label: mode };
  return (
    <span className={cn("text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border", cfg.cls)}>
      {cfg.label}
    </span>
  );
}

function BotDeployPanel({ trader, videos }: { trader: string; videos: TraderVideo[] }) {
  const deployable = videos.filter((v) => v.id != null);
  const [selectedId, setSelectedId] = useState<number | null>(deployable[0]?.id ?? null);
  const [positionSize, setPositionSize] = useState(25);
  const [bot, setBot] = useState<BotStatus | null>(null);
  const [trades, setTrades] = useState<BotTrade[]>([]);
  const [deploying, setDeploying] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep looking for this trader's bot even if none exists yet (e.g. it was
  // deployed via the API in another tab/session), and keep polling its status
  // once found — not just a single check on mount.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        if (bot) {
          const [s, t] = await Promise.all([
            cbApi<BotStatus>(`/bots/${bot.bot_id}`),
            cbApi<BotTrade[]>(`/bots/${bot.bot_id}/trades`),
          ]);
          if (!cancelled) {
            setBot(s);
            setTrades(t);
          }
        } else {
          const all = await cbApi<BotStatus[]>("/bots");
          if (!cancelled) setBot(all.find((b) => b.trader === trader) ?? null);
        }
      } catch {
        if (!cancelled) setBot(null);
      }
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [trader, bot?.bot_id]);

  const deploy = async () => {
    if (selectedId == null) return;
    setDeploying(true);
    setError(null);
    try {
      const s = await cbApi<BotStatus>("/bots", {
        method: "POST",
        body: JSON.stringify({ trader, strategy_id: selectedId, position_size_usd: positionSize }),
      });
      setBot(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setDeploying(false);
  };

  const stop = async () => {
    if (!bot) return;
    setStopping(true);
    await cbApi(`/bots/${bot.bot_id}/stop`, { method: "POST" }).catch(() => {});
    setBot(null);
    setTrades([]);
    setStopping(false);
  };

  if (deployable.length === 0) return null;

  return (
    <div className="card-dark p-5 border-l-2 border-cyan-500/30">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-slate-100">Deploy as trading bot</h2>
        {bot && <ModeBadge mode={bot.mode} />}
      </div>
      <p className="text-xs text-slate-500 mb-4 max-w-2xl">
        Runs one of {trader}&rsquo;s own backtested strategies against live prices and simulates
        fills in dry-run. No real order ever fires from this page — going live requires the operator to
        set <code className="text-slate-400">BITGET_LIVE_TRADING=true</code> on the signal-service and
        promote the bot&rsquo;s mode directly via the API.
      </p>

      {!bot ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Strategy">
            <select
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(+e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-cyan-500 min-w-[240px]"
            >
              {deployable.map((v) => (
                <option key={v.id} value={v.id ?? ""}>
                  {v.label} · {v.symbol ?? v.metrics.symbol} ({pct(v.metrics.total_return_pct)})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Position size (USD)">
            <input
              type="number"
              min={1}
              max={10000}
              value={positionSize}
              onChange={(e) => setPositionSize(+e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 w-28 outline-none focus:border-cyan-500"
            />
          </Field>
          <button
            onClick={deploy}
            disabled={deploying || selectedId == null}
            className="px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {deploying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Deploy (dry-run)
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="Strategy" value={bot.strategy} />
            <Metric label="Symbol" value={bot.symbol} />
            <Metric label="Last Signal" value={bot.last_signal ?? "—"} />
            <Metric label="Trades" value={String(bot.trades_count)} />
          </div>
          {bot.position && (
            <p className="text-xs text-slate-400">
              Open position: {bot.position.side} {bot.position.size.toFixed(6)} @ $
              {bot.position.entry_price.toFixed(2)}
            </p>
          )}
          {bot.last_error && <p className="text-xs text-red-400">Error: {bot.last_error}</p>}
          {!bot.server_live_trading_enabled && (
            <p className="text-[11px] text-amber-400/80 flex items-center gap-1.5">
              <Shield className="w-3 h-3 shrink-0" /> Server-side live trading is disabled — every fill above
              is simulated.
            </p>
          )}
          {trades.length > 0 && (
            <div className="flex flex-col divide-y divide-slate-800/60 max-h-56 overflow-y-auto">
              {trades.map((t) => (
                <div key={t.id} className="flex items-center justify-between py-1.5 text-xs gap-2">
                  <span className={t.side === "BUY" ? "text-emerald-400" : "text-red-400"}>{t.side}</span>
                  <span className="text-slate-400 number-font">
                    {t.qty.toFixed(6)} @ ${t.price.toFixed(2)}
                  </span>
                  {t.pnl_usd != null && (
                    <span className={cn("number-font", t.pnl_usd >= 0 ? "text-emerald-400" : "text-red-400")}>
                      {t.pnl_usd >= 0 ? "+" : ""}${t.pnl_usd.toFixed(2)}
                    </span>
                  )}
                  {t.dry_run && <span className="text-amber-500 uppercase text-[9px]">dry</span>}
                </div>
              ))}
            </div>
          )}
          <button
            onClick={stop}
            disabled={stopping}
            className="w-fit flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            {stopping ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
            Stop bot
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</label>
      {children}
    </div>
  );
}

export default function TraderProfilePage() {
  const params = useParams<{ name: string }>();
  const trader = decodeURIComponent(params?.name ?? "");
  const [profile, setProfile] = useState<TraderProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [periodLoading, setPeriodLoading] = useState(false);

  useEffect(() => {
    if (!trader) return;
    let cancelled = false;
    setPeriodLoading(true);
    fetch(`/api/v1/scout/traders/${encodeURIComponent(trader)}?period=${period}`)
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then((data: TraderProfile) => {
        if (!cancelled) setProfile(data);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setPeriodLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [trader, period]);

  if (notFound) {
    return (
      <div className="p-6">
        <Link href="/lab/scout/traders" className="text-slate-500 hover:text-slate-300 text-sm flex items-center gap-1.5 w-fit">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to traders
        </Link>
        <p className="mt-8 text-slate-500 text-center">Trader not found.</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
      </div>
    );
  }

  const s = profile.summary;

  return (
    <div className="flex flex-col gap-5 p-6 max-w-[1600px] mx-auto">
      <Link href="/lab/scout/traders" className="text-slate-500 hover:text-slate-300 transition-colors w-fit text-sm flex items-center gap-1.5">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to traders
      </Link>

      {/* Header card */}
      <div className="card-dark p-6">
        <div className="flex items-start gap-5 flex-wrap">
          <img
            src={resolveAvatarUrl(profile.trader, profile.avatar)}
            alt={profile.trader}
            referrerPolicy="no-referrer"
            className="w-20 h-20 rounded-full border border-slate-700 object-cover shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">{profile.trader}</h1>
            <p className="text-xs text-slate-500 mt-1">
              {s.video_count} video{s.video_count === 1 ? "" : "s"} analyzed · {s.strategy_count} strategy model
              {s.strategy_count === 1 ? "" : "s"} · backtested over{" "}
              {profile.period === "all" ? "the max available history (10Y)" : `the trailing ${PERIOD_LABEL[profile.period]}`}
            </p>
            {profile.channel?.description && (
              <p className="text-xs text-slate-400 mt-3 whitespace-pre-line max-w-2xl">
                {profile.channel.description}
              </p>
            )}
            {profile.channel?.links && profile.channel.links.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {profile.channel.links.map((l, i) => (
                  <a
                    key={i}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-[11px] text-slate-300 hover:text-cyan-400 hover:border-cyan-500/40 transition-colors"
                  >
                    <Link2 className="w-3 h-3" /> {l.title}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-widest text-slate-500 font-bold mr-1">Window</span>
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={cn(
              "px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors",
              period === p.key
                ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
                : "text-slate-500 hover:text-slate-300 border-transparent hover:border-slate-700"
            )}
          >
            {p.label}
          </button>
        ))}
        {periodLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500 ml-1" />}
      </div>

      {/* Stats */}
      <div className={cn("grid grid-cols-2 sm:grid-cols-4 gap-3 transition-opacity", periodLoading && "opacity-60")}>
        <Metric label={`Avg Return (${PERIOD_LABEL[profile.period]})`} value={pct(s.avg_return_pct)} positive={s.avg_return_pct != null && s.avg_return_pct >= 0} />
        <Metric label={`Best Return (${PERIOD_LABEL[profile.period]})`} value={pct(s.best_return_pct)} positive={s.best_return_pct != null && s.best_return_pct >= 0} />
        <Metric label={`Worst Return (${PERIOD_LABEL[profile.period]})`} value={pct(s.worst_return_pct)} positive={s.worst_return_pct != null && s.worst_return_pct >= 0} />
        <Metric label={`Avg Win Rate (${PERIOD_LABEL[profile.period]})`} value={s.avg_win_rate != null ? `${s.avg_win_rate.toFixed(1)}%` : "—"} />
      </div>

      {/* Trading bot */}
      <BotDeployPanel trader={profile.trader} videos={profile.videos} />

      {/* Video / strategy history */}
      <div className="card-dark p-5">
        <h2 className="text-sm font-semibold text-slate-100 mb-4">Strategy history ({PERIOD_LABEL[profile.period]} backtest)</h2>
        {profile.videos.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">No strategies found for this trader.</p>
        ) : (
          <div className={cn("flex flex-col gap-2 transition-opacity", periodLoading && "opacity-60")}>
            {profile.videos.map((v, i) => {
              const m = v.metrics;
              const positive = (m.total_return_pct ?? 0) >= 0;
              return (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-slate-900/50 flex-wrap">
                  {v.thumbnail ? (
                    <img src={v.thumbnail} alt={v.title ?? ""} className="w-14 h-9 rounded object-cover shrink-0" />
                  ) : (
                    <div className="w-14 h-9 rounded bg-slate-800 shrink-0" />
                  )}
                  <div className="flex-1 min-w-[180px]">
                    {v.url ? (
                      <a
                        href={v.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-slate-100 hover:text-cyan-400 transition-colors inline-flex items-center gap-1"
                      >
                        {v.title ?? v.strategy}
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ) : (
                      <p className="text-sm font-medium text-slate-100">{v.title ?? v.strategy}</p>
                    )}
                    <p className="text-[11px] text-slate-500">{v.label}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {m.error ? (
                      <p className="text-[11px] text-slate-600">{m.error}</p>
                    ) : (
                      <>
                        <div className={cn("text-sm font-semibold number-font flex items-center gap-1 justify-end", positive ? "text-emerald-400" : "text-red-400")}>
                          {positive ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                          {pct(m.total_return_pct)} <span className="text-slate-600 font-normal">({PERIOD_LABEL[profile.period]})</span>
                        </div>
                        <p className="text-[10px] text-slate-600 number-font">
                          {m.win_rate != null ? `${m.win_rate.toFixed(1)}% win rate` : ""} · {m.symbol}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="card-dark p-3">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</p>
      <p className={cn("text-base font-bold number-font mt-1", positive === undefined ? "text-slate-100" : positive ? "text-emerald-400" : "text-red-400")}>
        {value}
      </p>
    </div>
  );
}
