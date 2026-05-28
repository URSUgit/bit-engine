import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export type SourceStatus = {
  name: string;
  label: string;
  status: "live" | "degraded" | "error" | "unconfigured";
  latency_ms: number | null;
  detail: string;
  checked_at: string;
};

async function probe(
  name: string,
  label: string,
  fn: () => Promise<string>,
): Promise<SourceStatus> {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return {
      name, label,
      status: "live",
      latency_ms: Date.now() - t0,
      detail,
      checked_at: new Date().toISOString(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name, label,
      status: "error",
      latency_ms: Date.now() - t0,
      detail: msg.slice(0, 120),
      checked_at: new Date().toISOString(),
    };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

async function checkBinance(): Promise<SourceStatus> {
  return probe("binance", "Binance (crypto prices)", async () => {
    const r = await withTimeout(
      fetch("https://api.binance.com/api/v3/ping", {
        headers: { "User-Agent": "Mozilla/5.0" },
      }),
      4000
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return "Reachable";
  });
}

async function checkSignalService(): Promise<SourceStatus> {
  const base = process.env.SIGNAL_SERVICE_URL ?? "http://localhost:8001";
  return probe("signal_service", "Signal Service (AI engine)", async () => {
    const r = await withTimeout(fetch(`${base}/health`), 4000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return `${d.status ?? "ok"} · v${d.version ?? "?"}`;
  });
}

async function checkCoinGecko(): Promise<SourceStatus> {
  return probe("coingecko", "CoinGecko (market caps)", async () => {
    const r = await withTimeout(
      fetch("https://api.coingecko.com/api/v3/ping", {
        headers: { "User-Agent": "Mozilla/5.0" },
      }),
      4000
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return "Reachable";
  });
}

async function checkCryptoCompare(): Promise<SourceStatus> {
  return probe("cryptocompare", "CryptoCompare (news feed)", async () => {
    const r = await withTimeout(
      fetch("https://min-api.cryptocompare.com/data/v2/news/?lang=EN&limit=1", {
        headers: { "User-Agent": "Mozilla/5.0" },
      }),
      4000
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json() as { Type?: number };
    if (d.Type !== 100) throw new Error("API returned error");
    return "Reachable";
  });
}

function checkEnvKey(name: string, label: string, envVar: string): SourceStatus {
  const key = process.env[envVar];
  if (!key || key === "demo" || key.length < 4) {
    return {
      name, label,
      status: "unconfigured",
      latency_ms: null,
      detail: `${envVar} not set`,
      checked_at: new Date().toISOString(),
    };
  }
  return {
    name, label,
    status: "live",
    latency_ms: null,
    detail: "Key configured",
    checked_at: new Date().toISOString(),
  };
}

export async function GET() {
  const [binance, signalSvc, coinGecko, cryptoCompare] = await Promise.all([
    checkBinance(),
    checkSignalService(),
    checkCoinGecko(),
    checkCryptoCompare(),
  ]);

  const alphaVantage = checkEnvKey(
    "alpha_vantage", "Alpha Vantage (stocks/FX)", "ALPHA_VANTAGE_API_KEY"
  );
  const fred = checkEnvKey(
    "fred", "FRED (macro/economic)", "FRED_API_KEY"
  );
  const oxr = checkEnvKey(
    "oxr", "OpenExchangeRates (forex)", "OPEN_EXCHANGE_RATES_APP_ID"
  );
  const finnhub = checkEnvKey(
    "finnhub", "Finnhub (earnings/profile)", "FINNHUB_API_KEY"
  );
  const twelveData = checkEnvKey(
    "twelve_data", "Twelve Data (global stocks)", "TWELVE_DATA_API_KEY"
  );

  const sources: SourceStatus[] = [
    binance, signalSvc, coinGecko, cryptoCompare,
    alphaVantage, fred, oxr, finnhub, twelveData,
  ];

  const liveCount = sources.filter((s) => s.status === "live").length;
  const errorCount = sources.filter((s) => s.status === "error").length;

  const overall =
    errorCount > 0 ? "degraded"
    : liveCount === sources.length ? "live"
    : "partial";

  return NextResponse.json({ overall, sources, checked_at: new Date().toISOString() });
}
