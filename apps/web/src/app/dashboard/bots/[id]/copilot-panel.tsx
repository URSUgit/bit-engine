"use client";

import { useState } from "react";
import { Sparkles, Loader2, ChevronDown, ChevronRight, Check, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChangeProposal {
  parameter_key: string;
  display_name: string;
  icon: string;
  rationale: string;
  control_type: "slider" | "toggle" | "stepper" | "select";
  current_value: number | string | boolean;
  suggested_value: number | string | boolean;
  min_value: number | null;
  max_value: number | null;
  min_label: string | null;
  max_label: string | null;
  step: number | null;
  options: string[] | null;
}

interface CopilotTurn {
  thought: string;
  analysis: string;
  proposal: ChangeProposal | null;
  tool_calls: { name: string; input: Record<string, unknown> }[];
}

const SUGGESTIONS = [
  "Why is it losing?",
  "Make it more profitable",
  "Loosen the entry filters",
];

/** Turn a failed response into something the trader can act on.
 *  The service's 429 body is `{error, retry_after}` with no `detail`, so
 *  without this a rate-limited ask would surface as a bare "Request failed". */
async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 429) {
    const retry = typeof body.retry_after === "number" ? body.retry_after : 60;
    return `Rate limit reached — each question costs a model call. Try again in ${retry}s.`;
  }
  if (typeof body.detail === "string") return body.detail;
  return `Request failed (${res.status})`;
}

/** The proposal card. The value stays editable before confirming — the model's
 *  suggestion is a starting point, not something the trader has to accept as-is. */
function ProposalCard({
  proposal, onApply, onCancel, applying, mode,
}: {
  proposal: ChangeProposal;
  onApply: (value: number | string | boolean) => void;
  onCancel: () => void;
  applying: boolean;
  mode: string;
}) {
  const numeric = typeof proposal.suggested_value === "number";
  const [value, setValue] = useState<number | string | boolean>(proposal.suggested_value);

  return (
    <div className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">{proposal.display_name}</div>
          <p className="text-xs text-slate-400 mt-0.5">{proposal.rationale}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Current</div>
          <div className="text-sm font-mono text-slate-300">{String(proposal.current_value)}</div>
        </div>
      </div>

      {mode === "live" && (
        <div className="mt-3 flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
          <span className="text-[11px] text-amber-200/90">
            This bot is trading live. The change takes effect on its next signal.
          </span>
        </div>
      )}

      <div className="mt-4">
        {proposal.control_type === "toggle" ? (
          <button
            onClick={() => setValue(value ? 0 : 1)}
            className={cn(
              "px-3 py-1.5 rounded text-xs font-medium border transition-colors",
              value
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                : "bg-slate-800 text-slate-400 border-slate-700",
            )}
          >
            {value ? "Enabled" : "Disabled"}
          </button>
        ) : numeric ? (
          <div>
            <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
              <span>{proposal.min_label ?? proposal.min_value}</span>
              <span className="text-cyan-300 font-mono text-sm">{String(value)}</span>
              <span>{proposal.max_label ?? proposal.max_value}</span>
            </div>
            <input
              type="range"
              min={proposal.min_value ?? 0}
              max={proposal.max_value ?? 100}
              step={proposal.step ?? 1}
              value={Number(value)}
              onChange={(e) => setValue(Number(e.target.value))}
              className="w-full accent-cyan-400"
            />
          </div>
        ) : (
          <input
            value={String(value)}
            onChange={(e) => setValue(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200"
          />
        )}
      </div>

      <div className="mt-4 flex gap-2 justify-end">
        <button
          onClick={onCancel}
          disabled={applying}
          className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5 inline mr-1" />Cancel
        </button>
        <button
          onClick={() => onApply(value)}
          disabled={applying}
          className="px-3 py-1.5 text-xs font-medium rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 transition-colors disabled:opacity-50"
        >
          {applying
            ? <Loader2 className="w-3.5 h-3.5 inline mr-1 animate-spin" />
            : <Check className="w-3.5 h-3.5 inline mr-1" />}
          Save changes
        </button>
      </div>
    </div>
  );
}

export function CopilotPanel({ botId, mode }: { botId: string; mode: string }) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [turn, setTurn] = useState<CopilotTurn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  const ask = async (text: string) => {
    const message = text.trim();
    if (!message) return;
    setAsking(true);
    setError(null);
    setTurn(null);
    setApplied(null);
    try {
      const res = await fetch(`/api/v1/cryptobot/bots/${botId}/copilot/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      setTurn((await res.json()) as CopilotTurn);
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  };

  const apply = async (value: number | string | boolean) => {
    if (!turn?.proposal) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/cryptobot/bots/${botId}/copilot/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parameter_key: turn.proposal.parameter_key, new_value: value }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      setApplied(`${turn.proposal.display_name} set to ${value}`);
      setTurn({ ...turn, proposal: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3">
        Grounded in this bot&apos;s own trade history. It proposes one change at a time and never
        applies anything without your confirmation.
      </p>

      <div className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !asking) ask(question); }}
          placeholder="Ask about this bot's performance…"
          disabled={asking}
          className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500/50 outline-none disabled:opacity-50"
        />
        <button
          onClick={() => ask(question)}
          disabled={asking || !question.trim()}
          className="px-3 py-2 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 transition-colors disabled:opacity-40 text-sm font-medium"
        >
          {asking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        </button>
      </div>

      {!turn && !asking && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="text-[11px] px-2 py-1 rounded-full border border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {applied && (
        <div className="mt-3 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          <Check className="w-3.5 h-3.5 inline mr-1" />{applied}
        </div>
      )}

      {turn && (
        <div className="mt-4">
          {turn.thought && <p className="text-xs text-slate-500 italic mb-2">{turn.thought}</p>}

          {turn.tool_calls.length > 0 && (
            <button
              onClick={() => setShowSteps((s) => !s)}
              className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors mb-2"
            >
              {showSteps ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Ran {turn.tool_calls.length} step{turn.tool_calls.length === 1 ? "" : "s"}
            </button>
          )}
          {showSteps && (
            <div className="mb-2 space-y-1">
              {turn.tool_calls.map((c, i) => (
                <div key={i} className="text-[11px] font-mono text-slate-500 bg-slate-900/60 rounded px-2 py-1">
                  {c.name}({JSON.stringify(c.input)})
                </div>
              ))}
            </div>
          )}

          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{turn.analysis}</p>

          {turn.proposal && (
            <ProposalCard
              key={turn.proposal.parameter_key}
              proposal={turn.proposal}
              onApply={apply}
              onCancel={() => setTurn({ ...turn, proposal: null })}
              applying={applying}
              mode={mode}
            />
          )}
        </div>
      )}
    </div>
  );
}
