/**
 * GEOPOLIS — Simulation : macroéconomie & finances publiques.
 * Recettes, dépenses, dette, intérêts, croissance, inflation, chômage,
 * productivité, niveau de vie, consommation — le tout en chaînes causales.
 */
import type { Country, ResourceKey } from 'shared';
import { LAW_MAP, REGIME_MAP, RESOURCE_MAP } from 'shared';
import { clamp, round, approach } from '../util/core.js';
import { VALUE_SCALE } from '../actions/registry.js';
import {
  aggregateEventModifiers,
  debtRatio,
  infraEffects,
  lawEffects,
  spendingSum,
  stockRatio,
  type EventAgg,
} from './model.js';

export interface EconomyInputs {
  tariffRevenueDaily: number;   // Md € / jour accumulés pendant le tick (commerce)
  netExportShare: number;       // (exports − imports) / PIB, effet croissance
  energyStrain: number;         // 0..1
  unmet: Record<ResourceKey, number>;
  projectDailyCost: number;     // Md € / jour (chantiers)
}

export function shortagePressure(unmet: Record<ResourceKey, number>): number {
  // pression agrégée des pénuries (0..1)
  const weights: Record<ResourceKey, number> = {
    food: 1.2, energy: 1.3, oil: 0.9, gas: 0.7,
    minerals: 0.5, materials: 0.7, industrial: 0.6, tech: 0.4,
  };
  let s = 0;
  let w = 0;
  for (const k of Object.keys(unmet) as ResourceKey[]) {
    s += unmet[k] * weights[k];
    w += weights[k];
  }
  return w > 0 ? clamp(s / w, 0, 1) : 0;
}

export function investRateOf(c: Country): number {
  const base =
    0.15 +
    c.policy.spending.industry * 0.012 +
    c.policy.spending.research * 0.008 -
    c.policy.corporateTax * 0.0015 +
    (c.stability - 60) * 0.0008 +
    (c.economy.growth - 2) * 0.004;
  return clamp(base, 0.07, 0.35);
}

function basePrice(key: ResourceKey): number {
  return RESOURCE_MAP[key].basePrice;
}

