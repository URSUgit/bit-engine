const stats = [
  { value: "12,847", label: "Active Traders" },
  { value: "$2.4B", label: "Total Volume (30d)" },
  { value: "94.2%", label: "Avg Win Rate (Top 10)" },
  { value: "340ms", label: "Engine Latency" },
  { value: "47", label: "Markets Supported" },
  { value: "3.8×", label: "Avg Copy Return" },
];

export function Stats() {
  return (
    <section className="border-y border-zinc-800 bg-zinc-900/50 py-10 px-4">
      <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 text-center">
        {stats.map(({ value, label }) => (
          <div key={label} className="flex flex-col gap-1">
            <span className="text-2xl font-bold text-zinc-50 number-font">{value}</span>
            <span className="text-xs text-zinc-500">{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
