"use client";

import Link from "next/link";
import { Zap, Github } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const links = [
  { label: "Features", href: "#features" },
  { label: "Strategies", href: "#strategies" },
  { label: "Leaderboard", href: "#leaderboard" },
  { label: "Docs", href: "https://docs.bitprivat.io" },
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={cn(
        "sticky top-0 z-50 h-16 flex items-center px-4 sm:px-8 transition-all duration-200",
        scrolled
          ? "bg-slate-950/85 backdrop-blur-xl border-b border-slate-800/80"
          : "bg-transparent border-b border-transparent"
      )}
    >
      <Link href="/landing" className="flex items-center gap-2.5 mr-auto">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-[0_0_20px_-2px_rgba(34,211,238,0.5)]">
          <Zap className="w-4 h-4 text-slate-950" strokeWidth={3} />
        </div>
        <span className="text-base font-bold text-slate-50 tracking-tight">
          BIT<span className="text-cyan-400">privat</span>
        </span>
      </Link>

      <div className="hidden md:flex items-center gap-1 text-sm text-slate-400 mr-2">
        {links.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="px-3 py-1.5 rounded-md hover:text-slate-100 hover:bg-slate-900/60 transition-colors"
          >
            {item.label}
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Link
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:flex w-9 h-9 items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-900 transition-colors"
          aria-label="GitHub"
        >
          <Github className="w-4 h-4" />
        </Link>
        <Link
          href="/dashboard"
          className="px-4 py-1.5 text-sm rounded-lg bg-slate-900 text-slate-200 border border-slate-800 hover:bg-slate-800 transition-colors"
        >
          Sign In
        </Link>
        <Link
          href="/dashboard"
          className="px-4 py-1.5 text-sm rounded-lg bg-cyan-500 text-slate-950 font-semibold hover:bg-cyan-400 transition-colors shadow-[0_0_20px_-5px_rgba(34,211,238,0.6)]"
        >
          Launch App
        </Link>
      </div>
    </nav>
  );
}
