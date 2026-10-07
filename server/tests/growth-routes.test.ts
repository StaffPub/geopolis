/**
 * Tests : croissance cohérente & expliquée, routes multi-étapes,
 * préférences de route par partenaire.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { routeOptions } from '../src/simulation/trade.js';
import { executeAction, quoteShipment } from '../src/actions/registry.js';
import { createTestContext, setPlayerController, type TestContext } from './helpers.js';

describe('Croissance expliquée & monde cohérent', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('chaque pays expose une décomposition de croissance cohérente', async () => {
    await ctx.engine.forceTicks(5);
    for (const c of ctx.world.allCountries()) {
      const bd = c.economy.growthBreakdown;
      expect(bd, `${c.id} sans breakdown`).toBeDefined();
      const sum = bd!.base + bd!.commerce + bd!.inflation + bd!.taux + bd!.penuries + bd!.dette + bd!.evenements + bd!.regime;
      expect(Math.abs(sum - bd!.total), `${c.id} total incohérent`).toBeLessThan(0.06);
      // Les freins sont ≤ 0, le potentiel > 0
      expect(bd!.base).toBeGreaterThan(0);
      expect(bd!.inflation).toBeLessThanOrEqual(0);
      expect(bd!.penuries).toBeLessThanOrEqual(0);
    }
  }, 60_000);

  it('le monde n’est pas en récession généralisée (jeu plus doux)', async () => {
    for (let i = 0; i < 150; i++) await ctx.engine.forceTicks(1);
    const growths = ctx.world.allCountries().map((c) => c.economy.growth);
    const avg = growths.reduce((a, b) => a + b, 0) / growths.length;
    const negatives = growths.filter((g) => g < 0).length;
    expect(avg, `croissance moyenne ${avg.toFixed(2)}`).toBeGreaterThan(0.5);
    expect(negatives, `${negatives} pays en récession`).toBeLessThanOrEqual(6);
  }, 120_000);
});

describe('Routes multi-étapes & préférences', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
    setPlayerController(ctx.world, 'canada', 'user_ca', 'Justin');
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('combinaisons de routes : corridors chaînés uniquement (aucune voie directe)', () => {
    const canada = ctx.world.country('canada')!;
    const chine = ctx.world.country('chine')!;
    const opts = routeOptions(ctx.world, canada, chine);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.some((o) => o.id === 'direct')).toBe(false);
    expect(opts.every((o) => o.corridors.length >= 1)).toBe(true);
    expect(opts.some((o) => o.corridors.includes('pacifique'))).toBe(true);
    // Multi-étapes : au moins une combinaison à 2 corridors ou plus quelque part
    const france = ctx.world.country('france')!;
    const bresil = ctx.world.country('bresil')!;
    const opts2 = routeOptions(ctx.world, france, bresil);
    expect(opts2.some((o) => o.corridors.length >= 2)).toBe(true);
  });

  it('set_route : le président choisit sa combinaison par partenaire', () => {
    const canada = ctx.world.country('canada')!;
    const res = executeAction(
      ctx.world, 'canada',
      { type: 'set_route', partnerId: 'chine', pathId: 'pacifique' },
      { world: ctx.world, actor: { kind: 'player', name: 'Justin', userId: 'user_ca' } },
    );
    expect(res.ok).toBe(true);
    expect(canada.routePrefs['chine']).toBe('pacifique');
    const bad = executeAction(
      ctx.world, 'canada',
      { type: 'set_route', partnerId: 'chine', pathId: 'canal_suez' },
      { world: ctx.world, actor: { kind: 'player', name: 'Justin', userId: 'user_ca' } },
    );
    expect(bad.ok).toBe(false);
  });

  it('le transit paie le propriétaire du corridor (péage exact, après acceptation)', () => {
    const pac = ctx.world.corridor('pacifique')!;
    pac.owner = 'france';
    pac.toll = 10;
    const france = ctx.world.country('france')!;
    const canada = ctx.world.country('canada')!;
    const chine = ctx.world.country('chine')!;
    canada.resources.minerals.stock = 300;
    chine.resources.minerals.capacity = 5000;
    chine.resources.minerals.stock = 0;
    const cashFr = france.economy.cash;
    const quote = quoteShipment(ctx.world, canada, chine, 'minerals', 50, 'pacifique');
    expect(quote.ok).toBe(true);
    expect(quote.toll).toBeGreaterThan(0);
    const res = executeAction(
      ctx.world, 'canada',
      { type: 'ship_goods', toId: 'chine', resource: 'minerals', units: 50, corridorId: 'pacifique' },
      { world: ctx.world, actor: { kind: 'player', name: 'Justin', userId: 'user_ca' } },
    );
    expect(res.ok).toBe(true);
    // Avant acceptation : le péage n'est pas encore versé
    expect(france.economy.cash).toBe(cashFr);
    const pending = ctx.world.pendingDeliveries.find((d) => d.fromId === 'canada' && d.toId === 'chine')!;
    expect(pending).toBeDefined();
    const accept = executeAction(
      ctx.world, 'chine',
      { type: 'respond_delivery', deliveryId: pending.id, accept: true },
      { world: ctx.world, actor: { kind: 'ai', name: 'Gouvernement Chine' } },
    );
    expect(accept.ok).toBe(true);
    expect(france.economy.cash).toBeCloseTo(cashFr + quote.toll, 1);
    expect(pac.traffic).toBeGreaterThan(0);
    expect(chine.resources.minerals.stock).toBeCloseTo(50, 0);
  });

  it('le commerce automatique emprunte la route préférée et la trace sur la carte', async () => {
    const canada = ctx.world.country('canada')!;
    const chine = ctx.world.country('chine')!;
    // Isoler la paire : les autres fournisseurs de minerais passent à surplus nul
    for (const other of ctx.world.allCountries()) {
      if (other.id === 'canada') continue;
      const r = other.resources.minerals;
      if (r.production > r.consumption) r.production = r.consumption;
    }
    canada.resources.minerals.production = 40;
    canada.resources.minerals.consumption = 5;
    canada.resources.minerals.stock = 300;
    chine.resources.minerals.consumption = 60;
    chine.resources.minerals.production = 10;
    chine.resources.minerals.stock = 5;
    chine.relations['canada']!.score = 70;
    canada.relations['chine']!.score = 70;
    await ctx.engine.forceTicks(3);
    const route = ctx.world.routes.get('canada->chine:minerals');
    expect(route?.corridors).toContain('pacifique');
    // Le trafic du corridor est cumulé (et le péage de la France — propriétaire
    // défini au test précédent — tombe dans sa trésorerie)
    expect(ctx.world.corridor('pacifique')!.traffic).toBeGreaterThan(0);
  }, 60_000);
});
