/**
 * Tests v1.16 — Nouvelles infrastructures (18 réseaux) : effets RÉELS sur le
 * moteur (agriculture, finance, culture, recherche, aéroports, télécom),
 * migration d'intégrité des mondes anciens, et cohérence du catalogue.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INFRA, INFRA_MAP, RESOURCE_KEYS } from 'shared';
import type { InfraKey, ResourceKey } from 'shared';
import { infraEffects, lawEffects, aggregateEventModifiers } from '../src/simulation/model.js';
import { computeProduction } from '../src/simulation/production.js';
import { processEconomy } from '../src/simulation/economy.js';
import { processPolitics } from '../src/simulation/politics.js';
import { sanitizeCountry } from '../src/world/integrity.js';
import { executeAction } from '../src/actions/registry.js';
import { createTestContext, setPlayerController, type TestContext } from './helpers.js';

const ZERO_UNMET = Object.fromEntries(RESOURCE_KEYS.map((k) => [k, 0])) as Record<ResourceKey, number>;
const INPUTS = { tariffRevenueDaily: 0, netExportShare: 0, energyStrain: 0, unmet: ZERO_UNMET, projectDailyCost: 0 };

describe('Catalogue v16 : 18 réseaux, boosts déclarés', () => {
  it('18 clés uniques, catégories et boosts présents partout', () => {
    expect(INFRA).toHaveLength(18);
    const keys = new Set(INFRA.map((d) => d.key));
    expect(keys.size).toBe(18);
    for (const def of INFRA) {
      expect(def.boosts.length, `${def.key} sans boosts`).toBeGreaterThan(0);
      expect(def.category, `${def.key} sans catégorie`).toBeTruthy();
      expect(INFRA_MAP[def.key]).toBeDefined();
      expect(def.maxLevel).toBe(10);
    }
    for (const k of ['airports', 'telecom', 'research', 'water', 'finance', 'culture'] as InfraKey[]) {
      expect(keys.has(k), `nouveau réseau manquant : ${k}`).toBe(true);
    }
  });
});

describe('Effets RÉELS des nouvelles infrastructures sur le moteur', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('infraEffects : irrigation, finance, culture, recherche, aéroports', () => {
    const c = ctx.world.country('france')!;
    const set = (k: InfraKey, level: number) => { c.infra[k] = { level }; };
    for (const k of Object.keys(c.infra) as InfraKey[]) set(k, 0);
    let f = infraEffects(c);
    expect(f.foodMul).toBeCloseTo(1, 5);
    expect(f.debtRateCut).toBeCloseTo(0, 5);
    expect(f.popDaily).toBeCloseTo(0, 5);
    expect(f.growthBonus).toBeCloseTo(0, 5);
    expect(f.exportCap).toBeCloseTo(1, 5);

    set('water', 5); set('finance', 5); set('culture', 5); set('research', 5); set('airports', 5);
    f = infraEffects(c);
    expect(f.foodMul).toBeCloseTo(1.15, 5);
    expect(f.debtRateCut).toBeCloseTo(0.75, 5);
    expect(f.revenueBonus).toBeCloseTo(0.075, 5);
    expect(f.popDaily).toBeCloseTo(0.05, 5);
    expect(f.stabDaily).toBeCloseTo(0.04, 5);
    expect(f.growthBonus).toBeCloseTo(0.25, 5);
    expect(f.exportCap).toBeCloseTo(1.3, 5);
  });

  it('irrigation : la production agricole augmente VRAIMENT', () => {
    const c = ctx.world.country('italie')!;
    const base = structuredClone(c);
    for (const k of Object.keys(base.infra) as InfraKey[]) base.infra[k] = { level: 0 };
    const withWater = structuredClone(base);
    withWater.infra.water = { level: 6 };
    const p0 = computeProduction(base, infraEffects(base), lawEffects(base), aggregateEventModifiers(base));
    const p1 = computeProduction(withWater, infraEffects(withWater), lawEffects(withWater), aggregateEventModifiers(withWater));
    expect(p1.food).toBeGreaterThan(p0.food * 1.1); // +3 %/niv × 6 = +18 %
  });

  it('place financière : intérêts de la dette réduits, recettes augmentées', () => {
    const c = ctx.world.country('grece')!;
    const base = structuredClone(c);
    base.economy.debt = 1000;
    base.economy.cash = 100;
    for (const k of Object.keys(base.infra) as InfraKey[]) base.infra[k] = { level: 0 };
    const withFinance = structuredClone(base);
    withFinance.infra.finance = { level: 6 };
    processEconomy(base, INPUTS);
    processEconomy(withFinance, INPUTS);
    expect(withFinance.economy.interestPaid).toBeLessThan(base.economy.interestPaid);
    expect(withFinance.economy.revenue).toBeGreaterThan(base.economy.revenue);
  });

  it('culture : dérive quotidienne de popularité et stabilité appliquée', () => {
    const c = ctx.world.country('bresil')!;
    const base = structuredClone(c);
    base.popularity = 50; base.stability = 60;
    for (const k of Object.keys(base.infra) as InfraKey[]) base.infra[k] = { level: 0 };
    const withCulture = structuredClone(base);
    withCulture.infra.culture = { level: 5 };
    const r0 = processPolitics(base, { unmet: ZERO_UNMET, energyStrain: 0 });
    const r1 = processPolitics(withCulture, { unmet: ZERO_UNMET, energyStrain: 0 });
    // +0,01/jour/niv × 5 = +0,05 de popularité ; +0,008 × 5 = +0,04 stabilité
    expect(r1.popularityDelta - r0.popularityDelta).toBeCloseTo(0.05, 2);
    expect(withCulture.stability - base.stability).toBeGreaterThan(0.02);
  });

  it('migration d’intégrité : un monde ancien sans les nouveaux réseaux est réparé', () => {
    const c = ctx.world.country('japon')!;
    delete (c.infra as Record<string, unknown>).airports;
    delete (c.infra as Record<string, unknown>).culture;
    const r1 = sanitizeCountry(c);
    expect(r1.fixed).toBeGreaterThanOrEqual(2);
    expect(c.infra.airports).toEqual({ level: 0 });
    expect(c.infra.culture).toEqual({ level: 0 });
    // Seconde passe : plus aucun problème d'infra
    const r2 = sanitizeCountry(c);
    expect(r2.issues.filter((i) => i.includes('infra'))).toEqual([]);
  });

  it('monde vivant : niveaux élevés sur les 18 réseaux, aucun NaN après ticks', async () => {
    const c = ctx.world.country('chine')!;
    for (const def of INFRA) c.infra[def.key] = { level: 8 };
    await ctx.engine.forceTicks(2);
    expect(ctx.engine.validateWorld()).toEqual([]);
    for (const k of RESOURCE_KEYS) {
      expect(Number.isFinite(c.resources[k].production)).toBe(true);
    }
    expect(Number.isFinite(c.economy.interestPaid)).toBe(true);
    expect(Number.isFinite(c.popularity)).toBe(true);
  }, 120_000);
});

describe('API : les 18 infras passent la validation serveur (régression v17.2)', () => {
  it('start_project & estimate acceptent un réseau v16 (aéroports)', async () => {
    const { ApiClient, createTestContext, registerAndLogin } = await import('./helpers.js');
    const ctx2 = await createTestContext();
    try {
      const client = new ApiClient(ctx2.baseUrl);
      await registerAndLogin(client, 'Batisseur');
      const claim = await client.post<{ ok: boolean }>('/api/countries/fed-coreenne/claim');
      expect(claim.status).toBe(200);
      const c = ctx2.world.country('fed-coreenne')!;
      c.economy.cash = 500;
      for (const key of ['airports', 'telecom', 'research', 'water', 'finance', 'culture'] as import('shared').InfraKey[]) {
        const est = await client.post<{ ok: boolean; error?: string }>(`/api/countries/fed-coreenne/actions/estimate`, {
          params: { type: 'start_project', infra: key },
        });
        expect(est.data.ok, `estimate ${key} refusé : ${est.data.error}`).toBe(true);
        const act = await client.post<{ ok: boolean; error?: string }>(`/api/countries/fed-coreenne/actions`, {
          params: { type: 'start_project', infra: key },
        });
        expect(act.data.ok, `start_project ${key} refusé : ${act.data.error}`).toBe(true);
        c.projects = []; // libère le slot pour le réseau suivant
        c.actionCooldowns = {};
      }
    } finally {
      await ctx2.close();
    }
  }, 120_000);
});

describe('Célébration « gain exceptionnel » (seuil 10 Md €, joueurs uniquement)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('offre vendue ≥ 10 Md : bigWin porté par le résultat ; petite offre : aucun', () => {
    const c = ctx.world.country('france')!;
    setPlayerController(ctx.world, 'france', 'user_bw', 'Rich');
    c.resources.industrial.stock = 2000;
    c.resources.materials.stock = 2000;
    const actor = { world: ctx.world, actor: { kind: 'player' as const, name: 'Rich', userId: 'user_bw' } };
    const buyer = { world: ctx.world, actor: { kind: 'ai' as const, name: 'IA Acheteuse' } };
    const buyerC = ctx.world.country('chine')!;
    buyerC.economy.cash = 5000;
    buyerC.resources.industrial.capacity = Math.max(buyerC.resources.industrial.capacity, 5000);
    buyerC.resources.materials.capacity = Math.max(buyerC.resources.materials.capacity, 5000);
    // Petite offre : pas de célébration
    const smallPub = executeAction(ctx.world, 'france', { type: 'create_offer', resource: 'materials', units: 10, unitPrice: 1 }, actor);
    expect(smallPub.ok).toBe(true);
    const smallOffer = ctx.world.openOffers().find((x) => x.sellerId === 'france' && x.resource === 'materials')!;
    const smallBuy = executeAction(ctx.world, 'chine', { type: 'buy_offer', offerId: smallOffer.id }, buyer);
    expect(smallBuy.ok).toBe(true);
    expect(smallBuy.bigWin).toBeUndefined();
    // Grosse offre (≥ 10 Md) : célébration demandée au vendeur joueur
    const bigPub = executeAction(ctx.world, 'france', { type: 'create_offer', resource: 'industrial', units: 400, unitPrice: 4.5 }, actor);
    expect(bigPub.ok).toBe(true);
    const bigOffer = ctx.world.openOffers().find((x) => x.sellerId === 'france' && x.resource === 'industrial')!;
    const bigBuy = executeAction(ctx.world, 'chine', { type: 'buy_offer', offerId: bigOffer.id }, buyer);
    expect(bigBuy.ok).toBe(true);
    expect(bigBuy.bigWin).toBeDefined();
    expect(bigBuy.bigWin!.countryId).toBe('france');
    expect(bigBuy.bigWin!.amount).toBeGreaterThanOrEqual(10);
  });

  it('offre du joueur achetée par une IA : bigWin dirigé vers le VENDEUR joueur', () => {
    const c = ctx.world.country('france')!;
    const ai = ctx.world.country('allemagne')!;
    c.resources.tech.stock = 500;
    ai.economy.cash = 5000;
    ai.resources.tech.stock = 0;
    ai.resources.tech.capacity = Math.max(ai.resources.tech.capacity, 2000);
    ai.resources.tech.consumption = 5;
    ai.resources.tech.production = 1;
    // Une offre immobilise au max 40 % du stock : 200 u sur 500
    const offer = executeAction(ctx.world, 'france', { type: 'create_offer', resource: 'tech', units: 200, unitPrice: 4.5 }, { world: ctx.world, actor: { kind: 'player', name: 'Rich', userId: 'user_bw' } });
    expect(offer.ok).toBe(true);
    const o = ctx.world.openOffers().find((x) => x.sellerId === 'france')!;
    const buy = executeAction(ctx.world, 'allemagne', { type: 'buy_offer', offerId: o.id }, { world: ctx.world, actor: { kind: 'ai', name: 'IA' } });
    expect(buy.ok).toBe(true);
    expect(buy.bigWin).toBeDefined();
    expect(buy.bigWin!.countryId).toBe('france'); // le vendeur joueur, pas l'acheteur
    expect(buy.bigWin!.amount).toBeGreaterThanOrEqual(10);
  });
});
