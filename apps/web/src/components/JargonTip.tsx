"use client";

import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GLOSSARY, type GlossaryTerm } from "@/lib/glossary";

const HINTS_SEEN_KEY = "bitprivat-jargon-hints-seen";
const AUTO_SHOW_MS = 4000;

/** Auto-opens the very first JargonTip mounted anywhere, once per browser. */
function useFirstRunHint(): [boolean, () => void] {
  const [autoOpen, setAutoOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(HINTS_SEEN_KEY)) return;
    localStorage.setItem(HINTS_SEEN_KEY, "1");
    setAutoOpen(true);
    const timer = setTimeout(() => setAutoOpen(false), AUTO_SHOW_MS);
    return () => clearTimeout(timer);
  }, []);

  return [autoOpen, () => setAutoOpen(false)];
}

export function JargonTip({ term, children }: { term: GlossaryTerm; children: React.ReactNode }) {
  const [autoOpen, dismiss] = useFirstRunHint();
  const entry = GLOSSARY[term];

  return (
    <Tooltip open={autoOpen || undefined} onOpenChange={(open) => !open && dismiss()}>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-semibold text-slate-100">{entry.term}</p>
        <p className="mt-0.5 text-slate-400">{entry.definition}</p>
      </TooltipContent>
    </Tooltip>
  );
}
