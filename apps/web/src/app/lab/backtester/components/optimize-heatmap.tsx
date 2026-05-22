"use client";

import type { OptimizeResult } from "@/lib/backtest-api";

export function OptimizeHeatmap({ result }: { result: OptimizeResult }) {
  const { cells, param_names, metric, best_params, best_metric_value } = result;

  const values = cells.map((c) => c.metric_value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h3 className="font-semibold">
            Optimization · {result.symbol} · {result.strategy}
          </h3>
          <span className="text-xs text-zinc-500">
            {result.combinations_run} combos · maximised {metric} · {result.runtime_ms}ms
          </span>
        </div>
        <div className="bg-emerald-950/30 border border-emerald-900/50 rounded p-3 text-sm">
          <div className="text-xs text-emerald-300/80 uppercase tracking-wide mb-1">Best params found</div>
          <div className="flex flex-wrap gap-3">
            {Object.entries(best_params).map(([k, v]) => (
              <span key={k} className="text-emerald-300">
                <span className="text-emerald-500/70">{k}</span> = <span className="font-semibold">{v}</span>
              </span>
            ))}
          </div>
          <div className="mt-2 text-xs text-zinc-400">
            {metric}: <span className="text-emerald-300 font-semibold">{best_metric_value.toFixed(4)}</span>
            {" · "}
            total return: <span className="text-emerald-300 font-semibold">{result.best_total_return_pct >= 0 ? "+" : ""}{result.best_total_return_pct.toFixed(2)}%</span>
          </div>
        </div>
      </div>

      {/* 1-param: bar chart  /  2-param: heatmap grid  /  >2: scatter list */}
      {param_names.length === 1 ? (
        <OneDimensionalChart result={result} minV={minV} maxV={maxV} />
      ) : param_names.length === 2 ? (
        <TwoDimensionalHeatmap result={result} minV={minV} maxV={maxV} />
      ) : (
        <MultiParamList result={result} minV={minV} maxV={maxV} />
      )}
    </div>
  );
}

function colorForValue(v: number, minV: number, maxV: number): string {
  if (maxV === minV) return "rgba(6, 182, 212, 0.4)";
  const t = (v - minV) / (maxV - minV);  // 0..1
  if (t < 0.5) {
    // red -> zinc
    const a = t * 2;
    const r = Math.round(239 - (239 - 39) * a);
    const g = Math.round(68 - (68 - 39) * a);
    const b = Math.round(68 - (68 - 42) * a);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // zinc -> emerald
    const a = (t - 0.5) * 2;
    const r = Math.round(39 + (16 - 39) * a);
    const g = Math.round(39 + (185 - 39) * a);
    const b = Math.round(42 + (129 - 42) * a);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

function OneDimensionalChart({ result, minV, maxV }: { result: OptimizeResult; minV: number; maxV: number }) {
  const sorted = [...result.cells].sort((a, b) => a.params[result.param_names[0]] - b.params[result.param_names[0]]);
  const range = maxV - minV || 1;
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h4 className="text-sm font-medium mb-3 text-zinc-300">{result.param_names[0]} sensitivity</h4>
      <div className="flex items-end gap-0.5 h-48">
        {sorted.map((c) => {
          const h = ((c.metric_value - minV) / range) * 100;
          return (
            <div
              key={String(c.params[result.param_names[0]])}
              className="flex-1 flex flex-col items-center justify-end"
              title={`${result.param_names[0]}=${c.params[result.param_names[0]]} · ${result.metric}=${c.metric_value.toFixed(3)}`}
            >
              <div
                style={{ height: `${Math.max(h, 2)}%`, backgroundColor: colorForValue(c.metric_value, minV, maxV) }}
                className="w-full rounded-t"
              />
              <span className="text-[10px] text-zinc-500 mt-1">{c.params[result.param_names[0]]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TwoDimensionalHeatmap({ result, minV, maxV }: { result: OptimizeResult; minV: number; maxV: number }) {
  const [px, py] = result.param_names;
  const xs = Array.from(new Set(result.cells.map((c) => c.params[px]))).sort((a, b) => a - b);
  const ys = Array.from(new Set(result.cells.map((c) => c.params[py]))).sort((a, b) => a - b);

  const cellByXY: Record<string, typeof result.cells[number]> = {};
  for (const c of result.cells) cellByXY[`${c.params[px]}|${c.params[py]}`] = c;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h4 className="text-sm font-medium mb-3 text-zinc-300">
        {py} (rows) vs {px} (cols) — {result.metric}
      </h4>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              <th className="p-1"></th>
              {xs.map((x) => (
                <th key={x} className="p-1 text-zinc-500 font-normal text-center">{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...ys].reverse().map((y) => (
              <tr key={y}>
                <td className="p-1 text-zinc-500 text-right pr-2">{y}</td>
                {xs.map((x) => {
                  const c = cellByXY[`${x}|${y}`];
                  if (!c) return <td key={x} className="p-1" />;
                  return (
                    <td
                      key={x}
                      className="p-0"
                      title={`${px}=${x}, ${py}=${y} · ${result.metric}=${c.metric_value.toFixed(3)} · return=${c.total_return_pct.toFixed(1)}%`}
                    >
                      <div
                        style={{ backgroundColor: colorForValue(c.metric_value, minV, maxV) }}
                        className="w-10 h-10 flex items-center justify-center text-[10px] font-medium text-white"
                      >
                        {c.metric_value.toFixed(1)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
        <span>min {minV.toFixed(2)}</span>
        <div className="flex-1 h-2 rounded" style={{
          background: "linear-gradient(to right, #ef4444, #27272a, #10b981)",
        }} />
        <span>max {maxV.toFixed(2)}</span>
      </div>
    </div>
  );
}

function MultiParamList({ result, minV, maxV }: { result: OptimizeResult; minV: number; maxV: number }) {
  const sorted = [...result.cells].sort((a, b) => b.metric_value - a.metric_value);
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h4 className="text-sm font-medium mb-3 text-zinc-300">Top combinations</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-zinc-500 border-b border-zinc-800">
              <th className="py-1.5 pr-2">#</th>
              {result.param_names.map((n) => <th key={n} className="py-1.5 pr-2">{n}</th>)}
              <th className="py-1.5 pr-2 text-right">{result.metric}</th>
              <th className="py-1.5 pr-2 text-right">Return</th>
              <th className="py-1.5 pr-2 text-right">Sharpe</th>
              <th className="py-1.5 text-right">Trades</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 30).map((c, i) => (
              <tr key={i} className="border-b border-zinc-800/40">
                <td className="py-1 pr-2 text-zinc-500">{i + 1}</td>
                {result.param_names.map((n) => (
                  <td key={n} className="py-1 pr-2 text-zinc-300">{c.params[n]}</td>
                ))}
                <td className="py-1 pr-2 text-right font-medium" style={{ color: colorForValue(c.metric_value, minV, maxV) }}>
                  {c.metric_value.toFixed(3)}
                </td>
                <td className={`py-1 pr-2 text-right ${c.total_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {c.total_return_pct >= 0 ? "+" : ""}{c.total_return_pct.toFixed(1)}%
                </td>
                <td className="py-1 pr-2 text-right text-zinc-300">{c.sharpe_ratio.toFixed(2)}</td>
                <td className="py-1 text-right text-zinc-500">{c.total_trades}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
