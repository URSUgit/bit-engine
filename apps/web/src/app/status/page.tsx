import type { Metadata } from "next";

export const metadata: Metadata = { title: "System Status | BitPrivat" };

const services = [
  { name: "API Gateway", status: "operational", latency: "12ms" },
  { name: "Trading Engine", status: "operational", latency: "4ms" },
  { name: "Signal Service", status: "operational", latency: "38ms" },
  { name: "WebSocket Feed", status: "operational", latency: "8ms" },
  { name: "TimescaleDB", status: "operational", latency: "2ms" },
  { name: "MongoDB", status: "operational", latency: "3ms" },
  { name: "Redis Cache", status: "operational", latency: "1ms" },
  { name: "Kafka", status: "degraded", latency: "95ms" },
];

const statusConfig = {
  operational: { dot: "bg-green-500", label: "Operational", text: "text-green-400" },
  degraded: { dot: "bg-yellow-500", label: "Degraded", text: "text-yellow-400" },
  outage: { dot: "bg-red-500", label: "Outage", text: "text-red-400" },
} as const;

export default function StatusPage() {
  const allOperational = services.every((s) => s.status === "operational");

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <div
            className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium mb-6 ${
              allOperational
                ? "bg-green-500/10 text-green-400 border border-green-500/20"
                : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full animate-pulse ${allOperational ? "bg-green-500" : "bg-yellow-500"}`}
            />
            {allOperational ? "All Systems Operational" : "Partial Degradation"}
          </div>
          <h1 className="text-3xl font-bold">BitPrivat System Status</h1>
          <p className="text-zinc-400 mt-2">Real-time status for all platform components</p>
        </div>

        <div className="flex flex-col gap-2">
          {services.map((service) => {
            const cfg = statusConfig[service.status as keyof typeof statusConfig];
            return (
              <div
                key={service.name}
                className="flex items-center justify-between px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                  <span className="text-sm font-medium text-zinc-200">{service.name}</span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-zinc-500 font-mono">{service.latency}</span>
                  <span className={cfg.text}>{cfg.label}</span>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-zinc-600 mt-8">
          Updated every 30 seconds · Subscribe to{" "}
          <a href="#" className="text-cyan-500 hover:underline">
            status updates
          </a>
        </p>
      </div>
    </div>
  );
}
