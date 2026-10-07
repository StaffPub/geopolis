/**
 * GEOPOLIS — Modèle : helpers partagés par les sous-systèmes de simulation.
 * Chaque fonction est pure autant que possible pour rester testable.
 */
import type { Country, InfraKey, ResourceKey, SectorKey, SpendingKey } from 'shared';
import { LAWS, RESOURCE_KEYS } from 'shared';
import { DEMAND_PER_CAP } from '../world/seed.js';
import { clamp } from '../util/core.js';
const LAWS_BY_ID = Object.fromEntries(LAWS.map((l) => [l.id, l]));

export interface InfraEffects {
  logistics: number;        // multiplicateur volumes commerciaux
  productivity: number;     // multiplicateur productivité
  energySupply: number;     // multiplicateur production/distribution d'énergie
  industrial: number;       // multiplicateur capacité industrielle
  tech: number;             // multiplicateur capacité technologique
  services: number;         // bonus niveau de vie
  upkeepAnnual: number;     // Md € / an
  exportCap: number;        // multiplicateur capacité d'export (ports, aéroports)
  foodMul: number;          // multiplicateur production agricole (irrigation)
  growthBonus: number;      // points de croissance potentielle (recherche)
  revenueBonus: number;     // multiplicateur additif de recettes (place financière)
  debtRateCut: number;      // points retirés au taux d'intérêt de la dette
  popDaily: number;         // popularité / jour (culture)
  stabDaily: number;        // stabilité / jour (culture)
}

export function infraEffects(c: Country): InfraEffects {
  const lvl = (k: InfraKey) => c.infra[k]?.level ?? 0;
  const gdpScale = 0.5 + c.economy.gdp / 6000;
  let upkeep = 0;
  for (const k of Object.keys(c.infra) as InfraKey[]) {
    upkeep += (c.infra[k]?.level ?? 0) * upkeepPerLevel(k) * gdpScale;
  }
  return {
    logistics: 1 + (lvl('roads') + lvl('rail') + lvl('logistics')) * 0.012 + lvl('ports') * 0.018 + lvl('airports') * 0.01,
    productivity: 1 + lvl('schools') * 0.006 + lvl('universities') * 0.008 + lvl('roads') * 0.004 + lvl('powerGrid') * 0.004 + lvl('telecom') * 0.012,
    energySupply: 1 + lvl('plants') * 0.014 + lvl('powerGrid') * 0.01,
    industrial: 1 + lvl('industrialZones') * 0.02 + lvl('rail') * 0.008 + lvl('ports') * 0.006,
    tech: 1 + lvl('techHubs') * 0.018 + lvl('universities') * 0.012 + lvl('telecom') * 0.02 + lvl('research') * 0.02,
    services: lvl('hospitals') * 0.6 + lvl('housing') * 0.5 + lvl('schools') * 0.4 + lvl('universities') * 0.3 + lvl('culture') * 0.2 + lvl('finance') * 0.2,
    upkeepAnnual: upkeep,
    exportCap: 1 + lvl('airports') * 0.06 + lvl('ports') * 0.01,
    foodMul: 1 + lvl('water') * 0.03,
    growthBonus: lvl('research') * 0.05,
    revenueBonus: lvl('finance') * 0.015,
    debtRateCut: lvl('finance') * 0.15,
    popDaily: lvl('culture') * 0.01,
    stabDaily: lvl('culture') * 0.008,
  };
}

const UPKEEP: Partial<Record<InfraKey, number>> = {
  roads: 0.5, rail: 0.7, ports: 0.5, powerGrid: 0.6, plants: 0.9, housing: 0.3,
  schools: 0.5, universities: 0.8, hospitals: 0.8, industrialZones: 0.7, techHubs: 0.9, logistics: 0.5,
  airports: 0.9, telecom: 0.7, research: 1.0, water: 0.5, finance: 0.8, culture: 0.4,
};
function upkeepPerLevel(k: InfraKey): number {
  return UPKEEP[k] ?? 0.5;
}

export interface LawEffects {
  productivity: number;     // additif (0.04 = +4 %)
  consumption: number;
  growth: number;
  popularityDaily: number;
  stabilityDaily: number;
  inflation: number;
  sectorBoost: Partial<Record<SectorKey, number>>;
  resourceEfficiency: number;
}

export function lawEffects(c: Country): LawEffects {  const out: LawEffects = {
    productivity: 0, consumption: 0, growth: 0, popularityDaily: 0, stabilityDaily: 0,
    inflation: 0, sectorBoost: {}, resourceEfficiency: 0,
  };
  for (const law of c.laws) {
    const def = LAWS_BY_ID[law.lawId];
    if (!def) continue;
    const m = def.modifiers;
    out.productivity += m.productivity ?? 0;
    out.consumption += m.consumption ?? 0;
    out.growth += m.growth ?? 0;
    out.popularityDaily += (m.popularity ?? 0) / 7; // effet catalogue hebdo → quotidien
    out.stabilityDaily += (m.stability ?? 0) / 7;
    out.inflation += m.inflation ?? 0;
    out.resourceEfficiency += m.resourceEfficiency ?? 0;
    for (const [k, v] of Object.entries(m.sectorBoost ?? {})) {
      const key = k as SectorKey;
      out.sectorBoost[key] = (out.sectorBoost[key] ?? 0) + (v ?? 0);
    }
  }
  return out;
}


