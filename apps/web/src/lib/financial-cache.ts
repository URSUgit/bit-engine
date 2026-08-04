/**
 * In-process TTL cache for financial route handlers.
 *
 * Survives only within a single Node.js process — fine for our use case
 * (low traffic, single-instance dev/prod). For multi-instance prod, swap
 * the Map for Redis without changing the call sites.
 */

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

// Negative cache: a downed upstream shouldn't make every request pay its
// full timeout again — short-circuit repeat failures for a short window.
const FAIL_TTL_MS = 20_000;
const failStore = new Map<string, { error: string; expiresAt: number }>();

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheSet<T>(key: string, value: T, ttlSeconds: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function cacheInvalidate(prefix: string): number {
  let removed = 0;
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) {
      store.delete(k);
      removed++;
    }
  }
  return removed;
}

export type ApiResponse<T> = {
  data: T | null;
  source: string;
  cachedAt: string;
  error?: string;
};

export function ok<T>(data: T, source: string, fromCache = false): ApiResponse<T> {
  return {
    data,
    source: fromCache ? `${source} (cache)` : source,
    cachedAt: new Date().toISOString(),
  };
}

export function fail(source: string, error: string): ApiResponse<null> {
  return { data: null, source, cachedAt: new Date().toISOString(), error };
}

/**
 * Wrap a fetcher with cache + standard response envelope.
 * - Returns cached value if fresh.
 * - On fetch error, returns cached value if available (stale-while-error), else fail().
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  source: string,
  fetcher: () => Promise<T>,
): Promise<ApiResponse<T>> {
  const cached = cacheGet<T>(key);
  if (cached !== null) return ok(cached, source, true);

  const recentFailure = failStore.get(key);
  if (recentFailure && Date.now() < recentFailure.expiresAt) {
    return fail(source, recentFailure.error) as ApiResponse<T>;
  }

  try {
    const data = await fetcher();
    cacheSet(key, data, ttlSeconds);
    failStore.delete(key);
    return ok(data, source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failStore.set(key, { error: msg, expiresAt: Date.now() + FAIL_TTL_MS });
    return fail(source, msg) as ApiResponse<T>;
  }
}
