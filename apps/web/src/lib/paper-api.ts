/**
 * Paper trading API client — talks to /api/v1/paper/* via the Next.js proxy.
 */

const BASE = "/api/v1/paper";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type PaperPosition = {
  id: string;
  symbol: string;
  side: "long" | "short";
  entry_price: number;
  size: number;
  notional: number;
  opened_at: string;
  strategy: string;
  notes: string;
  current_price: number;
  current_pnl: number;
  current_pnl_pct: number;
  roe_pct: number;
};

export type PaperTrade = {
  id: string;
  symbol: string;
  side: "long" | "short";
  entry_price: number;
  exit_price: number;
  size: number;
  pnl: number;
  pnl_pct: number;
  opened_at: string;
  closed_at: string;
  strategy: string;
  notes: string;
};

export type PaperSummary = {
  total_pnl: number;
  total_trades: number;
  win_rate: number;
  open_positions: number;
  balance_start: number;
  balance_current: number;
};

export type OpenPositionParams = {
  symbol: string;
  side: "long" | "short";
  entry_price: number;
  size: number;
  strategy?: string;
  notes?: string;
};

export const paperApi = {
  listPositions(): Promise<PaperPosition[]> {
    return call<PaperPosition[]>("/positions");
  },

  openPosition(params: OpenPositionParams): Promise<PaperPosition> {
    return call<PaperPosition>("/positions", {
      method: "POST",
      body: JSON.stringify(params),
    });
  },

  closePosition(id: string, exitPrice: number): Promise<PaperTrade> {
    return call<PaperTrade>(`/positions/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ exit_price: exitPrice }),
    });
  },

  listTrades(): Promise<PaperTrade[]> {
    return call<PaperTrade[]>("/trades");
  },

  getSummary(): Promise<PaperSummary> {
    return call<PaperSummary>("/summary");
  },

  updateNote(id: string, notes: string): Promise<{ ok: boolean }> {
    return call<{ ok: boolean }>(`/positions/${id}/note`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    });
  },
};
