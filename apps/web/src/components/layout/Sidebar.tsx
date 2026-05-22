"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  Users,
  Globe,
  FlaskConical,
  Zap,
  Layers,
  BookOpen,
  Wallet,
  History,
  Star,
  Settings,
  KeyRound,
  Receipt,
  UserCircle,
  ChevronRight,
  Activity,
  Sparkles,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/Logo";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    title: "Operate",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Positions", href: "/dashboard/positions", icon: TrendingUp, badge: "7" },
      { label: "Markets", href: "/dashboard/markets", icon: Globe },
      { label: "Copy Trading", href: "/dashboard/copy", icon: Users, badge: "3" },
      { label: "Signals", href: "/dashboard/signals", icon: Activity },
    ],
  },
  {
    title: "Build",
    items: [
      { label: "Strategy Lab", href: "/lab", icon: FlaskConical },
      { label: "Backtester", href: "/lab/backtester", icon: Zap },
      { label: "Signal Builder", href: "/lab/signals", icon: Layers },
      { label: "Notebooks", href: "/lab/notebooks", icon: BookOpen },
      { label: "AI Agent", href: "/lab/agent", icon: Sparkles, badge: "new" },
      { label: "Polymarket Bot", href: "/lab/polymarket", icon: Target },
    ],
  },
  {
    title: "Workspace",
    items: [
      { label: "Portfolios", href: "/dashboard/portfolios", icon: Wallet },
      { label: "History", href: "/dashboard/history", icon: History },
      { label: "Watchlists", href: "/dashboard/watchlists", icon: Star },
    ],
  },
  {
    title: "Company",
    items: [
      { label: "Profile", href: "/dashboard/settings/profile", icon: UserCircle },
      { label: "Settings", href: "/dashboard/settings", icon: Settings },
      { label: "API Keys", href: "/dashboard/settings/api-keys", icon: KeyRound },
      { label: "Billing", href: "/dashboard/settings/billing", icon: Receipt },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 flex flex-col bg-slate-950 border-r border-slate-800 h-full overflow-y-auto">
      <Link href="/landing" className="flex items-center gap-2.5 px-5 py-5 border-b border-slate-800">
        <LogoMark size={28} />
        <span className="text-base font-bold tracking-tight text-slate-50">
          BIT<span className="text-cyan-400">privat</span>
        </span>
      </Link>

      <nav className="flex-1 px-3 py-4 flex flex-col gap-5">
        {navGroups.map((group) => (
          <div key={group.title}>
            <p className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">
              {group.title}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors",
                      active
                        ? "bg-cyan-500/10 text-cyan-300 font-medium"
                        : "text-slate-400 hover:text-slate-100 hover:bg-slate-900"
                    )}
                  >
                    <Icon
                      className={cn(
                        "w-4 h-4 shrink-0",
                        active ? "text-cyan-400" : "text-slate-500 group-hover:text-slate-300"
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                    {item.badge && (
                      <span
                        className={cn(
                          "ml-auto text-[10px] font-bold px-1.5 rounded h-4 flex items-center",
                          active ? "bg-cyan-500/20 text-cyan-300" : "bg-slate-800 text-slate-400"
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                    {active && !item.badge && <ChevronRight className="ml-auto w-3 h-3 text-cyan-500/60" />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-800 p-3">
        <div className="px-2 py-1 mb-2 rounded-lg bg-gradient-to-br from-cyan-500/10 to-blue-500/5 border border-cyan-500/20">
          <p className="text-[10px] uppercase tracking-widest text-cyan-300 font-bold">Pro Plan</p>
          <p className="text-xs text-slate-300 mt-0.5">14 days remaining</p>
          <button className="mt-2 w-full text-[11px] py-1 rounded bg-cyan-500 text-slate-950 font-semibold hover:bg-cyan-400 transition-colors">
            Upgrade
          </button>
        </div>
        <p className="text-[10px] text-slate-600 text-center">v0.4.0 · build 2451</p>
      </div>
    </aside>
  );
}
