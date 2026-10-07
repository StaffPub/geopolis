/**
 * GEOPOLIS — Simulation : dirigeants IA autonomes.
 * Cycle réel de décision (pas de valeurs aléatoires) :
 *   ANALYSER → IDENTIFIER LES PROBLÈMES → ÉVALUER LES OPTIONS →
 *   CHOISIR UNE ACTION → APPLIQUER (même couche que les joueurs) →
 *   OBSERVER → AJUSTER LA STRATÉGIE.
 * Cool-downs intégrés pour un comportement naturel et continu.
 */
import type { ActionParams, AiDecisionLog, Country, GameNotification, InfraKey, ResourceKey } from 'shared';
import { FACILITIES, FACILITY_MAP, INFRA_MAP, LAWS, REGIMES, RESOURCE_KEYS, RESOURCE_MAP, regimeAlignment } from 'shared';
import { createLogger } from '../logger.js';
import { executeAction, estimateAction, infraCost, VALUE_SCALE, type ActionContext } from '../actions/registry.js';
import { chooseRoute, routeOptions, type RouteCache } from './trade.js';
import { clamp, round } from '../util/core.js';
import type { WorldStore } from '../world/world.js';
import { debtRatio, stockRatio, importDependency } from './model.js';

const log = createLogger('AI');

export interface AiPhaseResult {
  decisions: Omit<AiDecisionLog, 'id' | 'ts'>[];
  actionsExecuted: number;
  proposalsAnswered: number;
}

interface Problem {
  key: string;
  severity: number;   // 0..1
  description: string;
}

interface Candidate {
  problem: Problem;
  params: ActionParams;
  benefit: number;    // intérêt brut
  category: string;
  rationale: string;
}

/* ------------------------------------------------------------------ */
/* 1. ANALYSER — diagnostic de l'état réel du pays                     */
/* ------------------------------------------------------------------ */

export function analyzeCountry(c: Country, world: WorldStore): Problem[] {
  const problems: Problem[] = [];
  const e = c.economy;
  const dr = debtRatio(c);
  const balPct = e.gdp > 0 ? (e.balance / e.gdp) * 100 : 0;

  if (balPct < -2.5) {
    problems.push({ key: 'deficit', severity: clamp(-balPct / 7, 0.2, 1), description: `Déficit à ${balPct.toFixed(1)} % du PIB` });
  }
  if (dr > 85) {
    problems.push({ key: 'debt', severity: clamp((dr - 85) / 40, 0.2, 1), description: `Dette à ${dr.toFixed(0)} % du PIB` });
  }
  if (e.cash < e.gdp * 0.012) {
    problems.push({ key: 'cash_low', severity: clamp(1 - e.cash / Math.max(0.001, e.gdp * 0.012), 0.3, 1), description: 'Trésorerie très basse' });
  }
  if (e.inflation > 5) {
    problems.push({ key: 'inflation', severity: clamp((e.inflation - 5) / 10, 0.2, 1), description: `Inflation à ${e.inflation.toFixed(1)} %` });
  }
  if (e.unemployment > 9) {
    problems.push({ key: 'unemployment', severity: clamp((e.unemployment - 9) / 10, 0.2, 1), description: `Chômage à ${e.unemployment.toFixed(1)} %` });
  }
  if (e.growth < 1) {
    problems.push({ key: 'low_growth', severity: clamp((1 - e.growth) / 4, 0.15, 1), description: `Croissance à ${e.growth.toFixed(1)} %` });
  }
  const energyRatio = stockRatio(c, 'energy');
  if (energyRatio < 0.4) {
    problems.push({ key: 'energy_short', severity: clamp((0.4 - energyRatio) / 0.3, 0.25, 1), description: `Stock énergétique à ${(energyRatio * 100).toFixed(0)} %` });
  }
  const foodRatio = stockRatio(c, 'food');
  if (foodRatio < 0.4) {
    problems.push({ key: 'food_short', severity: clamp((0.4 - foodRatio) / 0.3, 0.25, 1), description: `Stock alimentaire à ${(foodRatio * 100).toFixed(0)} %` });
  }
  for (const key of RESOURCE_KEYS) {
    if (stockRatio(c, key) > 0.82) {
      problems.push({ key: 'oversupply', severity: 0.35, description: `Surstock de ${key}` });
      break;
    }
  }
  if (c.popularity < 45) {
    problems.push({ key: 'low_popularity', severity: clamp((45 - c.popularity) / 25, 0.2, 1), description: `Popularité à ${c.popularity.toFixed(0)} %` });
  }
  if (c.stability < 50) {
    problems.push({ key: 'low_stability', severity: clamp((50 - c.stability) / 30, 0.2, 1), description: `Stabilité à ${c.stability.toFixed(0)} %` });
  }
  if (e.standardOfLiving < 40) {
    problems.push({ key: 'living_low', severity: clamp((40 - e.standardOfLiving) / 25, 0.15, 0.9), description: `Niveau de vie à ${e.standardOfLiving.toFixed(0)}` });
  }
  if (c.projects.length === 0 && e.cash > e.gdp * 0.03 && c.controller.kind === 'ai') {
    problems.push({ key: 'idle_investment', severity: 0.3, description: 'Aucun chantier en cours malgré une trésorerie saine' });
  }
  if (c.controller.kind === 'ai' && e.cash > Math.max(60, e.gdp * 0.05)) {
    const built = Object.values(c.facilities ?? {}).reduce((s, f) => s + f.owned + f.queue.reduce((x, q) => x + q.count, 0), 0);
    if (built < 30) {
      problems.push({ key: 'idle_investment_export', severity: 0.35, description: 'Trésorerie abondante : capacités productives à développer pour exporter' });
    }
  }
  if (importDependency(c) > 0.35) {
    problems.push({ key: 'dependency', severity: clamp((importDependency(c) - 0.35) / 0.3, 0.2, 0.8), description: 'Forte dépendance aux importations' });
  }
  // Stocks critiques sur une ressource réellement consommée → bâtiment dédié
  for (const key of RESOURCE_KEYS) {
    if (key === 'energy' || key === 'food') continue; // couverts par energy_short/food_short
    const r = c.resources[key];
    const ratio = r.capacity > 0 ? r.stock / r.capacity : 1;
    if (ratio < 0.28 && r.consumption > 0.4) {
      problems.push({ key: 'resource_low', severity: clamp((0.28 - ratio) / 0.25, 0.2, 0.7), description: `Stocks de ${RESOURCE_MAP[key].name.toLowerCase()} à ${(ratio * 100).toFixed(0)} %` });
      break; // un seul problème de stock à la fois (lisibilité des décisions)
    }
  }
  // PRÉVISION : stocks qui seront épuisés sous 12 jours au rythme actuel —
  // l'IA agit AVANT la pénurie, pas après (achat, boost, bâtiment).
  for (const key of RESOURCE_KEYS) {
    const r = c.resources[key];
    const net = r.production - r.consumption;
    if (net < -0.05 && r.consumption > 0.3) {
      const daysLeft = r.stock / -net;
      const ratio = r.capacity > 0 ? r.stock / r.capacity : 1;
      if (daysLeft < 12 && ratio > 0.3) {
        problems.push({
          key: 'depletion_risk',
          severity: clamp((12 - daysLeft) / 12, 0.3, 0.9),
          description: `${RESOURCE_MAP[key].name.toLowerCase()} : stocks épuisés dans ~${Math.max(1, Math.round(daysLeft))} jours au rythme actuel`,
        });
        break;
      }
    }
  }
  // Régime désaligné : un autre régime écoute bien mieux ce que le peuple
  // réclame AUJOURD'HUI — le changer rapporte un boost (lune de miel).
  {
    const best = bestRegimeFor(c);
    if (best && best.gap > 0.22 && (c.popularity < 52 || c.stability < 50 || c.economy.growth < 1.5)) {
      problems.push({
        key: 'regime_mismatch',
        severity: clamp(best.gap * 1.6, 0.3, 0.9),
        description: `Le peuple aspire à « ${best.id} » (alignement ${Math.round(best.align * 100)} % vs ${Math.round(regimeAlignment(c, c.regime) * 100)} % pour ${c.regime})`,
      });
    }
  }
  // Déficit de PRODUCTION structurel (toute ressource, vitales incluses) :
  // l'IA doit bâtir pour évoluer, avant même que les stocks ne s'effondrent.
  {
    let worstKey: ResourceKey | null = null;
    let worstGap = 0;
    for (const key of RESOURCE_KEYS) {
      const r = c.resources[key];
      if (r.consumption < 0.3) continue;
      const gap = r.consumption - r.production;             // unités/j manquantes
      const ratio = r.capacity > 0 ? r.stock / r.capacity : 1;
      if (gap > r.consumption * 0.15 && ratio < 0.65 && gap > worstGap) {
        worstGap = gap;
        worstKey = key;
      }
    }
    if (worstKey) {
      problems.push({
        key: 'prod_deficit',
        severity: clamp(worstGap / Math.max(1, c.resources[worstKey].consumption) * 2, 0.25, 0.85),
        description: `Déficit de production de ${RESOURCE_MAP[worstKey].name.toLowerCase()} (−${worstGap.toFixed(1)} u/j)`,
      });
    }
  }
  // Opportunité diplomatique : meilleur partenaire sans accord de libre-échange
  const best = bestPartner(c);
  if (best && best.score > 62 && !best.hasFreeTrade) {
    problems.push({ key: 'diplomacy_gap', severity: 0.35, description: `Accord possible avec ${best.name}` });
  }
  if (best && best.score < 50 && best.sanctioned) {
    problems.push({ key: 'sanctioned', severity: 0.5, description: `Mesure économique active avec ${best.name}` });
  }
  // Complémentarité économique inexploitée : un partenaire dont les déficits
  // correspondent à mes excédents, sans accord de libre-échange actif.
  const comp = bestComplement(c, world);
  if (comp && !comp.hasFreeTrade && comp.score > 0.3) {
    problems.push({ key: 'complementarity', severity: comp.score, description: `Complémentarité inexploitée avec ${comp.name} (mes excédents ↔ ses déficits)` });
  }
  return problems;
}

