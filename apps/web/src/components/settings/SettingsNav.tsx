"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserCircle, KeyRound, Receipt, Bell, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { label: "Profile",       href: "/dashboard/settings/profile",       icon: UserCircle },
  { label: "API Keys",      href: "/dashboard/settings/api-keys",      icon: KeyRound },
  { label: "Notifications", href: "/dashboard/settings/notifications", icon: Bell },
  { label: "Billing",       href: "/dashboard/settings/billing",       icon: Receipt },
  { label: "Security",      href: "/dashboard/settings/security",      icon: Shield },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <aside className="card-dark p-2 h-fit">
      {items.map(({ label, href, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
              active ? "bg-cyan-500/10 text-cyan-300 font-medium" : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
            )}
          >
            <Icon className={cn("w-4 h-4", active ? "text-cyan-400" : "text-slate-500")} />
            {label}
          </Link>
        );
      })}
    </aside>
  );
}
