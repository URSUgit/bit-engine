import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type NewsArticle = {
  title: string;
  url: string;
  source: string;
  time_published: string;
  summary: string;
  banner_image: string;
  overall_sentiment_score: number;
  overall_sentiment_label: string;
  topics: string[];
  ticker_sentiment: Array<{ ticker: string; sentiment_score: number; sentiment_label: string; relevance_score: number }>;
};

export async function GET(req: NextRequest) {
  const tickers = req.nextUrl.searchParams.get("tickers") ?? "";
  const topics = req.nextUrl.searchParams.get("topics") ?? "";
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);

  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return NextResponse.json(fail("alpha_vantage", "ALPHA_VANTAGE_API_KEY missing"));

  const result = await withCache(`av:news:${tickers}:${topics}:${limit}`, 300, "alpha_vantage", async () => {
    const params = new URLSearchParams({ function: "NEWS_SENTIMENT", apikey: key, limit: String(limit) });
    if (tickers) params.set("tickers", tickers);
    if (topics) params.set("topics", topics);
    const url = `https://www.alphavantage.co/query?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
    const j = (await res.json()) as {
      feed?: Array<{
        title: string; url: string; source: string; time_published: string;
        summary: string; banner_image: string;
        overall_sentiment_score: number; overall_sentiment_label: string;
        topics?: Array<{ topic: string }>;
        ticker_sentiment?: Array<{ ticker: string; ticker_sentiment_score: string; ticker_sentiment_label: string; relevance_score: string }>;
      }>;
      Note?: string; Information?: string;
    };
    if (j.Note || j.Information) throw new Error(j.Note ?? j.Information ?? "rate limited");
    return (j.feed ?? []).map<NewsArticle>((a) => ({
      title: a.title, url: a.url, source: a.source,
      time_published: a.time_published, summary: a.summary, banner_image: a.banner_image,
      overall_sentiment_score: a.overall_sentiment_score,
      overall_sentiment_label: a.overall_sentiment_label,
      topics: (a.topics ?? []).map((t) => t.topic),
      ticker_sentiment: (a.ticker_sentiment ?? []).map((t) => ({
        ticker: t.ticker,
        sentiment_score: parseFloat(t.ticker_sentiment_score),
        sentiment_label: t.ticker_sentiment_label,
        relevance_score: parseFloat(t.relevance_score),
      })),
    }));
  });

  return NextResponse.json(result);
}
