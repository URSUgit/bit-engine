import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function CTA() {
  return (
    <section className="py-24 px-4 sm:px-8">
      <div className="max-w-3xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-medium mb-8">
          No credit card required
        </div>
        <h2 className="text-4xl sm:text-5xl font-extrabold text-zinc-50 mb-5 leading-tight">
          Ready to Trade Like{" "}
          <span className="text-gradient-cyan">the Best?</span>
        </h2>
        <p className="text-zinc-400 text-lg mb-10 max-w-xl mx-auto">
          Connect your wallet and start copy-trading verified on-chain traders in under 5 minutes.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-cyan-500 text-zinc-950 font-bold text-lg hover:bg-cyan-400 transition-all shadow-2xl shadow-cyan-500/25 hover:shadow-cyan-500/40"
        >
          Launch App
          <ArrowRight className="w-5 h-5" />
        </Link>
      </div>
    </section>
  );
}
