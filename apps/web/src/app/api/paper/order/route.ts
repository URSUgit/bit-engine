import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const body = await req.json() as {
    symbol: string;
    side: "long" | "short";
    size_usd: number;
    entry_price: number;
    leverage: number;
    take_profit?: number | null;
    stop_loss?: number | null;
  };

  // Ensure account exists
  let account = await db.paperAccount.findUnique({ where: { userId } });
  if (!account) {
    account = await db.paperAccount.create({ data: { userId, balance: 10_000 } });
  }

  const margin = body.size_usd / body.leverage;
  if (margin > account.balance) {
    return NextResponse.json(
      { error: `Insufficient balance. Need $${margin.toFixed(2)}, have $${account.balance.toFixed(2)}` },
      { status: 400 }
    );
  }

  const posId = `pos_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const [position] = await db.$transaction([
    db.paperPosition.create({
      data: {
        id: posId,
        accountId: account.id,
        symbol: body.symbol,
        side: body.side,
        sizeUsd: body.size_usd,
        entryPrice: body.entry_price,
        leverage: body.leverage,
        takeProfit: body.take_profit ?? null,
        stopLoss: body.stop_loss ?? null,
        openedAt: new Date(),
        status: "open",
      },
    }),
    db.paperAccount.update({
      where: { id: account.id },
      data: { balance: { decrement: margin } },
    }),
  ]);

  return NextResponse.json({ position });
}
