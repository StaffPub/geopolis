/**
 * Tests v1.12.1 — Correctifs économiques du monde long :
 *  - Le coût annuel des lois est réellement facturé à chaque tick (il n'est
 *    plus effacé par le recalcul budgétaire de processEconomy).
 *  - Plafond SOUPLE de trésorerie : remboursement anticipé de la dette puis
 *    stérilisation souveraine — le garde d'intégrité (2×PIB) ne tronque plus
 *    brutalement l'argent à la sauvegarde (fin du spam « cash hors bornes »).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { executeAction } from '../src/actions/registry.js';
import { sanitizeCountry } from '../src/world/integrity.js';
import { createTestContext, setPlayerController, type TestContext } from './helpers.js';

describe('Économie — coût des lois & plafond de trésorerie', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('le coût annuel des lois survit au recalcul budgétaire (facturé chaque tick)', async () => {
    const c = ctx.world.country('france')!;
    setPlayerController(ctx.world, 'france', 'user_eco', 'Eco');
    c.laws = [];
    await ctx.engine.forceTicks(1); // spending de référence recalculé SANS loi
    const spendNoLaw = c.economy.spending;
    const gdp = c.economy.gdp;
    // « Couverture santé universelle » = 0,7 % du PIB / an (catalogue LAWS)
    const res = executeAction(
      ctx.world, 'france',
      { type: 'enact_law', lawId: 'health_coverage' },
      { world: ctx.world, actor: { kind: 'player', name: 'Eco', userId: 'user_eco' } },
    );
    expect(res.ok).toBe(true);
    await ctx.engine.forceTicks(1); // recalcul complet du budget par le moteur
    expect(c.laws).toHaveLength(1);
    // La dépense inclut toujours ~0,7 % du PIB : le coût n'a PAS été effacé
    expect(c.economy.spending).toBeGreaterThan(spendNoLaw + gdp * 0.007 * 0.8);
  }, 120_000);

  it('trésorerie excédentaire : dette remboursée d’abord, puis convergence sous le garde d’intégrité', async () => {
    const c = ctx.world.country('allemagne')!;
    c.economy.debt = c.economy.gdp * 0.5;
    c.economy.cash = c.economy.gdp * 3; // excès massif (monde long qui hoarde)
    const debt0 = c.economy.debt;
    await ctx.engine.forceTicks(1);
    // 1) Remboursement anticipé : la dette baisse (la valeur n'est pas détruite)
    expect(c.economy.debt).toBeLessThan(debt0);
    // 2) Sous le garde dur (2×PIB) dès le premier tick : plus de tronçonnage
    expect(c.economy.cash).toBeLessThanOrEqual(c.economy.gdp * 2);
    const report = sanitizeCountry(c);
    expect(report.issues.filter((i) => i.includes('cash'))).toEqual([]);
    // 3) Convergence géométrique vers le plafond souple (1,2×PIB)
    await ctx.engine.forceTicks(6);
    expect(c.economy.cash).toBeLessThan(c.economy.gdp * 1.6);
    expect(c.economy.cash).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it('sauvegarde complète : AUCUNE correction d’intégrité sur la trésorerie', async () => {
    const before = ctx.world.meta.integrityIssues;
    // Pousser plusieurs pays au-dessus du plafond puis sauver : le moteur a
    // déjà fait converger les valeurs, le garde ne corrige rien.
    for (const id of ['usa', 'chine', 'bresil']) {
      const c = ctx.world.country(id)!;
      c.economy.cash = c.economy.gdp * 2.5;
    }
    await ctx.engine.forceTicks(2); // le plafond souple s'applique avant la sauvegarde
    await ctx.world.save();
    expect(ctx.world.meta.integrityIssues).toBe(before);
  }, 120_000);
});
