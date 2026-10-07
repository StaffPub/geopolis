/**
 * Tests du système de régimes politiques : catalogue, alignement avec la
 * volonté du peuple, changement (boost/malus, lune de miel, cooldown,
 * stabilité minimale), effets permanents réels (popularité, recettes,
 * croissance), expiration de la lune de miel, changement de régime par l'IA.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { REGIMES, REGIME_MAP, demandSeverities, regimeAlignment } from 'shared';
import { executeAction } from '../src/actions/registry.js';
import { processPolitics } from '../src/simulation/politics.js';
import { processEconomy } from '../src/simulation/economy.js';
import { runAiCountry } from '../src/simulation/ai.js';
import { createTestContext, setPlayerController, type TestContext } from './helpers.js';
import type { ActionContext } from '../src/actions/registry.js';

describe('Régimes politiques', () => {
  let ctx: TestContext;
  let actor: ActionContext;

  beforeAll(async () => {
    ctx = await createTestContext();
    setPlayerController(ctx.world, 'france', 'user_reg_fr', 'Lucas');
    actor = { world: ctx.world, actor: { kind: 'player', name: 'Lucas', userId: 'user_reg_fr' } };
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('catalogue : 6 régimes aux effets finis et affinités valides', () => {
    expect(REGIMES.length).toBe(6);
    const demandIds = ['jobs', 'prices', 'tax', 'health', 'education', 'housing', 'social', 'food', 'energy', 'change', 'calm'];
    for (const r of REGIMES) {
      expect(Number.isFinite(r.effects.popularityDaily)).toBe(true);
      expect(Number.isFinite(r.effects.stabilityDaily)).toBe(true);
      expect(Number.isFinite(r.effects.growthDelta)).toBe(true);
      expect(r.effects.revenueMul).toBeGreaterThan(0.9);
      expect(r.effects.revenueMul).toBeLessThan(1.15);
      expect(r.affinities.length).toBeGreaterThanOrEqual(2);
      for (const a of r.affinities) expect(demandIds).toContain(a);
    }
  });

  it('alignement : un peuple en inflation s\'aligne sur la Technocratie, pas sur la Monarchie', () => {
    const c = ctx.world.country('france')!;
    c.economy.inflation = 12;
    c.economy.unemployment = 5;
    c.policy.taxRate = 18;
    c.policy.spending.health = 4;
    c.policy.spending.education = 3.5;
    c.policy.spending.social = 3.5;
    c.infra.housing = { level: 6 };
    c.resources.food.stock = c.resources.food.capacity * 0.7;
    c.resources.energy.stock = c.resources.energy.capacity * 0.7;
    c.popularity = 60;
    c.stability = 70;
    const sev = demandSeverities(c);
    expect(sev.prices).toBeGreaterThan(0.5);
    expect(regimeAlignment(c, 'Technocratie')).toBeGreaterThan(regimeAlignment(c, 'Monarchie constitutionnelle'));
    c.economy.inflation = 2;
  });

  it('changement aligné : popularité ↑, stabilité ↓, lune de miel posée, journal tracé', () => {
    const c = ctx.world.country('france')!;
    c.economy.inflation = 12; // le peuple réclame du prix → Technocratie alignée
    c.popularity = 50;
    c.stability = 70;
    c.regime = 'Monarchie constitutionnelle';
    c.actionCooldowns = {};
    c.regimeHoneymoon = null;
    const popBefore = c.popularity;
    const stabBefore = c.stability;
    const res = executeAction(ctx.world, 'france', { type: 'change_regime', regime: 'Technocratie' }, actor);
    expect(res.ok, res.error ?? '').toBe(true);
    expect(c.regime).toBe('Technocratie');
    expect(c.regimeSinceDay).toBe(ctx.world.meta.day);
    expect(c.popularity).toBeGreaterThan(popBefore);   // aligné → boost
    expect(c.stability).toBeLessThan(stabBefore);      // transition coûte
    expect(c.regimeHoneymoon).not.toBeNull();
    expect(c.regimeHoneymoon!.popularityDaily).toBeGreaterThan(0);
    expect(c.regimeHoneymoon!.growthDelta).toBeGreaterThan(0);
    expect(c.regimeHoneymoon!.untilDay).toBe(ctx.world.meta.day + 30);
    expect(ctx.world.journal.some((j) => j.text.includes('change de régime'))).toBe(true);
    c.economy.inflation = 2;
  });

  it('changement contre le peuple : popularité ↓ et gueule de bois', () => {
    const c = ctx.world.country('france')!;
    c.actionCooldowns = {};
    c.regimeHoneymoon = null;
    // Peuple qui réclame emploi + social + logement : République fédérale très alignée
    c.regime = 'République fédérale';
    c.economy.inflation = 2; c.economy.unemployment = 14; c.popularity = 55; c.stability = 70;
    c.policy.spending.social = 2;
    const alignTech = regimeAlignment(c, 'Technocratie');
    const alignFed = regimeAlignment(c, 'République fédérale');
    expect(alignFed).toBeGreaterThan(alignTech);
    const popBefore = c.popularity;
    // Imposer la Technocratie CONTRE la volonté du peuple
    const res = executeAction(ctx.world, 'france', { type: 'change_regime', regime: 'Technocratie' }, actor);
    expect(res.ok).toBe(true);
    expect(c.popularity).toBeLessThan(popBefore); // transition contestée
    expect(c.regimeHoneymoon?.popularityDaily ?? 0).toBeLessThan(0);
    c.policy.spending.social = 3;
  });

  it('garde-fous : même régime refusé, stabilité basse refusée, cooldown 90 jours', () => {
    const c = ctx.world.country('france')!;
    c.actionCooldowns = {};
    c.stability = 70;
    c.regime = 'Fédération';
    const same = executeAction(ctx.world, 'france', { type: 'change_regime', regime: 'Fédération' }, actor);
    expect(same.ok).toBe(false);
    expect(same.error).toMatch(/déjà en place/i);
    c.stability = 15;
    const fragile = executeAction(ctx.world, 'france', { type: 'change_regime', regime: 'Technocratie' }, actor);
    expect(fragile.ok).toBe(false);
    expect(fragile.error).toMatch(/stabilité/i);
    c.stability = 70;
    const ok = executeAction(ctx.world, 'france', { type: 'change_regime', regime: 'Technocratie' }, actor);
    expect(ok.ok).toBe(true);
    const again = executeAction(ctx.world, 'france', { type: 'change_regime', regime: 'Fédération' }, actor);
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/cooldown/i);
  });

  it('effets permanents RÉELS : dérive de popularité et multiplicateur de recettes', () => {
    const c = ctx.world.country('france')!;
    c.regimeHoneymoon = null;
    c.laws = [];
    c.activeEvents = [];
    const zero = Object.fromEntries(Object.keys(c.resources).map((k) => [k, 0])) as Record<string, number>;
    // Monarchie : +0,012/j ; Technocratie : −0,028/j → écart 0,04/j
    c.regime = 'Monarchie constitutionnelle';
    c.popularity = 50;
    const mono = processPolitics(c, { unmet: zero as never, energyStrain: 0 });
    c.regime = 'Technocratie';
    c.popularity = 50;
    const tech = processPolitics(c, { unmet: zero as never, energyStrain: 0 });
    expect(mono.popularityDelta).toBeGreaterThan(tech.popularityDelta);
    expect(Math.abs((mono.popularityDelta - tech.popularityDelta) - 0.04)).toBeLessThan(0.011);
    // Recettes : ×1,08 vs ×0,99
    c.regime = 'Monarchie constitutionnelle';
    processEconomy(c, { tariffRevenueDaily: 0, netExportShare: 0, energyStrain: 0, unmet: zero as never, projectDailyCost: 0 });
    const revMono = c.economy.revenue;
    c.regime = 'Technocratie';
    processEconomy(c, { tariffRevenueDaily: 0, netExportShare: 0, energyStrain: 0, unmet: zero as never, projectDailyCost: 0 });
    const revTech = c.economy.revenue;
    expect(revTech / revMono).toBeCloseTo(1.08 / 0.99, 2);
    c.regime = 'République parlementaire';
  });

  it('lune de miel expire au tick suivant son échéance', async () => {
    const c = ctx.world.country('france')!;
    c.actionCooldowns = {};
    c.regimeHoneymoon = { untilDay: ctx.world.meta.day, popularityDaily: 0.1, growthDelta: 0.5 };
    await ctx.engine.forceTicks(1);
    expect(c.regimeHoneymoon).toBeNull();
  }, 60_000);

  it('une IA en crise change de régime vers celui que son peuple réclame', () => {
    const italie = ctx.world.country('italie')!;
    italie.controller = { kind: 'ai', userId: null, presidentName: 'IA Régime', since: Date.now(), sinceDay: 0 };
    italie.regime = 'Monarchie constitutionnelle';
    italie.regimeHoneymoon = null;
    italie.actionCooldowns = {};
    italie.economy.inflation = 13;      // le peuple réclame du pouvoir d'achat
    italie.economy.unemployment = 5;
    italie.popularity = 44;             // fragile → déclencheur
    italie.stability = 65;
    italie.policy.spending.health = 4;
    italie.policy.spending.education = 3.5;
    italie.policy.spending.social = 3.5;
    italie.infra.housing = { level: 6 };
    italie.resources.food.stock = italie.resources.food.capacity * 0.7;
    italie.resources.energy.stock = italie.resources.energy.capacity * 0.7;
    italie.ai.nextDecisionTick = 0;
    italie.ai.lastMoves = [];
    const decisions: { action: string }[] = [];
    runAiCountry(italie, ctx.world, {
      rng: () => 0.05,
      ctx: { world: ctx.world, actor: { kind: 'ai', name: 'IA Régime' } },
      decisions: decisions as never,
    });
    expect(italie.regime !== 'Monarchie constitutionnelle' || decisions.some((d) => d.action === 'change_regime'),
      'l’IA n’a pas changé de régime malgré un désalignement massif').toBe(true);
  });

  it('monde complet 40 ticks : régimes toujours valides, aucune valeur NaN', async () => {
    for (let i = 0; i < 40; i++) await ctx.engine.forceTicks(1);
    for (const c of ctx.world.allCountries()) {
      expect(REGIME_MAP[c.regime], `régime invalide chez ${c.id}`).toBeDefined();
      expect(Number.isFinite(c.popularity)).toBe(true);
      expect(Number.isFinite(c.stability)).toBe(true);
      if (c.regimeHoneymoon) {
        expect(Number.isFinite(c.regimeHoneymoon.popularityDaily)).toBe(true);
        expect(Number.isFinite(c.regimeHoneymoon.growthDelta)).toBe(true);
      }
    }
  }, 120_000);
});
