/**
 * GEOPOLIS — Simulation : production quotidienne par ressource.
 * Chaîne causale : politiques/infrastructures → capacités sectorielles →
 * productivité → production. Les pénuries d'intrants (énergie, matières)
 * réduisent la production industrielle et technologique.
 */
import type { Country, FacilityKey, ResourceKey } from 'shared';
import { FACILITY_MAP, facilityOutput } from 'shared';
import { DEMAND_PER_CAP } from '../world/seed.js';
import { RESOURCE_MAP } from 'shared';

/** Prix de référence catalogue (Md €/unité échelle jeu). */
function basePrice(k: ResourceKey): number {
  return RESOURCE_MAP[k].basePrice;
}
import { clamp, round } from '../util/core.js';
import {
  aggregateEventModifiers,
  infraEffects,
  lawEffects,
  stockRatio,
  type EventAgg,
  type InfraEffects,
  type LawEffects,
} from './model.js';

export interface ProductionResult {
  production: Record<ResourceKey, number>;
  consumption: Record<ResourceKey, number>;
  unmet: Record<ResourceKey, number>; // 0..1 : part de la demande non satisfaite
  energyStrain: number;               // 0..1 : intensité de la pénurie énergétique
}

export function computeProduction(
  c: Country,
  infra: InfraEffects,
  laws: LawEffects,
  events: EventAgg,
): Record<ResourceKey, number> {
  const prod = {} as Record<ResourceKey, number>;
  const endow = c.endowment;
  const cap = (sector: keyof Country['sectors']) => (c.sectors[sector]?.capacity ?? 100) / 100;
  const boost = (sector: keyof Country['sectors']) => 1 + (laws.sectorBoost[sector] ?? 0);
  const prodEff = (c.economy.productivity / 100) * infra.productivity;

  const e = endow;
  prod.food = c.population * DEMAND_PER_CAP.food * (0.42 + (e.food ?? 0.3) * 1.15)
    * cap('agriculture') * boost('agriculture') * events.productionMul.agriculture
    * (1 + laws.resourceEfficiency * 0.3);
  prod.energy = c.population * DEMAND_PER_CAP.energy * (0.45 + (e.energy ?? 0.3) * 1.05)
    * cap('energy') * boost('energy') * infra.energySupply * events.productionMul.energy;
  prod.oil = c.population * DEMAND_PER_CAP.oil * (0.35 + (e.oil ?? 0.1) * 1.3)
    * cap('energy') * events.productionMul.energy;
  prod.gas = c.population * DEMAND_PER_CAP.gas * (0.35 + (e.gas ?? 0.1) * 1.3)
    * cap('energy') * events.productionMul.energy;
  prod.minerals = c.population * DEMAND_PER_CAP.minerals * (0.35 + (e.minerals ?? 0.3) * 1.35)
    * cap('industry') * 0.9 * events.productionMul.industry;
  prod.materials = c.population * DEMAND_PER_CAP.materials * (0.35 + (e.materials ?? 0.3) * 1.3)
    * cap('industry') * events.productionMul.industry
    * (0.85 + stockRatio(c, 'minerals') * 0.3);
  prod.industrial = c.population * DEMAND_PER_CAP.industrial * (0.55 + 0.55)
    * cap('industry') * boost('industry') * infra.industrial * prodEff * 0.85
    * events.productionMul.industry;
  prod.tech = c.population * DEMAND_PER_CAP.tech * (0.4 + 0.75)
    * cap('tech') * boost('tech') * infra.tech * prodEff * 0.9
    * events.productionMul.tech;

  for (const k of Object.keys(prod) as ResourceKey[]) {
    prod[k] = round(Math.max(0, prod[k]), 2);
  }
  // Irrigation & hydraulique : bonus réel sur la production agricole.
  prod.food = round(prod.food * infra.foodMul, 2);

  /* Consignes de production du gouvernement (onglet Ressources) :
     boost = heures supplémentaires + intrants achetés (+15 %, subventionné),
     slow  = mise au ralenti / reconversion (−12 %, économies réalisées). */
  const directives = c.productionDirectives ?? {};
  for (const k of Object.keys(prod) as ResourceKey[]) {
    const d = directives[k];
    if (d === 'boost') prod[k] = round(prod[k] * PRODUCTION_BOOST_MUL, 2);
    else if (d === 'slow') prod[k] = round(prod[k] * PRODUCTION_SLOW_MUL, 2);
  }

  /* Bâtiments de production (onglet Production) : rendement réel ajouté,
     mis à l'échelle de la main-d'œuvre du pays. Seuls les bâtiments LIVRÉS
     produisent (la file de construction est traitée par deliverFacilities). */
  if (c.facilities) {
    for (const key of Object.keys(c.facilities) as FacilityKey[]) {
      const def = FACILITY_MAP[key];
      const owned = c.facilities[key]?.owned ?? 0;
      if (!def || owned <= 0) continue;
      prod[def.resource] = round((prod[def.resource] ?? 0) + facilityOutput(def, owned, c.population), 2);
    }
  }
  // v19 : ÉLASTICITÉ de l'OFFRE — sous ~60 % du prix de référence, les
  // producteurs coupent leur sortie (non rentable) ; au-dessus, ils poussent.
  // Avec l'élasticité de la demande, les cours convergent au lieu de coller
  // au plancher ou au plafond.
  for (const k of Object.keys(prod) as ResourceKey[]) {
    const price = c.resources[k]?.price ?? basePrice(k);
    const supply = clamp(Math.pow(price / basePrice(k), 0.3), 0.72, 1.12);
    prod[k] = round(prod[k] * supply, 2);
  }
  return prod;
}

