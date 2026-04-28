import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { api } from "@/lib/api";

export function usePortfolio() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  return useQuery({
    queryKey: ["portfolio", token],
    queryFn: () => api.portfolio.get(token!),
    enabled: !!token,
    staleTime: 15_000,
  });
}

export function usePositions() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  return useQuery({
    queryKey: ["positions", token],
    queryFn: () => api.portfolio.positions(token!),
    enabled: !!token,
    refetchInterval: 10_000,
  });
}
