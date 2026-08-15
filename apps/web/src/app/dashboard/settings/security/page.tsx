"use client";

import { useState } from "react";
import { Shield, ShieldCheck, Smartphone, Monitor, LogOut, KeyRound } from "lucide-react";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { cn } from "@/lib/utils";

interface Session {
  id: string;
  device: string;
  location: string;
  lastActive: string;
  current: boolean;
}

const initialSessions: Session[] = [
  { id: "s1", device: "Chrome on Windows", location: "Bucharest, RO", lastActive: "Active now", current: true },
  { id: "s2", device: "Safari on iPhone", location: "Bucharest, RO", lastActive: "2h ago", current: false },
  { id: "s3", device: "Chrome on macOS", location: "Frankfurt, DE", lastActive: "6d ago", current: false },
];

export default function SecuritySettingsPage() {
  const [twoFactor, setTwoFactor] = useState(true);
  const [sessions, setSessions] = useState(initialSessions);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const revokeSession = (id: string) =>
    setSessions((s) => s.filter((x) => x.id !== id));

  return (
      <div className="flex flex-col gap-6 p-6 max-w-[1200px] mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Settings</h1>
          <p className="text-sm text-slate-400 mt-1">Manage your profile, security, and integrations</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
          <SettingsNav />

          <div className="flex flex-col gap-5">
            <div className="card-dark p-6">
              <h2 className="text-base font-bold text-slate-100 mb-1">Password</h2>
              <p className="text-xs text-slate-500 mb-5">Change the password used to sign in.</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Current Password">
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 outline-none"
                  />
                </Field>
                <Field label="New Password">
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 outline-none"
                  />
                </Field>
              </div>

              <div className="flex justify-end mt-5">
                <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors">
                  <KeyRound className="w-3.5 h-3.5" /> Update Password
                </button>
              </div>
            </div>

            <div className="card-dark p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-100 mb-1">Two-Factor Authentication</h2>
                  <p className="text-xs text-slate-500">Require a one-time code from an authenticator app at sign-in.</p>
                </div>
                <div className={cn(
                  "flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wide shrink-0",
                  twoFactor ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-800 text-slate-500"
                )}>
                  {twoFactor ? <ShieldCheck className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                  {twoFactor ? "Enabled" : "Disabled"}
                </div>
              </div>

              <div className="flex items-center justify-between py-3 mt-4 border-t border-slate-800/60">
                <div>
                  <p className="text-sm font-semibold text-slate-100">Authenticator app</p>
                  <p className="text-xs text-slate-500 mt-0.5">Google Authenticator, 1Password, or Authy</p>
                </div>
                <button
                  onClick={() => setTwoFactor((v) => !v)}
                  className={cn("relative w-10 h-5 rounded-full transition-colors shrink-0", twoFactor ? "bg-cyan-500" : "bg-slate-700")}
                >
                  <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all", twoFactor ? "left-[22px]" : "left-0.5")} />
                </button>
              </div>
            </div>

            <div className="card-dark p-6">
              <h2 className="text-base font-bold text-slate-100 mb-1">Active Sessions</h2>
              <p className="text-xs text-slate-500 mb-5">Devices currently signed in to your account.</p>

              <div className="divide-y divide-slate-800/60">
                {sessions.map((s) => (
                  <div key={s.id} className="flex items-center gap-4 py-4 first:pt-0">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center border border-slate-700 bg-slate-800 shrink-0">
                      {s.device.toLowerCase().includes("iphone") || s.device.toLowerCase().includes("android") ? (
                        <Smartphone className="w-4 h-4 text-slate-400" />
                      ) : (
                        <Monitor className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-100">{s.device}</p>
                        {s.current && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400">This device</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{s.location} · {s.lastActive}</p>
                    </div>
                    {!s.current && (
                      <button onClick={() => revokeSession(s.id)} className="text-slate-500 hover:text-red-400 transition-colors p-2" title="Sign out">
                        <LogOut className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</label>
      {children}
    </div>
  );
}
