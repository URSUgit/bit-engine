/**
 * Paper trading engine — localStorage backed, fills at real market prices.
 * No real money, no exchange API key required.
 */

export type PaperSide = "long" | "short";
export type PaperStatus = "open" | "closed";

export interface PaperPosition {
  id: string;
  symbol: string;
  side: PaperSide;
  size_usd: number;       // notional in USD
  entry_price: number;
  leverage: number;
  take_profit: number | null;
  stop_loss: number | null;
  opened_at: string;
  status: PaperStatus;
  close_price: number | null;
  closed_at: string | null;
  pnl: number | null;
  pnl_pct: number | null;
}

export interface PaperState {
  balance: number;
  positions: PaperPosition[];
}

const STORAGE_KEY = "bitprivat_paper_trading";
const DEFAULT_BALANCE = 10_000;

export function loadState(): PaperState {
  if (typeof window === "undefined") return { balance: DEFAULT_BALANCE, positions: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { balance: DEFAULT_BALANCE, positions: [] };
}

export function saveState(state: PaperState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function calcUnrealizedPnl(pos: PaperPosition, currentPrice: number): { pnl: number; pnl_pct: number; liq_price: number } {
  const direction = pos.side === "long" ? 1 : -1;
  const pnl_pct = ((currentPrice / pos.entry_price - 1) * direction) * pos.leverage * 100;
  const pnl = pos.size_usd * (pnl_pct / 100);
  // Simplified liquidation: price that would wipe out margin (1/leverage away from entry)
  const margin_pct = 1 / pos.leverage;
  const liq_price = pos.side === "long"
    ? pos.entry_price * (1 - margin_pct * 0.9)
    : pos.entry_price * (1 + margin_pct * 0.9);
  return { pnl, pnl_pct, liq_price };
}

export function openPosition(
  state: PaperState,
  params: {
    symbol: string;
    side: PaperSide;
    size_usd: number;
    entry_price: number;
    leverage: number;
    take_profit?: number | null;
    stop_loss?: number | null;
  }
): { state: PaperState; position: PaperPosition; error?: string } {
  const margin = params.size_usd / params.leverage;
  if (margin > state.balance) {
    return { state, position: null!, error: `Insufficient balance. Need $${margin.toFixed(2)}, have $${state.balance.toFixed(2)}` };
  }

  const position: PaperPosition = {
    id: `pos_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    symbol: params.symbol,
    side: params.side,
    size_usd: params.size_usd,
    entry_price: params.entry_price,
    leverage: params.leverage,
    take_profit: params.take_profit ?? null,
    stop_loss: params.stop_loss ?? null,
    opened_at: new Date().toISOString(),
    status: "open",
    close_price: null,
    closed_at: null,
    pnl: null,
    pnl_pct: null,
  };

  const newState: PaperState = {
    balance: state.balance - margin,
    positions: [position, ...state.positions],
  };

  return { state: newState, position };
}

export function closePosition(
  state: PaperState,
  positionId: string,
  closePrice: number,
): PaperState {
  const positions = state.positions.map((p) => {
    if (p.id !== positionId || p.status !== "open") return p;
    const { pnl, pnl_pct } = calcUnrealizedPnl(p, closePrice);
    const margin = p.size_usd / p.leverage;
    return {
      ...p,
      status: "closed" as PaperStatus,
      close_price: closePrice,
      closed_at: new Date().toISOString(),
      pnl: parseFloat(pnl.toFixed(2)),
      pnl_pct: parseFloat(pnl_pct.toFixed(2)),
    };
  });

  const closedPos = positions.find((p) => p.id === positionId);
  const refund = closedPos
    ? closedPos.size_usd / closedPos.leverage + (closedPos.pnl ?? 0)
    : 0;

  return { balance: state.balance + refund, positions };
}

export function checkAutoClose(state: PaperState, prices: Record<string, number>): PaperState {
  let changed = false;
  let balance = state.balance;

  const positions = state.positions.map((p) => {
    if (p.status !== "open") return p;
    const price = prices[p.symbol.toUpperCase()];
    if (!price) return p;

    const shouldTP = p.take_profit && (
      p.side === "long" ? price >= p.take_profit : price <= p.take_profit
    );
    const shouldSL = p.stop_loss && (
      p.side === "long" ? price <= p.stop_loss : price >= p.stop_loss
    );
    const { pnl, pnl_pct, liq_price } = calcUnrealizedPnl(p, price);
    const shouldLiq = p.side === "long" ? price <= liq_price : price >= liq_price;

    if (shouldTP || shouldSL || shouldLiq) {
      changed = true;
      const margin = p.size_usd / p.leverage;
      balance += shouldLiq ? 0 : margin + pnl;
      return {
        ...p,
        status: "closed" as PaperStatus,
        close_price: price,
        closed_at: new Date().toISOString(),
        pnl: shouldLiq ? -margin : parseFloat(pnl.toFixed(2)),
        pnl_pct: shouldLiq ? -100 : parseFloat(pnl_pct.toFixed(2)),
      };
    }
    return p;
  });

  return changed ? { balance, positions } : state;
}
