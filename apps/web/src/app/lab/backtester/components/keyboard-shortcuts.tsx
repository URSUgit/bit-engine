"use client";
import { useEffect, useState } from "react";

interface Props {
  onRunBacktest: () => void;
  onSwitchTab: (n: number) => void; // 1-7 → mode tabs
  onSwitchResultTab: (dir: 1 | -1) => void; // left/right result tabs
}

export function KeyboardShortcutsLayer({ onRunBacktest, onSwitchTab, onSwitchResultTab }: Props) {
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement).isContentEditable;

      if (e.key === "?" && !inInput) { setShowHelp(h => !h); return; }
      if (e.key === "Escape") { setShowHelp(false); return; }
      if (inInput) return;

      if ((e.key === "Enter" || e.key === " ") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        onRunBacktest();
        return;
      }
      if (e.key >= "1" && e.key <= "7" && !e.metaKey && !e.ctrlKey) {
        onSwitchTab(parseInt(e.key));
        return;
      }
      if (e.key === "ArrowLeft" && !e.metaKey) { onSwitchResultTab(-1); return; }
      if (e.key === "ArrowRight" && !e.metaKey) { onSwitchResultTab(1); return; }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onRunBacktest, onSwitchTab, onSwitchResultTab]);

  if (!showHelp) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowHelp(false)}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-80 space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-zinc-100">Keyboard Shortcuts</h3>
        <div className="space-y-2 text-sm">
          {[
            ["Space / Enter", "Run backtest"],
            ["1 – 7", "Switch mode tabs"],
            ["← / →", "Switch result tabs"],
            ["?", "Toggle this help"],
            ["Esc", "Close help"],
          ].map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between">
              <kbd className="px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-xs font-mono text-zinc-300">{key}</kbd>
              <span className="text-zinc-400">{desc}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-zinc-600">Click anywhere or press Esc to close</p>
      </div>
    </div>
  );
}
