"use client";

import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { usePro, useUIModeStore } from "@/store";

export default function Layout({ children }: { children: React.ReactNode }) {
  const isPro = usePro();
  const setMode = useUIModeStore((s) => s.setMode);

  if (!isPro) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center gap-4 p-12 text-center max-w-md mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <FlaskConical className="w-7 h-7 text-violet-400" />
          </div>
          <h1 className="text-lg font-bold text-slate-100">Lab tools are part of Pro mode</h1>
          <p className="text-sm text-slate-500">
            Backtesting, strategy building, and the other Lab tools are advanced tools hidden while you're in
            Simple mode. Switch to Pro to use them.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => setMode("pro")}
              className="px-4 py-2 rounded-lg bg-violet-500 text-white text-sm font-semibold hover:bg-violet-400 transition-colors"
            >
              Switch to Pro mode
            </button>
            <Link
              href="/dashboard"
              className="px-4 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 text-sm font-medium hover:bg-slate-800 transition-colors"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return <DashboardLayout>{children}</DashboardLayout>;
}
