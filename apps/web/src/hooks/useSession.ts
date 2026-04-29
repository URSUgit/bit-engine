"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount, useDisconnect, useSignMessage } from "wagmi";
import {
  signInWithEthereum,
  saveSession,
  loadSession,
  clearSession,
  type SiweSession,
} from "@/lib/siwe";

interface UseSessionResult {
  session: SiweSession | null;
  isAuthenticating: boolean;
  signIn: () => Promise<void>;
  signOut: () => void;
  error: string | null;
}

export function useSession(): UseSessionResult {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [session, setSession] = useState<SiweSession | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from localStorage on mount; clear if wallet address mismatches.
  useEffect(() => {
    const existing = loadSession();
    if (!existing) return;
    if (address && existing.address.toLowerCase() !== address.toLowerCase()) {
      clearSession();
      return;
    }
    setSession(existing);
  }, [address]);

  const signIn = useCallback(async () => {
    if (!address || !isConnected) {
      setError("Connect a wallet first");
      return;
    }
    setIsAuthenticating(true);
    setError(null);
    try {
      const s = await signInWithEthereum({ address, signMessageAsync });
      saveSession(s);
      setSession(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsAuthenticating(false);
    }
  }, [address, isConnected, signMessageAsync]);

  const signOut = useCallback(() => {
    clearSession();
    setSession(null);
    disconnect();
  }, [disconnect]);

  return { session, isAuthenticating, signIn, signOut, error };
}
