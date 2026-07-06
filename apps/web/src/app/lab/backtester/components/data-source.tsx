"use client";

// Shared provenance helpers for cached market data. A series' `source` is the
// label written into the bar cache when it was fetched/seeded:
//   "coinmetrics"     → real daily reference-rate data (GitHub-hosted)
//   "binance"         → real exchange klines
//   "yahoo" / "stooq" / "kraken" → real market data from those providers
//   "synthetic_gbm"   → generated GBM demo bars (NOT real market data)
//   null              → unknown (legacy rows cached before provenance tracking)

export type Provenance = {
  label: string;       // human label, e.g. "Coin Metrics"
  isReal: boolean;     // true for any genuine market source
  isSynthetic: boolean;
  tone: "real" | "synthetic" | "unknown";
};

const SOURCE_LABELS: Record<string, string> = {
  coinmetrics: "Coin Metrics",
  binance: "Binance",
  yahoo: "Yahoo Finance",
  stooq: "Stooq",
  kraken: "Kraken",
  synthetic_gbm: "Synthetic (GBM)",
};

export function describeSource(source: string | null | undefined): Provenance {
  if (!source) {
    return { label: "Unknown", isReal: false, isSynthetic: false, tone: "unknown" };
  }
  const isSynthetic = source === "synthetic_gbm";
  return {
    label: SOURCE_LABELS[source] ?? source,
    isReal: !isSynthetic,
    isSynthetic,
    tone: isSynthetic ? "synthetic" : "real",
  };
}

export function SourceBadge({ source }: { source: string | null | undefined }) {
  const p = describeSource(source);
  const cls =
    p.tone === "real"
      ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
      : p.tone === "synthetic"
        ? "bg-amber-950/40 border-amber-800/50 text-amber-300"
        : "bg-zinc-800/40 border-zinc-700/50 text-zinc-400";
  const tag = p.tone === "real" ? "REAL" : p.tone === "synthetic" ? "SYNTHETIC" : "?";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-medium ${cls}`}>
      <span className="font-bold tracking-wide">{tag}</span>
      <span className="opacity-80">· {p.label}</span>
    </span>
  );
}
