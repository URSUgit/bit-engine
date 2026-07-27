"use client";

import { useCallback, useEffect, useState } from "react";
import { erc20Abi, parseUnits } from "viem";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import {
  BadgeCheck,
  Loader2,
  ShieldCheck,
  Wallet,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";
import { SignInButton } from "@/components/wallet/SignInButton";

interface BillingStatus {
  authenticated: boolean;
  plan: string;
  address: string | null;
  payments: { txHash: string; amount: string; createdAt: string }[];
  chainId: number;
  chainName: string;
  receiver: `0x${string}` | null;
  usdc: `0x${string}`;
  proPriceUsdc: number;
  configured: boolean;
}

type PayPhase =
  | { step: "idle" }
  | { step: "wallet" }
  | { step: "confirming"; txHash: string; attempt: number }
  | { step: "done"; txHash: string }
  | { step: "error"; message: string };

export default function UpgradePage() {
  const { address, isConnected, chainId: walletChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [phase, setPhase] = useState<PayPhase>({ step: "idle" });
  const [manualTx, setManualTx] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/onchain");
      if (res.ok) setStatus(await res.json());
    } catch {
      /* retried on next action */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Submit a tx hash for verification, retrying while confirmations land. */
  const submitTx = useCallback(
    async (txHash: string) => {
      for (let attempt = 1; attempt <= 15; attempt++) {
        setPhase({ step: "confirming", txHash, attempt });
        const res = await fetch("/api/billing/onchain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash }),
        });
        const body = await res.json();
        if (res.ok) {
          setPhase({ step: "done", txHash });
          await refresh();
          return;
        }
        // Not-yet-confirmed / not-yet-visible results are retryable.
        const retryable = /confirmation|not found/i.test(body.error ?? "");
        if (!retryable) {
          setPhase({ step: "error", message: body.error ?? "Verification failed" });
          return;
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
      setPhase({ step: "error", message: "Timed out waiting for confirmations — paste the tx hash below to retry" });
    },
    [refresh]
  );

  const pay = useCallback(async () => {
    if (!status?.receiver) return;
    setPhase({ step: "wallet" });
    try {
      if (walletChainId !== status.chainId) {
        await switchChainAsync({ chainId: status.chainId });
      }
      const txHash = await writeContractAsync({
        abi: erc20Abi,
        address: status.usdc,
        functionName: "transfer",
        args: [status.receiver, parseUnits(String(status.proPriceUsdc), 6)],
        chainId: status.chainId,
      });
      await submitTx(txHash);
    } catch (e) {
      setPhase({
        step: "error",
        message: e instanceof Error ? e.message.split("\n")[0] : String(e),
      });
    }
  }, [status, walletChainId, switchChainAsync, writeContractAsync, submitTx]);

  const busy = phase.step === "wallet" || phase.step === "confirming";

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="flex items-center gap-2 text-xl font-semibold text-zinc-100">
        <ShieldCheck size={20} /> Upgrade to Pro
      </h1>
      <p className="text-sm text-zinc-400">
        Pay on-chain with USDC — connect your wallet, sign in, send one transaction. Card
        payments are coming later.
      </p>

      {status && !status.configured && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-800 bg-amber-950/40 p-3 text-xs text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Billing isn&apos;t configured yet: set <code className="mx-1">PAYMENT_RECEIVER_ADDRESS</code>
          (and optionally <code className="mx-1">PAYMENT_CHAIN_ID</code>, <code className="mx-1">PRO_PRICE_USDC</code>)
          in <code className="mx-1">apps/web/.env.local</code>, then restart.
        </div>
      )}

      {/* Step 1+2: connect + sign in */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-200">
          <Wallet size={15} /> Wallet
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <WalletConnectButton />
          <SignInButton />
          {status?.authenticated && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <BadgeCheck size={13} /> signed in
              {status.address && (
                <span className="font-mono text-zinc-400">
                  {status.address.slice(0, 6)}…{status.address.slice(-4)}
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Step 3: pay */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="mb-1 flex items-baseline gap-3">
          <span className="text-2xl font-semibold text-zinc-100">
            {status ? `${status.proPriceUsdc} USDC` : "…"}
          </span>
          <span className="text-xs text-zinc-500">
            one-time · {status?.chainName ?? ""} · lifetime Pro
          </span>
          {status?.plan === "pro" && (
            <span className="ml-auto flex items-center gap-1 rounded-full bg-emerald-950 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
              <BadgeCheck size={12} /> you are Pro
            </span>
          )}
        </div>

        {status?.plan !== "pro" && (
          <div className="mt-3 space-y-3">
            <button
              onClick={pay}
              disabled={!status?.configured || !status?.authenticated || !isConnected || busy}
              className="flex items-center gap-2 rounded-lg bg-cyan-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Wallet size={15} />}
              {phase.step === "wallet"
                ? "Confirm in wallet…"
                : phase.step === "confirming"
                  ? `Verifying on-chain (${phase.attempt}/15)…`
                  : `Pay ${status?.proPriceUsdc ?? ""} USDC`}
            </button>

            <div className="flex items-center gap-2 text-xs text-zinc-500">
              Paid already?
              <input
                value={manualTx}
                onChange={(e) => setManualTx(e.target.value.trim())}
                placeholder="paste tx hash (0x…)"
                className="w-72 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100"
              />
              <button
                onClick={() => manualTx && submitTx(manualTx)}
                disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(manualTx)}
                className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                Verify
              </button>
            </div>
          </div>
        )}

        {phase.step === "done" && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-xs text-emerald-300">
            <BadgeCheck size={14} /> Payment verified — welcome to Pro.
            <span className="font-mono text-emerald-500/70">{phase.txHash.slice(0, 10)}…</span>
          </div>
        )}
        {phase.step === "error" && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-900 bg-red-950/40 p-3 text-xs text-red-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {phase.message}
          </div>
        )}
      </div>

      {/* Payment history */}
      {status?.payments?.length ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Payments
          </div>
          <ul className="space-y-1 text-xs text-zinc-300">
            {status.payments.map((p) => (
              <li key={p.txHash} className="flex items-center gap-2">
                <BadgeCheck size={12} className="text-emerald-400" />
                {(Number(p.amount) / 1e6).toFixed(2)} USDC
                <span className="font-mono text-zinc-500">
                  {p.txHash.slice(0, 10)}…{p.txHash.slice(-6)}
                </span>
                <span className="ml-auto text-zinc-500">
                  {new Date(p.createdAt).toLocaleString()}
                </span>
                <ExternalLink size={11} className="text-zinc-600" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
