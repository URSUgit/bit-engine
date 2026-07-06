"use client";

import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, ResponsiveContainer, Legend, Tooltip,
} from "recharts";
import type { BacktestResult } from "@/lib/backtest-api";

// ── Normalizers ───────────────────────────────────────────────────────────────
// Each dimension maps a raw metric to [0, 100] where 100 = excellent

function normSharpe(v: number): number {
  // <0 = 0, 0-0.5 = 0-25, 0.5-1 = 25-50, 1-2 = 50-75, 2-3 = 75-100
  if (v < 0) return 0;
  if (v < 1) return Math.round(v * 50);
  if (v < 2) return Math.round(50 + (v - 1) * 25);
  return Math.min(100, Math.round(75 + (v - 2) * 25));
}

function normReturn(v: number): number {
  // Annualised return: < 0 = 0, 0-10% = 0-30, 10-50% = 30-70, 50-100% = 70-90, >100% = 90-100
  if (v < 0) return 0;
  if (v < 10) return Math.round((v / 10) * 30);
  if (v < 50) return Math.round(30 + ((v - 10) / 40) * 40);
  if (v < 100) return Math.round(70 + ((v - 50) / 50) * 20);
  return Math.min(100, Math.round(90 + (v - 100) / 10));
}

function normDrawdown(v: number): number {
  // Lower drawdown = better. DD < 5% = 100, 5-15% = 70-100, 15-30% = 30-70, >50% = 0
  if (v <= 5) return 100;
  if (v <= 15) return Math.round(100 - (v - 5) * 3);
  if (v <= 30) return Math.round(70 - (v - 15) * (40 / 15));
  if (v <= 50) return Math.round(30 - (v - 30) * 1.5);
  return 0;
}

function normWinRate(v: number): number {
  // 50% = 40, 60% = 70, 70% = 90, 80%+ = 100
  if (v < 40) return 0;
  if (v < 50) return Math.round((v - 40) * 4);
  if (v < 60) return Math.round(40 + (v - 50) * 3);
  if (v < 70) return Math.round(70 + (v - 60) * 2);
  if (v < 80) return Math.round(90 + (v - 70));
  return 100;
}

function normProfitFactor(v: number): number {
  // <1 = 0, 1-1.5 = 0-40, 1.5-2 = 40-70, 2-3 = 70-90, >3 = 90-100
  if (v < 1) return 0;
  if (v < 1.5) return Math.round((v - 1) / 0.5 * 40);
  if (v < 2)   return Math.round(40 + (v - 1.5) / 0.5 * 30);
  if (v < 3)   return Math.round(70 + (v - 2) * 20);
  return Math.min(100, Math.round(90 + (v - 3) * 10));
}

function normConsistency(trades: number, winRate: number, avgDuration: number): number {
  // Combined: trade count (more = more data = more reliable) + low stddev proxy
  let score = 0;
  if (trades >= 10) score += 20;
  if (trades >= 30) score += 20;
  if (trades >= 100) score += 20;
  // More active trading = higher consistency signal
  if (winRate >= 50 && winRate <= 70) score += 20; // realistic win rate band
  if (avgDuration >= 1 && avgDuration <= 50) score += 20;
  return Math.min(100, score);
}

// ── Types ─────────────────────────────────────────────────────────────────────

type RadarDatum = {
  axis: string;
  score: number;
  benchmark?: number;
};

// ── Component ─────────────────────────────────────────────────────────────────

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const color =
    score >= 75 ? "#4ade80" :
    score >= 50 ? "#facc15" :
    score >= 25 ? "#fb923c" : "#f87171";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-14 h-14">
        <svg viewBox="0 0 56 56" className="w-full h-full">
          <circle cx="28" cy="28" r="24" fill="none" stroke="#1f2937" strokeWidth="5" />
          <circle
            cx="28" cy="28" r="24"
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeDasharray={`${(score / 100) * 150.8} 150.8`}
            strokeLinecap="round"
            transform="rotate(-90 28 28)"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-zinc-200">
          {score}
        </span>
      </div>
      <span className="text-[10px] text-zinc-500 text-center leading-tight max-w-[60px]">{label}</span>
    </div>
  );
}

interface StrategyRadarProps {
  result: BacktestResult;
}

