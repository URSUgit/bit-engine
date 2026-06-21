"use client";

import { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from "recharts";
import { backtestApi, type BacktestResult } from "@/lib/backtest-api";
import { isoDaysAgo } from "./shared";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CurrentPosition {
  inTrade: boolean;
  side: "long" | "short" | null;
  entryPrice: number | null;
  entryTime: string | null;
  currentPrice: number | null;
  unrealizedPnlPct: number | null;
}

interface SimResult {
  equityCurve: { t: string; strategy: number; buyhold: number }[];
  currentEquity: number;
  currentPosition: CurrentPosition;
  totalReturnPct: number;
  vsBuyhold: number;
  totalTrades: number;
  daysSimulated: number;
  initialCapital: number;
}

const PRESET_DAYS = [7, 14, 30, 60, 90, 180, 365];

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildBuyholdCurve(
  result: BacktestResult,
): { t: string; buyhold: number }[] {
  const bh = result.benchmark?.equity_curve;
  if (bh?.length) {
    return bh.map((p, i) => ({
      t: result.equity_curve[i]?.t
        ? new Date(result.equity_curve[i]!.t).toISOString().slice(0, 10)
        : String(i),
      buyhold: p.equity,
    }));
  }
  // fallback: linear scaling from start price to last price
  const ec = result.equity_curve;
  if (!ec.length) return [];
  const cap = result.metrics.initial_capital;
  const first = ec[0]!.equity;
  const last = ec[ec.length - 1]!.equity;
  const growthFactor = last / first;
  return ec.map((p) => ({
    t: new Date(p.t).toISOString().slice(0, 10),
    buyhold: cap * growthFactor * (p.equity / last),
  }));
}

function extractPosition(result: BacktestResult): CurrentPosition {
  const trades = result.trades ?? [];
  if (!trades.length) return { inTrade: false, side: null, entryPrice: null, entryTime: null, currentPrice: null, unrealizedPnlPct: null };
  const last = trades[trades.length - 1]!;
  const lastEquityPt = result.equity_curve[result.equity_curve.length - 1];
  if (!lastEquityPt) return { inTrade: false, side: null, entryPrice: null, entryTime: null, currentPrice: null, unrealizedPnlPct: null };

  // Detect open position: last trade exit_time at or after last equity point time
  const exitMs = new Date(last.exit_time).getTime();
  const lastBarMs = lastEquityPt.t;
  const isOpen = Math.abs(exitMs - lastBarMs) < 24 * 60 * 60 * 1000; // within 1 day

  if (!isOpen) return { inTrade: false, side: null, entryPrice: null, entryTime: null, currentPrice: null, unrealizedPnlPct: null };

  const currentPrice = last.exit_price;
  const unrealizedPnlPct = last.pnl_pct;

  return {
    inTrade: true,
    side: last.side,
    entryPrice: last.entry_price,
    entryTime: last.entry_time,
    currentPrice,
    unrealizedPnlPct,
  };
}

function buildSimResult(result: BacktestResult): SimResult {
  const bhCurve = buildBuyholdCurve(result);

  const equityCurve = result.equity_curve.map((p, i) => ({
    t: new Date(p.t).toISOString().slice(0, 10),
    strategy: p.equity,
    buyhold: bhCurve[i]?.buyhold ?? result.metrics.initial_capital,
  }));

  const currentEquity = result.metrics.final_equity;
  const initialCapital = result.metrics.initial_capital;
  const bhFinalEquity = bhCurve[bhCurve.length - 1]?.buyhold ?? initialCapital;
  const bhReturn = ((bhFinalEquity - initialCapital) / initialCapital) * 100;
  const totalReturnPct = result.metrics.total_return_pct;
  const vsBuyhold = totalReturnPct - bhReturn;
  const totalTrades = result.metrics.total_trades;
  const daysSimulated = Math.round(
    (new Date(result.end_date).getTime() - new Date(result.start_date).getTime()) / 86400000,
  );

  return {
    equityCurve,
    currentEquity,
    currentPosition: extractPosition(result),
    totalReturnPct,
    vsBuyhold,
    totalTrades,
    daysSimulated,
    initialCapital,
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 text-center">
      <div className={`text-2xl font-bold font-mono ${color ?? "text-zinc-200"}`}>{value}</div>
      <div className="text-xs text-zinc-500 mt-0.5">{label}</div>
      {sub && <div className="text-[11px] text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function PositionCard({ pos, initialCapital }: { pos: CurrentPosition; initialCapital: number }) {
  if (!pos.inTrade) {
    return (
      <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-xl p-4 text-center text-sm text-zinc-500">
        No open position at end of simulation period
      </div>
    );
  }
  const pnlColor = (pos.unrealizedPnlPct ?? 0) >= 0 ? "text-emerald-400" : "text-red-400";
  return (
    <div className="bg-emerald-950/20 border border-emerald-800/40 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400">Open Position</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
          pos.side === "long" ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400" : "bg-red-500/20 border-red-500/50 text-red-400"
        }`}>
          {pos.side?.toUpperCase()}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-[10px] text-zinc-500 uppercase">Entry Price</div>
          <div className="font-mono font-semibold text-zinc-200">${pos.entryPrice?.toFixed(2) ?? "—"}</div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500 uppercase">Current Price</div>
          <div className="font-mono font-semibold text-zinc-200">${pos.currentPrice?.toFixed(2) ?? "—"}</div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500 uppercase">Entry Time</div>
          <div className="font-mono text-xs text-zinc-400">{pos.entryTime?.slice(0, 10) ?? "—"}</div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500 uppercase">Unrealized P&L</div>
          <div className={`font-mono font-bold ${pnlColor}`}>
            {pos.unrealizedPnlPct != null ? `${pos.unrealizedPnlPct >= 0 ? "+" : ""}${pos.unrealizedPnlPct.toFixed(2)}%` : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface LivePnlSimulatorProps {
  symbol: string;
  strategy: string;
  strategyParams: Record<string, number>;
  interval: string;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
}

export function LivePnlSimulator({
  symbol, strategy, strategyParams, interval,
  initialCapital, commissionPct, slippagePct, positionPct,
}: LivePnlSimulatorProps) {
  const [daysAgo, setDaysAgo] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<SimResult | null>(null);

  async function simulate() {
    setLoading(true);
    setError(null);
    try {
      const result = await backtestApi.run({
        symbol,
        strategy,
        start_date: isoDaysAgo(daysAgo),
        interval,
        initial_capital: initialCapital,
        commission_pct: commissionPct / 100,
        slippage_pct: slippagePct / 100,
        position_size_pct: positionPct / 100,
        strategy_params: strategyParams,
      });
      setSimResult(buildSimResult(result));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const kpiColor = (v: number) => (v >= 0 ? "text-emerald-400" : "text-red-400");
  const pctStr = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-zinc-200 mb-1">Live P&L Simulator</h3>
        <p className="text-xs text-zinc-500 mb-4">
          Simulate: "What if I had started this strategy <strong className="text-zinc-400">N days ago</strong> with ${initialCapital.toLocaleString()}?"
        </p>

        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">Start date</div>
          <div className="flex gap-1.5 flex-wrap">
            {PRESET_DAYS.map((d) => (
              <button
                key={d}
                onClick={() => setDaysAgo(d)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                  daysAgo === d ? "bg-cyan-500 text-zinc-950 font-bold" : "bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {d}d ago
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={simulate}
          disabled={loading}
          className="px-4 py-2 bg-cyan-500 text-zinc-950 rounded-lg text-sm font-bold hover:bg-cyan-400 transition disabled:opacity-60 flex items-center gap-2"
        >
          {loading ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin" />
              Simulating…
            </>
          ) : (
            "Run Simulation"
          )}
        </button>

        {error && (
          <div className="mt-3 text-xs text-red-400 bg-red-900/20 border border-red-800/50 rounded px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {simResult && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              label="Current Equity"
              value={`$${simResult.currentEquity.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
              sub={`Started $${simResult.initialCapital.toLocaleString()}`}
              color="text-zinc-200"
            />
            <KpiCard
              label="Total Return"
              value={pctStr(simResult.totalReturnPct)}
              sub={`Over ${simResult.daysSimulated} days`}
              color={kpiColor(simResult.totalReturnPct)}
            />
            <KpiCard
              label="Alpha vs Buy-Hold"
              value={pctStr(simResult.vsBuyhold)}
              sub="Excess return"
              color={kpiColor(simResult.vsBuyhold)}
            />
            <KpiCard
              label="Total Trades"
              value={String(simResult.totalTrades)}
              sub={`~${(simResult.totalTrades / Math.max(simResult.daysSimulated, 1) * 30).toFixed(1)}/month`}
              color="text-cyan-300"
            />
          </div>

          {/* Dual equity chart */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-zinc-300 mb-3">Equity Curve vs Buy-Hold</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={simResult.equityCurve} margin={{ top: 4, right: 8, bottom: 20, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="t"
                  stroke="#52525b"
                  tick={{ fill: "#71717a", fontSize: 9 }}
                  tickFormatter={(v: string) => v.slice(5)}
                  interval={Math.max(1, Math.floor(simResult.equityCurve.length / 8))}
                />
                <YAxis
                  stroke="#52525b"
                  tick={{ fill: "#71717a", fontSize: 9 }}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`}
                  width={54}
                />
                <Tooltip
                  content={({ payload, label }) => {
                    if (!payload?.length) return null;
                    return (
                      <div className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs">
                        <div className="text-zinc-400 mb-1">{label}</div>
                        {payload.map((p) => (
                          <div key={p.dataKey as string} style={{ color: p.color }}>
                            {p.name}: ${(p.value as number).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
                <ReferenceLine x={todayStr} stroke="#facc15" strokeDasharray="4 4" label={{ value: "Today", fill: "#facc15", fontSize: 10 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
                <Line type="monotone" dataKey="strategy" name="Strategy" stroke="#06b6d4" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="buyhold" name="Buy & Hold" stroke="#52525b" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Current position */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">Current Position</div>
            <PositionCard pos={simResult.currentPosition} initialCapital={simResult.initialCapital} />
          </div>

          {/* Info footer */}
          <div className="text-[11px] text-zinc-600 px-1">
            Simulation period: {isoDaysAgo(daysAgo)} → today · {strategy.toUpperCase()} · {symbol} · {interval}
          </div>
        </>
      )}
    </div>
  );
}
