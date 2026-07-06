"use client";

import { useState } from "react";
import type { BacktestResult, StrategyInfo } from "@/lib/backtest-api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | undefined | null, digits = 2, suffix = ""): string {
  if (v == null || isNaN(v)) return "—";
  return v.toFixed(digits) + suffix;
}

function svgEquityCurve(
  equity: BacktestResult["equity_curve"],
  benchmark?: BacktestResult["equity_curve"],
  width = 600,
  height = 120,
): string {
  if (!equity.length) return "";
  const pts = (arr: typeof equity) => {
    const vals = arr.map((p) => p.equity);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    return arr
      .map((p, i) => {
        const x = (i / (arr.length - 1 || 1)) * width;
        const y = height - ((p.equity - min) / range) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };

  const benchmarkLine = benchmark?.length
    ? `<polyline fill="none" stroke="#71717a" stroke-width="1.5" opacity="0.5" points="${pts(benchmark)}" />`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;background:#18181b;border-radius:6px;">
  ${benchmarkLine}
  <polyline fill="none" stroke="#06b6d4" stroke-width="2" points="${pts(equity)}" />
</svg>`;
}

function buildHtmlReport(result: BacktestResult, strategy?: StrategyInfo): string {
  const m = result.metrics;
  const rows: [string, string][] = [
    ["Total Return", fmt(m.total_return_pct, 2, "%")],
    ["CAGR", fmt(m.cagr_pct, 2, "%")],
    ["Sharpe Ratio", fmt(m.sharpe_ratio)],
    ["Sortino Ratio", fmt(m.sortino_ratio)],
    ["Calmar Ratio", fmt(m.calmar_ratio)],
    ["Max Drawdown", fmt(m.max_drawdown_pct, 2, "%")],
    ["Win Rate", fmt(m.win_rate_pct, 1, "%")],
    ["Profit Factor", fmt(m.profit_factor)],
    ["Total Trades", String(m.total_trades)],
    ["Avg Trade P&L", fmt(m.avg_trade_pnl_pct, 2, "%")],
    ["Best Trade", fmt(m.best_trade_pct, 2, "%")],
    ["Worst Trade", fmt(m.worst_trade_pct, 2, "%")],
    ["Exposure", fmt(m.exposure_pct, 1, "%")],
    ["Final Equity", `$${m.final_equity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
  ];

  const tableRows = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("\n");

  const tradeRows = (result.trades ?? [])
    .slice(0, 100)
    .map(
      (t) =>
        `<tr>
          <td>${t.entry_time}</td>
          <td>${t.exit_time}</td>
          <td>${t.side}</td>
          <td>$${t.entry_price.toFixed(2)}</td>
          <td>$${t.exit_price.toFixed(2)}</td>
          <td style="color:${t.pnl_pct >= 0 ? "#4ade80" : "#f87171"}">${t.pnl_pct >= 0 ? "+" : ""}${t.pnl_pct.toFixed(2)}%</td>
        </tr>`,
    )
    .join("\n");

  const chartSvg = svgEquityCurve(result.equity_curve, result.benchmark?.equity_curve);

  const now = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Backtest Report — ${result.strategy} / ${result.symbol}</title>
<style>
  body { background: #09090b; color: #e4e4e7; font-family: ui-monospace,monospace; padding: 32px; margin: 0; }
  h1 { color: #06b6d4; font-size: 22px; margin-bottom: 4px; }
  h2 { color: #a1a1aa; font-size: 13px; font-weight: normal; margin: 0 0 24px; }
  h3 { color: #e4e4e7; font-size: 14px; margin: 24px 0 8px; border-bottom: 1px solid #27272a; padding-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-bottom: 16px; }
  td, th { padding: 6px 10px; border: 1px solid #27272a; }
  th { background: #18181b; color: #a1a1aa; }
  tr:nth-child(even) td { background: #18181b; }
  .meta { font-size: 11px; color: #71717a; margin-bottom: 16px; }
  .desc { font-size: 12px; color: #a1a1aa; background: #18181b; padding: 10px 14px; border-radius: 6px; border: 1px solid #27272a; margin-bottom: 16px; }
  @media print { body { background: white; color: black; } table { page-break-inside: avoid; } }
</style>
</head>
<body>
<h1>${result.strategy.toUpperCase()} — ${result.symbol}</h1>
<h2>${result.interval} · ${result.start_date} → ${result.end_date}</h2>
<div class="meta">Generated: ${now} · Initial capital: $${m.initial_capital.toLocaleString()}</div>

${strategy?.description ? `<div class="desc">${strategy.description}</div>` : ""}

<h3>Equity Curve</h3>
${chartSvg}

<h3>Performance Metrics</h3>
<table>
<thead><tr><th>Metric</th><th>Value</th></tr></thead>
<tbody>${tableRows}</tbody>
</table>

<h3>Trades (first 100)</h3>
<table>
<thead><tr><th>Entry</th><th>Exit</th><th>Side</th><th>Entry Price</th><th>Exit Price</th><th>P&L %</th></tr></thead>
<tbody>${tradeRows}</tbody>
</table>

<div class="meta" style="margin-top:24px">Bit Engine Backtester · bit-engine</div>
</body>
</html>`;
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface ReportExportProps {
  result: BacktestResult;
  strategy?: StrategyInfo;
}

export function ReportExport({ result, strategy }: ReportExportProps) {
  const [copied, setCopied] = useState(false);

  const slug = `${result.strategy}_${result.symbol}_${result.start_date}`;

  function exportHtml() {
    const html = buildHtmlReport(result, strategy);
    downloadBlob(html, `report_${slug}.html`, "text/html");
  }

  function exportJson() {
    downloadBlob(JSON.stringify(result, null, 2), `report_${slug}.json`, "application/json");
  }

  function exportCsv() {
    const header = "entry_time,exit_time,side,entry_price,exit_price,pnl,pnl_pct,duration_bars";
    const rows = (result.trades ?? [])
      .map((t) => [t.entry_time, t.exit_time, t.side, t.entry_price, t.exit_price, t.pnl, t.pnl_pct, t.duration_bars].join(","))
      .join("\n");
    downloadBlob(`${header}\n${rows}`, `trades_${slug}.csv`, "text/csv");
  }

  function printReport() {
    const html = buildHtmlReport(result, strategy);
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;width:0;height:0;border:0;top:0;left:0";
    document.body.appendChild(iframe);
    iframe.contentDocument!.open();
    iframe.contentDocument!.write(html);
    iframe.contentDocument!.close();
    iframe.contentWindow!.focus();
    setTimeout(() => {
      iframe.contentWindow!.print();
      setTimeout(() => document.body.removeChild(iframe), 1000);
    }, 300);
  }

  async function copyShareLink() {
    const url = `${window.location.origin}${window.location.pathname}?result=${result.id ?? ""}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const m = result.metrics;
  const summaryItems = [
    { label: "Return", value: `${m.total_return_pct >= 0 ? "+" : ""}${m.total_return_pct.toFixed(2)}%`, color: m.total_return_pct >= 0 ? "text-emerald-400" : "text-red-400" },
    { label: "Sharpe", value: m.sharpe_ratio.toFixed(2), color: m.sharpe_ratio >= 1 ? "text-cyan-400" : "text-zinc-300" },
    { label: "Max DD", value: `-${Math.abs(m.max_drawdown_pct).toFixed(2)}%`, color: "text-red-300" },
    { label: "Win Rate", value: `${m.win_rate_pct.toFixed(1)}%`, color: "text-zinc-300" },
    { label: "Trades", value: String(m.total_trades), color: "text-zinc-300" },
    { label: "Final", value: `$${m.final_equity.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, color: "text-zinc-200" },
  ];

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-zinc-200 mb-3">
          {result.strategy} · {result.symbol} · {result.interval}
        </h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {summaryItems.map((it) => (
            <div key={it.label} className="text-center">
              <div className={`text-lg font-bold font-mono ${it.color}`}>{it.value}</div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wide">{it.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Inline mini equity svg */}
      <div
        className="rounded-xl overflow-hidden border border-zinc-800"
        dangerouslySetInnerHTML={{ __html: svgEquityCurve(result.equity_curve, result.benchmark?.equity_curve) }}
      />

      {/* Export actions */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-zinc-300 mb-3">Export Report</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            onClick={exportHtml}
            className="px-3 py-2 bg-cyan-500 text-zinc-950 rounded-lg text-sm font-bold hover:bg-cyan-400 transition"
          >
            Download HTML
          </button>
          <button
            onClick={printReport}
            className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg text-sm font-medium transition"
          >
            Print / PDF
          </button>
          <button
            onClick={exportJson}
            className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg text-sm font-medium transition"
          >
            Export JSON
          </button>
          <button
            onClick={exportCsv}
            className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg text-sm font-medium transition"
          >
            Export CSV
          </button>
        </div>

        {result.id && (
          <div className="mt-3 flex gap-2 items-center">
            <button
              onClick={copyShareLink}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-lg text-xs font-medium transition flex items-center gap-1.5"
            >
              {copied ? "✓ Copied!" : "Copy Share Link"}
            </button>
            <span className="text-[11px] text-zinc-600">Share this exact backtest run by ID</span>
          </div>
        )}
      </div>

      {/* Trade table preview */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 overflow-x-auto">
        <h3 className="text-sm font-semibold text-zinc-300 mb-3">
          Trades Preview ({Math.min(20, result.trades?.length ?? 0)} / {result.trades?.length ?? 0})
        </h3>
        <table className="w-full text-xs font-mono border-separate border-spacing-y-0.5">
          <thead>
            <tr className="text-zinc-500 text-left">
              <th className="px-2 py-1">Entry</th>
              <th className="px-2 py-1">Exit</th>
              <th className="px-2 py-1">Side</th>
              <th className="px-2 py-1 text-right">Entry $</th>
              <th className="px-2 py-1 text-right">Exit $</th>
              <th className="px-2 py-1 text-right">P&L %</th>
            </tr>
          </thead>
          <tbody>
            {(result.trades ?? []).slice(0, 20).map((t, i) => (
              <tr key={i} className="bg-zinc-800/30 hover:bg-zinc-800/60 transition">
                <td className="px-2 py-1 text-zinc-400">{t.entry_time.slice(0, 10)}</td>
                <td className="px-2 py-1 text-zinc-400">{t.exit_time.slice(0, 10)}</td>
                <td className={`px-2 py-1 font-semibold ${t.side === "long" ? "text-emerald-400" : "text-red-400"}`}>
                  {t.side}
                </td>
                <td className="px-2 py-1 text-right text-zinc-300">{t.entry_price.toFixed(2)}</td>
                <td className="px-2 py-1 text-right text-zinc-300">{t.exit_price.toFixed(2)}</td>
                <td className={`px-2 py-1 text-right font-semibold ${t.pnl_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {t.pnl_pct >= 0 ? "+" : ""}{t.pnl_pct.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
