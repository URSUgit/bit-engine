"use client";

import { usePaperTrading } from "@/hooks/usePaperTrading";

export function DashboardSubtitle() {
  const { livePositions, mounted } = usePaperTrading();
  const count = mounted ? livePositions.length : null;
  return (
    <p className="text-sm text-slate-400 mt-0.5">
      {count !== null ? `${count} open position${count !== 1 ? "s" : ""}` : "—"} · 3 traders being copied
    </p>
  );
}
