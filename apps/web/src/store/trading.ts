import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface CopyConfig {
  traderId: string;
  allocationUsdc: number;
  maxPositionSizeUsdc: number;
  stopLossPct: number;
  maxDailyLossPct: number;
}

interface TradingState {
  activeCopies: Record<string, CopyConfig>;
  selectedMarket: string;
  selectedTimeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  setMarket: (market: string) => void;
  setTimeframe: (tf: TradingState["selectedTimeframe"]) => void;
  startCopy: (config: CopyConfig) => void;
  stopCopy: (traderId: string) => void;
}

export const useTradingStore = create<TradingState>()(
  devtools(
    (set) => ({
      activeCopies: {},
      selectedMarket: "ETH-USD",
      selectedTimeframe: "1h",
      setMarket: (selectedMarket) => set({ selectedMarket }),
      setTimeframe: (selectedTimeframe) => set({ selectedTimeframe }),
      startCopy: (config) =>
        set((state) => ({
          activeCopies: { ...state.activeCopies, [config.traderId]: config },
        })),
      stopCopy: (traderId) =>
        set((state) => {
          const { [traderId]: _, ...rest } = state.activeCopies;
          return { activeCopies: rest };
        }),
    }),
    { name: "trading-store" }
  )
);
