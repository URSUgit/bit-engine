import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import type { Hash } from "viem";
import { authOptions } from "@/lib/auth";
import { billingConfig, verifyUsdcPayment } from "@/lib/billing";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Billing status + everything the pay button needs. */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const cfg = billingConfig();
  let plan = "free";
  let address: string | null = null;
  let payments: { txHash: string; amount: string; createdAt: Date }[] = [];
  if (userId) {
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { payments: { orderBy: { createdAt: "desc" }, take: 5 } },
    });
    plan = user?.plan ?? "free";
    address = user?.address ?? null;
    payments = (user?.payments ?? []).map((p) => ({
      txHash: p.txHash,
      amount: p.amount,
      createdAt: p.createdAt,
    }));
  }
  return Response.json({
    authenticated: Boolean(userId),
    plan,
    address,
    payments,
    chainId: cfg.chainId,
    chainName: cfg.chainName,
    receiver: cfg.receiver,
    usdc: cfg.usdc,
    proPriceUsdc: cfg.proPriceUsdc,
    configured: cfg.configured,
  });
}

/** Verify an on-chain USDC payment and upgrade the user's plan. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return Response.json({ error: "Sign in first" }, { status: 401 });

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user?.address) {
    return Response.json(
      { error: "Your account has no wallet address — sign in with your wallet" },
      { status: 400 }
    );
  }

  let txHash: string;
  try {
    ({ txHash } = (await req.json()) as { txHash: string });
  } catch {
    return Response.json({ error: "Body must be JSON: { txHash }" }, { status: 400 });
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? "")) {
    return Response.json({ error: "Invalid transaction hash" }, { status: 400 });
  }

  // Replay-proof: each transaction upgrades exactly one account, once.
  const existing = await db.onchainPayment.findUnique({ where: { txHash } });
  if (existing) {
    return Response.json({ error: "This transaction was already used" }, { status: 409 });
  }

  const result = await verifyUsdcPayment(txHash as Hash, user.address as `0x${string}`);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 422 });

  const cfg = billingConfig();
  await db.$transaction([
    db.onchainPayment.create({
      data: {
        userId,
        txHash,
        chainId: cfg.chainId,
        token: cfg.usdc,
        amount: result.amountUnits.toString(),
        plan: "pro",
      },
    }),
    db.user.update({ where: { id: userId }, data: { plan: "pro" } }),
  ]);

  return Response.json({
    ok: true,
    plan: "pro",
    amountUsdc: Number(result.amountUnits) / 1e6,
    txHash,
  });
}
