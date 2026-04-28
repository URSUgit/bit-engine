import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface Position {
  id: string;
  asset: string;
  side: "long" | "short";
  size: number;
  entry: number;
  current: number;
  pnl: number;
  pnlPct: number;
  protocol: string;
}

interface PortfolioState {
  totalValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  positions: Position[];
  isLoading: boolean;
  error: string | null;
  setPositions: (positions: Position[]) => void;
  setTotals: (value: number, unrealized: number, realized: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const usePortfolioStore = create<PortfolioState>()(
  devtools(
    (set) => ({
      totalValue: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      positions: [],
      isLoading: false,
      error: null,
      setPositions: (positions) => set({ positions }),
      setTotals: (totalValue, unrealizedPnl, realizedPnl) =>
        set({ totalValue, unrealizedPnl, realizedPnl }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
    }),
    { name: "portfolio-store" }
  )
);
