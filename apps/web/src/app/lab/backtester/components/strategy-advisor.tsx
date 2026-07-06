"use client";

import { useMemo } from "react";
import type { BacktestResult } from "@/lib/backtest-api";

// ── Types ─────────────────────────────────────────────────────────────────────

type Severity = "critical" | "warning" | "info" | "good";

interface Finding {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  action?: string;
}

// ── Analysis engine ───────────────────────────────────────────────────────────

function analyze(result: BacktestResult): Finding[] {
  const m = result.metrics;
  const trades = result.trades;
  const n = trades.length;
  const findings: Finding[] = [];

  // ── Sample size
  if (n < 10) {
    findings.push({
      id: "sample_tiny",
      severity: "critical",
      category: "Statistical Reliability",
      title: "Insufficient sample size",
      detail: `Only ${n} trades were recorded. Statistical conclusions from this backtest are unreliable — you'd need at least 30–50 to draw meaningful conclusions.`,
      action: "Extend the backtest period, lower the interval (e.g., 1h → 15m), or select a more active strategy.",
    });
  } else if (n < 30) {
    findings.push({
      id: "sample_small",
      severity: "warning",
      category: "Statistical Reliability",
      title: "Small sample size",
      detail: `${n} trades provides limited statistical power. Results may not be representative of true strategy behavior.`,
      action: "Run over a longer period to increase the trade count to 50+.",
    });
  } else if (n >= 100) {
    findings.push({
      id: "sample_good",
      severity: "good",
      category: "Statistical Reliability",
      title: "Sufficient sample size",
      detail: `${n} trades provides good statistical power for reliable conclusions.`,
    });
  }

  // ── Sharpe ratio
  if (m.sharpe_ratio < 0) {
    findings.push({
      id: "sharpe_negative",
      severity: "critical",
      category: "Risk-Adjusted Return",
      title: "Negative Sharpe ratio",
      detail: `Sharpe of ${m.sharpe_ratio.toFixed(2)} means you're taking on risk without commensurate return. A risk-free asset would outperform this strategy.`,
      action: "Consider abandoning this configuration. Try different parameters or a different strategy entirely.",
    });
  } else if (m.sharpe_ratio < 0.5) {
    findings.push({
      id: "sharpe_low",
      severity: "warning",
      category: "Risk-Adjusted Return",
      title: "Low Sharpe ratio",
      detail: `Sharpe of ${m.sharpe_ratio.toFixed(2)} indicates poor risk-adjusted performance. Most institutional benchmarks require Sharpe > 1.`,
      action: "Look for ways to reduce volatility (tighter stops) or increase average win size (better take-profit placement).",
    });
  } else if (m.sharpe_ratio >= 1.5) {
    findings.push({
      id: "sharpe_good",
      severity: "good",
      category: "Risk-Adjusted Return",
      title: "Strong Sharpe ratio",
      detail: `Sharpe of ${m.sharpe_ratio.toFixed(2)} indicates excellent risk-adjusted performance. This surpasses most professional benchmarks.`,
    });
  }

  // ── Max drawdown
  if (m.max_drawdown_pct < -30) {
    findings.push({
      id: "dd_severe",
      severity: "critical",
      category: "Drawdown Risk",
      title: "Severe maximum drawdown",
      detail: `Max drawdown of ${m.max_drawdown_pct.toFixed(1)}% would require a ${(100 / (1 + m.max_drawdown_pct / 100) - 100).toFixed(1)}% gain just to recover. Most traders cannot psychologically hold through this.`,
      action: "Reduce leverage, add hard stop-loss rules, or use a smaller position size. Target max drawdown < 20%.",
    });
  } else if (m.max_drawdown_pct < -15) {
    findings.push({
      id: "dd_moderate",
      severity: "warning",
      category: "Drawdown Risk",
      title: "Moderate drawdown",
      detail: `Max drawdown of ${m.max_drawdown_pct.toFixed(1)}%. Acceptable for aggressive strategies but challenging for most traders.`,
      action: "Consider adding a portfolio-level stop to pause trading after X% drawdown.",
    });
  } else {
    findings.push({
      id: "dd_good",
      severity: "good",
      category: "Drawdown Risk",
      title: "Controlled drawdown",
      detail: `Max drawdown of ${m.max_drawdown_pct.toFixed(1)}% is well-controlled and manageable for most risk profiles.`,
    });
  }

  // ── Win rate vs profit factor
  const winRatePct = m.win_rate_pct;
  const pf = m.profit_factor;

  if (winRatePct < 40 && pf < 1.2) {
    findings.push({
      id: "wr_pf_bad",
      severity: "critical",
      category: "Trade Quality",
      title: "Low win rate and profit factor",
      detail: `Win rate of ${winRatePct.toFixed(1)}% combined with profit factor ${pf.toFixed(2)} indicates this strategy loses more than it wins and doesn't make up for it in size.`,
      action: "Add confirmation filters to reduce false signals, or widen take-profit targets.",
    });
  } else if (winRatePct < 40 && pf >= 2.0) {
    findings.push({
      id: "wr_low_pf_high",
      severity: "info",
      category: "Trade Quality",
      title: "Low win rate, high reward-to-risk",
      detail: `Win rate ${winRatePct.toFixed(1)}% but profit factor ${pf.toFixed(2)} — this is a trend-following profile. Losses are frequent but winners are large. Psychologically challenging.`,
      action: "Ensure your position sizing accounts for long losing streaks. Consider Kelly sizing to be no more than half-Kelly.",
    });
  } else if (winRatePct > 70 && pf < 1.3) {
    findings.push({
      id: "wr_high_pf_low",
      severity: "warning",
      category: "Trade Quality",
      title: "High win rate, low profit factor",
      detail: `Win rate ${winRatePct.toFixed(1)}% but profit factor ${pf.toFixed(2)} — wins are frequent but small; losses may be large. This is a common pattern in strategies without proper stop-losses.`,
      action: "Review your exit logic. Add a hard stop-loss to cap the size of losses. Target profit factor > 1.5.",
    });
  }

  // ── Calmar ratio
  if (m.calmar_ratio > 2) {
    findings.push({
      id: "calmar_good",
      severity: "good",
      category: "Return Quality",
      title: "Excellent Calmar ratio",
      detail: `Calmar of ${m.calmar_ratio.toFixed(2)} indicates CAGR is more than 2x the max drawdown — strong return per unit of drawdown risk.`,
    });
  } else if (m.calmar_ratio < 0.5 && m.calmar_ratio > 0) {
    findings.push({
      id: "calmar_low",
      severity: "warning",
      category: "Return Quality",
      title: "Low Calmar ratio",
      detail: `Calmar of ${m.calmar_ratio.toFixed(2)} means the CAGR barely compensates for the drawdown risk. You're not being paid enough for the risk you're taking.`,
      action: "Either reduce drawdown (smaller position size, tighter stops) or find ways to increase CAGR (more frequent signals).",
    });
  }

  // ── Trade frequency
  const daysInBacktest = Math.max(1,
    (new Date(result.end_date).getTime() - new Date(result.start_date).getTime()) / 86400000
  );
  const tradesPerYear = (n / daysInBacktest) * 365;

  if (tradesPerYear < 5) {
    findings.push({
      id: "freq_too_low",
      severity: "warning",
      category: "Trade Frequency",
      title: "Very low trade frequency",
      detail: `~${tradesPerYear.toFixed(1)} trades/year. At this frequency, you're relying heavily on a small number of events. Compounding is slow and statistical significance is very hard to achieve.`,
      action: "Try a shorter timeframe or a more active strategy variant.",
    });
  } else if (tradesPerYear > 500) {
    findings.push({
      id: "freq_too_high",
      severity: "warning",
      category: "Trade Frequency",
      title: "Very high trade frequency",
      detail: `~${tradesPerYear.toFixed(0)} trades/year. At this frequency, transaction costs dominate. Even small commission/slippage increases can eliminate the edge.`,
      action: "Check the Breakeven tab to see what cost level makes the strategy unprofitable.",
    });
  }

  // ── Return vs benchmark
  const bm = result.benchmark_metrics;
  if (bm) {
    const alphaPct = m.total_return_pct - bm.total_return_pct;
    if (alphaPct < -5) {
      findings.push({
        id: "underperform_bm",
        severity: "warning",
        category: "Benchmark Comparison",
        title: "Underperforms buy-and-hold",
        detail: `Strategy returned ${m.total_return_pct.toFixed(1)}% vs. buy-and-hold ${bm.total_return_pct.toFixed(1)}% — a ${Math.abs(alphaPct).toFixed(1)}% shortfall. The strategy takes on active risk without reward.`,
        action: "Only active strategies that consistently beat buy-and-hold justify the operational complexity and transaction costs.",
      });
    } else if (alphaPct > 10) {
      findings.push({
        id: "outperform_bm",
        severity: "good",
        category: "Benchmark Comparison",
        title: "Strong outperformance vs. buy-and-hold",
        detail: `Strategy generated +${alphaPct.toFixed(1)}% alpha vs. buy-and-hold. This outperformance more than justifies active trading.`,
      });
    }
  }

  // ── Friction (if available)
  const fb = result.friction_breakdown;
  if (fb && fb.total_usd > 0 && m.final_equity > 0) {
    const frictionPct = (fb.total_usd / m.initial_capital) * 100;
    if (frictionPct > m.total_return_pct * 0.3) {
      findings.push({
        id: "high_friction",
        severity: "warning",
        category: "Transaction Costs",
        title: "High friction relative to returns",
        detail: `Total friction ($${fb.total_usd.toFixed(0)}) consumes ${((fb.total_usd / Math.max(1, (m.final_equity - m.initial_capital))) * 100).toFixed(1)}% of gross profit. This reduces the live-trading edge significantly.`,
        action: "Use limit orders (maker) where possible, avoid strategies with very high trade frequency, negotiate lower fees with your exchange.",
      });
    }
  }

  // ── Avg trade duration
  const avgBars = m.avg_trade_duration_bars ?? 0;
  if (avgBars > 0 && avgBars < 2) {
    findings.push({
      id: "holding_too_short",
      severity: "info",
      category: "Trade Duration",
      title: "Very short average holding period",
      detail: `Average trade duration < 2 bars. At this speed, latency and execution quality are critical. Slippage and commissions may erode the edge significantly.`,
      action: "Run the Breakeven Analysis to understand your cost tolerance. Consider adding a minimum hold time filter.",
    });
  }

  return findings;
}

