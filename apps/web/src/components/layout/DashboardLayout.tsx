"use client";

import { Sidebar } from "./Sidebar";
import { Navbar } from "./Navbar";
import { ChatWidget } from "@/components/ChatWidget";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-zinc-950 overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Navbar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
      <ChatWidget />
    </div>
  );
}
