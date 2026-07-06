"use client";

import { useMemo } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function simulateReturnAtCost(
  trades: BacktestResult["trades"],
  commissionPct: number,
  slippagePct: number,
  initialCapital: number,
): number {
  let equity = initialCapital;
  for (const t of trades) {
    // Each trade: entry + exit cost (commission + slippage both sides)
    const roundTripCost = (commissionPct + slippagePct) * 2;
    const netPnlPct = t.pnl_pct - roundTripCost * 100;
    equity *= 1 + netPnlPct / 100;
  }
  return ((equity - initialCapital) / initialCapital) * 100;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BreakevenAnalysis({ result }: { result: BacktestResult }) {
  const { trades, metrics } = result;
  const initialCapital = metrics.initial_capital ?? 10000;

  // Commission sweep: 0 to 0.5% (0 to 50bps), fixed slippage = 0
  const commissionSweep = useMemo(() => {
    return Array.from({ length: 26 }, (_, i) => {
      const c = i * 0.02; // 0, 0.02, 0.04, ..., 0.50 %
      const ret = simulateReturnAtCost(trades, c / 100, 0, initialCapital);
      return { commission: c, return: ret };
    });
  }, [trades, initialCapital]);

  // Slippage sweep: 0 to 1% (0 to 100bps), fixed commission = 0.04%
  const slippageSweep = useMemo(() => {
    return Array.from({ length: 26 }, (_, i) => {
      const s = i * 0.04; // 0, 0.04, 0.08, ..., 1.00 %
      const ret = simulateReturnAtCost(trades, 0.0004, s / 100, initialCapital);
      return { slippage: s, return: ret };
    });
  }, [trades, initialCapital]);

  // Find breakeven points
  const commBreakeven = useMemo(() => {
    for (let i = 1; i < commissionSweep.length; i++) {
      if ((commissionSweep[i - 1]?.return ?? 0) >= 0 && (commissionSweep[i]?.return ?? 0) < 0) {
        const prev = commissionSweep[i - 1]!;
        const curr = commissionSweep[i]!;
        const frac =
          prev.return / (prev.return - curr.return);
        return prev.commission + frac * 0.02;
      }
    }
    return null;
  }, [commissionSweep]);

  const slipBreakeven = useMemo(() => {
    for (let i = 1; i < slippageSweep.length; i++) {
      if ((slippageSweep[i - 1]?.return ?? 0) >= 0 && (slippageSweep[i]?.return ?? 0) < 0) {
        const prev = slippageSweep[i - 1]!;
        const curr = slippageSweep[i]!;
        const frac = prev.return / (prev.return - curr.return);
        return prev.slippage + frac * 0.04;
      }
    }
    return null;
  }, [slippageSweep]);

  // Friction budget: total friction the strategy can absorb (as % of gross return)
  const grossReturn = metrics.total_return_pct ?? 0;
  const frictionBudgetPct = grossReturn > 0
    ? (grossReturn / (1 + Math.abs(grossReturn / 100))) * 0.5
    : 0;

  // Current costs (approximate)
  const currentCommission = 0.04; // typical taker
  const currentSlippage = 0.05;   // typical estimate
  const currentReturn = simulateReturnAtCost(trades, currentCommission / 100, currentSlippage / 100, initialCapital);

  if (trades.length === 0) {
    return <div className="text-center text-zinc-500 py-10">No trades to analyze.</div>;
  }

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Zero-Cost Return",
            value: `${simulateReturnAtCost(trades, 0, 0, initialCapital).toFixed(2)}%`,
            color: "text-emerald-400",
            sub: "No commissions or slippage",
          },
          {
            label: "Commission Breakeven",
            value: commBreakeven != null ? `${commBreakeven.toFixed(3)}%` : "—",
            color: commBreakeven != null ? "text-amber-400" : "text-zinc-400",
            sub: commBreakeven != null ? "per trade per side" : "Strategy never profitable" ,
          },
          {
            label: "Slippage Breakeven",
            value: slipBreakeven != null ? `${slipBreakeven.toFixed(3)}%` : "—",
            color: slipBreakeven != null ? "text-amber-400" : "text-zinc-400",
            sub: slipBreakeven != null ? "per trade per side" : "Strategy never profitable",
          },
          {
            label: "Return @ Typical Cost",
            value: `${currentReturn.toFixed(2)}%`,
            color: currentReturn >= 0 ? "text-emerald-400" : "text-red-400",
            sub: `${currentCommission}% comm + ${currentSlippage}% slip`,
          },
        ].map((c) => (
          <div key={c.label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold font-mono ${c.color}`}>{c.value}</div>
            <div className="text-[10px] text-zinc-600 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Commission sensitivity */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">
          Commission Sensitivity (slippage = 0)
        </h4>
        <p className="text-[10px] text-zinc-600 mb-3">
          Total return as a function of round-trip commission rate (taker fee per side).
          {commBreakeven != null &&
            ` Strategy breaks even at ~${commBreakeven.toFixed(3)}% commission.`}
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={commissionSweep} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="commission"
              tick={{ fill: "#71717a", fontSize: 10 }}
              tickFormatter={(v) => `${Number(v).toFixed(2)}%`}
              label={{ value: "Commission %", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }}
            />
            <YAxis
              tick={{ fill: "#71717a", fontSize: 10 }}
              tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
            />
            <ReferenceLine y={0} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: "Breakeven", fill: "#f59e0b", fontSize: 9 }} />
            {commBreakeven != null && (
              <ReferenceLine
                x={parseFloat(commBreakeven.toFixed(2))}
                stroke="#f59e0b"
                strokeDasharray="4 2"
                strokeOpacity={0.6}
              />
            )}
            <Line
              type="monotone"
              dataKey="return"
              stroke="#06b6d4"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Slippage sensitivity */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">
          Slippage Sensitivity (commission = 0.04%)
        </h4>
        <p className="text-[10px] text-zinc-600 mb-3">
          Total return as a function of per-trade slippage.
          {slipBreakeven != null &&
            ` Strategy breaks even at ~${slipBreakeven.toFixed(3)}% slippage.`}
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={slippageSweep} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="slippage"
              tick={{ fill: "#71717a", fontSize: 10 }}
              tickFormatter={(v) => `${Number(v).toFixed(2)}%`}
              label={{ value: "Slippage %", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }}
            />
            <YAxis
              tick={{ fill: "#71717a", fontSize: 10 }}
              tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
            />
            <ReferenceLine y={0} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: "Breakeven", fill: "#f59e0b", fontSize: 9 }} />
            {slipBreakeven != null && (
              <ReferenceLine
                x={parseFloat(slipBreakeven.toFixed(2))}
                stroke="#f59e0b"
                strokeDasharray="4 2"
                strokeOpacity={0.6}
              />
            )}
            <Line
              type="monotone"
              dataKey="return"
              stroke="#a78bfa"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Interpretation */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-semibold text-zinc-300">Friction Tolerance Interpretation</h4>
        <div className="space-y-2 text-xs text-zinc-400">
          {commBreakeven != null && commBreakeven < 0.04 && (
            <div className="bg-red-950/30 border border-red-800/40 rounded p-2 text-red-300">
              <strong>High friction sensitivity:</strong> Strategy breaks even below Binance taker fee (0.04%).
              It may not be viable with real execution costs.
            </div>
          )}
          {commBreakeven != null && commBreakeven >= 0.04 && commBreakeven < 0.10 && (
            <div className="bg-yellow-950/20 border border-yellow-800/40 rounded p-2 text-yellow-300">
              <strong>Moderate margin:</strong> Commission breakeven of {commBreakeven.toFixed(3)}% leaves limited
              room for maker/taker variation. Use maker orders when possible.
            </div>
          )}
          {commBreakeven != null && commBreakeven >= 0.10 && (
            <div className="bg-emerald-950/20 border border-emerald-800/40 rounded p-2 text-emerald-300">
              <strong>Good friction tolerance:</strong> Commission breakeven of {commBreakeven.toFixed(3)}% comfortably
              exceeds typical exchange fees. Strategy survives normal cost conditions.
            </div>
          )}
          {commBreakeven == null && (
            <div className="bg-red-950/30 border border-red-800/40 rounded p-2 text-red-300">
              Strategy never reaches profitability even at zero cost — likely unprofitable on this configuration.
            </div>
          )}
          <p>
            <strong className="text-zinc-300">Reference costs:</strong>{" "}
            Binance taker: 0.04% | Binance maker: 0.02% | Bybit taker: 0.055% |
            Typical slippage on 1m: 0.02–0.10%
          </p>
          <p>
            <strong className="text-zinc-300">Note:</strong>{" "}
            This analysis re-simulates the P&L sequence by adjusting each trade's net return.
            It approximates the effect of different cost assumptions on the historical result.
          </p>
        </div>
      </div>
    </div>
  );
}
