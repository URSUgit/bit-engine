"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { Wallet, ChevronDown, Copy, LogOut } from "lucide-react";
import { useState } from "react";

function truncateAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (isConnected && address) {
    return (
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors"
        >
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="font-mono text-xs">{truncateAddress(address)}</span>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
        </button>

        {open && (
          <div className="absolute right-0 top-10 z-50 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl py-1 overflow-hidden">
            <button
              onClick={handleCopy}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              <Copy className="w-3.5 h-3.5 text-zinc-500" />
              {copied ? "Copied!" : "Copy address"}
            </button>
            <div className="h-px bg-zinc-800 my-1" />
            <button
              onClick={() => { disconnect(); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:bg-zinc-800 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      disabled={isPending}
      onClick={() => connect({ connector: injected() })}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-500 text-zinc-950 text-sm font-semibold hover:bg-cyan-400 transition-colors disabled:opacity-60"
    >
      <Wallet className="w-3.5 h-3.5" />
      {isPending ? "Connecting…" : "Connect Wallet"}
    </button>
  );
}
