import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import { cookieToInitialState } from "wagmi";
import "./globals.css";
import { Providers } from "@/components/providers";
import { wagmiConfig } from "@/lib/wallet";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "BitPrivat | Professional Crypto Trading Platform",
    template: "%s | BitPrivat",
  },
  description:
    "Copy-trade elite DeFi traders, harness AI-powered signals, and deploy automated strategies with institutional-grade tools.",
  keywords: ["crypto trading", "copy trading", "DeFi", "trading signals", "Hyperliquid", "Polymarket"],
  authors: [{ name: "BitPrivat" }],
  openGraph: {
    type: "website",
    locale: "en_US",
    title: "BitPrivat | Professional Crypto Trading Platform",
    description: "Copy-trade elite DeFi traders with AI-powered signals.",
    siteName: "BitPrivat",
  },
  twitter: {
    card: "summary_large_image",
    title: "BitPrivat",
    description: "Copy-trade elite DeFi traders with AI-powered signals.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#00d4e0",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookie = (await headers()).get("cookie");
  const initialWagmiState = cookieToInitialState(wagmiConfig, cookie);

  return (
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className="bg-zinc-950 text-zinc-50 antialiased font-[var(--font-inter)] min-h-screen">
        <Providers initialWagmiState={initialWagmiState}>{children}</Providers>
      </body>
    </html>
  );
}