export function StrategyRadar({ result }: StrategyRadarProps) {
  const m = result.metrics;
  const b = result.benchmark?.metrics;

  const sharpeScore      = normSharpe(m.sharpe_ratio);
  const returnScore      = normReturn(m.cagr_pct ?? m.total_return_pct);
  const drawdownScore    = normDrawdown(m.max_drawdown_pct);
  const winRateScore     = normWinRate(m.win_rate_pct);
  const pfScore          = normProfitFactor(m.profit_factor);
  const consistencyScore = normConsistency(m.total_trades, m.win_rate_pct, m.avg_trade_duration_bars);

  const overallScore = Math.round(
    (sharpeScore * 0.25 + returnScore * 0.2 + drawdownScore * 0.2 + winRateScore * 0.1 + pfScore * 0.15 + consistencyScore * 0.1)
  );

  const data: RadarDatum[] = [
    { axis: "Return",      score: returnScore,      benchmark: b ? normReturn(b.cagr_pct ?? b.total_return_pct) : undefined },
    { axis: "Risk-Adj",    score: sharpeScore,       benchmark: b ? normSharpe(b.sharpe_ratio) : undefined },
    { axis: "Drawdown",    score: drawdownScore,     benchmark: b ? normDrawdown(b.max_drawdown_pct) : undefined },
    { axis: "Win Rate",    score: winRateScore,      benchmark: b ? normWinRate(b.win_rate_pct) : undefined },
    { axis: "Edge",        score: pfScore,           benchmark: b ? normProfitFactor(b.profit_factor) : undefined },
    { axis: "Consistency", score: consistencyScore,  benchmark: undefined },
  ];

  const overallColor =
    overallScore >= 70 ? "text-emerald-400" :
    overallScore >= 50 ? "text-yellow-400" :
    overallScore >= 30 ? "text-orange-400" : "text-red-400";

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h3 className="font-semibold text-zinc-100">Strategy Profile</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            {result.strategy} · {result.symbol} · {result.interval}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className={`text-2xl font-black ${overallColor}`}>{overallScore}</div>
            <div className="text-[10px] text-zinc-600 uppercase tracking-wide">Overall</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Radar chart */}
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data}>
              <PolarGrid stroke="#27272a" />
              <PolarAngleAxis dataKey="axis" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              {b && (
                <Radar
                  name="Buy & Hold"
                  dataKey="benchmark"
                  stroke="rgba(161,161,170,0.5)"
                  fill="rgba(161,161,170,0.1)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
              )}
              <Radar
                name={result.strategy}
                dataKey="score"
                stroke="#06b6d4"
                fill="rgba(6,182,212,0.15)"
                strokeWidth={2}
              />
              {b && <Legend wrapperStyle={{ fontSize: 11 }} />}
              <Tooltip
                contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", fontSize: 11 }}
                formatter={(v, name) => [`${v}/100`, String(name)]}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Score gauges */}
        <div className="flex flex-col gap-3">
          <div className="flex justify-around">
            <ScoreGauge score={returnScore}   label="Return" />
            <ScoreGauge score={sharpeScore}   label="Risk-Adj" />
            <ScoreGauge score={drawdownScore} label="Drawdown" />
          </div>
          <div className="flex justify-around">
            <ScoreGauge score={winRateScore}     label="Win Rate" />
            <ScoreGauge score={pfScore}          label="Edge" />
            <ScoreGauge score={consistencyScore} label="Consistency" />
          </div>
          {/* Strengths / weaknesses summary */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded p-2.5 space-y-1">
            {[
              { label: "Return", score: returnScore },
              { label: "Risk-Adj", score: sharpeScore },
              { label: "Drawdown", score: drawdownScore },
              { label: "Win Rate", score: winRateScore },
              { label: "Edge", score: pfScore },
              { label: "Consistency", score: consistencyScore },
            ]
              .sort((a, b) => b.score - a.score)
              .slice(0, 2)
              .map(({ label, score }) => (
                <div key={label} className="flex items-center gap-2 text-[11px]">
                  <span className="text-emerald-400">✓</span>
                  <span className="text-zinc-300">{label}</span>
                  <span className="text-zinc-600">strongest dimension ({score}/100)</span>
                </div>
              ))}
            {[
              { label: "Return", score: returnScore },
              { label: "Risk-Adj", score: sharpeScore },
              { label: "Drawdown", score: drawdownScore },
              { label: "Win Rate", score: winRateScore },
              { label: "Edge", score: pfScore },
              { label: "Consistency", score: consistencyScore },
            ]
              .sort((a, b) => a.score - b.score)
              .slice(0, 1)
              .map(({ label, score }) => (
                <div key={label} className="flex items-center gap-2 text-[11px]">
                  <span className="text-amber-400">↓</span>
                  <span className="text-zinc-300">{label}</span>
                  <span className="text-zinc-600">weakest dimension ({score}/100)</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
