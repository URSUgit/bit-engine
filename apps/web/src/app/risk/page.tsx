import type { Metadata } from "next";
import { Footer } from "@/components/layout/Footer";

export const metadata: Metadata = { title: "Risk Disclosure | BitPrivat" };

export default function RiskPage() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <main className="flex-1 max-w-3xl mx-auto px-4 py-16">
        {/* Warning banner */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 mb-10">
          <span className="text-red-400 text-xl leading-none mt-0.5">⚠</span>
          <p className="text-red-300 text-sm leading-relaxed">
            <strong>High Risk Warning:</strong> Cryptocurrency trading and copy trading carry a high level of risk and
            may not be suitable for all investors. You may lose some or all of your invested capital. Do not trade with
            money you cannot afford to lose.
          </p>
        </div>

        <h1 className="text-3xl font-bold text-zinc-50 mb-2">Risk Disclosure</h1>
        <p className="text-zinc-400 text-sm mb-10">Please read this disclosure carefully before using BitPrivat.</p>

        <div className="flex flex-col gap-8">
          {[
            {
              title: "Market Risk",
              body: "Cryptocurrency markets are highly volatile. Prices can move dramatically in short periods due to market sentiment, regulatory news, technical factors, and other unpredictable events. No trading system or strategy can guarantee profits.",
            },
            {
              title: "Copy Trading Risk",
              body: "Past performance of any trader on the leaderboard does not guarantee future results. A trader with an excellent historical record can experience significant losses. You remain responsible for all copy-trading decisions and outcomes.",
            },
            {
              title: "Liquidity Risk",
              body: "DeFi markets, particularly prediction markets and perpetual futures, can experience low liquidity periods that make it difficult to exit positions at desired prices.",
            },
            {
              title: "Smart Contract Risk",
              body: "DeFi protocols carry inherent smart contract risk, including bugs, exploits, and unexpected behavior. BitPrivat does not control underlying protocols and cannot be held responsible for losses arising from protocol failures.",
            },
            {
              title: "Regulatory Risk",
              body: "The regulatory landscape for cryptocurrencies is evolving. Changes in regulation may affect the legality and accessibility of certain trading activities in your jurisdiction.",
            },
            {
              title: "Technology Risk",
              body: "System downtime, network outages, or technical failures may prevent you from entering or exiting positions. BitPrivat implements redundancy measures but cannot guarantee 100% uptime.",
            },
          ].map(({ title, body }) => (
            <section key={title}>
              <h2 className="text-lg font-semibold text-zinc-200 mb-2">{title}</h2>
              <p className="text-zinc-400 leading-relaxed">{body}</p>
            </section>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}
