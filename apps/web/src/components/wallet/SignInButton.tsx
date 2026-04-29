"use client";

import { Loader2, KeyRound, ShieldCheck } from "lucide-react";
import { useAccount } from "wagmi";
import { useSession } from "@/hooks/useSession";
import { cn } from "@/lib/utils";

interface SignInButtonProps {
  /** Visual variant — "compact" fits in nav bars, "full" is a hero CTA. */
  variant?: "compact" | "full";
  className?: string;
}

export function SignInButton({ variant = "compact", className }: SignInButtonProps) {
  const { isConnected } = useAccount();
  const { session, isAuthenticating, signIn, error } = useSession();

  if (!isConnected || session) return null;

  if (variant === "full") {
    return (
      <div className={cn("flex flex-col items-center gap-2", className)}>
        <button
          onClick={signIn}
          disabled={isAuthenticating}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-cyan-500 text-slate-950 font-bold text-base hover:bg-cyan-400 transition-colors disabled:opacity-60 shadow-[0_0_30px_-5px_rgba(34,211,238,0.5)]"
        >
          {isAuthenticating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          {isAuthenticating ? "Signing…" : "Sign In With Ethereum"}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <button
      onClick={signIn}
      disabled={isAuthenticating}
      title={error ?? "Sign a message to authenticate"}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold hover:bg-amber-500/20 transition-colors disabled:opacity-60",
        className
      )}
    >
      {isAuthenticating ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
      {isAuthenticating ? "Signing…" : "Sign In"}
    </button>
  );
}
