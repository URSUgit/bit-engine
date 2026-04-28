"use client";

import Link from "next/link";
import { Zap } from "lucide-react";

export function LandingNav() {
  return (
    <nav className="sticky top-0 z-50 h-14 flex items-center px-4 sm:px-8 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/60">
      <Link href="/landing" className="flex items-center gap-2 mr-auto">
        <div className="w-7 h-7 rounded-lg bg-cyan-500 flex items-center justify-center">
          <Zap className="w-4 h-4 text-zinc-950" strokeWidth={2.5} />
        </div>
        <span className="text-base font-bold text-zinc-50 tracking-tight">
          Bit<span className="text-cyan-400">Privat</span>
        </span>
      </Link>

      <div className="hidden md:flex items-center gap-6 text-sm text-zinc-400">
        {["Features", "Leaderboard", "Pricing", "Docs"].map((item) => (
          <Link key={item} href="#" className="hover:text-zinc-200 transition-colors">
            {item}
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-2 ml-6">
        <Link
          href="/dashboard"
          className="px-4 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
        >
          Sign In
        </Link>
        <Link
          href="/dashboard"
          className="px-4 py-1.5 text-sm rounded-lg bg-cyan-500 text-zinc-950 font-semibold hover:bg-cyan-400 transition-colors"
        >
          Start Trading
        </Link>
      </div>
    </nav>
  );
}
