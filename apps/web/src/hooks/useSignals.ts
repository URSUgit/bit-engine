import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useSignals(params?: Record<string, string>) {
  return useQuery({
    queryKey: ["signals", params],
    queryFn: () => api.signals.list(params),
    refetchInterval: 15_000,
  });
}

export function useLatestSignals() {
  return useQuery({
    queryKey: ["signals", "latest"],
    queryFn: () => api.signals.latest(),
    refetchInterval: 10_000,
  });
}
