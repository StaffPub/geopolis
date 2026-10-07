/**
 * GEOPOLIS — Simulation : politique intérieure.
 * Popularité (multi-factorielle), stabilité, risque politique et mandat.
 * La perte de mandat n'est jamais instantanée : tendance + durée sous le seuil
 * + avertissements progressifs + possibilité de redressement.
 */
import type { Country, ResourceKey } from 'shared';
import { REGIME_MAP } from 'shared';
import { clamp, round, approach } from '../util/core.js';
import {
  aggregateEventModifiers,
  debtRatio,
  infraEffects,
  lawEffects,
  stockRatio,
} from './model.js';
import { shortagePressure } from './economy.js';

export const POPULARITY_CRISIS = 35;
export const POPULARITY_RECOVERY = 45;
export const MANDATE_LOSS_TICKS = 72;   // ~72 jours de jeu sous le seuil critique
export const WARNING_THRESHOLDS = [12, 28, 48] as const;

export interface PoliticsInputs {
  unmet: Record<ResourceKey, number>;
  energyStrain: number;
}

export interface PoliticsResult {
  mandateLost: string | null;      // raison si le président joueur perd le mandat
  warningThreshold: number | null; // seuil d'avertissement franchi ce tick
  popularityDelta: number;
}

export function processPolitics(c: Country, inputs: PoliticsInputs): PoliticsResult {
  const result: PoliticsResult = { mandateLost: null, warningThreshold: null, popularityDelta: 0 };
  const e = c.economy;
  const laws = lawEffects(c);
  const infra = infraEffects(c);
  const events = aggregateEventModifiers(c);
  const shortage = shortagePressure(inputs.unmet);
  const dr = debtRatio(c);

  /* ---------------- Popularité ---------------- */
  const servicesScore = clamp(
    (c.policy.spending.health - 3) * 1.15 +
    (c.policy.spending.education - 2.8) * 1.0 +
    (c.policy.spending.social - 3) * 1.05 +
    (c.policy.spending.transport - 2.2) * 0.5 +
    (c.infra.hospitals?.level ?? 0) * 0.55 +
    (c.infra.housing?.level ?? 0) * 0.35 +
    (c.infra.schools?.level ?? 0) * 0.35,
    -9, 11,
  );
  const foodStress = inputs.unmet['food'] ?? 0;
  const energyStress = inputs.unmet['energy'] ?? 0;

  const target = clamp(
    50 +
    (e.growth - 2) * 2.6 -
    Math.max(0, e.inflation - 2.5) * 2.0 -
    (e.unemployment - 5.5) * 1.7 +
    (e.standardOfLiving - 55) * 0.45 -
    Math.max(0, c.policy.taxRate - 18) * 0.5 +
    servicesScore -
    shortage * 9 -
    foodStress * 14 -
    energyStress * 10 -
    Math.max(0, dr - 70) * 0.06 -
    sanctionCount(c) * 1.5,
    2, 97,
  );

  // Régime politique : dérive d'opinion permanente + lune de miel/malus temporaire
  const regime = REGIME_MAP[c.regime];
  const honey = c.regimeHoneymoon;
  const regimePop = (regime?.effects.popularityDaily ?? 0) + (honey?.popularityDaily ?? 0);

  const before = c.popularity;
  c.popularity = round(clamp(
    approach(c.popularity, target, 0.045) + laws.popularityDaily + events.popularityDaily + regimePop + infra.popDaily,
    0, 100,
  ), 2);
  result.popularityDelta = round(c.popularity - before, 3);

  /* ---------------- Stabilité ---------------- */
  const stabilityTarget = clamp(
    34 + c.popularity * 0.5 + e.standardOfLiving * 0.14 -
    Math.max(0, e.inflation - 4) * 0.9 - sanctionCount(c) * 3.5 +
    (c.laws.some((l) => l.lawId === 'labor_protection') ? 2.5 : 0) +
    (c.laws.some((l) => l.lawId === 'fiscal_discipline') ? 2 : 0) -
    shortage * 7 - inputs.energyStrain * 4,
    2, 99,
  );
  c.stability = round(clamp(
    approach(c.stability, stabilityTarget, 0.05) + laws.stabilityDaily + events.stabilityDaily + (regime?.effects.stabilityDaily ?? 0) + infra.stabDaily,
    0, 100,
  ), 2);

  /* ---------------- Mandat (joueurs humains uniquement) ---------------- */
  const m = c.mandate;
  m.popularityTrend = round(result.popularityDelta * 5, 2); // projection tendance
  if (c.controller.kind !== 'player') {
    m.lowPopularityTicks = Math.max(0, m.lowPopularityTicks - 1);
    m.risk = 'faible';
    return result;
  }
  if (c.popularity < POPULARITY_CRISIS) {
    m.lowPopularityTicks += 1;
  } else if (c.popularity > POPULARITY_RECOVERY) {
    m.lowPopularityTicks = Math.max(0, m.lowPopularityTicks - 2); // redressement possible
  }
  m.risk =
    m.lowPopularityTicks >= 48 ? 'critique' :
    m.lowPopularityTicks >= 28 ? 'élevé' :
    m.lowPopularityTicks >= 12 ? 'modéré' : 'faible';

  for (const th of WARNING_THRESHOLDS) {
    if (m.lowPopularityTicks === th) {
      result.warningThreshold = th;
      m.warningsSent += 1;
      break;
    }
  }
  if (m.lowPopularityTicks >= MANDATE_LOSS_TICKS || (c.stability < 8 && c.popularity < 25)) {
    result.mandateLost =
      m.lowPopularityTicks >= MANDATE_LOSS_TICKS
        ? `Popularité sous ${POPULARITY_CRISIS} % pendant ${m.lowPopularityTicks} jours`
        : 'Effondrement de la stabilité nationale';
  }
  return result;
}

