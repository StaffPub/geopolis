/**
 * GEOPOLIS — Utilitaires : IDs, RNG déterministe, maths sûres.
 */
import crypto from 'node:crypto';

export function uid(prefix = ''): string {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** RNG déterministe (mulberry32) — utilisé par le seed du monde. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(str: string): number {
  const h = sha256(str).slice(0, 8);
  return parseInt(h, 16);
}

/** Remplace NaN/Infinity par une valeur sûre. */
export function safe(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

export function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

/** Déplacement exponentiel doux vers une cible. */
export function approach(current: number, target: number, rate: number): number {
  return current + (target - current) * rate;
}

export function round(v: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function pickWeighted<T>(rng: () => number, items: T[], weight: (item: T) => number): T | null {
  const total = items.reduce((s, i) => s + Math.max(0, weight(i)), 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const item of items) {
    r -= Math.max(0, weight(item));
    if (r <= 0) return item;
  }
  return items[items.length - 1] ?? null;
}
