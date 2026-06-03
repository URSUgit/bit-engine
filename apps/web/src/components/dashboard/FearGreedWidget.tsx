"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import type { FearGreedResponse } from "@/app/api/market/fear-greed/route";

function getZone(v: number): { label: string; color: string; bg: string; track: string } {
  if (v >= 75) return { label: "Extreme Greed", color: "text-red-400",     bg: "bg-red-500/10",     track: "bg-red-500"     };
  if (v >= 55) return { label: "Greed",         color: "text-orange-400",  bg: "bg-orange-500/10",  track: "bg-orange-500"  };
  if (v >= 45) return { label: "Neutral",        color: "text-slate-300",   bg: "bg-slate-700/30",   track: "bg-slate-400"   };
  if (v >= 25) return { label: "Fear",           color: "text-blue-400",    bg: "bg-blue-500/10",    track: "bg-blue-500"    };
  return           { label: "Extreme Fear",   color: "text-indigo-400",  bg: "bg-indigo-500/10",  track: "bg-indigo-500"  };
}

export function FearGreedWidget() {
  const { data, isLoading } = useQuery<FearGreedResponse>({
    queryKey: ["fear-greed"],
    queryFn: () => fetch("/api/market/fear-greed?limit=30").then((r) => r.json()),
    staleTime: 3_600_000,
    refetchInterval: 3_600_000,
  });

  if (isLoading || !data) {
    return (
      <div className="card-dark p-4 animate-pulse">
        <div className="h-3 w-24 bg-slate-800 rounded mb-3" />
        <div className="h-8 w-16 bg-slate-800 rounded mb-2" />
        <div className="h-2 w-full bg-slate-800 rounded" />
      </div>
    );
  }

  const { current, history } = data;
  const zone = getZone(current.value);
  const miniHistory = history.slice(0, 14).reverse();

  return (
    <div className={cn("card-dark p-4", zone.bg)}>
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Fear & Greed Index</p>

      {/* Gauge */}
      <div className="flex items-end gap-3 mb-3">
        <span className={cn("text-4xl font-black number-font", zone.color)}>{current.value}</span>
        <div className="mb-1">
          <span className={cn("text-sm font-bold", zone.color)}>{current.value_classification}</span>
          <p className="text-[10px] text-slate-500">Today</p>
        </div>
      </div>

      {/* Track bar */}
      <div className="relative h-2 bg-slate-800 rounded-full mb-3 overflow-hidden">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full transition-all", zone.track)}
          style={{ width: `${current.value}%` }}
        />
      </div>

      {/* Mini 14-day sparkline */}
      {miniHistory.length > 1 && (
        <div className="flex items-end gap-0.5 h-8 mt-1">
          {miniHistory.map((h, i) => {
            const z = getZone(h.value);
            return (
              <div
                key={i}
                title={`${h.value} — ${h.value_classification}`}
                className={cn("flex-1 rounded-sm opacity-70", z.track)}
                style={{ height: `${(h.value / 100) * 100}%` }}
              />
            );
          })}
        </div>
      )}
      <p className="text-[10px] text-slate-600 mt-1">14-day history</p>
    </div>
  );
}
