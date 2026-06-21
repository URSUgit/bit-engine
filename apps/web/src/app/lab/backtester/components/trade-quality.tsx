"use client";

import { useMemo } from "react";
import type { BacktestResult } from "@/lib/backtest-api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface QualityDimension {
  label: string;
  score: number;       // 0-100
  detail: string;
  color: string;
}

interface QualityReport {
  overall: number;
  grade: string;
  gradeColor: string;
  dimensions: QualityDimension[];
  strengths: string[];
  weaknesses: string[];
}

// ── Score helpers ─────────────────────────────────────────────────────────────

function clamp(v: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(v: number, inLo: number, inHi: number, outLo = 0, outHi = 100): number {
  if (inHi === inLo) return v >= inHi ? outHi : outLo;
  return clamp(((v - inLo) / (inHi - inLo)) * (outHi - outLo) + outLo);
}

function gradeFor(score: number): { grade: string; color: string } {
  if (score >= 85) return { grade: "A", color: "#4ade80" };
  if (score >= 70) return { grade: "B", color: "#86efac" };
  if (score >= 55) return { grade: "C", color: "#facc15" };
  if (score >= 40) return { grade: "D", color: "#fb923c" };
  return { grade: "F", color: "#f87171" };
}

function dimColor(score: number): string {
  if (score >= 70) return "text-emerald-400";
  if (score >= 50) return "text-yellow-400";
  return "text-red-400";
}

function buildQualityReport(result: BacktestResult): QualityReport {
  const m = result.metrics;
  const trades = result.trades ?? [];
  const n = trades.length;

  // ── Dimension 1: Risk-adjusted return (Sharpe + Sortino)
  const sharpeScore = lerp(m.sharpe_ratio, 0, 3);
  const sortinoScore = m.sortino_ratio != null ? lerp(m.sortino_ratio, 0, 4) : sharpeScore;
  const riskAdjScore = clamp((sharpeScore + sortinoScore) / 2);

  // ── Dimension 2: Trade consistency (win rate + profit factor)
  const wrScore = lerp(m.win_rate_pct, 30, 70);
  const pfScore = lerp(m.profit_factor, 1, 3);
  const consistencyScore = clamp((wrScore + pfScore) / 2);

  // ── Dimension 3: Drawdown control
  const ddScore = lerp(-m.max_drawdown_pct, -50, -2);   // lower DD = higher score

  // ── Dimension 4: Trade frequency (not too few, not too many)
  // Sweet spot: ~20–200 trades per year
  const daysInBacktest = Math.max(1,
    (new Date(result.end_date).getTime() - new Date(result.start_date).getTime()) / 86400000,
  );
  const tradesPerYear = (n / daysInBacktest) * 365;
  let freqScore: number;
  if (tradesPerYear < 5) freqScore = lerp(tradesPerYear, 0, 5, 0, 50);
  else if (tradesPerYear <= 200) freqScore = lerp(tradesPerYear, 5, 200, 50, 100);
  else freqScore = lerp(tradesPerYear, 200, 1000, 100, 30);

  // ── Dimension 5: Return quality (CAGR vs max DD, Calmar)
  const calmarScore = lerp(m.calmar_ratio, 0, 3);

  // ── Dimension 6: Sample robustness (more trades = more statistically reliable)
  const sampleScore = lerp(n, 5, 100);

  // ── Dimension 7: Avg win/loss ratio
  const avgWin = m.avg_win_pct ?? (m.profit_factor > 1 ? m.avg_trade_pnl_pct * 2 : null);
  const avgLoss = m.avg_loss_pct ?? null;
  let wlRatioScore = 60;
  if (avgWin != null && avgLoss != null && avgLoss < 0) {
    const ratio = avgWin / Math.abs(avgLoss);
    wlRatioScore = lerp(ratio, 0.5, 3);
  }

  const dimensions: QualityDimension[] = [
    {
      label: "Risk-Adjusted Return",
      score: riskAdjScore,
      detail: `Sharpe ${m.sharpe_ratio.toFixed(2)} · Sortino ${(m.sortino_ratio ?? m.sharpe_ratio * 1.2).toFixed(2)}`,
      color: dimColor(riskAdjScore),
    },
    {
      label: "Trade Consistency",
      score: consistencyScore,
      detail: `Win Rate ${m.win_rate_pct.toFixed(1)}% · Profit Factor ${m.profit_factor.toFixed(2)}`,
      color: dimColor(consistencyScore),
    },
    {
      label: "Drawdown Control",
      score: ddScore,
      detail: `Max DD ${m.max_drawdown_pct.toFixed(1)}% · Calmar ${m.calmar_ratio.toFixed(2)}`,
      color: dimColor(ddScore),
    },
    {
      label: "Trade Frequency",
      score: freqScore,
      detail: `${n} trades · ${tradesPerYear.toFixed(0)}/year`,
      color: dimColor(freqScore),
    },
    {
      label: "Return Quality",
      score: calmarScore,
      detail: `CAGR ${m.cagr_pct.toFixed(1)}% · Calmar ${m.calmar_ratio.toFixed(2)}`,
      color: dimColor(calmarScore),
    },
    {
      label: "Statistical Confidence",
      score: sampleScore,
      detail: `${n} closed trades`,
      color: dimColor(sampleScore),
    },
    {
      label: "Win/Loss Ratio",
      score: wlRatioScore,
      detail: avgWin != null && avgLoss != null
        ? `Avg Win ${avgWin.toFixed(2)}% · Avg Loss ${avgLoss.toFixed(2)}%`
        : `Avg trade ${m.avg_trade_pnl_pct.toFixed(2)}%`,
      color: dimColor(wlRatioScore),
    },
  ];

  const overall = Math.round(
    dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length,
  );

  const { grade, color: gradeColor } = gradeFor(overall);

  // Strengths and weaknesses
  const sorted = [...dimensions].sort((a, b) => b.score - a.score);
  const strengths = sorted.filter((d) => d.score >= 70).slice(0, 3).map((d) => d.label);
  const weaknesses = sorted.filter((d) => d.score < 50).slice(-3).map((d) => d.label);

  return { overall, grade, gradeColor, dimensions, strengths, weaknesses };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoreBar({ score, color }: { score: number; color: string }) {
  const barColor =
    score >= 70 ? "#4ade80" : score >= 50 ? "#facc15" : "#f87171";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${score}%`, background: barColor }}
        />
      </div>
      <span className={`text-xs font-bold font-mono w-8 text-right ${color}`}>
        {score.toFixed(0)}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface TradeQualityProps {
  result: BacktestResult;
}

export function TradeQuality({ result }: TradeQualityProps) {
  const report = useMemo(() => buildQualityReport(result), [result]);

  return (
    <div className="space-y-4">
      {/* Overall grade */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 flex items-center gap-5">
        <div className="text-center min-w-[80px]">
          <div
            className="text-6xl font-black font-mono"
            style={{ color: report.gradeColor }}
          >
            {report.grade}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5 uppercase tracking-wide">Overall Grade</div>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex-1 h-3 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${report.overall}%`,
                  background: `linear-gradient(90deg, ${report.gradeColor}80, ${report.gradeColor})`,
                }}
              />
            </div>
            <span className="text-2xl font-bold font-mono" style={{ color: report.gradeColor }}>
              {report.overall}
            </span>
            <span className="text-zinc-500 text-sm">/100</span>
          </div>
          <p className="text-xs text-zinc-400">
            Quality score across 7 dimensions: risk-adjusted return, consistency, drawdown control,
            trade frequency, return quality, statistical confidence, and win/loss ratio.
          </p>
        </div>
      </div>

      {/* Dimensions */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-zinc-300">Score Breakdown</h3>
        {report.dimensions.map((d) => (
          <div key={d.label}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs text-zinc-300">{d.label}</span>
              <span className="text-[11px] text-zinc-500">{d.detail}</span>
            </div>
            <ScoreBar score={d.score} color={d.color} />
          </div>
        ))}
      </div>

      {/* Strengths & weaknesses */}
      <div className="grid grid-cols-2 gap-3">
        {report.strengths.length > 0 && (
          <div className="bg-emerald-950/20 border border-emerald-800/40 rounded-xl p-4">
            <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-widest mb-2">Strengths</h4>
            <ul className="space-y-1.5">
              {report.strengths.map((s) => (
                <li key={s} className="flex gap-1.5 text-xs text-emerald-300">
                  <span className="text-emerald-500 flex-shrink-0">✓</span> {s}
                </li>
              ))}
            </ul>
          </div>
        )}
        {report.weaknesses.length > 0 && (
          <div className="bg-red-950/20 border border-red-800/40 rounded-xl p-4">
            <h4 className="text-xs font-semibold text-red-400 uppercase tracking-widest mb-2">Areas to Improve</h4>
            <ul className="space-y-1.5">
              {report.weaknesses.map((w) => (
                <li key={w} className="flex gap-1.5 text-xs text-red-300">
                  <span className="text-red-500 flex-shrink-0">!</span> {w}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Grade scale legend */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
        <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Grade Scale</h4>
        <div className="flex gap-3 flex-wrap">
          {[
            { grade: "A", range: "85–100", color: "#4ade80", desc: "Institutional quality" },
            { grade: "B", range: "70–84", color: "#86efac", desc: "Professional grade" },
            { grade: "C", range: "55–69", color: "#facc15", desc: "Viable, improvable" },
            { grade: "D", range: "40–54", color: "#fb923c", desc: "Needs work" },
            { grade: "F", range: "0–39", color: "#f87171", desc: "Not deployable" },
          ].map((g) => (
            <div key={g.grade} className="flex items-center gap-1.5 text-xs">
              <span className="font-bold text-sm" style={{ color: g.color }}>{g.grade}</span>
              <span className="text-zinc-500">{g.range} — {g.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
