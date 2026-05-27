"use client";

import { Search, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";
import { SignInButton } from "@/components/wallet/SignInButton";
import { NotificationsDropdown } from "@/components/NotificationsDropdown";
import { useCommandPalette } from "@/components/CommandPalette";
import { DataStatusIndicator } from "@/components/DataStatusIndicator";

export function Navbar() {
  const [userOpen, setUserOpen] = useState(false);
  const { openPalette, palette } = useCommandPalette();

  return (
    <>
      <header className="h-14 shrink-0 flex items-center gap-3 px-4 bg-slate-950 border-b border-slate-800 relative z-30">
        <div className="flex-1 max-w-md">
          <button
            onClick={openPalette}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-500 w-full hover:bg-slate-800/80 hover:text-slate-300 transition-colors"
          >
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span>Search markets, traders, strategies…</span>
            <kbd className="ml-auto text-[10px] bg-slate-800 rounded px-1.5 py-0.5 font-mono text-slate-400">⌘K</kbd>
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <DataStatusIndicator />
          <div className="w-px h-6 bg-slate-800" />
          <NotificationsDropdown />

          <div className="w-px h-6 bg-slate-800 mx-1" />

          <SignInButton />
          <WalletConnectButton />

          <div className="relative">
            <button
              onClick={() => setUserOpen((o) => !o)}
              className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg hover:bg-slate-900 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-xs font-bold text-white">
                IP
              </div>
              <ChevronDown className="w-3 h-3 text-slate-500" />
            </button>

            {userOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setUserOpen(false)} />
                <div className="absolute right-0 top-11 z-40 w-56 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl py-1 overflow-hidden">
                  <div className="px-3 py-2.5 border-b border-slate-800">
                    <p className="text-sm font-semibold text-slate-100">ionut.eth</p>
                    <p className="text-xs text-slate-500 font-mono">0x4f3a…b29e</p>
                  </div>
                  {[
                    { label: "Profile",  href: "/dashboard/settings/profile" },
                    { label: "Settings", href: "/dashboard/settings" },
                    { label: "API Keys", href: "/dashboard/settings/api-keys" },
                    { label: "Billing",  href: "/dashboard/settings/billing" },
                  ].map(({ label, href }) => (
                    <Link
                      key={label}
                      href={href}
                      onClick={() => setUserOpen(false)}
                      className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors block"
                    >
                      {label}
                    </Link>
                  ))}
                  <div className="h-px bg-slate-800 my-1" />
                  <button className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-slate-800 transition-colors">
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {palette}
    </>
  );
}