/** Livre les bâtiments dont la construction est terminée (queue → owned).
 *  Retourne les noms livrés (pour journal/notifications). */
export function deliverFacilities(c: Country, day: number): string[] {
  const delivered: string[] = [];
  if (!c.facilities) return delivered;
  for (const key of Object.keys(c.facilities) as FacilityKey[]) {
    const def = FACILITY_MAP[key];
    const st = c.facilities[key];
    if (!def || !st || st.queue.length === 0) continue;
    const ready = st.queue.filter((q) => q.readyDay <= day);
    if (ready.length === 0) continue;
    let added = 0;
    for (const q of ready) added += q.count;
    st.queue = st.queue.filter((q) => q.readyDay > day);
    st.owned = Math.min(def.maxOwned, st.owned + added);
    delivered.push(added > 1 ? `${added} × ${def.name}` : def.name);
  }
  return delivered;
}

/** Entretien quotidien total (Md €/jour) des bâtiments possédés. */
export function facilitiesDailyUpkeep(c: Country): number {
  let sum = 0;
  if (!c.facilities) return 0;
  for (const key of Object.keys(c.facilities) as FacilityKey[]) {
    const def = FACILITY_MAP[key];
    const owned = c.facilities[key]?.owned ?? 0;
    if (def && owned > 0) sum += def.upkeepPerDay * owned;
  }
  return round(sum, 4);
}

/** Recalcule IMMÉDIATEMENT les taux production/consommation affichés (sans
 *  toucher aux stocks) : utilisé quand une consigne change en cours de tick,
 *  pour que les onglets Ressources ET Production soient synchronisés à la
 *  seconde, sans attendre le tick suivant. */
export function refreshProductionRates(c: Country): void {
  const infra = infraEffects(c);
  const laws = lawEffects(c);
  const events = aggregateEventModifiers(c);
  const prod = computeProduction(c, infra, laws, events);
  const { consumption } = computeConsumption(c, prod, events);
  for (const key of Object.keys(c.resources) as ResourceKey[]) {
    c.resources[key].production = prod[key] ?? 0;
    c.resources[key].consumption = consumption[key] ?? 0;
  }
}

export const PRODUCTION_BOOST_MUL = 1.15;
/** Plancher de capacité sectorielle : jamais sous ce seuil (production vitale garantie). */
export const SECTOR_CAPACITY_FLOOR = 55;
export const PRODUCTION_SLOW_MUL = 0.88;
/** Coût quotidien d'un boost (fraction du PIB) et économie quotidienne d'un ralenti. */
export const BOOST_DAILY_COST_PCT_GDP = 0.00012;
export const SLOW_DAILY_SAVING_PCT_GDP = 0.00006;