function bestPartner(c: Country): { id: string; name: string; score: number; hasFreeTrade: boolean; sanctioned: boolean } | null {
  let bestId: string | null = null;
  let bestScore = -1;
  for (const [id, rel] of Object.entries(c.relations)) {
    const tradeWeight = rel.tradeVolume * 20;
    const s = rel.score + tradeWeight;
    if (s > bestScore) {
      bestScore = s;
      bestId = id;
    }
  }
  if (!bestId) return null;
  const rel = c.relations[bestId]!;
  return {
    id: bestId,
    name: bestId,
    score: rel.score,
    hasFreeTrade: rel.agreements.some((a) => a.status === 'active' && (a.type === 'free_trade' || a.type === 'trade_zone')),
    sanctioned: rel.sanctionByUs || rel.sanctionByThem,
  };
}

/* ------------------------------------------------------------------ */
/* 2. ÉVALUER LES OPTIONS — candidats pondérés par la personnalité     */
/* ------------------------------------------------------------------ */

function preferredInfra(c: Country): InfraKey {
  const focus = c.ai.personality.sectorFocus;
  const byStrategy: InfraKey[] = [];
  if ((focus.industry ?? 0) > 1.1 || c.ai.personality.strategy === 'industrielle') byStrategy.push('industrialZones', 'rail', 'ports');
  if ((focus.tech ?? 0) > 1.1 || c.ai.personality.strategy === 'innovation') byStrategy.push('techHubs', 'universities');
  if ((focus.energy ?? 0) > 1.1 || c.ai.personality.strategy === 'ressources') byStrategy.push('plants', 'powerGrid', 'ports');
  if ((focus.agriculture ?? 0) > 1.1 || c.ai.personality.strategy === 'agricole') byStrategy.push('roads', 'logistics');
  if ((focus.services ?? 0) > 1.1 || c.ai.personality.strategy === 'commerciale') byStrategy.push('ports', 'logistics');
  const candidates: InfraKey[] = byStrategy.length > 0 ? byStrategy : ['roads', 'schools', 'logistics'];
  for (const k of candidates) {
    const def = INFRA_MAP[k];
    if ((c.infra[k]?.level ?? 0) < def.maxLevel && !c.projects.some((p) => p.infra === k)) {
      if (c.economy.cash > infraCost(c, k) * 0.2) return k;
    }
  }
  // repli : le moins cher disponible
  const avail = (Object.keys(INFRA_MAP) as InfraKey[]).filter(
    (k) => (c.infra[k]?.level ?? 0) < INFRA_MAP[k].maxLevel && !c.projects.some((p) => p.infra === k),
  );
  avail.sort((a, b) => infraCost(c, a) - infraCost(c, b));
  return avail[0] ?? 'roads';
}

function surplusResource(c: Country): { key: ResourceKey; units: number } | null {
  let bestKey: ResourceKey | null = null;
  let bestRatio = 0.6;
  for (const key of RESOURCE_KEYS) {
    const ratio = stockRatio(c, key);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestKey = key;
    }
  }
  if (!bestKey) return null;
  return { key: bestKey, units: round(c.resources[bestKey].stock * 0.22, 1) };
}

