"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Loader2, Square, Shield, Activity, Trophy, Settings2,
  TrendingUp, TrendingDown, Minus, Link2, Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveAvatarUrl } from "@/lib/avatar";

interface BotStatus {
  bot_id: string;
  mode: "stopped" | "dry_run" | "live";
  trader: string;
  strategy: string;
  strategy_id: number;
  strategy_params: Record<string, unknown>;
  symbol: string;
  interval: string;
  position_size_usd: number;
  poll_seconds: number;
  bars_seen: number;
  last_signal: string | null;
  last_price: number | null;
  position: { side: string; entry_price: number; size: number; cost: number } | null;
  trades_count: number;
  last_error: string | null;
  started_at: number;
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

interface ActivityEntry {
  at: number;
  bar_ts: number;
  price: number;
  signal: string;
}

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
  videos: TraderVideo[];
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

function SignalBadge({ signal }: { signal: string | null }) {
  if (!signal) return <span className="text-slate-600">—</span>;
  const cfg: Record<string, { cls: string; icon: typeof TrendingUp }> = {
    buy: { cls: "text-emerald-400", icon: TrendingUp },
    sell: { cls: "text-red-400", icon: TrendingDown },
    close: { cls: "text-red-400", icon: TrendingDown },
  };
  const c = cfg[signal] ?? { cls: "text-slate-500", icon: Minus };
  const Icon = c.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 uppercase font-semibold", c.cls)}>
      <Icon className="w-3 h-3" /> {signal}
    </span>
  );
}

