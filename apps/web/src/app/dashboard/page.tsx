import type { Metadata } from "next";
import { DollarSign, TrendingUp, Target, Layers, Plus, Download, ChevronDown } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PortfolioCard } from "@/components/dashboard/PortfolioCard";
import { PositionsTable } from "@/components/dashboard/PositionsTable";
import { SignalsFeed } from "@/components/dashboard/SignalsFeed";
import { CopyTradingPanel } from "@/components/dashboard/CopyTradingPanel";
import { TradingViewChart } from "@/components/charts/TradingViewChart";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-soft" />
                LIVE
              </span>
              <span className="text-xs text-slate-500">Last sync 12s ago</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Command Center</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Welcome back · 7 open positions · 3 traders being copied
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 transition-colors">
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
            <button className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 transition-colors">
              30D <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors shadow-[0_0_20px_-5px_rgba(34,211,238,0.6)]">
              <Plus className="w-3.5 h-3.5" />
              New Position
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <PortfolioCard
            label="Total Value"
            value="$48,320.00"
            change="+$1,240.50"
            changePct="+2.64%"
            trend="up"
            icon={DollarSign}
            sparkline={[42, 44, 43, 45, 47, 46, 48, 49, 47, 48, 50, 48]}
          />
          <PortfolioCard
            label="Today's P&L"
            value="$3,812.40"
            change="+$210.20"
            changePct="+5.84%"
            trend="up"
            icon={TrendingUp}
            sparkline={[3000, 3100, 3050, 3300, 3500, 3450, 3600, 3700, 3650, 3750, 3812]}
          />
          <PortfolioCard
            label="Win Rate"
            value="68.4%"
            change="+1.2 pts"
            changePct="vs last week"
            trend="up"
            icon={Target}
            sparkline={[60, 62, 61, 64, 65, 66, 65, 67, 68, 68, 68.4]}
          />
          <PortfolioCard
            label="Open Positions"
            value="7"
            change="2 opened today"
            trend="neutral"
            icon={Layers}
          />
        </div>

        {/* Chart + Signals row */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 card-dark p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Portfolio Performance</h2>
                <p className="text-xs text-slate-500">Equity curve · USD</p>
              </div>
              <div className="flex gap-1 text-xs bg-slate-900 rounded-lg p-1 border border-slate-800">
                {[
                  { label: "1H", active: false },
                  { label: "1D", active: false },
                  { label: "1W", active: false },
                  { label: "1M", active: true },
                  { label: "ALL", active: false },
                ].map((t) => (
                  <button
                    key={t.label}
                    className={`px-2.5 py-1 rounded transition-colors ${
                      t.active
                        ? "bg-slate-800 text-cyan-300 font-semibold"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <TradingViewChart height={320} />
          </div>
          <div className="card-dark p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-100">Live Signal Feed</h2>
              <span className="text-[10px] text-slate-500 uppercase tracking-widest">Real-time</span>
            </div>
            <SignalsFeed />
          </div>
        </div>

        {/* Positions + Copy-trading row */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 card-dark p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-100">Open Positions</h2>
              <button className="text-xs text-cyan-400 hover:text-cyan-300">View all →</button>
            </div>
            <PositionsTable />
          </div>
          <CopyTradingPanel />
        </div>
      </div>
    </DashboardLayout>
  );
}
