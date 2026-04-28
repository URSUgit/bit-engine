import * as React from "react";
import { twMerge } from "tailwind-merge";
import { clsx } from "clsx";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={twMerge(
        clsx("rounded-xl bg-zinc-900 border border-zinc-800 p-5", className)
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={twMerge(clsx("mb-4", className))} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={twMerge(clsx("text-sm font-semibold text-zinc-200", className))} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx(className)} {...props} />;
}
