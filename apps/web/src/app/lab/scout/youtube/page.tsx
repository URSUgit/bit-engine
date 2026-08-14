"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ElementType } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Youtube,
  Loader2,
  RefreshCw,
  LogOut,
  Heart,
  ListMusic,
  Rss,
  ArrowLeft,
  Search,
  Plus,
  Check,
  Radar,
  CheckCircle2,
  ListChecks,
  Users,
  X,
} from "lucide-react";
import { LiveAnalyzer, type LiveAnalyzerHandle } from "../live-analyzer";
import { timeAgo } from "../analysis-card";

interface Video {
  video_id: string;
  title: string;
  channel: string;
  channel_id: string | null;
  thumbnail: string | null;
  published_at: string | null;
  url: string;
}

interface VideoPage {
  videos: Video[];
  next_page_token: string | null;
}

interface Status {
  connected: boolean;
  channel: { title: string; thumbnail: string | null } | null;
}

interface ScoutStatus {
  channels: { id: string; name: string; auto?: boolean }[];
  seen_videos: number;
  analyses: number;
  last_poll: number | null;
  poll_interval_s: number;
  running: boolean;
  auto_discover: boolean;
  last_discover: number | null;
  discover_interval_s: number;
}

interface DiscoverCandidate {
  id: string;
  name: string;
  query: string;
  watching: boolean;
}

async function yt<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/youtube${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status}`);
  }
  return res.json();
}

type Tab = "discover" | "feed" | "liked" | "playlist" | "search";

// Mirrors app/scout/service.py's SEED_QUERIES — these are the same queries
// Scout's own autonomous discovery rotates through, kept in sync here so
// manual discovery stays focused on trading channels rather than arbitrary
// keyword search.
const TRADING_PRESETS = [
  "crypto day trading strategy",
  "bitcoin technical analysis live",
  "swing trading crypto signals",
  "altcoin trading strategy",
  "futures trading strategy crypto",
  "price action trading crypto",
  "crypto scalping strategy",
  "trading indicators explained",
];

async function watchChannel(channelId: string): Promise<void> {
  const res = await fetch("/api/v1/scout/channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: channelId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status}`);
  }
}

async function loadWatchedChannelIds(): Promise<Set<string>> {
  const res = await fetch("/api/v1/scout/channels");
  if (!res.ok) return new Set();
  const channels: { id: string }[] = await res.json();
  return new Set(channels.map((c) => c.id));
}

interface ChannelSummary {
  channel_id: string;
  channel: string;
  thumbnail: string | null;
  sample_url: string;
}

interface LatestVideo {
  video_id: string;
  title: string;
  url: string;
}

async function latestVideoForChannel(channelId: string): Promise<LatestVideo | null> {
  const res = await fetch(`/api/v1/scout/channels/${channelId}/latest`);
  if (!res.ok) return null;
  return res.json();
}

const VALID_TABS: Tab[] = ["discover", "feed", "liked", "playlist", "search"];