export interface EventAgg {
  productionMul: Record<SectorKey, number>;
  consumptionMul: Record<ResourceKey, number>;
  priceMul: Record<ResourceKey, number>;
  popularityDaily: number;
  stabilityDaily: number;
  growthDelta: number;
  inflationDelta: number;
  unemploymentDelta: number;
  count: number;
}

export function aggregateEventModifiers(c: Country): EventAgg {
  const agg: EventAgg = {
    productionMul: { agriculture: 1, industry: 1, energy: 1, services: 1, tech: 1 },
    consumptionMul: Object.fromEntries(RESOURCE_KEYS.map((k) => [k, 1])) as Record<ResourceKey, number>,
    priceMul: Object.fromEntries(RESOURCE_KEYS.map((k) => [k, 1])) as Record<ResourceKey, number>,
    popularityDaily: 0,
    stabilityDaily: 0,
    growthDelta: 0,
    inflationDelta: 0,
    unemploymentDelta: 0,
    count: 0,
  };
  for (const ev of c.activeEvents) {
    const m = ev.modifiers;
    agg.count++;
    if (m.productionMul) for (const [k, v] of Object.entries(m.productionMul)) {
      agg.productionMul[k as SectorKey] *= v ?? 1;
    }
    if (m.consumptionMul) for (const [k, v] of Object.entries(m.consumptionMul)) {
      agg.consumptionMul[k as ResourceKey] *= v ?? 1;
    }
    if (m.priceMul) for (const [k, v] of Object.entries(m.priceMul)) {
      agg.priceMul[k as ResourceKey] *= v ?? 1;
    }
    agg.popularityDaily += m.popularityDelta ?? 0;
    agg.stabilityDaily += m.stabilityDelta ?? 0;
    agg.growthDelta += m.growthDelta ?? 0;
    agg.inflationDelta += m.inflationDelta ?? 0;
    agg.unemploymentDelta += m.unemploymentDelta ?? 0;
  }
  return agg;
}

export function stockRatio(c: Country, key: ResourceKey): number {
  const r = c.resources[key];
  return r.capacity > 0 ? clamp(r.stock / r.capacity, 0, 1) : 0;
}

export function infraAvg(c: Country): number {
  const keys = Object.keys(c.infra) as InfraKey[];
  if (keys.length === 0) return 0;
  return keys.reduce((s, k) => s + (c.infra[k]?.level ?? 0), 0) / keys.length;
}

export function spendingSum(c: Country): number {
  return Object.values(c.policy.spending).reduce((a, b) => a + b, 0);
}

export function debtRatio(c: Country): number {
  return c.economy.gdp > 0 ? (c.economy.debt / c.economy.gdp) * 100 : 0;
}

export function activeAgreementCount(c: Country, otherId?: string): number {
  let n = 0;
  for (const [oid, rel] of Object.entries(c.relations)) {
    if (otherId && oid !== otherId) continue;
    n += rel.agreements.filter((a) => a.status === 'active').length;
  }
  return n;
}

export function hasAgreement(c: Country, otherId: string, type?: string): boolean {
  const rel = c.relations[otherId];
  if (!rel) return false;
  return rel.agreements.some((a) => a.status === 'active' && (type === undefined || a.type === type));
}

/** Part des besoins couverts par les importations (dépendance). */
export function importDependency(c: Country): number {
  let imported = 0;
  let total = 0;
  for (const key of RESOURCE_KEYS) {
    const r = c.resources[key];
    total += r.consumption;
    imported += Math.max(0, r.consumption - r.production);
  }
  return total > 0 ? imported / total : 0;
}

export function relationsAvg(c: Country): number {
  const vals = Object.values(c.relations);
  if (vals.length === 0) return 50;
  return vals.reduce((s, r) => s + r.score, 0) / vals.length;
}

/** Demande quotidienne des ménages (hors industrie), en unités. */
export function householdDemand(c: Country, key: ResourceKey, consIdx: number): number {
  const perCap = DEMAND_PER_CAP[key];
  switch (key) {
    case 'food': return c.population * perCap;
    case 'energy': return c.population * perCap * 0.55;
    case 'oil': return c.population * perCap * 0.7;
    case 'gas': return c.population * perCap;
    case 'minerals': return 0;
    case 'materials': return 0;
    case 'industrial': return c.population * perCap * (consIdx / 100);
    case 'tech': return c.population * perCap * (consIdx / 110);
  }
}

export function sectorShare(c: Country, key: SectorKey): number {
  const total = Object.values(c.sectors).reduce((s, x) => s + x.output, 0);
  return total > 0 ? (c.sectors[key]?.output ?? 0) / total : 0.2;
}

export function spend(c: Country, key: SpendingKey): number {
  return c.policy.spending[key] ?? 0;
}
