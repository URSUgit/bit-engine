"use client";

import { useEffect, useState } from "react";
import type { VideoStrategyOrigin } from "@/lib/backtest-api";
import { YouTubeVideoPicker } from "./youtube-video-picker";

const API = "/api/v1/backtest/video-strategy";
type Settings = { api_enabled: boolean; search_enabled: boolean; model: string; prompt: string };

export function VideoStrategyPanel({ onLoad, loadingRun }: {
  onLoad: (origin: VideoStrategyOrigin) => void;
  loadingRun: boolean;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [url, setUrl] = useState("");
  const [output, setOutput] = useState("");
  const [result, setResult] = useState<VideoStrategyOrigin | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [trader, setTrader] = useState("");
  const [strategy, setStrategy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(API, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<Settings>;
      })
      .then(setSettings)
      .catch(() => { if (!controller.signal.aborted) setError("Video import is unavailable. Check the local research service."); });
    return () => controller.abort();
  }, []);

  function clearReview() {
    setResult(null);
    setReviewed(false);
    setError("");
    setCopyStatus("");
  }

  function changeVideo(nextUrl: string) {
    if (nextUrl === url) return;
    setUrl(nextUrl);
    setOutput("");
    clearReview();
  }

  async function submit(method: "analyze" | "import") {
    clearReview();
    setBusy(true);
    try {
      const response = await fetch(`${API}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(method === "import" ? { url, output } : { url }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Use one public HTTPS YouTube video link and valid Gemini JSON.");
      const origin = data as VideoStrategyOrigin;
      setResult(origin);
      setTrader(origin.draft.trader_name ?? "");
      setStrategy(origin.draft.strategy_name ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Video import failed.");
    } finally {
      setBusy(false);
    }
  }

  const usable = result?.draft.status === "compatible" && result.draft.entry_offset_bps !== null;
  const prompt = settings && `${settings.prompt}\n\nVideo URL: ${url.trim()}`;
  const timestamp = (second: number) => `${Math.floor(second / 60)}:${String(second % 60).padStart(2, "0")}`;

  return (
    <section aria-labelledby="video-strategy-title" className="max-w-3xl space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
      <div>
        <h2 id="video-strategy-title" className="text-lg font-semibold">YouTube to strategy</h2>
        <p className="mt-1 text-sm text-zinc-300">Gemini drafts rules from a public video. Check the timestamps and rules before loading anything into the Backtester.</p>
      </div>
      <YouTubeVideoPicker enabled={settings?.search_enabled ?? null} disabled={busy} selectedUrl={url} onSelect={changeVideo} />
      <label className="block text-sm">Public YouTube URL
        <input type="url" value={url} maxLength={1000} disabled={busy} onChange={(e) => changeVideo(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…" className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2" />
      </label>
      <div>
        <button type="button" disabled={!settings?.api_enabled || !url.trim() || busy} onClick={() => void submit("analyze")}
          className="rounded bg-cyan-500 px-3 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-40">Analyze with Gemini</button>
        <p className="mt-1 text-xs text-zinc-400">{settings?.api_enabled ? `Sends the public link directly to Google (${settings.model}). Gemini quota and billing apply; no YouTube Data API key is needed.` : "Direct analysis needs a Gemini API key on the local server. No YouTube Data API key is needed for a public link."}</p>
      </div>
      <details className="rounded border border-zinc-700 p-3" open={settings?.api_enabled === false ? true : undefined}>
        <summary className="cursor-pointer text-sm font-medium">Paste Gemini JSON</summary>
        <p className="mt-2 text-sm text-zinc-300">Copy the prompt, use it with the video in Gemini, then paste the full JSON response here. Bit Engine does not send an API request in this mode.</p>
        <button type="button" disabled={!prompt || !url.trim() || busy} onClick={async () => {
          if (!prompt) return;
          try { await navigator.clipboard.writeText(prompt); setCopyStatus("Prompt copied."); }
          catch { setCopyStatus("Select and copy the prompt below."); }
        }} className="mt-2 rounded border border-zinc-600 px-3 py-1.5 text-sm disabled:opacity-40">Copy Gemini prompt</button>
        {copyStatus && <p role="status" className="mt-1 text-sm text-zinc-300">{copyStatus}</p>}
        {prompt && <details className="mt-2 text-sm"><summary className="cursor-pointer">Show prompt</summary><textarea aria-label="Gemini analysis prompt" className="mt-1 w-full rounded bg-zinc-950 p-2" rows={5} readOnly value={prompt} /></details>}
        <label className="mt-3 block text-sm">Gemini JSON
          <textarea rows={5} maxLength={12000} value={output} disabled={busy} onChange={(e) => { setOutput(e.target.value); clearReview(); }}
            className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs" />
        </label>
        <button type="button" disabled={!url.trim() || !output.trim() || busy} onClick={() => void submit("import")}
          className="mt-2 rounded border border-cyan-600 px-3 py-1.5 text-sm text-cyan-300 disabled:opacity-40">Validate draft</button>
      </details>
      {busy && <p role="status" className="text-sm text-zinc-300">Checking the strategy draft…</p>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {result && (
        <div className="space-y-3 rounded border border-zinc-700 p-3 text-sm">
          <h3 className="font-medium">{usable ? "Review before loading" : "Needs review · not runnable"}</h3>
          <p className="text-zinc-300">{result.draft.summary}</p>
          <ul className="space-y-1 text-zinc-300">
            {([ ["Entry", result.draft.entry_second], ["Exit", result.draft.exit_second] ] as const).map(([label, second]) => (
              <li key={label}>{label}: {second === null ? "Not established" : (
                <a className="text-cyan-300 underline" href={`${result.url}&t=${second}s`} target="_blank" rel="noreferrer">{timestamp(second)} in video</a>
              )}</li>
            ))}
            {result.draft.blockers.map((blocker, i) => <li key={i}>Not supported: {blocker}</li>)}
          </ul>
          {usable && (
            <>
              <p className="text-zinc-300">Runnable template: BTCUSDT spot, 1h. Go long at the next open after a close crosses the prior UTC day high + {result.draft.entry_offset_bps} bps. Exit at the next open after the UTC day closes.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label>Trader name<input maxLength={100} value={trader} onChange={(e) => { setTrader(e.target.value); setReviewed(false); }} className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5" /></label>
                <label>Strategy name<input maxLength={100} value={strategy} onChange={(e) => { setStrategy(e.target.value); setReviewed(false); }} className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5" /></label>
              </div>
              <label className="flex items-start gap-2"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I checked the video and this template matches the rules I want to test.</label>
              <button type="button" disabled={!reviewed || loadingRun || !trader.trim() || !strategy.trim()}
                onClick={() => onLoad({ ...result, draft: { ...result.draft, trader_name: trader.trim(), strategy_name: strategy.trim() } })}
                className="rounded bg-cyan-500 px-3 py-2 font-semibold text-zinc-950 disabled:opacity-40">Load draft into Backtester</button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
