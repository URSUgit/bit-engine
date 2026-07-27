"use client";

import { Check, Download, Sparkles } from "lucide-react";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { cn } from "@/lib/utils";

const plans = [
  {
    id: "starter",
    name: "Starter",
    price: 0,
    description: "Watch the leaderboard. No copy trading.",
    features: ["Public leaderboard", "Read-only API", "5 watchlist assets", "Email alerts"],
  },
  {
    id: "pro",
    name: "Pro",
    price: 49,
    description: "Active copy trading and signal access.",
    features: ["Copy up to 5 traders", "Live FinBERT signals", "Strategy Lab", "Unlimited watchlists", "API trading scope"],
    highlighted: true,
    current: true,
  },
  {
    id: "elite",
    name: "Elite",
    price: 199,
    description: "Pro tools and white-glove onboarding.",
    features: ["Copy unlimited traders", "Custom risk policies", "Backtest 5+ years tick data", "Priority signal routing", "Dedicated Slack channel"],
  },
];

const invoices = [
  { id: "inv_2026_04", date: "Apr 1, 2026", amount: 49.00, plan: "Pro", status: "paid" },
  { id: "inv_2026_03", date: "Mar 1, 2026", amount: 49.00, plan: "Pro", status: "paid" },
  { id: "inv_2026_02", date: "Feb 1, 2026", amount: 49.00, plan: "Pro", status: "paid" },
  { id: "inv_2026_01", date: "Jan 1, 2026", amount: 49.00, plan: "Pro", status: "paid" },
];

export default function BillingPage() {
  return (
      <div className="flex flex-col gap-6 p-6 max-w-[1200px] mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Settings</h1>
          <p className="text-sm text-slate-400 mt-1">Manage your profile, security, and integrations</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
          <SettingsNav />

          <div className="flex flex-col gap-5">
            {/* On-chain upgrade — the live payment rail (cards come later) */}
            <a
              href="/upgrade"
              className="flex items-center gap-3 rounded-xl border border-cyan-800/60 bg-cyan-950/30 p-4 transition-colors hover:bg-cyan-950/50"
            >
              <Sparkles className="h-5 w-5 shrink-0 text-cyan-400" />
              <div>
                <div className="text-sm font-semibold text-cyan-300">
                  Upgrade with crypto — pay once in USDC, on-chain
                </div>
                <div className="text-xs text-slate-400">
                  Connect your wallet, sign in with Ethereum, send one transaction. Card billing
                  arrives later.
                </div>
              </div>
              <span className="ml-auto text-xs font-medium text-cyan-400">Open →</span>
            </a>

            {/* Current plan summary */}
            <div className="card-dark p-6">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-cyan-400 font-bold mb-1">Current Plan</p>
                  <h2 className="text-2xl font-bold text-slate-50 flex items-center gap-2">
                    Pro <Sparkles className="w-5 h-5 text-cyan-400" />
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Renews Apr 30, 2026 · <span className="text-slate-300 font-semibold">$49/mo</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <button className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-sm font-medium hover:bg-slate-700 transition-colors">
                    Change Plan
                  </button>
                  <button className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-sm font-medium hover:bg-red-500/20 transition-colors border border-red-500/20">
                    Cancel
                  </button>
                </div>
              </div>
            </div>

            {/* Plan grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {plans.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "card-dark p-5 flex flex-col gap-4 relative",
                    p.highlighted && "border-cyan-500/40 bg-cyan-500/[0.03]"
                  )}
                >
                  {p.current && (
                    <span className="absolute -top-2 right-4 text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-cyan-500 text-slate-950">
                      Current
                    </span>
                  )}
                  <div>
                    <p className="text-base font-bold text-slate-100">{p.name}</p>
                    <p className="text-xs text-slate-500 mt-1">{p.description}</p>
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-slate-50 number-font">${p.price}<span className="text-sm font-normal text-slate-500">/mo</span></p>
                  </div>
                  <ul className="flex flex-col gap-2 text-sm">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="w-3.5 h-3.5 text-cyan-400 mt-0.5 shrink-0" />
                        <span className="text-slate-300">{f}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    className={cn(
                      "mt-auto py-2 rounded-lg text-sm font-semibold transition-colors",
                      p.current ? "bg-slate-800 text-slate-500 cursor-default"
                        : p.highlighted ? "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                        : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                    )}
                    disabled={p.current}
                  >
                    {p.current ? "Current Plan" : `Upgrade to ${p.name}`}
                  </button>
                </div>
              ))}
            </div>

            {/* Invoices */}
            <div className="card-dark p-6">
              <h2 className="text-base font-bold text-slate-100 mb-4">Invoice History</h2>
              <div className="divide-y divide-slate-800/60">
                {invoices.map((i) => (
                  <div key={i.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-100">{i.date}</p>
                      <p className="text-xs text-slate-500">{i.plan} · {i.id}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">Paid</span>
                      <span className="text-sm font-semibold text-slate-100 number-font tabular-nums">${i.amount.toFixed(2)}</span>
                      <button className="text-slate-500 hover:text-cyan-400 transition-colors p-1">
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
  );
}
