import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { twMerge } from "tailwind-merge";
import { clsx } from "clsx";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "bg-cyan-500/15 text-cyan-400 border border-cyan-500/20",
        secondary: "bg-zinc-700 text-zinc-300",
        success: "bg-green-500/15 text-green-400",
        destructive: "bg-red-500/15 text-red-400",
        warning: "bg-yellow-500/15 text-yellow-400",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={twMerge(clsx(badgeVariants({ variant }), className))} {...props} />;
}
