import { Hero } from "@/components/landing/Hero";
import { Stats } from "@/components/landing/Stats";
import { Features } from "@/components/landing/Features";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LeaderboardPreview } from "@/components/landing/LeaderboardPreview";
import { CTA } from "@/components/landing/CTA";
import { LandingNav } from "@/components/landing/LandingNav";
import { Footer } from "@/components/layout/Footer";

export const metadata = {
  title: "BitPrivat — Trade Like the Top 1%",
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <LandingNav />
      <main className="flex-1">
        <Hero />
        <Stats />
        <Features />
        <HowItWorks />
        <LeaderboardPreview />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
