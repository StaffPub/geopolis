/**
 * GEOPOLIS — Stockage mémoire (tests unitaires/intégration uniquement).
 */
import type { Storage } from './storage.js';

export class MemoryStorage implements Storage {
  readonly kind = 'memory';
  private map = new Map<string, unknown>();
  private locks = new Map<string, { holder: string; expires: number }>();

  async get<T>(key: string): Promise<T | null> {
    const v = this.map.get(key);
    return v === undefined ? null : (structuredClone(v) as T);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, structuredClone(value));
  }

  async setMany(entries: Array<[string, unknown]>): Promise<void> {
    for (const [k, v] of entries) this.map.set(k, structuredClone(v));
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }

  async incr(key: string): Promise<number> {
    const cur = Number(this.map.get(key) ?? 0);
    const next = (Number.isFinite(cur) ? cur : 0) + 1;
    this.map.set(key, next);
    return next;
  }

  async keys(prefix: string): Promise<string[]> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }

  async acquireLock(name: string, holder: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const cur = this.locks.get(name);
    if (cur && cur.holder === holder) {
      cur.expires = now + ttlMs;
      return true;
    }
    if (cur && cur.expires > now) return false;
    this.locks.set(name, { holder, expires: now + ttlMs });
    return true;
  }

  async releaseLock(name: string, holder: string): Promise<void> {
    const cur = this.locks.get(name);
    if (cur && cur.holder === holder) this.locks.delete(name);
  }

  async health(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.map.clear();
  }
}
