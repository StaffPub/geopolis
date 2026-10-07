/**
 * GEOPOLIS — Rate limiting simple en mémoire (par clé glissante).
 * Suffisant pour une instance ; protège auth, actions et WebSocket.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    if (b.resetAt < now) buckets.delete(k);
  }
}

/** Renvoie true si la requête est autorisée, false si la limite est dépassée. */
export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= max;
}

export function resetRateLimits(): void {
  buckets.clear();
}
