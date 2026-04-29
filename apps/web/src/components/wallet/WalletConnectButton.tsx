"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useBalance, useChainId, useConnect, useDisconnect, useEnsAvatar, useEnsName, useSwitchChain } from "wagmi";
import { mainnet } from "wagmi/chains";
import { normalize } from "viem/ens";
import { Wallet, ChevronDown, Copy, LogOut, Check, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

function truncate(addr: string, head = 6, tail = 4) {
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function WalletConnectButton() {
  const { address, isConnected, isConnecting, isReconnecting } = useAccount();
  const { connect, connectors, isPending: connectPending, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { chains, switchChain } = useSwitchChain();

  const { data: ensName } = useEnsName({ address, chainId: mainnet.id });
  const { data: ensAvatar } = useEnsAvatar({
    name: ensName ? normalize(ensName) : undefined,
    chainId: mainnet.id,
  });
  const { data: balance } = useBalance({ address });

  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const handleCopy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const currentChain = chains.find((c) => c.id === chainId);

  // Connecting / reconnecting state
  if (isConnecting || isReconnecting) {
    return (
      <button
        disabled
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-300"
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
        Connecting…
      </button>
    );
  }

  // Not connected — show connector picker
  if (!isConnected || !address) {
    return (
      <div className="relative" ref={pickerRef}>
        <button
          onClick={() => setPickerOpen((p) => !p)}
          disabled={connectPending}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors disabled:opacity-60 shadow-[0_0_18px_-5px_rgba(34,211,238,0.5)]"
        >
          {connectPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />}
          {connectPending ? "Connecting…" : "Connect Wallet"}
        </button>

        {pickerOpen && (
          <div className="absolute right-0 top-11 z-50 w-64 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl py-1.5 overflow-hidden">
            <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Choose a wallet
            </p>
            {connectors.map((c) => (
              <button
                key={c.uid}
                onClick={() => {
                  connect({ connector: c });
                  setPickerOpen(false);
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <div className="w-7 h-7 rounded-md bg-slate-800 flex items-center justify-center text-cyan-400">
                  <Wallet className="w-3.5 h-3.5" />
                </div>
                <span className="flex-1 text-left">{c.name}</span>
              </button>
            ))}
            {connectError && (
              <p className="px-3 py-2 text-xs text-red-400 border-t border-slate-800">
                {connectError.message.slice(0, 80)}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // Connected
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-200 hover:bg-slate-800 transition-colors"
      >
        {ensAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ensAvatar} alt={ensName ?? address} className="w-6 h-6 rounded-full" />
        ) : (
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600" />
        )}
        <span className="font-mono text-xs">{ensName ?? truncate(address)}</span>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-soft" />
        <ChevronDown className={cn("w-3 h-3 text-slate-500 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-72 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
          {/* Identity header */}
          <div className="px-4 py-3.5 border-b border-slate-800 bg-gradient-to-br from-slate-900 to-slate-900/40">
            <div className="flex items-center gap-3">
              {ensAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ensAvatar} alt="" className="w-10 h-10 rounded-full" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-100 truncate">
                  {ensName ?? truncate(address, 6, 4)}
                </p>
                <p className="text-[11px] text-slate-500 font-mono truncate">{truncate(address, 8, 6)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-3.5">
              <div className="bg-slate-800/60 rounded-lg p-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-0.5">Network</p>
                <p className="text-xs font-semibold text-slate-200 truncate">
                  {currentChain?.name ?? `Chain ${chainId}`}
                </p>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-0.5">Balance</p>
                <p className="text-xs font-semibold text-slate-200 number-font truncate">
                  {balance
                    ? `${parseFloat(balance.formatted).toFixed(4)} ${balance.symbol}`
                    : "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Network switcher */}
          {chains.length > 1 && (
            <div className="px-2 pt-2">
              <p className="px-2 text-[10px] uppercase tracking-widest text-slate-600 font-bold mb-1">
                Switch Network
              </p>
              <div className="flex flex-wrap gap-1 px-1 pb-2">
                {chains.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => switchChain({ chainId: c.id })}
                    className={cn(
                      "text-[11px] px-2 py-1 rounded transition-colors",
                      c.id === chainId
                        ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700 border border-transparent"
                    )}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="border-t border-slate-800 py-1">
            <button
              onClick={handleCopy}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition-colors"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-slate-500" />
              )}
              {copied ? "Copied!" : "Copy address"}
            </button>
            <a
              href={`https://etherscan.io/address/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
              View on Etherscan
            </a>
            <div className="h-px bg-slate-800 my-1" />
            <button
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-400 hover:bg-slate-800 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
