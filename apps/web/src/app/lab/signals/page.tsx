"use client";

import { useState } from "react";
import { Plus, Trash2, Save, Play } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { cn } from "@/lib/utils";

type Op = ">" | "<" | ">=" | "<=" | "==" | "crosses_above" | "crosses_below";

interface Condition {
  id: string;
  indicator: string;
  op: Op;
  value: string;
}

const indicators = [
  "EMA(20)", "EMA(50)", "EMA(200)", "RSI(14)", "MACD", "ADX(14)",
  "BB_upper", "BB_lower", "ATR(14)", "VWAP", "OBV",
  "FundingRate", "WhaleFlow_24h", "FinBERT_score", "Volume_ratio",
];
const ops: Op[] = [">", "<", ">=", "<=", "==", "crosses_above", "crosses_below"];

export default function SignalBuilderPage() {
  const [name, setName] = useState("My Signal");
  const [conditions, setConditions] = useState<Condition[]>([
    { id: "c1", indicator: "EMA(20)",       op: "crosses_above", value: "EMA(50)" },
    { id: "c2", indicator: "ADX(14)",       op: ">",             value: "25" },
    { id: "c3", indicator: "Volume_ratio",  op: ">",             value: "1.5" },
  ]);

  const addCondition = () =>
    setConditions((c) => [...c, { id: `c${Date.now()}`, indicator: indicators[0]!, op: ">", value: "0" }]);

  const updateCondition = (id: string, patch: Partial<Condition>) =>
    setConditions((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const removeCondition = (id: string) =>
    setConditions((cs) => cs.filter((c) => c.id !== id));

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6 max-w-[1200px] mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Signal Builder</h1>
          <p className="text-sm text-slate-400 mt-1">Compose entry conditions from indicators and on-chain feeds</p>
        </div>

        <div className="card-dark p-5">
          <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-lg font-bold bg-transparent text-slate-50 outline-none border-b border-transparent focus:border-cyan-500 transition-colors"
            />
            <div className="flex gap-2">
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-sm font-medium hover:bg-slate-700 transition-colors">
                <Save className="w-3.5 h-3.5" /> Save
              </button>
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors">
                <Play className="w-3.5 h-3.5" /> Test on history
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
                  {ops.map((o) => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
                </select>

                <input
                  value={c.value}
                  onChange={(e) => updateCondition(c.id, { value: e.target.value })}
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

        <div className="card-dark p-5">
          <h2 className="text-sm font-semibold text-slate-100 mb-3">Compiled Pinescript-style preview</h2>
          <pre className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">
{`signal "${name}":
  buy when:
${conditions.map((c, i) => `    ${i === 0 ? "" : "and "}${c.indicator} ${c.op.replace("_", " ")} ${c.value}`).join("\n")}`}
          </pre>
        </div>
      </div>
    </DashboardLayout>
  );
}