function sanctionCount(c: Country): number {
  return Object.values(c.relations).filter((r) => r.sanctionByUs || r.sanctionByThem).length;
}

/** Risque politique affiché (avec tendance). */
export function riskSummary(c: Country): { risk: string; trend: number; daysUnder: number } {
  return {
    risk: c.mandate.risk,
    trend: c.mandate.popularityTrend,
    daysUnder: c.mandate.lowPopularityTicks,
  };
}

/** Alertes politiques générées depuis l'état courant (ids stables pour éviter le churn). */
export function politicalAlerts(c: Country): { id: string; severity: 'warning' | 'critical' | 'politics' | 'info'; title: string; message: string }[] {
  const out: { id: string; severity: 'warning' | 'critical' | 'politics' | 'info'; title: string; message: string }[] = [];
  const dr = debtRatio(c);
  const balPct = c.economy.gdp > 0 ? (c.economy.balance / c.economy.gdp) * 100 : 0;
  if (balPct < -4) {
    out.push({ id: 'deficit', severity: 'warning', title: 'Déficit budgétaire élevé', message: `Solde à ${balPct.toFixed(1)} % du PIB. La dette augmente chaque jour.` });
  }
  if (dr > 95) {
    out.push({ id: 'debt', severity: 'critical', title: 'Dette publique critique', message: `Dette à ${dr.toFixed(0)} % du PIB : les intérêts s’envolent.` });
  }
  if (stockRatio(c, 'energy') < 0.25) {
    out.push({ id: 'energy', severity: 'critical', title: 'Stock énergétique critique', message: `Énergie : ${(stockRatio(c, 'energy') * 100).toFixed(0)} % de capacité. Risque industriel.` });
  }
  if (stockRatio(c, 'food') < 0.25) {
    out.push({ id: 'food', severity: 'critical', title: 'Stock alimentaire critique', message: `Alimentation : ${(stockRatio(c, 'food') * 100).toFixed(0)} % de capacité.` });
  }
  if (c.controller.kind === 'player' && c.mandate.risk !== 'faible') {
    out.push({ id: 'mandate', severity: 'politics', title: 'Popularité en baisse', message: `Risque politique ${c.mandate.risk} — ${c.mandate.lowPopularityTicks} jour(s) sous le seuil critique.` });
  }
  if (c.economy.unemployment > 11) {
    out.push({ id: 'unemployment', severity: 'warning', title: 'Chômage élevé', message: `${c.economy.unemployment.toFixed(1)} % de chômage : la grogne sociale monte.` });
  }
  if (c.economy.inflation > 7) {
    out.push({ id: 'inflation', severity: 'warning', title: 'Inflation élevée', message: `${c.economy.inflation.toFixed(1)} % : le pouvoir d’achat recule.` });
  }
  return out;
}
