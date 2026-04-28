import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface PortfolioCardProps {
  label: string;
  value: string;
  change: string;
  changePct: string;
  trend: "up" | "down" | "neutral";
}

export function PortfolioCard({ label, value, change, changePct, trend }: PortfolioCardProps) {
  const Icon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;

  return (
    <div className="card-dark p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{label}</p>
        <Icon
          className={cn(
            "w-4 h-4",
            trend === "up" && "text-green-500",
            trend === "down" && "text-red-500",
            trend === "neutral" && "text-zinc-500"
          )}
        />
      </div>
      <div>
        <p className="text-2xl font-bold text-zinc-50 number-font tracking-tight">{value}</p>
        {change && (
          <p
            className={cn(
              "text-xs mt-1 number-font",
              trend === "up" && "text-green-400",
              trend === "down" && "text-red-400",
              trend === "neutral" && "text-zinc-400"
            )}
          >
            {change}
            {changePct && <span className="ml-1 opacity-70">{changePct}</span>}
          </p>
        )}
      </div>
    </div>
  );
}
