import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useTraders(params?: Record<string, string>) {
  return useQuery({
    queryKey: ["traders", params],
    queryFn: () => api.traders.list(params),
    staleTime: 30_000,
  });
}

export function useTrader(id: string) {
  return useQuery({
    queryKey: ["traders", id],
    queryFn: () => api.traders.get(id),
    enabled: !!id,
    staleTime: 30_000,
  });
}
