export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;

  const items = await db.watchlistItem.findMany({
    where: { userId },
    orderBy: { addedAt: "desc" },
    select: { id: true, symbol: true, addedAt: true },
  });

  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const { symbol } = await req.json();

  const item = await db.watchlistItem.upsert({
    where: { userId_symbol: { userId, symbol } },
    update: {},
    create: { userId, symbol },
    select: { id: true, symbol: true, addedAt: true },
  });

  return NextResponse.json({ item });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;

  const { searchParams } = new URL(req.url);
  let symbol = searchParams.get("symbol");

  if (!symbol) {
    const body = await req.json().catch(() => ({}));
    symbol = body.symbol ?? null;
  }

  await db.watchlistItem.delete({
    where: { userId_symbol: { userId, symbol: symbol as string } },
  });

  return NextResponse.json({ deleted: true });
}
