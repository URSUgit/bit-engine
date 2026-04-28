"use client";

import { Bell, Search } from "lucide-react";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";

export function Navbar() {
  return (
    <header className="h-14 shrink-0 flex items-center gap-3 px-4 bg-zinc-900 border-b border-zinc-800">
      {/* Search */}
      <div className="flex-1 max-w-sm">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-400">
          <Search className="w-3.5 h-3.5 shrink-0" />
          <span>Search markets, traders…</span>
          <kbd className="ml-auto text-[10px] bg-zinc-700 rounded px-1.5 py-0.5 font-mono">⌘K</kbd>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Notifications */}
        <button className="relative w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 transition-colors">
          <Bell className="w-4 h-4 text-zinc-400" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-cyan-500" />
        </button>

        {/* Wallet connect */}
        <WalletConnectButton />
      </div>
    </header>
  );
}
