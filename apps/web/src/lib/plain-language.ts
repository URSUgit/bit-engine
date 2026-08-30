export type Tone = "good" | "neutral" | "bad";

export interface WordsResult {
  label: string;
  tone: Tone;
}

/** Thresholds mirror PerformanceRating in lab/backtester/components/results.tsx */
export function sharpeToWords(sharpe: number | null | undefined): WordsResult {
  if (sharpe == null) return { label: "No data", tone: "neutral" };
  if (sharpe >= 2) return { label: "Excellent risk-adjusted returns", tone: "good" };
  if (sharpe >= 1) return { label: "Good risk-adjusted returns", tone: "good" };
  if (sharpe >= 0) return { label: "Modest risk-adjusted returns", tone: "neutral" };
  return { label: "Poor risk-adjusted returns", tone: "bad" };
}

export function drawdownToWords(pctAbs: number | null | undefined): WordsResult {
  if (pctAbs == null) return { label: "No data", tone: "neutral" };
  const v = Math.abs(pctAbs);
  if (v <= 10) return { label: "Low risk of loss", tone: "good" };
  if (v <= 25) return { label: "Moderate risk of loss", tone: "neutral" };
  return { label: "High risk of loss", tone: "bad" };
}

export function winRateToWords(pct: number | null | undefined): WordsResult {
  if (pct == null) return { label: "No data", tone: "neutral" };
  if (pct >= 55) return { label: "Wins more often than it loses", tone: "good" };
  if (pct >= 45) return { label: "Wins about as often as it loses", tone: "neutral" };
  return { label: "Loses more often than it wins", tone: "bad" };
}

export function confidenceToWords(value: number | null | undefined): WordsResult {
  if (value == null) return { label: "Unknown confidence", tone: "neutral" };
  if (value >= 0.8) return { label: "High confidence", tone: "good" };
  if (value >= 0.6) return { label: "Medium confidence", tone: "neutral" };
  return { label: "Low confidence", tone: "bad" };
}
