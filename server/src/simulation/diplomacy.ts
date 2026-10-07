/**
 * GEOPOLIS — Simulation : diplomatie.
 * Dérive quotidienne des relations (le commerce rapproche, les sanctions éloignent),
 * expiration des accords à durée limitée. Aucun système de guerre : les tensions
 * restent économiques et diplomatiques.
 */
import type { Agreement } from 'shared';
import { clamp, round } from '../util/core.js';
import type { WorldStore } from '../world/world.js';

export interface DiplomacyEvent {
  kind: 'agreement_expired';
  countryIds: [string, string];
  agreement: Agreement;
}

export function processDiplomacy(world: WorldStore): DiplomacyEvent[] {
  const day = world.meta.day;
  const events: DiplomacyEvent[] = [];
  const seen = new Set<string>();

  for (const c of world.allCountries()) {
    for (const [otherId, rel] of Object.entries(c.relations)) {
      const other = world.country(otherId);
      if (!other) continue;
      const pairId = c.id < otherId ? `${c.id}|${otherId}` : `${otherId}|${c.id}`;
      const orel = other.relations[c.id];
      if (!orel) continue;

      if (!seen.has(pairId)) {
        seen.add(pairId);
        let delta = 0;
        const activeAgreements = rel.agreements.filter((a) => a.status === 'active').length;
        if (rel.tradeVolume > 0.01) {
          delta += 0.028 + activeAgreements * 0.008;   // le commerce rapproche
          rel.trust = clamp(rel.trust + 0.02, 0, 100);
          orel.trust = clamp(orel.trust + 0.02, 0, 100);
        } else {
          delta += (50 - rel.score) * 0.004;           // retour lent vers la neutralité
        }
        if (rel.sanctionByUs || rel.sanctionByThem) {
          delta -= 0.18;                               // les mesures économiques dégradent
          rel.trust = clamp(rel.trust - 0.08, 0, 100);
          orel.trust = clamp(orel.trust - 0.08, 0, 100);
        }
        if (day - rel.lastContactDay > 60 && delta > 0) delta *= 0.5; // l'oubli refroidit

        rel.score = round(clamp(rel.score + delta, 0, 100), 2);
        orel.score = round(clamp(orel.score + delta, 0, 100), 2);
        rel.tradeVolume = round(rel.tradeVolume * 0.92, 4);
        orel.tradeVolume = rel.tradeVolume;
      }

      // Expiration des accords à durée limitée
      for (const ag of rel.agreements) {
        if (ag.status === 'active' && ag.expiresDay !== null && ag.expiresDay <= day) {
          ag.status = 'expired';
          const mirror = orel.agreements.find((x) => x.id === ag.id);
          if (mirror) mirror.status = 'expired';
          events.push({ kind: 'agreement_expired', countryIds: [c.id, otherId], agreement: ag });
        }
      }
      // Purge des vieilles propositions/rejets pour éviter l'accumulation
      if (rel.agreements.length > 12) {
        rel.agreements = rel.agreements.filter(
          (a) => a.status === 'active' || a.status === 'proposed' || day - a.createdDay < 30,
        );
      }
    }
    world.markDirty(c.id);
  }
  return events;
}