function generateCandidates(c: Country, problems: Problem[], world?: WorldStore): Candidate[] {
  const optsWorld = world;
  const out: Candidate[] = [];
  const p = c.ai.personality;
  const e = c.economy;
  const sp = c.policy.spending;
  const push = (problem: Problem, params: ActionParams, benefit: number, category: string, rationale: string) => {
    out.push({ problem, params, benefit, category, rationale });
  };

  for (const prob of problems) {
    const sev = prob.severity;
    switch (prob.key) {
      case 'deficit':
      case 'debt':
      case 'cash_low': {
        const austerityBias = (1.15 - p.debtTolerance) * (0.7 + sev * 0.6);
        if (p.taxPreference > 0.4 && c.policy.taxRate < 30) {
          push(prob, { type: 'set_tax', value: round(c.policy.taxRate + 1.5, 1) }, sev * austerityBias * p.taxPreference * 1.6, 'fiscalité', 'redresser les finances publiques');
        }
        const cuttable = (Object.keys(sp) as (keyof typeof sp)[])
          .filter((k) => k !== 'health' || p.stabilityFocus < 0.6)
          .sort((a, b) => sp[b] - sp[a])[0];
        if (cuttable && sp[cuttable] > 1.2) {
          push(prob, { type: 'set_spending', sector: cuttable, value: round(sp[cuttable] - 0.4, 2) }, sev * austerityBias * (p.stabilityFocus < 0.6 ? 1 : 0.5), 'budget', `réduire les dépenses « ${cuttable} »`);
        }
        if (!c.laws.some((l) => l.lawId === 'fiscal_discipline')) {
          push(prob, { type: 'enact_law', lawId: 'fiscal_discipline' }, sev * austerityBias * 0.8, 'législation', 'discipline budgétaire');
        }
        const surplus = surplusResource(c);
        if (surplus && e.cash < e.gdp * 0.02) {
          // v1.19 : plus de vente au marché mondial — on publie une OFFRE
          // inter-états (les joueurs et les IA achètent si le prix est bon).
          push(prob, { type: 'create_offer', resource: surplus.key, units: surplus.units, unitPrice: round((world?.market[surplus.key]?.price ?? RESOURCE_MAP[surplus.key].basePrice) * 0.95, 2) }, sev * 0.9, 'commerce', 'renflouer la trésorerie via le marché inter-états');
        }
        break;
      }
      case 'inflation': {
        if (c.policy.interestRate < 9) {
          push(prob, { type: 'set_interest_rate', value: round(c.policy.interestRate + 0.5, 2) }, sev * 1.1, 'monétaire', 'refroidir la demande');
        }
        if (c.laws.some((l) => l.lawId === 'business_deregulation') && e.growth < 2) {
          push(prob, { type: 'repeal_law', lawId: 'business_deregulation' }, sev * 0.5, 'législation', 'calmer la surchauffe');
        }
        break;
      }
      case 'unemployment': {
        const infra = preferredInfra(c);
        push(prob, { type: 'start_project', infra }, sev * (1 + (p.sectorFocus.industry ?? 1) * 0.2), 'infrastructure', `relancer l’emploi via ${INFRA_MAP[infra].name}`);
        if (sp.industry < 3.5) {
          push(prob, { type: 'set_spending', sector: 'industry', value: round(sp.industry + 0.3, 2) }, sev * 0.8, 'budget', 'soutenir l’activité industrielle');
        }
        if (sp.social < 5 && p.stabilityFocus > 0.5) {
          push(prob, { type: 'set_spending', sector: 'social', value: round(sp.social + 0.3, 2) }, sev * 0.6 * p.stabilityFocus, 'budget', 'amortir le choc social');
        }
        break;
      }
      case 'low_growth':
      case 'idle_investment': {
        const infra = preferredInfra(c);
        push(prob, { type: 'start_project', infra }, sev * (0.8 + p.growthFocus * 0.6), 'infrastructure', `stimuler la croissance via ${INFRA_MAP[infra].name}`);
        if (c.policy.interestRate > 2) {
          push(prob, { type: 'set_interest_rate', value: round(c.policy.interestRate - 0.25, 2) }, sev * 0.7 * p.growthFocus, 'monétaire', 'détendre le crédit');
        }
        if (c.policy.corporateTax > 12 && p.taxPreference < 0.55) {
          push(prob, { type: 'set_corporate_tax', value: round(c.policy.corporateTax - 1, 1) }, sev * 0.6 * (1 - p.taxPreference), 'fiscalité', 'stimuler l’investissement privé');
        }
        if (!c.laws.some((l) => l.lawId === 'innovation_fund') && p.strategy === 'innovation') {
          push(prob, { type: 'enact_law', lawId: 'innovation_fund' }, sev * 0.9, 'législation', 'financer l’innovation');
        }
        if (!c.laws.some((l) => l.lawId === 'business_deregulation') && p.taxPreference < 0.4 && e.inflation < 4) {
          push(prob, { type: 'enact_law', lawId: 'business_deregulation' }, sev * 0.6, 'législation', 'libérer l’activité');
        }
        break;
      }
      case 'idle_investment_export': {
        // Trésorerie abondante : bâtir pour exporter (dotation naturelle × prix mondial)
        const best = optsWorld ? bestExportResource(c, optsWorld) : null;
        if (best) {
          const fac = pickFacilityFor(c, best);
          if (fac) {
            push(prob, { type: 'build_facility', facility: fac, count: e.cash > FACILITY_MAP[fac].cost * 6 ? 2 : 1 },
              0.55 + p.tradeOpenness * 0.5 + p.growthFocus * 0.25, 'production',
              `investir la trésorerie dormante dans « ${FACILITY_MAP[fac].name} » : ${RESOURCE_MAP[best].name.toLowerCase()} = meilleur potentiel d'exportation (dotation ${(c.endowment[best] ?? 0).toFixed(2)})`);
          }
        }
        break;
      }
      case 'energy_short': {
        if (e.cash > infraCost(c, 'plants') * 0.2 && !c.projects.some((x) => x.infra === 'plants')) {
          push(prob, { type: 'start_project', infra: 'plants' }, sev * 1.2, 'infrastructure', 'sécuriser l’approvisionnement énergétique');
        }
        if ((c.productionDirectives?.energy ?? null) !== 'boost') {
          push(prob, { type: 'set_production', resource: 'energy', mode: 'boost' }, sev * 1.15, 'production', 'booster la production d’énergie (+15 %)');
        }
        const energy = c.resources.energy;
        const buyUnits = round(Math.min(energy.consumption * 8, Math.max(0, energy.capacity - energy.stock)), 1);
        if (buyUnits > 1) {
          push(prob, { type: 'buy_resource', resource: 'energy', units: buyUnits }, sev * (e.cash > e.gdp * 0.01 ? 1 : 0.3), 'commerce', 'acheter de l’énergie en urgence');
        }
        if (sp.energy < 4) {
          push(prob, { type: 'set_spending', sector: 'energy', value: round(sp.energy + 0.3, 2) }, sev * 0.6, 'budget', 'soutenir le secteur énergétique');
        }
        {
          const fac = pickFacilityFor(c, 'energy');
          if (fac) push(prob, { type: 'build_facility', facility: fac, count: 1 }, sev * 1.15, 'production', `construire « ${FACILITY_MAP[fac].name} » contre la tension énergétique`);
        }
        break;
      }
      case 'food_short': {
        const food = c.resources.food;
        const buyUnits = round(Math.min(food.consumption * 8, Math.max(0, food.capacity - food.stock)), 1);
        if (buyUnits > 1) {
          push(prob, { type: 'buy_resource', resource: 'food', units: buyUnits }, sev * 1.2, 'commerce', 'acheter des denrées en urgence');
        }
        if ((c.productionDirectives?.food ?? null) !== 'boost') {
          push(prob, { type: 'set_production', resource: 'food', mode: 'boost' }, sev * 1.1, 'production', 'booster la production alimentaire (+15 %)');
        }
        if (!c.laws.some((l) => l.lawId === 'food_sovereignty')) {
          push(prob, { type: 'enact_law', lawId: 'food_sovereignty' }, sev * 0.8, 'législation', 'souveraineté alimentaire');
        }
        if (sp.agriculture < 3) {
          push(prob, { type: 'set_spending', sector: 'agriculture', value: round(sp.agriculture + 0.3, 2) }, sev * 0.6, 'budget', 'soutenir l’agriculture');
        }
        {
          const fac = pickFacilityFor(c, 'food');
          if (fac) push(prob, { type: 'build_facility', facility: fac, count: 1 }, sev * 1.2, 'production', `construire « ${FACILITY_MAP[fac].name} » pour sécuriser l'alimentation`);
        }
        break;
      }
      case 'depletion_risk': {
        // Ressource la plus proche de l'épuisement
        let wk: ResourceKey | null = null;
        let wd = 12;
        for (const key of RESOURCE_KEYS) {
          const r = c.resources[key];
          const net = r.production - r.consumption;
          if (net < -0.05 && r.consumption > 0.3) {
            const dl = r.stock / -net;
            if (dl < wd) { wd = dl; wk = key; }
          }
        }
        if (wk) {
          const r = c.resources[wk];
          const m = world?.market[wk];
          const buyUnits = round(Math.min(r.consumption * 6, Math.max(0, r.capacity - r.stock) * 0.5), 1);
          const buyCost = buyUnits * (m?.price ?? RESOURCE_MAP[wk].basePrice) * 0.045;
          if (buyUnits >= 1 && e.cash > buyCost * 1.5) {
            push(prob, { type: 'buy_resource', resource: wk, units: buyUnits }, sev * 1.35, 'commerce', `achat préventif de ${RESOURCE_MAP[wk].name.toLowerCase()} : épuisement dans ~${Math.round(wd)} j`);
          }
          if ((c.productionDirectives?.[wk] ?? null) !== 'boost') {
            push(prob, { type: 'set_production', resource: wk, mode: 'boost' }, sev * 1.15, 'production', `boost préventif de ${RESOURCE_MAP[wk].name.toLowerCase()} (+15 %)`);
          }
          const fac = pickFacilityFor(c, wk);
          if (fac) push(prob, { type: 'build_facility', facility: fac, count: 1 }, sev * 1.0, 'production', `bâtir « ${FACILITY_MAP[fac].name} » pour sécuriser ${RESOURCE_MAP[wk].name.toLowerCase()}`);
        }
        break;
      }
      case 'prod_deficit': {
        // Trouver la ressource en déficit (même logique que l'analyse)
        let wk: ResourceKey | null = null;
        let wg = 0;
        for (const key of RESOURCE_KEYS) {
          const r = c.resources[key];
          if (r.consumption < 0.3) continue;
          const gap = r.consumption - r.production;
          const ratio = r.capacity > 0 ? r.stock / r.capacity : 1;
          if (gap > r.consumption * 0.15 && ratio < 0.65 && gap > wg) { wg = gap; wk = key; }
        }
        if (wk) {
          const fac = pickFacilityFor(c, wk);
          if (fac) {
            push(prob, { type: 'build_facility', facility: fac, count: c.economy.cash > FACILITY_MAP[fac].cost * 4 ? 2 : 1 },
              sev * 1.25, 'production',
              `combler le déficit de ${RESOURCE_MAP[wk].name.toLowerCase()} (−${wg.toFixed(1)} u/j) en construisant « ${FACILITY_MAP[fac].name} »`);
          }
          // Boost temporaire si ressource vitale en attendant la livraison
          if ((wk === 'food' || wk === 'energy') && (c.productionDirectives?.[wk] ?? null) !== 'boost' && e.cash > e.gdp * 0.004) {
            push(prob, { type: 'set_production', resource: wk, mode: 'boost' }, sev * 0.9, 'production', `soutien immédiat de ${RESOURCE_MAP[wk].name.toLowerCase()} (+15 %) pendant la construction`);
          }
        }
        break;
      }
      case 'resource_low': {
        // Bâtiment sur la ressource la plus tendue réellement consommée
        let worst: ResourceKey | null = null;
        let worstRatio = 0.28;
        for (const key of RESOURCE_KEYS) {
          if (key === 'energy' || key === 'food') continue;
          const r = c.resources[key];
          const ratio = r.capacity > 0 ? r.stock / r.capacity : 1;
          if (ratio < worstRatio && r.consumption > 0.4) { worstRatio = ratio; worst = key; }
        }
        if (worst) {
          const fac = pickFacilityFor(c, worst);
          if (fac) push(prob, { type: 'build_facility', facility: fac, count: 1 }, sev * 0.95, 'production', `construire « ${FACILITY_MAP[fac].name} » : stocks de ${RESOURCE_MAP[worst].name.toLowerCase()} critiques`);
          const buyUnits = round(Math.min(c.resources[worst].consumption * 5, Math.max(0, c.resources[worst].capacity - c.resources[worst].stock)), 1);
          if (buyUnits > 1) {
            push(prob, { type: 'buy_resource', resource: worst, units: buyUnits }, sev * (e.cash > e.gdp * 0.01 ? 0.8 : 0.25), 'commerce', `acheter des ${RESOURCE_MAP[worst].name.toLowerCase()} en attendant la livraison`);
          }
        }
        break;
      }
      case 'oversupply': {
        const surplus = surplusResource(c);
        if (surplus) {
          push(prob, { type: 'create_offer', resource: surplus.key, units: surplus.units, unitPrice: round((world?.market[surplus.key]?.price ?? RESOURCE_MAP[surplus.key].basePrice) * 0.97, 2) }, 0.5 * p.tradeOpenness + 0.2, 'commerce', 'valoriser les excédents via une offre');
          if ((c.productionDirectives?.[surplus.key] ?? null) !== 'slow') {
            push(prob, { type: 'set_production', resource: surplus.key, mode: 'slow' }, 0.45 + p.debtTolerance * 0.1, 'production', `ralentir la production de ${surplus.key} en attendant de meilleurs prix`);
          }
        }
        break;
      }
      case 'dependency': {
        const partner = bestPartner(c);
        if (partner && !partner.hasFreeTrade && partner.score > 50) {
          push(prob, { type: 'propose_agreement', targetId: partner.id, agreementType: 'free_trade' }, sev * (0.6 + p.tradeOpenness), 'diplomatie', 'sécuriser les approvisionnements');
        }
        const infra = preferredInfra(c);
        push(prob, { type: 'start_project', infra }, sev * 0.5, 'infrastructure', 'réduire la dépendance structurelle');
        break;
      }
      case 'low_popularity': {
        if (sp.social < 5) {
          push(prob, { type: 'set_spending', sector: 'social', value: round(sp.social + 0.4, 2) }, sev * (0.7 + p.stabilityFocus * 0.5), 'budget', 'répondre au mécontentement social');
        }
        if (c.policy.taxRate > 14 && p.taxPreference < 0.6) {
          push(prob, { type: 'set_tax', value: round(c.policy.taxRate - 1, 1) }, sev * (1 - p.taxPreference) * 0.9, 'fiscalité', 'soulager la pression fiscale');
        }
        if (sp.health < 4) {
          push(prob, { type: 'set_spending', sector: 'health', value: round(sp.health + 0.3, 2) }, sev * 0.6, 'budget', 'améliorer les services publics');
        }
        // Loi populaire au meilleur ratio popularité/coût : le remède durable
        const popLaw = LAWS
          .filter((l) => (l.modifiers.popularity ?? 0) > 0.05 && !c.laws.some((x) => x.lawId === l.id))
          .sort((a, b) => ((b.modifiers.popularity ?? 0) / Math.max(0.05, b.annualCostPctGdp)) - ((a.modifiers.popularity ?? 0) / Math.max(0.05, a.annualCostPctGdp)))[0];
        if (popLaw) {
          push(prob, { type: 'enact_law', lawId: popLaw.id }, sev * 1.15, 'législation', `reconquérir le peuple via « ${popLaw.name} » (+${((popLaw.modifiers.popularity ?? 0) * 7).toFixed(1)} pop/semaine)`);
        }
        break;
      }
      case 'low_stability': {
        if (!c.laws.some((l) => l.lawId === 'labor_protection')) {
          push(prob, { type: 'enact_law', lawId: 'labor_protection' }, sev * 0.8, 'législation', 'apaiser le climat social');
        }
        if (sp.social < 5) {
          push(prob, { type: 'set_spending', sector: 'social', value: round(sp.social + 0.3, 2) }, sev * 0.7, 'budget', 'restaurer la cohésion');
        }
        break;
      }
      case 'living_low': {
        if (sp.health < 4.5) {
          push(prob, { type: 'set_spending', sector: 'health', value: round(sp.health + 0.3, 2) }, sev * 0.7, 'budget', 'améliorer le niveau de vie');
        }
        if (!c.laws.some((l) => l.lawId === 'health_coverage') && c.economy.balance > -c.economy.gdp * 0.02) {
          push(prob, { type: 'enact_law', lawId: 'health_coverage' }, sev * 0.8, 'législation', 'couverture santé');
        }
        if ((c.infra.housing?.level ?? 0) < 7 && !c.projects.some((x) => x.infra === 'housing')) {
          push(prob, { type: 'start_project', infra: 'housing' }, sev * 0.6, 'infrastructure', 'construire des logements');
        }
        break;
      }
      case 'diplomacy_gap': {
        const partner = bestPartner(c);
        if (partner) {
          if (partner.score >= 42) {
            push(prob, { type: 'propose_agreement', targetId: partner.id, agreementType: p.strategy === 'innovation' ? 'tech_cooperation' : 'free_trade' }, 0.6 + p.tradeOpenness * 0.7 + p.diplomacy * 0.3, 'diplomatie', 'approfondir le partenariat économique');
          } else {
            push(prob, { type: 'improve_relations', targetId: partner.id }, 0.5 + p.diplomacy * 0.6, 'diplomatie', 'créer un climat favorable');
          }
        }
        break;
      }
      case 'regime_mismatch': {
        const best = bestRegimeFor(c);
        if (best) {
          push(prob, { type: 'change_regime', regime: best.id }, sev * (1.1 + p.stabilityFocus * 0.3), 'politique',
            `épouser la volonté du peuple : « ${best.id} » (alignement ${Math.round(best.align * 100)} %) pour regagner popularité et croissance`);
        }
        break;
      }
      case 'complementarity': {
        if (world) {
          const comp = bestComplement(c, world);
          if (comp && !comp.hasFreeTrade) {
            push(prob, { type: 'propose_agreement', targetId: comp.id, agreementType: 'free_trade' }, 0.55 + comp.score * 0.8 + p.tradeOpenness * 0.4, 'diplomatie', `exploiter la complémentarité avec ${comp.name} (mes excédents ↔ ses déficits)`);
          }
        }
        break;
      }
      case 'sanctioned': {
        const sanctioned = Object.entries(c.relations).find(([, r]) => r.sanctionByUs || r.sanctionByThem);
        if (sanctioned) {
          const [sid, rel] = sanctioned;
          if (rel.sanctionByUs && rel.tradeVolume < 0.05) {
            push(prob, { type: 'lift_sanction', targetId: sid }, 0.5 + p.tradeOpenness * 0.6, 'diplomatie', 'normaliser les échanges');
          } else if (rel.sanctionByThem) {
            push(prob, { type: 'improve_relations', targetId: sid }, 0.4 + p.diplomacy * 0.7, 'diplomatie', 'apaiser les tensions');
          }
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 3-6. CHOISIR → APPLIQUER → AJUSTER                                  */
/* ------------------------------------------------------------------ */

export interface AiRunOptions {
  rng: () => number;
  ctx: ActionContext;
  decisions: Omit<AiDecisionLog, 'id' | 'ts'>[];
}

export function runAiCountry(c: Country, world: WorldStore, opts: AiRunOptions): AiPhaseResult {
  const result: AiPhaseResult = { decisions: [], actionsExecuted: 0, proposalsAnswered: 0 };
  const { rng, ctx, decisions } = opts;
  const day = world.meta.day;

  /* --- Réponse aux propositions diplomatiques en attente --- */
  for (const [otherId, rel] of Object.entries(c.relations)) {
    for (const ag of rel.agreements) {
      if (ag.status !== 'proposed' || ag.toId !== c.id) continue;
      // v14 : les PROPOSITIONS ÉMANANT DE JOUEURS sont étudiées dès le jour
      // suivant (le multijoueur doit rester réactif) ; entre IA, le délai de
      // réflexion diplomatique de 1 à 3 jours est conservé.
      const fromPlayer = world.country(otherId)?.controller.kind === 'player';
      if (day - ag.createdDay < (fromPlayer ? 1 : 1 + Math.floor(rng() * 3))) continue;
      const p = c.ai.personality;
      const base =
        (rel.score - 35) / 55 +
        (rel.trust - 40) / 140 +
        p.tradeOpenness * 0.28 +
        p.diplomacy * 0.15 -
        (ag.type === 'tech_cooperation' ? 0.08 : 0);
      const acceptProb = clamp(base, 0.06, 0.94);
      const accept = rng() < acceptProb;
      const res = executeAction(world, c.id, { type: 'respond_proposal', proposalId: ag.id, accept }, ctx);
      if (res.ok) {
        result.proposalsAnswered += 1;
        decisions.push({
          day, countryId: c.id, problem: `Proposition de ${world.country(otherId)?.name ?? otherId}`,
          action: 'respond_proposal', detail: `${ag.type} → ${accept ? 'accepté' : 'refusé'}`,
          rationale: `relations ${rel.score.toFixed(0)}, confiance ${rel.trust.toFixed(0)}, ouverture ${p.tradeOpenness.toFixed(2)}`,
        });
      }
      break; // une réponse par cycle
    }
  }

  /* --- Réponse aux livraisons exceptionnelles en attente ---
     Le destinataire IA accepte si la marchandise lui est utile, à un prix
     correct, et s'il peut payer ; sinon il refuse (retour à l'expéditeur).
     Délai de réflexion : 1 jour, comme les propositions diplomatiques. */
  {
    let answered = 0;
    for (const d of [...world.pendingDeliveries]) {
      // Une seule réponse livraison par cycle : rythme diplomatique naturel,
      // jamais de rafale d'actions (anti-frénésie).
      if (d.toId !== c.id || answered >= 1) continue;
      const r = c.resources[d.resource];
      const ratio = r.capacity > 0 ? r.stock / r.capacity : 1;
      const needsIt = r.consumption > r.production || ratio < 0.55;
      const room = r.capacity - r.stock;
      const fairValue = d.units * r.price * VALUE_SCALE * 1000; // valeur au prix local
      const priceRatio = fairValue > 0 ? d.value / fairValue : 2;
      const rel = c.relations[d.fromId];
      const sanctioned = !!rel && (rel.sanctionByUs || rel.sanctionByThem);
      const canPay = c.economy.cash >= d.value * 1.15;
      const hasRoom = d.units <= room;
      // v13 : les LIVRAISONS DE JOUEURS à prix correct sont traitées sans le
      // délai de réflexion d'un jour (le multijoueur doit rester réactif) ;
      // entre IA, le délai d'un jour est conservé (rythme diplomatique).
      const fromPlayer = world.country(d.fromId)?.controller.kind === 'player';
      if (day <= d.createdDay && !(fromPlayer && priceRatio <= 1.05)) continue;
      let accept = false;
      if (!sanctioned && canPay && hasRoom) {
        if (needsIt) accept = priceRatio <= 1.2 || (rel?.score ?? 0) >= 75;
        else accept = priceRatio <= 0.98;
      }
      const res = executeAction(world, c.id, { type: 'respond_delivery', deliveryId: d.id, accept }, ctx);
      if (res.ok) {
        answered += 1;
        decisions.push({
          day, countryId: c.id,
          problem: `Livraison de ${world.country(d.fromId)?.name ?? d.fromId} : ${d.units} u de ${d.resource}`,
          action: 'respond_delivery',
          detail: accept ? `acceptée (${d.value.toFixed(2)} Md €)` : 'refusée (retour expéditeur)',
          rationale: accept
            ? `prix à ${(priceRatio * 100).toFixed(0)} % du local, stocks à ${(ratio * 100).toFixed(0)} %, trésorerie suffisante`
            : sanctioned ? 'mesure économique active' : !canPay ? 'trésorerie insuffisante' : !hasRoom ? 'entrepôts pleins' : `prix à ${(priceRatio * 100).toFixed(0)} % du local — besoin insuffisant`,
        });
      }
    }
  }

  /* --- v1.19 : PÉNURIE CRITIQUE → scan immédiat des offres du marché ---
     Hors gate de décision : une nation qui va manquer d'une ressource
     achète sans attendre le prochain cycle (offres joueurs incluses). */
  {
    for (const key of RESOURCE_KEYS) {
      const r = c.resources[key];
      const ratio = r.capacity > 0 ? r.stock / r.capacity : 1;
      if (ratio >= 0.3 || r.consumption <= r.production) continue;
      const localUnit = r.price * VALUE_SCALE * 1000;
      const candidates = world.openOffers()
        .filter((o) => o.resource === key && o.sellerId !== c.id)
        .filter((o) => {
          const rel = c.relations[o.sellerId];
          return !(rel && (rel.sanctionByUs || rel.sanctionByThem));
        })
        .filter((o) => o.unitPrice * VALUE_SCALE * 1000 <= localUnit * 1.15)
        .sort((a, b) => a.unitPrice - b.unitPrice);
      const o = candidates[0];
      if (!o) continue;
      const room = r.capacity - r.stock;
      if (o.units > room) continue;
      const cost = round(o.units * o.unitPrice * VALUE_SCALE * 1000, 2);
      if (c.economy.cash < cost * 1.2) continue;
      const res = executeAction(world, c.id, { type: 'buy_offer', offerId: o.id }, ctx);
      if (res.ok) {
        result.actionsExecuted += 1;
        decisions.push({
          day, countryId: c.id,
          problem: `Pénurie critique de ${RESOURCE_MAP[key].name.toLowerCase()} (stocks ${(ratio * 100).toFixed(0)} %)`,
          action: 'buy_offer', detail: `${o.units} u @ ${o.unitPrice.toFixed(2)} à ${world.country(o.sellerId)?.name ?? o.sellerId}`,
          rationale: 'urgence approvisionnement : offre la moins chère sous 115 % du prix local',
        });
      }
      break; // un achat d'urgence par cycle
    }
  }

  /* --- v1.19 : offres périmées (8 j sans vente) → retirées et re-publiées -8 % --- */
  {
    const stale = world.openOffers().find((o) => o.sellerId === c.id && day - o.createdDay >= 8);
    if (stale) {
      const relist = executeAction(world, c.id, { type: 'cancel_offer', offerId: stale.id }, ctx);
      if (relist.ok) {
        const newPrice = round(stale.unitPrice * 0.92, 2);
        const re = executeAction(world, c.id, { type: 'create_offer', resource: stale.resource, units: stale.units, unitPrice: newPrice }, ctx);
        decisions.push({
          day, countryId: c.id,
          problem: `Offre de ${RESOURCE_MAP[stale.resource].name.toLowerCase()} invendue depuis ${day - stale.createdDay} j`,
          action: 'create_offer', detail: `re-publiée @ ${newPrice} (−8 %)`,
          rationale: re.ok ? 'prix réaligné sur le marché pour déclencher une vente' : 'retrait seulement (conditions de publication non remplies)',
        });
      }
    }
  }

  /* --- Cycle de décision principal (avec cool-down) --- */
  if (world.meta.tick < c.ai.nextDecisionTick) return result;

  const problems = analyzeCountry(c, world);

  /* --- APPRENTISSAGE : évaluer les coups passés sur leur résultat ---
     Un mouvement dont le problème cible existe toujours après ≥ 6 jours
     voit son poids baisser ; un mouvement qui a résolu son problème monte. */
  {
    const present = new Set(problems.map((pp) => pp.key));
    const kept: typeof c.ai.lastMoves = [];
    for (const mv of c.ai.lastMoves ?? []) {
      if (day - mv.day < 6) { kept.push(mv); continue; }
      const wCur = c.ai.learned?.[mv.action] ?? 1;
      c.ai.learned = c.ai.learned ?? {};
      c.ai.learned[mv.action] = round(clamp(present.has(mv.problem) ? wCur * 0.85 : wCur * 1.08, 0.4, 1.6), 3);
    }
    c.ai.lastMoves = kept.slice(-12);
  }
  const mem = c.ai.memory;
  const crisisBoost = mem && day - mem.day >= 5 && c.popularity - mem.popularity < -2 ? 1.4 : 1;
  c.ai.memory = { day, popularity: c.popularity, balance: c.economy.balance, cash: c.economy.cash };

  /* --- Mode SURVIE POLITIQUE : sous 38 % de popularité, l'IA priorise
     absolument les mouvements qui regagnent le peuple (×1,8, 2 actions). --- */
  const survival = c.popularity < 38;

  /* --- Commerce actif : expéditions, routes, péages (dans le cycle) --- */
  runAiTrade(c, world, ctx, rng, decisions, result);

  c.ai.recentProblems = problems.slice(0, 5).map((p) => p.key);

  const candidates = generateCandidates(c, problems, world);
  const scored = candidates
    .map((cand) => {
      const est = estimateAction(world, c.id, cand.params);
      if (!est.ok) return null;
      let benefit = cand.benefit * (cand.problem.severity + 0.15);
      const p = c.ai.personality;
      if (cand.category === 'diplomatie') benefit *= 0.7 + p.diplomacy * 0.6;
      if (cand.category === 'fiscalité') benefit *= 0.8 + p.taxPreference * 0.3;
      if (cand.category === 'monétaire') benefit *= 0.9 + p.growthFocus * 0.2;
      // Poids APPRIS par résultat passé (renforcement)
      benefit *= c.ai.learned?.[cand.params.type] ?? 1;
      // v16 : volonté du peuple URGENTE — un désalignement de régime massif
      // (≥ 50 % de sévérité) prime sur l'austérité routine : le gouvernement
      // entend la rue avant de couper aveuglément dans les budgets.
      if (cand.problem.key === 'regime_mismatch' && cand.problem.severity >= 0.5) benefit *= 1.6;
      // Prévoyance budgétaire : une dépense récurrente en déficit pèse moins
      if (isRecurringCost(cand.params) && c.economy.balance < -c.economy.gdp * 0.03) benefit *= 0.55;
      // Mouvements pro-popularité : bonus en crise mesurée et en mode survie
      if (isPopularityMove(cand.params, c) && (crisisBoost > 1 || survival)) benefit *= survival ? 1.8 : crisisBoost;
      benefit += rng() * 0.18; // variabilité naturelle
      return { cand, benefit };
    })
    .filter((x): x is { cand: Candidate; benefit: number } => x !== null)
    .sort((a, b) => b.benefit - a.benefit);

  const executed: string[] = [];
  let maxActions = scored.length > 0 && scored[0]!.benefit > 0.9 && rng() < 0.35 ? 2 : 1;
  if (survival && scored.some((s) => isPopularityMove(s.cand.params, c))) maxActions = Math.max(2, maxActions);
  for (const { cand, benefit } of scored.slice(0, maxActions)) {
    if (executed.includes(cand.category) && maxActions > 1) continue;
    const res = executeAction(world, c.id, cand.params, ctx);
    if (!res.ok) continue;
    executed.push(cand.category);
    result.actionsExecuted += 1;
    c.ai.lastActionDay = day;
    // Mémoriser le coup pour apprentissage au prochain cycle d'évaluation
    c.ai.lastMoves = [...(c.ai.lastMoves ?? []), { action: cand.params.type, problem: cand.problem.key, day }].slice(-12);
    decisions.push({
      day,
      countryId: c.id,
      problem: `${cand.problem.key} (${cand.problem.severity.toFixed(2)}) — ${cand.problem.description}`,
      action: cand.params.type,
      detail: JSON.stringify(cand.params),
      rationale: `${cand.rationale} (bénéfice estimé ${benefit.toFixed(2)})`,
    });
    adaptStrategy(c, cand.problem.key);
    if (result.actionsExecuted >= maxActions) break;
  }

  // Planification du prochain cycle : 2 à 5 jours + inertie personnelle
  c.ai.lastDecisionTick = world.meta.tick;
  c.ai.nextDecisionTick = world.meta.tick + 2 + Math.floor(rng() * 4);
  if (result.actionsExecuted === 0) {
    log.debug(`${c.name} : cycle IA sans action (${problems.length} problème(s) détecté(s), aucune option valide)`);
  }
  return result;
}

/** Le mouvement vise-t-il directement à regagner la popularité ? */
function isPopularityMove(params: ActionParams, c: Country): boolean {
  switch (params.type) {
    case 'set_spending':
      return (params.sector === 'social' || params.sector === 'health') && c.policy.spending[params.sector] < params.value;
    case 'set_tax':
      return params.value < c.policy.taxRate;
    case 'set_corporate_tax':
      return params.value < c.policy.corporateTax;
    case 'enact_law': {
      const law = LAWS.find((l) => l.id === params.lawId);
      return (law?.modifiers.popularity ?? 0) > 0.03;
    }
    case 'repeal_law': {
      const law = LAWS.find((l) => l.id === params.lawId);
      return (law?.modifiers.popularity ?? 0) < -0.03;
    }
    default:
      return false;
  }
}

/** Dépense récurrente nouvelle (loi coûteuse, budget en hausse, chantier = coût unique exclu). */
function isRecurringCost(params: ActionParams): boolean {
  if (params.type === 'enact_law') {
    const law = LAWS.find((l) => l.id === params.lawId);
    return (law?.annualCostPctGdp ?? 0) > 0.2;
  }
  return params.type === 'set_spending';
}

/** 6. AJUSTER LA STRATÉGIE : la personnalité évolue lentement au fil des crises. */
function adaptStrategy(c: Country, problemKey: string): void {
  const p = c.ai.personality;
  switch (problemKey) {
    case 'deficit':
    case 'debt':
    case 'cash_low':
      p.debtTolerance = round(clamp(p.debtTolerance - 0.03, 0.05, 0.95), 3);
      break;
    case 'unemployment':
    case 'low_stability':
      p.stabilityFocus = round(clamp(p.stabilityFocus + 0.02, 0.1, 1), 3);
      break;
    case 'low_growth':
      p.growthFocus = round(clamp(p.growthFocus + 0.02, 0.1, 1), 3);
      break;
    case 'low_popularity':
      p.taxPreference = round(clamp(p.taxPreference - 0.02, 0.05, 0.95), 3);
      break;
    case 'dependency':
    case 'diplomacy_gap':
    case 'complementarity':
      p.tradeOpenness = round(clamp(p.tradeOpenness + 0.015, 0.1, 1), 3);
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Commerce IA : expédier les excédents, acheter des routes selon leur  */
/* rentabilité RÉELLE (retour sur investissement), optimiser les péages */
/* selon la demande mesurée (logique de Laffer), diversifier les routes. */
/* ------------------------------------------------------------------ */

/** Revenu quotidien (Md €/j) qu'un corridor rapporterait à c au péage donné,
 *  estimé depuis les flux RÉELS du monde (world.routes). */
function corridorIncomeEstimate(world: WorldStore, c: Country, co: import('shared').TradeCorridor, toll: number): number {
  let income = 0;
  for (const route of world.routes.values()) {
    if (!route.corridors?.includes(co.id)) continue;
    if (route.fromId === c.id) continue; // pas de péage sur ses propres transits
    income += (route.value * toll) / 100;
  }
  return income;
}

/** Choisit le bâtiment de production pertinent pour une ressource :
 *  palier 1 par défaut, palier 2 si le pays est riche et le palier 1 rodé. */
function pickFacilityFor(c: Country, resource: ResourceKey): import('shared').FacilityKey | null {
  const defs = FACILITIES.filter((f) => f.resource === resource);
  if (defs.length === 0) return null;
  const t1 = defs.find((f) => f.tier === 1)!;
  const t2 = defs.find((f) => f.tier === 2);
  const st1 = c.facilities?.[t1.key];
  const owned1 = (st1?.owned ?? 0) + (st1?.queue?.reduce((s, q) => s + q.count, 0) ?? 0);
  if (t2 && owned1 >= 5 && c.economy.cash > t2.cost * 5 && (c.facilities?.[t2.key]?.owned ?? 0) < t2.maxOwned) {
    return t2.key;
  }
  if (owned1 < t1.maxOwned && c.economy.cash > t1.cost * 2) return t1.key;
  return null;
}

/** Meilleure ressource d'exportation d'un pays (dotation naturelle + prix mondial). */
function bestExportResource(c: Country, world: WorldStore): ResourceKey | null {
  let best: ResourceKey | null = null;
  let bestScore = 0;
  for (const key of RESOURCE_KEYS) {
    const endow = c.endowment[key] ?? 0.2;
    const price = world.market[key]?.price ?? RESOURCE_MAP[key].basePrice;
    const score = endow * price;
    if (score > bestScore) { bestScore = score; best = key; }
  }
  return best;
}

/** Régime le plus aligné avec les revendications actuelles du peuple (hors régime en place). */
function bestRegimeFor(c: Country): { id: import('shared').RegimeType; align: number; gap: number } | null {
  const current = regimeAlignment(c, c.regime);
  let best: { id: import('shared').RegimeType; align: number; gap: number } | null = null;
  for (const r of REGIMES) {
    if (r.id === c.regime) continue;
    const a = regimeAlignment(c, r.id);
    const gap = a - current;
    if (!best || gap > best.gap) best = { id: r.id, align: a, gap };
  }
  return best;
}

/** Meilleur partenaire complémentaire : ses déficits correspondent à mes excédents. */
function bestComplement(c: Country, world: WorldStore): { id: string; name: string; score: number; hasFreeTrade: boolean } | null {
  let best: { id: string; name: string; score: number; hasFreeTrade: boolean } | null = null;
  let bestScore = 0;
  for (const other of world.allCountries()) {
    if (other.id === c.id) continue;
    const rel = c.relations[other.id];
    if (!rel || rel.sanctionByUs || rel.sanctionByThem || rel.score < 35) continue;
    let comp = 0;
    for (const k of RESOURCE_KEYS) {
      const mine = c.resources[k].production - c.resources[k].consumption;
      const theirs = other.resources[k].consumption - other.resources[k].production;
      if (mine > 0.2 && theirs > 0.2) comp += Math.min(mine, theirs);
    }
    if (comp <= 0.3) continue;
    const score = comp * (0.5 + rel.score / 200);
    if (score > bestScore) {
      bestScore = score;
      best = {
        id: other.id,
        name: other.name,
        score: round(clamp(score / 6, 0.15, 0.95), 2),
        hasFreeTrade: rel.agreements.some((a) => a.status === 'active' && (a.type === 'free_trade' || a.type === 'trade_zone')),
      };
    }
  }
  return best;
}

function runAiTrade(
  c: Country,
  world: WorldStore,
  ctx: ActionContext,
  rng: () => number,
  decisions: Omit<AiDecisionLog, 'id' | 'ts'>[],
  result: AiPhaseResult,
): void {
  const day = world.meta.day;

  /* Rythme réaliste : au maximum 2 actions de commerce par cycle — riche sur
     la durée (les gates rng + cooldowns étalement tout), jamais frénétique. */
  const tradeBudget = 2;
  let tradeActions = 0;

  /* Ajuster le péage des routes possédées — optimisation par la demande :
     le péage cible capture la marge disponible avant que les flux ne se
     détournent vers les combinaisons concurrentes (logique de Laffer). */
  for (const co of world.corridors.values()) {
    if (tradeActions >= tradeBudget) break;
    if (co.owner !== c.id) continue;
    const key = `set_toll:${co.id}`;
    const until = c.actionCooldowns[key];
    if (until !== undefined && until > day) continue;

    let target: number | null = null;
    let rationale = '';

    // Flux tiers empruntant actuellement le corridor (la demande réelle)
    const users: { from: Country; to: Country; value: number }[] = [];
    for (const route of world.routes.values()) {
      if (!route.corridors?.includes(co.id) || route.fromId === c.id) continue;
      const from = world.country(route.fromId);
      const to = world.country(route.toId);
      if (from && to) users.push({ from, to, value: route.value });
    }
    users.sort((a, b) => b.value - a.value);

    if (users.length > 0) {
      const cache: RouteCache = new Map();
      let marginSum = 0;
      let n = 0;
      for (const u of users.slice(0, 4)) {
        const opts = routeOptions(world, u.from, u.to, cache);
        const current = opts.find((o) => o.corridors.includes(co.id));
        const alt = opts.find((o) => !o.corridors.includes(co.id));
        if (!current || !alt) continue;
        const mineWithoutToll = current.costRate - co.toll;
        const maxToll = alt.costRate - mineWithoutToll - 0.8; // marge de sécurité anti-détournement
        marginSum += clamp(maxToll, 1, 12);
        n++;
      }
      if (n > 0) {
        target = round(clamp(marginSum / n, 2, 12), 1);
        rationale = `demande mesurée sur ${n} flux — marge de capture avant détournement`;
      }
    }
    if (target === null) {
      // Repli : heuristique de trafic cumulé
      target = co.traffic > 40 ? 7 : co.traffic > 12 ? 5 : co.traffic < 3 ? 2 : co.toll;
      rationale = `trafic cumulé ${co.traffic.toFixed(0)} Md €`;
    }
    // Trafic détourné : baisser pour faire revenir les flux
    if (users.length === 0 && co.traffic > 5 && co.toll > 3) {
      target = Math.max(2, round(co.toll - 2, 1));
      rationale = 'flux détournés — baisse du péage pour les récupérer';
    }
    if (Math.abs(co.toll - target) >= 1.5) {
      const res = executeAction(world, c.id, { type: 'set_toll', corridorId: co.id, value: target }, ctx);
      if (res.ok) {
        result.actionsExecuted += 1; tradeActions += 1;
        decisions.push({ day, countryId: c.id, problem: `Péage ${co.name} sous-optimal`, action: 'set_toll', detail: `→ ${target} %`, rationale });
      }
    }
  }

  /* Acheter une route stratégique — décision par RETOUR SUR INVESTISSEMENT :
     revenu quotidien estimé depuis les flux réels, moins l'entretien. */
  if (tradeActions < tradeBudget && rng() < 0.3) {
    const candidates = [...world.corridors.values()].filter((co) => !co.owner && c.economy.cash > co.purchaseCost * 1.4);
    let best: { co: import('shared').TradeCorridor; payback: number; score: number; income: number } | null = null;
    for (const co of candidates) {
      const income = corridorIncomeEstimate(world, c, co, 4); // péage initial modéré
      const netDaily = income - co.upkeep / 365;
      const payback = netDaily > 0.0005 ? co.purchaseCost / netDaily : Infinity;
      let score: number;
      if (Number.isFinite(payback)) score = 3 - Math.min(2.5, payback / 150);
      else score = relevance(c, co); // pas encore de trafic : potentiel géographique
      if (!best || score > best.score) best = { co, payback, score, income };
    }
    const rentable = best && Number.isFinite(best.payback) && best.payback <= 220;
    const potentiel = best && !Number.isFinite(best.payback) && relevance(c, best.co) > 0.55 && c.economy.cash > best.co.purchaseCost * 1.8;
    if (best && (rentable || potentiel)) {
      const res = executeAction(world, c.id, { type: 'buy_corridor', corridorId: best.co.id }, ctx);
      if (res.ok) {
        result.actionsExecuted += 1; tradeActions += 1;
        decisions.push({
          day, countryId: c.id, problem: 'Besoin d’une route commerciale stratégique', action: 'buy_corridor', detail: best.co.id,
          rationale: rentable
            ? `retour sur investissement ≈ ${Math.round(best!.payback)} jours (revenu estimé ${best!.income.toFixed(3)} Md €/j, entretien ${best.co.upkeep} Md €/an)`
            : `potentiel géographique ${relevance(c, best.co).toFixed(2)} — réserve de trésorerie confortable`,
        });
      }
    }
  }

  /* Diversifier ses routes d'exportation : si les péages pèsent trop, basculer
     vers la meilleure combinaison alternative (économie réelle immédiate). */
  if (tradeActions < tradeBudget && rng() < 0.3) {
    const myRoutes = [...world.routes.values()]
      .filter((r) => r.fromId === c.id)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3);
    for (const route of myRoutes) {
      const to = world.country(route.toId);
      if (!to) continue;
      const current = chooseRoute(world, c, to);
      if (!current || current.tollRate <= 9) continue;
      const alt = routeOptions(world, c, to).find((o) => o.id !== current.id && o.costRate <= current.costRate - 2.5);
      if (!alt) continue;
      const res = executeAction(world, c.id, { type: 'set_route', partnerId: to.id, pathId: alt.id }, ctx);
      if (res.ok) {
        result.actionsExecuted += 1; tradeActions += 1;
        decisions.push({
          day, countryId: c.id, problem: `Péages excessifs vers ${to.name} (${current.tollRate.toFixed(1)} %)`,
          action: 'set_route', detail: alt.id,
          rationale: `économie de transit ${(current.costRate - alt.costRate).toFixed(1)} points via « ${alt.label} »`,
        });
      }
      break; // une diversion par cycle
    }
  }

  /* Opportunisme de marché : vendre HAUT quand les cours s'envolent,
     acheter BAS quand ils s'effondrent (stockage stratégique). */
  if (tradeActions < tradeBudget && rng() < 0.5) {
    for (const key of RESOURCE_KEYS) {
      const r = c.resources[key];
      const m = world.market[key];
      if (!m) continue;
      const base = RESOURCE_MAP[key].basePrice;
      const ratio = r.capacity > 0 ? r.stock / r.capacity : 0;
      if (m.price > base * 1.25 && ratio > 0.55 && r.production >= r.consumption) {
        const units = round(Math.min(r.stock * 0.15, r.capacity * 0.2), 1);
        if (units >= 2) {
          // v1.19 : cours envolés → offre inter-états au PREMIUM (le marché
          // mondial n'achète plus directement : joueurs et IA achètent les offres).
          const unitPrice = round(m.price * 1.06, 2);
          const res = executeAction(world, c.id, { type: 'create_offer', resource: key, units, unitPrice }, ctx);
          if (res.ok) {
            result.actionsExecuted += 1; tradeActions += 1;
            decisions.push({ day, countryId: c.id, problem: `Cours de ${RESOURCE_MAP[key].name.toLowerCase()} anormalement haut (${m.price.toFixed(2)} vs base ${base})`, action: 'create_offer', detail: `${units} u @ ${unitPrice}`, rationale: `vendre haut via offre : prix ${((m.price / base) * 100).toFixed(0)} % de la base, stocks ${(ratio * 100).toFixed(0)} %` });
          }
        }
        break;
      }
      if (m.price < base * 0.8 && ratio < 0.5 && r.consumption > r.production) {
        const room = r.capacity - r.stock;
        const units = round(Math.min(room * 0.25, r.consumption * 6), 1);
        const cost = units * m.price * 0.045;
        if (units >= 2 && c.economy.cash > cost * 2) {
          const res = executeAction(world, c.id, { type: 'buy_resource', resource: key, units }, ctx);
          if (res.ok) {
            result.actionsExecuted += 1; tradeActions += 1;
            decisions.push({ day, countryId: c.id, problem: `Cours de ${RESOURCE_MAP[key].name.toLowerCase()} anormalement bas (${m.price.toFixed(2)} vs base ${base})`, action: 'buy_resource', detail: `${units} u`, rationale: `acheter bas pour stocker : prix ${((m.price / base) * 100).toFixed(0)} % de la base` });
          }
        }
        break;
      }
    }
  }

  /* Vendre les surplus : publier une offre sur le marché inter-états.
     Les joueurs (et autres IA) peuvent l'acheter ; la recette tombe
     automatiquement dans la trésorerie, même hors ligne. */
  if (tradeActions < tradeBudget && rng() < 0.3) {
    const myOpen = world.offers.filter((o) => o.sellerId === c.id && o.status === 'open').length;
    if (myOpen < 2) {
      for (const key of RESOURCE_KEYS) {
        const r = c.resources[key];
        const ratio = r.capacity > 0 ? r.stock / r.capacity : 0;
        const surplus = r.production - r.consumption;
        if (ratio < 0.6 || surplus <= 0.3) continue;
        const units = round(Math.min(surplus * 3, r.stock * 0.12, 50), 1);
        if (units < 3) continue;
        const worldPrice = world.market[key]?.price ?? RESOURCE_MAP[key].basePrice;
        // v1.19 : prix intelligent — pénurie mondiale (cours qui grimpent) →
        // premium ; gros surplus durable → décote pour vendre vite.
        const scarcity = clamp((world.market[key]?.change24h ?? 0) / 12, -0.5, 0.5);
        const surplusWeight = clamp(surplus / Math.max(0.5, r.consumption), 0, 2) / 2; // 0..1
        const unitPrice = round(clamp(
          worldPrice * (0.94 + scarcity * 0.22 - surplusWeight * 0.06 + rng() * 0.05),
          RESOURCE_MAP[key].basePrice * 0.4, RESOURCE_MAP[key].basePrice * 4,
        ), 2);
        const res = executeAction(world, c.id, { type: 'create_offer', resource: key, units, unitPrice }, ctx);
        if (res.ok) {
          result.actionsExecuted += 1; tradeActions += 1;
          decisions.push({
            day, countryId: c.id, problem: `Surplus de ${RESOURCE_MAP[key].name.toLowerCase()} à valoriser (stocks ${(ratio * 100).toFixed(0)} %)`,
            action: 'create_offer', detail: `${units} u @ ${unitPrice}`,
            rationale: `cours mondial ${worldPrice.toFixed(2)} — offre placée pour vendre vite, recette automatique en trésorerie`,
          });
        }
        break; // une offre par cycle
      }
    }
  }

  /* Acheter les offres de vente des autres nations quand le prix est
     avantageux : le marché inter-états vit aussi côté IA. L'argent de la
     vente part DIRECTEMENT dans la trésorerie du vendeur (joueurs inclus). */
  if (tradeActions < tradeBudget && rng() < 0.7) {
    const offers = world.openOffers();
    for (const o of offers) {
      if (o.sellerId === c.id) continue;
      const seller = world.country(o.sellerId);
      if (!seller) continue;
      const rel = c.relations[o.sellerId];
      if (!rel || rel.sanctionByUs || rel.sanctionByThem) continue;
      if (rel.score < 35 && !rel.agreements.some((a) => a.status === 'active')) continue;
      const r = c.resources[o.resource];
      const ratio = r.capacity > 0 ? r.stock / r.capacity : 1;
      const needsIt = r.consumption > r.production || ratio < 0.5;
      if (!needsIt) continue;
      if (o.units > r.capacity - r.stock) continue;
      // v13 : en pénurie CRITIQUE (stocks < 35 %), l'IA accepte de payer
      // jusqu'à +10 % au-dessus de son prix local (sécurité d'approvisionnement) ;
      // sinon elle n'achète que sous son prix local, comme avant.
      const critical = ratio < 0.35;
      if (o.unitPrice > r.price * (critical ? 1.1 : 0.98)) continue;
      const cost = round(o.units * o.unitPrice * VALUE_SCALE * 1000, 2);
      if (c.economy.cash < cost * 1.5) continue;
      const res = executeAction(world, c.id, { type: 'buy_offer', offerId: o.id }, ctx);
      if (res.ok) {
        result.actionsExecuted += 1; tradeActions += 1;
        decisions.push({
          day, countryId: c.id, problem: `Opportunité marché : offre de ${seller.name} sur ${o.resource}`,
          action: 'buy_offer', detail: `${o.units} u @ ${o.unitPrice.toFixed(2)}`,
          rationale: `prix à ${((o.unitPrice / Math.max(0.01, r.price)) * 100).toFixed(0)} % du prix local, stocks à ${(ratio * 100).toFixed(0)} %`,
        });
      }
      break; // une offre par cycle
    }
  }

  /* Expédier un excédent vers le meilleur client (1 fois par cycle environ).
     Toute expédition passe par la meilleure route commerciale (multi-étapes) :
     jamais de voie directe — les péages alimentent la trésorerie des
     propriétaires de routes. */
  if (tradeActions < tradeBudget && rng() < 0.6) {
    const routeCache: RouteCache = new Map();
    let best: { resource: ResourceKey; units: number; to: Country; routeLabel: string; tollRate: number; score: number } | null = null;
    for (const key of RESOURCE_KEYS) {
      const r = c.resources[key];
      const surplus = r.production - r.consumption;
      const ratio = r.capacity > 0 ? r.stock / r.capacity : 0;
      if (surplus <= 0.4 || ratio < 0.45) continue;
      for (const other of world.allCountries()) {
        if (other.id === c.id || other.controller.kind === 'player') continue;
        const rel = c.relations[other.id];
        if (!rel || rel.sanctionByUs || rel.sanctionByThem) continue;
        if (rel.score < 40 && !rel.agreements.some((a) => a.status === 'active')) continue;
        const or = other.resources[key];
        if (or.consumption <= or.production) continue;
        const room = or.capacity - or.stock;
        if (room < 5) continue;
        const units = round(Math.min(surplus * 4, r.stock * 0.25, room * 0.5), 1);
        if (units < 2) continue;
        // Meilleure route (la moins chère) : bonus si l'une des étapes m'appartient
        const route = chooseRoute(world, c, other, routeCache);
        if (!route) continue;
        const ownsLeg = route.corridors.some((cid) => world.corridor(cid)?.owner === c.id);
        const score = rel.score + rel.tradeVolume * 8 + (ownsLeg ? 6 : 0) - route.tollRate;
        if (!best || score > best.score) {
          best = { resource: key, units, to: other, routeLabel: route.label, tollRate: route.tollRate, score };
        }
      }
    }
    if (best) {
      const b = best;
      const res = executeAction(world, c.id, { type: 'ship_goods', toId: b.to.id, resource: b.resource, units: b.units, corridorId: 'auto' }, ctx);
      if (res.ok) {
        result.actionsExecuted += 1; tradeActions += 1;
        c.ai.lastActionDay = day;
        decisions.push({ day, countryId: c.id, problem: `Excédent de ${b.resource} à écouler`, action: 'ship_goods', detail: `${b.units} u → ${b.to.id} via « ${b.routeLabel} »`, rationale: `relation ${c.relations[b.to.id]?.score.toFixed(0)}, péages ${b.tollRate.toFixed(1)} %` });
      }
    }
  }
}

function relevance(c: Country, co: import('shared').TradeCorridor): number {
  let vol = 0;
  for (const r of Object.values(c.relations)) {
    if (r.tradeVolume > 0.01) vol += r.tradeVolume;
  }
  const inRegion = co.regions.includes(c.region) ? 1.5 : 0.5;
  const hub = co.hubs.includes(c.id) ? 1 : 0;
  return Math.min(1, vol / 20) * inRegion * 0.6 + hub * 0.5;
}

/** Point d'entrée du tick : parcourt les pays dirigés par une IA. */
export function processAI(
  world: WorldStore,
  rng: () => number,
  notify?: ActionContext['notify'],
  onBigWin?: ActionContext['onBigWin'],
): AiPhaseResult {
  const total: AiPhaseResult = { decisions: [], actionsExecuted: 0, proposalsAnswered: 0 };
  const decisions: Omit<AiDecisionLog, 'id' | 'ts'>[] = [];
  for (const c of world.allCountries()) {
    if (c.controller.kind !== 'ai') continue;
    const ctx: ActionContext = { world, actor: { kind: 'ai', name: c.controller.presidentName }, notify, onBigWin };
    const res = runAiCountry(c, world, { rng, ctx, decisions });
    total.actionsExecuted += res.actionsExecuted;
    total.proposalsAnswered += res.proposalsAnswered;
    world.markDirty(c.id);
  }
  total.decisions = decisions;
  if (decisions.length > 0) {
    log.debug(`Cycle IA : ${decisions.length} décision(s) sur ${total.actionsExecuted} action(s) appliquée(s)`);
  }
  return total;
}

/** Notification d'avertissement de mandat (utilisée par le moteur pour les joueurs). */
export function mandateWarningNotification(c: Country, threshold: number): Omit<GameNotification, 'userId' | 'id' | 'ts' | 'read'> {
  return {
    type: 'mandate',
    title: threshold >= 48 ? 'Risque politique CRITIQUE' : threshold >= 28 ? 'Risque politique élevé' : 'Risque politique modéré',
    body:
      `Popularité sous ${35} % depuis ${threshold} jours. ` +
      `Sans redressement (popularité > 45 %), le gouvernement tombera au bout de 72 jours.`,
    day: 0,
  };
}
