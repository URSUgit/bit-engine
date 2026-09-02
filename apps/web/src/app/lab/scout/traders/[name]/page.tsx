"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, ArrowDownRight, Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { traderAvatarUrl } from "@/lib/avatar";

interface VideoMetrics {
  symbol?: string;
  interval?: string;
  bars?: number;
  total_return_pct?: number;
  sharpe_ratio?: number;
  max_drawdown_pct?: number;
  total_trades?: number;
  win_rate?: number;
  error?: string;
}

interface TraderVideo {
  video_id: string | null;
  title: string | null;
  url: string | null;
  thumbnail: string | null;
  strategy: string;
  label: string;
  metrics: VideoMetrics;
}

interface TraderProfile {
  trader: string;
  videos: TraderVideo[];
  summary: {
    video_count: number;
    strategy_count: number;
    avg_return_pct: number | null;
    best_return_pct: number | null;
    worst_return_pct: number | null;
    avg_win_rate: number | null;
  };
}

export default function TraderProfilePage() {
  const params = useParams<{ name: string }>();
  const trader = decodeURIComponent(params?.name ?? "");
  const [profile, setProfile] = useState<TraderProfile | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!trader) return;
    fetch(`/api/v1/scout/traders/${encodeURIComponent(trader)}`)
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then((data: TraderProfile) => setProfile(data))
      .catch(() => setNotFound(true));
  }, [trader]);

  if (notFound) {
    return (
      <div className="p-6">
        <Link href="/lab/scout/traders" className="text-slate-500 hover:text-slate-300 text-sm flex items-center gap-1.5 w-fit">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to traders
        </Link>
        <p className="mt-8 text-slate-500 text-center">Trader not found.</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
      </div>
    );
  }

  const s = profile.summary;

  return (
    <div className="flex flex-col gap-5 p-6 max-w-[1600px] mx-auto">
      <Link href="/lab/scout/traders" className="text-slate-500 hover:text-slate-300 transition-colors w-fit text-sm flex items-center gap-1.5">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to traders
      </Link>

      {/* Header card */}
      <div className="card-dark p-6">
        <div className="flex items-start gap-5 flex-wrap">
          <img
            src={traderAvatarUrl(profile.trader)}
            alt={profile.trader}
            className="w-20 h-20 rounded-full border border-slate-700 object-cover shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">{profile.trader}</h1>
            <p className="text-xs text-slate-500 mt-1">
              {s.video_count} video{s.video_count === 1 ? "" : "s"} analyzed · {s.strategy_count} strategy model
              {s.strategy_count === 1 ? "" : "s"} · backtested over the max available history (10Y)
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="Avg Return" value={pct(s.avg_return_pct)} positive={s.avg_return_pct != null && s.avg_return_pct >= 0} />
        <Metric label="Best Return" value={pct(s.best_return_pct)} positive={s.best_return_pct != null && s.best_return_pct >= 0} />
        <Metric label="Worst Return" value={pct(s.worst_return_pct)} positive={s.worst_return_pct != null && s.worst_return_pct >= 0} />
        <Metric label="Avg Win Rate" value={s.avg_win_rate != null ? `${s.avg_win_rate.toFixed(1)}%` : "—"} />
      </div>

      {/* Video / strategy history */}
      <div className="card-dark p-5">
        <h2 className="text-sm font-semibold text-slate-100 mb-4">Strategy history (max-period backtest)</h2>
        {profile.videos.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">No strategies found for this trader.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {profile.videos.map((v, i) => {
              const m = v.metrics;
              const positive = (m.total_return_pct ?? 0) >= 0;
              return (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-slate-900/50 flex-wrap">
                  {v.thumbnail ? (
                    <img src={v.thumbnail} alt={v.title ?? ""} className="w-14 h-9 rounded object-cover shrink-0" />
                  ) : (
                    <div className="w-14 h-9 rounded bg-slate-800 shrink-0" />
                  )}
                  <div className="flex-1 min-w-[180px]">
                    {v.url ? (
                      <a
                        href={v.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-slate-100 hover:text-cyan-400 transition-colors inline-flex items-center gap-1"
                      >
                        {v.title ?? v.strategy}
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ) : (
                      <p className="text-sm font-medium text-slate-100">{v.title ?? v.strategy}</p>
                    )}
                    <p className="text-[11px] text-slate-500">{v.label}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {m.error ? (
                      <p className="text-[11px] text-slate-600">{m.error}</p>
                    ) : (
                      <>
                        <div className={cn("text-sm font-semibold number-font flex items-center gap-1 justify-end", positive ? "text-emerald-400" : "text-red-400")}>
                          {positive ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                          {pct(m.total_return_pct)}
                        </div>
                        <p className="text-[10px] text-slate-600 number-font">
                          {m.win_rate != null ? `${m.win_rate.toFixed(1)}% win rate` : ""} · {m.symbol}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="card-dark p-3">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</p>
      <p className={cn("text-base font-bold number-font mt-1", positive === undefined ? "text-slate-100" : positive ? "text-emerald-400" : "text-red-400")}>
        {value}
      </p>
    </div>
  );
}
