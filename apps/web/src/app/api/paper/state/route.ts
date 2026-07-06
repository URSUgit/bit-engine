import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;

  const account = await db.paperAccount.findUnique({
    where: { userId },
    include: { positions: { orderBy: { openedAt: "desc" } } },
  });

  if (!account) {
    // Lazy-create the paper account on first access
    const created = await db.paperAccount.create({
      data: { userId, balance: 10_000 },
      include: { positions: true },
    });
    return NextResponse.json({ balance: created.balance, positions: [] });
  }

  return NextResponse.json({
    balance: account.balance,
    positions: account.positions.map(toApiPosition),
  });
}

function toApiPosition(p: {
  id: string; symbol: string; side: string; sizeUsd: number; entryPrice: number;
  leverage: number; takeProfit: number | null; stopLoss: number | null;
  openedAt: Date; status: string; closePrice: number | null; closedAt: Date | null;
  pnl: number | null; pnlPct: number | null;
}) {
  return {
    id: p.id,
    symbol: p.symbol,
    side: p.side,
    size_usd: p.sizeUsd,
    entry_price: p.entryPrice,
    leverage: p.leverage,
    take_profit: p.takeProfit,
    stop_loss: p.stopLoss,
    opened_at: p.openedAt.toISOString(),
    status: p.status,
    close_price: p.closePrice,
    closed_at: p.closedAt?.toISOString() ?? null,
    pnl: p.pnl,
    pnl_pct: p.pnlPct,
  };
}
