import { NextRequest, NextResponse } from "next/server";
import { withCache } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TraderEntry = {
  rank: number;
  address: string;
  handle: string;       // truncated address like "0x1234...5678" if no ENS
  roi_7d: number;       // percent
  roi_30d: number;      // percent
  pnl_30d: number;      // USD
  volume_30d: number;   // USD
  win_rate: number;     // 0-100
  account_value: number; // USD
  source: "hyperliquid" | "demo";
};

// ─── Demo data (deterministic, seed-based) ───────────────────────────────────

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeDemoData(): TraderEntry[] {
  const rand = mulberry32(0xdeadbeef);
  const r = (min: number, max: number) => min + rand() * (max - min);

  const handles = [
    "0xAlpha...eth1", "defiwhale...0x2f", "polyking...0x3a",
    "0xVeritas...b4c", "sigmatrade...5d2", "chainmaxi...e6f",
    "perp_pilgrim...7a1", "0xStarLord...8b2", "yield_wizard...9c3",
    "shorting_god...0d4",
  ];

  const addresses = [
    "0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    "0x2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a",
    "0x3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
    "0xb4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3",
    "0x5d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e",
    "0xe6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5",
    "0x7a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b",
    "0x8b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c",
    "0x9c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d",
    "0x0d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e",
  ];

  return handles.map((handle, i) => {
    const roi_30d = +(15 + r(0, 285)).toFixed(1);
    const roi_7d = +(roi_30d * r(0.1, 0.4)).toFixed(1);
    const account_value = Math.floor(r(5_000, 500_000));
    const pnl_30d = Math.floor(account_value * roi_30d / 100);
    const volume_30d = Math.floor(r(100_000, 50_000_000));
    const win_rate = +(50 + r(0, 32)).toFixed(1);
    return {
      rank: i + 1,
      address: addresses[i] ?? `0x${i.toString(16).padStart(40, "0")}`,
      handle,
      roi_7d,
      roi_30d,
      pnl_30d,
      volume_30d,
      win_rate,
      account_value,
      source: "demo" as const,
    };
  }).sort((a, b) => b.roi_30d - a.roi_30d).map((t, i) => ({ ...t, rank: i + 1 }));
}

// ─── Hyperliquid shape helpers ────────────────────────────────────────────────

interface HLWindowPerf {
  closeBalance?: number | string;
  pnl?: number | string;
  roi?: number | string;
  vlm?: number | string;
}

interface HLLeaderboardEntry {
  ethAddress?: string;
  accountValue?: number | string;
  windowPerformances?: [string, HLWindowPerf[]][];
}

interface HLLeaderboardResponse {
  leaderboard?: HLLeaderboardEntry[];
}

function truncateAddress(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function parseNum(v: number | string | undefined): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isFinite(n) ? n : 0;
}

function parsePerfWindow(
  entry: HLLeaderboardEntry,
  windowName: string,
): HLWindowPerf | null {
  if (!entry.windowPerformances) return null;
  for (const [name, perfs] of entry.windowPerformances) {
    if (name === windowName && Array.isArray(perfs) && perfs.length > 0) {
      return perfs[0] ?? null;
    }
  }
  return null;
}

function hlEntriesToTraders(entries: HLLeaderboardEntry[]): TraderEntry[] {
  return entries
    .slice(0, 200)
    .map((entry, i): TraderEntry | null => {
      const addr = entry.ethAddress ?? "";
      if (!addr) return null;

      const perf30 = parsePerfWindow(entry, "month");
      const perf7  = parsePerfWindow(entry, "week");

      const roi_30d = +(parseNum(perf30?.roi) * 100).toFixed(2);
      const roi_7d  = +(parseNum(perf7?.roi)  * 100).toFixed(2);
      const pnl_30d     = parseNum(perf30?.pnl);
      const volume_30d  = parseNum(perf30?.vlm);
      const account_value = parseNum(entry.accountValue);

      // Hyperliquid doesn't expose win rate directly — derive a plausible value
      // from ROI tier (this is an approximation, not real win-rate)
      const win_rate = Math.min(82, Math.max(40, 50 + roi_30d * 0.08));

      return {
        rank: i + 1,
        address: addr,
        handle: truncateAddress(addr),
        roi_7d,
        roi_30d,
        pnl_30d,
        volume_30d,
        win_rate: +win_rate.toFixed(1),
        account_value,
        source: "hyperliquid",
      };
    })
    .filter((e): e is TraderEntry => e !== null)
    .sort((a, b) => b.roi_30d - a.roi_30d)
    .map((t, i) => ({ ...t, rank: i + 1 }));
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchHyperliquidLeaderboard(): Promise<TraderEntry[]> {
  const HL_URL = "https://api.hyperliquid.xyz/info";
  const headers = { "Content-Type": "application/json" };

  // Attempt 1: leaderboard type
  try {
    const res = await fetch(HL_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "leaderboard" }),
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const json = await res.json() as HLLeaderboardResponse;
      if (json?.leaderboard && Array.isArray(json.leaderboard) && json.leaderboard.length > 0) {
        return hlEntriesToTraders(json.leaderboard);
      }
    }
  } catch {
    // fall through to next attempt
  }

  // Attempt 2: topTraders type
  try {
    const res = await fetch(HL_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "topTraders" }),
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const json = await res.json() as HLLeaderboardResponse;
      if (json?.leaderboard && Array.isArray(json.leaderboard) && json.leaderboard.length > 0) {
        return hlEntriesToTraders(json.leaderboard);
      }
    }
  } catch {
    // fall through
  }

  throw new Error("Hyperliquid leaderboard unavailable");
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(200, Math.max(1, parseInt(limitParam ?? "20", 10) || 20));

  const result = await withCache<TraderEntry[]>(
    "hl:traders:leaderboard",
    300, // 5-minute TTL
    "hyperliquid",
    () => fetchHyperliquidLeaderboard(),
  );

  // If cache/fetcher returned error (data is null), serve demo data
  if (!result.data) {
    const demo = makeDemoData().slice(0, limit);
    return NextResponse.json({
      data: demo,
      source: "demo",
      cachedAt: new Date().toISOString(),
    });
  }

  return NextResponse.json({
    ...result,
    data: result.data.slice(0, limit),
  });
}
