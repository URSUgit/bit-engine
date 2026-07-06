"use client";

import { useEffect, useState } from "react";
import { backtestApi, type AssetMetadata } from "@/lib/backtest-api";

function fmtNum(n: number | null | undefined, opts?: { decimals?: number; suffix?: string }): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}T${opts?.suffix ?? ""}`;
  if (Math.abs(n) >= 1e9)  return `${(n / 1e9).toFixed(2)}B${opts?.suffix ?? ""}`;
  if (Math.abs(n) >= 1e6)  return `${(n / 1e6).toFixed(2)}M${opts?.suffix ?? ""}`;
  if (Math.abs(n) >= 1e3)  return `${(n / 1e3).toFixed(2)}K${opts?.suffix ?? ""}`;
  return n.toFixed(opts?.decimals ?? 2) + (opts?.suffix ?? "");
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  if (Math.abs(n) >= 1) return "$" + fmtNum(n);
  return "$" + n.toFixed(6);
}

export function MetadataPanel({ symbol }: { symbol: string }) {
  const [data, setData] = useState<AssetMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    backtestApi
      .metadata(symbol)
      .then((d) => setData(d))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 text-zinc-500 text-sm">
        Loading {symbol} metadata…
      </div>
    );
  }
  if (error || !data?.metadata) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 text-zinc-500 text-sm">
        No metadata available for {symbol}.
      </div>
    );
  }

  const m = data.metadata;
  const isCrypto = m.asset_class === "crypto";

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-3">
      <div>
        <h3 className="font-semibold">{m.name ?? symbol}</h3>
        <p className="text-xs text-zinc-500">
          {symbol} · {m.exchange ?? m.asset_class ?? "—"}
          {m.market_cap_rank && ` · Rank #${m.market_cap_rank}`}
        </p>
      </div>

      {m.description && (
        <p className="text-xs text-zinc-400 leading-relaxed border-l-2 border-zinc-800 pl-3">
          {m.description.slice(0, 280)}{m.description.length > 280 ? "…" : ""}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Row label="Price" value={fmtUsd(m.current_price_usd)} />
        <Row label="Market cap" value={fmtUsd(m.market_cap_usd)} />
        <Row label="24h volume" value={fmtUsd(m.total_volume_24h_usd)} />
        <Row label="24h change" value={fmtPct(m.price_change_24h_pct)} positive={(m.price_change_24h_pct ?? 0) >= 0} />

        {isCrypto && (
          <>
            <Row label="7d change" value={fmtPct(m.price_change_7d_pct)} positive={(m.price_change_7d_pct ?? 0) >= 0} />
            <Row label="30d change" value={fmtPct(m.price_change_30d_pct)} positive={(m.price_change_30d_pct ?? 0) >= 0} />
            <Row label="1y change" value={fmtPct(m.price_change_1y_pct)} positive={(m.price_change_1y_pct ?? 0) >= 0} />
            <Row label="ATH" value={fmtUsd(m.ath_usd)} sub={fmtPct(m.ath_change_pct)} />
            <Row label="ATL" value={fmtUsd(m.atl_usd)} />
            <Row label="Circulating" value={fmtNum(m.circulating_supply)} />
            {m.max_supply && <Row label="Max supply" value={fmtNum(m.max_supply)} />}
          </>
        )}

        {!isCrypto && (
          <>
            <Row label="P/E (trailing)" value={fmtNum(m.trailing_pe)} />
            <Row label="P/E (forward)" value={fmtNum(m.forward_pe)} />
            <Row label="P/B" value={fmtNum(m.price_to_book)} />
            <Row label="EPS" value={fmtNum(m.trailing_eps)} />
            <Row label="Div yield" value={m.dividend_yield_pct ? `${m.dividend_yield_pct.toFixed(2)}%` : "—"} />
            <Row label="Beta" value={fmtNum(m.beta)} />
            <Row label="52w high" value={fmtUsd(m.fifty_two_week_high)} />
            <Row label="52w low" value={fmtUsd(m.fifty_two_week_low)} />
          </>
        )}
      </div>

      {data.fear_greed && (
        <div className="border-t border-zinc-800 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">Crypto Fear & Greed</span>
            <span className={`text-sm font-semibold ${fngColor(data.fear_greed.value)}`}>
              {data.fear_greed.value} · {data.fear_greed.value_classification}
            </span>
          </div>
          <div className="mt-2 flex h-1.5 bg-zinc-800 rounded overflow-hidden">
            {data.fear_greed.history_30d.slice().reverse().map((d, i) => (
              <div
                key={i}
                style={{ width: `${100 / 30}%`, backgroundColor: fngBg(d.value) }}
                title={`${new Date(d.t * 1000).toISOString().slice(0, 10)}: ${d.value} (${d.label})`}
              />
            ))}
          </div>
          <p className="text-[10px] text-zinc-600 mt-1">last 30 days</p>
        </div>
      )}

      {m.twitter_followers !== undefined && (
        <div className="text-xs text-zinc-500 flex gap-3 pt-2 border-t border-zinc-800">
          {m.twitter_followers !== undefined && <span>Twitter: {fmtNum(m.twitter_followers)}</span>}
          {m.reddit_subscribers !== undefined && <span>Reddit: {fmtNum(m.reddit_subscribers)}</span>}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  const color = positive === undefined ? "text-zinc-200" : positive ? "text-emerald-400" : "text-red-400";
  return (
    <div className="bg-zinc-950 rounded p-2 border border-zinc-800/60">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`font-medium ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function fngColor(v: number): string {
  if (v < 25) return "text-red-400";
  if (v < 50) return "text-orange-400";
  if (v < 75) return "text-yellow-400";
  return "text-emerald-400";
}

function fngBg(v: number): string {
  if (v < 25) return "#ef4444";
  if (v < 50) return "#f97316";
  if (v < 75) return "#eab308";
  return "#10b981";
}
