"use client";

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useChatWidgetStore, useUIModeStore } from "@/store";

const NUDGE_SEEN_KEY = "bitprivat-chat-nudge-seen";

export function AiChatWelcomeCard() {
  const isSimpleMode = useUIModeStore((s) => s.mode === "simple");
  const openChat = useChatWidgetStore((s) => s.open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(NUDGE_SEEN_KEY)) setVisible(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(NUDGE_SEEN_KEY, "1");
    setVisible(false);
  };

  if (!isSimpleMode || !visible) return null;

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-violet-500/20 bg-gradient-to-r from-violet-500/10 to-purple-500/5 p-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-violet-500/15 flex items-center justify-center shrink-0">
          <Sparkles className="w-4.5 h-4.5 text-violet-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-100">New here? Ask our AI trading assistant</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Get plain-English answers about markets, your positions, or any signal you see.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => {
            openChat();
            dismiss();
          }}
          className="px-3 py-1.5 rounded-lg bg-violet-500 text-white text-xs font-semibold hover:bg-violet-400 transition-colors"
        >
          Chat now
        </button>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors rounded-md hover:bg-slate-800"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
