export type GlossaryTerm = "sharpe" | "drawdown" | "slippage" | "winRate" | "confidence" | "sentiment";

export const GLOSSARY: Record<GlossaryTerm, { term: string; definition: string }> = {
  sharpe: {
    term: "Sharpe Ratio",
    definition: "How much return a strategy makes for the risk it takes. Higher is better — above 1 is generally considered good.",
  },
  drawdown: {
    term: "Max Drawdown",
    definition: "The biggest drop from a peak to a low point. Smaller (closer to 0%) means a smoother ride.",
  },
  slippage: {
    term: "Slippage",
    definition: "The small difference between the price you expect and the price you actually get when a trade executes.",
  },
  winRate: {
    term: "Win Rate",
    definition: "The percentage of trades that ended in a profit.",
  },
  confidence: {
    term: "Confidence",
    definition: "How strongly the signal's underlying data supports this call. Higher means the signal is more reliable.",
  },
  sentiment: {
    term: "Sentiment",
    definition: "Whether people are talking about this asset positively or negatively right now, based on news and social media.",
  },
};
