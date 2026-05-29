"use client";

export function ErrorCard({
  title,
  message,
  digest,
  onReset,
}: {
  title: string;
  message: string;
  digest?: string;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center justify-center min-h-[200px] p-6">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-md w-full space-y-4">
        <div className="flex items-start gap-3">
          <span className="text-red-400 text-xl mt-0.5">⚠</span>
          <div>
            <h2 className="text-base font-semibold text-red-400">{title}</h2>
            <p className="text-sm text-zinc-400 mt-1">{message}</p>
            {digest && (
              <p className="text-xs text-zinc-600 font-mono mt-2">Error ID: {digest}</p>
            )}
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button
            onClick={onReset}
            className="px-4 py-2 text-sm font-medium rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition"
          >
            Try again
          </button>
          <a
            href="/"
            className="px-4 py-2 text-sm font-medium rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-800 transition"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}
