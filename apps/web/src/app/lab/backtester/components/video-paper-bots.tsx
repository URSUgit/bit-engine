"use client";

import { useEffect, useRef, useState } from "react";
import type { VideoStrategyOrigin } from "@/lib/backtest-api";

const API = "/api/v1/paper/bots";
const button = "rounded border border-zinc-700 px-3 py-1.5 text-sm disabled:opacity-50";
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

type Bot = {
  id: string;
  name: string;
  status: "ready" | "running" | "paused" | "stopped";
  offset_bps: number;
  cash: number;
  position: { entry_price: number; size: number } | null;
  events: { kind: "paper_fill" | "gap" | "missed_open"; observed_ms: number; action?: string; price?: number; pnl?: number }[];
  feed_error: string | null;
  source: { backtest_id: string; video_origin: VideoStrategyOrigin; first_candle_utc: string; last_candle_utc: string };
  cost_model: { initial_capital: number; position_size_pct: number; commission_pct: number; slippage_pct: number; spread_bps: number };
};

async function request<T>(suffix = "", init?: RequestInit): Promise<T> {
  const res = await fetch(API + suffix, { ...init, cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "Paper bot request failed.");
  return data as T;
}

export function CreateVideoPaperBot({ backtestId, name, onCreated }: { backtestId: string; name: string; onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create() {
    setBusy(true);
    setError("");
    try {
      await request<Bot>("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backtest_id: backtestId }) });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the paper bot.");
    } finally {
      setBusy(false);
    }
  }
  return <section className="space-y-2 rounded-lg border border-zinc-800 p-3 text-sm">
    <h3 className="font-semibold">{name}</h3>
    <p className="text-zinc-400">Create a paper bot from this saved result. It starts only when you click Start bot.</p>
    <button type="button" className={button} disabled={busy} onClick={() => void create()}>Create paper bot</button>
    {error && <p role="alert" className="text-amber-300">{error}</p>}
  </section>;
}

export function VideoPaperBots({ onOpenBacktest }: { onOpenBacktest: (id: string) => void }) {
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const updating = useRef(false);
  useEffect(() => {
    let closed = false;
    let pending = false;
    async function refresh() {
      if (pending || updating.current) return;
      pending = true;
      const before = version.current;
      try {
        const data = await request<{ bots: Bot[] }>();
        if (!closed && version.current === before) {
          setBots(data.bots);
          setStatusError("");
        }
      } catch {
        if (!closed && version.current === before) setStatusError("Could not refresh paper bots.");
      } finally { pending = false; }
    }
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { closed = true; window.clearInterval(timer); };
  }, []);

  async function change(bot: Bot, action: "start" | "stop") {
    if (updating.current) return;
    updating.current = true;
    version.current++;
    setBusy(true);
    setError("");
    try {
      const updated = await request<Bot>(`/${encodeURIComponent(bot.id)}/${action}`, { method: "POST" });
      setBots((current) => current?.map((item) => item.id === updated.id ? updated : item) ?? [updated]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the paper bot.");
    } finally {
      updating.current = false;
      setBusy(false);
    }
  }

  return <section aria-labelledby="video-paper-bots" className="space-y-3 rounded-lg border border-zinc-800 p-4 text-sm">
    <h2 id="video-paper-bots" className="text-lg font-semibold">Video strategy paper bots</h2>
    <p className="text-zinc-400">Each bot has its own simulated balance and follows new BTCUSDT hourly candles while Bit Engine is running. No real orders.</p>
    {(error || statusError) && <p role="alert" className="text-amber-300">{error || statusError}</p>}
    {!bots && !statusError && <p role="status">Loading paper bots…</p>}
    {bots?.length === 0 && <p className="text-zinc-400">No bots yet. Open a named video backtest and choose Create paper bot.</p>}
    {bots?.map((bot) => <article key={bot.id} className="space-y-2 rounded border border-zinc-800 p-3">
      <h3 className="break-words font-semibold">{bot.name}</h3>
      <p className="text-zinc-300">Status: {bot.status} · {bot.offset_bps} bps · Paper cash {usd.format(bot.cash)}</p>
      <p className="text-zinc-400">{bot.position ? `Long ${bot.position.size.toFixed(6)} BTC at ${usd.format(bot.position.entry_price)}` : "No open position"}</p>
      <p className="text-xs text-zinc-400">Starting cash {usd.format(bot.cost_model.initial_capital)} · Allocation {bot.cost_model.position_size_pct * 100}% · Fee {(bot.cost_model.commission_pct * 100).toFixed(3)}% · Slippage {(bot.cost_model.slippage_pct * 100).toFixed(3)}% · Spread {bot.cost_model.spread_bps} bps</p>
      <div className="flex flex-wrap items-center gap-2">
        {bot.status === "ready" && <button type="button" className={button} disabled={busy} onClick={() => void change(bot, "start")}>Start bot</button>}
        {(bot.status === "running" || bot.status === "paused") && <button type="button" className={button} disabled={busy} onClick={() => void change(bot, "stop")}>Stop bot</button>}
        <button type="button" className={button} disabled={busy} onClick={() => onOpenBacktest(bot.source.backtest_id)}>Open source backtest</button>
        <a href={bot.source.video_origin.url} target="_blank" rel="noreferrer" className="text-cyan-300 underline">Watch source video</a>
      </div>
      {bot.feed_error && <p className="text-amber-300">{bot.feed_error}</p>}
      {bot.status === "stopped" && bot.position && <p className="text-zinc-400">The open simulated position is frozen; no exit was recorded.</p>}
      <details><summary>Bot events ({bot.events.length})</summary>
        <ul className="mt-2 max-h-44 overflow-auto text-zinc-400">{[...bot.events].reverse().map((event) => <li key={`${event.observed_ms}-${event.kind}`}>
          {new Date(event.observed_ms).toISOString()} · {event.kind === "paper_fill" && event.price !== undefined
            ? `Simulated ${event.action === "buy" ? "entry" : "exit"} at ${usd.format(event.price)}${event.pnl === undefined ? "" : ` · P/L ${usd.format(event.pnl)}`}`
            : event.kind === "gap" ? "Data gap — no fill" : "Missed open — no fill"}
        </li>)}</ul>
      </details>
    </article>)}
  </section>;
}
