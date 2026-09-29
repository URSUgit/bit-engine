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

// A feed more than this many days behind is reported as stale. Crypto trades
// continuously, so a daily series should never be more than a day or two back;
// three days allows for a late publish without crying wolf.
export const STALE_AFTER_DAYS = 3;

export type Freshness = {
  ageDays: number;
  isStale: boolean;
  latestDate: string;   // YYYY-MM-DD of the newest bar
  ageLabel: string;     // "today" | "yesterday" | "N days ago"
};

/** How current the newest bar is. `latestTs` is unix *seconds*. */
export function describeFreshness(latestTs: number | null | undefined): Freshness | null {
  if (!latestTs) return null;
  const latest = new Date(latestTs * 1000);
  const ageDays = Math.floor((Date.now() - latest.getTime()) / 86_400_000);
  return {
    ageDays,
    isStale: ageDays > STALE_AFTER_DAYS,
    latestDate: latest.toISOString().slice(0, 10),
    ageLabel: ageDays <= 0 ? "today" : ageDays === 1 ? "yesterday" : `${ageDays} days ago`,
  };
}

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

// Banner for backtest results: loud warning when the underlying series is
// synthetic GBM, quiet confirmation when it's a real market source, nothing
// when provenance is unknown (results cached before tracking existed).
export function DataProvenanceBanner({
  source,
  isSynthetic,
  symbol,
  interval,
  latestTs,
}: {
  source: string | null | undefined;
  isSynthetic: boolean | undefined;
  symbol: string;
  interval: string;
  latestTs?: number | null;
}) {
  const freshness = describeFreshness(latestTs);

  if (isSynthetic) {
    return (
      <div className="mb-3 bg-amber-950/40 border border-amber-700/60 rounded-lg px-4 py-2.5 flex items-start gap-3">
        <span className="text-amber-400 text-base leading-none mt-0.5">⚠</span>
        <div className="text-xs text-amber-200/90 leading-relaxed">
          <strong className="text-amber-300">Synthetic data.</strong> This backtest ran on generated
          GBM demo bars for <span className="font-mono">{symbol} {interval}</span> — results do not
          reflect real market behavior. Real daily history is available: switch the interval to{" "}
          <span className="font-mono">1d</span> or import real data in the <strong>Data</strong> tab.
        </div>
      </div>
    );
  }
  // Real data, but the feed has stopped updating. Worth a loud warning rather
  // than a quiet chip: the REAL badge actively vouches for the numbers, so a
  // feed that silently ended months ago misleads more than synthetic data does.
  // Anything the user asked for after `latestDate` simply isn't in the result.
  if (source && freshness?.isStale) {
    return (
      <div className="mb-3 bg-amber-950/40 border border-amber-700/60 rounded-lg px-4 py-2.5 flex items-start gap-3">
        <span className="text-amber-400 text-base leading-none mt-0.5">⚠</span>
        <div className="text-xs text-amber-200/90 leading-relaxed">
          <strong className="text-amber-300">Stale data feed.</strong> This is real{" "}
          {describeSource(source).label} data, but its newest bar for{" "}
          <span className="font-mono">{symbol} {interval}</span> is{" "}
          <span className="font-mono">{freshness.latestDate}</span> — {freshness.ageLabel}. Any period
          you asked for after that date is missing from this result, so recent performance is not
          covered.
        </div>
      </div>
    );
  }

  if (source) {
    return (
      <div className="mb-3 flex items-center gap-2 text-[11px] text-zinc-500">
        <SourceBadge source={source} />
        <span>
          backtest computed on {describeSource(source).label} data
          {freshness ? ` · latest bar ${freshness.latestDate} (${freshness.ageLabel})` : ""}
        </span>
      </div>
    );
  }
  return null;
}
