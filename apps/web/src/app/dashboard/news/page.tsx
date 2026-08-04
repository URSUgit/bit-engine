"use client";

import { useEffect, useState, useCallback } from "react";
import { ExternalLink, RefreshCw, TrendingUp, TrendingDown, Minus, Search, Filter, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NewsItem } from "@/app/api/market/crypto-news/route";

const CATEGORY_FILTERS = [
  { id: "", label: "All" },
  { id: "BTC", label: "Bitcoin" },
  { id: "ETH", label: "Ethereum" },
  { id: "Trading", label: "Trading" },
  { id: "Regulation", label: "Regulation" },
  { id: "Mining", label: "Mining" },
  { id: "Technology", label: "Technology" },
  { id: "Market", label: "Market" },
] as const;

const SENTIMENT_FILTER = ["all", "positive", "neutral", "negative"] as const;

const sentimentCfg = {
  positive: { icon: TrendingUp,   color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-500", label: "Bullish" },
  neutral:  { icon: Minus,        color: "text-slate-400",   bg: "bg-slate-700/40 border-slate-700",         dot: "bg-slate-500",  label: "Neutral" },
  negative: { icon: TrendingDown, color: "text-red-400",     bg: "bg-red-500/10 border-red-500/20",          dot: "bg-red-500",    label: "Bearish" },
} as const;

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function SentimentBadge({ sentiment }: { sentiment: NewsItem["sentiment"] }) {
  const cfg = sentimentCfg[sentiment];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border", cfg.bg, cfg.color)}>
      <Icon className="w-2.5 h-2.5" />
      {cfg.label}
    </span>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex gap-4 p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 hover:bg-slate-800/80 transition-all"
    >
      {item.imageurl && (
        <div className="w-20 h-16 rounded-lg overflow-hidden shrink-0 bg-slate-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.imageurl}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <h3 className="text-sm font-semibold text-slate-100 group-hover:text-white leading-snug line-clamp-2">
            {item.title}
          </h3>
          <ExternalLink className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 shrink-0 mt-0.5 transition-colors" />
        </div>
        {item.body && (
          <p className="text-[12px] text-slate-500 line-clamp-2 mb-2 leading-relaxed">{item.body}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-slate-500">{item.source}</span>
          <span className="text-slate-700">·</span>
          <span className="text-[11px] text-slate-600">{timeAgo(item.published_at)}</span>
          <SentimentBadge sentiment={item.sentiment} />
          {item.categories.slice(0, 3).map((cat) => (
            <span key={cat} className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 font-bold border border-slate-700/50">
              {cat}
            </span>
          ))}
        </div>
      </div>
    </a>
  );
}

function SentimentSummary({ news }: { news: NewsItem[] }) {
  const pos = news.filter((n) => n.sentiment === "positive").length;
  const neg = news.filter((n) => n.sentiment === "negative").length;
  const neu = news.filter((n) => n.sentiment === "neutral").length;
  const total = news.length || 1;
  return (
    <div className="card-dark p-4 flex items-center gap-6">
      <div>
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Sentiment</p>
        <div className="flex items-center gap-1 h-2 rounded-full overflow-hidden w-40">
          <div className="bg-emerald-500 h-full transition-all" style={{ width: `${(pos / total) * 100}%` }} />
          <div className="bg-slate-600 h-full transition-all" style={{ width: `${(neu / total) * 100}%` }} />
          <div className="bg-red-500 h-full transition-all" style={{ width: `${(neg / total) * 100}%` }} />
        </div>
      </div>
      <div className="flex gap-4 text-xs">
        <span className="text-emerald-400 font-bold">{pos} <span className="text-slate-500 font-normal">bullish</span></span>
        <span className="text-slate-400 font-bold">{neu} <span className="text-slate-500 font-normal">neutral</span></span>
        <span className="text-red-400 font-bold">{neg} <span className="text-slate-500 font-normal">bearish</span></span>
      </div>
    </div>
  );
}

export default function NewsPage() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState<(typeof SENTIMENT_FILTER)[number]>("all");
  const [search, setSearch] = useState("");

  const fetchNews = useCallback(async (cat: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (cat) params.set("categories", cat);
      const res = await fetch(`/api/market/crypto-news?${params.toString()}`);
      const json = await res.json();
      if (Array.isArray(json.data)) {
        setNews(json.data);
        setError(null);
      } else {
        setNews([]);
        setError(json.error ?? "News feed unavailable");
      }
    } catch {
      setNews([]);
      setError("News feed unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNews(category);
    const id = setInterval(() => fetchNews(category), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [category, fetchNews]);

  const filtered = news.filter((n) => {
    if (sentimentFilter !== "all" && n.sentiment !== sentimentFilter) return false;
    if (search && !n.title.toLowerCase().includes(search.toLowerCase()) && !n.source.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
      <div className="flex flex-col gap-6 p-6 max-w-[1400px] mx-auto">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Market News</h1>
            <p className="text-sm text-slate-400 mt-1">
              Real-time crypto news with sentiment analysis · updates every 5 minutes
            </p>
          </div>
          <button
            onClick={() => fetchNews(category)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>

        {/* Sentiment summary */}
        {news.length > 0 && <SentimentSummary news={news} />}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 flex-1 min-w-[200px] max-w-sm">
            <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search headlines…"
              className="bg-transparent text-sm text-slate-200 outline-none placeholder-slate-600 w-full"
            />
          </div>

          <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
            {CATEGORY_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setCategory(f.id)}
                className={cn(
                  "px-2.5 py-1.5 rounded text-xs font-medium transition-colors",
                  category === f.id
                    ? "bg-slate-800 text-cyan-300"
                    : "text-slate-500 hover:text-slate-300"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
            <Filter className="w-3 h-3 text-slate-500 mx-1.5" />
            {SENTIMENT_FILTER.map((f) => (
              <button
                key={f}
                onClick={() => setSentimentFilter(f)}
                className={cn(
                  "px-2.5 py-1.5 rounded text-xs font-medium capitalize transition-colors",
                  sentimentFilter === f
                    ? "bg-slate-800 text-cyan-300"
                    : "text-slate-500 hover:text-slate-300"
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* News list */}
        {loading && news.length === 0 ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-slate-900 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 text-center py-20 text-slate-500">
            <WifiOff className="w-6 h-6 text-slate-600" />
            <p className="text-lg mb-1 text-slate-300">News feed unavailable</p>
            <p className="text-sm max-w-md">{error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <p className="text-lg mb-2">No news found</p>
            <p className="text-sm">Try changing the filters</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((item) => (
              <NewsCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
  );
}
