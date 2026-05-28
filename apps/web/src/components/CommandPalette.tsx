"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  LayoutDashboard,
  TrendingUp,
  Globe,
  Users,
  Activity,
  FlaskConical,
  Wallet,
  Star,
  Settings,
  Trophy,
  ArrowRight,
  Zap,
  Layers,
  BookOpen,
  Sparkles,
  Target,
  Newspaper,
  History,
  type LucideIcon,
} from "lucide-react";
import { mockTraders } from "@/lib/mock-data";

const CRYPTO_MARKETS = [
  { symbol: "BTC", name: "Bitcoin" }, { symbol: "ETH", name: "Ethereum" },
  { symbol: "SOL", name: "Solana" }, { symbol: "BNB", name: "BNB" },
  { symbol: "XRP", name: "XRP" }, { symbol: "ADA", name: "Cardano" },
  { symbol: "DOGE", name: "Dogecoin" }, { symbol: "AVAX", name: "Avalanche" },
  { symbol: "MATIC", name: "Polygon" }, { symbol: "DOT", name: "Polkadot" },
  { symbol: "LINK", name: "Chainlink" }, { symbol: "LTC", name: "Litecoin" },
  { symbol: "ATOM", name: "Cosmos" }, { symbol: "UNI", name: "Uniswap" },
  { symbol: "ARB", name: "Arbitrum" }, { symbol: "OP", name: "Optimism" },
];
import { cn } from "@/lib/utils";

interface NavCommand {
  type: "nav";
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  shortcut?: string;
}

interface TraderCommand {
  type: "trader";
  label: string;
  description: string;
  href: string;
  avatarColor: string;
}

interface MarketCommand {
  type: "market";
  label: string;
  description: string;
  href: string;
  symbol: string;
}

type Command = NavCommand | TraderCommand | MarketCommand;

