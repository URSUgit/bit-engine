"use client";

import { Navbar } from "./Navbar";
import { TabNav } from "./TabNav";
import { ChatWidget } from "@/components/ChatWidget";
import { TooltipProvider } from "@/components/ui/tooltip";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col h-screen bg-zinc-950 overflow-hidden">
        <Navbar />
        <TabNav />
        <main className="flex-1 overflow-y-auto">{children}</main>
        <ChatWidget />
      </div>
    </TooltipProvider>
  );
}