function timeAgo(epochSeconds: number): string {
  const diff = Date.now() / 1000 - epochSeconds;
  if (diff < 60) return `${Math.max(0, Math.round(diff))}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
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

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Settings2; children: React.ReactNode }) {
  return (
    <div className="card-dark p-5">
      <h2 className="text-sm font-semibold text-slate-100 mb-4 flex items-center gap-2">
        <Icon className="w-4 h-4 text-cyan-400" /> {title}
      </h2>
      {children}
    </div>
  );
}

type TimelineItem =
  | { kind: "trade"; at: number; trade: BotTrade }
  | { kind: "poll"; at: number; entry: ActivityEntry };

export default function BotDetailPage() {
  const params = useParams<{ id: string }>();
  const botId = params?.id ?? "";

  const [bot, setBot] = useState<BotStatus | null>(null);
  const [trades, setTrades] = useState<BotTrade[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [profile, setProfile] = useState<TraderProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    if (!botId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const [s, t, a] = await Promise.all([
          cbApi<BotStatus>(`/bots/${botId}`),
          cbApi<BotTrade[]>(`/bots/${botId}/trades`),
          cbApi<ActivityEntry[]>(`/bots/${botId}/activity`),
        ]);
        if (!cancelled) {
          setBot(s);
          setTrades(t);
          setActivity(a);
        }
      } catch {
        if (!cancelled) setNotFound(true);
      }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [botId]);

  useEffect(() => {
    if (!bot?.trader) return;
    fetch(`/api/v1/scout/traders/${encodeURIComponent(bot.trader)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TraderProfile | null) => data && setProfile(data))
      .catch(() => {});
  }, [bot?.trader]);

  const stop = async () => {
    if (!bot) return;
    setStopping(true);
    await cbApi(`/bots/${bot.bot_id}/stop`, { method: "POST" }).catch(() => {});
    setStopping(false);
  };

  if (notFound) {
    return (
      <div className="p-6">
        <Link href="/dashboard/bots" className="text-slate-500 hover:text-slate-300 text-sm flex items-center gap-1.5 w-fit">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to bots
        </Link>
        <p className="mt-8 text-slate-500 text-center">Bot not found — it may have been stopped or the server restarted.</p>
      </div>
    );
  }

  if (!bot) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
      </div>
    );
  }

  const matchedVideo = profile?.videos.find((v) => v.id === bot.strategy_id) ?? null;
  const m = matchedVideo?.metrics;

  const rankedVideos = (profile?.videos ?? [])
    .filter((v) => v.metrics.total_return_pct != null)
    .sort((a, b) => (b.metrics.total_return_pct ?? 0) - (a.metrics.total_return_pct ?? 0));
  const rankIndex = matchedVideo ? rankedVideos.findIndex((v) => v.id === matchedVideo.id) : -1;

  const timeline: TimelineItem[] = [
    ...trades.map((t): TimelineItem => ({ kind: "trade", at: t.at, trade: t })),
    ...activity.map((a): TimelineItem => ({ kind: "poll", at: a.at, entry: a })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 40);

  const isAlive = bot.mode !== "stopped";

  return (
    <div className="flex flex-col gap-5 p-6 max-w-[1200px] mx-auto">
      <Link href="/dashboard/bots" className="text-slate-500 hover:text-slate-300 transition-colors w-fit text-sm flex items-center gap-1.5">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to bots
      </Link>

      {/* Header */}
      <div className="card-dark p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <Link
            href={`/lab/scout/traders/${encodeURIComponent(bot.trader)}`}
            className="flex items-center gap-3.5 hover:text-cyan-400 transition-colors group"
          >
            <div className="relative shrink-0">
              <img
                src={resolveAvatarUrl(bot.trader, profile?.avatar)}
                alt={bot.trader}
                referrerPolicy="no-referrer"
                className="w-14 h-14 rounded-full border border-slate-700 object-cover"
              />
              {isAlive && (
                <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-slate-900" />
                </span>
              )}
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-50 tracking-tight group-hover:text-cyan-400 transition-colors">{bot.trader}</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {bot.strategy} · {bot.symbol} · {bot.interval}
              </p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            {isAlive && (
              <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-semibold uppercase tracking-wider">
                <Radio className="w-3 h-3 animate-pulse" /> Live-polling
              </span>
            )}
            <ModeBadge mode={bot.mode} />
            <button
              onClick={stop}
              disabled={stopping}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              {stopping ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
              Stop bot
            </button>
          </div>
        </div>

        {bot.last_error && <p className="text-xs text-red-400 mt-3">Error: {bot.last_error}</p>}
        {!bot.server_live_trading_enabled && (
          <p className="text-[11px] text-amber-400/80 flex items-center gap-1.5 mt-3">
            <Shield className="w-3 h-3 shrink-0" /> Server-side live trading is disabled — every fill is simulated.
          </p>
        )}
      </div>

      {/* Live stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="Last Signal" value={bot.last_signal ?? "—"} />
        <Metric label="Last Price" value={bot.last_price != null ? `$${bot.last_price.toFixed(2)}` : "—"} />
        <Metric label="Bars Seen" value={String(bot.bars_seen)} />
        <Metric label="Trades" value={String(bot.trades_count)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Strategy config */}
        <Section title="Strategy" icon={Settings2}>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Strategy" value={bot.strategy} />
            <Metric label="Symbol" value={bot.symbol} />
            <Metric label="Interval" value={bot.interval} />
            <Metric label="Position Size" value={`$${bot.position_size_usd.toFixed(2)}`} />
            <Metric label="Poll Every" value={`${bot.poll_seconds}s`} />
            <Metric label="Uptime" value={timeAgo(bot.started_at).replace(" ago", "")} />
          </div>
          {Object.keys(bot.strategy_params).length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1.5">Parameters</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(bot.strategy_params).map(([k, v]) => (
                  <span key={k} className="text-[11px] rounded-md bg-slate-800 border border-slate-700 px-2 py-1 text-slate-300 number-font">
                    {k}: <span className="text-cyan-300">{String(v)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {bot.position && (
            <p className="text-xs text-slate-400 mt-3">
              Open position: {bot.position.side} {bot.position.size.toFixed(6)} @ ${bot.position.entry_price.toFixed(2)}
            </p>
          )}
        </Section>

        {/* Backtest performance */}
        <Section title="Backtest performance" icon={Trophy}>
          {!profile ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="w-4 h-4 animate-spin text-slate-600" />
            </div>
          ) : !m || m.error ? (
            <p className="text-sm text-slate-500 text-center py-4">No backtest metrics available for this strategy.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Total Return (10Y)" value={pct(m.total_return_pct)} positive={(m.total_return_pct ?? 0) >= 0} />
                <Metric label="Sharpe" value={m.sharpe_ratio != null ? m.sharpe_ratio.toFixed(2) : "—"} />
                <Metric label="Max Drawdown" value={m.max_drawdown_pct != null ? `${m.max_drawdown_pct.toFixed(1)}%` : "—"} />
                <Metric label="Win Rate" value={m.win_rate != null ? `${m.win_rate.toFixed(1)}%` : "—"} />
              </div>
              <p className="text-[11px] text-slate-500 mt-3">
                {m.total_trades ?? 0} backtested trades over {m.bars ?? 0} bars · {matchedVideo?.label}
              </p>
              {rankIndex >= 0 && (
                <p className="text-xs text-slate-300 mt-3 flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5 text-amber-400" />
                  Ranked <span className="font-bold text-amber-300 number-font">#{rankIndex + 1}</span> of{" "}
                  {rankedVideos.length} strategies backtested from {bot.trader}&rsquo;s channel
                </p>
              )}
            </>
          )}
        </Section>
      </div>

      {/* Influencer */}
      {profile && (
        <Section title="Influencer" icon={Link2}>
          <div className="flex items-start gap-4 flex-wrap">
            <img
              src={resolveAvatarUrl(profile.trader, profile.avatar)}
              alt={profile.trader}
              referrerPolicy="no-referrer"
              className="w-12 h-12 rounded-full border border-slate-700 object-cover shrink-0"
            />
            <div className="flex-1 min-w-0">
              {profile.channel?.description && (
                <p className="text-xs text-slate-400 whitespace-pre-line max-w-2xl">{profile.channel.description}</p>
              )}
              {profile.channel?.links && profile.channel.links.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
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
              <Link
                href={`/lab/scout/traders/${encodeURIComponent(bot.trader)}`}
                className="text-cyan-400 hover:text-cyan-300 text-xs mt-2 inline-block"
              >
                View full trader profile →
              </Link>
            </div>
          </div>
        </Section>
      )}

      {/* Timeline */}
      <Section title="Timeline" icon={Activity}>
        {timeline.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">No activity yet — waiting for the first poll cycle.</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-800/60 max-h-[480px] overflow-y-auto">
            {timeline.map((item, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5 text-xs">
                <div className="relative shrink-0 w-2">
                  {i === 0 && isAlive ? (
                    <span className="flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
                    </span>
                  ) : (
                    <span className={cn("inline-flex rounded-full h-2 w-2", item.kind === "trade" ? "bg-amber-500" : "bg-slate-700")} />
                  )}
                </div>
                <span className="text-slate-600 number-font w-16 shrink-0">{timeAgo(item.at)}</span>
                {item.kind === "trade" ? (
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className={cn("font-bold uppercase", item.trade.side === "BUY" ? "text-emerald-400" : "text-red-400")}>
                      {item.trade.side}
                    </span>
                    <span className="text-slate-300 number-font">
                      {item.trade.qty.toFixed(6)} @ ${item.trade.price.toFixed(2)}
                    </span>
                    {item.trade.pnl_usd != null && (
                      <span className={cn("number-font", item.trade.pnl_usd >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {item.trade.pnl_usd >= 0 ? "+" : ""}${item.trade.pnl_usd.toFixed(2)}
                      </span>
                    )}
                    {item.trade.dry_run && <span className="text-amber-500 uppercase text-[9px]">dry</span>}
                    <span className="text-slate-600">executed order</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-2 flex-wrap text-slate-500">
                    evaluated bar @ <span className="number-font text-slate-400">${item.entry.price.toFixed(2)}</span>
                    <SignalBadge signal={item.entry.signal} />
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
