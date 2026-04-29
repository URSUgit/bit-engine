import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PortfolioCardProps {
  label: string;
  value: string;
  change?: string;
  changePct?: string;
  trend?: "up" | "down" | "neutral";
  icon?: LucideIcon;
  sparkline?: number[];
}

export function PortfolioCard({
  label,
  value,
  change,
  changePct,
  trend = "neutral",
  icon: Icon,
  sparkline,
}: PortfolioCardProps) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;

  return (
    <div className="card-dark glow-card p-5 flex flex-col gap-3 relative overflow-hidden">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {Icon && (
            <div className="w-7 h-7 rounded-lg bg-slate-800/60 border border-slate-700/50 flex items-center justify-center">
              <Icon className="w-3.5 h-3.5 text-slate-400" />
            </div>
          )}
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</p>
        </div>
        <TrendIcon
          className={cn(
            "w-4 h-4",
            trend === "up" && "text-emerald-400",
            trend === "down" && "text-red-400",
            trend === "neutral" && "text-slate-500"
          )}
        />
      </div>

      <div>
        <p className="text-2xl font-bold text-slate-50 number-font tracking-tight">{value}</p>
        {(change || changePct) && (
          <p
            className={cn(
              "text-xs mt-1.5 number-font flex items-center gap-1.5",
              trend === "up" && "text-emerald-400",
              trend === "down" && "text-red-400",
              trend === "neutral" && "text-slate-400"
            )}
          >
            {change && <span>{change}</span>}
            {changePct && (
              <span
                className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded",
                  trend === "up" && "bg-emerald-500/15",
                  trend === "down" && "bg-red-500/15",
                  trend === "neutral" && "bg-slate-800"
                )}
              >
                {changePct}
              </span>
            )}
          </p>
        )}
      </div>

      {sparkline && <Sparkline data={sparkline} trend={trend} />}
    </div>
  );
}

function Sparkline({ data, trend }: { data: number[]; trend: "up" | "down" | "neutral" }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 30 - ((v - min) / range) * 28;
      return `${x},${y}`;
    })
    .join(" ");

  const stroke =
    trend === "up" ? "stroke-emerald-400" : trend === "down" ? "stroke-red-400" : "stroke-cyan-400";

  return (
    <svg viewBox="0 0 100 30" className="w-full h-8" preserveAspectRatio="none">
      <polyline points={points} fill="none" className={cn(stroke)} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
