"use client";

import { useEffect, useRef, useState } from "react";

type Video = { video_id: string; title: string; channel: string; thumbnail: string | null; url: string };
type SearchPage = { videos: Video[]; next_page_token: string | null };
const searchUrl = (query: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

export function YouTubeVideoPicker({ enabled, disabled, selectedUrl, onSelect }: {
  enabled: boolean | null;
  disabled: boolean;
  selectedUrl: string;
  onSelect: (url: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<(SearchPage & { query: string }) | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function search(term: string, pageToken?: string) {
    if (enabled !== true || disabled || active.current || term.length < 2) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError("");
    if (!pageToken) setResults(null);
    try {
      const response = await fetch("/api/v1/backtest/video-strategy/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: term, ...(pageToken ? { page_token: pageToken } : {}) }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not search YouTube.");
      const page = data as SearchPage;
      setResults((prev) => ({ ...page, query: term, videos: pageToken && prev
        ? [...new Map([...prev.videos, ...page.videos].map((video) => [video.video_id, video])).values()]
        : page.videos }));
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not search YouTube.");
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return (
    <section aria-label="Browse YouTube videos" className="space-y-3 rounded border border-zinc-700 p-3 text-sm">
      <form onSubmit={(e) => { e.preventDefault(); void search(query.trim()); }}>
        <label htmlFor="strategy-youtube-query" className="font-medium">Find a YouTube video</label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input id="strategy-youtube-query" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            maxLength={120} disabled={disabled} placeholder="e.g. BTC previous-day breakout"
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-3 py-2" />
          {enabled && <button type="submit" disabled={disabled || pending || query.trim().length < 2}
            className="rounded bg-cyan-500 px-3 py-2 font-semibold text-zinc-950 disabled:opacity-40">Search videos</button>}
        </div>
      </form>
      <p className="text-xs text-zinc-400">{enabled === false
        ? "In-app search needs a YouTube Data API key. You can browse on YouTube and paste the video link below without one."
        : "Choose a result to fill the video link. Selecting a video does not start analysis."}{" "}
        <a className="text-cyan-300 underline" target="_blank" rel="noreferrer" href={searchUrl(query.trim() || "trading strategies")}>Open YouTube search</a>
      </p>
      {pending && <p role="status">Searching YouTube…</p>}
      {error && <p role="alert" className="text-red-300">{error}</p>}
      {results && <>
        <p role="status" className="text-zinc-400">{results.videos.length ? `Results for “${results.query}”` : `No videos found for “${results.query}”.`}</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {results.videos.map((video) => <li key={video.video_id} className="flex min-w-0 gap-3 rounded border border-zinc-700 p-2">
            {video.thumbnail && (
              // Direct, lazy-loaded public thumbnail; no video embed or autoplay.
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" width={112} height={63} loading="lazy" referrerPolicy="no-referrer" src={video.thumbnail}
                className="aspect-video h-fit w-24 shrink-0 rounded object-cover sm:w-28" />
            )}
            <div className="min-w-0 space-y-1">
              <p className="break-words font-medium">{video.title}</p>
              <p className="break-words text-xs text-zinc-400">{video.channel}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <a href={video.url} target="_blank" rel="noreferrer" aria-label={`Watch on YouTube: ${video.title}`} className="text-cyan-300 underline">Watch</a>
                <button type="button" aria-label={`Select video: ${video.title}`} aria-pressed={selectedUrl === video.url}
                  disabled={disabled || selectedUrl === video.url} onClick={() => onSelect(video.url)}
                  className="rounded border border-cyan-700 px-2 py-1 text-cyan-200 disabled:border-zinc-700 disabled:text-zinc-400">
                  {selectedUrl === video.url ? "Selected" : "Select video"}
                </button>
              </div>
            </div>
          </li>)}
        </ul>
        {results.next_page_token && <button type="button" disabled={disabled || pending}
          onClick={() => void search(results.query, results.next_page_token ?? undefined)}
          className="rounded border border-zinc-600 px-3 py-1.5 disabled:opacity-40">Load more videos</button>}
      </>}
    </section>
  );
}
