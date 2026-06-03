"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import type { FundingData } from "@/app/api/exchange/funding/route";

interface FundingPanelProps {
  symbol: string;
}

function formatOI(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(2)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(2)}K`;
  return `$${usd.toFixed(2)}`;
}

function formatCountdown(nextFundingTime: number): string {
  if (!nextFundingTime) return "—";
  const diff = nextFundingTime - Date.now();
  if (diff <= 0) return "Now";
  const totalSeconds = Math.floor(diff / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getRateColor(rate: number): string {
  if (rate > 0.00005) return "text-red-400";
  if (rate < -0.00005) return "text-emerald-400";
  return "text-slate-400";
}

function MiniBarChart({ rates }: { rates: Array<{ time: number; rate: number }> }) {
  if (rates.length === 0) return null;

  const maxAbs = Math.max(...rates.map((r) => Math.abs(r.rate)), 0.0001);

  return (
    <div className="flex items-end gap-0.5 h-10">
      {rates.map((r, i) => {
        const heightPct = Math.max((Math.abs(r.rate) / maxAbs) * 100, 4);
        const isPositive = r.rate >= 0;
        return (
          <div
            key={i}
            title={`${(r.rate * 100).toFixed(4)}%`}
            className="flex-1 flex flex-col items-center justify-end h-full"
          >
            <div
              className={cn(
                "w-full rounded-sm transition-all",
                isPositive ? "bg-red-400/70" : "bg-emerald-400/70"
              )}
              style={{ height: `${heightPct}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="card-dark p-4 animate-pulse">
      <div className="h-4 w-40 bg-slate-700 rounded mb-4" />
      <div className="grid grid-cols-2 gap-4 mb-4">
        {[...Array(4)].map((_, i) => (
          <div key={i}>
            <div className="h-2.5 w-20 bg-slate-700 rounded mb-2" />
            <div className="h-5 w-28 bg-slate-700 rounded" />
          </div>
        ))}
      </div>
      <div className="h-10 bg-slate-700/50 rounded" />
    </div>
  );
}

export function FundingPanel({ symbol }: FundingPanelProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["funding", symbol],
    queryFn: async (): Promise<FundingData> => {
      const res = await fetch(`/api/exchange/funding?symbol=${symbol}`);
      const json = await res.json();
      if (!json.data) throw new Error("No funding data");
      return json.data as FundingData;
    },
    refetchInterval: 60_000,
    retry: 1,
  });

  if (isLoading) return <LoadingSkeleton />;

  if (isError || !data) {
    return (
      <div className="card-dark p-4">
        <h2 className="text-sm font-semibold text-slate-100 mb-2">Funding & Open Interest</h2>
        <p className="text-xs text-slate-500 italic">Funding data not available (spot only)</p>
      </div>
    );
  }

  // Spot-only fallback: all zeros
  const isSpotOnly =
    data.funding_rate === 0 &&
    data.open_interest === 0 &&
    data.next_funding_time === 0 &&
    data.recent_rates.length === 0;

  if (isSpotOnly) {
    return (
      <div className="card-dark p-4">
        <h2 className="text-sm font-semibold text-slate-100 mb-2">Funding & Open Interest</h2>
        <p className="text-xs text-slate-500 italic">Funding data not available (spot only)</p>
      </div>
    );
  }

  const rateColor = getRateColor(data.funding_rate);
  const ratePct = (data.funding_rate * 100).toFixed(4);
  const annualizedPct = (data.funding_rate * 3 * 365 * 100).toFixed(1);
  const countdown = formatCountdown(data.next_funding_time);

  return (
    <div className="card-dark p-4">
      <h2 className="text-sm font-semibold text-slate-100 mb-4">Funding &amp; Open Interest</h2>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 mb-4">
        {/* Funding Rate */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">
            Funding Rate
          </p>
          <p className={cn("text-lg font-bold number-font", rateColor)}>
            {data.funding_rate >= 0 ? "+" : ""}{ratePct}%
          </p>
          <p className="text-[11px] text-slate-500 number-font mt-0.5">
            ~{annualizedPct}%/yr
          </p>
        </div>

        {/* Open Interest */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">
            Open Interest
          </p>
          <p className="text-lg font-bold number-font text-slate-100">
            {formatOI(data.open_interest)}
          </p>
        </div>

        {/* Next Funding */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">
            Next Funding
          </p>
          <p className="text-sm font-semibold number-font text-slate-200">
            {countdown}
          </p>
        </div>

        {/* Direction label */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">
            Who Pays
          </p>
          <p
            className={cn(
              "text-sm font-semibold",
              data.funding_rate > 0.00005
                ? "text-red-400"
                : data.funding_rate < -0.00005
                ? "text-emerald-400"
                : "text-slate-400"
            )}
          >
            {data.funding_rate > 0.00005
              ? "Longs pay shorts"
              : data.funding_rate < -0.00005
              ? "Shorts pay longs"
              : "Neutral"}
          </p>
        </div>
      </div>

      {/* Mini bar chart */}
      {data.recent_rates.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">
            Last {data.recent_rates.length} Funding Periods
          </p>
          <MiniBarChart rates={data.recent_rates} />
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-slate-600">oldest</span>
            <span className="text-[10px] text-slate-600">latest</span>
          </div>
        </div>
      )}
    </div>
  );
}
