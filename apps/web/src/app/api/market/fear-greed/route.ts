import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export type FearGreedEntry = {
  value: number;
  value_classification: string;
  timestamp: number;
};

export type FearGreedResponse = {
  current: FearGreedEntry;
  history: FearGreedEntry[];
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "30", 10), 90);

  try {
    const res = await fetch(`https://api.alternative.me/fng/?limit=${limit}&format=json`, {
      next: { revalidate: 3600 },
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data: Array<{ value: string; value_classification: string; timestamp: string }> };
    const entries: FearGreedEntry[] = (json.data ?? []).map((d) => ({
      value: parseInt(d.value, 10),
      value_classification: d.value_classification,
      timestamp: parseInt(d.timestamp, 10),
    }));
    return NextResponse.json({
      current: entries[0] ?? { value: 50, value_classification: "Neutral", timestamp: Date.now() / 1000 },
      history: entries,
    } satisfies FearGreedResponse);
  } catch {
    return NextResponse.json(
      { current: { value: 50, value_classification: "Neutral", timestamp: Date.now() / 1000 }, history: [] },
      { status: 200 },
    );
  }
}
