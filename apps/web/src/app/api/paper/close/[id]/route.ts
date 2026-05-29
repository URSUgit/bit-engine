import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

function calcPnl(sizeUsd: number, entryPrice: number, closePrice: number, side: string, leverage: number) {
  const direction = side === "long" ? 1 : -1;
  const pnl_pct = ((closePrice / entryPrice - 1) * direction) * leverage * 100;
  const pnl = sizeUsd * (pnl_pct / 100);
  return { pnl, pnl_pct };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const { close_price } = await req.json() as { close_price: number };

  const account = await db.paperAccount.findUnique({
    where: { userId },
    include: { positions: { where: { id: params.id, status: "open" } } },
  });

  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  const pos = account.positions[0];
  if (!pos) return NextResponse.json({ error: "Position not found or already closed" }, { status: 404 });

  const { pnl, pnl_pct } = calcPnl(pos.sizeUsd, pos.entryPrice, close_price, pos.side, pos.leverage);
  const margin = pos.sizeUsd / pos.leverage;
  const refund = margin + pnl;

  await db.$transaction([
    db.paperPosition.update({
      where: { id: pos.id },
      data: {
        status: "closed",
        closePrice: close_price,
        closedAt: new Date(),
        pnl: parseFloat(pnl.toFixed(2)),
        pnlPct: parseFloat(pnl_pct.toFixed(2)),
      },
    }),
    db.paperAccount.update({
      where: { id: account.id },
      data: { balance: { increment: refund } },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
