/**
 * GEOPOLIS — Simulation : événements dynamiques.
 * Les événements ne sont jamais purement aléatoires : chacun se déclenche
 * sur des conditions économiques/politiques réelles du pays, avec une durée
 * et des modificateurs appliqués par les autres sous-systèmes.
 */
import type { ActiveEvent, Country } from 'shared';
import { EVENT_CATALOG } from 'shared';
import { uid, clamp, round } from '../util/core.js';
import { debtRatio, importDependency, infraAvg, relationsAvg, sectorShare, stockRatio } from './model.js';

export interface EventPhaseResult {
  created: ActiveEvent[];
  ended: ActiveEvent[];
}

/** Évalue une condition du catalogue sur l'état réel du pays. */
export function evalCondition(condition: string, c: Country): boolean {
  const vars: Record<string, number> = {
    energyStockRatio: stockRatio(c, 'energy'),
    foodStockRatio: stockRatio(c, 'food'),
    popularity: c.popularity,
    living: c.economy.standardOfLiving,
    growth: c.economy.growth,
    techSector: sectorShare(c, 'tech') * 100,
    researchSpend: c.policy.spending.research,
    debtRatio: debtRatio(c),
    balance: c.economy.gdp > 0 ? (c.economy.balance / c.economy.gdp) * 100 : 0,
    logisticsLevel: c.infra.logistics?.level ?? 0,
    tradeVolume: Object.values(c.relations).reduce((s, r) => s + r.tradeVolume, 0),
    unemployment: c.economy.unemployment,
    educationSpend: c.policy.spending.education,
    infraAvg: infraAvg(c),
    importDependency: importDependency(c),
    relationsAvg: relationsAvg(c),
    tradeOpenness: c.ai.personality.tradeOpenness * 100,
  };
  // grammaire limitée : comparaisons et && (pas d'eval dynamique)
  return condition.split('&&').every((clause) => {
    const m = clause.trim().match(/^([A-Za-z]+)\s*(<|>|<=|>=)\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return false;
    const [, name, op, raw] = m;
    const left = vars[name ?? ''] ?? 0;
    const right = Number(raw);
    switch (op) {
      case '<': return left < right;
      case '>': return left > right;
      case '<=': return left <= right;
      case '>=': return left >= right;
      default: return false;
    }
  });
}

export function processEvents(c: Country, day: number, rng: () => number): EventPhaseResult {
  const result: EventPhaseResult = { created: [], ended: [] };

  // Expiration
  const stillActive: ActiveEvent[] = [];
  for (const ev of c.activeEvents) {
    if (ev.endsDay <= day) result.ended.push(ev);
    else stillActive.push(ev);
  }
  c.activeEvents = stillActive;

  // Déclenchement (max 1 nouveau par jour et par pays, probabilité bornée)
  if (c.activeEvents.length < 4 && rng() < 0.3) {
    const candidates = EVENT_CATALOG.filter(
      (def) => !c.activeEvents.some((e) => e.eventId === def.id) && evalCondition(def.condition, c),
    );
    if (candidates.length > 0) {
      const totalWeight = candidates.reduce((s, d) => s + d.weight, 0);
      let roll = rng() * totalWeight;
      let chosen = candidates[0]!;
      for (const cand of candidates) {
        roll -= cand.weight;
        if (roll <= 0) {
          chosen = cand;
          break;
        }
      }
      const duration = Math.round(chosen.minDays + rng() * (chosen.maxDays - chosen.minDays));
      const ev: ActiveEvent = {
        id: uid('evt'),
        eventId: chosen.id,
        title: chosen.title,
        description: chosen.description,
        countryIds: [c.id],
        startedDay: day,
        endsDay: day + duration,
        source: describeSource(chosen.condition, c),
        modifiers: structuredClone(chosen.modifiers),
      };
      c.activeEvents.push(ev);
      result.created.push(ev);
    }
  }
  return result;
}

function describeSource(condition: string, c: Country): string {
  if (condition.includes('energyStockRatio')) return `Stocks énergétiques à ${(stockRatio(c, 'energy') * 100).toFixed(0)} %`;
  if (condition.includes('foodStockRatio')) return `Stocks alimentaires à ${(stockRatio(c, 'food') * 100).toFixed(0)} %`;
  if (condition.includes('debtRatio')) return `Dette à ${debtRatio(c).toFixed(0)} % du PIB`;
  if (condition.includes('unemployment')) return `Chômage à ${c.economy.unemployment.toFixed(1)} %`;
  if (condition.includes('growth')) return `Croissance à ${c.economy.growth.toFixed(1)} %`;
  if (condition.includes('importDependency')) return `Dépendance aux importations : ${(importDependency(c) * 100).toFixed(0)} %`;
  if (condition.includes('popularity')) return `Popularité à ${round(clamp(c.popularity, 0, 100), 0)} %`;
  return 'Conjoncture économique';
}

/* ------------------------------------------------------------------ */
/* Événements DIPLOMATIQUES : déclenchés par les actions réelles des    */
/* pays (accords, sanctions, aides, coopérations).                      */
/* ------------------------------------------------------------------ */

export type DiplomaticEventKind = 'accord' | 'sanction' | 'thaw' | 'aid' | 'tech';

const DIPLO_EVENTS: Record<DiplomaticEventKind, { id: string; title: string; description: string; minDays: number; maxDays: number; modifiers: import('shared').EventModifiers }> = {
  accord: {
    id: 'diplomatic_accord',
    title: 'Accord commercial signé',
    description: 'La signature d’un accord dynamise les échanges : nouveaux débouchés, confiance des acteurs économiques.',
    minDays: 10, maxDays: 16,
    modifiers: { growthDelta: 0.35, popularityDelta: 0.04 },
  },
  sanction: {
    id: 'trade_tension',
    title: 'Tension commerciale',
    description: 'Des mesures économiques suspendent les échanges : contraction de l’activité, hausse des prix, mécontentement.',
    minDays: 12, maxDays: 20,
    modifiers: { growthDelta: -0.45, inflationDelta: 0.5, popularityDelta: -0.06, stabilityDelta: -0.05 },
  },
  thaw: {
    id: 'economic_thaw',
    title: 'Dégel économique',
    description: 'La levée des mesures économiques relance les flux bilatéraux et apaise l’opinion.',
    minDays: 8, maxDays: 14,
    modifiers: { growthDelta: 0.25, popularityDelta: 0.04 },
  },
  aid: {
    id: 'cooperation_wave',
    title: 'Vague de coopération',
    description: 'Une aide économique reçue stimule l’activité et renforce la cohésion sociale.',
    minDays: 8, maxDays: 14,
    modifiers: { growthDelta: 0.3, stabilityDelta: 0.06, popularityDelta: 0.03 },
  },
  tech: {
    id: 'tech_partnership',
    title: 'Partenariat technologique',
    description: 'Le partage de savoir-faire accélère l’innovation des deux partenaires.',
    minDays: 10, maxDays: 18,
    modifiers: { growthDelta: 0.3, productionMul: { tech: 1.06 } },
  },
};

/** Crée un événement réel lié à une action diplomatique, sur les pays concernés. */
export function spawnDiplomaticEvent(
  world: import('../world/world.js').WorldStore,
  countryIds: string[],
  kind: DiplomaticEventKind,
  source: string,
  rng: () => number = Math.random,
): import('shared').ActiveEvent | null {
  const def = DIPLO_EVENTS[kind];
  if (!def) return null;
  const day = world.meta.day;
  const duration = Math.round(def.minDays + rng() * (def.maxDays - def.minDays));
  const ev: import('shared').ActiveEvent = {
    id: uid('evt'),
    eventId: def.id,
    title: def.title,
    description: def.description,
    countryIds,
    startedDay: day,
    endsDay: day + duration,
    source,
    modifiers: structuredClone(def.modifiers),
  };
  for (const cid of countryIds) {
    const c = world.country(cid);
    if (!c) continue;
    if (c.activeEvents.some((e) => e.eventId === def.id && e.endsDay > day)) continue; // pas de doublon
    c.activeEvents.push(ev);
    if (c.activeEvents.length > 6) c.activeEvents.shift();
    world.markDirty(cid);
  }
  world.addJournal({
    day, type: 'event', countryIds, actor: 'Diplomatie',
    text: `${def.title} — ${source}.`,
  });
  return ev;
}
