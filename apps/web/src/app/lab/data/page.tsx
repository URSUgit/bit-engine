"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Database, RefreshCw, ShieldCheck, ShieldAlert, ShieldQuestion,
  Activity, Radio, AlertTriangle, CheckCircle2, XCircle, Play, Pause,
} from "lucide-react";
import {
  backtestApi,
  type QualityOverviewRow,
  type QualityReport,
  type CrossValidationReport,
  type IngestStatus,
} from "@/lib/backtest-api";
import { cn } from "@/lib/utils";

const SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD", "XRP-USD", "ADA-USD", "DOGE-USD", "AVAX-USD", "LINK-USD", "LTC-USD"];
const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

function scoreColor(s: number): string {
  if (s >= 90) return "text-emerald-400";
  if (s >= 70) return "text-yellow-400";
  if (s >= 40) return "text-orange-400";
  return "text-red-400";
}
function scoreBg(s: number): string {
  if (s >= 90) return "bg-emerald-500";
  if (s >= 70) return "bg-yellow-500";
  if (s >= 40) return "bg-orange-500";
  return "bg-red-500";
}

const VERDICT_CFG: Record<string, { label: string; color: string; bg: string; Icon: typeof ShieldCheck }> = {
  trusted:      { label: "Trusted",       color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", Icon: ShieldCheck },
  minor_drift:  { label: "Minor Drift",   color: "text-yellow-400",  bg: "bg-yellow-500/10 border-yellow-500/30",   Icon: ShieldQuestion },
  conflict:     { label: "Conflict",      color: "text-red-400",     bg: "bg-red-500/10 border-red-500/30",         Icon: ShieldAlert },
  insufficient: { label: "Insufficient",  color: "text-slate-400",   bg: "bg-slate-700/30 border-slate-700",        Icon: ShieldQuestion },
  unknown:      { label: "Unknown",       color: "text-slate-400",   bg: "bg-slate-700/30 border-slate-700",        Icon: ShieldQuestion },
};

export default function DataQualityPage() {
  const [tab, setTab] = useState<"overview" | "validate" | "ingest">("overview");

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-6 h-6 text-cyan-400" />
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Data Warehouse</h1>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Validate cached OHLCV, cross-check sources, and keep live data flowing
          </p>
        </div>
        <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
          {([["overview", "Quality"], ["validate", "Cross-Validate"], ["ingest", "Live Ingest"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={cn("px-3 py-1.5 text-xs font-semibold rounded transition-colors",
                tab === id ? "bg-slate-800 text-cyan-300" : "text-slate-500 hover:text-slate-300")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && <QualityOverview />}
      {tab === "validate" && <CrossValidate />}
      {tab === "ingest" && <LiveIngest />}
    </div>
  );
}

// ── Quality overview ──────────────────────────────────────────────────────────

function QualityOverview() {
  const [rows, setRows] = useState<QualityOverviewRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<QualityReport | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await backtestApi.dataQualityOverview();
      setRows(res.datasets);
    } catch {
      setError("Could not reach the data service. Is the signal service running?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openDetail(symbol: string, interval: string) {
    setDetailLoading(true); setDetail(null);
    try {
      setDetail(await backtestApi.dataQuality(symbol, interval));
    } catch { /* ignore */ } finally {
      setDetailLoading(false);
    }
  }

  async function handleExportParquet() {
    setExporting(true); setExportError("");
    try {
      await backtestApi.exportParquet();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-slate-400">
          {rows ? `${rows.length} cached dataset(s) · sorted worst-first` : "Scanning…"}
        </p>
        <div className="flex items-center gap-2">
          <button onClick={handleExportParquet} disabled={exporting || !rows || rows.length === 0}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors">
            {exporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
            Export Parquet
          </button>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} /> Refresh
          </button>
        </div>
      </div>
      {exportError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-300">{exportError}</div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm text-red-300">{error}</div>
      )}

      {rows && rows.length === 0 && !error && (
        <div className="bg-slate-900/30 border border-dashed border-slate-800 rounded-lg p-12 text-center">
          <Database className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-slate-300 mb-1">No cached data yet</h3>
          <p className="text-sm text-slate-500">Run a backtest or start live ingest to populate the warehouse.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="card-dark overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3 text-left">Symbol</th>
                  <th className="px-4 py-3 text-left">Interval</th>
                  <th className="px-4 py-3 text-right">Bars</th>
                  <th className="px-4 py-3 text-right">Complete</th>
                  <th className="px-4 py-3 text-left w-40">Quality</th>
                  <th className="px-4 py-3 text-right">Gaps</th>
                  <th className="px-4 py-3 text-right">Spikes</th>
                  <th className="px-4 py-3 text-right">Bad OHLC</th>
                  <th className="px-4 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {rows.map((r) => (
                  <tr key={`${r.symbol}-${r.interval}`} className="hover:bg-slate-900/40 transition-colors">
                    <td className="px-4 py-3 font-semibold text-slate-100">{r.symbol}</td>
                    <td className="px-4 py-3 text-slate-400">{r.interval}</td>
                    <td className="px-4 py-3 text-right text-slate-300 number-font">{r.bar_count.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-slate-300 number-font">{r.completeness_pct}%</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={cn("number-font font-bold w-10", scoreColor(r.quality_score))}>{r.quality_score}</span>
                        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div className={cn("h-full rounded-full", scoreBg(r.quality_score))} style={{ width: `${r.quality_score}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className={cn("px-4 py-3 text-right number-font", r.gap_count > 0 ? "text-orange-400" : "text-slate-600")}>{r.gap_count}</td>
                    <td className={cn("px-4 py-3 text-right number-font", r.spike_count > 0 ? "text-yellow-400" : "text-slate-600")}>{r.spike_count}</td>
                    <td className={cn("px-4 py-3 text-right number-font", r.ohlc_violation_count > 0 ? "text-red-400" : "text-slate-600")}>{r.ohlc_violation_count}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openDetail(r.symbol, r.interval)}
                        className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">Inspect →</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(detail || detailLoading) && (
        <QualityDetailModal report={detail} loading={detailLoading} onClose={() => { setDetail(null); setDetailLoading(false); }} />
      )}
    </div>
  );
}

function QualityDetailModal({ report, loading, onClose }: { report: QualityReport | null; loading: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {loading || !report ? (
          <div className="p-12 text-center text-slate-400">Loading quality report…</div>
        ) : (
          <>
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-100">{report.symbol} · {report.interval}</h3>
                <p className="text-xs text-slate-500">{report.earliest_iso?.slice(0, 10)} → {report.latest_iso?.slice(0, 10)}</p>
              </div>
              <div className="text-right">
                <div className={cn("text-2xl font-black number-font", scoreColor(report.quality_score))}>{report.quality_score}</div>
                <div className="text-[10px] uppercase text-slate-500">quality score</div>
              </div>
            </div>
            <div className="px-5 py-3 grid grid-cols-3 sm:grid-cols-6 gap-2 border-b border-slate-800 text-center">
              {[
                ["Bars", report.bar_count.toLocaleString()],
                ["Complete", `${report.completeness_pct}%`],
                ["Gaps", report.gap_count],
                ["Spikes", report.spike_count],
                ["Bad OHLC", report.ohlc_violation_count],
                ["Zero Vol", report.zero_volume_count],
              ].map(([label, val]) => (
                <div key={label as string}>
                  <div className="text-sm font-bold text-slate-200 number-font">{val}</div>
                  <div className="text-[10px] uppercase text-slate-500">{label}</div>
                </div>
              ))}
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-1.5">
              {report.issues.length === 0 ? (
                <div className="text-center py-8 text-emerald-400 flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-8 h-8" /> No issues detected — clean dataset
                </div>
              ) : report.issues.map((iss, i) => (
                <div key={i} className="flex items-start gap-2 text-xs bg-slate-800/40 rounded-lg px-3 py-2">
                  <span className={cn("mt-0.5 w-1.5 h-1.5 rounded-full shrink-0",
                    iss.severity >= 5 ? "bg-red-500" : iss.severity >= 3 ? "bg-orange-500" : "bg-yellow-500")} />
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-slate-300 uppercase">{iss.kind.replace(/_/g, " ")}</span>
                    <span className="text-slate-500 ml-2">{iss.iso?.slice(0, 16).replace("T", " ")}</span>
                    <p className="text-slate-400 mt-0.5">{iss.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-slate-800 text-right">
              <button onClick={onClose} className="text-xs px-4 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Cross-validate ──────────────────────────────────────────────────────────

function CrossValidate() {
  const [symbol, setSymbol] = useState("BTC-USD");
  const [interval, setInterval] = useState("1d");
  const [tolerance, setTolerance] = useState("0.1");
  const [report, setReport] = useState<CrossValidationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true); setError(""); setReport(null);
    try {
      setReport(await backtestApi.crossValidate({
        symbol, interval, limit: 200, tolerance_pct: parseFloat(tolerance) || 0.1,
      }));
    } catch {
      setError("Cross-validation request failed. Is the signal service reachable?");
    } finally {
      setLoading(false);
    }
  }

  const verdict = report ? VERDICT_CFG[report.verdict] : null;

  return (
    <div className="space-y-4">
      <div className="card-dark p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">Symbol</label>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500">
            {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">Interval</label>
          <select value={interval} onChange={(e) => setInterval(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500">
            {INTERVALS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">Tolerance %</label>
          <input value={tolerance} onChange={(e) => setTolerance(e.target.value)} type="number" step="0.01" min="0"
            className="w-24 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 number-font outline-none focus:border-cyan-500" />
        </div>
        <button onClick={run} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 disabled:opacity-50 transition-colors">
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          Compare Sources
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Fetches the same bars from <span className="text-slate-300">Binance</span>, <span className="text-slate-300">Bybit</span> and <span className="text-slate-300">Kraken</span> and compares close prices bar-by-bar. Sources that agree within tolerance are trustworthy.
      </p>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm text-red-300">{error}</div>}

      {report && verdict && (
        <div className="space-y-4">
          <div className={cn("rounded-xl border p-5 flex items-center gap-4", verdict.bg)}>
            <verdict.Icon className={cn("w-10 h-10", verdict.color)} />
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <span className={cn("text-xl font-bold", verdict.color)}>{verdict.label}</span>
                <span className="text-sm text-slate-400">{report.agreement_pct}% agreement</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Compared {report.compared_bars} bars · {report.matching_bars} matched · recommended source: <span className="text-slate-200 font-semibold">{report.recommended_source}</span>
              </p>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">max divergence</div>
              <div className={cn("text-lg font-bold number-font", report.max_divergence_pct > 1 ? "text-red-400" : "text-slate-200")}>
                {report.max_divergence_pct}%
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            {report.sources.map((s) => (
              <div key={s.source} className="card-dark p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200 capitalize">{s.source}</span>
                  {s.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
                </div>
                <div className="text-2xl font-bold number-font text-slate-100 mt-1">{s.bar_count}</div>
                <div className="text-[11px] text-slate-500">bars fetched</div>
                {s.error && <div className="text-[10px] text-red-400 mt-1 truncate" title={s.error}>{s.error}</div>}
              </div>
            ))}
          </div>

          {report.divergent_timestamps.length > 0 && (
            <div className="card-dark overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-semibold text-slate-200">Divergent bars ({report.divergent_timestamps.length})</span>
              </div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-800">
                      <th className="px-4 py-2 text-left">Time</th>
                      <th className="px-4 py-2 text-left">Reference</th>
                      <th className="px-4 py-2 text-right">Ref Close</th>
                      <th className="px-4 py-2 text-left">Peer</th>
                      <th className="px-4 py-2 text-right">Divergence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {report.divergent_timestamps.map((d, i) => (
                      <tr key={i} className="hover:bg-slate-900/40">
                        <td className="px-4 py-2 text-slate-400">{d.iso.slice(0, 16).replace("T", " ")}</td>
                        <td className="px-4 py-2 text-slate-300 capitalize">{d.ref_source}</td>
                        <td className="px-4 py-2 text-right text-slate-300 number-font">{d.ref_close.toLocaleString()}</td>
                        <td className="px-4 py-2 text-slate-300 capitalize">{d.peer_source}</td>
                        <td className="px-4 py-2 text-right text-orange-400 number-font font-semibold">{d.divergence_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Live ingest ──────────────────────────────────────────────────────────────

function LiveIngest() {
  const [status, setStatus] = useState<IngestStatus | null>(null);
  const [error, setError] = useState("");
  const [addSymbol, setAddSymbol] = useState("BTC-USD");
  const [addInterval, setAddInterval] = useState("1m");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setStatus(await backtestApi.ingestStatus()); setError(""); }
    catch { setError("Could not reach the ingester. Is the signal service running?"); }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 10_000);
    return () => window.clearInterval(id);
  }, [load]);

  async function control(symbol: string, interval: string, enabled: boolean) {
    setBusy(true);
    try { setStatus(await backtestApi.ingestControl({ symbol, interval, enabled })); }
    catch { /* ignore */ } finally { setBusy(false); }
  }

  function freshness(iso: string | null): { label: string; color: string } {
    if (!iso) return { label: "never", color: "text-slate-600" };
    const ageSec = (Date.now() - new Date(iso).getTime()) / 1000;
    if (ageSec < 90) return { label: `${Math.round(ageSec)}s ago`, color: "text-emerald-400" };
    if (ageSec < 600) return { label: `${Math.round(ageSec / 60)}m ago`, color: "text-yellow-400" };
    return { label: `${Math.round(ageSec / 60)}m ago`, color: "text-red-400" };
  }

  return (
    <div className="space-y-4">
      <div className="card-dark p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className={cn("flex items-center gap-1.5 text-sm font-semibold",
            status?.running ? "text-emerald-400" : "text-slate-500")}>
            <Radio className={cn("w-4 h-4", status?.running && "animate-pulse")} />
            {status?.running ? "Ingester running" : "Ingester idle"}
          </span>
          {status && <span className="text-xs text-slate-500">{status.stream_count} stream(s) · polls every {status.poll_seconds}s</span>}
        </div>
        <button onClick={load}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm text-red-300">{error}</div>}

      {/* Add stream */}
      <div className="card-dark p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">Symbol</label>
          <select value={addSymbol} onChange={(e) => setAddSymbol(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500">
            {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">Interval</label>
          <select value={addInterval} onChange={(e) => setAddInterval(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500">
            {INTERVALS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button onClick={() => control(addSymbol, addInterval, true)} disabled={busy}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 disabled:opacity-50 transition-colors">
          <Activity className="w-4 h-4" /> Start Stream
        </button>
      </div>

      {status && status.streams.length > 0 && (
        <div className="card-dark overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3 text-left">Symbol</th>
                  <th className="px-4 py-3 text-left">Interval</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Last Bar</th>
                  <th className="px-4 py-3 text-right">Bars Written</th>
                  <th className="px-4 py-3 text-right">Polls</th>
                  <th className="px-4 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {status.streams.map((s) => {
                  const f = freshness(s.last_bar_iso);
                  return (
                    <tr key={`${s.symbol}-${s.interval}`} className="hover:bg-slate-900/40 transition-colors">
                      <td className="px-4 py-3 font-semibold text-slate-100">{s.symbol}</td>
                      <td className="px-4 py-3 text-slate-400">{s.interval}</td>
                      <td className="px-4 py-3">
                        {s.error ? (
                          <span className="text-xs text-red-400 flex items-center gap-1"><XCircle className="w-3 h-3" /> error</span>
                        ) : s.enabled ? (
                          <span className="text-xs text-emerald-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> live</span>
                        ) : (
                          <span className="text-xs text-slate-500 flex items-center gap-1"><Pause className="w-3 h-3" /> paused</span>
                        )}
                      </td>
                      <td className={cn("px-4 py-3 text-right number-font text-xs", f.color)}>{f.label}</td>
                      <td className="px-4 py-3 text-right text-slate-300 number-font">{s.bars_written_total.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-slate-500 number-font">{s.polls}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => control(s.symbol, s.interval, !s.enabled)} disabled={busy}
                          className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1 ml-auto">
                          {s.enabled ? <><Pause className="w-3 h-3" /> Pause</> : <><Play className="w-3 h-3" /> Resume</>}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {status && status.streams.length === 0 && (
        <div className="bg-slate-900/30 border border-dashed border-slate-800 rounded-lg p-12 text-center">
          <Radio className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-slate-300 mb-1">No live streams yet</h3>
          <p className="text-sm text-slate-500">Start a stream above to continuously pull fresh bars into the warehouse.</p>
        </div>
      )}
    </div>
  );
}
