/**
 * GEOPOLIS — Intégrité des données : garde-fous contre NaN, valeurs impossibles,
 * incohérences. Toute correction est tracée (log + compteur).
 */
import type { Country, MarketResource, ResourceKey, WorldMeta } from 'shared';
import { FACILITIES, INFRA, REGIME_MAP, RESOURCE_KEYS } from 'shared';
import { createLogger } from '../logger.js';
import { clamp } from '../util/core.js';

const log = createLogger('INTEGRITY');

export interface IntegrityReport {
  issues: string[];
  fixed: number;
}

function fixNum(
  obj: Record<string, number>,
  key: string,
  fallback: number,
  min: number,
  max: number,
  label: string,
  report: IntegrityReport,
): void {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    report.issues.push(`${label}.${key} invalide (${String(v)}) → ${fallback}`);
    obj[key] = fallback;
    report.fixed++;
    return;
  }
  const clamped = clamp(v, min, max);
  if (clamped !== v) {
    report.issues.push(`${label}.${key} hors bornes (${v}) → ${clamped}`);
    obj[key] = clamped;
    report.fixed++;
  }
}

export function sanitizeCountry(c: Country): IntegrityReport {
  const report: IntegrityReport = { issues: [], fixed: 0 };

  fixNum(c.economy as unknown as Record<string, number>, 'gdp', 100, 1, 1e7, `${c.id}.economy`, report);
  fixNum(c.economy as unknown as Record<string, number>, 'growth', 1.5, -12, 15, `${c.id}.economy`, report);
  fixNum(c.economy as unknown as Record<string, number>, 'growthPotential', 2, -5, 12, `${c.id}.economy`, report);
  fixNum(c.economy as unknown as Record<string, number>, 'inflation', 2, -5, 60, `${c.id}.economy`, report);
  fixNum(c.economy as unknown as Record<string, number>, 'unemployment', 6, 0.5, 40, `${c.id}.economy`, report);
  fixNum(c.economy as unknown as Record<string, number>, 'productivity', 100, 40, 250, `${c.id}.economy`, report);
  fixNum(c.economy as unknown as Record<string, number>, 'consumptionIndex', 100, 20, 200, `${c.id}.economy`, report);
  fixNum(c.economy as unknown as Record<string, number>, 'investment', c.economy.gdp * 0.18, 0, c.economy.gdp, `${c.id}.economy`, report);
  fixNum(c.economy as unknown as Record<string, number>, 'standardOfLiving', 50, 0, 100, `${c.id}.economy`, report);
  fixNum(c.economy as unknown as Record<string, number>, 'cash', c.economy.gdp * 0.02, 0, c.economy.gdp * 2, `${c.id}.economy`, report);
  fixNum(c.economy as unknown as Record<string, number>, 'debt', 0, 0, c.economy.gdp * 20, `${c.id}.economy`, report);
  fixNum(c.economy as unknown as Record<string, number>, 'revenue', c.economy.gdp * 0.2, 0, c.economy.gdp * 2, `${c.id}.economy`, report);
  fixNum(c.economy as unknown as Record<string, number>, 'spending', c.economy.gdp * 0.2, 0, c.economy.gdp * 2, `${c.id}.economy`, report);
  fixNum(c.economy as unknown as Record<string, number>, 'interestPaid', 0, 0, c.economy.gdp, `${c.id}.economy`, report);
  c.economy.balance = c.economy.revenue - c.economy.spending;

  fixNum(c as unknown as Record<string, number>, 'population', 10, 0.05, 5000, c.id, report);
  fixNum(c as unknown as Record<string, number>, 'popularity', 50, 0, 100, c.id, report);
  fixNum(c as unknown as Record<string, number>, 'stability', 50, 0, 100, c.id, report);

  fixNum(c.policy as unknown as Record<string, number>, 'taxRate', 18, 0, 60, `${c.id}.policy`, report);
  fixNum(c.policy as unknown as Record<string, number>, 'corporateTax', 15, 0, 60, `${c.id}.policy`, report);
  fixNum(c.policy as unknown as Record<string, number>, 'tariff', 5, 0, 60, `${c.id}.policy`, report);
  fixNum(c.policy as unknown as Record<string, number>, 'interestRate', 3, 0, 25, `${c.id}.policy`, report);
  for (const k of Object.keys(c.policy.spending) as (keyof typeof c.policy.spending)[]) {
    fixNum(c.policy.spending as unknown as Record<string, number>, k, 2, 0, 12, `${c.id}.policy.spending`, report);
  }

  /* Capacités sectorielles : plancher vital garanti (55). Répare les mondes
     anciens dont l'agriculture/énergie se sont effondrées par usure longue —
     la production de nourriture ne doit jamais disparaître structurellement. */
  for (const key of Object.keys(c.sectors) as (keyof typeof c.sectors)[]) {
    const s = c.sectors[key];
    if (!s) continue;
    fixNum(s as unknown as Record<string, number>, 'capacity', 100, 55, 190, `${c.id}.sectors.${key}`, report);
  }

  for (const key of RESOURCE_KEYS) {
    const r = c.resources[key];
    if (!r) {
      report.issues.push(`${c.id}.resources.${key} manquant`);
      report.fixed++;
      continue;
    }
    const ro = r as unknown as Record<string, number>;
    fixNum(ro, 'stock', r.capacity * 0.4, 0, 1e9, `${c.id}.res.${key}`, report);
    fixNum(ro, 'capacity', Math.max(r.stock * 2, 10), 1, 1e9, `${c.id}.res.${key}`, report);
    fixNum(ro, 'production', 0, 0, 1e8, `${c.id}.res.${key}`, report);
    fixNum(ro, 'consumption', 0, 0, 1e8, `${c.id}.res.${key}`, report);
    fixNum(ro, 'price', 1, 0.05, 1000, `${c.id}.res.${key}`, report);
  }

  for (const def of INFRA) {
    const infra = c.infra[def.key];
    if (!infra) {
      // Migration v1.16 : les nouveaux réseaux absents des mondes anciens
      // sont créés au niveau 0 (constructibles), sans spam d'intégrité.
      c.infra[def.key] = { level: 0 };
      report.issues.push(`${c.id}.infra.${def.key} manquant → créé (niveau 0)`);
      report.fixed++;
      continue;
    }
    fixNum(infra as unknown as Record<string, number>, 'level', 3, 0, def.maxLevel, `${c.id}.infra`, report);
  }

  for (const [otherId, rel] of Object.entries(c.relations)) {
    const ro = rel as unknown as Record<string, number>;
    fixNum(ro, 'score', 50, 0, 100, `${c.id}.rel.${otherId}`, report);
    fixNum(ro, 'trust', 50, 0, 100, `${c.id}.rel.${otherId}`, report);
    fixNum(ro, 'tradeVolume', 0, 0, 1e9, `${c.id}.rel.${otherId}`, report);
    rel.sanctionByUs = Boolean(rel.sanctionByUs);
    rel.sanctionByThem = Boolean(rel.sanctionByThem);
    if (!Array.isArray(rel.agreements)) {
      rel.agreements = [];
      report.issues.push(`${c.id}.rel.${otherId}.agreements invalide`);
      report.fixed++;
    }
  }

  if (!c.controller || (c.controller.kind !== 'ai' && c.controller.kind !== 'player')) {
    report.issues.push(`${c.id}.controller invalide → repris par l'IA`);
    c.controller = { kind: 'ai', userId: null, presidentName: 'Gouvernement IA', since: Date.now(), sinceDay: 0 };
    report.fixed++;
  }
  if (typeof c.controller.presidentName !== 'string' || !c.controller.presidentName) {
    c.controller.presidentName = c.controller.kind === 'player' ? 'Président' : 'Gouvernement IA';
    report.issues.push(`${c.id}.presidentName invalide`);
    report.fixed++;
  }
  if (!Array.isArray(c.series)) { c.series = []; report.fixed++; }
  if (!Array.isArray(c.history)) { c.history = []; report.fixed++; }
  if (!Array.isArray(c.alerts)) { c.alerts = []; report.fixed++; }
  if (!Array.isArray(c.activeEvents)) { c.activeEvents = []; report.fixed++; }
  if (!Array.isArray(c.projects)) { c.projects = []; report.fixed++; }
  if (!Array.isArray(c.laws)) { c.laws = []; report.fixed++; }
  if (!Array.isArray(c.transactions)) { c.transactions = []; report.fixed++; }
  if (!c.mandate) {
    c.mandate = { lowPopularityTicks: 0, risk: 'faible', warningsSent: 0, popularityTrend: 0 };
    report.fixed++;
  }
  if (!c.tariffOverrides) { c.tariffOverrides = {}; report.fixed++; }
  if (!c.actionCooldowns) { c.actionCooldowns = {}; report.fixed++; }
  if (!c.routePrefs) { c.routePrefs = {}; report.fixed++; }
  // Régime politique : champs de transition (migration v1.11)
  if (typeof c.regimeSinceDay !== 'number' || !Number.isFinite(c.regimeSinceDay)) { c.regimeSinceDay = 0; report.fixed++; }
  if (!('regimeHoneymoon' in c) || (c.regimeHoneymoon !== null && (typeof c.regimeHoneymoon !== 'object' || !Number.isFinite(c.regimeHoneymoon?.untilDay)))) {
    c.regimeHoneymoon = null;
    report.fixed++;
  }
  if (!REGIME_MAP[c.regime]) { c.regime = 'République parlementaire'; report.fixed++; }
  // Mémoire d'apprentissage IA (migration des mondes antérieurs à la v1.9)
  if (!c.ai) {
    c.ai = {
      personality: {
        strategy: 'commerciale', tradeOpenness: 0.5, diplomacy: 0.5, taxPreference: 0.5,
        debtTolerance: 0.5, stabilityFocus: 0.5, growthFocus: 0.5, sectorFocus: {},
      },
      lastDecisionTick: 0, nextDecisionTick: 0, lastActionDay: 0, recentProblems: [],
      learned: {}, lastMoves: [], memory: null,
    };
    report.fixed++;
  }
  if (!c.ai.learned || typeof c.ai.learned !== 'object') { c.ai.learned = {}; report.fixed++; }
  if (!Array.isArray(c.ai.lastMoves)) { c.ai.lastMoves = []; report.fixed++; }
  if ((c.ai as { memory?: unknown }).memory === undefined) { c.ai.memory = null; report.fixed++; }
  if (!c.productionDirectives || typeof c.productionDirectives !== 'object') {
    c.productionDirectives = {};
    report.fixed++;
  } else {
    for (const [k, v] of Object.entries(c.productionDirectives)) {
      if (v !== 'boost' && v !== 'slow') delete c.productionDirectives[k as ResourceKey];
    }
  }
  // Bâtiments de production : structure complète garantie (migration des vieux mondes)
  if (!c.facilities || typeof c.facilities !== 'object') {
    c.facilities = {} as Country['facilities'];
    report.fixed++;
  }
  for (const f of FACILITIES) {
    const st = c.facilities[f.key];
    if (!st || typeof st !== 'object') {
      c.facilities[f.key] = { owned: 0, queue: [] };
      report.fixed++;
      continue;
    }
    if (!Number.isFinite(st.owned) || st.owned < 0) { st.owned = 0; report.fixed++; }
    st.owned = Math.min(Math.round(st.owned), f.maxOwned);
    if (!Array.isArray(st.queue)) { st.queue = []; report.fixed++; }
    st.queue = st.queue.filter((q) => q && Number.isFinite(q.count) && q.count > 0 && Number.isFinite(q.readyDay));
  }

  // Séries bornées (taille documentaire maîtrisée = bande passante maîtrisée)
  if (c.series.length > 160) c.series = c.series.slice(-160);
  if (c.history.length > 150) c.history = c.history.slice(-150);
  if (c.transactions.length > 60) c.transactions = c.transactions.slice(-60);
  if (c.alerts.length > 30) c.alerts = c.alerts.slice(-30);

  return report;
}

