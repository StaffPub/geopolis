/**
 * Tests des bâtiments de production (onglet Production) :
 * achat → file de construction → livraison → production réelle accrue,
 * entretien quotidien, plafonds, validation, IA qui bâtit et vend ses
 * surplus en offres inter-états, persistance, API HTTP.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FACILITY_MAP, RESOURCE_KEYS } from 'shared';
import type { AiDecisionLog } from 'shared';
import { executeAction } from '../src/actions/registry.js';
import { runProductionPhase, deliverFacilities, facilitiesDailyUpkeep } from '../src/simulation/production.js';
import { runAiCountry } from '../src/simulation/ai.js';
import { makeRng, seedFrom } from '../src/util/core.js';
import { ApiClient, createTestContext, registerAndLogin, setPlayerController, type TestContext } from './helpers.js';
import type { ActionContext } from '../src/actions/registry.js';

describe('Bâtiments de production — mécanique', () => {
  let ctx: TestContext;
  let actor: ActionContext;

  beforeAll(async () => {
    ctx = await createTestContext();
    setPlayerController(ctx.world, 'france', 'user_fac_fr', 'Lucas');
    actor = { world: ctx.world, actor: { kind: 'player', name: 'Lucas', userId: 'user_fac_fr' } };
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('achat : trésorerie débitée, file de construction, jour de livraison', () => {
    const france = ctx.world.country('france')!;
    france.economy.cash = 500;
    france.actionCooldowns = {};
    const def = FACILITY_MAP.farm;
    const res = executeAction(ctx.world, 'france', { type: 'build_facility', facility: 'farm', count: 2 }, actor);
    expect(res.ok, res.error ?? '').toBe(true);
    expect(france.economy.cash).toBeCloseTo(500 - def.cost * 2, 1);
    const st = france.facilities.farm;
    expect(st.queue.length).toBe(1);
    expect(st.queue[0]!.count).toBe(2);
    expect(st.queue[0]!.readyDay).toBe(ctx.world.meta.day + def.buildDays);
    expect(st.owned).toBe(0); // pas encore livré
  });

  it('livraison après construction : owned augmente, journal tracé', () => {
    const france = ctx.world.country('france')!;
    const def = FACILITY_MAP.farm;
    // Avant l'échéance : rien
    const early = deliverFacilities(france, ctx.world.meta.day + def.buildDays - 1);
    expect(early.length).toBe(0);
    expect(france.facilities.farm.owned).toBe(0);
    // À l'échéance : livraison
    const done = deliverFacilities(france, ctx.world.meta.day + def.buildDays);
    expect(done.length).toBe(1);
    expect(france.facilities.farm.owned).toBe(2);
    expect(france.facilities.farm.queue.length).toBe(0);
  });

  it('production réelle accrue par les bâtiments livrés (échelle du pays incluse)', () => {
    const france = ctx.world.country('france')!;
    runProductionPhase(france);
    const withFarms = france.resources.food.production;
    const owned = france.facilities.farm.owned;
    expect(owned).toBe(2);
    // Retirer temporairement les fermes → production plus basse
    france.facilities.farm.owned = 0;
    runProductionPhase(france);
    const without = france.resources.food.production;
    france.facilities.farm.owned = owned;
    runProductionPhase(france);
    expect(withFarms).toBeGreaterThan(without);
    expect(withFarms - without).toBeGreaterThan(1); // ≈ 2 × 1,3 × échelle
  });

  it('entretien quotidien proportionnel aux bâtiments possédés', () => {
    const france = ctx.world.country('france')!;
    const upkeep = facilitiesDailyUpkeep(france);
    expect(upkeep).toBeCloseTo(FACILITY_MAP.farm.upkeepPerDay * france.facilities.farm.owned, 4);
    expect(upkeep).toBeGreaterThan(0);
  });

  it('validations : plafond, trésorerie, quantité, bâtiment inconnu', () => {
    const france = ctx.world.country('france')!;
    france.economy.cash = 100000;
    // Plafond (farm maxOwned 30, déjà 2 possédés)
    france.actionCooldowns = {};
    const tooMany = executeAction(ctx.world, 'france', { type: 'build_facility', facility: 'farm', count: 5 }, actor);
    expect(tooMany.ok).toBe(true); // 2+5=7 ≤ 30
    france.facilities.farm.owned = 29;
    france.facilities.farm.queue = [];
    france.actionCooldowns = {};
    const capped = executeAction(ctx.world, 'france', { type: 'build_facility', facility: 'farm', count: 2 }, actor);
    expect(capped.ok).toBe(false);
    expect(capped.error).toMatch(/plafond/i);
    // Quantité invalide
    france.actionCooldowns = {};
    const badCount = executeAction(ctx.world, 'france', { type: 'build_facility', facility: 'farm', count: 9 }, actor);
    expect(badCount.ok).toBe(false);
    // Trésorerie insuffisante
    france.economy.cash = 1;
    france.actionCooldowns = {};
    const poor = executeAction(ctx.world, 'france', { type: 'build_facility', facility: 'campus', count: 1 }, actor);
    expect(poor.ok).toBe(false);
    expect(poor.error).toMatch(/trésorerie/i);
    // Remise en état
    france.facilities.farm.owned = 2;
  });

  it('persistance : bâtiments et file survivent au rechargement', async () => {
    const { WorldStore } = await import('../src/world/world.js');
    const france = ctx.world.country('france')!;
    france.economy.cash = 500;
    france.actionCooldowns = {};
    const built = executeAction(ctx.world, 'france', { type: 'build_facility', facility: 'solar', count: 1 }, actor);
    expect(built.ok, built.error ?? '').toBe(true);
    await ctx.world.save();
    const reloaded = await WorldStore.load(ctx.storage);
    const fr2 = reloaded.country('france')!;
    expect(fr2.facilities.farm.owned).toBe(france.facilities.farm.owned);
    expect(fr2.facilities.solar.queue.length).toBe(1);
  }, 60_000);
});

describe('IA : construit des bâtiments et vend ses surplus', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('une IA à pénurie alimentaire construit une ferme (décision tracée)', () => {
    const italie = ctx.world.country('italie')!;
    italie.controller = { kind: 'ai', userId: null, presidentName: 'IA Test', since: Date.now(), sinceDay: 0 };
    italie.economy.cash = 800;
    italie.resources.food.capacity = 1000;
    italie.resources.food.stock = 150; // 15 % → food_short sévère
    italie.resources.food.consumption = 20;
    italie.resources.food.production = 10;
    // Scénario isolé : pays politiquement stable (sinon l'urgence de régime,
    // légitime en crise réelle, prendrait le slot d'action devant la ferme).
    italie.popularity = 62;
    italie.stability = 70;
    italie.economy.growth = 2;
    italie.ai.nextDecisionTick = 0;
    italie.ai.lastActionDay = -100;
    const decisions: Omit<AiDecisionLog, 'id' | 'ts'>[] = [];
    const ctxAi: ActionContext = { world: ctx.world, actor: { kind: 'ai', name: 'IA Test' } };
    runAiCountry(italie, ctx.world, { rng: makeRng(seedFrom('ia-farm')), ctx: ctxAi, decisions });
    const built = decisions.some((d) => d.action === 'build_facility')
      || (italie.facilities.farm.queue.length + italie.facilities.agriplex?.queue.length ?? 0) > 0;
    expect(italie.facilities.farm.queue.length + (italie.facilities.agriplex?.queue.reduce((s, q) => s + q.count, 0) ?? 0)).toBeGreaterThan(0);
    void built;
  });

  it('une IA en surplus publie une offre de vente (marché inter-états vivant)', () => {
    const bresil = ctx.world.country('bresil')!;
    bresil.controller = { kind: 'ai', userId: null, presidentName: 'IA Test', since: Date.now(), sinceDay: 0 };
    bresil.ai.nextDecisionTick = 0;
    bresil.ai.lastActionDay = -100;
    // Surplus confortable sur l'alimentation
    bresil.resources.food.capacity = 2000;
    bresil.resources.food.stock = 1600; // 80 %
    bresil.resources.food.production = 40;
    bresil.resources.food.consumption = 25;
    const offersBefore = ctx.world.openOffers().filter((o) => o.sellerId === 'bresil').length;
    const decisions: Omit<AiDecisionLog, 'id' | 'ts'>[] = [];
    const ctxAi: ActionContext = { world: ctx.world, actor: { kind: 'ai', name: 'IA Test' } };
    runAiCountry(bresil, ctx.world, { rng: () => 0.05, ctx: ctxAi, decisions });
    const offersAfter = ctx.world.openOffers().filter((o) => o.sellerId === 'bresil');
    expect(offersAfter.length).toBeGreaterThan(offersBefore);
    expect(decisions.some((d) => d.action === 'create_offer')).toBe(true);
    const offer = offersAfter[0]!;
    expect(offer.units).toBeGreaterThan(0);
    expect(offer.unitPrice).toBeGreaterThan(0);
    // Le stock n'est PAS prélevé à la publication (seulement à la vente)
    expect(bresil.resources.food.stock).toBe(1600);
  });

  it('sur 60 ticks, des IA du monde bâtissent réellement', async () => {
    let totalBuilt = 0;
    for (let i = 0; i < 60; i++) {
      await ctx.engine.forceTicks(1);
      totalBuilt = ctx.world.allCountries().reduce(
        (s, c) => s + Object.values(c.facilities ?? {}).reduce((x, f) => x + f.owned + f.queue.reduce((y, q) => y + q.count, 0), 0),
        0,
      );
      if (totalBuilt >= 3) break;
    }
    expect(totalBuilt, 'aucune IA n’a construit de bâtiment en 60 jours').toBeGreaterThan(0);
    // Cohérence : aucun pays ne dépasse un plafond
    for (const c of ctx.world.allCountries()) {
      for (const key of Object.keys(c.facilities ?? {}) as (keyof typeof c.facilities)[]) {
        const def = FACILITY_MAP[key];
        const st = c.facilities[key];
        expect(st.owned).toBeLessThanOrEqual(def.maxOwned);
        for (const v of [st.owned, ...st.queue.map((q) => q.count), ...st.queue.map((q) => q.readyDay)]) {
          expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
    // Aucune ressource ne part en NaN avec les bâtiments
    for (const c of ctx.world.allCountries()) {
      for (const k of RESOURCE_KEYS) {
        expect(Number.isFinite(c.resources[k].production)).toBe(true);
        expect(c.resources[k].stock).toBeGreaterThanOrEqual(0);
      }
    }
  }, 180_000);
});

describe('Bâtiments — API HTTP', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('POST build_facility via l\'API : débit, file, cohérence', async () => {
    const client = new ApiClient(ctx.baseUrl);
    await registerAndLogin(client, 'Batisseur', 'bat@test.dev', 'MotDePasse123!');
    const claim = await client.post<{ ok: boolean }>('/api/countries/allemagne/claim');
    expect(claim.status).toBe(200);
    const before = ctx.world.country('allemagne')!;
    const cash0 = before.economy.cash;
    const res = await client.post<{ ok: boolean; message?: string; error?: string }>('/api/countries/allemagne/actions', {
      params: { type: 'build_facility', facility: 'solar', count: 1 },
    });
    expect(res.status).toBe(200);
    expect(res.data.ok, res.data.error).toBe(true);
    const after = ctx.world.country('allemagne')!;
    expect(after.economy.cash).toBeCloseTo(cash0 - FACILITY_MAP.solar.cost, 1);
    expect(after.facilities.solar.queue.length).toBe(1);
    // Payload invalide rejeté par zod (400)
    const bad = await client.post('/api/countries/allemagne/actions', {
      params: { type: 'build_facility', facility: 'pyramide', count: 1 },
    });
    expect(bad.status).toBe(400);
    expect((bad.data as { ok: boolean; error?: string }).ok).toBe(false);
  });
});

describe('Dynamique longue : la nourriture ne s\'effondre plus', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('le plancher de capacité sectorielle répare les mondes effondrés', async () => {
    const { sanitizeCountry } = await import('../src/world/integrity.js');
    const c = ctx.world.country('italie')!;
    c.sectors.agriculture.capacity = 40; // monde ancien effondré
    const r = sanitizeCountry(c);
    expect(c.sectors.agriculture.capacity).toBe(55);
    expect(r.fixed).toBeGreaterThan(0);
  });

  it('sur 400 jours : capacités agricoles ≥ plancher et stocks alimentaires viables', async () => {
    for (let i = 0; i < 400; i++) await ctx.engine.forceTicks(1);
    let foodRatioSum = 0;
    let n = 0;
    for (const c of ctx.world.allCountries()) {
      expect(c.sectors.agriculture.capacity, `${c.id} agriculture effondrée`).toBeGreaterThanOrEqual(55);
      const r = c.resources.food;
      expect(Number.isFinite(r.production)).toBe(true);
      expect(r.production, `${c.id} ne produit plus de nourriture`).toBeGreaterThan(0);
      foodRatioSum += r.capacity > 0 ? r.stock / r.capacity : 0;
      n++;
    }
    const avg = foodRatioSum / n;
    expect(avg, `ratio alimentaire moyen trop bas : ${avg.toFixed(2)}`).toBeGreaterThan(0.22);
    const built = ctx.world.allCountries().reduce(
      (s, c) => s + Object.values(c.facilities ?? {}).reduce((x, f) => x + f.owned, 0), 0);
    expect(built, 'aucun bâtiment construit en 400 jours').toBeGreaterThan(0);
  }, 600_000);
});
