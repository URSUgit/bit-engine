import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-cyan-500 text-zinc-950 hover:bg-cyan-400",
        secondary: "bg-zinc-800 text-zinc-200 hover:bg-zinc-700 border border-zinc-700",
        ghost: "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800",
        destructive: "bg-red-500/15 text-red-400 hover:bg-red-500/25",
        outline: "border border-zinc-700 text-zinc-300 hover:bg-zinc-800",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        default: "h-9 px-4",
        lg: "h-11 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={twMerge(clsx(buttonVariants({ variant, size }), className))} {...props} />
  )
);
Button.displayName = "Button";
