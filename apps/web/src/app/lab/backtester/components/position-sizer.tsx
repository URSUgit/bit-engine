"use client";

import { useState } from "react";

// ── Types & helpers ───────────────────────────────────────────────────────────

type SizingMethod = "fixed_pct" | "kelly" | "risk_per_trade" | "volatility";

const METHOD_META: Record<SizingMethod, { label: string; description: string }> = {
  fixed_pct:      { label: "Fixed %",         description: "Allocate a fixed % of account per trade" },
  kelly:          { label: "Kelly Criterion",  description: "Optimal fraction based on win rate & payoff ratio" },
  risk_per_trade: { label: "Risk Per Trade",   description: "Size so max loss = X% of account" },
  volatility:     { label: "Volatility-Based", description: "Size based on ATR — equal risk across volatile/stable assets" },
};

function kellyFraction(winRate: number, avgWinPct: number, avgLossPct: number): number {
  if (avgLossPct === 0) return 0;
  const b = Math.abs(avgWinPct) / Math.abs(avgLossPct);
  const p = winRate / 100;
  const q = 1 - p;
  return Math.max(0, (b * p - q) / b);
}

function fmt$(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Component ─────────────────────────────────────────────────────────────────

interface PositionSizerProps {
  accountSize?: number;
  winRatePct?: number;
  avgWinPct?: number;
  avgLossPct?: number;
  currentPrice?: number;
}

export function PositionSizer({
  accountSize: initAccount = 10000,
  winRatePct: initWR = 55,
  avgWinPct: initAW = 3,
  avgLossPct: initAL = 2,
  currentPrice: initPrice = 50000,
}: PositionSizerProps) {
  const [open, setOpen] = useState(false);
  const [method, setMethod]     = useState<SizingMethod>("risk_per_trade");
  const [account, setAccount]   = useState(initAccount);
  const [winRate, setWinRate]   = useState(initWR);
  const [avgWin, setAvgWin]     = useState(initAW);
  const [avgLoss, setAvgLoss]   = useState(initAL);
  const [riskPct, setRiskPct]   = useState(1.0);   // risk per trade %
  const [fixedPct, setFixedPct] = useState(10.0);  // fixed allocation %
  const [slPct, setSlPct]       = useState(2.0);   // stop loss %
  const [atr, setAtr]           = useState(1500);  // ATR in price units
  const [price, setPrice]       = useState(initPrice);
  const [atrMultiplier, setAtrMultiplier] = useState(2.0);

  // Kelly fraction
  const kelly = kellyFraction(winRate, avgWin, avgLoss);
  const halfKelly = kelly / 2;

  // Position size calculations
  let positionUsd = 0;
  let reasoning = "";

  switch (method) {
    case "fixed_pct":
      positionUsd = account * (fixedPct / 100);
      reasoning = `${fixedPct}% of $${fmt$(account)} account`;
      break;
    case "kelly":
      positionUsd = account * halfKelly;
      reasoning = `Half-Kelly: ${(halfKelly * 100).toFixed(1)}% (Full Kelly: ${(kelly * 100).toFixed(1)}%)`;
      break;
    case "risk_per_trade":
      positionUsd = account * (riskPct / 100) / (slPct / 100);
      reasoning = `Risk $${fmt$(account * riskPct / 100)} (${riskPct}%) with ${slPct}% stop`;
      break;
    case "volatility":
      positionUsd = (account * (riskPct / 100)) / (atr * atrMultiplier / price);
      reasoning = `ATR=${fmt$(atr)}, ${atrMultiplier}× ATR stop = ${((atr * atrMultiplier / price) * 100).toFixed(2)}% stop`;
      break;
  }

  positionUsd = Math.min(positionUsd, account); // never exceed account size
  const positionShares = price > 0 ? positionUsd / price : 0;
  const positionPct = (positionUsd / account) * 100;

  // Risk/reward
  const riskUsd   = method === "risk_per_trade" || method === "volatility"
    ? account * riskPct / 100
    : positionUsd * (slPct / 100);
  const rewardUsd = positionUsd * (avgWin / 100);
  const rrRatio   = riskUsd > 0 ? rewardUsd / riskUsd : 0;
  const ev        = (winRate / 100) * rewardUsd - (1 - winRate / 100) * riskUsd;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800/50 transition"
      >
        <span className="flex items-center gap-2">
          <span>📐</span>
          Position Sizer
        </span>
        <span className="text-zinc-600 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 p-3 space-y-3">
          {/* Method selector */}
          <div className="grid grid-cols-2 gap-1">
            {(Object.keys(METHOD_META) as SizingMethod[]).map((m) => (
              <button
                key={m}
                onClick={() => setMethod(m)}
                className={`px-2 py-1.5 rounded text-[10px] font-medium text-left transition border ${
                  method === m
                    ? "border-cyan-700 bg-cyan-950/40 text-cyan-300"
                    : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                }`}
              >
                {METHOD_META[m].label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-zinc-600">{METHOD_META[method].description}</p>

          {/* Common inputs */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-500 block mb-0.5">Account Size ($)</label>
              <input type="number" value={account} onChange={(e) => setAccount(+e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-cyan-600" />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 block mb-0.5">Asset Price ($)</label>
              <input type="number" value={price} onChange={(e) => setPrice(+e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-cyan-600" />
            </div>
          </div>

          {/* Method-specific inputs */}
          {method === "fixed_pct" && (
            <div>
              <label className="text-[10px] text-zinc-500 block mb-0.5">Allocation % of account</label>
              <input type="number" value={fixedPct} step={0.5} min={0.1} max={100} onChange={(e) => setFixedPct(+e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-cyan-600" />
            </div>
          )}

          {method === "kelly" && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-zinc-500 block mb-0.5">Win Rate %</label>
                <input type="number" value={winRate} step={1} min={1} max={99} onChange={(e) => setWinRate(+e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-cyan-600" />
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 block mb-0.5">Avg Win %</label>
                <input type="number" value={avgWin} step={0.1} min={0.1} onChange={(e) => setAvgWin(+e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-cyan-600" />
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 block mb-0.5">Avg Loss %</label>
                <input type="number" value={avgLoss} step={0.1} min={0.1} onChange={(e) => setAvgLoss(+e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-cyan-600" />
              </div>
            </div>
          )}

          {(method === "risk_per_trade") && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-zinc-500 block mb-0.5">Risk per Trade %</label>
                <input type="number" value={riskPct} step={0.1} min={0.1} max={10} onChange={(e) => setRiskPct(+e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-cyan-600" />
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 block mb-0.5">Stop Loss %</label>
                <input type="number" value={slPct} step={0.1} min={0.1} onChange={(e) => setSlPct(+e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-cyan-600" />
              </div>
            </div>
          )}

          {method === "volatility" && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-zinc-500 block mb-0.5">Risk % per trade</label>
                <input type="number" value={riskPct} step={0.1} min={0.1} max={10} onChange={(e) => setRiskPct(+e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-cyan-600" />
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 block mb-0.5">ATR ($)</label>
                <input type="number" value={atr} step={10} min={1} onChange={(e) => setAtr(+e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-cyan-600" />
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 block mb-0.5">ATR Mult (SL)</label>
                <input type="number" value={atrMultiplier} step={0.25} min={0.5} max={10} onChange={(e) => setAtrMultiplier(+e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-cyan-600" />
              </div>
            </div>
          )}

          {/* Results */}
          <div className="border-t border-zinc-800 pt-3 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-500">Position size</span>
              <span className="font-bold text-cyan-300">${fmt$(positionUsd)} ({positionPct.toFixed(1)}% of account)</span>
            </div>
            {price > 0 && (
              <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-500">Units / contracts</span>
                <span className="text-zinc-300">{positionShares.toFixed(6)}</span>
              </div>
            )}
            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-500">Max risk ($)</span>
              <span className="text-red-400">-${fmt$(riskUsd)}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-500">Target reward ($)</span>
              <span className="text-emerald-400">+${fmt$(rewardUsd)}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-500">R:R ratio</span>
              <span className={`font-semibold ${rrRatio >= 1.5 ? "text-emerald-400" : rrRatio >= 1.0 ? "text-yellow-400" : "text-red-400"}`}>
                1:{rrRatio.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-500">Expected value</span>
              <span className={`font-semibold ${ev >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {ev >= 0 ? "+" : ""}${fmt$(ev)}
              </span>
            </div>
            <div className="text-[10px] text-zinc-600">{reasoning}</div>
          </div>
        </div>
      )}
    </div>
  );
}
