import type { Metadata } from "next";
import { Footer } from "@/components/layout/Footer";

export const metadata: Metadata = { title: "Terms of Service | BitPrivat" };

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <main className="flex-1 max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold text-zinc-50 mb-2">Terms of Service</h1>
        <p className="text-zinc-400 text-sm mb-10">Last updated: June 2024</p>

        <div className="prose prose-invert prose-zinc max-w-none">
          {[
            {
              title: "1. Acceptance of Terms",
              body: "By accessing and using BitPrivat, you accept and agree to be bound by the terms and provisions of this agreement. If you do not agree to these terms, please do not use our platform.",
            },
            {
              title: "2. Description of Service",
              body: "BitPrivat provides a professional cryptocurrency copy-trading platform that enables users to follow and replicate the trading strategies of experienced traders. The service is provided 'as is' and BitPrivat reserves the right to modify or discontinue it at any time.",
            },
            {
              title: "3. Risk Disclosure",
              body: "Cryptocurrency trading involves significant risk of loss. Past performance of any trader or strategy does not guarantee future results. You should never invest more than you can afford to lose. BitPrivat does not provide financial advice.",
            },
            {
              title: "4. Eligibility",
              body: "You must be at least 18 years of age to use this service. By using BitPrivat, you represent and warrant that you have the legal capacity to enter into a binding agreement.",
            },
            {
              title: "5. Account Security",
              body: "You are responsible for maintaining the confidentiality of your account credentials. You agree to notify BitPrivat immediately of any unauthorized use of your account.",
            },
            {
              title: "6. Prohibited Activities",
              body: "You may not use the platform for market manipulation, wash trading, front-running, or any activity that violates applicable laws and regulations.",
            },
          ].map(({ title, body }) => (
            <section key={title} className="mb-8">
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
