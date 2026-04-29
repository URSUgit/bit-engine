import Link from "next/link";
import { ArrowRight, Zap } from "lucide-react";

export function CTA() {
  return (
    <section className="relative py-24 px-4 sm:px-8">
      <div className="max-w-5xl mx-auto">
        <div className="relative overflow-hidden rounded-3xl border border-cyan-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/40 p-10 sm:p-16 text-center">
          <div className="absolute inset-0 grid-pattern opacity-30 pointer-events-none" />
          <div className="absolute -top-32 -right-32 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />

          <div className="relative">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-950/80 border border-cyan-500/30 text-cyan-300 text-xs font-medium mb-6">
              <Zap className="w-3 h-3" />
              No credit card · No KYC · 5-min setup
            </div>

            <h2 className="text-4xl sm:text-6xl font-extrabold text-slate-50 mb-5 leading-[1.05] tracking-tight">
              Your edge is{" "}
              <span className="text-gradient-cyan">one click away.</span>
            </h2>
            <p className="text-slate-400 text-lg mb-10 max-w-xl mx-auto">
              Connect your wallet, follow a trader, and start mirroring elite on-chain performance in minutes.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/dashboard"
                className="group flex items-center gap-2 px-8 py-4 rounded-xl bg-cyan-500 text-slate-950 font-bold text-base hover:bg-cyan-400 transition-all shadow-[0_0_30px_-5px_rgba(34,211,238,0.6)]"
              >
                Launch BitPrivat
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                href="https://docs.bitprivat.io"
                className="text-sm text-slate-400 hover:text-slate-200 transition-colors px-4 py-4"
              >
                Read the docs →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
