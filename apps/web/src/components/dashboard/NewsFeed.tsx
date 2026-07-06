"use client";

import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NewsItem } from "@/app/api/market/crypto-news/route";

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

const sentimentConfig = {
  positive: { icon: TrendingUp,   color: "text-emerald-400", bg: "bg-emerald-500/10", dot: "bg-emerald-500" },
  neutral:  { icon: Minus,        color: "text-slate-400",   bg: "bg-slate-500/10",   dot: "bg-slate-500" },
  negative: { icon: TrendingDown, color: "text-red-400",     bg: "bg-red-500/10",     dot: "bg-red-500" },
};

export function NewsFeed({ categories }: { categories?: string }) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  async function fetchNews() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "12" });
      if (categories) params.set("categories", categories);
      const res = await fetch(`/api/market/crypto-news?${params.toString()}`);
      const json = await res.json();
      const items: NewsItem[] = Array.isArray(json.data) ? json.data : [];
      setNews(items);
      setLastFetched(new Date());
    } catch {
      // keep previous
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchNews();
    const id = setInterval(fetchNews, 5 * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories]);

  if (loading && news.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-14 rounded-lg bg-slate-800/40 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!loading && news.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <p className="text-sm text-slate-500">No news available</p>
        <button onClick={fetchNews} className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors">
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between mb-2 px-0.5">
        <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
          {lastFetched ? `Updated ${timeAgo(lastFetched.toISOString())}` : "Live news"}
        </span>
        <button
          onClick={fetchNews}
          className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
        </button>
      </div>

      {news.map((item) => {
        const s = sentimentConfig[item.sentiment];
        const SIcon = s.icon;
        return (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-800/60 transition-colors"
          >
            <div className={cn("w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5", s.bg)}>
              <SIcon className={cn("w-3.5 h-3.5", s.color)} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-slate-200 group-hover:text-slate-100 leading-snug line-clamp-2">
                {item.title}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[11px] text-slate-500 font-medium">{item.source}</span>
                <span className="text-slate-700">·</span>
                <span className="text-[11px] text-slate-600">{timeAgo(item.published_at)}</span>
                {item.categories.slice(0, 2).map((cat) => (
                  <span key={cat} className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-slate-800 text-slate-500 font-bold">
                    {cat}
                  </span>
                ))}
              </div>
            </div>
            <ExternalLink className="w-3 h-3 text-slate-600 group-hover:text-slate-400 shrink-0 mt-1 transition-colors" />
          </a>
        );
      })}
    </div>
  );
}
