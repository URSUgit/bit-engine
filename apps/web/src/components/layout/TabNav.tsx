"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Globe, TrendingUp, Activity, FlaskConical,
  Wallet, Settings, Users, Newspaper, Zap, Layers, BookOpen,
  Sparkles, Target, Star, History, UserCircle, KeyRound, Receipt, LineChart,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Tab {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  sub?: { label: string; href: string; icon: LucideIcon; badge?: string }[];
}

const TABS: Tab[] = [
  {
    label: "Home",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Markets",
    href: "/dashboard/markets",
    icon: Globe,
    sub: [
      { label: "All Markets",  href: "/dashboard/markets",    icon: Globe },
      { label: "Watchlists",   href: "/dashboard/watchlists", icon: Star },
    ],
  },
  {
    label: "Trade",
    href: "/dashboard/positions",
    icon: TrendingUp,
    sub: [
      { label: "Positions",    href: "/dashboard/positions",  icon: TrendingUp },
      { label: "Copy Trading", href: "/dashboard/copy",       icon: Users,     badge: "3" },
      { label: "History",      href: "/dashboard/history",    icon: History },
    ],
  },
  {
    label: "Signals",
    href: "/dashboard/signals",
    icon: Activity,
    sub: [
      { label: "Live Feed",    href: "/dashboard/signals",    icon: Activity },
      { label: "News",         href: "/dashboard/news",       icon: Newspaper },
    ],
  },
  {
    label: "Lab",
    href: "/lab/backtester",
    icon: FlaskConical,
    sub: [
      { label: "Backtester",      href: "/lab/backtester",  icon: Zap },
      { label: "Forecaster",      href: "/lab/forecaster",  icon: LineChart, badge: "new" },
      { label: "Signal Builder",  href: "/lab/signals",     icon: Layers },
      { label: "AI Agent",        href: "/lab/agent",       icon: Sparkles, badge: "new" },
      { label: "Polymarket Bot",  href: "/lab/polymarket",  icon: Target },
      { label: "Notebooks",       href: "/lab/notebooks",   icon: BookOpen },
    ],
  },
  {
    label: "Portfolio",
    href: "/dashboard/portfolios",
    icon: Wallet,
    sub: [
      { label: "Portfolios",   href: "/dashboard/portfolios",  icon: Wallet },
      { label: "Leaderboard",  href: "/dashboard/leaderboard", icon: TrendingUp },
    ],
  },
  {
    label: "Settings",
    href: "/dashboard/settings/profile",
    icon: Settings,
    sub: [
      { label: "Profile",      href: "/dashboard/settings/profile",    icon: UserCircle },
      { label: "API Keys",     href: "/dashboard/settings/api-keys",   icon: KeyRound },
      { label: "Billing",      href: "/dashboard/settings/billing",    icon: Receipt },
      { label: "Notifications",href: "/dashboard/settings/notifications", icon: Activity },
    ],
  },
];

function isActive(pathname: string, href: string, tab: Tab): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (tab.sub) return tab.sub.some((s) => pathname === s.href || pathname.startsWith(s.href + "/"));
  return pathname === href || pathname.startsWith(href + "/");
}

export function TabNav() {
  const pathname = usePathname();

  const activeTab = TABS.find((t) => isActive(pathname, t.href, t));
  const subTabs = activeTab?.sub;

  return (
    <div className="shrink-0 bg-slate-950 border-b border-slate-800">
      {/* Primary tab bar */}
      <div className="flex items-end gap-0.5 px-4 overflow-x-auto scrollbar-none">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href, tab);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.sub ? tab.sub[0]!.href : tab.href}
              className={cn(
                "group flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
                active
                  ? "border-cyan-400 text-cyan-300"
                  : "border-transparent text-slate-500 hover:text-slate-200 hover:border-slate-600"
              )}
            >
              <Icon className={cn("w-4 h-4 shrink-0", active ? "text-cyan-400" : "text-slate-600 group-hover:text-slate-400")} />
              {tab.label}
              {tab.badge && (
                <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-cyan-500/20 text-cyan-300 uppercase tracking-wider">
                  {tab.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Secondary sub-tab bar */}
      {subTabs && subTabs.length > 1 && (
        <div className="flex items-center gap-1 px-4 py-2 bg-slate-900/40 overflow-x-auto scrollbar-none border-t border-slate-800/60">
          {subTabs.map((sub) => {
            const active = pathname === sub.href || pathname.startsWith(sub.href + "/");
            const Icon = sub.icon;
            return (
              <Link
                key={sub.href}
                href={sub.href}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap",
                  active
                    ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20"
                    : "text-slate-500 hover:text-slate-200 hover:bg-slate-800"
                )}
              >
                <Icon className="w-3 h-3" />
                {sub.label}
                {sub.badge && (
                  <span className="text-[9px] font-bold px-1 rounded bg-cyan-500/20 text-cyan-300">
                    {sub.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
