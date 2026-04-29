/**
 * Sign-In With Ethereum (EIP-4361 inspired, simplified for our flow):
 *
 * 1. Frontend asks gateway for a nonce keyed to address.
 * 2. Frontend builds a message containing domain + address + nonce + issuedAt.
 * 3. Wallet signs message via personal_sign (EIP-191).
 * 4. Frontend POSTs {address, signature, message, nonce} to gateway.
 * 5. Gateway recovers signer from signature, checks signer == claimed address,
 *    checks nonce matches and hasn't expired, then issues a JWT.
 *
 * Standalone fallback: when gateway is offline we still verify the signature
 * locally with viem and issue a self-signed mock token so the UI keeps working.
 */

import { recoverMessageAddress } from "viem";
import { api } from "./api";

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

/** Generate a 32-char nonce locally (used only when gateway is offline). */
function localNonce(): string {
  const bytes = new Uint8Array(16);
  if (typeof window !== "undefined") crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
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

  let nonce: string;
  let issuedAt: string;
  let useMock = false;

  try {
    const res = await api.auth.nonce(address);
    nonce = res.nonce;
    issuedAt = res.issuedAt;
  } catch {
    // Gateway offline — fall back to local nonce
    nonce = localNonce();
    issuedAt = new Date().toISOString();
    useMock = true;
  }

  const message = buildSiweMessage({ address, nonce, issuedAt });
  const signature = await signMessageAsync({ message });

  if (!useMock) {
    try {
      const verify = await api.auth.verify({ address, signature, message, nonce });
      return { address: verify.user.address, accessToken: verify.accessToken, issuedAt };
    } catch {
      useMock = true;
    }
  }

  // Local verification fallback. Recovers signer with viem and confirms it
  // matches the claimed address, then issues a mock token so the session is
  // usable for read-only UI work.
  const recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    throw new Error("Signature does not match claimed address");
  }

  return {
    address,
    accessToken: `mock.${btoa(address).replace(/=/g, "")}.${Date.now()}`,
    issuedAt,
    mock: true,
  };
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
