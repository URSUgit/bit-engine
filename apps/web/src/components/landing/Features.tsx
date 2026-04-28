import { Zap, BrainCircuit, BarChart3, ShieldCheck, Wallet, FlaskConical } from "lucide-react";

const features = [
  {
    icon: Zap,
    title: "Real-Time Copy Trading",
    description:
      "Mirror elite traders' positions on Hyperliquid and Polymarket with sub-second latency. Set size limits, stop-loss, and max drawdown per trader.",
    tag: "Core",
  },
  {
    icon: BrainCircuit,
    title: "AI Signal Intelligence",
    description:
      "FinBERT-powered sentiment analysis across Twitter, Reddit, and Telegram. Receive scored, ranked signals with confidence levels before the crowd.",
    tag: "AI",
  },
  {
    icon: FlaskConical,
    title: "Strategy Lab",
    description:
      "Backtest strategies against 3 years of tick-level data stored in TimescaleDB. Drag-and-drop signal builder with no-code and pro-code modes.",
    tag: "Pro",
  },
  {
    icon: BarChart3,
    title: "Institutional Analytics",
    description:
      "On-chain order flow, whale wallet tracking, funding rate arbitrage signals, and cross-market correlation heatmaps — in real time.",
    tag: "Analytics",
  },
  {
    icon: Wallet,
    title: "Non-Custodial Wallet",
    description:
      "Connect any EVM wallet via WalletConnect or injected provider. Your keys, your funds. BitPrivat never has custody of your assets.",
    tag: "Security",
  },
  {
    icon: ShieldCheck,
    title: "Risk Engine",
    description:
      "Per-position, per-trader, and portfolio-level risk controls enforced by the Rust trading engine. Circuit breakers, drawdown guards, and position sizing.",
    tag: "Risk",
  },
];

export function Features() {
  return (
    <section className="py-20 px-4 sm:px-8">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-50 mb-4">
            Everything You Need to Trade at the{" "}
            <span className="text-gradient-cyan">Highest Level</span>
          </h2>
          <p className="text-zinc-400 max-w-xl mx-auto">
            BitPrivat combines institutional infrastructure with a consumer-grade UX — so anyone can trade like a pro.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map(({ icon: Icon, title, description, tag }) => (
            <div
              key={title}
              className="group p-6 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-cyan-500/30 hover:bg-zinc-900/80 transition-all duration-200"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20">
                  <Icon className="w-5 h-5 text-cyan-400" />
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 bg-zinc-800 rounded-full px-2 py-0.5">
                  {tag}
                </span>
              </div>
              <h3 className="text-base font-semibold text-zinc-100 mb-2">{title}</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
