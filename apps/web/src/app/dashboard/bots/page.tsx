"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Loader2, Square, Shield, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveAvatarUrl } from "@/lib/avatar";

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

function BotCard({ bot, onStopped }: { bot: BotStatus; onStopped: () => void }) {
  const [trades, setTrades] = useState<BotTrade[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    const load = () => cbApi<BotTrade[]>(`/bots/${bot.bot_id}/trades`).then((t) => !cancelled && setTrades(t)).catch(() => {});
    load();
    const id = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [expanded, bot.bot_id]);

  const stop = async () => {
    setStopping(true);
    await cbApi(`/bots/${bot.bot_id}/stop`, { method: "POST" }).catch(() => {});
    setStopping(false);
    onStopped();
  };

  return (
    <div className="card-dark p-4 border-l-2 border-cyan-500/30">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link
          href={`/lab/scout/traders/${encodeURIComponent(bot.trader)}`}
          className="flex items-center gap-2.5 hover:text-cyan-400 transition-colors"
        >
          <img
            src={resolveAvatarUrl(bot.trader)}
            alt={bot.trader}
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-full border border-slate-700 object-cover shrink-0"
          />
          <div>
            <p className="text-sm font-semibold text-slate-100">{bot.trader}</p>
            <p className="text-[11px] text-slate-500">{bot.strategy} · {bot.symbol} · {bot.interval}</p>
          </div>
        </Link>
        <ModeBadge mode={bot.mode} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
        <Stat label="Last Signal" value={bot.last_signal ?? "—"} />
        <Stat label="Last Price" value={bot.last_price != null ? `$${bot.last_price.toFixed(2)}` : "—"} />
        <Stat label="Bars Seen" value={String(bot.bars_seen)} />
        <Stat label="Trades" value={String(bot.trades_count)} />
      </div>

      {bot.position && (
        <p className="text-xs text-slate-400 mt-2">
          Open position: {bot.position.side} {bot.position.size.toFixed(6)} @ ${bot.position.entry_price.toFixed(2)}
        </p>
      )}
      {bot.last_error && <p className="text-xs text-red-400 mt-2">Error: {bot.last_error}</p>}
      {!bot.server_live_trading_enabled && (
        <p className="text-[11px] text-amber-400/80 flex items-center gap-1.5 mt-2">
          <Shield className="w-3 h-3 shrink-0" /> Server-side live trading is disabled — every fill above is simulated.
        </p>
      )}

      <div className="flex items-center justify-between mt-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
          disabled={bot.trades_count === 0}
        >
          <ArrowRight className={cn("w-3 h-3 transition-transform", expanded && "rotate-90")} />
          {bot.trades_count === 0 ? "No trades yet" : expanded ? "Hide trades" : "Show trades"}
        </button>
        <button
          onClick={stop}
          disabled={stopping}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
        >
          {stopping ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
          Stop bot
        </button>
      </div>

      {expanded && trades.length > 0 && (
        <div className="flex flex-col divide-y divide-slate-800/60 max-h-56 overflow-y-auto mt-3 border-t border-slate-800/60 pt-2">
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
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</p>
      <p className="text-sm font-semibold text-slate-100 number-font mt-0.5">{value}</p>
    </div>
  );
}

export default function BotsPage() {
  const [bots, setBots] = useState<BotStatus[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => cbApi<BotStatus[]>("/bots").then((b) => !cancelled && setBots(b)).catch(() => !cancelled && setBots([]));
    load();
    const id = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="flex flex-col gap-5 p-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          <Bot className="w-5 h-5 text-cyan-400" /> Trading Bots
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Bots deployed from Scout trader profiles, running their own backtested strategy against live prices.
          Dry-run fills are simulated — no real order fires unless the bot is promoted to live.
        </p>
      </div>

      {bots === null ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
        </div>
      ) : bots.length === 0 ? (
        <div className="card-dark p-8 text-center">
          <p className="text-sm text-slate-500">No bots deployed yet.</p>
          <Link href="/lab/scout/traders" className="text-cyan-400 hover:text-cyan-300 text-sm mt-2 inline-block">
            Deploy one from a trader profile →
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {bots.map((b) => (
            <BotCard key={b.bot_id} bot={b} onStopped={() => setBots((prev) => prev?.filter((x) => x.bot_id !== b.bot_id) ?? null)} />
          ))}
        </div>
      )}
    </div>
  );
}
