"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TraderEntry } from "@/app/api/market/traders/route";

const AVATAR_COLORS = [
  "from-cyan-500 to-blue-600",
  "from-violet-500 to-purple-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-pink-500 to-rose-600",
];

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg animate-pulse">
      <span className="w-5 h-3 bg-slate-800 rounded" />
      <div className="w-7 h-7 rounded-full bg-slate-800 shrink-0" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="h-3 bg-slate-800 rounded w-3/5" />
        <div className="h-2.5 bg-slate-800/60 rounded w-2/5" />
      </div>
      <div className="w-12 h-4 bg-slate-800 rounded" />
    </div>
  );
}

export function TopTraders() {
  const [traders, setTraders] = useState<(TraderEntry & { copying: boolean })[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/market/traders?limit=5")
      .then((r) => r.json())
      .then((res: { data?: TraderEntry[]; source?: string }) => {
        if (cancelled) return;
        const list = res.data ?? [];
        setIsDemo(res.source === "demo" || list[0]?.source === "demo");
        setTraders(list.map((t, i) => ({ ...t, copying: i < 2 })));
      })
      .catch(() => {
        if (!cancelled) setTraders([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex flex-col gap-1">
      {/* Header badge row */}
      {isDemo && !loading && (
        <div className="flex justify-end mb-1">
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 uppercase tracking-wide">
            Demo
          </span>
        </div>
      )}

      {loading
        ? Array.from({ length: 3 }, (_, i) => <SkeletonRow key={i} />)
        : traders.map((t, i) => {
            const roi = t.roi_30d;
            const positive = roi >= 0;
            const avatarColor = AVATAR_COLORS[i % AVATAR_COLORS.length] as string;
            const firstChar = (t.handle?.[0] ?? "?").toUpperCase();
            return (
              <div
                key={t.address}
                className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-800/50 transition-colors"
              >
                <span className="w-5 text-xs text-slate-600 number-font text-center shrink-0">
                  {i + 1}
                </span>
                <div
                  className={cn(
                    "w-7 h-7 rounded-full bg-gradient-to-br flex items-center justify-center text-xs font-bold text-white shrink-0",
                    avatarColor
                  )}
                >
                  {firstChar}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{t.handle}</p>
                  <p className="text-xs text-slate-500 font-mono truncate">
                    {t.address.slice(0, 8)}…{t.address.slice(-4)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <div
                    className={cn(
                      "flex items-center gap-1 text-sm font-semibold number-font",
                      positive ? "text-emerald-400" : "text-red-400"
                    )}
                  >
                    {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {positive ? "+" : ""}
                    {roi.toFixed(1)}%
                  </div>
                  {t.copying && (
                    <span className="text-[10px] text-cyan-400 font-medium">Copying</span>
                  )}
                </div>
              </div>
            );
          })}
    </div>
  );
}
