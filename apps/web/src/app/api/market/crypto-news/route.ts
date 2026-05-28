import { NextRequest, NextResponse } from "next/server";
import { withCache } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  imageurl: string;
  source: string;
  published_at: string;
  categories: string[];
  body: string;
  sentiment: "positive" | "neutral" | "negative";
};

const SENTIMENT_POSITIVE = ["bullish", "surge", "rally", "gain", "record", "high", "buy", "rise", "pump", "up"];
const SENTIMENT_NEGATIVE = ["bearish", "crash", "drop", "plunge", "sell", "loss", "fear", "low", "dump", "down"];

function inferSentiment(title: string): NewsItem["sentiment"] {
  const t = title.toLowerCase();
  const pos = SENTIMENT_POSITIVE.filter((w) => t.includes(w)).length;
  const neg = SENTIMENT_NEGATIVE.filter((w) => t.includes(w)).length;
  if (pos > neg) return "positive";
  if (neg > pos) return "negative";
  return "neutral";
}

export async function GET(req: NextRequest) {
  const categories = req.nextUrl.searchParams.get("categories") ?? "";
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10), 50);
  const cacheKey = `cc:news:${categories}:${limit}`;

  const result = await withCache(cacheKey, 300, "cryptocompare", async () => {
    const params = new URLSearchParams({ lang: "EN" });
    if (categories) params.set("categories", categories);
    const url = `https://min-api.cryptocompare.com/data/v2/news/?${params.toString()}`;

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) throw new Error(`CryptoCompare HTTP ${res.status}`);

    const j = (await res.json()) as {
      Type?: number;
      Message?: string;
      Data?: Array<{
        id: string;
        title: string;
        url: string;
        imageurl: string;
        source: string;
        published_on: number;
        categories: string;
        body: string;
      }>;
    };

    if (j.Type !== 100) throw new Error(j.Message ?? "CryptoCompare error");

    return (j.Data ?? []).slice(0, limit).map<NewsItem>((a) => ({
      id: String(a.id),
      title: a.title,
      url: a.url,
      imageurl: a.imageurl,
      source: a.source,
      published_at: new Date(a.published_on * 1000).toISOString(),
      categories: a.categories ? a.categories.split("|").filter(Boolean) : [],
      body: a.body?.slice(0, 300) ?? "",
      sentiment: inferSentiment(a.title),
    }));
  });

  return NextResponse.json(result);
}
