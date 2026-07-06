"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Bell, Check, Mail, MessageSquare, Plus, Smartphone, Trash2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { cn } from "@/lib/utils";

// ─── Notification channel prefs ───────────────────────────────────────────────

const channels = [
  { id: "inApp",    label: "In-app",   icon: Bell,          description: "Toast and bell-icon notifications" },
  { id: "email",    label: "Email",    icon: Mail,          description: "Sent to you@bitprivat.io" },
  { id: "telegram", label: "Telegram", icon: MessageSquare, description: "@BitPrivatBot" },
  { id: "push",     label: "Push",     icon: Smartphone,    description: "Mobile push (iOS/Android)" },
] as const;

const events = [
  { id: "signal_high",    label: "High-confidence signals (>85%)", default: { inApp: true,  email: false, telegram: true,  push: true  } },
  { id: "signal_medium",  label: "Medium-confidence signals",       default: { inApp: true,  email: false, telegram: false, push: false } },
  { id: "copy_filled",    label: "Copied trade filled",             default: { inApp: true,  email: true,  telegram: true,  push: true  } },
  { id: "copy_stopped",   label: "Copy stop-loss triggered",        default: { inApp: true,  email: true,  telegram: true,  push: true  } },
  { id: "trader_offline", label: "Followed trader inactive 24h",    default: { inApp: true,  email: false, telegram: false, push: false } },
  { id: "price_alert",    label: "Watchlist price alerts",          default: { inApp: true,  email: false, telegram: true,  push: true  } },
  { id: "billing",        label: "Billing & invoices",              default: { inApp: true,  email: true,  telegram: false, push: false } },
];

type Prefs = Record<string, Record<string, boolean>>;

// ─── Price alert types ────────────────────────────────────────────────────────

interface PriceAlert {
  id: string;
  symbol: string;
  condition: "above" | "below";
  price: number;
  active: boolean;
  triggeredAt: string | null;
  createdAt: string;
}

// ─── Alert API helpers ────────────────────────────────────────────────────────

async function fetchAllAlerts(): Promise<PriceAlert[]> {
  try {
    const r = await fetch("/api/alerts");
    if (!r.ok) return [];
    const { alerts } = await r.json();
    return alerts ?? [];
  } catch { return []; }
}

async function apiCreateAlert(
  symbol: string,
  condition: "above" | "below",
  price: number,
): Promise<PriceAlert | null> {
  const r = await fetch("/api/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, condition, price }),
  });
  if (!r.ok) return null;
  const { alert } = await r.json();
  return alert ?? null;
}