export default function YoutubeBrowsePage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [tab, setTabState] = useState<Tab>("discover");
  const [videos, setVideos] = useState<Video[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [playlistInput, setPlaylistInput] = useState("");
  const [playlistId, setPlaylistId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [discoverInput, setDiscoverInput] = useState("");
  const [discoverCandidates, setDiscoverCandidates] = useState<DiscoverCandidate[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [watchedChannels, setWatchedChannels] = useState<Set<string>>(new Set());
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [watchingBulk, setWatchingBulk] = useState(false);
  const [watchingCandidateId, setWatchingCandidateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyzedIds, setAnalyzedIds] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState("");
  const [scoutStatus, setScoutStatus] = useState<ScoutStatus | null>(null);

  // Tab selection survives a refresh/share (?tab=feed) instead of always
  // resetting to Discover.
  const setTab = (t: Tab) => {
    setTabState(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState({}, "", url);
  };
  const analyzerRef = useRef<LiveAnalyzerHandle>(null);
  const analyzerSectionRef = useRef<HTMLDivElement>(null);

  const startAnalyzing = (url: string) => {
    analyzerRef.current?.analyze(url);
    analyzerSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const loadStatus = async () => {
    try {
      setStatus(await yt<Status>("/status"));
    } catch {
      setStatus({ connected: false, channel: null });
    }
  };

  useEffect(() => {
    loadStatus();
    loadWatchedChannelIds().then(setWatchedChannels);
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) setError(err);
    const initialTab = params.get("tab") as Tab | null;
    if (initialTab && VALID_TABS.includes(initialTab)) setTabState(initialTab);
    fetch("/api/v1/scout/feed?limit=200")
      .then((r) => (r.ok ? r.json() : []))
      .then((items: { video_id?: string }[]) => {
        setAnalyzedIds(new Set(items.map((i) => i.video_id).filter((id): id is string => !!id)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadScoutStatus = () => {
      fetch("/api/v1/scout/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((s: ScoutStatus | null) => {
          if (!cancelled) setScoutStatus(s);
        })
        .catch(() => {});
    };
    loadScoutStatus();
    const id = setInterval(loadScoutStatus, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const filteredVideos = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return videos;
    return videos.filter(
      (v) => v.title.toLowerCase().includes(q) || v.channel.toLowerCase().includes(q)
    );
  }, [videos, filterText]);

  const displayVideos = useMemo(() => {
    if (tab !== "search") return filteredVideos;
    return [...filteredVideos].sort((a, b) => {
      const byChannel = a.channel.localeCompare(b.channel);
      if (byChannel !== 0) return byChannel;
      return (b.published_at ?? "").localeCompare(a.published_at ?? "");
    });
  }, [filteredVideos, tab]);

  const uniqueChannels = useMemo<ChannelSummary[]>(() => {
    const seen = new Map<string, ChannelSummary>();
    for (const v of videos) {
      if (v.channel_id && !seen.has(v.channel_id)) {
        seen.set(v.channel_id, {
          channel_id: v.channel_id,
          channel: v.channel,
          thumbnail: v.thumbnail,
          sample_url: v.url,
        });
      }
    }
    return [...seen.values()];
  }, [videos]);

  const toggleSelectedChannel = (channelId: string) => {
    setSelectedChannels((s) => {
      const next = new Set(s);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  };

  const watchSelectedChannels = async () => {
    const ids = [...selectedChannels].filter((id) => !watchedChannels.has(id));
    if (ids.length === 0) return;
    setWatchingBulk(true);
    const results = await Promise.allSettled(ids.map((id) => watchChannel(id)));
    const succeeded = ids.filter((_, i) => results[i].status === "fulfilled");
    setWatchedChannels((s) => new Set([...s, ...succeeded]));
    setSelectedChannels(new Set());
    const failed = results.length - succeeded.length;
    if (failed > 0) setError(`Failed to watch ${failed} channel(s).`);
    setWatchingBulk(false);

    const first = uniqueChannels.find((c) => succeeded.includes(c.channel_id));
    if (first) startAnalyzing(first.sample_url);
  };

  const loadTab = async (which: Tab, pageToken?: string, playlist?: string) => {
    setLoading(true);
    setError(null);
    try {
      if (which === "feed") {
        const r = await yt<{ videos: Video[] }>("/feed");
        setVideos(r.videos);
        setNextPageToken(null);
      } else if (which === "liked") {
        const qs = pageToken ? `?page_token=${encodeURIComponent(pageToken)}` : "";
        const r = await yt<VideoPage>(`/liked${qs}`);
        setVideos((v) => (pageToken ? [...v, ...r.videos] : r.videos));
        setNextPageToken(r.next_page_token);
      } else if (which === "playlist" && playlist) {
        const qs = new URLSearchParams({ id: playlist });
        if (pageToken) qs.set("page_token", pageToken);
        const r = await yt<VideoPage>(`/playlist?${qs.toString()}`);
        setVideos((v) => (pageToken ? [...v, ...r.videos] : r.videos));
        setNextPageToken(r.next_page_token);
      } else if (which === "search" && playlist) {
        const qs = new URLSearchParams({ q: playlist });
        if (pageToken) qs.set("page_token", pageToken);
        const r = await yt<VideoPage>(`/search?${qs.toString()}`);
        setVideos((v) => (pageToken ? [...v, ...r.videos] : r.videos));
        setNextPageToken(r.next_page_token);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!status?.connected || tab === "playlist" || tab === "search" || tab === "discover") return;
    setVideos([]);
    setNextPageToken(null);
    loadTab(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected, tab]);

  const connect = () => {
    const base = process.env.NEXT_PUBLIC_SIGNAL_SERVICE_URL ?? "http://localhost:8001";
    window.location.href = `${base}/api/v1/youtube/authorize`;
  };

  const disconnect = async () => {
    await yt("/disconnect", { method: "POST" });
    setVideos([]);
    setNextPageToken(null);
    await loadStatus();
  };

  const loadPlaylist = () => {
    const id = playlistInput.trim();
    if (!id) return;
    setPlaylistId(id);
    setVideos([]);
    setNextPageToken(null);
    loadTab("playlist", undefined, id);
  };

  const doSearch = () => {
    const q = searchInput.trim();
    if (!q) return;
    setSearchQuery(q);
    setVideos([]);
    setNextPageToken(null);
    loadTab("search", undefined, q);
  };

  const selectVideo = (v: Video) => {
    analyzerRef.current?.analyze(v.url);
  };

  const doWatchChannel = async (v: Video) => {
    if (!v.channel_id) return;
    try {
      await watchChannel(v.channel_id);
      setWatchedChannels((s) => new Set(s).add(v.channel_id as string));
      startAnalyzing(v.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const doDiscover = async (query: string) => {
    const q = query.trim();
    if (!q) return;
    setDiscoverInput(q);
    setDiscovering(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/scout/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `${res.status}`);
      }
      const data: { candidates: DiscoverCandidate[] } = await res.json();
      setDiscoverCandidates((prev) => {
        const seen = new Map(prev.map((c) => [c.id, c]));
        for (const c of data.candidates) seen.set(c.id, c);
        return [...seen.values()];
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiscovering(false);
    }
  };

  const doWatchDiscoverCandidate = async (c: DiscoverCandidate) => {
    setWatchingCandidateId(c.id);
    setError(null);
    try {
      await watchChannel(c.id);
      setWatchedChannels((s) => new Set(s).add(c.id));
      const video = await latestVideoForChannel(c.id);
      if (video) {
        startAnalyzing(video.url);
      } else {
        setError(`Watching ${c.name} — no videos found yet, it'll be analyzed once it posts.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWatchingCandidateId(null);
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex min-h-9 flex-wrap items-center gap-3">
        <Link href="/lab/scout" className="text-zinc-500 hover:text-zinc-300">
          <ArrowLeft size={16} />
        </Link>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
          <Youtube size={18} className="text-red-500" /> My YouTube
        </h1>
        <span className="text-xs text-zinc-500">
          discover trading channels with zero API quota, browse your subscriptions/liked/playlists, or search videos
          — click a video to analyze it live
        </span>
        {status?.connected && (
          <div className="ml-auto flex items-center gap-2">
            {status.channel?.thumbnail && (
              <Image
                src={status.channel.thumbnail}
                alt={status.channel.title}
                width={20}
                height={20}
                className="rounded-full"
              />
            )}
            <button
              onClick={disconnect}
              className="flex items-center gap-1.5 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
            >
              <LogOut size={12} /> Disconnect{status.channel?.title ? ` (${status.channel.title})` : ""}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-xs text-red-300">{error}</div>
      )}

      {status === null && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 size={14} className="animate-spin" /> Checking connection…
        </div>
      )}

      {status && !status.connected && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-center">
          <p className="mb-3 text-sm text-zinc-400">Connect your YouTube account to browse and analyze videos.</p>
          <button
            onClick={connect}
            className="mx-auto flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500"
          >
            <Youtube size={14} /> Connect YouTube
          </button>
        </div>
      )}

      {status?.connected && (
        <>
          <div className="flex flex-wrap gap-2">
            <TabButton
              active={tab === "discover"}
              onClick={() => setTab("discover")}
              icon={Radar}
              label="Discover channels"
              title="Find new trading channels by keyword search — free, no YouTube API quota used"
            />
            <TabButton
              active={tab === "feed"}
              onClick={() => setTab("feed")}
              icon={Rss}
              label="Subscriptions feed"
              title="Recent uploads from channels you're subscribed to on YouTube"
            />
            <TabButton
              active={tab === "liked"}
              onClick={() => setTab("liked")}
              icon={Heart}
              label="Liked videos"
              title={'Videos from your YouTube "Liked videos" playlist'}
            />
            <TabButton
              active={tab === "playlist"}
              onClick={() => setTab("playlist")}
              icon={ListMusic}
              label="A playlist"
              title="Browse any playlist by pasting its URL or ID — yours or someone else's"
            />
            <TabButton
              active={tab === "search"}
              onClick={() => setTab("search")}
              icon={Search}
              label="Search videos"
              title="Full YouTube keyword search — uses your daily API quota, unlike Discover channels"
            />
          </div>
          {(tab === "feed" || tab === "liked" || tab === "playlist") && (
            <p className="text-[11px] text-zinc-600">
              {tab === "feed" && "Newest uploads from the channels you already follow on YouTube, most recent first."}
              {tab === "liked" && "Pulled straight from your YouTube \"Liked videos\" playlist."}
              {tab === "playlist" && "Works with any playlist — your own, or one someone shared with you."}
            </p>
          )}

          {scoutStatus && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-[11px] text-zinc-500">
              <span className="flex items-center gap-1.5 font-medium text-zinc-400">
                <Radar size={12} className={scoutStatus.running ? "text-cyan-400" : "text-zinc-600"} />
                Agent {scoutStatus.running ? "watching" : "idle"} · {scoutStatus.channels.length} channel
                {scoutStatus.channels.length === 1 ? "" : "s"}
              </span>
              <span>{scoutStatus.analyses} analyzed</span>
              <span>{scoutStatus.seen_videos} videos seen</span>
              <span>
                last checked {scoutStatus.last_poll ? timeAgo(scoutStatus.last_poll) : "never yet"}
              </span>
              <span>polls every {Math.round(scoutStatus.poll_interval_s / 60)}m</span>
              {scoutStatus.auto_discover && (
                <span>
                  auto-discovery{" "}
                  {scoutStatus.last_discover ? `· last ${timeAgo(scoutStatus.last_discover)}` : "· not run yet"}
                </span>
              )}
            </div>
          )}

          {tab === "discover" && (
            <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <p className="text-xs text-zinc-500">
                Scrapes YouTube search results for candidate trading channels — no API key, no quota cost. Pick a
                preset or type your own query, then watch the channels you want Scout to auto-analyze.
              </p>
              <div className="flex gap-2">
                <input
                  value={discoverInput}
                  onChange={(e) => setDiscoverInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doDiscover(discoverInput)}
                  placeholder="e.g. crypto day trading strategy"
                  className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
                />
                <button
                  onClick={() => doDiscover(discoverInput)}
                  disabled={discovering}
                  className="flex items-center gap-1 rounded bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
                >
                  {discovering ? <Loader2 size={12} className="animate-spin" /> : <Radar size={12} />} Discover
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TRADING_PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => doDiscover(p)}
                    className="rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-cyan-300"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === "discover" &&
            (discoverCandidates.length > 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                <div className="mb-2 text-xs font-medium text-zinc-400">
                  Candidate channels ({discoverCandidates.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {discoverCandidates.map((c) => {
                    const watched = watchedChannels.has(c.id);
                    const busy = watchingCandidateId === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => !watched && !busy && doWatchDiscoverCandidate(c)}
                        disabled={watched || busy}
                        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${
                          watched
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-cyan-300"
                        }`}
                      >
                        {busy ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : watched ? (
                          <Check size={10} />
                        ) : (
                          <Plus size={10} />
                        )}
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              !discovering && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-center text-xs text-zinc-500">
                  Pick a preset or type a query above to find trading channels.
                </div>
              )
            ))}

          {tab === "playlist" && (
            <div className="flex gap-2">
              <input
                value={playlistInput}
                onChange={(e) => setPlaylistInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadPlaylist()}
                placeholder="Playlist URL or id"
                className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
              />
              <button
                onClick={loadPlaylist}
                className="flex items-center gap-1 rounded bg-violet-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-violet-400"
              >
                Load
              </button>
            </div>
          )}

          {tab === "search" && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doSearch()}
                  placeholder="Search YouTube for videos or traders…"
                  className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
                />
                <button
                  onClick={doSearch}
                  className="flex items-center gap-1 rounded bg-violet-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-violet-400"
                >
                  <Search size={12} /> Search
                </button>
              </div>
              <p className="text-[11px] text-zinc-600">
                Results below are grouped by channel. Uses YouTube&apos;s API (~100 searches/day quota, cached by
                query). Prefer{" "}
                <button onClick={() => setTab("discover")} className="underline hover:text-cyan-400">
                  Discover channels
                </button>{" "}
                for unlimited trading-channel lookups.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {TRADING_PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setSearchInput(p);
                      setSearchQuery(p);
                      setVideos([]);
                      setNextPageToken(null);
                      loadTab("search", undefined, p);
                    }}
                    className="rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-cyan-300"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {uniqueChannels.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-400">
                  Channels in these results ({uniqueChannels.length})
                </span>
                <div className="flex items-center gap-2">
                  {(() => {
                    const selectable = uniqueChannels.filter((c) => !watchedChannels.has(c.channel_id));
                    const allSelected = selectable.length > 0 && selectedChannels.size === selectable.length;
                    return (
                      selectable.length > 0 && (
                        <button
                          onClick={() =>
                            setSelectedChannels(allSelected ? new Set() : new Set(selectable.map((c) => c.channel_id)))
                          }
                          className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800"
                        >
                          <ListChecks size={11} /> {allSelected ? "Deselect all" : "Select all"}
                        </button>
                      )
                    );
                  })()}
                  <button
                    onClick={watchSelectedChannels}
                    disabled={selectedChannels.size === 0 || watchingBulk}
                    className="flex items-center gap-1.5 rounded bg-cyan-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {watchingBulk ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                    Watch selected ({selectedChannels.size})
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {uniqueChannels.map((c) => {
                  const watched = watchedChannels.has(c.channel_id);
                  const selected = selectedChannels.has(c.channel_id);
                  return (
                    <button
                      key={c.channel_id}
                      onClick={() => !watched && toggleSelectedChannel(c.channel_id)}
                      disabled={watched}
                      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${
                        watched
                          ? "bg-emerald-500/10 text-emerald-400"
                          : selected
                            ? "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500"
                            : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                      }`}
                    >
                      {watched ? <Check size={10} /> : selected ? <Check size={10} /> : null}
                      {c.channel || "Unknown channel"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab !== "discover" &&
            (loading && videos.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 size={14} className="animate-spin" /> Loading videos…
              </div>
            ) : videos.length === 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-center text-xs text-zinc-500">
                {tab === "playlist"
                  ? "Paste a playlist URL or id above."
                  : tab === "search"
                    ? "Search for a trader, ticker, or strategy above."
                    : "No videos found."}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
                  <input
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    placeholder={`Filter ${videos.length} loaded video${videos.length === 1 ? "" : "s"} by title or channel…`}
                    className="w-full rounded border border-zinc-800 bg-zinc-900/50 py-1.5 pl-8 pr-8 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-700 focus:outline-none"
                  />
                  {filterText && (
                    <button
                      onClick={() => setFilterText("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {displayVideos.length === 0 ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-center text-xs text-zinc-500">
                    No loaded videos match &ldquo;{filterText}&rdquo;.
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {displayVideos.map((v, i) => {
                      const watched = v.channel_id ? watchedChannels.has(v.channel_id) : false;
                      const analyzed = analyzedIds.has(v.video_id);
                      const showChannelHeader =
                        tab === "search" && (i === 0 || displayVideos[i - 1].channel !== v.channel);
                      return (
                        <Fragment key={v.video_id}>
                        {showChannelHeader && (
                          <div className="col-span-full mt-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 first:mt-0">
                            <Users size={11} /> {v.channel}
                          </div>
                        )}
                        <div
                          className="group flex flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50 hover:border-cyan-700"
                        >
                          <button onClick={() => selectVideo(v)} className="flex flex-col text-left">
                            <div className="relative aspect-video bg-zinc-950">
                              {v.thumbnail && (
                                <Image src={v.thumbnail} alt="" fill sizes="300px" className="object-cover" />
                              )}
                              {analyzed && (
                                <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-zinc-950/80 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400">
                                  <CheckCircle2 size={10} /> Analyzed
                                </span>
                              )}
                            </div>
                            <div className="p-2 pb-1">
                              <div className="line-clamp-2 text-xs font-medium text-zinc-100 group-hover:text-cyan-300">
                                {v.title}
                              </div>
                            </div>
                          </button>
                          <div className="flex items-center justify-between gap-2 px-2 pb-2 text-[10px] text-zinc-500">
                            <span className="truncate">{v.channel}</span>
                            {v.published_at && (
                              <span className="shrink-0">
                                {timeAgo(Math.floor(new Date(v.published_at).getTime() / 1000))}
                              </span>
                            )}
                          </div>
                          {v.channel_id && (
                            <button
                              onClick={() => doWatchChannel(v)}
                              disabled={watched}
                              className={`mx-2 mb-2 flex items-center justify-center gap-1 rounded px-2 py-1 text-[10px] font-medium ${
                                watched
                                  ? "bg-emerald-500/10 text-emerald-400"
                                  : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-cyan-300"
                              }`}
                            >
                              {watched ? <Check size={11} /> : <Plus size={11} />}
                              {watched ? "Watching channel" : "Watch channel"}
                            </button>
                          )}
                        </div>
                        </Fragment>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

          {tab !== "discover" && nextPageToken && (
            <button
              onClick={() =>
                loadTab(
                  tab,
                  nextPageToken,
                  tab === "playlist" ? playlistId : tab === "search" ? searchQuery : undefined,
                )
              }
              disabled={loading}
              className="mx-auto flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Load more
            </button>
          )}

          <div ref={analyzerSectionRef} className="space-y-2">
            <h2 className="text-xs font-medium text-zinc-400">Live analysis</h2>
            <LiveAnalyzer ref={analyzerRef} onDone={() => {}} />
          </div>
        </>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: ElementType;
  label: string;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${
        active ? "bg-cyan-500 text-slate-950" : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
      }`}
    >
      <Icon size={12} /> {label}
    </button>
  );
}
