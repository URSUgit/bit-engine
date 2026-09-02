// Deterministic, seeded avatar for a Scout trader (YouTube channel) — no
// real photo is fetched or stored, just a stylized image generated from the
// trader's name via DiceBear's public API (no API key required).
export function traderAvatarUrl(name: string): string {
  return `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(name)}`;
}
