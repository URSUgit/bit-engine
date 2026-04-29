import { cn } from "@/lib/utils";

interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * BitPrivat brand mark — abstract upward chevron with a center bar, suggesting
 * an ascending bar chart. Uses the brand cyan→blue gradient.
 */
export function LogoMark({ size = 28, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-label="BitPrivat"
    >
      <defs>
        <linearGradient id="bp-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22d3ee" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
        <linearGradient id="bp-glow" x1="0" y1="0" x2="0" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22d3ee" stopOpacity="0.4" />
          <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Outer rounded square */}
      <rect width="32" height="32" rx="8" fill="url(#bp-grad)" />
      {/* Glow */}
      <rect width="32" height="32" rx="8" fill="url(#bp-glow)" />
      {/* Ascending bars */}
      <rect x="7"  y="18" width="3" height="7"  rx="1" fill="#0f172a" />
      <rect x="12" y="14" width="3" height="11" rx="1" fill="#0f172a" />
      <rect x="17" y="10" width="3" height="15" rx="1" fill="#0f172a" />
      <rect x="22" y="6"  width="3" height="19" rx="1" fill="#0f172a" />
    </svg>
  );
}

interface WordmarkProps extends LogoProps {
  textClassName?: string;
}

export function Wordmark({ size = 28, className, textClassName }: WordmarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      <span className={cn("text-base font-bold tracking-tight text-slate-50", textClassName)}>
        BIT<span className="text-cyan-400">privat</span>
      </span>
    </span>
  );
}
