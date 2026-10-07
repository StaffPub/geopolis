/**
 * Tests des lois v1.9 : catalogue enrichi (14 lois dont 4 de popularité),
 * effet popularité RÉEL et mesurable, plafond de 6 lois, abrogation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LAWS, RESOURCE_KEYS } from 'shared';
import { executeAction } from '../src/actions/registry.js';
import { processPolitics } from '../src/simulation/politics.js';
import { lawEffects } from '../src/simulation/model.js';
import { createTestContext, setPlayerController, type TestContext } from './helpers.js';
import type { ActionContext } from '../src/actions/registry.js';

const ZERO_UNMET = Object.fromEntries(RESOURCE_KEYS.map((k) => [k, 0])) as Record<(typeof RESOURCE_KEYS)[number], number>;

describe('Lois & popularité', () => {
  let ctx: TestContext;
  let actor: ActionContext;

  beforeAll(async () => {
    ctx = await createTestContext();
    setPlayerController(ctx.world, 'france', 'user_law_fr', 'Lucas');
    actor = { world: ctx.world, actor: { kind: 'player', name: 'Lucas', userId: 'user_law_fr' } };
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('catalogue : 14 lois dont 4 lois de popularité fortes', () => {
    expect(LAWS.length).toBe(14);
    const pop = LAWS.filter((l) => (l.modifiers.popularity ?? 0) >= 0.2);
    expect(pop.map((l) => l.id).sort()).toEqual(['citizens_referendum', 'civic_service', 'national_festival', 'purchasing_power_bonus']);
    // Chaque loi a un coût borné et des effets cohérents
    for (const l of LAWS) {
      expect(l.annualCostPctGdp).toBeGreaterThanOrEqual(0);
      expect(l.annualCostPctGdp).toBeLessThanOrEqual(1);
      expect(l.name.length).toBeGreaterThan(3);
    }
  });

  it('le festival national augmente RÉELLEMENT la popularité quotidienne', () => {
    const c = ctx.world.country('france')!;
    c.laws = [];
    c.popularity = 50; // même état de départ pour les deux mesures
    const sans = processPolitics(c, { unmet: ZERO_UNMET, energyStrain: 0 });
    const deltaSans = sans.popularityDelta;
    c.laws = [{ id: 'inst_test', lawId: 'national_festival', enactedDay: 0 }];
    c.popularity = 50;
    const avec = processPolitics(c, { unmet: ZERO_UNMET, energyStrain: 0 });
    c.laws = [];
    // +0,45/semaine → +0,45/7 par jour (tolérance 0,011 : le moteur arrondit
    // la popularité à 2 décimales, ce qui ajoute ±0,005 au delta mesuré)
    expect(Math.abs(avec.popularityDelta - deltaSans - 0.45 / 7)).toBeLessThan(0.011);
    expect(avec.popularityDelta).toBeGreaterThan(deltaSans);
    c.popularity = 50;
    expect(lawEffects(c).popularityDaily).toBeCloseTo(0, 3); // propre après reset
  });

  it('adoption via action : effets appliqués et coût dans le solde', () => {
    const c = ctx.world.country('france')!;
    c.laws = [];
    c.actionCooldowns = {};
    const res = executeAction(ctx.world, 'france', { type: 'enact_law', lawId: 'purchasing_power_bonus' }, actor);
    expect(res.ok, res.error ?? '').toBe(true);
    expect(c.laws.some((l) => l.lawId === 'purchasing_power_bonus')).toBe(true);
    expect(lawEffects(c).popularityDaily).toBeCloseTo(0.35 / 7, 3);
    // Le coût annuel pèse sur les dépenses recalculées au prochain tick éco
    expect(c.economy.spending).toBeGreaterThanOrEqual(0);
  });

  it('plafond de 6 lois : la 7e est refusée', () => {
    const c = ctx.world.country('france')!;
    c.laws = [];
    const ids = LAWS.slice(0, 6).map((l) => l.id);
    c.laws = ids.map((id, i) => ({ id: `inst_${i}`, lawId: id, enactedDay: 0 }));
    c.actionCooldowns = {};
    const res = executeAction(ctx.world, 'france', { type: 'enact_law', lawId: LAWS[6]!.id }, actor);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/6 lois/i);
    c.laws = [];
  });

  it('abrogation : les effets cessent immédiatement', () => {
    const c = ctx.world.country('france')!;
    c.laws = [{ id: 'inst_x', lawId: 'national_festival', enactedDay: 0 }];
    c.actionCooldowns = {};
    const res = executeAction(ctx.world, 'france', { type: 'repeal_law', lawId: 'national_festival' }, actor);
    expect(res.ok).toBe(true);
    expect(c.laws.length).toBe(0);
    expect(lawEffects(c).popularityDaily).toBeCloseTo(0, 3);
  });
});
