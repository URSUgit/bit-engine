import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const NONCE_TTL_MS = 10 * 60 * 1000;

/** Issue a single-use SIWE nonce for an address, stored server-side. */
export async function GET(req: NextRequest) {
  const address = (req.nextUrl.searchParams.get("address") ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return Response.json({ error: "invalid address" }, { status: 400 });
  }
  const nonce = randomBytes(16).toString("hex");
  const identifier = `siwe:${address}`;
  // One live nonce per address: replace any previous one.
  await db.verificationToken.deleteMany({ where: { identifier } });
  await db.verificationToken.create({
    data: { identifier, token: nonce, expires: new Date(Date.now() + NONCE_TTL_MS) },
  });
  return Response.json({ nonce, issuedAt: new Date().toISOString() });
}
