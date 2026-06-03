"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Wallet, RefreshCw, TrendingUp, TrendingDown, AlertTriangle,
  ShieldCheck, Search, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AccountSummary, Fill, MarketAsset } from "@/lib/hyperliquid";

const LS_KEY = "hl_tracked_address";

function fmtUsd(n: number, dp = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function looksLikePrivateKey(s: string): boolean {
  return /^0x?[0-9a-fA-F]{64}$/.test(s.trim());
}
function isValidAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s.trim());
}

export default function HyperliquidPage() {
  const [input, setInput] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [fills, setFills] = useState<Fill[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [warn, setWarn] = useState("");

  // Restore tracked address from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved && isValidAddress(saved)) { setInput(saved); setAddress(saved); }
  }, []);

  const load = useCallback(async (addr: string) => {
    setLoading(true); setError("");
    try {
      const [accRes, fillsRes] = await Promise.all([
        fetch(`/api/hyperliquid/account?address=${addr}`).then((r) => r.json()),
        fetch(`/api/hyperliquid/fills?address=${addr}&limit=100`).then((r) => r.json()),
      ]);
      if (accRes.error) { setError(accRes.detail ?? "Could not load account"); setAccount(null); }
      else setAccount(accRes.data);
      setFills(fillsRes.error ? [] : fillsRes.data);
    } catch {
      setError("Network error reaching Hyperliquid.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!address) return;
    load(address);
    const id = window.setInterval(() => load(address), 20_000);
    return () => window.clearInterval(id);
  }, [address, load]);

  function connect() {
    const v = input.trim();
    setWarn("");
    if (looksLikePrivateKey(v)) {
      setWarn("That is a private key (64 hex chars) — never paste it anywhere. Enter your PUBLIC address (0x + 40 hex). Rotate that key if it was real.");
      return;
    }
    if (!isValidAddress(v)) {
      setError("Enter a valid 0x wallet address (40 hex characters).");
      return;
    }
    setError("");
    localStorage.setItem(LS_KEY, v);
    setAddress(v);
  }

  function disconnect() {
    localStorage.removeItem(LS_KEY);
    setAddress(null); setAccount(null); setFills(null); setInput("");
  }

  const totalUpnl = account?.positions.reduce((s, p) => s + p.unrealized_pnl, 0) ?? 0;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Wallet className="w-6 h-6 text-cyan-400" />
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Hyperliquid Account</h1>
          </div>
          <p className="text-sm text-slate-400 mt-1">Track any Hyperliquid wallet — positions, P&amp;L and fills, read-only</p>
        </div>
        {address && (
          <button onClick={() => load(address)} disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} /> Refresh
          </button>
        )}
      </div>

      {/* Security note */}
      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-400">
          This connects <span className="text-slate-200 font-semibold">read-only</span> using your public wallet address.
          It never asks for or stores a private key. Tracking cannot move funds or place trades.
        </p>
      </div>

      {/* Connect form */}
      {!address ? (
        <div className="card-dark p-6 max-w-xl">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-2">Public wallet address</label>
          <div className="flex gap-2">
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-800 flex-1">
              <Search className="w-4 h-4 text-slate-500 shrink-0" />
              <input
                value={input}
                onChange={(e) => { setInput(e.target.value); setWarn(""); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && connect()}
                placeholder="0x… (40 hex characters)"
                className="bg-transparent outline-none text-sm text-slate-200 placeholder:text-slate-600 w-full font-mono"
              />
            </div>
            <button onClick={connect}
              className="px-5 py-2.5 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors">
              Connect
            </button>
          </div>
          {warn && (
            <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2 text-xs text-red-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {warn}
            </div>
          )}
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        </div>
      ) : (
        <>
          {/* Account header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono text-slate-300">{address.slice(0, 8)}…{address.slice(-6)}</span>
              <a href={`https://app.hyperliquid.xyz/explorer/address/${address}`} target="_blank" rel="noreferrer"
                className="text-cyan-400 hover:text-cyan-300"><ExternalLink className="w-3.5 h-3.5" /></a>
              <button onClick={disconnect} className="text-xs text-slate-500 hover:text-red-400 ml-2">Disconnect</button>
            </div>
          </div>

          {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm text-red-300">{error}</div>}

          {/* Summary cards */}
          {account && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Account Value" value={`$${fmtUsd(account.account_value)}`} />
              <StatCard label="Unrealized P&L" value={`${totalUpnl >= 0 ? "+" : ""}$${fmtUsd(totalUpnl)}`} positive={totalUpnl >= 0} />
              <StatCard label="Margin Used" value={`$${fmtUsd(account.total_margin_used)}`} />
              <StatCard label="Withdrawable" value={`$${fmtUsd(account.withdrawable)}`} />
            </div>
          )}

          {/* Positions */}
          {account && (
            <div className="card-dark overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100">Open Positions ({account.positions.length})</h2>
              </div>
              {account.positions.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-slate-500">No open positions</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[760px]">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        <th className="px-4 py-3 text-left">Coin</th>
                        <th className="px-4 py-3 text-left">Side</th>
                        <th className="px-4 py-3 text-right">Size</th>
                        <th className="px-4 py-3 text-right">Entry</th>
                        <th className="px-4 py-3 text-right">Value</th>
                        <th className="px-4 py-3 text-right">uPnL</th>
                        <th className="px-4 py-3 text-right">ROE</th>
                        <th className="px-4 py-3 text-right">Lev</th>
                        <th className="px-4 py-3 text-right">Liq. Price</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {account.positions.map((p) => (
                        <tr key={p.coin} className="hover:bg-slate-900/40 transition-colors">
                          <td className="px-4 py-3 font-semibold text-slate-100">{p.coin}</td>
                          <td className="px-4 py-3">
                            <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1",
                              p.side === "long" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")}>
                              {p.side === "long" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {p.side}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-300 number-font">{p.size.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                          <td className="px-4 py-3 text-right text-slate-300 number-font">${fmtUsd(p.entry_price, p.entry_price < 1 ? 5 : 2)}</td>
                          <td className="px-4 py-3 text-right text-slate-300 number-font">${fmtUsd(p.position_value)}</td>
                          <td className={cn("px-4 py-3 text-right number-font font-semibold", p.unrealized_pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                            {p.unrealized_pnl >= 0 ? "+" : ""}${fmtUsd(p.unrealized_pnl)}
                          </td>
                          <td className={cn("px-4 py-3 text-right number-font", p.roe_pct >= 0 ? "text-emerald-400" : "text-red-400")}>
                            {p.roe_pct >= 0 ? "+" : ""}{p.roe_pct.toFixed(1)}%
                          </td>
                          <td className="px-4 py-3 text-right text-slate-400 number-font">{p.leverage}×</td>
                          <td className="px-4 py-3 text-right text-orange-400 number-font">{p.liquidation_price != null ? `$${fmtUsd(p.liquidation_price, p.liquidation_price < 1 ? 5 : 2)}` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Recent fills */}
          {fills && fills.length > 0 && (
            <div className="card-dark overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100">Recent Fills ({fills.length})</h2>
              </div>
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-800">
                      <th className="px-4 py-2 text-left">Time</th>
                      <th className="px-4 py-2 text-left">Coin</th>
                      <th className="px-4 py-2 text-left">Direction</th>
                      <th className="px-4 py-2 text-right">Price</th>
                      <th className="px-4 py-2 text-right">Size</th>
                      <th className="px-4 py-2 text-right">Closed PnL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {fills.map((f, i) => (
                      <tr key={`${f.hash}-${i}`} className="hover:bg-slate-900/40 transition-colors text-xs">
                        <td className="px-4 py-2 text-slate-500">{new Date(f.time).toLocaleString()}</td>
                        <td className="px-4 py-2 font-semibold text-slate-200">{f.coin}</td>
                        <td className="px-4 py-2 text-slate-400">{f.direction || (f.side === "buy" ? "Buy" : "Sell")}</td>
                        <td className="px-4 py-2 text-right text-slate-300 number-font">${fmtUsd(f.price, f.price < 1 ? 5 : 2)}</td>
                        <td className="px-4 py-2 text-right text-slate-300 number-font">{f.size.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                        <td className={cn("px-4 py-2 text-right number-font", f.closed_pnl > 0 ? "text-emerald-400" : f.closed_pnl < 0 ? "text-red-400" : "text-slate-600")}>
                          {f.closed_pnl !== 0 ? `${f.closed_pnl > 0 ? "+" : ""}$${fmtUsd(f.closed_pnl)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="card-dark p-4">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</p>
      <p className={cn("text-xl font-bold number-font mt-1",
        positive === true ? "text-emerald-400" : positive === false ? "text-red-400" : "text-slate-100")}>
        {value}
      </p>
    </div>
  );
}
