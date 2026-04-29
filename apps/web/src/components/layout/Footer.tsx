import Link from "next/link";
import { LogoMark } from "@/components/Logo";

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
          <LogoMark size={20} />
          <span className="text-sm font-semibold text-slate-300">
            BIT<span className="text-cyan-400">privat</span>
          </span>
          <span className="text-slate-600 text-xs ml-2">© {new Date().getFullYear()}</span>
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
