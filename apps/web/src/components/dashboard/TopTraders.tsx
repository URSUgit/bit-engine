import { TrendingUp } from "lucide-react";

const traders = [
  { handle: "0xAlpha", roi: "+312%", followers: 482, copying: true },
  { handle: "defi_whale", roi: "+248%", followers: 391, copying: false },
  { handle: "polyking", roi: "+191%", followers: 287, copying: true },
  { handle: "sigma_trader", roi: "+164%", followers: 214, copying: false },
  { handle: "chainmaxi", roi: "+138%", followers: 178, copying: false },
];

export function TopTraders() {
  return (
    <div className="flex flex-col gap-2">
      {traders.map((t, i) => (
        <div key={t.handle} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-zinc-800/50 transition-colors">
          <span className="w-5 text-xs text-zinc-600 number-font text-center">{i + 1}</span>
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
            {t.handle[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-zinc-200 truncate">{t.handle}</p>
            <p className="text-xs text-zinc-500">{t.followers} followers</p>
          </div>
          <div className="text-right shrink-0">
            <div className="flex items-center gap-1 text-green-400 text-sm font-semibold number-font">
              <TrendingUp className="w-3 h-3" />
              {t.roi}
            </div>
            {t.copying && (
              <span className="text-[10px] text-cyan-400 font-medium">Copying</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