export function processEconomy(c: Country, inputs: EconomyInputs): void {
  const infra = infraEffects(c);
  const laws = lawEffects(c);
  const events = aggregateEventModifiers(c);
  const e = c.economy;
  const shortage = shortagePressure(inputs.unmet);

  /* ---------------- Taux d'intérêt de la dette & charge ---------------- */
  const dr = debtRatio(c);
  const riskPremium = Math.max(0, (dr - 60) * 0.03) + Math.max(0, e.inflation - 6) * 0.08;
  // La place financière réduit structurellement le taux servi sur la dette.
  const debtRate = clamp(1.2 + c.policy.interestRate * 0.5 + riskPremium - infra.debtRateCut, 0.3, 20);
  e.interestPaid = round((e.debt * debtRate) / 100, 2);

  /* ---------------- Recettes & dépenses (annuelles) ---------------- */
  const regime = REGIME_MAP[c.regime];
  const taxBase = e.gdp * (0.85 + e.consumptionIndex / 600);
  const taxRevenue = (taxBase * (c.policy.taxRate * 0.55 + c.policy.corporateTax * 0.25)) / 100 * (regime?.effects.revenueMul ?? 1) * (1 + infra.revenueBonus);
  const tariffRevenue = inputs.tariffRevenueDaily * 365;
  e.revenue = round(taxRevenue + tariffRevenue, 2);

  const programSpending = (e.gdp * spendingSum(c)) / 100;
  // Coût annuel RÉEL des lois en vigueur (promis par le catalogue, l'estimation
  // d'enact_law et le simulateur législatif) : il doit survivre à chaque tick.
  let lawsCost = 0;
  for (const law of c.laws) {
    const def = LAW_MAP[law.lawId];
    if (def) lawsCost += (e.gdp * def.annualCostPctGdp) / 100;
  }
  e.spending = round(programSpending + infra.upkeepAnnual + e.interestPaid + lawsCost, 2);
  e.balance = round(e.revenue - e.spending, 2);

  /* ---------------- Flux de trésorerie quotidiens ---------------- */
  const dailyBudget = e.balance / 365;
  e.cash = round(e.cash + dailyBudget - inputs.projectDailyCost, 2);
  if (e.cash < 0) {
    e.debt = round(e.debt - e.cash, 2); // financement du déficit
    e.cash = 0;
  } else if (e.cash > e.gdp * 0.05 && dr > 20) {
    const repay = Math.min(e.cash - e.gdp * 0.04, e.debt * 0.002);
    e.cash = round(e.cash - repay, 2);
    e.debt = round(e.debt - repay, 2);
  }

  /* Plafond SOUPLE de trésorerie : un État n'accumule pas indéfiniment
     (péages, ventes au marché mondial, excédents). Au-delà de 120 % du PIB :
     1) remboursement ANTICIPÉ de la dette (la valeur est conservée : elle
        réduit la dette et les intérêts futurs) ;
     2) le reste est stérilisé en investissements souverains : 50 % de
        l'excédent par jour (plancher 2 % du PIB/j) — convergence géométrique
        rapide, sans jamais détruire brutalement l'argent à la sauvegarde.
     Ce plafond reste très en dessous du garde d'intégrité (2×PIB) : le garde
     ne se déclenche plus en jeu normal (fin du spam INTEGRITY « cash hors
     bornes » et de la destruction silencieuse de trésorerie). */
  const cashSoftCap = e.gdp * 1.2;
  if (e.cash > cashSoftCap) {
    const repayDebt = Math.min(e.cash - cashSoftCap, e.debt);
    if (repayDebt > 0) {
      e.cash = round(e.cash - repayDebt, 2);
      e.debt = round(e.debt - repayDebt, 2);
    }
    const excess = e.cash - cashSoftCap;
    if (excess > 0.01) {
      const sterilized = Math.max(excess * 0.5, Math.min(excess, e.gdp * 0.02));
      e.cash = round(e.cash - sterilized, 2);
    }
  }

  /* ---------------- Investissement ---------------- */
  const investRate = investRateOf(c);
  e.investment = round(e.gdp * investRate, 1);

  /* ---------------- Consommation (indice) ---------------- */
  const consTarget = clamp(
    58 + e.standardOfLiving * 0.5 - c.policy.taxRate * 0.85 - Math.max(0, e.inflation - 2.5) * 1.4
      - Math.max(0, e.unemployment - 5.5) * 0.7 + c.policy.spending.social * 1.6 + laws.consumption * 20
      - shortage * 12,
    25, 165,
  );
  e.consumptionIndex = round(approach(e.consumptionIndex, consTarget, 0.05), 1);

  /* ---------------- Productivité ---------------- */
  const prodDelta =
    (c.policy.spending.education - 2.8) * 0.004 +
    (c.policy.spending.research - 1.0) * 0.006 +
    (c.infra.universities?.level ?? 0) * 0.0009 +
    (c.infra.techHubs?.level ?? 0) * 0.0009 +
    laws.productivity * 0.002 -
    inputs.energyStrain * 0.05 -
    shortage * 0.02 -
    0.002;
  e.productivity = round(clamp(e.productivity + prodDelta * 4, 45, 220), 2);

  /* ---------------- Croissance ----------------
     Modèle lisible et plus doux : un POTENTIEL structurel positif, auquel on
     ajoute le commerce et retranche des freins modérés. Chaque contribution est
     exposée (growthBreakdown) pour être expliquée à l'utilisateur. */
  // Potentiel ancré sur la croissance structurelle du pays (seed réel),
  // modulé par l'investissement, la productivité et l'éducation : le monde ne
  // part jamais en récession généralisée sans cause réelle et visible.
  const computed = 1.4 + (investRate - 0.16) * 7 + (e.productivity - 100) * 0.02 + (c.policy.spending.education - 2.8) * 0.15 + infra.growthBonus;
  const potential = clamp(0.55 * e.growthPotential + 0.45 * computed, 0.4, 6.5);
  const tradeBoost = inputs.netExportShare * 26 + (c.ai.personality.tradeOpenness - 0.5) * 0.4;
  const inflationDrag = Math.min(2.2, Math.max(0, e.inflation - 5) * 0.1);
  const rateDrag = Math.max(0, c.policy.interestRate - 4) * 0.12;
  const shortageDrag = shortage * 1.2 + inputs.energyStrain * 0.6;
  const debtDrag = Math.max(0, dr - 110) * 0.012;
  const eventBoost = events.growthDelta + laws.growth * 0.5;
  const regimeGrowth = (regime?.effects.growthDelta ?? 0) + (c.regimeHoneymoon?.growthDelta ?? 0);

  const breakdown = {
    base: round(potential, 2),
    commerce: round(tradeBoost, 2),
    inflation: round(-inflationDrag, 2),
    taux: round(-rateDrag, 2),
    penuries: round(-shortageDrag, 2),
    dette: round(-debtDrag, 2),
    evenements: round(eventBoost, 2),
    regime: round(regimeGrowth, 2),
    total: 0,
  };
  const growthTarget = clamp(
    potential + tradeBoost - inflationDrag - rateDrag - shortageDrag - debtDrag + eventBoost + regimeGrowth,
    -4, 9,
  );
  breakdown.total = round(
    potential + tradeBoost - inflationDrag - rateDrag - shortageDrag - debtDrag + eventBoost + regimeGrowth, 2);
  e.growthBreakdown = breakdown;
  e.growth = round(approach(e.growth, growthTarget, 0.07), 2);
  e.gdp = round(e.gdp * (1 + e.growth / 100 / 365), 2);

  /* ---------------- Inflation ---------------- */
  const pricePressure = pricePressureOf(c);
  const inflationTarget = clamp(
    2 +
    (e.consumptionIndex - 100) * 0.035 +
    pricePressure * 2.2 +
    Math.max(0, -e.balance / Math.max(1, e.gdp)) * 6 +   // monétisation du déficit
    events.inflationDelta +
    laws.inflation * 0.2 -
    Math.max(0, c.policy.interestRate - 3) * 0.45,
    -2.5, 45,
  );
  e.inflation = round(approach(e.inflation, inflationTarget, 0.05), 2);

  /* ---------------- Chômage ---------------- */
  const unemploymentTarget = clamp(
    9.2 - e.growth * 1.05 - (c.policy.spending.industry - 1.2) * 0.45 -
    (investRate - 0.17) * 12 + inputs.energyStrain * 3.5 + shortage * 2.5 +
    Math.max(0, e.inflation - 8) * 0.25 + events.unemploymentDelta,
    1.5, 30,
  );
  e.unemployment = round(approach(e.unemployment, unemploymentTarget, 0.06), 2);

  /* ---------------- Niveau de vie ---------------- */
  const perCapBonus = clamp(e.gdp / Math.max(0.1, c.population) / 2.2, 0, 26);
  const livingTarget = clamp(
    12 + perCapBonus + infra.services * 0.9 +
    (c.policy.spending.health - 3) * 1.6 + (c.policy.spending.social - 3) * 1.3 +
    (c.policy.spending.education - 2.8) * 1.1 +
    (c.infra.housing?.level ?? 0) * 0.9 -
    Math.max(0, e.inflation - 3) * 1.1 - Math.max(0, e.unemployment - 6) * 0.7 -
    shortage * 9,
    2, 100,
  );
  e.standardOfLiving = round(approach(e.standardOfLiving, livingTarget, 0.03), 1);
}

