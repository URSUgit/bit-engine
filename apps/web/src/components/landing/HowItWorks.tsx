import { Wallet, Users, Bot, ArrowRight } from "lucide-react";

const steps = [
  {
    number: "01",
    icon: Wallet,
    title: "Connect Wallet",
    description:
      "Link any EVM wallet via WalletConnect, MetaMask, or Coinbase. Your keys stay with you — BitPrivat never has custody of your funds.",
    details: ["No KYC required", "300+ wallets supported", "Read-only by default"],
  },
  {
    number: "02",
    icon: Users,
    title: "Follow Traders",
    description:
      "Browse the verified on-chain leaderboard. Filter by ROI, Sharpe, drawdown, and risk level. Follow the traders that match your style.",
    details: ["Verified P&L on-chain", "Risk-graded profiles", "Live position transparency"],
  },
  {
    number: "03",
    icon: Bot,
    title: "Automate",
    description:
      "Configure copy parameters and let our Rust trading engine replicate positions in under 400ms. Deploy your own AI signals or backtested strategies.",
    details: ["Sub-400ms latency", "Risk-managed sizing", "Deploy custom strategies"],
  },
];

export function HowItWorks() {
  return (
    <section className="relative py-24 px-4 sm:px-8 border-t border-slate-800/60">
      <div className="absolute inset-0 grid-pattern opacity-30 pointer-events-none" />

      <div className="relative max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-cyan-400 text-xs font-bold uppercase tracking-[0.2em] mb-3">How It Works</p>
          <h2 className="text-3xl sm:text-5xl font-bold text-slate-50 mb-4 tracking-tight">
            Three steps to <span className="text-gradient-static">automated alpha</span>
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">
            From wallet connect to live copy-trading in under five minutes.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6 lg:gap-4 relative">
          {steps.map((step, i) => {
            const Icon = step.icon;
            const isLast = i === steps.length - 1;
            return (
              <div key={step.number} className="relative">
                <div className="card-dark glow-card p-7 h-full flex flex-col">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/10 border border-cyan-500/30 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-cyan-400" />
                      </div>
                      <span className="text-3xl font-black text-slate-800 number-font tracking-tight">
                        {step.number}
                      </span>
                    </div>
                  </div>

                  <h3 className="text-xl font-bold text-slate-100 mb-3">{step.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-5">{step.description}</p>

                  <ul className="mt-auto flex flex-col gap-1.5">
                    {step.details.map((d) => (
                      <li key={d} className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="w-1 h-1 rounded-full bg-cyan-500" />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>

                {!isLast && (
                  <div className="hidden lg:flex absolute top-1/2 -right-3 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-slate-900 border border-slate-700 items-center justify-center">
                    <ArrowRight className="w-3 h-3 text-cyan-400" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
