import { LandingNav } from "@/components/landing/LandingNav";
import { Hero } from "@/components/landing/Hero";
import { LiveTicker } from "@/components/landing/LiveTicker";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LeaderboardPreview } from "@/components/landing/LeaderboardPreview";
import { StrategyFamilies } from "@/components/landing/StrategyFamilies";
import { Stats } from "@/components/landing/Stats";
import { CTA } from "@/components/landing/CTA";
import { Footer } from "@/components/layout/Footer";

export const metadata = {
  title: "BITprivat — Market Intelligence OS",
  description:
    "The operating system for serious crypto traders. Copy elite on-chain wallets, run AI sentiment engines, and deploy automated strategies across DeFi.",
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <LandingNav />
      <main className="flex-1">
        <Hero />
        <LiveTicker />
        <section id="features">
          <HowItWorks />
        </section>
        <section id="leaderboard">
          <LeaderboardPreview />
        </section>
        <section id="strategies">
          <StrategyFamilies />
        </section>
        <Stats />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