export function sanitizeMarket(market: Record<ResourceKey, MarketResource>): IntegrityReport {
  const report: IntegrityReport = { issues: [], fixed: 0 };
  for (const key of RESOURCE_KEYS) {
    const m = market[key];
    if (!m) {
      report.issues.push(`market.${key} manquant`);
      report.fixed++;
      continue;
    }
    const mo = m as unknown as Record<string, number>;
    fixNum(mo, 'price', 1, 0.05, 1000, 'market', report);
    fixNum(mo, 'prevPrice', m.price, 0.05, 1000, 'market', report);
    fixNum(mo, 'change24h', 0, -90, 900, 'market', report);
    if (!Array.isArray(m.series)) {
      m.series = [m.price];
      report.fixed++;
    }
    m.series = m.series.filter((v) => Number.isFinite(v)).slice(-300);
    if (m.series.length > 300) m.series = m.series.slice(-300);
  }
  return report;
}

export function sanitizeMeta(meta: WorldMeta): IntegrityReport {
  const report: IntegrityReport = { issues: [], fixed: 0 };
  const mo = meta as unknown as Record<string, number>;
  fixNum(mo, 'version', 1, 0, Number.MAX_SAFE_INTEGER, 'meta', report);
  fixNum(mo, 'tick', 0, 0, Number.MAX_SAFE_INTEGER, 'meta', report);
  fixNum(mo, 'day', 0, 0, Number.MAX_SAFE_INTEGER, 'meta', report);
  fixNum(mo, 'startedAt', Date.now(), 0, Number.MAX_SAFE_INTEGER, 'meta', report);
  fixNum(mo, 'lastTickAt', Date.now(), 0, Number.MAX_SAFE_INTEGER, 'meta', report);
  return report;
}

export function reportIssues(where: string, report: IntegrityReport): void {
  if (report.fixed === 0) return;
  log.warn(`${where} : ${report.fixed} valeur(s) corrigée(s)`, report.issues.slice(0, 10));
}
