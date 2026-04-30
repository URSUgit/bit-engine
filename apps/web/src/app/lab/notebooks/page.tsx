"use client";

import { Plus, FileCode2, GitBranch } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { cn } from "@/lib/utils";

interface Notebook {
  id: string;
  name: string;
  description: string;
  language: "python" | "typescript";
  lastEdited: string;
  cells: number;
  shared: boolean;
}

const notebooks: Notebook[] = [
  { id: "n1", name: "Funding rate study",         description: "Cross-exchange funding-rate basis analysis on majors", language: "python",     lastEdited: "12m ago", cells: 24, shared: false },
  { id: "n2", name: "Whale flow correlation",     description: "On-chain whale wallet movements vs price action",      language: "python",     lastEdited: "2h ago",  cells: 18, shared: true },
  { id: "n3", name: "FinBERT validation",         description: "Backtest of FinBERT-driven entries on 6 months",       language: "python",     lastEdited: "1d ago",  cells: 31, shared: false },
  { id: "n4", name: "Hyperliquid order book",     description: "TS prototype: depth imbalance signal generator",       language: "typescript", lastEdited: "3d ago",  cells: 12, shared: false },
];

export default function NotebooksPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6 max-w-[1400px] mx-auto">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Research Notebooks</h1>
            <p className="text-sm text-slate-400 mt-1">Jupyter-style notebooks with platform data pre-loaded</p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors">
            <Plus className="w-4 h-4" /> New Notebook
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {notebooks.map((n) => (
            <div key={n.id} className="card-dark glow-card p-5 flex flex-col gap-3 cursor-pointer">
              <div className="flex items-start justify-between">
                <div className={cn(
                  "w-9 h-9 rounded-lg flex items-center justify-center border shrink-0",
                  n.language === "python" ? "bg-yellow-500/10 border-yellow-500/20" : "bg-blue-500/10 border-blue-500/20"
                )}>
                  <FileCode2 className={cn("w-4 h-4", n.language === "python" ? "text-yellow-400" : "text-blue-400")} />
                </div>
                {n.shared && (
                  <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 flex items-center gap-1">
                    <GitBranch className="w-2.5 h-2.5" /> Shared
                  </span>
                )}
              </div>
              <div>
                <p className="text-base font-bold text-slate-100">{n.name}</p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-2">{n.description}</p>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-3 border-t border-slate-800/60 mt-auto">
                <span className="capitalize">{n.language} · {n.cells} cells</span>
                <span>{n.lastEdited}</span>
              </div>
            </div>
          ))}

          <button className="card-dark border-dashed flex flex-col items-center justify-center p-12 hover:border-cyan-500/30 transition-colors group min-h-[200px]">
            <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-3 group-hover:bg-cyan-500/20 transition-colors">
              <Plus className="w-5 h-5 text-cyan-400" />
            </div>
            <p className="text-sm font-semibold text-slate-300">New Notebook</p>
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}
