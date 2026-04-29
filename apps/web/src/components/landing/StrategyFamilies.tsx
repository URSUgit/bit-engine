import {
  TrendingUp,
  Repeat,
  Scale,
  Brain,
  Activity,
  Globe2,
} from "lucide-react";

const families = [
  {
    icon: TrendingUp,
    name: "Momentum",
    description:
      "Ride established trends with breakout, donchian-channel, and moving-average crossover engines tuned for crypto volatility.",
    indicators: ["EMA Cross", "ADX > 25", "Volume Confirm"],
    avgReturn: "+38%",
    activeStrategies: 142,
    color: "from-cyan-500/20 to-blue-500/5",
    accent: "text-cyan-400",
  },
  {
    icon: Repeat,
    name: "Mean Reversion",
    description:
      "Fade overextended moves with RSI, Bollinger, and z-score reversal models. Excels in range-bound regimes and altcoin chop.",
    indicators: ["RSI < 30", "BB Width", "Z-Score"],
    avgReturn: "+24%",
    activeStrategies: 89,
    color: "from-violet-500/20 to-purple-500/5",
    accent: "text-violet-400",
  },
  {
    icon: Scale,
    name: "Arbitrage",
    description:
      "Cross-exchange spot/perp basis trades, funding-rate harvesting, and triangular DEX arb with sub-second execution.",
    indicators: ["Basis > 0.5%", "Funding Δ", "Spread"],
    avgReturn: "+12%",
    activeStrategies: 56,
    color: "from-emerald-500/20 to-teal-500/5",
    accent: "text-emerald-400",
  },
  {
    icon: Brain,
    name: "Sentiment",
    description:
      "FinBERT-scored Twitter, Reddit, and Telegram chatter — front-run narrative shifts before they hit price.",
    indicators: ["FinBERT > 0.8", "Mentions", "Velocity"],
    avgReturn: "+47%",
    activeStrategies: 73,
    color: "from-amber-500/20 to-orange-500/5",
    accent: "text-amber-400",
  },
  {
    icon: Activity,
    name: "On-chain",
    description:
      "Whale wallet tracking, exchange inflows, smart-money signals — quantitative alpha from immutable on-chain state.",
    indicators: ["Whale Flow", "Exchange In", "Smart $"],
    avgReturn: "+52%",
    activeStrategies: 104,
    color: "from-pink-500/20 to-rose-500/5",
    accent: "text-pink-400",
  },
  {
    icon: Globe2,
    name: "Macro",
    description:
      "FOMC, CPI, ETF flows, equity correlations — trade BTC and ETH against rates, dollar strength, and risk-on/off regimes.",
    indicators: ["DXY", "Rates", "ETF Flows"],
    avgReturn: "+19%",
    activeStrategies: 41,
    color: "from-blue-500/20 to-indigo-500/5",
    accent: "text-blue-400",
  },
];

export function StrategyFamilies() {
  return (
    <section className="relative py-24 px-4 sm:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-cyan-400 text-xs font-bold uppercase tracking-[0.2em] mb-3">Strategy Families</p>
          <h2 className="text-3xl sm:text-5xl font-bold text-slate-50 mb-4 tracking-tight">
            Six engines. <span className="text-gradient-static">One platform.</span>
          </h2>
          <p className="text-slate-400 max-w-2xl mx-auto">
            Pick a strategy archetype, tune parameters in the lab, and deploy — or let the platform run them in
            multi-strategy ensembles.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {families.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.name}
                className="group relative card-dark glow-card p-6 hover:border-slate-700 transition-all duration-200 cursor-pointer"
              >
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${f.color} rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`}
                />

                <div className="relative">
                  <div className="flex items-start justify-between mb-5">
                    <div className={`w-11 h-11 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center`}>
                      <Icon className={`w-5 h-5 ${f.accent}`} />
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-bold ${f.accent} number-font`}>{f.avgReturn}</div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider">avg 30d</div>
                    </div>
                  </div>

                  <h3 className="text-lg font-bold text-slate-100 mb-2.5">{f.name}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-5 min-h-[3.5rem]">{f.description}</p>

                  <div className="flex flex-wrap gap-1.5 mb-5">
                    {f.indicators.map((ind) => (
                      <span
                        key={ind}
                        className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800/80 text-slate-400 border border-slate-700/50"
                      >
                        {ind}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-slate-800/60">
                    <span className="text-xs text-slate-500">
                      <span className="text-slate-300 font-semibold number-font">{f.activeStrategies}</span> active
                    </span>
                    <span className="text-xs text-cyan-400 group-hover:text-cyan-300 font-medium">
                      Explore →
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
