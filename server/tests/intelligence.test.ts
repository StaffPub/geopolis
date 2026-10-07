/**
 * Tests de l'IA avancée v1.9 : prévision d'épuisement (agit AVANT la pénurie),
 * opportunisme de marché (vendre haut / acheter bas), mémoire d'apprentissage.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AiDecisionLog } from 'shared';
import { RESOURCE_MAP } from 'shared';
import { runAiCountry } from '../src/simulation/ai.js';
import { createTestContext, type TestContext } from './helpers.js';
import type { ActionContext } from '../src/actions/registry.js';

describe('IA intelligente : prévision & opportunisme', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const aiCtx = (): ActionContext => ({ world: ctx.world, actor: { kind: 'ai', name: 'IA Test' } });

  it('épuisement prévu sous 12 jours → action préventive (achat/boost/bâtiment)', () => {
    const c = ctx.world.country('italie')!;
    c.controller = { kind: 'ai', userId: null, presidentName: 'IA Test', since: Date.now(), sinceDay: 0 };
    c.economy.cash = 600;
    c.resources.food.capacity = 60;
    c.resources.food.stock = 25;          // ratio 0,42 (> 0,3 : pas encore "pénurie")
    c.resources.food.consumption = 20;
    c.resources.food.production = 10;     // net −10/j → épuisement dans 2,5 j
    c.ai.nextDecisionTick = 0;
    c.ai.lastMoves = [];
    c.ai.learned = {};
    c.ai.memory = null;
    const decisions: Omit<AiDecisionLog, 'id' | 'ts'>[] = [];
    const res = runAiCountry(c, ctx.world, { rng: () => 0.05, ctx: aiCtx(), decisions });
    const preventive = decisions.filter((d) =>
      d.action === 'buy_resource' || d.action === 'set_production' || d.action === 'build_facility');
    expect(res.actionsExecuted).toBeGreaterThan(0);
    expect(preventive.length, 'aucune action préventive sur épuisement prévu').toBeGreaterThan(0);
    expect(preventive[0]!.rationale.length).toBeGreaterThan(3);
    // Mémoire d'apprentissage : le coup est enregistré
    expect(c.ai.lastMoves.length).toBeGreaterThan(0);
  });

  it('cours anormalement HAUT + surplus → l\'IA vend au marché (vendre haut)', () => {
    const c = ctx.world.country('japon')!;
    c.controller = { kind: 'ai', userId: null, presidentName: 'IA Test', since: Date.now(), sinceDay: 0 };
    c.economy.cash = 400;
    // Prix mondial de l'énergie à 150 % de la base
    ctx.world.market.energy.price = RESOURCE_MAP.energy.basePrice * 1.5;
    c.resources.energy.capacity = 1000;
    c.resources.energy.stock = 600;       // ratio 0,6 > 0,55
    c.resources.energy.production = 30;
    c.resources.energy.consumption = 20;  // surplus
    // Alimentation neutre pour ne pas déclencher d'achat food
    ctx.world.market.food.price = RESOURCE_MAP.food.basePrice;
    c.ai.nextDecisionTick = 0;
    c.ai.lastMoves = [];
    const decisions: Omit<AiDecisionLog, 'id' | 'ts'>[] = [];
    runAiCountry(c, ctx.world, { rng: () => 0.05, ctx: aiCtx(), decisions });
    expect(decisions.some((d) => (d.action === 'create_offer' || d.action === 'sell_resource') && d.detail.includes('u')),
      'aucune vente opportuniste détectée').toBe(true);
    // Restaure le marché pour les autres tests
    ctx.world.market.energy.price = RESOURCE_MAP.energy.basePrice;
  });

  it('apprentissage : un mouvement qui ne résout rien voit son poids baisser', () => {
    const c = ctx.world.country('grece')!;
    c.controller = { kind: 'ai', userId: null, presidentName: 'IA Test', since: Date.now(), sinceDay: 0 };
    c.economy.cash = 600;
    // Problème persistant artificiel : chômage structurel
    c.economy.unemployment = 15;
    c.economy.growth = 0.2;
    c.ai.nextDecisionTick = 0;
    c.ai.lastMoves = [{ action: 'start_project', problem: 'unemployment', day: ctx.world.meta.day - 8 }];
    c.ai.learned = { start_project: 1 };
    const decisions: Omit<AiDecisionLog, 'id' | 'ts'>[] = [];
    runAiCountry(c, ctx.world, { rng: () => 0.05, ctx: aiCtx(), decisions });
    // Le problème unemployment existe toujours → poids de start_project pénalisé
    expect(c.ai.learned.start_project).toBeLessThan(1);
    expect(c.ai.learned.start_project).toBeGreaterThanOrEqual(0.4);
  });

  it('aucun crash sur 60 ticks avec la nouvelle IA (monde complet)', async () => {
    for (let i = 0; i < 60; i++) await ctx.engine.forceTicks(1);
    for (const c of ctx.world.allCountries()) {
      expect(Number.isFinite(c.economy.cash)).toBe(true);
      expect(Number.isFinite(c.popularity)).toBe(true);
      for (const v of Object.values(c.ai.learned ?? {})) {
        expect(v).toBeGreaterThanOrEqual(0.4);
        expect(v).toBeLessThanOrEqual(1.6);
      }
      expect((c.ai.lastMoves ?? []).length).toBeLessThanOrEqual(12);
    }
  }, 180_000);
});
