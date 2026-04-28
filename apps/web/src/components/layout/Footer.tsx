import Link from "next/link";
import { Zap } from "lucide-react";

const links = [
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  { label: "Risk Disclosure", href: "/risk" },
  { label: "Status", href: "/status" },
  { label: "Docs", href: "https://docs.bitprivat.io" },
];

export function Footer() {
  return (
    <footer className="border-t border-zinc-800 bg-zinc-900 py-8">
      <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-cyan-500 flex items-center justify-center">
            <Zap className="w-3 h-3 text-zinc-950" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-semibold text-zinc-300">
            Bit<span className="text-cyan-400">Privat</span>
          </span>
          <span className="text-zinc-600 text-xs ml-2">© {new Date().getFullYear()}</span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {links.map(({ label, href }) => (
            <Link
              key={label}
              href={href}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
