import type { Metadata } from "next";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PortfolioCard } from "@/components/dashboard/PortfolioCard";
import { PositionsTable } from "@/components/dashboard/PositionsTable";
import { SignalsFeed } from "@/components/dashboard/SignalsFeed";
import { TopTraders } from "@/components/dashboard/TopTraders";
import { MiniChart } from "@/components/charts/MiniChart";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-50">Portfolio Overview</h1>
            <p className="text-sm text-zinc-400 mt-0.5">Live performance · Last updated just now</p>
          </div>
          <div className="flex gap-2">
            <button className="px-4 py-2 text-sm font-medium rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors">
              Export
            </button>
            <button className="px-4 py-2 text-sm font-medium rounded-lg bg-cyan-500 text-zinc-950 hover:bg-cyan-400 transition-colors">
              + New Position
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <PortfolioCard
            label="Portfolio Value"
            value="$48,320.00"
            change="+$1,240.50"
            changePct="+2.64%"
            trend="up"
          />
          <PortfolioCard
            label="Unrealized P&L"
            value="$3,812.40"
            change="+$210.20"
            changePct="+5.84%"
            trend="up"
          />
          <PortfolioCard
            label="Open Positions"
            value="7"
            change="2 new today"
            changePct=""
            trend="neutral"
          />
          <PortfolioCard
            label="Active Signals"
            value="24"
            change="3 high-confidence"
            changePct=""
            trend="neutral"
          />
        </div>

        {/* Chart + Signals row */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 card-dark p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-200">Portfolio Performance</h2>
              <div className="flex gap-1 text-xs">
                {["1H", "1D", "1W", "1M", "ALL"].map((t) => (
                  <button
                    key={t}
                    className="px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <MiniChart />
          </div>
          <div className="card-dark p-4">
            <h2 className="text-sm font-semibold text-zinc-200 mb-4">Live Signals</h2>
            <SignalsFeed />
          </div>
        </div>

        {/* Positions + Traders row */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 card-dark p-4">
            <h2 className="text-sm font-semibold text-zinc-200 mb-4">Open Positions</h2>
            <PositionsTable />
          </div>
          <div className="card-dark p-4">
            <h2 className="text-sm font-semibold text-zinc-200 mb-4">Top Traders</h2>
            <TopTraders />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
