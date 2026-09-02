// Fallback avatar for a Scout trader (YouTube channel) when no real photo
// is available: a deterministic, seeded stylized image from DiceBear's
// public API (no API key, no real photo fetched or stored).
export function traderAvatarUrl(name: string): string {
  return `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(name)}`;
}

// Prefer the channel's real, self-published YouTube profile photo; fall
// back to the generated avatar only when the backend couldn't resolve one.
export function resolveAvatarUrl(name: string, realAvatar?: string | null): string {
  return realAvatar || traderAvatarUrl(name);
}
