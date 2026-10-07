/**
 * GEOPOLIS — Stockage Upstash Redis (REST via fetch, sans SDK lourd).
 * Utilisé en production (Render). Supports : GET/SET/DEL/INCR/SCAN, pipeline,
 * et locks distribués 100 % REST (SET NX PX + renouvellement GET/SET) —
 * SANS script Lua : l'endpoint /lua n'est pas disponible sur toutes les
 * instances Upstash (HTTP 400) et bloquait l'acquisition du lock moteur.
 */
import { gzipSync, gunzipSync } from 'node:zlib';
import { createLogger } from '../logger.js';
import type { Storage } from './storage.js';

/** Préfixe marquant les valeurs compressées (rétro-compatible avec l'existant). */
const GZ = 'gz1:';

const log = createLogger('STORAGE:UPSTASH');

interface UpstashResponse<T> {
  result?: T;
  error?: string;
}

export class UpstashStorage implements Storage {
  readonly kind = 'upstash';
  private baseUrl: string;
  private token: string;

  constructor(url: string, token: string) {
    this.baseUrl = url.replace(/\/$/, '');
    this.token = token;
  }

  private async cmd<T>(args: (string | number)[]): Promise<T | null> {
    const res = await fetch(`${this.baseUrl}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      throw new Error(`Upstash HTTP ${res.status}`);
    }
    const json = (await res.json()) as UpstashResponse<T>;
    if (json.error) throw new Error(`Upstash error: ${json.error}`);
    return json.result ?? null;
  }

  private async pipeline(commands: (string | number)[][]): Promise<unknown[]> {
    const res = await fetch(`${this.baseUrl}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`Upstash pipeline HTTP ${res.status}`);
    const json = (await res.json()) as UpstashResponse<unknown>[];
    return json.map((r) => r.result ?? null);
  }

  /** Sérialise + compresse les grosses valeurs : divise la bande passante par ~5. */
  private encode(value: unknown): string {
    const json = JSON.stringify(value);
    if (json.length < 2048) return json;
    return GZ + gzipSync(Buffer.from(json, 'utf8')).toString('base64');
  }

  private decode<T>(raw: string): T {
    if (raw.startsWith(GZ)) {
      return JSON.parse(gunzipSync(Buffer.from(raw.slice(GZ.length), 'base64')).toString('utf8')) as T;
    }
    return JSON.parse(raw) as T;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.cmd<string>(['GET', key]);
    if (raw === null || raw === undefined) return null;
    try {
      return this.decode<T>(raw);
    } catch (e) {
      log.error(`Valeur illisible pour la clé ${key}`, String(e));
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.cmd(['SET', key, this.encode(value)]);
  }

  async setMany(entries: Array<[string, unknown]>): Promise<void> {
    if (entries.length === 0) return;
    // pipelines de 50 commandes max pour rester raisonnable
    for (let i = 0; i < entries.length; i += 50) {
      const chunk = entries.slice(i, i + 50);
      await this.pipeline(chunk.map(([k, v]) => ['SET', k, this.encode(v)]));
    }
  }

  async del(key: string): Promise<void> {
    await this.cmd(['DEL', key]);
  }

  async incr(key: string): Promise<number> {
    const n = await this.cmd<number>(['INCR', key]);
    return typeof n === 'number' ? n : 0;
  }

  async keys(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let cursor = 0;
    for (let i = 0; i < 200; i++) {
      const res = await this.cmd<[number, string[]]>(['SCAN', cursor, 'MATCH', `${prefix}*`, 'COUNT', 500]);
      if (!res) break;
      cursor = Number(res[0]);
      out.push(...res[1]);
      if (cursor === 0) break;
    }
    return out;
  }

  /** Lock distribué 100 % REST (aucun Lua) : SET NX PX pour prendre,
   *  GET + re-SET PX pour renouveler, GET + DEL pour libérer.
   *  La fenêtre de course du compare-and-delete non atomique est négligeable
   *  (deux appels REST ~50 ms, TTL de plusieurs dizaines de secondes). */
  async acquireLock(name: string, holder: string, ttlMs: number): Promise<boolean> {
    const key = `lock:${name}`;
    const ttl = Math.max(1000, ttlMs);
    const res = await this.cmd<string>(['SET', key, holder, 'PX', ttl, 'NX']);
    if (res === 'OK') return true;
    // Lock existant : renouvellement seulement si NOUS sommes le holder
    const cur = await this.cmd<string>(['GET', key]);
    if (cur === holder) {
      await this.cmd(['SET', key, holder, 'PX', ttl]);
      return true;
    }
    return false;
  }

  async releaseLock(name: string, holder: string): Promise<void> {
    const key = `lock:${name}`;
    const cur = await this.cmd<string>(['GET', key]);
    if (cur === holder) {
      await this.cmd(['DEL', key]);
    }
  }

  async health(): Promise<boolean> {
    try {
      const pong = await this.cmd<string>(['PING']);
      return pong === 'PONG';
    } catch (e) {
      log.warn('health check échoué', String(e));
      return false;
    }
  }

  async close(): Promise<void> {
    /* fetch sans état : rien à fermer */
  }
}
