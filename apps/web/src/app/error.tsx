"use client";

import { ErrorCard } from "@/components/ui/error-card";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 min-h-screen flex items-center justify-center">
        <ErrorCard
          title="Something went wrong"
          message={error.message || "An unexpected error occurred. Please try again."}
          digest={error.digest}
          onReset={reset}
        />
      </body>
    </html>
  );
}
