import { Skeleton } from "./components/shared";

export default function BacktesterLoading() {
  return (
    <div className="min-h-screen bg-zinc-950 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="border-b border-zinc-800 pb-4 space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-80" />
        </div>

        {/* Mode tabs */}
        <Skeleton className="h-12 w-full" />

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          {/* Left sidebar */}
          <div className="space-y-4 bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-6 w-28" />
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>

          {/* Right results pane */}
          <div className="space-y-6">
            {/* Metrics grid */}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
            {/* Chart */}
            <Skeleton className="h-72 w-full" />
            {/* Equity */}
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
