import type { Metadata } from "next";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

export const metadata: Metadata = { title: "Strategy Lab" };

export default function LabPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">Strategy Lab</h1>
          <p className="text-sm text-zinc-400 mt-0.5">Build, backtest, and deploy automated trading strategies</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Strategy Builder */}
          <div className="lg:col-span-2 card-dark p-6 flex flex-col gap-4">
            <h2 className="text-base font-semibold text-zinc-200">Signal Builder</h2>
            <div className="h-64 flex items-center justify-center border-2 border-dashed border-zinc-800 rounded-lg">
              <p className="text-zinc-500 text-sm">Drag-and-drop strategy builder — coming soon</p>
            </div>
          </div>

          {/* Backtest Config */}
          <div className="card-dark p-6 flex flex-col gap-4">
            <h2 className="text-base font-semibold text-zinc-200">Backtest</h2>
            <div className="flex flex-col gap-3">
              {[
                { label: "Start Date", value: "2024-01-01" },
                { label: "End Date", value: "2024-06-01" },
                { label: "Initial Capital", value: "$10,000" },
                { label: "Risk per Trade", value: "2%" },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-zinc-400">{label}</span>
                  <span className="text-zinc-200 font-mono">{value}</span>
                </div>
              ))}
              <button className="mt-2 w-full py-2 rounded-lg bg-cyan-500 text-zinc-950 text-sm font-semibold hover:bg-cyan-400 transition-colors">
                Run Backtest
              </button>
            </div>
          </div>
        </div>

        {/* Results placeholder */}
        <div className="card-dark p-6">
          <h2 className="text-base font-semibold text-zinc-200 mb-4">Backtest Results</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total Return", value: "—" },
              { label: "Sharpe Ratio", value: "—" },
              { label: "Max Drawdown", value: "—" },
              { label: "Win Rate", value: "—" },
            ].map(({ label, value }) => (
              <div key={label} className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
                <p className="text-xs text-zinc-500 mb-1">{label}</p>
                <p className="text-xl font-bold text-zinc-200 number-font">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
