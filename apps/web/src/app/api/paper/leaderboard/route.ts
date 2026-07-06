import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const INITIAL_BALANCE = 10_000;

export async function GET() {
  // Fetch all paper accounts with their closed positions
  const accounts = await db.paperAccount.findMany({
    include: {
      positions: {
        where: { status: "closed" },
        select: { pnl: true, pnlPct: true },
      },
    },
  });

  const rows = accounts
    .map((account) => {
      const closed = account.positions;
      const total_trades = closed.length;
      const total_pnl = closed.reduce((sum, p) => sum + (p.pnl ?? 0), 0);
      const roi_pct = (total_pnl / INITIAL_BALANCE) * 100;
      const wins = closed.filter((p) => (p.pnl ?? 0) > 0).length;
      const win_rate = total_trades > 0 ? (wins / total_trades) * 100 : 0;
      const handle = account.userId.slice(0, 8) + "...";

      return {
        handle,
        roi_pct,
        total_pnl,
        win_rate,
        total_trades,
        current_balance: account.balance,
      };
    })
    // Only include accounts that have at least one closed trade
    .filter((r) => r.total_trades > 0)
    .sort((a, b) => b.roi_pct - a.roi_pct)
    .slice(0, 20)
    .map((r, idx) => ({
      rank: idx + 1,
      handle: r.handle,
      roi_pct: r.roi_pct,
      total_pnl: r.total_pnl,
      win_rate: r.win_rate,
      total_trades: r.total_trades,
      current_balance: r.current_balance,
    }));

  return NextResponse.json({ leaderboard: rows });
}
