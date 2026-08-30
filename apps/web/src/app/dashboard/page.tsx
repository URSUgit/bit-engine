import type { Metadata } from "next";
import { Download, ChevronDown, Plus } from "lucide-react";
import Link from "next/link";
import { DashboardLive } from "@/components/dashboard/DashboardLive";
import { DashboardSubtitle } from "@/components/dashboard/DashboardSubtitle";
import { PositionsTable } from "@/components/dashboard/PositionsTable";
import { CopyTradingPanel } from "@/components/dashboard/CopyTradingPanel";
import { TopMovers } from "@/components/dashboard/TopMovers";
import { AiChatWelcomeCard } from "@/components/dashboard/AiChatWelcomeCard";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
      <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                LIVE
              </span>
              <span className="text-xs text-slate-500">Prices update every tick</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Command Center</h1>
            <DashboardSubtitle />
          </div>

          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 transition-colors">
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
            <button className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 transition-colors">
              30D <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <Link
              href="/dashboard/markets"
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors shadow-[0_0_20px_-5px_rgba(34,211,238,0.6)]"
            >
              <Plus className="w-3.5 h-3.5" />
              New Position
            </Link>
          </div>
        </div>

        <AiChatWelcomeCard />

        {/* Live stats + chart + signals (client component) */}
        <DashboardLive />

        {/* Positions + Copy-trading + Top Movers */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 card-dark p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-100">Open Positions</h2>
              <Link
                href="/dashboard/positions"
                className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                View all →
              </Link>
            </div>
            <PositionsTable />
          </div>
          <div className="flex flex-col gap-4">
            <CopyTradingPanel />
            <TopMovers />
          </div>
        </div>
      </div>
  );
}