// ── Component ─────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<Severity, { color: string; bg: string; border: string; icon: string; label: string }> = {
  critical: { color: "text-red-300", bg: "bg-red-950/30", border: "border-red-800/50", icon: "✖", label: "Critical" },
  warning:  { color: "text-yellow-300", bg: "bg-yellow-950/20", border: "border-yellow-800/40", icon: "!", label: "Warning" },
  info:     { color: "text-blue-300", bg: "bg-blue-950/20", border: "border-blue-800/40", icon: "i", label: "Info" },
  good:     { color: "text-emerald-300", bg: "bg-emerald-950/20", border: "border-emerald-800/40", icon: "✓", label: "Good" },
};

export function StrategyAdvisor({ result }: { result: BacktestResult }) {
  const findings = useMemo(() => analyze(result), [result]);

  const criticals = findings.filter((f) => f.severity === "critical");
  const warnings = findings.filter((f) => f.severity === "warning");
  const goods = findings.filter((f) => f.severity === "good");
  const infos = findings.filter((f) => f.severity === "info");

  const deployReadiness =
    criticals.length > 0
      ? { label: "Not Deploy-Ready", color: "text-red-400", bg: "bg-red-950/30 border-red-700/50" }
      : warnings.length > 2
      ? { label: "Use With Caution", color: "text-yellow-400", bg: "bg-yellow-950/20 border-yellow-700/40" }
      : warnings.length > 0
      ? { label: "Conditionally Ready", color: "text-cyan-400", bg: "bg-cyan-950/20 border-cyan-700/40" }
      : { label: "Deploy-Ready", color: "text-emerald-400", bg: "bg-emerald-950/20 border-emerald-700/40" };

  return (
    <div className="space-y-4">
      {/* Deploy readiness banner */}
      <div className={`border rounded-xl p-4 flex items-center gap-4 ${deployReadiness.bg}`}>
        <div className="text-4xl">
          {criticals.length > 0 ? "✖" : warnings.length > 2 ? "⚠" : warnings.length > 0 ? "~" : "✓"}
        </div>
        <div>
          <p className={`text-lg font-bold ${deployReadiness.color}`}>{deployReadiness.label}</p>
          <p className="text-xs text-zinc-400 mt-0.5">
            {criticals.length} critical issue{criticals.length !== 1 ? "s" : ""} ·{" "}
            {warnings.length} warning{warnings.length !== 1 ? "s" : ""} ·{" "}
            {goods.length} strength{goods.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Findings grouped by severity */}
      {(["critical", "warning", "info", "good"] as Severity[]).map((sev) => {
        const sevFindings = findings.filter((f) => f.severity === sev);
        if (!sevFindings.length) return null;
        const cfg = SEVERITY_CONFIG[sev];
        return (
          <div key={sev}>
            <h3 className={`text-xs font-semibold uppercase tracking-widest mb-2 ${cfg.color}`}>
              {cfg.label}s ({sevFindings.length})
            </h3>
            <div className="space-y-2">
              {sevFindings.map((f) => (
                <div
                  key={f.id}
                  className={`border rounded-xl p-4 ${cfg.bg} ${cfg.border}`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`text-sm font-bold ${cfg.color} mt-0.5 w-5 flex-shrink-0`}>
                      {cfg.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-semibold ${cfg.color}`}>{f.title}</span>
                        <span className="text-[10px] text-zinc-600 border border-zinc-800 rounded px-1.5 py-0.5 uppercase tracking-wide">
                          {f.category}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-1">{f.detail}</p>
                      {f.action && (
                        <p className="text-xs mt-1.5 text-zinc-300">
                          <span className="text-zinc-500 mr-1">→</span>
                          {f.action}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {findings.length === 0 && (
        <div className="text-center text-zinc-500 py-10">No findings generated.</div>
      )}

      {/* Disclaimer */}
      <p className="text-[10px] text-zinc-600 text-center">
        Advisor findings are algorithmic heuristics based on common quantitative trading principles.
        They do not constitute financial advice.
      </p>
    </div>
  );
}
