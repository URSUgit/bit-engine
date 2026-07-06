"use client";

import { useState, useCallback } from "react";
import { Plus, Trash2, Save, Play, CheckCircle2, XCircle, Clock, Bookmark, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const SIGNAL_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SIGNAL_SERVICE_URL) ??
  "http://localhost:8001";

type Op = ">" | "<" | ">=" | "<=" | "==" | "crosses_above" | "crosses_below";

interface Condition {
  id: string;
  indicator: string;
  op: Op;
  value: string;
}

interface TestResult {
  symbol: string;
  interval: string;
  start_date: string;
  end_date: string;
  bar_count: number;
  signal_count: number;
  avg_return_pct: number;
  win_rate: number;
  sample_signals: string[];
  warnings: string[];
}

interface SavedSignal {
  name: string;
  conditions: Condition[];
  symbol: string;
  interval: string;
  savedAt: string;
}

const indicators = [
  "EMA(20)", "EMA(50)", "EMA(200)", "SMA(20)", "SMA(50)",
  "RSI(14)", "MACD", "ADX(14)",
  "BB_upper", "BB_lower", "ATR(14)", "VWAP", "OBV",
  "FundingRate", "WhaleFlow_24h", "FinBERT_score", "Volume_ratio",
];
const ops: Op[] = [">", "<", ">=", "<=", "==", "crosses_above", "crosses_below"];

const SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD", "AAPL", "MSFT", "TSLA", "SPY", "QQQ"];
const INTERVALS = ["1d", "1h", "4h", "1wk", "15m", "30m"];

const STORAGE_KEY = "bitengine_saved_signals";