/** Coût net quotidien (Md €/jour) des consignes de production d'un pays. */
export function directiveDailyCost(c: Country): number {
  const directives = c.productionDirectives ?? {};
  let net = 0;
  for (const v of Object.values(directives)) {
    if (v === 'boost') net += c.economy.gdp * BOOST_DAILY_COST_PCT_GDP;
    else if (v === 'slow') net -= c.economy.gdp * SLOW_DAILY_SAVING_PCT_GDP;
  }
  return round(Math.max(-c.economy.gdp * 0.001, net), 4);
}

export function computeConsumption(
  c: Country,
  prod: Record<ResourceKey, number>,
  events: EventAgg,
): { consumption: Record<ResourceKey, number>; unmet: Record<ResourceKey, number>; energyStrain: number } {
  const consIdx = c.economy.consumptionIndex;
  const cons = {} as Record<ResourceKey, number>;
  const unmet = {} as Record<ResourceKey, number>;
  const perCap = DEMAND_PER_CAP;

  // Demande des ménages
  cons.food = c.population * perCap.food * events.consumptionMul.food;
  cons.energy = c.population * perCap.energy * 0.55 * (0.7 + consIdx / 300) * events.consumptionMul.energy;
  cons.oil = c.population * perCap.oil * 0.7 * events.consumptionMul.oil;
  cons.gas = c.population * perCap.gas * events.consumptionMul.gas;
  cons.industrial = c.population * perCap.industrial * (consIdx / 100) * events.consumptionMul.industrial;
  cons.tech = c.population * perCap.tech * (consIdx / 110) * events.consumptionMul.tech;

  // Demande industrielle (intrants)
  const industryNeedEnergy = prod.industrial * 0.55 + prod.materials * 0.3;
  const industryNeedMinerals = prod.industrial * 0.18 + prod.materials * 0.25;
  const industryNeedMaterials = prod.industrial * 0.42;
  const techNeedIndustrial = prod.tech * 0.4;

  cons.energy += industryNeedEnergy;
  cons.minerals = industryNeedMinerals * events.consumptionMul.minerals;
  cons.materials = industryNeedMaterials * events.consumptionMul.materials;
  cons.industrial += techNeedIndustrial;
  // v19 : l'industrie moderne consomme aussi de la tech (intrants high-tech) —
  // résorbe le surplus structurel mondial de technologie.
  cons.tech += prod.industrial * 0.1;

  // Efficacité (lois de transition, etc.)
  const efficiency = 1 - Math.min(0.2, (c.laws.some((l) => l.lawId === 'green_transition') ? 0.06 : 0));
  for (const k of Object.keys(cons) as ResourceKey[]) {
    // v19 : ÉLASTICITÉ-PRIX de la demande — prix bas → on consomme davantage
    // (résorbe les surstocks), prix hauts → demande comprimée (amortit les
    // pénuries). Boucle de rappel négative qui stabilise les cours mondiaux.
    const price = c.resources[k]?.price ?? basePrice(k);
    const elasticity = clamp(Math.pow(basePrice(k) / Math.max(0.05, price), 0.25), 0.8, 1.3);
    cons[k] = round(Math.max(0, cons[k] * efficiency * elasticity * (1 + (events.consumptionMul[k] - 1) * 0.5)), 2);
  }

  // Tension énergétique : si l'énergie manque, l'industrie tourne au ralenti
  const energyAvailable = c.resources.energy.stock + prod.energy;
  const energyStrain = energyAvailable > 0
    ? clamp(1 - energyAvailable / Math.max(1, cons.energy * 1.15), 0, 1)
    : 1;

  return { consumption: cons, unmet, energyStrain };
}

/**
 * Applique production/consommation aux stocks et calcule la part non satisfaite.
 * Renvoie les pénuries pour que l'économie et la politique en subissent les conséquences.
 */
