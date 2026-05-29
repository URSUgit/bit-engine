import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;

  const account = await db.paperAccount.upsert({
    where: { userId },
    create: { userId, balance: 10_000 },
    update: { balance: 10_000 },
  });

  // Close all open positions without refund (reset wipes slate clean)
  await db.paperPosition.updateMany({
    where: { accountId: account.id, status: "open" },
    data: { status: "closed", closedAt: new Date(), pnl: 0, pnlPct: 0 },
  });

  return NextResponse.json({ ok: true });
}
