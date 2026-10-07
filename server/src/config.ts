/**
 * GEOPOLIS — Configuration serveur (variables d'environnement).
 * Aucune valeur sensible n'est jamais hardcodée ni exposée au client.
 */
import path from 'node:path';

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === '') return def;
  return v === 'true' || v === '1';
}

function int(v: string | undefined, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
}

const production = process.env['NODE_ENV'] === 'production';

/** Intervalle de tick (1 jour de jeu). Défaut : 600 000 ms = 10 MINUTES réelles.
 *  En PRODUCTION, un plancher de 10 minutes est imposé même si une variable
 *  d'environnement obsolète (ex. TICK_MS=20000 posée avant la v1.12) subsiste
 *  dans le dashboard d'hébergement — le tempo du jeu ne dépend plus de l'ordre
 *  des déploiements. Échappement local/expérimental : TICK_MS_FORCE=true. */
function resolveTickMs(): number {
  const raw = int(process.env['TICK_MS'], 600000);
  if (production && process.env['TICK_MS_FORCE'] !== 'true') return Math.max(raw, 600000);
  return raw;
}

export const config = {
  env: process.env['NODE_ENV'] ?? 'development',
  production,
  port: int(process.env['PORT'], production ? 10000 : 3001),
  appUrl: process.env['APP_URL'] ?? '',
  sessionSecret: process.env['SESSION_SECRET'] ?? '',
  adminEmail: (process.env['ADMIN_EMAIL'] ?? '').trim().toLowerCase(),
  upstashUrl: process.env['UPSTASH_REDIS_REST_URL'] ?? '',
  upstashToken: process.env['UPSTASH_REDIS_REST_TOKEN'] ?? '',
  dataDir: process.env['DATA_DIR'] ?? path.join(process.cwd(), 'data'),
  simulationEnabled: bool(process.env['SIMULATION_ENABLED'], true),
  /** 1 tick = 1 jour de jeu. Production : 10 MINUTES réelles minimum (voir resolveTickMs). */
  tickMs: resolveTickMs(),
  /** Toutes les N ticks : sauvegarde complète des pays (entre-temps : light).
      Réduit la bande passante Upstash d'un facteur ~N sans risque réel
      (meta sauvegardée chaque tick ; actions importantes sauvegardées aussitôt). */
  persistEveryTicks: int(process.env['PERSIST_EVERY_TICKS'], 6),
  clientDist: process.env['CLIENT_DIST'] ?? path.join(process.cwd(), 'client', 'dist'),
  sessionTtlMs: int(process.env['SESSION_TTL_MS'], 30 * 24 * 3600 * 1000),
  instanceId: process.env['RENDER_SERVICE_ID']
    ? `${process.env['RENDER_SERVICE_ID']}-${process.env['RENDER_INSTANCE_ID'] ?? '0'}`
    : `local-${process.pid}`,
  logLevel: (process.env['LOG_LEVEL'] ?? (production ? 'info' : 'debug')) as
    | 'debug'
    | 'info'
    | 'warn'
    | 'error',
} as const;

export function validateConfig(): string[] {
  const problems: string[] = [];
  if (production && !config.sessionSecret) {
    problems.push('SESSION_SECRET est requis en production');
  }
  if (production && !config.adminEmail) {
    problems.push("ADMIN_EMAIL n'est pas configuré : aucun compte ne sera administrateur");
  }
  if (config.upstashUrl && !config.upstashToken) {
    problems.push('UPSTASH_REDIS_REST_URL est défini sans UPSTASH_REDIS_REST_TOKEN');
  }
  return problems;
}
