import { NextRequest, NextResponse } from "next/server";
import { withCache } from "@/lib/financial-cache";
import { getUserFills, isValidAddress, looksLikePrivateKey } from "@/lib/hyperliquid";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const address = (req.nextUrl.searchParams.get("address") ?? "").trim();
  const limit = Math.min(500, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "100", 10) || 100));

  if (looksLikePrivateKey(address)) {
    return NextResponse.json(
      { error: "private_key_rejected", detail: "That is a private key, not an address. Never share it." },
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
    `hl:fills:${address.toLowerCase()}:${limit}`,
    30,
    "hyperliquid",
    () => getUserFills(address, limit),
  );

  if (!result.data) {
    return NextResponse.json(
      { error: "hyperliquid_unavailable", detail: result.error ?? "could not fetch fills" },
      { status: 502 },
    );
  }
  return NextResponse.json(result);
}
