/**
 * Sign-In With Ethereum (EIP-4361 inspired, simplified for our flow):
 *
 * 1. Frontend asks /api/auth/siwe/nonce for a single-use nonce (DB-stored,
 *    10-minute TTL, keyed to the address).
 * 2. Frontend builds a message containing domain + address + nonce + issuedAt.
 * 3. Wallet signs message via personal_sign (EIP-191).
 * 4. NextAuth's `siwe` credentials provider verifies SERVER-SIDE: signature
 *    recovery must match the address, the message must claim that address,
 *    be fresh, and carry the stored nonce (consumed on use).
 * 5. NextAuth issues the session cookie; the Prisma user (with its plan) is
 *    upserted by wallet address.
 */

import { signIn as nextAuthSignIn } from "next-auth/react";

const SESSION_KEY = "bitprivat:session";

export interface SiweSession {
  address: string;
  accessToken: string;
  issuedAt: string;
  mock?: boolean;
}

export function buildSiweMessage(params: { address: string; nonce: string; domain?: string; issuedAt?: string }): string {
  const domain = params.domain ?? (typeof window !== "undefined" ? window.location.host : "localhost:3000");
  const issuedAt = params.issuedAt ?? new Date().toISOString();
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    params.address,
    "",
    "Authenticate with BitPrivat to access your portfolio and copy-trading dashboard.",
    "",
    `URI: https://${domain}`,
    "Version: 1",
    `Nonce: ${params.nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

/**
 * Run the full SIWE flow given a wallet `signMessageAsync` from wagmi.
 * Resolves to a session that should be persisted with `saveSession`.
 */
export async function signInWithEthereum(args: {
  address: string;
  signMessageAsync: (args: { message: string }) => Promise<string>;
}): Promise<SiweSession> {
  const { address, signMessageAsync } = args;

  // 1. Server-issued single-use nonce (DB-stored, 10-minute TTL).
  const res = await fetch(`/api/auth/siwe/nonce?address=${address.toLowerCase()}`);
  if (!res.ok) throw new Error("Could not get a sign-in nonce");
  const { nonce, issuedAt } = (await res.json()) as { nonce: string; issuedAt: string };

  // 2. Wallet signs the SIWE message (EIP-191 personal_sign).
  const message = buildSiweMessage({ address, nonce, issuedAt });
  const signature = await signMessageAsync({ message });

  // 3. NextAuth verifies everything server-side and issues the real session
  //    cookie. Deliberately no client-side fallback: a mock session that
  //    looks real is worse than a failed login.
  const result = await nextAuthSignIn("siwe", {
    address,
    signature,
    message,
    redirect: false,
  });
  if (!result?.ok) {
    throw new Error(
      result?.error === "CredentialsSignin"
        ? "Signature rejected by server"
        : result?.error ?? "Sign-in failed"
    );
  }

  return { address: address.toLowerCase(), accessToken: "nextauth", issuedAt };
}

export function saveSession(session: SiweSession): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession(): SiweSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SiweSession;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_KEY);
}
