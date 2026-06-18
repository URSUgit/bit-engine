"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { backtestApi } from "@/lib/backtest-api";

// ── Types ─────────────────────────────────────────────────────────────────────

type AlertCondition = "above" | "below" | "change_pct";

type Alert = {
  id: string;
  condition: AlertCondition;
  threshold: number;
  triggered: boolean;
  createdAt: string;
};

type WatchEntry = {
  symbol: string;
  addedAt: string;
  alerts: Alert[];
  notes: string;
};

type PriceData = {
  price: number | null;
  change24h: number | null;
  lastFetched: number;
};

const STORAGE_KEY = "bt_watchlist_v1";
const REFRESH_INTERVAL_MS = 30_000;

// ── Persistence ───────────────────────────────────────────────────────────────

function loadList(): WatchEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveList(list: WatchEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(p: number | null): string {
  if (p === null) return "—";
  return p >= 1000
    ? p.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : p < 0.01
    ? p.toFixed(6)
    : p.toFixed(4);
}

async function fetchPrice(symbol: string): Promise<{ price: number | null; change24h: number | null }> {
  try {
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
    const data = await backtestApi.data(symbol, startDate, endDate, "1d");
    const bars = data.bars;
    if (!bars || bars.length < 2) return { price: null, change24h: null };
    const price = bars[bars.length - 1].c;
    const prev  = bars[bars.length - 2].c;
    const change24h = prev > 0 ? ((price - prev) / prev) * 100 : null;
    return { price, change24h };
  } catch {
    return { price: null, change24h: null };
  }
}

function checkAlerts(entry: WatchEntry, price: number): Alert[] {
  return entry.alerts.map((a) => {
    if (a.triggered) return a;
    let fired = false;
    if (a.condition === "above" && price >= a.threshold) fired = true;
    if (a.condition === "below" && price <= a.threshold) fired = true;
    return fired ? { ...a, triggered: true } : a;
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PriceRow({ priceData }: { priceData: PriceData }) {
  if (priceData.price === null) {
    return <span className="text-zinc-600 text-sm">Loading…</span>;
  }
  const chg = priceData.change24h;
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-base font-bold text-zinc-100">${formatPrice(priceData.price)}</span>
      {chg !== null && (
        <span className={`text-xs font-medium ${chg >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
        </span>
      )}
    </div>
  );
}

function AlertBadge({ alert, price }: { alert: Alert; price: number | null }) {
  const condLabel = alert.condition === "above" ? "↑" : alert.condition === "below" ? "↓" : "Δ";
  const dist = price !== null && alert.condition !== "change_pct"
    ? ((alert.threshold - price) / price * 100)
    : null;

  return (
    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] ${
      alert.triggered
        ? "bg-yellow-900/60 border-yellow-700 text-yellow-300"
        : "bg-zinc-800/50 border-zinc-700 text-zinc-400"
    }`}>
      <span className="font-bold">{condLabel}</span>
      <span className="font-mono">${formatPrice(alert.threshold)}</span>
      {!alert.triggered && dist !== null && (
        <span className={`${Math.abs(dist) < 2 ? "text-orange-400 font-semibold" : "text-zinc-600"}`}>
          ({dist >= 0 ? "+" : ""}{dist.toFixed(1)}%)
        </span>
      )}
      {alert.triggered && <span>FIRED</span>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function Watchlist({
  onSelectSymbol,
}: {
  onSelectSymbol?: (symbol: string) => void;
}) {
  const [list, setList] = useState<WatchEntry[]>([]);
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [open, setOpen] = useState(true);
  const [addInput, setAddInput] = useState("");
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [alertInput, setAlertInput] = useState({ condition: "above" as AlertCondition, threshold: "" });
  const [firedAlerts, setFiredAlerts] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setList(loadList()); }, []);

  // Fetch prices and check alerts
  const refreshPrices = useCallback(async (entries: WatchEntry[]) => {
    const updates: Record<string, PriceData> = {};
    await Promise.all(
      entries.map(async (e) => {
        const { price, change24h } = await fetchPrice(e.symbol);
        updates[e.symbol] = { price, change24h, lastFetched: Date.now() };

        // Check alerts
        if (price !== null) {
          const newAlerts = checkAlerts(e, price);
          const justFired = newAlerts.filter((a, i) => a.triggered && !e.alerts[i]?.triggered);
          if (justFired.length > 0) {
            setFiredAlerts((prev) => [
              ...prev,
              ...justFired.map((a) => `${e.symbol} alert: ${a.condition} $${a.threshold}`),
            ]);
            // Browser notification if permission granted
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              justFired.forEach((a) => {
                new Notification(`Price Alert: ${e.symbol}`, {
                  body: `Price ${a.condition === "above" ? "crossed above" : "dropped below"} $${a.threshold}`,
                });
              });
            }
            setList((prev) => {
              const next = prev.map((en) => en.symbol === e.symbol ? { ...en, alerts: newAlerts } : en);
              saveList(next);
              return next;
            });
          }
        }
      })
    );
    setPrices((prev) => ({ ...prev, ...updates }));
  }, []);

  useEffect(() => {
    if (list.length === 0) return;
    refreshPrices(list);
    timerRef.current = setInterval(() => refreshPrices(list), REFRESH_INTERVAL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [list, refreshPrices]);

  function addSymbol() {
    const sym = addInput.trim().toUpperCase();
    if (!sym || list.some((e) => e.symbol === sym)) return;
    const next = [...list, { symbol: sym, addedAt: new Date().toISOString(), alerts: [], notes: "" }];
    setList(next);
    saveList(next);
    setAddInput("");
    refreshPrices(next);
  }

  function removeSymbol(symbol: string) {
    const next = list.filter((e) => e.symbol !== symbol);
    setList(next);
    saveList(next);
    if (expandedSymbol === symbol) setExpandedSymbol(null);
  }

  function addAlert(symbol: string) {
    const threshold = parseFloat(alertInput.threshold);
    if (isNaN(threshold)) return;
    const next = list.map((e) =>
      e.symbol === symbol
        ? { ...e, alerts: [...e.alerts, { id: Date.now().toString(), condition: alertInput.condition, threshold, triggered: false, createdAt: new Date().toISOString() }] }
        : e
    );
    setList(next);
    saveList(next);
    setAlertInput({ condition: "above", threshold: "" });

    // Request notification permission
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  function removeAlert(symbol: string, alertId: string) {
    const next = list.map((e) =>
      e.symbol === symbol ? { ...e, alerts: e.alerts.filter((a) => a.id !== alertId) } : e
    );
    setList(next);
    saveList(next);
  }

  function updateNotes(symbol: string, notes: string) {
    const next = list.map((e) => e.symbol === symbol ? { ...e, notes } : e);
    setList(next);
    saveList(next);
  }

  const firedCount = list.reduce((s, e) => s + e.alerts.filter((a) => a.triggered).length, 0);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800/50 transition"
      >
        <span className="flex items-center gap-2">
          <span>👀</span>
          Watchlist
          {list.length > 0 && (
            <span className="text-xs bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded-full">{list.length}</span>
          )}
          {firedCount > 0 && (
            <span className="text-xs bg-yellow-800 text-yellow-300 px-1.5 py-0.5 rounded-full animate-pulse">{firedCount} alert{firedCount !== 1 ? "s" : ""}</span>
          )}
        </span>
        <span className="text-zinc-600 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 p-3 space-y-3">
          {/* Add symbol input */}
          <div className="flex gap-2">
            <input
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addSymbol(); }}
              placeholder="BTCUSDT, ETHUSDT…"
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={addSymbol}
              className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs font-medium transition"
            >
              Add
            </button>
          </div>

          {/* Fired alerts banner */}
          {firedAlerts.length > 0 && (
            <div className="bg-yellow-950/50 border border-yellow-800/60 rounded p-2 space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-yellow-500 font-semibold">Triggered Alerts</div>
              {firedAlerts.slice(-3).map((msg, i) => (
                <div key={i} className="text-xs text-yellow-300">{msg}</div>
              ))}
            </div>
          )}

          {/* Symbol list */}
          {list.length === 0 && (
            <div className="text-xs text-zinc-600 text-center py-2">No symbols watched yet.</div>
          )}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {list.map((entry) => {
              const pd = prices[entry.symbol];
              const isExpanded = expandedSymbol === entry.symbol;
              return (
                <div key={entry.symbol} className="border border-zinc-800 rounded-lg overflow-hidden">
                  {/* Symbol row */}
                  <div
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-800/30 transition"
                    onClick={() => setExpandedSymbol(isExpanded ? null : entry.symbol)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-zinc-200">{entry.symbol}</span>
                        {entry.alerts.some((a) => a.triggered) && (
                          <span className="text-[9px] bg-yellow-800 text-yellow-300 px-1.5 py-0.5 rounded-full font-semibold">ALERT</span>
                        )}
                      </div>
                      {pd && <PriceRow priceData={pd} />}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {onSelectSymbol && (
                        <button
                          onClick={(ev) => { ev.stopPropagation(); onSelectSymbol(entry.symbol); }}
                          className="text-[10px] px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 border border-zinc-600 transition"
                        >
                          Select
                        </button>
                      )}
                      <button
                        onClick={(ev) => { ev.stopPropagation(); removeSymbol(entry.symbol); }}
                        className="text-zinc-600 hover:text-red-400 transition text-xs px-1"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Active alerts compact row */}
                  {!isExpanded && entry.alerts.length > 0 && (
                    <div className="flex gap-1 flex-wrap px-3 pb-2">
                      {entry.alerts.map((a) => (
                        <AlertBadge key={a.id} alert={a} price={pd?.price ?? null} />
                      ))}
                    </div>
                  )}

                  {/* Expanded panel */}
                  {isExpanded && (
                    <div className="border-t border-zinc-800 p-3 space-y-3 bg-zinc-900/30">
                      {/* Alert creation */}
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-zinc-600 mb-1.5">Add Alert</div>
                        <div className="flex gap-1.5">
                          <select
                            value={alertInput.condition}
                            onChange={(e) => setAlertInput((p) => ({ ...p, condition: e.target.value as AlertCondition }))}
                            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-cyan-500"
                          >
                            <option value="above">Price above</option>
                            <option value="below">Price below</option>
                          </select>
                          <input
                            type="number"
                            value={alertInput.threshold}
                            onChange={(e) => setAlertInput((p) => ({ ...p, threshold: e.target.value }))}
                            onKeyDown={(ev) => { if (ev.key === "Enter") addAlert(entry.symbol); }}
                            placeholder="Target price"
                            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500"
                          />
                          <button
                            onClick={() => addAlert(entry.symbol)}
                            className="px-2.5 py-1 rounded bg-cyan-800 hover:bg-cyan-700 text-white text-xs transition"
                          >
                            Set
                          </button>
                        </div>
                      </div>

                      {/* Alert list */}
                      {entry.alerts.length > 0 && (
                        <div className="space-y-1">
                          {entry.alerts.map((a) => (
                            <div key={a.id} className="flex items-center gap-2">
                              <AlertBadge alert={a} price={pd?.price ?? null} />
                              <button
                                onClick={() => removeAlert(entry.symbol, a.id)}
                                className="text-zinc-700 hover:text-red-400 transition text-xs ml-auto"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Notes */}
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-zinc-600 mb-1">Notes</div>
                        <textarea
                          value={entry.notes}
                          onChange={(e) => updateNotes(entry.symbol, e.target.value)}
                          placeholder="Market context, trade thesis…"
                          rows={2}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-600 resize-none"
                        />
                      </div>

                      {pd?.lastFetched && (
                        <div className="text-[10px] text-zinc-700">
                          Updated {new Date(pd.lastFetched).toLocaleTimeString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {list.length > 0 && (
            <div className="text-[10px] text-zinc-700 text-center">
              Refreshes every 30s · alerts via browser notification
            </div>
          )}
        </div>
      )}
    </div>
  );
}
