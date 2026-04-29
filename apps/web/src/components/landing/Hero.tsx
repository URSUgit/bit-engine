"use client";

import Link from "next/link";
import { ArrowRight, Play, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

interface AnimatedNumberProps {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  duration?: number;
}

function AnimatedNumber({ value, prefix = "", suffix = "", decimals = 0, duration = 1500 }: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  const formatted = display.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return <span className="number-font tabular-nums">{prefix}{formatted}{suffix}</span>;
}

const heroStats = [
  { value: 2.41, suffix: "B", prefix: "$", decimals: 2, label: "Total Volume" },
  { value: 1284, suffix: "", prefix: "", decimals: 0, label: "Active Bots" },
  { value: 68.4, suffix: "%", prefix: "", decimals: 1, label: "Avg Win Rate" },
  { value: 9472, suffix: "", prefix: "", decimals: 0, label: "Signals Today" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-28 pb-24 px-4 sm:px-8">
      <div className="absolute inset-0 grid-pattern pointer-events-none opacity-50" />
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1100px] h-[600px] bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute top-40 left-1/3 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-3xl" />
        <div className="absolute top-20 right-1/4 w-[400px] h-[400px] bg-violet-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-6xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-medium mb-8 animate-fade-in">
          <Sparkles className="w-3 h-3" />
          <span>Now live on Hyperliquid · Polymarket · Drift</span>
          <span className="w-1 h-1 rounded-full bg-cyan-500" />
          <span className="text-cyan-400/80">v0.4 beta</span>
        </div>

        <h1 className="text-5xl sm:text-6xl lg:text-7xl xl:text-8xl font-extrabold leading-[0.95] tracking-tight text-slate-50 mb-7 animate-fade-in-slow">
          BITprivat
          <span className="block mt-2 text-gradient-cyan">Market Intelligence OS</span>
        </h1>

        <p className="max-w-2xl mx-auto text-lg sm:text-xl text-slate-400 leading-relaxed mb-10 animate-fade-in-slow">
          The operating system for serious crypto traders. Copy elite on-chain wallets, run AI sentiment engines,
          and deploy automated strategies across DeFi — all from one cockpit.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-20 animate-fade-in-slow">
          <Link
            href="/dashboard"
            className="group flex items-center gap-2 px-7 py-3.5 rounded-xl bg-cyan-500 text-slate-950 font-bold text-base hover:bg-cyan-400 transition-all shadow-[0_0_30px_-5px_rgba(34,211,238,0.5)] hover:shadow-[0_0_40px_-5px_rgba(34,211,238,0.7)]"
          >
            Launch App
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <Link
            href="#demo"
            className="flex items-center gap-2 px-7 py-3.5 rounded-xl bg-slate-900/80 backdrop-blur text-slate-200 font-medium text-base hover:bg-slate-800 border border-slate-700 transition-colors"
          >
            <Play className="w-4 h-4" />
            View Demo
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px max-w-4xl mx-auto rounded-2xl overflow-hidden bg-slate-800/60 border border-slate-800 backdrop-blur animate-slide-up">
          {heroStats.map((stat) => (
            <div key={stat.label} className="bg-slate-950/80 px-6 py-6 flex flex-col items-center gap-1.5">
              <div className="text-3xl sm:text-4xl font-bold text-slate-50 tracking-tight">
                <AnimatedNumber {...stat} />
              </div>
              <div className="text-xs text-slate-500 uppercase tracking-widest font-medium">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
