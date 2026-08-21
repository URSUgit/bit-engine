"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Youtube, Plus, Trash2, RefreshCw, Loader2, Radar, Search, ListVideo, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { LiveAnalyzer } from "./live-analyzer";
import { type Analysis, AnalysisCard, api, timeAgo } from "./analysis-card";

// ─── Types (mirror /api/v1/scout payloads) ────────────────────────────────

interface Channel {
  id: string;
  name: string;
  auto?: boolean;
  found_via?: string;
}

interface DiscoveredChannel {
  id: string;
  name: string;
  query: string;
  watching: boolean;
}

interface DiscoveryLogEntry {
  query: string;
  found: number;
  at: number;
}

interface BacktestResult {
  strategy: string;
  symbol: string;
  interval: string;
  bars: number;
  total_return_pct: number;
  sharpe_ratio: number;
  max_drawdown_pct: number;
  total_trades: number;
  win_rate: number;
}

interface ScoutStatus {
  channels: Channel[];
  seen_videos: number;
  analyses: number;
  last_poll: number | null;
  poll_interval_s: number;
  running: boolean;
  auto_discover: boolean;
  last_discover: number | null;
  discover_interval_s: number;
  discovery_log: DiscoveryLogEntry[];
  discovered_count: number;
  discovery_alert: string | null;
  discovery_stale_cycles: number;
}

function LivePulse({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2 w-2">
      {active && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      )}
      <span
        className={cn(
          "relative inline-flex h-2 w-2 rounded-full",
          active ? "bg-emerald-400" : "bg-zinc-600"
        )}
      />
    </span>
  );
}

// ─── Discovery panel ────────────────────────────────────────────────────────

