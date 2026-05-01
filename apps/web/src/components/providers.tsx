"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, type State } from "wagmi";
import { SessionProvider } from "next-auth/react";
import { useState } from "react";
import { wagmiConfig } from "@/lib/wallet";

interface ProvidersProps {
  children: React.ReactNode;
  initialWagmiState?: State;
}

export function Providers({ children, initialWagmiState }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
        },
      })
  );

  return (
    <SessionProvider>
      <WagmiProvider config={wagmiConfig} initialState={initialWagmiState}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiProvider>
    </SessionProvider>
  );
}
