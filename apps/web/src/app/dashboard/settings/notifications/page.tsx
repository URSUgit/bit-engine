"use client";

import { useState } from "react";
import { Bell, Mail, MessageSquare, Smartphone, Check } from "lucide-react";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { cn } from "@/lib/utils";

const channels = [
  { id: "inApp",   label: "In-app",   icon: Bell,           description: "Toast and bell-icon notifications" },
  { id: "email",   label: "Email",    icon: Mail,           description: "Sent to you@bitprivat.io" },
  { id: "telegram",label: "Telegram", icon: MessageSquare,  description: "@BitPrivatBot" },
  { id: "push",    label: "Push",     icon: Smartphone,     description: "Mobile push (iOS/Android)" },
] as const;

const events = [
  { id: "signal_high",      label: "High-confidence signals (>85%)", default: { inApp: true,  email: false, telegram: true,  push: true  } },
  { id: "signal_medium",    label: "Medium-confidence signals",       default: { inApp: true,  email: false, telegram: false, push: false } },
  { id: "copy_filled",      label: "Copied trade filled",             default: { inApp: true,  email: true,  telegram: true,  push: true  } },
  { id: "copy_stopped",     label: "Copy stop-loss triggered",        default: { inApp: true,  email: true,  telegram: true,  push: true  } },
  { id: "trader_offline",   label: "Followed trader inactive 24h",    default: { inApp: true,  email: false, telegram: false, push: false } },
  { id: "price_alert",      label: "Watchlist price alerts",          default: { inApp: true,  email: false, telegram: true,  push: true  } },
  { id: "billing",          label: "Billing & invoices",              default: { inApp: true,  email: true,  telegram: false, push: false } },
];

type Prefs = Record<string, Record<string, boolean>>;

export default function NotificationsSettingsPage() {
  const [prefs, setPrefs] = useState<Prefs>(() =>
    Object.fromEntries(events.map((e) => [e.id, { ...e.default }]))
  );

  const toggle = (eventId: string, channel: string) =>
    setPrefs((p) => ({ ...p, [eventId]: { ...p[eventId], [channel]: !p[eventId]?.[channel] } }));

  return (
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

            {/* Event matrix */}
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
          </div>
        </div>
      </div>
  );
}
