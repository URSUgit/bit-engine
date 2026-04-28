import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-24 pb-20 px-4 sm:px-8">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="absolute top-20 left-1/3 w-[400px] h-[400px] bg-blue-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-5xl mx-auto text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-medium mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          Now live on Hyperliquid & Polymarket
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold leading-[1.05] tracking-tight text-zinc-50 mb-6">
          Trade Like the{" "}
          <span className="text-gradient-cyan">Top 1%</span>
          <br />
          of DeFi Traders
        </h1>

        {/* Subheadline */}
        <p className="max-w-2xl mx-auto text-lg sm:text-xl text-zinc-400 leading-relaxed mb-10">
          Copy elite on-chain traders in real time, harness AI-powered sentiment signals, and deploy automated
          strategies — all in one professional-grade platform.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-16">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-cyan-500 text-zinc-950 font-bold text-base hover:bg-cyan-400 transition-all shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30"
          >
            Start Trading Free
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="#leaderboard"
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-zinc-800 text-zinc-200 font-medium text-base hover:bg-zinc-700 border border-zinc-700 transition-colors"
          >
            <Play className="w-4 h-4" />
            View Leaderboard
          </Link>
        </div>

        {/* Social proof */}
        <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="text-zinc-300 font-semibold">12,847</span> active traders
          </span>
          <span className="text-zinc-700">·</span>
          <span className="flex items-center gap-1.5">
            <span className="text-zinc-300 font-semibold">$2.4B</span> total volume
          </span>
          <span className="text-zinc-700">·</span>
          <span className="flex items-center gap-1.5">
            <span className="text-zinc-300 font-semibold">340ms</span> avg latency
          </span>
          <span className="text-zinc-700">·</span>
          <span className="flex items-center gap-1.5">
            <span className="text-zinc-300 font-semibold">99.9%</span> uptime SLA
          </span>
        </div>
      </div>
    </section>
  );
}
