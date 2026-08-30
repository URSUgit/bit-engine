import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UIMode = "simple" | "pro";

interface UIModeState {
  mode: UIMode;
  setMode: (mode: UIMode) => void;
  toggleMode: () => void;
}

export const useUIModeStore = create<UIModeState>()(
  persist(
    (set) => ({
      mode: "simple",
      setMode: (mode) => set({ mode }),
      toggleMode: () => set((state) => ({ mode: state.mode === "simple" ? "pro" : "simple" })),
    }),
    { name: "bitprivat-ui-mode" }
  )
);

export function usePro(): boolean {
  return useUIModeStore((s) => s.mode === "pro");
}
