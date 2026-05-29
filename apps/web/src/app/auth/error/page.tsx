"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Suspense } from "react";

function ErrorContent() {
  const params = useSearchParams();
  const error = params.get("error");

  const messages: Record<string, string> = {
    Configuration: "Server configuration error.",
    AccessDenied: "Access denied.",
    Verification: "The verification link has expired.",
    Default: "An authentication error occurred.",
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-4" />
        <h1 className="text-lg font-semibold text-slate-100 mb-2">Sign-in error</h1>
        <p className="text-sm text-slate-500 mb-6">{messages[error ?? "Default"] ?? messages.Default}</p>
        <Link
          href="/auth/signin"
          className="px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 font-semibold text-sm hover:bg-cyan-400 transition-colors"
        >
          Try again
        </Link>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense>
      <ErrorContent />
    </Suspense>
  );
}
