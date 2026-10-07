/**
 * GEOPOLIS — Stockage fichier local (fallback développement / secours).
 * Un fichier JSON par clé, écriture atomique (tmp + rename), cache mémoire.
 * En production sur Render, Upstash est privilégié (voir storage/index.ts).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../logger.js';
import type { Storage } from './storage.js';

const log = createLogger('STORAGE:FILE');

function keyToFile(key: string): string {
  return key.replace(/[^a-zA-Z0-9_:.-]/g, '_') + '.json';
}

export class FileStorage implements Storage {
  readonly kind = 'file';
  private dir: string;
  private cache = new Map<string, unknown>();
  private loaded = false;
  private counters = new Map<string, number>();
  private locks = new Map<string, { holder: string; expires: number }>();

  constructor(dir: string) {
    this.dir = dir;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await fs.mkdir(this.dir, { recursive: true });
    const files = await fs.readdir(this.dir);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.dir, f), 'utf8');
        const parsed = JSON.parse(raw) as { key: string; value: unknown };
        this.cache.set(parsed.key, parsed.value);
      } catch (e) {
        log.warn(`Fichier illisible ignoré : ${f}`, String(e));
      }
    }
    this.loaded = true;
    log.info(`Cache chargé : ${this.cache.size} clés depuis ${this.dir}`);
  }

  private tmpSeq = 0;

  /** Écriture atomique : nom temporaire UNIQUE (jamais de collision entre deux
   *  écritures concurrentes de la même clé — l'ancien nom fixe provoquait des
   *  ENOENT sur le rename), + nettoyage du temporaire en cas d'échec. */
  private async write(key: string, value: unknown): Promise<void> {
    const file = path.join(this.dir, keyToFile(key));
    this.tmpSeq = (this.tmpSeq + 1) % Number.MAX_SAFE_INTEGER;
    const tmp = `${file}.${process.pid}.${this.tmpSeq.toString(36)}.${Date.now().toString(36)}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify({ key, value }), 'utf8');
      await fs.rename(tmp, file);
    } catch (e) {
      try {
        await fs.unlink(tmp);
      } catch {
        /* temporaire déjà absent */
      }
      throw e;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    await this.ensureLoaded();
    const v = this.cache.get(key);
    return (v === undefined ? null : (v as T));
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.ensureLoaded();
    this.cache.set(key, value);
    await this.write(key, value);
  }

  async setMany(entries: Array<[string, unknown]>): Promise<void> {
    await this.ensureLoaded();
    for (const [k, v] of entries) {
      this.cache.set(k, v);
      await this.write(k, v);
    }
  }

  async del(key: string): Promise<void> {
    await this.ensureLoaded();
    this.cache.delete(key);
    try {
      await fs.unlink(path.join(this.dir, keyToFile(key)));
    } catch {
      /* déjà absent */
    }
  }

  async incr(key: string): Promise<number> {
    await this.ensureLoaded();
    const cur = this.counters.get(key) ?? Number(this.cache.get(key) ?? 0);
    const next = (Number.isFinite(cur) ? cur : 0) + 1;
    this.counters.set(key, next);
    this.cache.set(key, next);
    await this.write(key, next);
    return next;
  }

  async keys(prefix: string): Promise<string[]> {
    await this.ensureLoaded();
    return [...this.cache.keys()].filter((k) => k.startsWith(prefix));
  }

  async acquireLock(name: string, holder: string, ttlMs: number): Promise<boolean> {
    await this.ensureLoaded();
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
    try {
      await this.ensureLoaded();
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    /* rien à fermer */
  }
}
