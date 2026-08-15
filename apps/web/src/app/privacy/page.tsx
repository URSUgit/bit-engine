import type { Metadata } from "next";
import { Footer } from "@/components/layout/Footer";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <main className="flex-1 max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold text-zinc-50 mb-2">Privacy Policy</h1>
        <p className="text-zinc-400 text-sm mb-10">Last updated: June 2024</p>

        <div className="flex flex-col gap-8">
          {[
            {
              title: "Information We Collect",
              body: "We collect wallet addresses, on-chain transaction data, trading preferences, and usage analytics. We do not collect or store private keys under any circumstances.",
            },
            {
              title: "How We Use Your Information",
              body: "Your data is used to provide and improve the platform, personalize your experience, generate trading signals, and calculate leaderboard rankings. We do not sell your personal data to third parties.",
            },
            {
              title: "On-Chain Data",
              body: "Blockchain transactions are public by nature. BitPrivat indexes public on-chain data to power its analytics and signal services. This is not personal data collection — it is analysis of publicly available blockchain state.",
            },
            {
              title: "Data Security",
              body: "We implement industry-standard encryption and security practices. All API communications are TLS-encrypted. We conduct regular security audits and penetration testing.",
            },
            {
              title: "Your Rights",
              body: "You may request deletion of your account and associated off-chain data at any time. On-chain data cannot be deleted as it is immutable by design.",
            },
            {
              title: "Contact",
              body: "For privacy-related inquiries, contact privacy@bitprivat.io.",
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
