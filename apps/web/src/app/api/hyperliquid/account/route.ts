import { NextRequest, NextResponse } from "next/server";
import { withCache } from "@/lib/financial-cache";
import { getAccountSummary, isValidAddress, looksLikePrivateKey } from "@/lib/hyperliquid";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const address = (req.nextUrl.searchParams.get("address") ?? "").trim();

  // SECURITY: refuse to forward anything that looks like a private key (64 hex).
  if (looksLikePrivateKey(address)) {
    return NextResponse.json(
      { error: "private_key_rejected", detail: "That is a private key, not an address. Never share it. Use your public 0x address (40 hex chars)." },
      { status: 400 },
    );
  }
  if (!isValidAddress(address)) {
    return NextResponse.json(
      { error: "invalid_address", detail: "Provide a valid 0x-prefixed 40-hex-char wallet address." },
      { status: 400 },
    );
  }

  const result = await withCache(
    `hl:account:${address.toLowerCase()}`,
    15,
    "hyperliquid",
    () => getAccountSummary(address),
  );

  if (!result.data) {
    return NextResponse.json(
      { error: "hyperliquid_unavailable", detail: result.error ?? "could not fetch account state" },
      { status: 502 },
    );
  }
  return NextResponse.json(result);
}
