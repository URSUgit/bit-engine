"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Users } from "lucide-react";
import { traderAvatarUrl } from "@/lib/avatar";

interface TraderSummary {
  trader: string;
  video_count: number;
  strategy_count: number;
}

export default function ScoutTradersPage() {
  const [traders, setTraders] = useState<TraderSummary[] | null>(null);

  useEffect(() => {
    fetch("/api/v1/scout/traders")
      .then((r) => r.json())
      .then((data: TraderSummary[]) => setTraders(data))
      .catch(() => setTraders([]));
  }, []);

  return (
    <div className="flex flex-col gap-5 p-6 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Traders</h1>
        <p className="text-sm text-slate-400 mt-1">
          Every trader Scout has extracted a real, backtestable strategy from — tap one for their full history.
        </p>
      </div>

      {traders === null && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
        </div>
      )}

      {traders !== null && traders.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Users className="w-8 h-8 text-slate-600" />
          <p className="text-sm text-slate-500">No traders with backtestable strategies yet.</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {traders?.map((t) => (
          <Link
            key={t.trader}
            href={`/lab/scout/traders/${encodeURIComponent(t.trader)}`}
            className="card-dark p-4 flex flex-col items-center gap-2 text-center hover:border-cyan-500/40 transition-colors"
          >
            <img
              src={traderAvatarUrl(t.trader)}
              alt={t.trader}
              className="w-16 h-16 rounded-full border border-slate-700 object-cover"
            />
            <p className="text-sm font-semibold text-slate-100 truncate w-full">{t.trader}</p>
            <p className="text-[11px] text-slate-500">
              {t.video_count} video{t.video_count === 1 ? "" : "s"} · {t.strategy_count} strateg
              {t.strategy_count === 1 ? "y" : "ies"}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
