"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, CheckCircle2, AlertTriangle, XCircle, HelpCircle, RefreshCw } from "lucide-react";

type SourceStatus = {
  name: string;
  label: string;
  status: "live" | "degraded" | "error" | "unconfigured";
  latency_ms: number | null;
  detail: string;
  checked_at: string;
};

type StatusPayload = {
  overall: "live" | "degraded" | "partial";
  sources: SourceStatus[];
  checked_at: string;
};

const POLL_INTERVAL_MS = 60_000;

function statusColor(s: SourceStatus["status"]) {
  return {
    live:         "text-emerald-400",
    degraded:     "text-amber-400",
    error:        "text-red-400",
    unconfigured: "text-slate-500",
  }[s];
}

function statusBg(s: SourceStatus["status"]) {
  return {
    live:         "bg-emerald-400",
    degraded:     "bg-amber-400",
    error:        "bg-red-400",
    unconfigured: "bg-slate-600",
  }[s];
}

function StatusIcon({ status, className }: { status: SourceStatus["status"]; className?: string }) {
  const cls = `w-3.5 h-3.5 ${statusColor(status)} ${className ?? ""}`;
  if (status === "live")         return <CheckCircle2 className={cls} />;
  if (status === "error")        return <XCircle className={cls} />;
  if (status === "degraded")     return <AlertTriangle className={cls} />;
  return <HelpCircle className={cls} />;
}

function OverallDot({ overall, pulsing }: { overall: StatusPayload["overall"]; pulsing: boolean }) {
  const color =
    overall === "live"    ? "bg-emerald-400" :
    overall === "partial" ? "bg-amber-400"   : "bg-red-400";
  return (
    <span className="relative flex h-2.5 w-2.5">
      {pulsing && (
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-50`} />
      )}
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
  );
}

function ago(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 5)   return "just now";
  if (secs < 60)  return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export function DataStatusIndicator() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchStatus = async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      const r = await fetch("/api/status");
      const d: StatusPayload = await r.json();
      setData(d);
    } catch {
      // network error — keep stale data
    } finally {
      if (showLoader) setLoading(false);
    }
  };

  // Initial fetch + polling
  useEffect(() => {
    fetchStatus(true);
    const id = setInterval(() => fetchStatus(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Relative time ticks
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const overallLabel =
    !data            ? "Checking…"        :
    data.overall === "live"    ? "All systems live"    :
    data.overall === "partial" ? "Some sources offline":
    "Services degraded";

  const errorCount = data?.sources.filter((s) => s.status === "error").length ?? 0;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={overallLabel}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-slate-800 transition-colors"
      >
        {loading || !data ? (
          <Activity className="w-3.5 h-3.5 text-slate-500 animate-pulse" />
        ) : (
          <OverallDot overall={data.overall} pulsing={data.overall === "live"} />
        )}
        {errorCount > 0 && (
          <span className="text-[10px] font-semibold text-red-400">{errorCount}</span>
        )}
      </button>

      {open && data && (
        <div className="absolute right-0 top-11 z-50 w-80 bg-slate-950 border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <OverallDot overall={data.overall} pulsing={false} />
              <span className="text-xs font-semibold text-slate-200">{overallLabel}</span>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); fetchStatus(true); }}
              title="Refresh"
              className="p-1 rounded hover:bg-slate-800 transition-colors"
            >
              <RefreshCw className={`w-3 h-3 text-slate-500 hover:text-slate-300 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Source list */}
          <div className="py-1">
            {data.sources.map((src) => (
              <div key={src.name} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-900/50">
                {/* Status dot */}
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusBg(src.status)}`} />

                {/* Label + detail */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-200 truncate">{src.label}</p>
                  <p className="text-[10px] text-slate-500 truncate">{src.detail}</p>
                </div>

                {/* Latency / badge */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {src.latency_ms !== null && (
                    <span className="text-[10px] tabular-nums text-slate-500">
                      {src.latency_ms}ms
                    </span>
                  )}
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                    src.status === "live"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : src.status === "error"
                      ? "bg-red-500/10 text-red-400"
                      : src.status === "degraded"
                      ? "bg-amber-500/10 text-amber-400"
                      : "bg-slate-800 text-slate-500"
                  }`}>
                    {src.status === "unconfigured" ? "no key" : src.status}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-slate-800/60 flex items-center justify-between">
            <span className="text-[10px] text-slate-600">
              Checked {ago(data.checked_at)}
            </span>
            <span className="text-[10px] text-slate-600">
              Auto-refresh every 60s
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
