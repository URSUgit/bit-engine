"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FlaskConical,
  TrendingUp,
  BarChart3,
  Wallet,
  Users,
  Settings,
  ChevronRight,
  Zap,
  BookOpen,
  History,
  Globe,
  BrainCircuit,
  Trophy,
  KeyRound,
  Bell,
  UserCircle,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    title: "Portfolio",
    items: [
      { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
      { label: "Positions", href: "/dashboard/positions", icon: TrendingUp },
      { label: "History", href: "/dashboard/history", icon: History },
    ],
  },
  {
    title: "Trading",
    items: [
      { label: "Markets", href: "/dashboard/markets", icon: Globe },
      { label: "Copy Trading", href: "/dashboard/copy", icon: Users },
      { label: "Order Book", href: "/dashboard/orderbook", icon: BookOpen },
    ],
  },
  {
    title: "Strategy Lab",
    items: [
      { label: "Backtester", href: "/lab", icon: FlaskConical },
      { label: "Signal Builder", href: "/lab/signals", icon: Zap },
      { label: "Portfolios", href: "/lab/portfolios", icon: BarChart3 },
    ],
  },
  {
    title: "Analytics",
    items: [
      { label: "On-Chain", href: "/dashboard/onchain", icon: Activity },
      { label: "Sentiment", href: "/dashboard/sentiment", icon: BrainCircuit },
      { label: "Leaderboard", href: "/dashboard/leaderboard", icon: Trophy },
    ],
  },
  {
    title: "Wallet",
    items: [
      { label: "Connect", href: "/dashboard/wallet", icon: Wallet },
      { label: "Balances", href: "/dashboard/wallet/balances", icon: BarChart3 },
    ],
  },
  {
    title: "Settings",
    items: [
      { label: "Profile", href: "/dashboard/settings/profile", icon: UserCircle },
      { label: "API Keys", href: "/dashboard/settings/api-keys", icon: KeyRound },
      { label: "Notifications", href: "/dashboard/settings/notifications", icon: Bell },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 flex flex-col bg-zinc-900 border-r border-zinc-800 h-full overflow-y-auto">
      {/* Logo */}
      <Link href="/landing" className="flex items-center gap-2.5 px-5 py-5 border-b border-zinc-800">
        <div className="w-7 h-7 rounded-lg bg-cyan-500 flex items-center justify-center">
          <Zap className="w-4 h-4 text-zinc-950" strokeWidth={2.5} />
        </div>
        <span className="text-base font-bold tracking-tight text-zinc-50">
          Bit<span className="text-cyan-400">Privat</span>
        </span>
      </Link>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-5">
        {navGroups.map((group) => (
          <div key={group.title}>
            <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              {group.title}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors group",
                      active
                        ? "bg-cyan-500/10 text-cyan-400 font-medium"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                    )}
                  >
                    <Icon
                      className={cn("w-4 h-4 shrink-0", active ? "text-cyan-400" : "text-zinc-500 group-hover:text-zinc-300")}
                    />
                    <span className="truncate">{item.label}</span>
                    {active && <ChevronRight className="ml-auto w-3 h-3 text-cyan-500/60" />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom user area */}
      <div className="border-t border-zinc-800 p-3">
        <Link
          href="/dashboard/settings/profile"
          className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-zinc-800 transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-xs font-bold text-white">
            BP
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-zinc-200 truncate">demo@bitprivat.io</p>
            <p className="text-[10px] text-zinc-500">Pro Trader</p>
          </div>
          <Settings className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
        </Link>
      </div>
    </aside>
  );
}