async function apiDeleteAlert(id: string): Promise<void> {
  await fetch(`/api/alerts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotificationsSettingsPage() {
  const { data: session } = useSession();
  const isAuthed = !!session?.user;

  const [prefs, setPrefs] = useState<Prefs>(() =>
    Object.fromEntries(events.map((e) => [e.id, { ...e.default }]))
  );

  const toggle = (eventId: string, channel: string) =>
    setPrefs((p) => ({ ...p, [eventId]: { ...p[eventId], [channel]: !p[eventId]?.[channel] } }));

  // Price alerts state
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);

  // New alert form state
  const [newSymbol, setNewSymbol] = useState("");
  const [newCondition, setNewCondition] = useState<"above" | "below">("above");
  const [newPriceStr, setNewPriceStr] = useState("");
  const [formError, setFormError] = useState("");
  const [formLoading, setFormLoading] = useState(false);

  useEffect(() => {
    if (!isAuthed) return;
    setAlertsLoading(true);
    fetchAllAlerts().then(setAlerts).finally(() => setAlertsLoading(false));
  }, [isAuthed]);

  async function handleAddAlert() {
    const sym = newSymbol.trim().toUpperCase();
    const price = parseFloat(newPriceStr);
    if (!sym) { setFormError("Enter a symbol"); return; }
    if (!newPriceStr || isNaN(price) || price <= 0) { setFormError("Enter a valid price"); return; }
    setFormError("");
    setFormLoading(true);
    try {
      const alert = await apiCreateAlert(sym, newCondition, price);
      if (!alert) { setFormError("Failed to create alert"); return; }
      setAlerts((prev) => [alert, ...prev]);
      setNewSymbol("");
      setNewPriceStr("");
    } catch {
      setFormError("Something went wrong");
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDeleteAlert(id: string) {
    await apiDeleteAlert(id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

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
            {/* Channels */}
            <div className="card-dark p-6">
              <h2 className="text-base font-bold text-slate-100 mb-1">Channels</h2>
              <p className="text-xs text-slate-500 mb-5">Where do you want to receive notifications?</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {channels.map((c) => {
                  const Icon = c.icon;
                  return (
                    <div key={c.id} className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
                      <Icon className="w-4 h-4 text-cyan-400 mb-2" />
                      <p className="text-sm font-semibold text-slate-100">{c.label}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{c.description}</p>
                      <button className="mt-3 text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Connected
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Event routing matrix */}
            <div className="card-dark p-6">
              <h2 className="text-base font-bold text-slate-100 mb-1">Event Routing</h2>
              <p className="text-xs text-slate-500 mb-5">Pick which channel each event uses.</p>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      <th className="text-left py-3">Event</th>
                      {channels.map((c) => (
                        <th key={c.id} className="text-center py-3 w-20">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {events.map((e) => (
                      <tr key={e.id}>
                        <td className="py-3.5 text-sm text-slate-200">{e.label}</td>
                        {channels.map((c) => {
                          const checked = prefs[e.id]?.[c.id] ?? false;
                          return (
                            <td key={c.id} className="text-center py-3.5">
                              <button
                                onClick={() => toggle(e.id, c.id)}
                                className={cn(
                                  "relative w-9 h-5 rounded-full transition-colors mx-auto block",
                                  checked ? "bg-cyan-500" : "bg-slate-700"
                                )}
                              >
                                <span
                                  className={cn(
                                    "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all",
                                    checked ? "left-[18px]" : "left-0.5"
                                  )}
                                />
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Price Alerts section */}
            <div className="card-dark p-6">
              <h2 className="text-base font-bold text-slate-100 mb-1 flex items-center gap-2">
                <Bell className="w-4 h-4 text-cyan-400" /> Price Alerts
              </h2>
              <p className="text-xs text-slate-500 mb-5">Manage all your price alerts in one place.</p>

              {!isAuthed ? (
                <p className="text-sm text-slate-400">Sign in to manage alerts</p>
              ) : (
                <>
                  {/* New alert inline form */}
                  <div className="flex flex-wrap gap-2 mb-5">
                    <input
                      type="text"
                      value={newSymbol}
                      onChange={(e) => { setNewSymbol(e.target.value.toUpperCase()); setFormError(""); }}
                      placeholder="Symbol (e.g. BTC)"
                      maxLength={12}
                      className="w-32 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500 uppercase"
                    />
                    <select
                      value={newCondition}
                      onChange={(e) => setNewCondition(e.target.value as "above" | "below")}
                      className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500"
                    >
                      <option value="above">Above</option>
                      <option value="below">Below</option>
                    </select>
                    <input
                      type="number"
                      value={newPriceStr}
                      onChange={(e) => { setNewPriceStr(e.target.value); setFormError(""); }}
                      placeholder="Price (USD)"
                      min="0"
                      step="any"
                      className="w-36 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500"
                    />
                    <button
                      disabled={formLoading}
                      onClick={handleAddAlert}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 font-semibold text-sm hover:bg-cyan-400 disabled:opacity-50 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {formLoading ? "..." : "Add"}
                    </button>
                    {formError && <p className="w-full text-red-400 text-xs mt-1">{formError}</p>}
                  </div>

                  {/* Alerts table */}
                  {alertsLoading ? (
                    <p className="text-sm text-slate-500">Loading alerts…</p>
                  ) : alerts.length === 0 ? (
                    <p className="text-sm text-slate-500">No alerts yet. Use the form above to add one.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[520px]">
                        <thead>
                          <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            <th className="py-3 text-left">Symbol</th>
                            <th className="py-3 text-left">Condition</th>
                            <th className="py-3 text-right">Price</th>
                            <th className="py-3 text-center">Status</th>
                            <th className="py-3 text-left">Created</th>
                            <th className="py-3 text-right"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {alerts.map((a) => (
                            <tr key={a.id} className="hover:bg-slate-900/40 transition-colors">
                              <td className="py-3.5">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700/50 flex items-center justify-center text-[9px] font-bold text-slate-200">
                                    {a.symbol.slice(0, 3)}
                                  </div>
                                  <span className="font-semibold text-slate-100">{a.symbol}</span>
                                </div>
                              </td>
                              <td className="py-3.5">
                                <span className={cn(
                                  "text-xs font-semibold px-2 py-0.5 rounded-full",
                                  a.condition === "above"
                                    ? "bg-emerald-500/10 text-emerald-400"
                                    : "bg-red-500/10 text-red-400"
                                )}>
                                  {a.condition === "above" ? "↑ Above" : "↓ Below"}
                                </span>
                              </td>
                              <td className="py-3.5 text-right text-slate-100 number-font font-semibold">
                                ${Number(a.price).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                              </td>
                              <td className="py-3.5 text-center">
                                <span className={cn(
                                  "text-[10px] font-bold px-2 py-0.5 rounded-full",
                                  a.active
                                    ? "bg-cyan-500/10 text-cyan-400"
                                    : "bg-slate-700/50 text-slate-500"
                                )}>
                                  {a.active ? "Active" : "Triggered"}
                                </span>
                              </td>
                              <td className="py-3.5 text-slate-500 text-xs">
                                {new Date(a.createdAt).toLocaleDateString()}
                              </td>
                              <td className="py-3.5 text-right">
                                <button
                                  onClick={() => handleDeleteAlert(a.id)}
                                  title="Delete alert"
                                  className="text-slate-500 hover:text-red-400 transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