function loadSavedSignals(): SavedSignal[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function persistSignals(signals: SavedSignal[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(signals));
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function SignalBuilderPage() {
  const [name, setName] = useState("My Signal");
  const [symbol, setSymbol] = useState("BTC-USD");
  const [interval, setInterval] = useState("1d");
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");

  const [conditions, setConditions] = useState<Condition[]>([
    { id: "c1", indicator: "EMA(20)",      op: "crosses_above", value: "EMA(50)" },
    { id: "c2", indicator: "ADX(14)",      op: ">",             value: "25" },
    { id: "c3", indicator: "Volume_ratio", op: ">",             value: "1.5" },
  ]);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const [savedSignals, setSavedSignals] = useState<SavedSignal[]>(loadSavedSignals);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [mySigOpen, setMySigOpen] = useState(false);

  const addCondition = () =>
    setConditions((c) => [...c, { id: `c${Date.now()}`, indicator: indicators[0]!, op: ">", value: "0" }]);

  const updateCondition = (id: string, patch: Partial<Condition>) =>
    setConditions((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const removeCondition = (id: string) =>
    setConditions((cs) => cs.filter((c) => c.id !== id));

  const runTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const res = await fetch(`${SIGNAL_BASE}/api/v1/signals/test-builder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conditions: conditions.map((c) => ({
            indicator: c.indicator,
            op: c.op,
            value: c.value,
            compare_to: "value",
          })),
          symbol,
          interval,
          start_date: startDate,
          end_date: endDate,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data: TestResult = await res.json();
      setTestResult(data);
    } catch (e: unknown) {
      setTestError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setTesting(false);
    }
  }, [conditions, symbol, interval, startDate, endDate]);

  const saveSignal = () => {
    const sig: SavedSignal = {
      name: saveName.trim() || name,
      conditions,
      symbol,
      interval,
      savedAt: new Date().toISOString(),
    };
    const updated = [sig, ...savedSignals.filter((s) => s.name !== sig.name)];
    setSavedSignals(updated);
    persistSignals(updated);
    setSaveDialogOpen(false);
    setSaveName("");
  };

  const loadSignal = (sig: SavedSignal) => {
    setName(sig.name);
    setConditions(sig.conditions);
    setSymbol(sig.symbol);
    setInterval(sig.interval);
    setTestResult(null);
    setTestError(null);
  };

  const deleteSignal = (sigName: string) => {
    const updated = savedSignals.filter((s) => s.name !== sigName);
    setSavedSignals(updated);
    persistSignals(updated);
  };

  const winRateColor = testResult
    ? testResult.win_rate >= 0.5 ? "text-emerald-400" : "text-red-400"
    : "";

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1200px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Signal Builder</h1>
        <p className="text-sm text-slate-400 mt-1">Compose entry conditions from indicators and on-chain feeds · back-test against real bars</p>
      </div>

      {/* ── Symbol + Date Range ────────────────────────────── */}
      <div className="card-dark p-5 flex flex-wrap gap-4 items-end">
        <div className="flex flex-col gap-1.5 min-w-[140px]">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Symbol</label>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 font-mono focus:border-cyan-500 outline-none"
          >
            {SYMBOLS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1.5 min-w-[110px]">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Interval</label>
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 font-mono focus:border-cyan-500 outline-none"
          >
            {INTERVALS.map((v) => <option key={v}>{v}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 font-mono focus:border-cyan-500 outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 font-mono focus:border-cyan-500 outline-none"
          />
        </div>
      </div>

      {/* ── Condition Builder ──────────────────────────────── */}
      <div className="card-dark p-5">
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-lg font-bold bg-transparent text-slate-50 outline-none border-b border-transparent focus:border-cyan-500 transition-colors"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setSaveName(name); setSaveDialogOpen(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-sm font-medium hover:bg-slate-700 transition-colors"
            >
              <Save className="w-3.5 h-3.5" /> Save Signal
            </button>
            <button
              onClick={runTest}
              disabled={testing || conditions.length === 0}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors",
                testing
                  ? "bg-slate-700 text-slate-400 cursor-wait"
                  : "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
              )}
            >
              <Play className="w-3.5 h-3.5" />
              {testing ? "Testing…" : "Test Signal"}
            </button>
          </div>
        </div>

        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3">Buy when ALL of:</p>

        <div className="flex flex-col gap-2">
          {conditions.map((c, idx) => (
            <div key={c.id} className="flex items-center gap-2 p-3 rounded-lg bg-slate-900/60 border border-slate-800">
              <span className="text-[10px] uppercase font-bold text-slate-500 w-8">{idx === 0 ? "WHEN" : "AND"}</span>

              <select
                value={c.indicator}
                onChange={(e) => updateCondition(c.id, { indicator: e.target.value })}
                className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 font-mono focus:border-cyan-500 outline-none"
              >
                {indicators.map((i) => <option key={i}>{i}</option>)}
              </select>

              <select
                value={c.op}
                onChange={(e) => updateCondition(c.id, { op: e.target.value as Op })}
                className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-cyan-300 font-mono focus:border-cyan-500 outline-none"
              >
                {ops.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
              </select>

              <input
                value={c.value}
                onChange={(e) => updateCondition(c.id, { value: e.target.value })}
                placeholder="value or indicator"
                className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 font-mono focus:border-cyan-500 outline-none"
              />

              <button
                onClick={() => removeCondition(c.id)}
                className="text-slate-500 hover:text-red-400 transition-colors p-1.5"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={addCondition}
          className="mt-3 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 border border-dashed border-slate-700 text-slate-400 text-sm hover:bg-slate-700 hover:text-slate-200 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add condition
        </button>
      </div>

      {/* ── Test Results Panel ─────────────────────────────── */}
      {(testResult || testError) && (
        <div className={cn(
          "card-dark p-5 border",
          testError ? "border-red-500/30" : "border-cyan-500/20"
        )}>
          {testError ? (
            <div className="flex items-start gap-3 text-red-400">
              <XCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-sm">Test failed</p>
                <p className="text-xs text-red-400/80 mt-0.5">{testError}</p>
              </div>
            </div>
          ) : testResult && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-cyan-400" />
                <h2 className="text-sm font-semibold text-slate-100">
                  Test results · {testResult.symbol} · {testResult.interval} · {testResult.start_date} → {testResult.end_date}
                </h2>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <ResultStat
                  label="Signal Count"
                  value={`${testResult.signal_count}`}
                  sub={`of ${testResult.bar_count} bars`}
                />
                <ResultStat
                  label="Win Rate"
                  value={testResult.signal_count > 0 ? `${(testResult.win_rate * 100).toFixed(1)}%` : "—"}
                  valueClass={winRateColor}
                  badge={testResult.signal_count > 0 ? (testResult.win_rate >= 0.5 ? "positive" : "negative") : undefined}
                />
                <ResultStat
                  label="Avg Return (5-bar)"
                  value={testResult.signal_count > 0
                    ? `${testResult.avg_return_pct >= 0 ? "+" : ""}${testResult.avg_return_pct.toFixed(2)}%`
                    : "—"}
                  valueClass={testResult.avg_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}
                />
                <ResultStat label="Bar Count" value={`${testResult.bar_count}`} />
              </div>

              {testResult.sample_signals.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2 flex items-center gap-1.5">
                    <Clock className="w-3 h-3" /> First {testResult.sample_signals.slice(0, 5).length} signal dates
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {testResult.sample_signals.slice(0, 5).map((ts) => (
                      <span key={ts} className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs font-mono text-slate-300">
                        {fmtDate(ts)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {testResult.warnings.length > 0 && (
                <div className="flex flex-col gap-1.5 mt-1">
                  {testResult.warnings.map((w, i) => (
                    <div key={i} className="flex items-center gap-2 text-amber-400 text-xs">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                      {w}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Compiled Preview ───────────────────────────────── */}
      <div className="card-dark p-5">
        <h2 className="text-sm font-semibold text-slate-100 mb-3">Compiled Pinescript-style preview</h2>
        <pre className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">
{`signal "${name}" on ${symbol} ${interval}:
  buy when:
${conditions.map((c, i) => `    ${i === 0 ? "" : "and "}${c.indicator} ${c.op.replace(/_/g, " ")} ${c.value}`).join("\n")}`}
        </pre>
      </div>

      {/* ── My Signals ────────────────────────────────────── */}
      <div className="card-dark">
        <button
          onClick={() => setMySigOpen((v) => !v)}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <div className="flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-semibold text-slate-100">My Saved Signals</h2>
            {savedSignals.length > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 text-[10px] font-bold">{savedSignals.length}</span>
            )}
          </div>
          {mySigOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
        </button>

        {mySigOpen && (
          <div className="px-5 pb-5">
            {savedSignals.length === 0 ? (
              <p className="text-sm text-slate-500">No saved signals yet — build one above and click Save Signal.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {savedSignals.map((sig) => (
                  <div key={sig.name} className="flex items-center gap-3 p-3 rounded-lg bg-slate-900/60 border border-slate-800">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-200 truncate">{sig.name}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {sig.symbol} · {sig.interval} · {sig.conditions.length} condition{sig.conditions.length !== 1 ? "s" : ""} · saved {fmtDate(sig.savedAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => loadSignal(sig)}
                      className="px-2.5 py-1 rounded-md bg-slate-800 text-cyan-300 text-xs font-semibold hover:bg-slate-700 transition-colors"
                    >
                      Load
                    </button>
                    <button
                      onClick={() => deleteSignal(sig.name)}
                      className="text-slate-500 hover:text-red-400 transition-colors p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Save Dialog (modal) ────────────────────────────── */}
      {saveDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="card-dark p-6 w-full max-w-sm mx-4 border border-slate-700">
            <h3 className="text-base font-semibold text-slate-100 mb-4">Save Signal</h3>
            <input
              autoFocus
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveSignal(); if (e.key === "Escape") setSaveDialogOpen(false); }}
              placeholder="Signal name…"
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 font-mono focus:border-cyan-500 outline-none mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setSaveDialogOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-sm hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveSignal}
                className="px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultStat({
  label,
  value,
  sub,
  valueClass,
  badge,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
  badge?: "positive" | "negative";
}) {
  return (
    <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</p>
      <div className="flex items-baseline gap-2 mt-1">
        <p className={cn("text-xl font-bold number-font", valueClass ?? "text-slate-100")}>{value}</p>
        {badge && (
          <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
            badge === "positive" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>
            {badge === "positive" ? "good" : "low"}
          </span>
        )}
      </div>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}