/** Pression inflationniste venant des prix locaux des ressources. */
export function pricePressureOf(c: Country): number {
  let p = 0;
  for (const key of Object.keys(c.resources) as ResourceKey[]) {
    const ratio = stockRatio(c, key);
    const deviation = c.resources[key].price / basePrice(key) - 1;
    const weight = key === 'food' || key === 'energy' ? 0.3 : 0.1;
    p += deviation * weight * (ratio < 0.35 ? 1.5 : 1);
  }
  return clamp(p, -1, 3);
}

/** Ajuste les prix locaux (offre/demande/stocks) puis convergence vers le marché mondial. */
export function processPrices(c: Country, globalPrices: Record<ResourceKey, number>, events: EventAgg): void {
  for (const key of Object.keys(c.resources) as ResourceKey[]) {
    const r = c.resources[key];
    const ratio = stockRatio(c, key);
    let factor = 1;
    if (ratio < 0.35) factor += (0.35 - ratio) * 0.5;
    else if (ratio > 0.7) factor -= (ratio - 0.7) * 0.28;
    // v19 : signe CORRIGÉ — un excédent de production tire le prix vers le BAS,
    // un déficit le tire vers le HAUT (l'ancien signe inversé créait une
    // spirale prix-plafond dès que les surstocks s'accumulaient).
    const prodGap = r.consumption > 0 ? (r.production - r.consumption) / r.consumption : 0;
    factor -= clamp(prodGap, -0.15, 0.15);
    r.price = round(r.price * clamp(factor, 0.9, 1.12), 3);
    // Convergence vers le prix mondial (écart tarifaire inclus)
    const tariffWedge = 1 + (c.policy.tariff / 100) * 0.25;
    const global = (globalPrices[key] ?? r.price) * tariffWedge;
    r.price = round(approach(r.price, global, 0.06) * (events.priceMul[key] ** 0.15), 3);
    r.price = round(clamp(r.price, basePrice(key) * 0.35, basePrice(key) * 6), 3);
  }
}

/** Prix mondiaux : agrégation des prix locaux pondérée par la taille des économies. */
export function updateGlobalMarket(
  countries: Country[],
  market: Record<ResourceKey, { price: number; prevPrice: number; change24h: number; series: number[] }>,
): void {
  for (const key of Object.keys(market) as ResourceKey[]) {
    let num = 0;
    let den = 0;
    for (const c of countries) {
      const r = c.resources[key];
      const surplus = r.production - r.consumption;
      const w = Math.max(0.2, c.population / 100) * (surplus > 0 ? 2 : 1);
      num += r.price * w;
      den += w;
    }
    const avg = den > 0 ? num / den : market[key].price;
    const m = market[key];
    m.prevPrice = m.price;
    m.price = round(clamp(approach(m.price, avg, 0.12), basePrice(key) * 0.3, basePrice(key) * 7), 3);
    m.series.push(m.price);
    if (m.series.length > 300) m.series.shift();
    const ref = m.series.length >= 25 ? m.series[m.series.length - 25]! : m.series[0]!;
    m.change24h = ref > 0 ? round(((m.price - ref) / ref) * 100, 2) : 0;
  }
}

/** Valeur monétaire (Md €) d'un volume de ressource au prix donné. */
export function tradeValue(units: number, price: number): number {
  return round(units * price * VALUE_SCALE * 1000, 3);
}
