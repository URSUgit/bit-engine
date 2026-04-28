const steps = [
  {
    number: "01",
    title: "Connect Your Wallet",
    description:
      "Link any EVM wallet via WalletConnect or MetaMask. No sign-up required for public features. No funds leave your wallet until you trade.",
  },
  {
    number: "02",
    title: "Browse the Leaderboard",
    description:
      "Explore verified on-chain performance of thousands of traders. Filter by protocol, ROI, Sharpe ratio, drawdown, and trading style.",
  },
  {
    number: "03",
    title: "Configure Copy Parameters",
    description:
      "Set per-trader allocation, position sizing, stop-loss, and max daily loss. The risk engine enforces your limits in real time.",
  },
  {
    number: "04",
    title: "Let the Engine Trade",
    description:
      "Our Rust-based trading engine replicates positions in under 400ms across Hyperliquid and Polymarket. You monitor, it executes.",
  },
];

export function HowItWorks() {
  return (
    <section className="py-20 px-4 sm:px-8 bg-zinc-900/30">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-50 mb-4">How It Works</h2>
          <p className="text-zinc-400 max-w-lg mx-auto">
            From wallet connect to automated copy trading in under 5 minutes.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map(({ number, title, description }) => (
            <div key={number} className="relative">
              <div className="text-5xl font-black text-zinc-800 mb-3 number-font">{number}</div>
              <h3 className="text-base font-semibold text-zinc-100 mb-2">{title}</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
