"use client";

import { useEffect, useRef, useState } from "react";

type Event = {
  kind: "paper_fill" | "missed_open" | "gap";
  action?: "buy" | "close";
  price?: number;
  pnl?: number;
  eligible_open?: number;
  observed_ms: number;
};

type PaperRun = {
  id: string;
  status: "running" | "paused" | "stopped";
  offset_bps: number;
  cash: number;
  position: { entry_price: number; size: number } | null;
  events: Event[];
  last_bar: number;
  observed_ms: number;
  feed_error: string | null;
};

const URL = "/api/v1/paper/forward";
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const utc = (milliseconds: number) => new Date(milliseconds).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const button = "rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium disabled:opacity-50";

async function request(path = "", init?: RequestInit): Promise<PaperRun | null> {
  const res = await fetch(URL + path, { ...init, cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(typeof data?.detail === "string" ? data.detail : `Paper forward request failed (${res.status}).`);
  }
  return res.json() as Promise<PaperRun | null>;
}

export function PaperForward({ initialOffset }: { initialOffset: number }) {
  const [offset, setOffset] = useState(String(initialOffset));
  const [run, setRun] = useState<PaperRun | null | undefined>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const action = useRef(0);

  useEffect(() => {
    let closed = false;
    let refreshing = false;
    async function refresh() {
      if (refreshing || action.current % 2) return;
      const version = action.current;
      refreshing = true;
      try {
        const result = await request();
        if (!closed && version === action.current) {
          setRun(result);
          setStatusError(null);
        }
      } catch (err) {
        if (!closed && version === action.current) setStatusError(err instanceof Error ? err.message : "Could not read paper run.");
      } finally {
        refreshing = false;
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { closed = true; window.clearInterval(timer); };
  }, []);

  async function change(kind: "start" | "stop") {
    if (action.current % 2) return;
    action.current += 1;
    setPending(true);
    setError(null);
    try {
      setRun(await request(`/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: kind === "start" ? JSON.stringify({ offset_bps: Number(offset) }) : undefined,
      }));
      setStatusError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update paper run.");
    } finally {
      action.current += 1;
      setPending(false);
    }
  }

  const active = run?.status === "running" || run?.status === "paused";
  const valid = /^\d{1,3}$/.test(offset) && Number(offset) <= 400;
  const last = run?.events.at(-1);
  return (
    <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5" aria-labelledby="paper-forward-heading">
      <div>
        <h3 id="paper-forward-heading" className="text-lg font-semibold text-zinc-100">Paper Forward · Previous-day breakout</h3>
        <p className="mt-1 text-sm text-zinc-400">BTC/USDT · Binance Spot · completed hourly candles. Simulated fills only; no broker, wallet, or real orders.</p>
        <p className="mt-1 text-xs text-zinc-400">Starts with $10,000 paper cash, 25% per trade and a 0.10% fee per fill. The backend monitors the run while Bit Engine is running, even if you leave this tab.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-zinc-300">
          Breakout offset (bps)
          <input type="number" min={0} max={400} step={1} value={active && run ? run.offset_bps : offset}
            onChange={(e) => setOffset(e.target.value)} disabled={active || pending}
            className="ml-2 w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1" />
        </label>
        {active ? (
          <button type="button" disabled={pending} onClick={() => void change("stop")} className={`${button} text-zinc-100`}>Stop paper test</button>
        ) : (
          <button type="button" disabled={pending || run === undefined || !valid} onClick={() => void change("start")}
            className={`${button} bg-cyan-500 text-zinc-950`}>{run ? "Replace with new paper test" : "Start paper test"}</button>
        )}
        <span aria-live="polite" className="text-sm text-zinc-300">{pending ? "Updating…" : run ? `Status: ${run.status}` : run === undefined ? "Checking status…" : "No paper test running"}</span>
      </div>
      {statusError && <p role="alert" className="text-sm text-amber-300">Status refresh failed: {statusError}</p>}
      {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
      {run && (
        <div className="space-y-2 border-t border-zinc-800 pt-3 text-sm text-zinc-400">
          <p>Run offset: {run.offset_bps} bps · Paper cash: {usd.format(run.cash)} · {run.position ? `Long ${run.position.size.toFixed(6)} BTC at ${usd.format(run.position.entry_price)}` : "No open position"}</p>
          <p>Last processed candle closed: {utc((run.last_bar + 3600) * 1000)} · Feed observed: {utc(run.observed_ms)}</p>
          {run.feed_error && <p role="status" className="text-amber-300">{run.feed_error}</p>}
          {run.status === "paused" && <p className="text-amber-300">{last?.kind === "gap" ? "Paused after missing one or more hourly candles." : "Paused because the next opening price was not observed in time."} No missed fills were backdated.</p>}
          {run.status === "stopped" && run.position && <p>Stopping freezes the simulated position; it does not record an exit.</p>}
          {run.events.length === 0 ? <p>No fills yet. Only new completed candles can trigger a signal.</p> : (
            <ol aria-label="Paper forward events" className="max-h-52 space-y-1 overflow-y-auto">
              {[...run.events].reverse().map((event) => (
                <li key={`${event.observed_ms}-${event.kind}`}>
                  {event.kind === "paper_fill"
                    ? `${utc((event.eligible_open ?? 0) * 1000)} · Simulated ${event.action === "buy" ? "entry" : "exit"} at ${usd.format(event.price ?? 0)}${event.pnl === undefined ? "" : ` · P/L ${usd.format(event.pnl)}`}`
                    : `${utc(event.observed_ms)} · ${event.kind === "gap" ? "Data gap" : "Missed next open"} — no fill`}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
