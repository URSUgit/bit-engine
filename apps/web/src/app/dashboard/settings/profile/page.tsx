"use client";

import { useState } from "react";
import { Save, Camera } from "lucide-react";
import { SettingsNav } from "@/components/settings/SettingsNav";

export default function ProfileSettingsPage() {
  const [profile, setProfile] = useState({
    displayName: "ionut",
    handle: "ionut.eth",
    bio: "Long-term DeFi believer. Trading perps + prediction markets since 2021.",
    twitter: "@ionut",
    discord: "ionut#1234",
    website: "https://ionut.dev",
    showOnLeaderboard: true,
    publicCopying: false,
  });

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
              <h2 className="text-base font-bold text-slate-100 mb-1">Public Profile</h2>
              <p className="text-xs text-slate-500 mb-5">How other traders see you on BitPrivat.</p>

              <div className="flex items-center gap-4 mb-6">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-2xl font-bold text-white">
                    {profile.displayName[0]?.toUpperCase()}
                  </div>
                  <button className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center hover:bg-slate-700 transition-colors">
                    <Camera className="w-3.5 h-3.5 text-slate-300" />
                  </button>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-100">{profile.handle}</p>
                  <p className="text-xs text-slate-500 font-mono">0x4f3a…b29e</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Display Name">
                  <Input value={profile.displayName} onChange={(v) => setProfile({ ...profile, displayName: v })} />
                </Field>
                <Field label="Handle">
                  <Input value={profile.handle} onChange={(v) => setProfile({ ...profile, handle: v })} />
                </Field>
                <Field label="Bio" className="sm:col-span-2">
                  <textarea
                    value={profile.bio}
                    onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                    rows={3}
                    className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 w-full focus:border-cyan-500 outline-none resize-none"
                  />
                </Field>
                <Field label="Twitter / X">
                  <Input value={profile.twitter} onChange={(v) => setProfile({ ...profile, twitter: v })} />
                </Field>
                <Field label="Discord">
                  <Input value={profile.discord} onChange={(v) => setProfile({ ...profile, discord: v })} />
                </Field>
                <Field label="Website" className="sm:col-span-2">
                  <Input value={profile.website} onChange={(v) => setProfile({ ...profile, website: v })} />
                </Field>
              </div>

              <div className="flex justify-end mt-5">
                <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors">
                  <Save className="w-3.5 h-3.5" /> Save Profile
                </button>
              </div>
            </div>

            <div className="card-dark p-6">
              <h2 className="text-base font-bold text-slate-100 mb-1">Visibility</h2>
              <p className="text-xs text-slate-500 mb-5">Control how your performance is shared.</p>

              <Toggle
                label="Show on leaderboard"
                description="Your verified on-chain performance appears in the global ranking"
                checked={profile.showOnLeaderboard}
                onChange={(v) => setProfile({ ...profile, showOnLeaderboard: v })}
              />
              <Toggle
                label="Allow public copying"
                description="Other traders can mirror your positions automatically"
                checked={profile.publicCopying}
                onChange={(v) => setProfile({ ...profile, publicCopying: v })}
              />
            </div>
          </div>
        </div>
      </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 outline-none"
    />
  );
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-3 border-t border-slate-800/60 first:border-t-0">
      <div>
        <p className="text-sm font-semibold text-slate-100">{label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${checked ? "bg-cyan-500" : "bg-slate-700"}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}
