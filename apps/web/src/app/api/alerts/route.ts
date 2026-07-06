export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;

  const { searchParams } = new URL(req.url);
  const activeParam = searchParams.get("active");

  const where: { userId: string; active?: boolean } = { userId };
  if (activeParam === "true") where.active = true;

  const alerts = await db.priceAlert.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      symbol: true,
      condition: true,
      price: true,
      active: true,
      triggeredAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ alerts });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const { symbol, condition, price } = await req.json();

  const alert = await db.priceAlert.create({
    data: { userId, symbol, condition, price },
    select: {
      id: true,
      symbol: true,
      condition: true,
      price: true,
      active: true,
      triggeredAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ alert });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") as string;

  await db.priceAlert.deleteMany({
    where: { id, userId },
  });

  return NextResponse.json({ deleted: true });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const { id, active, triggeredAt } = await req.json();

  const data: { active?: boolean; triggeredAt?: Date | null } = {};
  if (active !== undefined) data.active = active;
  if (triggeredAt !== undefined) data.triggeredAt = triggeredAt ? new Date(triggeredAt) : null;

  await db.priceAlert.updateMany({ where: { id, userId }, data });

  const alert = await db.priceAlert.findFirst({
    where: { id, userId },
    select: { id: true, symbol: true, condition: true, price: true, active: true, triggeredAt: true, createdAt: true },
  });

  return NextResponse.json({ alert });
}
