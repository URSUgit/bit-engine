"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SourceStatus } from "@/app/api/status/route";

type StatusResponse = {
  overall: "live" | "degraded" | "partial";
  sources: SourceStatus[];
  checked_at: string;
};

const statusCfg = {
  live:         { dot: "bg-emerald-500", label: "Live",         text: "text-emerald-400", badge: "bg-emerald-500/10 border-emerald-500/20" },
  degraded:     { dot: "bg-amber-500",   label: "Degraded",     text: "text-amber-400",   badge: "bg-amber-500/10 border-amber-500/20" },
  error:        { dot: "bg-red-500",     label: "Error",        text: "text-red-400",     badge: "bg-red-500/10 border-red-500/20" },
  unconfigured: { dot: "bg-slate-600",   label: "Unconfigured", text: "text-slate-500",   badge: "bg-slate-800 border-slate-700" },
} as const;

const overallCfg = {
  live:     { banner: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-500", label: "All Data Sources Live" },
  partial:  { banner: "bg-amber-500/10  text-amber-400  border-amber-500/20",  dot: "bg-amber-500",   label: "Some Sources Unconfigured" },
  degraded: { banner: "bg-red-500/10    text-red-400    border-red-500/20",    dot: "bg-red-500",     label: "Degraded — Check Sources" },
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

export default function StatusPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 60_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const overall = data?.overall ?? "degraded";
  const ocfg = overallCfg[overall];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <div className={cn("inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium mb-6 border", ocfg.banner)}>
            <span className={cn("w-2 h-2 rounded-full", ocfg.dot, overall === "live" && "animate-pulse")} />
            {loading && !data ? "Checking…" : ocfg.label}
          </div>
          <h1 className="text-3xl font-bold">BitPrivat Data Sources</h1>
          <p className="text-slate-400 mt-2">Live status for all market data integrations</p>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            Failed to load status: {error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {data?.sources.map((s) => {
            const cfg = statusCfg[s.status] ?? statusCfg.unconfigured;
            return (
              <div
                key={s.name}
                className="flex items-center justify-between px-4 py-3.5 bg-slate-900 border border-slate-800 rounded-xl"
              >
                <div className="flex items-center gap-3">
                  <span className={cn("w-2 h-2 rounded-full shrink-0", cfg.dot, s.status === "live" && "animate-pulse")} />
                  <div>
                    <p className="text-sm font-medium text-slate-200">{s.label}</p>
                    {s.detail && (
                      <p className="text-[11px] text-slate-500 mt-0.5">{s.detail}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs shrink-0">
                  {s.latency_ms !== null && (
                    <span className="text-slate-500 font-mono">{s.latency_ms}ms</span>
                  )}
                  <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-bold border uppercase tracking-wider", cfg.badge, cfg.text)}>
                    {cfg.label}
                  </span>
                </div>
              </div>
            );
          })}

          {!data && !loading && (
            <div className="text-center py-8 text-slate-500">No status data available</div>
          )}

          {loading && !data && (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 bg-slate-900 border border-slate-800 rounded-xl animate-pulse" />
            ))
          )}
        </div>

        <div className="flex items-center justify-between mt-8 text-xs text-slate-600">
          <span>{data ? `Last checked ${timeAgo(data.checked_at)}` : "Checking…"}</span>
          <button
            onClick={fetchStatus}
            className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