const navCommands: NavCommand[] = [
  // ── Operate ──────────────────────────────────────────────────────────
  { type: "nav", label: "Dashboard",        description: "Portfolio overview & equity curve",  href: "/dashboard",                    icon: LayoutDashboard, shortcut: "G D" },
  { type: "nav", label: "Positions",        description: "Open & paper-trade positions",       href: "/dashboard/positions",          icon: TrendingUp,      shortcut: "G P" },
  { type: "nav", label: "Markets",          description: "Browse all markets",                 href: "/dashboard/markets",            icon: Globe,           shortcut: "G M" },
  { type: "nav", label: "Copy Trading",     description: "Manage copied traders",              href: "/dashboard/copy",               icon: Users,           shortcut: "G C" },
  { type: "nav", label: "Live Signals",     description: "AI + on-chain signal feed",          href: "/dashboard/signals",            icon: Activity,        shortcut: "G S" },
  { type: "nav", label: "News",             description: "Real-time crypto news + sentiment",  href: "/dashboard/news",               icon: Newspaper,       shortcut: "G N" },
  { type: "nav", label: "Watchlists",       description: "Saved asset lists",                  href: "/dashboard/watchlists",         icon: Star,            shortcut: "G W" },
  { type: "nav", label: "Portfolios",       description: "Strategy books",                     href: "/dashboard/portfolios",         icon: Wallet },
  { type: "nav", label: "History",          description: "Closed paper-trade log",             href: "/dashboard/history",            icon: History },
  { type: "nav", label: "Leaderboard",      description: "Top traders this week",              href: "/dashboard/leaderboard",        icon: Trophy,          shortcut: "G L" },
  // ── Build / Lab ───────────────────────────────────────────────────────
  { type: "nav", label: "Strategy Lab",     description: "Lab overview",                       href: "/lab",                          icon: FlaskConical,    shortcut: "G B" },
  { type: "nav", label: "Backtester",       description: "Backtest strategies on history",     href: "/lab/backtester",               icon: Zap },
  { type: "nav", label: "Signal Builder",   description: "Compose entry conditions",           href: "/lab/signals",                  icon: Layers },
  { type: "nav", label: "AI Agent",         description: "Chat with the market AI assistant",  href: "/lab/agent",                    icon: Sparkles },
  { type: "nav", label: "Polymarket Bot",   description: "Run prediction market bots",         href: "/lab/polymarket",               icon: Target },
  { type: "nav", label: "Notebooks",        description: "Research notebooks",                 href: "/lab/notebooks",                icon: BookOpen },
  // ── Settings ──────────────────────────────────────────────────────────
  { type: "nav", label: "Settings",         description: "Profile, API keys, billing",         href: "/dashboard/settings/profile",   icon: Settings },
  { type: "nav", label: "API Keys",         description: "Manage access keys",                 href: "/dashboard/settings/api-keys",  icon: Settings },
  { type: "nav", label: "System Status",    description: "Live data-source health",            href: "/status",                       icon: Activity },
];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // Defer focus to next tick
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const traderCommands: TraderCommand[] = useMemo(
    () =>
      mockTraders.slice(0, 25).map((t) => ({
        type: "trader",
        label: t.handle ?? "(unknown)",
        description: `${(t.stats?.roi30d ?? 0) >= 0 ? "+" : ""}${(t.stats?.roi30d ?? 0).toFixed(1)}% · ${(t.stats?.winRatePct ?? 0).toFixed(0)}% wr`,
        href: `/dashboard/leaderboard/${t.id}`,
        avatarColor: t.avatarColor,
      })),
    []
  );

  const marketCommands: MarketCommand[] = useMemo(
    () =>
      CRYPTO_MARKETS.map((a) => ({
        type: "market",
        label: a.symbol,
        description: `${a.name} · Binance perpetual`,
        href: `/dashboard/markets/${a.symbol}`,
        symbol: a.symbol,
      })),
    []
  );

  const allCommands: Command[] = useMemo(
    () => [...navCommands, ...traderCommands, ...marketCommands],
    [traderCommands, marketCommands]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return allCommands.slice(0, 12);
    const q = query.toLowerCase();
    return allCommands
      .filter((c) =>
        c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [query, allCommands]);

  // Keep activeIndex in range
  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [filtered, activeIndex]);

  // Keyboard navigation
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[activeIndex];
      if (cmd) {
        router.push(cmd.href);
        onClose();
      }
    }
  };

  // Auto-scroll active row into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  // Group commands by type for display
  const groups = filtered.reduce<Record<string, Command[]>>((acc, c) => {
    (acc[c.type] ??= []).push(c);
    return acc;
  }, {});

  let runningIndex = -1;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4 animate-fade-in" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
          <Search className="w-4 h-4 text-slate-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search markets, traders, navigation…"
            className="flex-1 bg-transparent outline-none text-sm text-slate-200 placeholder:text-slate-500"
          />
          <kbd className="text-[10px] bg-slate-800 rounded px-1.5 py-0.5 font-mono text-slate-400">ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[420px] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <p className="text-center text-sm text-slate-500 py-12">No matches for "{query}"</p>
          )}
          {(["nav", "trader", "market"] as const).map((groupKey) => {
            const items = groups[groupKey];
            if (!items?.length) return null;
            const groupLabel = groupKey === "nav" ? "Navigation" : groupKey === "trader" ? "Traders" : "Markets";
            return (
              <div key={groupKey} className="px-1">
                <p className="px-3 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                  {groupLabel}
                </p>
                {items.map((c) => {
                  runningIndex++;
                  const idx = runningIndex;
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={`${c.type}-${c.href}-${idx}`}
                      data-idx={idx}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => { router.push(c.href); onClose(); }}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 text-left rounded-md transition-colors",
                        isActive ? "bg-cyan-500/10 text-cyan-200" : "hover:bg-slate-800/50 text-slate-200"
                      )}
                    >
                      {c.type === "nav" && (
                        <div className={cn("w-7 h-7 rounded-md flex items-center justify-center shrink-0",
                          isActive ? "bg-cyan-500/15" : "bg-slate-800")}>
                          <c.icon className={cn("w-3.5 h-3.5", isActive ? "text-cyan-400" : "text-slate-400")} />
                        </div>
                      )}
                      {c.type === "trader" && (
                        <div className={cn("w-7 h-7 rounded-full bg-gradient-to-br flex items-center justify-center text-[10px] font-bold text-white shrink-0", c.avatarColor)}>
                          {c.label[0]?.toUpperCase()}
                        </div>
                      )}
                      {c.type === "market" && (
                        <div className="w-7 h-7 rounded-md bg-slate-800 border border-slate-700/50 flex items-center justify-center text-[10px] font-bold text-slate-300 shrink-0">
                          {c.symbol.slice(0, 3)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.label}</p>
                        <p className="text-[11px] text-slate-500 truncate">{c.description}</p>
                      </div>
                      {c.type === "nav" && c.shortcut && (
                        <kbd className="text-[10px] bg-slate-800 rounded px-1.5 py-0.5 font-mono text-slate-500 shrink-0">{c.shortcut}</kbd>
                      )}
                      {isActive && <ArrowRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer hints */}
        <div className="border-t border-slate-800 px-3 py-2 flex items-center gap-3 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><kbd className="bg-slate-800 rounded px-1 py-0.5 font-mono">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="bg-slate-800 rounded px-1 py-0.5 font-mono">↵</kbd> open</span>
          <span className="flex items-center gap-1"><kbd className="bg-slate-800 rounded px-1 py-0.5 font-mono">esc</kbd> close</span>
          <span className="flex items-center gap-1 ml-2 text-slate-600"><kbd className="bg-slate-800 rounded px-1 py-0.5 font-mono">g</kbd>+<kbd className="bg-slate-800 rounded px-1 py-0.5 font-mono">d/p/m/s…</kbd> jump</span>
          <span className="ml-auto">{filtered.length} results</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook that wires up Cmd+K / Ctrl+K globally and exposes open state.
 * Use in any client component (e.g. the navbar) to mount the palette.
 */
const GO_SHORTCUTS: Record<string, string> = {
  d: "/dashboard",
  p: "/dashboard/positions",
  m: "/dashboard/markets",
  c: "/dashboard/copy",
  s: "/dashboard/signals",
  n: "/dashboard/news",
  w: "/dashboard/watchlists",
  l: "/dashboard/leaderboard",
  b: "/lab/backtester",
};

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let gPressed = false;
    let gTimer: ReturnType<typeof setTimeout> | null = null;

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isEditing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable;

      // Ctrl+K / Cmd+K — open palette
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }

      if (isEditing) return;

      // g+key shortcuts (e.g. g then d = Dashboard)
      if (gPressed) {
        gPressed = false;
        if (gTimer) clearTimeout(gTimer);
        const dest = GO_SHORTCUTS[e.key.toLowerCase()];
        if (dest) { e.preventDefault(); router.push(dest); }
        return;
      }
      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        gPressed = true;
        gTimer = setTimeout(() => { gPressed = false; }, 800);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return {
    open,
    openPalette: () => setOpen(true),
    closePalette: () => setOpen(false),
    palette: <CommandPalette open={open} onClose={() => setOpen(false)} />,
  };
}
