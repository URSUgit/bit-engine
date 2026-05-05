import { TrendingUp } from "lucide-react";
import { mockTraders } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

// Top 5 from the leaderboard; first two are being copied
const TOP = mockTraders.slice(0, 5).map((t, i) => ({ ...t, copying: i < 2 }));

export function TopTraders() {
  return (
    <div className="flex flex-col gap-1">
      {TOP.map((t, i) => {
        const roi = t.stats?.roi30d ?? 0;
        const positive = roi >= 0;
        return (
          <div
            key={t.id}
            className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-800/50 transition-colors"
          >
            <span className="w-5 text-xs text-slate-600 number-font text-center shrink-0">
              {i + 1}
            </span>
            <div
              className={cn(
                "w-7 h-7 rounded-full bg-gradient-to-br flex items-center justify-center text-xs font-bold text-white shrink-0",
                t.avatarColor
              )}
            >
              {(t.handle ?? "?")[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-slate-200 truncate">{t.handle}</p>
                {t.badge === "elite" && (
                  <span className="text-[9px] font-bold px-1 py-px rounded bg-amber-500/15 text-amber-400 uppercase tracking-wide shrink-0">
                    Elite
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {t.followerCount?.toLocaleString()} followers
              </p>
            </div>
            <div className="text-right shrink-0">
              <div
                className={cn(
                  "flex items-center gap-1 text-sm font-semibold number-font",
                  positive ? "text-emerald-400" : "text-red-400"
                )}
              >
                <TrendingUp className="w-3 h-3" />
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
