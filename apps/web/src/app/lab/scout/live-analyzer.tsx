"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Radar,
  Loader2,
  CheckCircle2,
  XCircle,
  FileText,
  Captions,
  Sparkles,
  Users,
  Camera,
  ScanText,
  GitMerge,
  Youtube,
  AudioLines,
} from "lucide-react";
import { AnalysisCard, type Analysis } from "./analysis-card";

interface StageEvent {
  stage: string;
  [key: string]: unknown;
}

const STAGE_META: Record<string, { label: string; icon: typeof Radar }> = {
  resolving: { label: "Resolving video", icon: Youtube },
  fetching_title: { label: "Fetching title", icon: FileText },
  fetching_transcript: { label: "Fetching transcript", icon: Captions },
  transcript_error: { label: "Transcript unavailable", icon: XCircle },
  extracting_signals: { label: "Extracting signals", icon: Sparkles },
  checking_guest: { label: "Checking for guest speaker", icon: Users },
  downloading_frames: { label: "Downloading frames", icon: Camera },
  ocr_frame: { label: "Reading on-screen chart", icon: ScanText },
  frames_skipped: { label: "Frame analysis skipped", icon: XCircle },
  merging_frame_findings: { label: "Merging chart findings", icon: GitMerge },
  transcribing_audio: { label: "Transcribing audio", icon: AudioLines },
  done: { label: "Done", icon: CheckCircle2 },
  error: { label: "Error", icon: XCircle },
};

function stageLine(ev: StageEvent): string {
  switch (ev.stage) {
    case "transcript_error":
      return `Transcript unavailable (${ev.error})`;
    case "ocr_frame":
      return `Reading on-screen chart — frame ${(ev.index as number) + 1}/${ev.total as number}`;
    case "frames_skipped":
      return `Frame analysis skipped (${ev.reason})`;
    case "error":
      return String(ev.message ?? "Unknown error");
    default:
      return STAGE_META[ev.stage]?.label ?? ev.stage;
  }
}

export interface LiveAnalyzerHandle {
  analyze: (url: string) => void;
}

export const LiveAnalyzer = forwardRef<LiveAnalyzerHandle, { onDone: (record: Analysis) => void }>(
  function LiveAnalyzer({ onDone }, ref) {
  const [videoUrl, setVideoUrl] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [events, setEvents] = useState<StageEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [record, setRecord] = useState<Analysis | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => esRef.current?.close();
  }, []);

  const start = (explicitUrl?: string) => {
    const target = (explicitUrl ?? videoUrl).trim();
    if (!target || running) return;
    if (explicitUrl !== undefined) setVideoUrl(explicitUrl);
    esRef.current?.close();
    setEvents([]);
    setRecord(null);
    setConnError(null);
    setVideoId(null);
    setRunning(true);

    const es = new EventSource(`/api/v1/scout/analyze_stream?url=${encodeURIComponent(target)}`);
    esRef.current = es;

    es.onmessage = (msg) => {
      if (msg.data === "[DONE]") {
        es.close();
        setRunning(false);
        return;
      }
      let ev: StageEvent;
      try {
        ev = JSON.parse(msg.data);
      } catch {
        return;
      }
      setEvents((prev) => [...prev, ev]);
      if (ev.stage === "resolving" && typeof ev.video_id === "string") {
        setVideoId(ev.video_id);
      }
      if (ev.stage === "done" && ev.record) {
        const rec = ev.record as Analysis;
        setRecord(rec);
        onDone(rec);
      }
    };

    es.onerror = () => {
      es.close();
      setRunning(false);
      setConnError("Connection lost");
    };
  };

  useImperativeHandle(ref, () => ({ analyze: (url: string) => start(url) }));

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Analyze live — chart OCR + guest detection, step by step
      </div>
      <div className="flex gap-2">
        <input
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && start()}
          placeholder="https://www.youtube.com/watch?v=…"
          className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
        />
        <button
          onClick={() => start()}
          disabled={running}
          className="flex items-center gap-1 rounded bg-violet-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-violet-400 disabled:opacity-50"
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <Radar size={12} />}
          Analyze live
        </button>
      </div>
      <p className="mt-2 text-[11px] text-zinc-600">
        Manual trigger only — also reads on-screen tickers/prices via OCR and flags likely guest
        interviews, on top of the transcript-based extraction used by the background poll loop.
      </p>
      {connError && <p className="mt-2 text-xs text-red-400">{connError}</p>}

      {(videoId || events.length > 0) && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {videoId && (
            <div className="aspect-video overflow-hidden rounded border border-zinc-800 bg-black">
              <iframe
                src={`https://www.youtube.com/embed/${videoId}`}
                title="YouTube live preview"
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}
          <ul className="max-h-72 space-y-1.5 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/60 p-3">
            {events.map((ev, i) => {
              const meta = STAGE_META[ev.stage];
              const Icon = meta?.icon ?? Radar;
              const isLast = i === events.length - 1;
              const isError = ev.stage === "error";
              return (
                <li
                  key={i}
                  className={`flex items-center gap-2 text-xs ${
                    isError ? "text-red-400" : isLast && running ? "text-cyan-300" : "text-zinc-400"
                  }`}
                >
                  {isLast && running ? (
                    <Loader2 size={12} className="shrink-0 animate-spin" />
                  ) : (
                    <Icon size={12} className="shrink-0" />
                  )}
                  {stageLine(ev)}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {record && (
        <div className="mt-4">
          <AnalysisCard a={record} />
        </div>
      )}
    </div>
  );
  }
);