function DiscoveryPanel({
  status,
  discovered,
  onSearch,
  onWatch,
  busy,
  query,
  setQuery,
  autoWatch,
  setAutoWatch,
}: {
  status: ScoutStatus | null;
  discovered: DiscoveredChannel[];
  onSearch: () => void;
  onWatch: (c: DiscoveredChannel) => void;
  busy: boolean;
  query: string;
  setQuery: (v: string) => void;
  autoWatch: boolean;
  setAutoWatch: (v: boolean) => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        <Radar size={13} className="text-cyan-400" />
        Autonomous channel discovery
        <span className="ml-auto flex items-center gap-1.5 normal-case tracking-normal text-[11px] text-zinc-500">
          <LivePulse active={!!status?.auto_discover} />
          {status?.auto_discover ? "scanning YouTube live" : "auto-scan off"}
        </span>
      </div>

      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearch()}
          placeholder="e.g. crypto swing trading strategy"
          className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
        />
        <button
          onClick={onSearch}
          disabled={busy}
          className="flex items-center gap-1 rounded bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          Search
        </button>
      </div>
      <label className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-500">
        <input
          type="checkbox"
          checked={autoWatch}
          onChange={(e) => setAutoWatch(e.target.checked)}
          className="accent-cyan-500"
        />
        watch every result immediately
      </label>

      {status && status.discovery_log.length > 0 && (
        <div className="mt-3 max-h-28 space-y-1 overflow-y-auto border-t border-zinc-800/60 pt-2">
          {status.discovery_log.map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] text-zinc-500">
              <Radar size={10} className="shrink-0 text-zinc-600" />
              <span className="truncate text-zinc-400">&ldquo;{e.query}&rdquo;</span>
              <span className="ml-auto shrink-0">
                {e.found} found · {timeAgo(e.at)}
              </span>
            </div>
          ))}
        </div>
      )}

      {discovered.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto border-t border-zinc-800/60 pt-2">
          {discovered.map((c) => (
            <div
              key={c.id}
              className="flex w-40 shrink-0 flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-950/60 p-2"
            >
              <div className="flex items-center gap-1 truncate text-[11px] font-medium text-zinc-200">
                <Youtube size={11} className="shrink-0 text-red-500" />
                <span className="truncate">{c.name}</span>
              </div>
              <span className="truncate text-[10px] text-zinc-600" title={c.query}>
                via &ldquo;{c.query}&rdquo;
              </span>
              <button
                onClick={() => onWatch(c)}
                disabled={c.watching}
                className="mt-auto flex items-center justify-center gap-1 rounded border border-zinc-700 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                {c.watching ? "Watching" : (
                  <>
                    <Plus size={10} /> Watch
                  </>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function ScoutPage() {
  const [status, setStatus] = useState<ScoutStatus | null>(null);
  const [feed, setFeed] = useState<Analysis[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredChannel[]>([]);
  const [channelRef, setChannelRef] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [discoverQuery, setDiscoverQuery] = useState("crypto trading strategy");
  const [discoverAutoWatch, setDiscoverAutoWatch] = useState(false);
  const [busy, setBusy] = useState<"" | "channel" | "video" | "poll" | "discover">("");
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [st, fd, dv] = await Promise.all([
        api<ScoutStatus>("/status"),
        api<Analysis[]>("/feed?limit=50"),
        api<DiscoveredChannel[]>("/discovered?limit=20"),
      ]);
      setStatus(st);
      setFeed(fd);
      setDiscovered(dv.map((c) => ({ ...c, watching: st.channels.some((ch) => ch.id === c.id) })));
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [refresh]);

  const addChannel = async () => {
    if (!channelRef.trim()) return;
    setBusy("channel");
    setError(null);
    try {
      await api("/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: channelRef.trim() }),
      });
      setChannelRef("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const removeChannel = async (cid: string) => {
    await api(`/channels/${cid}`, { method: "DELETE" }).catch(() => undefined);
    await refresh();
  };

  const analyzeVideo = async () => {
    if (!videoUrl.trim()) return;
    setBusy("video");
    setError(null);
    try {
      await api("/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: videoUrl.trim() }),
      });
      setVideoUrl("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const pollNow = async () => {
    setBusy("poll");
    setError(null);
    try {
      await api("/poll", { method: "POST" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const discoverNow = async () => {
    if (!discoverQuery.trim()) return;
    setBusy("discover");
    setError(null);
    try {
      await api("/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: discoverQuery.trim(), auto_watch: discoverAutoWatch }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const watchDiscovered = async (c: DiscoveredChannel) => {
    setDiscovered((ds) => ds.map((d) => (d.id === c.id ? { ...d, watching: true } : d)));
    try {
      await api("/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: c.id }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex min-h-9 flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
          <Radar size={18} /> YouTube Scout
        </h1>
        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
          <LivePulse active={!!status?.running} />
          watches + discovers trading channels → named strategy models, signals, instant backtests
        </span>
        <Link
          href="/lab/scout/youtube"
          className="flex items-center gap-1.5 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          <ListVideo size={12} /> Browse my YouTube
        </Link>
        {status && (
          <span className="ml-auto flex items-center gap-3 text-xs text-zinc-500">
            {status.channels.length} channels ({status.channels.filter((c) => c.auto).length} auto) ·{" "}
            {status.seen_videos} videos seen
            {status.last_poll && <> · polled {timeAgo(status.last_poll)}</>}
            <button
              onClick={pollNow}
              disabled={busy === "poll"}
              className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              {busy === "poll" ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <RefreshCw size={11} />
              )}
              Poll now
            </button>
          </span>
        )}
        {offline && (
          <span className="rounded bg-red-950 px-2 py-0.5 text-xs text-red-300">
            signal-service unreachable
          </span>
        )}
      </div>

      {status?.discovery_alert && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{status.discovery_alert}</span>
        </div>
      )}

      {/* Inputs: watch a channel / analyze one video / autonomous discovery */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Watch a channel — new uploads auto-analyzed
          </div>
          <div className="flex gap-2">
            <input
              value={channelRef}
              onChange={(e) => setChannelRef(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addChannel()}
              placeholder="@handle, channel URL, or UC… id"
              className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
            />
            <button
              onClick={addChannel}
              disabled={busy === "channel"}
              className="flex items-center gap-1 rounded bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
            >
              {busy === "channel" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Plus size={12} />
              )}
              Watch
            </button>
          </div>
          {status && status.channels.length > 0 && (
            <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto">
              {status.channels.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-xs text-zinc-300">
                  <Youtube size={12} className="shrink-0 text-red-500" />
                  <span className="truncate">{c.name}</span>
                  {c.auto && (
                    <span
                      className="flex shrink-0 items-center gap-0.5 rounded bg-cyan-950/60 px-1 py-0.5 text-[9px] text-cyan-300"
                      title={c.found_via ? `auto-discovered via "${c.found_via}"` : "auto-discovered"}
                    >
                      <Radar size={8} /> auto
                    </span>
                  )}
                  <button
                    onClick={() => removeChannel(c.id)}
                    className="ml-auto shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                    title="Stop watching"
                  >
                    <Trash2 size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Analyze one video now
          </div>
          <div className="flex gap-2">
            <input
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && analyzeVideo()}
              placeholder="https://www.youtube.com/watch?v=…"
              className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
            />
            <button
              onClick={analyzeVideo}
              disabled={busy === "video"}
              className="flex items-center gap-1 rounded bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
            >
              {busy === "video" ? <Loader2 size={12} className="animate-spin" /> : <Radar size={12} />}
              Analyze
            </button>
          </div>
          <p className="mt-2 text-[11px] text-zinc-600">
            Transcript → assets, sentiment, signals, and named strategy models you can backtest with
            one click. Uses the LLM when an API key is configured, a deterministic extractor otherwise.
          </p>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>

        <DiscoveryPanel
          status={status}
          discovered={discovered}
          onSearch={discoverNow}
          onWatch={watchDiscovered}
          busy={busy === "discover"}
          query={discoverQuery}
          setQuery={setDiscoverQuery}
          autoWatch={discoverAutoWatch}
          setAutoWatch={setDiscoverAutoWatch}
        />
      </div>

      <LiveAnalyzer onDone={(rec) => setFeed((f) => [rec, ...f])} />

      {/* Live feed */}
      <div className="space-y-3">
        {feed.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-center text-xs text-zinc-500">
            No analyses yet — watch a channel or paste a video URL above. New uploads on watched
            channels appear here automatically (checked every{" "}
            {Math.round((status?.poll_interval_s ?? 180) / 60)} min).
          </div>
        ) : (
          feed.map((a) => <AnalysisCard key={a.id} a={a} />)
        )}
      </div>
    </div>
  );
}
