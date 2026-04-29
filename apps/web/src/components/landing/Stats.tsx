import { Award, Building2, Globe, Shield } from "lucide-react";

const proofItems = [
  {
    icon: Building2,
    label: "Trusted by",
    value: "12,800+",
    sub: "professional traders",
  },
  {
    icon: Globe,
    label: "Volume routed",
    value: "$2.4B",
    sub: "in the last 30 days",
  },
  {
    icon: Award,
    label: "Top-decile",
    value: "94.2%",
    sub: "win rate (top 10 traders)",
  },
  {
    icon: Shield,
    label: "Non-custodial",
    value: "100%",
    sub: "of funds remain in your wallet",
  },
];

const partnerLogos = ["Hyperliquid", "Polymarket", "Drift", "GMX", "Aevo", "dYdX"];

export function Stats() {
  return (
    <section className="relative py-24 px-4 sm:px-8 border-t border-slate-800/60 bg-slate-900/30">
      <div className="max-w-6xl mx-auto">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
          {proofItems.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="card-dark p-6 text-center">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mx-auto mb-4">
                  <Icon className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="text-xs text-slate-500 uppercase tracking-widest font-medium mb-1">
                  {item.label}
                </div>
                <div className="text-3xl font-bold text-slate-50 number-font tracking-tight mb-1">
                  {item.value}
                </div>
                <div className="text-xs text-slate-400">{item.sub}</div>
              </div>
            );
          })}
        </div>

        <div className="text-center">
          <p className="text-xs text-slate-500 uppercase tracking-widest mb-6">
            Connected to leading DeFi protocols
          </p>
          <div className="flex flex-wrap justify-center items-center gap-x-10 gap-y-4">
            {partnerLogos.map((name) => (
              <span
                key={name}
                className="text-lg font-semibold text-slate-600 hover:text-slate-400 transition-colors"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
