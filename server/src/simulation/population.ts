/**
 * GEOPOLIS — Simulation : démographie.
 * La population évolue selon le niveau de vie, le chômage, l'inflation
 * et la qualité des services (santé, logements).
 */
import type { Country } from 'shared';
import { clamp, round } from '../util/core.js';

export function processPopulation(c: Country): void {
  const e = c.economy;
  const healthFactor = (c.policy.spending.health - 3) * 0.02 + (c.infra.hospitals?.level ?? 0) * 0.008;
  const rateAnnual =
    0.32 +
    (e.standardOfLiving - 50) * 0.009 +
    healthFactor -
    Math.max(0, e.unemployment - 8) * 0.045 -
    Math.max(0, e.inflation - 10) * 0.05 +
    (c.stability - 60) * 0.003;
  const clamped = clamp(rateAnnual, -1.2, 3.2); // % par an
  c.population = round(c.population * (1 + clamped / 100 / 365), 3);
  c.population = Math.max(0.05, c.population);
}
