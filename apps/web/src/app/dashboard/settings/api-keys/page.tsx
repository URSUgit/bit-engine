"use client";

import { useState } from "react";
import { Plus, Copy, Check, Eye, EyeOff, Trash2, KeyRound } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { cn } from "@/lib/utils";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsed: string;
  status: "active" | "revoked";
}

const initialKeys: ApiKey[] = [
  { id: "k1", name: "Trading Bot Alpha", prefix: "bp_live_4f3a", scopes: ["read", "trade"], createdAt: "2026-02-12", lastUsed: "2m ago",  status: "active" },
  { id: "k2", name: "Backtest Notebook", prefix: "bp_live_9e1c", scopes: ["read"],          createdAt: "2026-01-08", lastUsed: "3h ago",  status: "active" },
  { id: "k3", name: "Old API Client",    prefix: "bp_live_2b7f", scopes: ["read"],          createdAt: "2025-11-20", lastUsed: "47d ago", status: "revoked" },
];

export default function ApiKeysPage() {
  const [keys, setKeys] = useState(initialKeys);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const toggleReveal = (id: string) => setRevealed((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const handleCopy = (id: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const revoke = (id: string) =>
    setKeys((k) => k.map((x) => (x.id === id ? { ...x, status: "revoked" as const } : x)));

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6 max-w-[1200px] mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Settings</h1>
          <p className="text-sm text-slate-400 mt-1">Manage your profile, security, and integrations</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
          <SettingsNav />

          <div className="flex flex-col gap-5">
            <div className="card-dark p-6">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h2 className="text-base font-bold text-slate-100 mb-1">API Keys</h2>
                  <p className="text-xs text-slate-500">Programmatic access for bots, dashboards, and notebooks.</p>
                </div>
                <button onClick={() => setCreating(true)} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> New Key
                </button>
              </div>

              {creating && (
                <div className="mb-5 p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/30">
                  <div className="flex items-start gap-3">
                    <KeyRound className="w-4 h-4 text-cyan-400 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-cyan-300">Create new API key</p>
                      <p className="text-xs text-slate-400 mt-1">Give it a descriptive name and pick scopes. The full secret will only be shown once.</p>
                      <div className="flex gap-2 mt-3">
                        <input
                          autoFocus
                          placeholder="e.g. Backtest Notebook"
                          className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 focus:border-cyan-500 outline-none"
                        />
                        <button onClick={() => setCreating(false)} className="px-4 py-1.5 rounded-md bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400">Generate</button>
                        <button onClick={() => setCreating(false)} className="px-3 py-1.5 rounded-md bg-slate-800 text-slate-400 text-sm hover:bg-slate-700">Cancel</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="divide-y divide-slate-800/60">
                {keys.map((k) => {
                  const isRevealed = revealed.has(k.id);
                  const fullKey = `${k.prefix}_${"*".repeat(24)}`;
                  return (
                    <div key={k.id} className="flex items-center gap-4 py-4 first:pt-0">
                      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center border shrink-0",
                        k.status === "active" ? "bg-cyan-500/10 border-cyan-500/30" : "bg-slate-800 border-slate-700")}>
                        <KeyRound className={cn("w-4 h-4", k.status === "active" ? "text-cyan-400" : "text-slate-500")} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={cn("text-sm font-semibold", k.status === "active" ? "text-slate-100" : "text-slate-500 line-through")}>
                            {k.name}
                          </p>
                          {k.status === "revoked" && (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">Revoked</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-slate-500">
                          <span>{isRevealed ? fullKey : `${k.prefix}_${"•".repeat(8)}`}</span>
                          <button onClick={() => toggleReveal(k.id)} className="text-slate-600 hover:text-slate-400" disabled={k.status === "revoked"}>
                            {isRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </button>
                          <button onClick={() => handleCopy(k.id, fullKey)} className="text-slate-600 hover:text-slate-400" disabled={k.status === "revoked"}>
                            {copied === k.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-500">
                          <span>Scopes:</span>
                          {k.scopes.map((s) => (
                            <span key={s} className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{s}</span>
                          ))}
                          <span className="text-slate-700">·</span>
                          <span>Created {k.createdAt}</span>
                          <span className="text-slate-700">·</span>
                          <span>Last used {k.lastUsed}</span>
                        </div>
                      </div>

                      {k.status === "active" && (
                        <button onClick={() => revoke(k.id)} className="text-slate-500 hover:text-red-400 transition-colors p-2" title="Revoke">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
