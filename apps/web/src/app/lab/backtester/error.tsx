"use client";

import { useState } from "react";
import { ErrorCard } from "@/components/ui/error-card";

export default function BacktesterError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <ErrorCard
          title="Backtester unavailable"
          message="The signal service may be offline or the request timed out. Check that the backend is running on port 8001."
          digest={error.digest}
          onReset={reset}
        />
        {error.message && (
          <div className="max-w-md mx-auto">
            <button
              onClick={() => setShowDetail((v) => !v)}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition"
            >
              {showDetail ? "Hide" : "Show"} error details
            </button>
            {showDetail && (
              <pre className="mt-2 text-xs text-red-400/80 bg-zinc-900 border border-zinc-800 rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap">
                {error.message}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