export function applyFlows(c: Country, prod: Record<ResourceKey, number>, cons: Record<ResourceKey, number>): Record<ResourceKey, number> {
  const unmet = {} as Record<ResourceKey, number>;
  for (const key of Object.keys(c.resources) as ResourceKey[]) {
    const r = c.resources[key];
    r.production = prod[key] ?? 0;
    r.consumption = cons[key] ?? 0;
    const net = r.production - r.consumption;
    const before = r.stock;
    r.stock = round(clamp(r.stock + net, 0, r.capacity), 1);
    // Demande non satisfaite : stock vide + production insuffisante
    const supplied = Math.min(r.consumption, before + Math.max(0, net));
    unmet[key] = r.consumption > 0 ? clamp(1 - supplied / r.consumption, 0, 1) : 0;
  }
  return unmet;
}

/** Mise à jour lente des capacités sectorielles (investissement, pénuries, usure)
 *  et évolution structurelle des parts de PIB. */
export function updateSectorCapacities(
  c: Country,
  investRate: number,
  energyStrain: number,
  laws: LawEffects,
  events: EventAgg,
): void {
  const keys = Object.keys(c.sectors) as (keyof Country['sectors'])[];
  const shares: Record<string, number> = {};
  const total = totalOutput(c) || 1;
  for (const key of keys) {
    const s = c.sectors[key];
    let delta = 0;
    delta += (investRate - 0.15) * 6;                 // investissement global (palier neutre adouci)
    if (key === 'industry') {
      delta += (c.policy.spending.industry - 1.2) * 0.12;
      delta -= energyStrain * 1.4;                     // pénurie d'énergie → désindustrialisation
    }
    if (key === 'tech') {
      delta += (c.policy.spending.research - 1.0) * 0.16;
      delta += (laws.sectorBoost.tech ?? 0) * 0.4;
    }
    /* Secteurs VITAUX (agriculture, énergie) : seuils budgétaires abaissés pour
       que le budget par défaut les stabilise — la nourriture et l'énergie ne
       doivent jamais s'effondrer structurellement dans un monde long. */
    if (key === 'agriculture') delta += (c.policy.spending.agriculture - 0.9) * 0.14;
    if (key === 'energy') delta += (c.policy.spending.energy - 1.3) * 0.16;
    if (key === 'services') delta += (c.policy.spending.social - 3.0) * 0.03;
    delta += (events.productionMul[key] - 1) * 0.8;    // chocs temporaires
    delta -= 0.03;                                     // usure naturelle (adoucie)
    s.capacity = round(clamp(s.capacity + delta, SECTOR_CAPACITY_FLOOR, 190), 2);
    shares[key] = s.output / total;
  }
  // Évolution structurelle : les secteurs dont la capacité progresse gagnent des parts
  const avgCap = keys.reduce((s, k) => s + c.sectors[k].capacity, 0) / keys.length;
  let shareTotal = 0;
  for (const key of keys) {
    shares[key] = Math.max(0.01, shares[key] * (1 + (c.sectors[key].capacity / avgCap - 1) * 0.01));
    shareTotal += shares[key];
  }
  for (const key of keys) {
    const s = c.sectors[key];
    s.output = round((c.economy.gdp * shares[key]) / shareTotal, 1);
    s.employment = round(clamp((shares[key] / shareTotal) * 100 * 1.05, 0.5, 90), 1);
  }
}

function totalOutput(c: Country): number {
  return Object.values(c.sectors).reduce((s, x) => s + x.output, 0);
}

export function runProductionPhase(c: Country): { energyStrain: number; unmet: Record<ResourceKey, number> } {
  const infra = infraEffects(c);
  const laws = lawEffects(c);
  const events = aggregateEventModifiers(c);
  const prod = computeProduction(c, infra, laws, events);
  const { consumption, energyStrain } = computeConsumption(c, prod, events);
  const unmet = applyFlows(c, prod, consumption);
  // v19 : PERTE DE SURSTOCK — au-delà de 90 % d'occupation, 3 %/jour du stock
  // se périme (obsolescence, pourriture, pertes logistiques). Empêche
  // l'accumulation infinie qui effondrait les cours mondiaux.
  for (const k of Object.keys(c.resources) as ResourceKey[]) {
    const r = c.resources[k];
    if (r.capacity > 0 && r.stock > r.capacity * 0.9) {
      const loss = Math.min(r.stock - r.capacity * 0.9, r.stock * 0.03);
      r.stock = round(r.stock - loss, 2);
    }
  }
  return { energyStrain, unmet };
}
