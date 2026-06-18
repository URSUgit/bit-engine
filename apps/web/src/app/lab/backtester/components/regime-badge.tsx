"use client";

import { useEffect, useState } from "react";

type Regime = "bull_trend" | "bear_trend" | "ranging" | "high_vol" | "low_vol" | "unknown";

type RegimeResponse = {
  symbol: string;
  regime: Regime;
  adx: number | null;
  ema_slope: string | null;
  atr_percentile: number | null;
  description: string;
};

const REGIME_META: Record<Regime, { label: string; color: string; icon: string; description: string }> = {
  bull_trend: { label: "Bull Trend",  color: "text-emerald-300 bg-emerald-950/50 border-emerald-800", icon: "↗", description: "Strong uptrend — trend-following strategies favored" },
  bear_trend: { label: "Bear Trend",  color: "text-red-300 bg-red-950/50 border-red-800",             icon: "↘", description: "Strong downtrend — short strategies or cash is king" },
  ranging:    { label: "Ranging",     color: "text-blue-300 bg-blue-950/50 border-blue-800",           icon: "↔", description: "Sideways market — mean-reversion strategies favored" },
  high_vol:   { label: "High Vol",    color: "text-orange-300 bg-orange-950/50 border-orange-800",     icon: "⚡", description: "Elevated volatility — wide stops, reduce position size" },
  low_vol:    { label: "Low Vol",     color: "text-zinc-300 bg-zinc-800/50 border-zinc-700",           icon: "◇", description: "Low volatility — breakout strategies may not fire" },
  unknown:    { label: "Unknown",     color: "text-zinc-500 bg-zinc-900/50 border-zinc-800",           icon: "?", description: "Could not determine current regime" },
};

const REGIME_STRATEGIES: Record<Regime, string[]> = {
  bull_trend:  ["triple_ema", "ma_cross", "scalp_ema", "heikin_ashi", "supertrend"],
  bear_trend:  ["oracle_scalper", "anomaly_fade", "breakout_scalp"],
  ranging:     ["vwap_reversion", "bollinger", "rsi", "stoch_rsi", "cci", "rsi_ma_filter"],
  high_vol:    ["breakout_scalp", "anomaly_fade", "oracle_scalper"],
  low_vol:     ["vwap_reversion", "rsi", "williams_r"],
  unknown:     [],
};

async function fetchRegime(symbol: string): Promise<RegimeResponse | null> {
  try {
    const BASE = process.env.NEXT_PUBLIC_SIGNAL_SERVICE_URL || "http://localhost:8000";
    const res = await fetch(`${BASE}/api/v1/backtest/regime?symbol=${symbol}&interval=1d&bars=100`);
    if (!res.ok) return null;
    return await res.json() as RegimeResponse;
  } catch {
    return null;
  }
}

interface RegimeBadgeProps {
  symbol: string;
  onSelectStrategy?: (name: string) => void;
}

export function RegimeBadge({ symbol, onSelectStrategy }: RegimeBadgeProps) {
  const [regime, setRegime] = useState<RegimeResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    fetchRegime(symbol)
      .then(setRegime)
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900/50 border border-zinc-800 rounded-lg">
        <div className="w-2 h-2 rounded-full bg-zinc-700 animate-pulse" />
        <span className="text-xs text-zinc-600">Detecting regime…</span>
      </div>
    );
  }

  if (!regime) return null;

  const meta = REGIME_META[regime.regime] ?? REGIME_META.unknown;
  const suggested = REGIME_STRATEGIES[regime.regime] ?? [];

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`text-sm font-bold px-2 py-0.5 rounded border ${meta.color}`}>
          {meta.icon} {meta.label}
        </span>
        <span className="text-xs text-zinc-500 truncate">{symbol}</span>
      </div>

      {/* Stats */}
      <div className="flex gap-3 text-[10px] text-zinc-500">
        {regime.adx !== null && (
          <span>ADX: <span className="text-zinc-300">{regime.adx.toFixed(1)}</span></span>
        )}
        {regime.atr_percentile !== null && (
          <span>ATR%ile: <span className="text-zinc-300">{(regime.atr_percentile * 100).toFixed(0)}%</span></span>
        )}
        {regime.ema_slope && (
          <span>Slope: <span className="text-zinc-300">{regime.ema_slope}</span></span>
        )}
      </div>

      <p className="text-[11px] text-zinc-500 leading-relaxed">{meta.description}</p>

      {/* Suggested strategies */}
      {suggested.length > 0 && onSelectStrategy && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-600 mb-1">Suited Strategies</div>
          <div className="flex flex-wrap gap-1">
            {suggested.slice(0, 4).map((s) => (
              <button
                key={s}
                onClick={() => onSelectStrategy(s)}
                className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700 transition font-mono"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
