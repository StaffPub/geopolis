/**
 * GEOPOLIS — Simulation : chantiers d'infrastructures.
 * Progression quotidienne, paiement échelonné, effets appliqués à la livraison.
 */
import type { Country } from 'shared';
import { INFRA_MAP } from 'shared';
import { createLogger } from '../logger.js';
import { clamp, round } from '../util/core.js';

const log = createLogger('SIMULATION:INFRA');

export interface InfraPhaseResult {
  projectDailyCost: number;
  completed: string[]; // noms d'infrastructures livrées (pour journal/notifications)
}

export function processInfrastructure(c: Country): InfraPhaseResult {
  const result: InfraPhaseResult = { projectDailyCost: 0, completed: [] };
  if (c.projects.length === 0) return result;

  const remaining: typeof c.projects = [];
  for (const p of c.projects) {
    const def = INFRA_MAP[p.infra];
    if (!def) {
      log.warn(`Chantier avec infrastructure inconnue supprimé : ${p.infra} (${c.id})`);
      continue;
    }
    const daily = p.cost / p.buildDays;
    // Si la trésorerie ne suit pas, le chantier ralentit (50 % de vitesse) mais ne meurt pas
    const slowed = c.economy.cash < daily ? 0.5 : 1;
    const paid = Math.min(daily * slowed, Math.max(0, c.economy.cash + daily));
    c.economy.cash = round(Math.max(0, c.economy.cash - paid), 3);
    result.projectDailyCost += paid;
    p.invested = round(p.invested + paid, 2);
    p.progress = clamp(p.progress + (1 / p.buildDays) * slowed, 0, 1);
    if (p.progress >= 1) {
      const infra = c.infra[p.infra];
      if (infra) infra.level = clamp(p.targetLevel, 0, def.maxLevel);
      result.completed.push(def.name);
    } else {
      remaining.push(p);
    }
  }
  c.projects = remaining;
  return result;
}
