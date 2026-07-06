"use client";

import { useState } from "react";
import { Plus, FileCode2, GitBranch, Play, ChevronDown, X, ArrowLeft, Trash2, Code2, AlignLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type CellType = "code" | "markdown";
type Language = "python" | "typescript";

interface Cell {
  id: string;
  type: CellType;
  source: string;
  output?: string;
}

interface Notebook {
  id: string;
  name: string;
  description: string;
  language: Language;
  lastEdited: string;
  shared: boolean;
  cells: Cell[];
}

const INITIAL_NOTEBOOKS: Notebook[] = [
  {
    id: "n1", name: "Funding rate study", description: "Cross-exchange funding-rate basis analysis on majors",
    language: "python", lastEdited: "12m ago", shared: false,
    cells: [
      { id: "c1", type: "markdown", source: "## Funding Rate Basis Analysis\n\nThis notebook computes the **funding rate differential** between Binance and Bybit for BTC and ETH perpetuals. A divergence >0.02% signals potential arbitrage." },
      { id: "c2", type: "code", source: "import requests\nimport pandas as pd\n\n# Fetch funding rates from the platform API\nrates = requests.get('/api/v1/backtest/data/funding?symbol=BTCUSDT&days=30').json()\ndf = pd.DataFrame(rates['data'])\ndf['ts'] = pd.to_datetime(df['ts'], unit='ms')\ndf.set_index('ts', inplace=True)\nprint(df.tail(5))", output: "                     rate\nts\n2026-05-30 08:00:00  0.0001\n2026-05-30 16:00:00  0.0002\n2026-05-31 00:00:00  0.0001\n2026-05-31 08:00:00 -0.0001\n2026-05-31 16:00:00  0.0003" },
      { id: "c3", type: "code", source: "import matplotlib.pyplot as plt\n\nfig, ax = plt.subplots(figsize=(12, 4))\nax.bar(df.index, df['rate'] * 100, color=['red' if r > 0 else 'blue' for r in df['rate']])\nax.axhline(0, color='white', linewidth=0.5)\nax.set_ylabel('Funding Rate (%)')\nax.set_title('BTC Perpetual Funding Rate — 30 Days')\nplt.tight_layout()\nplt.show()", output: "[chart rendered below]" },
      { id: "c4", type: "markdown", source: "### Observations\n- Average rate: **+0.012%** (long-biased market)\n- Extreme readings (>0.05%) occurred on 3 occasions\n- Funding spikes above 0.08% historically precede corrections within 48h" },
    ],
  },
  {
    id: "n2", name: "Whale flow correlation", description: "On-chain whale wallet movements vs price action",
    language: "python", lastEdited: "2h ago", shared: true,
    cells: [
      { id: "c1", type: "markdown", source: "## Whale Flow vs Price Action\n\nAnalyzing whether large on-chain transfers (>100 BTC) predict price moves within 4–24 hours." },
      { id: "c2", type: "code", source: "from app.feeds import price_cache\nimport numpy as np\n\n# Simulated whale transfer data (replace with Glassnode)\nwhale_transfers = [\n    {'ts': '2026-05-01', 'amount_btc': 450, 'direction': 'exchange_inflow'},\n    {'ts': '2026-05-03', 'amount_btc': 220, 'direction': 'exchange_outflow'},\n    {'ts': '2026-05-07', 'amount_btc': 810, 'direction': 'exchange_inflow'},\n]\n\nprint(f'Total events: {len(whale_transfers)}')\nprint(f'Avg size: {np.mean([w[\"amount_btc\"] for w in whale_transfers]):.0f} BTC')", output: "Total events: 3\nAvg size: 493 BTC" },
      { id: "c3", type: "code", source: "# Correlation: inflow → price drop within 24h?\nprice_after = {'exchange_inflow': -2.3, 'exchange_outflow': +1.8}  # pct, historical avg\nfor direction, avg_return in price_after.items():\n    print(f'{direction}: avg 24h return = {avg_return:+.1f}%')", output: "exchange_inflow: avg 24h return = -2.3%\nexchange_outflow: avg 24h return = +1.8%" },
    ],
  },
  {
    id: "n3", name: "FinBERT validation", description: "Backtest of FinBERT-driven entries on 6 months",
    language: "python", lastEdited: "1d ago", shared: false,
    cells: [
      { id: "c1", type: "markdown", source: "## FinBERT Signal Validation\n\nThis backtest runs **6 months** of crypto news through FinBERT sentiment classification and checks whether high-confidence signals (>0.8) provide positive expected value." },
      { id: "c2", type: "code", source: "# Using the platform backtester API\nimport requests\n\nresult = requests.post('/api/v1/backtest/signals/validate', json={\n    'symbol': 'BTC-USD',\n    'strategy': 'anomaly_fade',\n    'lookback_days': 180,\n}).json()\n\nprint(f\"Win rate: {result['win_rate']*100:.1f}%\")\nprint(f\"Avg gain: {result['avg_gain_pct']:+.2f}%\")\nprint(f\"Expected value: {result['expected_value_pct']:+.2f}%\")", output: "Win rate: 58.3%\nAvg gain: +1.87%\nExpected value: +0.43%" },
    ],
  },
  {
    id: "n4", name: "Hyperliquid order book", description: "TS prototype: depth imbalance signal generator",
    language: "typescript", lastEdited: "3d ago", shared: false,
    cells: [
      { id: "c1", type: "markdown", source: "## Order Book Imbalance Signal\n\nComputes bid/ask depth ratio at multiple levels to generate a real-time imbalance score." },
      { id: "c2", type: "code", source: "const ob = await fetch('/api/exchange/orderbook?symbol=BTC&limit=20').then(r => r.json());\n\nfunction imbalance(bids: number[][], asks: number[][]): number {\n  const bidVol = bids.slice(0, 5).reduce((s, [, q]) => s + q, 0);\n  const askVol = asks.slice(0, 5).reduce((s, [, q]) => s + q, 0);\n  return (bidVol - askVol) / (bidVol + askVol);\n}\n\nconst score = imbalance(ob.bids, ob.asks);\nconsole.log(`Imbalance score: ${(score * 100).toFixed(1)}% (${score > 0 ? 'bid-heavy' : 'ask-heavy'})`);\nconsole.log(`Bids top: $${ob.bids[0][0].toLocaleString()}`);\nconsole.log(`Asks top: $${ob.asks[0][0].toLocaleString()}`);", output: "Imbalance score: +12.4% (bid-heavy)\nBids top: $96,843.20\nAsks top: $96,891.50" },
    ],
  },
];

function uid() { return Math.random().toString(36).slice(2, 9); }

export default function NotebooksPage() {
  const [notebooks, setNotebooks] = useState<Notebook[]>(INITIAL_NOTEBOOKS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const openNotebook = notebooks.find((n) => n.id === openId);

  function createNotebook() {
    const nb: Notebook = {
      id: uid(),
      name: "Untitled notebook",
      description: "New research notebook",
      language: "python",
      lastEdited: "just now",
      shared: false,
      cells: [
        { id: uid(), type: "markdown", source: "## Untitled\n\nStart writing here…" },
        { id: uid(), type: "code", source: "# Your code here\nprint('hello, world')" },
      ],
    };
    setNotebooks((prev) => [nb, ...prev]);
    setOpenId(nb.id);
  }

  function addCell(type: CellType) {
    if (!openId) return;
    setNotebooks((prev) =>
      prev.map((n) =>
        n.id !== openId ? n : {
          ...n,
          cells: [...n.cells, { id: uid(), type, source: type === "code" ? "# New cell" : "New markdown cell" }],
        }
      )
    );
  }

  function deleteCell(cellId: string) {
    if (!openId) return;
    setNotebooks((prev) =>
      prev.map((n) =>
        n.id !== openId ? n : { ...n, cells: n.cells.filter((c) => c.id !== cellId) }
      )
    );
    if (editingCellId === cellId) setEditingCellId(null);
  }

  function updateCell(cellId: string, source: string) {
    if (!openId) return;
    setNotebooks((prev) =>
      prev.map((n) =>
        n.id !== openId ? n : { ...n, cells: n.cells.map((c) => c.id === cellId ? { ...c, source } : c) }
      )
    );
  }

  function simulateRun(cellId: string) {
    setRunningId(cellId);
    setTimeout(() => setRunningId(null), 800 + Math.random() * 800);
  }

  if (openNotebook) {
    return (
      <div className="flex flex-col gap-0 max-w-[900px] mx-auto p-6">
        {/* Notebook header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setOpenId(null)}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Notebooks
          </button>
          <span className="text-slate-700">/</span>
          <span className="text-sm font-semibold text-slate-100">{openNotebook.name}</span>
          <span className={cn("ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded",
            openNotebook.language === "python" ? "bg-yellow-500/15 text-yellow-400" : "bg-blue-500/15 text-blue-400"
          )}>{openNotebook.language}</span>
        </div>

        {/* Cells */}
        <div className="flex flex-col gap-3">
          {openNotebook.cells.map((cell, idx) => (
            <div key={cell.id}
              className={cn("group border rounded-xl overflow-hidden",
                cell.type === "code"
                  ? "border-slate-700 bg-slate-900/80"
                  : "border-slate-800/50 bg-slate-800/20"
              )}>
              {/* Cell toolbar */}
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-800 bg-slate-900/40">
                <span className="text-[10px] text-slate-600 font-mono w-4">[{idx + 1}]</span>
                <span className={cn("text-[10px] font-bold uppercase",
                  cell.type === "code" ? "text-slate-500" : "text-violet-400"
                )}>
                  {cell.type === "code" ? openNotebook.language : "markdown"}
                </span>
                <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {cell.type === "code" && (
                    <button onClick={() => simulateRun(cell.id)}
                      className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors">
                      {runningId === cell.id ? (
                        <span className="w-3 h-3 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Play className="w-3 h-3" />
                      )}
                      Run
                    </button>
                  )}
                  <button onClick={() => setEditingCellId(editingCellId === cell.id ? null : cell.id)}
                    className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors">
                    {editingCellId === cell.id ? "Done" : "Edit"}
                  </button>
                  <button onClick={() => deleteCell(cell.id)}
                    className="text-red-500/60 hover:text-red-400 transition-colors p-0.5">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Cell body */}
              {editingCellId === cell.id ? (
                <textarea
                  value={cell.source}
                  onChange={(e) => updateCell(cell.id, e.target.value)}
                  className="w-full bg-transparent px-4 py-3 text-sm font-mono text-slate-300 outline-none resize-none min-h-[80px]"
                  rows={cell.source.split("\n").length + 1}
                />
              ) : (
                <pre className={cn("px-4 py-3 text-sm leading-relaxed overflow-x-auto",
                  cell.type === "code" ? "font-mono text-slate-300" : "text-slate-300 whitespace-pre-wrap font-sans"
                )}>
                  {cell.source}
                </pre>
              )}

              {/* Output */}
              {cell.type === "code" && cell.output && (
                <div className="border-t border-slate-800 px-4 py-2 bg-slate-950/50">
                  <pre className="text-xs font-mono text-emerald-400/80 whitespace-pre-wrap">{cell.output}</pre>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add cell buttons */}
        <div className="flex items-center gap-2 mt-4 justify-center">
          <button onClick={() => addCell("code")}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors border border-slate-700">
            <Code2 className="w-3.5 h-3.5" />
            + Code cell
          </button>
          <button onClick={() => addCell("markdown")}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors border border-slate-700">
            <AlignLeft className="w-3.5 h-3.5" />
            + Text cell
          </button>
        </div>

        {/* Kernel notice */}
        <div className="mt-6 text-center text-xs text-slate-600">
          Python kernel execution requires running the signal service locally · code editing is fully available
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Research Notebooks</h1>
          <p className="text-sm text-slate-400 mt-1">Jupyter-style notebooks with platform data pre-loaded</p>
        </div>
        <button onClick={createNotebook}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors">
          <Plus className="w-4 h-4" /> New Notebook
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {notebooks.map((n) => (
          <button key={n.id} onClick={() => setOpenId(n.id)}
            className="card-dark glow-card p-5 flex flex-col gap-3 cursor-pointer text-left hover:border-cyan-500/30 transition-all group">
            <div className="flex items-start justify-between">
              <div className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center border shrink-0",
                n.language === "python" ? "bg-yellow-500/10 border-yellow-500/20" : "bg-blue-500/10 border-blue-500/20"
              )}>
                <FileCode2 className={cn("w-4 h-4", n.language === "python" ? "text-yellow-400" : "text-blue-400")} />
              </div>
              {n.shared && (
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 flex items-center gap-1">
                  <GitBranch className="w-2.5 h-2.5" /> Shared
                </span>
              )}
            </div>
            <div>
              <p className="text-base font-bold text-slate-100 group-hover:text-cyan-200 transition-colors">{n.name}</p>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-2">{n.description}</p>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-3 border-t border-slate-800/60 mt-auto">
              <span className="capitalize">{n.language} · {n.cells.length} cells</span>
              <span>{n.lastEdited}</span>
            </div>
          </button>
        ))}

        <button onClick={createNotebook}
          className="card-dark border-dashed flex flex-col items-center justify-center p-12 hover:border-cyan-500/30 transition-colors group min-h-[200px]">
          <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-3 group-hover:bg-cyan-500/20 transition-colors">
            <Plus className="w-5 h-5 text-cyan-400" />
          </div>
          <p className="text-sm font-semibold text-slate-300">New Notebook</p>
        </button>
      </div>
    </div>
  );
}
