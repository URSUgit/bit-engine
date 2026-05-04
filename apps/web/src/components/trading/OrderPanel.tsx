"use client";

import { useMemo, useState } from "react";
import { TrendingDown, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface OrderPanelProps {
  symbol: string;
  currentPrice: number;
}

type Side = "long" | "short";
type OrderType = "market" | "limit" | "stop";

export function OrderPanel({ symbol, currentPrice }: OrderPanelProps) {
  const [side, setSide] = useState<Side>("long");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [sizeUsd, setSizeUsd] = useState("");
  const [limitPrice, setLimitPrice] = useState(currentPrice.toFixed(2));
  const [leverage, setLeverage] = useState(5);
  const [tpslOpen, setTpslOpen] = useState(false);
  const [tpPrice, setTpPrice] = useState("");
  const [slPrice, setSlPrice] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const parsedSize = parseFloat(sizeUsd) || 0;
  const entryPrice =
    orderType === "market" ? currentPrice : parseFloat(limitPrice) || currentPrice;
  const sizeContracts = parsedSize > 0 ? parsedSize / entryPrice : 0;
  const marginRequired = parsedSize > 0 ? parsedSize / leverage : 0;
  const estimatedFee = parsedSize * 0.00025; // 0.025% Hyperliquid taker rate

  const liqPrice = useMemo(() => {
    if (!entryPrice || !parsedSize) return null;
    return side === "long"
      ? entryPrice * (1 - 0.9 / leverage)
      : entryPrice * (1 + 0.9 / leverage);
  }, [side, entryPrice, parsedSize, leverage]);

  function handleSubmit() {
    if (!parsedSize) return;
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 2200);
  }

  const inputCls =
    "w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-100 number-font focus:outline-none focus:border-cyan-500/50 placeholder:text-slate-700";

  return (
    <div className="card-dark flex flex-col">
      {/* Side toggle */}
      <div className="p-4 border-b border-slate-800">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3">
          Place Order
        </p>
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950 rounded-lg border border-slate-900">
          <button
            onClick={() => setSide("long")}
            className={cn(
              "py-2 rounded-md text-sm font-bold transition-all flex items-center justify-center gap-1.5",
              side === "long"
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                : "text-slate-500 hover:text-slate-300"
            )}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Long
          </button>
          <button
            onClick={() => setSide("short")}
            className={cn(
              "py-2 rounded-md text-sm font-bold transition-all flex items-center justify-center gap-1.5",
              side === "short"
                ? "bg-red-500/15 text-red-400 border border-red-500/25"
                : "text-slate-500 hover:text-slate-300"
            )}
          >
            <TrendingDown className="w-3.5 h-3.5" />
            Short
          </button>
        </div>
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* Order type */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">
            Order Type
          </p>
          <div className="flex gap-0.5 p-1 bg-slate-900 rounded-lg border border-slate-800">
            {(["market", "limit", "stop"] as OrderType[]).map((t) => (
              <button
                key={t}
                onClick={() => setOrderType(t)}
                className={cn(
                  "flex-1 py-1.5 rounded text-[11px] font-bold uppercase tracking-wide transition-colors",
                  orderType === t
                    ? "bg-slate-800 text-slate-100"
                    : "text-slate-500 hover:text-slate-400"
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Limit / stop price */}
        {orderType !== "market" && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">
              {orderType === "limit" ? "Limit Price" : "Stop Price"} (USD)
            </p>
            <input
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              className={inputCls}
              placeholder="0.00"
            />
          </div>
        )}

        {/* Size */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">
            Size (USD)
          </p>
          <input
            type="number"
            value={sizeUsd}
            onChange={(e) => setSizeUsd(e.target.value)}
            className={inputCls}
            placeholder="0.00"
          />
          {sizeContracts > 0 && (
            <p className="text-[11px] text-slate-500 mt-1 number-font">
              ≈{" "}
              {sizeContracts < 0.0001
                ? sizeContracts.toExponential(3)
                : sizeContracts < 1
                ? sizeContracts.toFixed(5)
                : sizeContracts.toFixed(4)}{" "}
              {symbol}
            </p>
          )}
          <div className="flex gap-1 mt-2">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                onClick={() => setSizeUsd(((10_000 * pct) / 100).toFixed(0))}
                className="flex-1 py-1 rounded text-[11px] font-semibold text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-800 transition-colors"
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>

        {/* Leverage */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
              Leverage
            </p>
            <span className="text-sm font-bold text-cyan-300 number-font">{leverage}×</span>
          </div>
          <input
            type="range"
            min={1}
            max={20}
            step={1}
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-slate-800
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4
              [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-cyan-400 [&::-webkit-slider-thumb]:cursor-pointer
              [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(34,211,238,0.55)]"
          />
          <div className="flex justify-between text-[10px] text-slate-700 mt-1 font-semibold select-none">
            {[1, 5, 10, 15, 20].map((v) => (
              <span key={v} className={leverage === v ? "text-cyan-500" : undefined}>
                {v}×
              </span>
            ))}
          </div>
        </div>

        {/* TP / SL accordion */}
        <div className="border border-slate-800/70 rounded-lg overflow-hidden">
          <button
            onClick={() => setTpslOpen((o) => !o)}
            className="flex items-center justify-between w-full px-3 py-2.5 text-[10px] uppercase tracking-widest font-bold text-slate-500 hover:bg-slate-900/40 transition-colors"
          >
            <span>Take Profit / Stop Loss</span>
            {tpslOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {tpslOpen && (
            <div className="px-3 pb-3 pt-2.5 flex flex-col gap-2.5 border-t border-slate-800/70">
              <div>
                <p className="text-[10px] text-slate-500 mb-1.5 font-semibold">
                  Take Profit (USD)
                </p>
                <input
                  type="number"
                  value={tpPrice}
                  onChange={(e) => setTpPrice(e.target.value)}
                  placeholder={
                    side === "long"
                      ? `> ${entryPrice.toFixed(2)}`
                      : `< ${entryPrice.toFixed(2)}`
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-emerald-400 number-font focus:outline-none focus:border-emerald-500/40 placeholder:text-slate-700"
                />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 mb-1.5 font-semibold">
                  Stop Loss (USD)
                </p>
                <input
                  type="number"
                  value={slPrice}
                  onChange={(e) => setSlPrice(e.target.value)}
                  placeholder={
                    side === "long"
                      ? `< ${entryPrice.toFixed(2)}`
                      : `> ${entryPrice.toFixed(2)}`
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-red-400 number-font focus:outline-none focus:border-red-500/40 placeholder:text-slate-700"
                />
              </div>
            </div>
          )}
        </div>

        {/* Order summary */}
        {parsedSize > 0 && (
          <div className="bg-slate-900/50 rounded-lg border border-slate-800/70 divide-y divide-slate-800/50">
            <SummaryRow label="Margin required" value={`$${marginRequired.toFixed(2)}`} />
            <SummaryRow
              label="Est. fee (0.025%)"
              value={`$${estimatedFee.toFixed(3)}`}
              muted
            />
            {liqPrice !== null && (
              <SummaryRow
                label="Liq. price"
                value={
                  liqPrice >= 1
                    ? `$${liqPrice.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    : `$${liqPrice.toFixed(6)}`
                }
                accent={side === "long" ? "text-red-400" : "text-emerald-400"}
              />
            )}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!parsedSize}
          className={cn(
            "w-full py-2.5 rounded-lg text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed",
            submitted
              ? "bg-slate-800 text-slate-400"
              : side === "long"
              ? "bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/25 hover:border-emerald-500/40"
              : "bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 hover:border-red-500/40"
          )}
        >
          {submitted
            ? "✓ Order placed (simulated)"
            : `Place ${side === "long" ? "Long" : "Short"} · ${leverage}×`}
        </button>
        <p className="text-center text-[10px] text-slate-700 -mt-2">
          Demo — no real trades executed
        </p>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  muted,
  accent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: string;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span
        className={cn(
          "text-[11px] font-semibold number-font",
          accent ?? (muted ? "text-slate-500" : "text-slate-300")
        )}
      >
        {value}
      </span>
    </div>
  );
}
