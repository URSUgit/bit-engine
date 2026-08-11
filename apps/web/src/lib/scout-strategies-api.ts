/**
 * Client for the persistent "extracted strategies" list Scout builds from
 * every analyzed video (background poll + manual analyze alike). Routed
 * through the same `/api/v1/scout` proxy path the rest of Scout's frontend
 * already uses (see apps/web/src/app/lab/scout/analysis-card.tsx `api()`).
 */

export interface ExtractedStrategy {
  id: number;
  video_id: string;
  video_title: string;
  video_url: string;
  added_at: number;
  edited: boolean;
  edited_at: number | null;
  name: string;
  trader: string;
  strategy: string;
  label: string;
  why: string;
  params: Record<string, number>;
  pairs: string[];
  position_pct: number | null;
  risk_pct: number | null;
  stop_loss_pct: number | null;
  take_profit_pct: number | null;
  leverage: number | null;
}

export type StrategyPatch = Partial<
  Pick<
    ExtractedStrategy,
    "name" | "params" | "pairs" | "position_pct" | "risk_pct" | "stop_loss_pct" | "take_profit_pct" | "leverage"
  >
>;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/scout${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status}`);
  }
  return res.json();
}

export const scoutStrategiesApi = {
  list: () => call<ExtractedStrategy[]>("/strategies"),
  update: (id: number, patch: StrategyPatch) =>
    call<ExtractedStrategy>(`/strategies/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: number) => call<{ removed: number }>(`/strategies/${id}`, { method: "DELETE" }),
};

/** Extracted pairs use Yahoo/CoinMetrics-style tickers (BTC-USD); the
 * backtester's crypto catalog uses Binance-style (BTCUSDT). Best-effort
 * convert so "Load" pre-fills a symbol that actually exists in the catalog;
 * anything that isn't a plain "-USD" crypto pair (stocks, futures) passes
 * through unchanged for the user to adjust manually. */
export function toBacktestSymbol(pair: string): string {
  const m = /^([A-Z0-9]+)-USD$/.exec(pair);
  return m ? `${m[1]}USDT` : pair;
}
