"use client";

import { Sparkles, FlaskConical } from "lucide-react";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { useUIModeStore } from "@/store";
import { cn } from "@/lib/utils";

export default function GeneralSettingsPage() {
  const mode = useUIModeStore((s) => s.mode);
  const setMode = useUIModeStore((s) => s.setMode);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1200px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Settings</h1>
        <p className="text-sm text-slate-400 mt-1">Manage your profile, security, and integrations</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
        <SettingsNav />

        <div className="flex flex-col gap-5">
          <div className="card-dark p-6">
            <h2 className="text-base font-bold text-slate-100 mb-1">Interface mode</h2>
            <p className="text-xs text-slate-500 mb-5">
              Simple mode keeps things focused on markets, positions, and signals. Pro mode unlocks the full
              toolkit — backtesting, strategy building, notebooks, and more.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => setMode("simple")}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors",
                  mode === "simple"
                    ? "border-cyan-500/50 bg-cyan-500/10"
                    : "border-slate-800 bg-slate-900 hover:border-slate-700"
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <Sparkles className="w-4 h-4 text-cyan-400" /> Simple
                </span>
                <span className="text-xs text-slate-500 leading-relaxed">
                  Home, Markets, Positions, Signals, and the AI assistant. Plain-language metrics, no raw
                  parameters.
                </span>
                {mode === "simple" && (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-cyan-400">Active</span>
                )}
              </button>

              <button
                onClick={() => setMode("pro")}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors",
                  mode === "pro"
                    ? "border-violet-500/50 bg-violet-500/10"
                    : "border-slate-800 bg-slate-900 hover:border-slate-700"
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <FlaskConical className="w-4 h-4 text-violet-400" /> Pro
                </span>
                <span className="text-xs text-slate-500 leading-relaxed">
                  Everything in Simple, plus the full Lab: Backtester, Forecaster, YT Scout, Signal Builder,
                  Polymarket Bot, Notebooks, and raw strategy parameters.
                </span>
                {mode === "pro" && (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-violet-400">Active</span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
