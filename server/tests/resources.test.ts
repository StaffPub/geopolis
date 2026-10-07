/**
 * Tests de l'onglet Ressources : consignes de production (boost/ralenti),
 * achats bilatéraux entre nations, offres de vente inter-états (cycle de vie
 * complet + achat automatique par les IA), trésorerie créditée automatiquement.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { executeAction } from '../src/actions/registry.js';
import { runProductionPhase, directiveDailyCost } from '../src/simulation/production.js';
import { createTestContext, setPlayerController, type TestContext } from './helpers.js';
import type { ActionContext } from '../src/actions/registry.js';

const VALUE_SCALE = 0.000045;
const valueOf = (units: number, price: number) => Math.round(units * price * VALUE_SCALE * 1000 * 100) / 100;

describe('Consignes de production', () => {
  let ctx: TestContext;
  let actor: ActionContext;

  beforeAll(async () => {
    ctx = await createTestContext();
    setPlayerController(ctx.world, 'france', 'user_res_fr', 'Lucas');
    actor = { world: ctx.world, actor: { kind: 'player', name: 'Lucas', userId: 'user_res_fr' } };
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('boost : +15 % de production réelle, ralenti : −12 %', () => {
    const france = ctx.world.country('france')!;
    france.economy.cash = 500;
    const act = (mode: 'boost' | 'normal' | 'slow') => {
      france.actionCooldowns = {};
      return executeAction(ctx.world, 'france', { type: 'set_production', resource: 'food', mode }, actor);
    };
    // Rythme normal
    const normal = act('normal');
    expect(normal.ok).toBe(true);
    runProductionPhase(france);
    const prodNormal = france.resources.food.production;
    // Boost
    const boost = act('boost');
    expect(boost.ok).toBe(true);
    expect(france.productionDirectives.food).toBe('boost');
    runProductionPhase(france);
    const prodBoost = france.resources.food.production;
    expect(prodBoost).toBeCloseTo(prodNormal * 1.15, 0);
    expect(prodBoost).toBeGreaterThan(prodNormal);
    // Ralenti
    const slow = act('slow');
    expect(slow.ok).toBe(true);
    runProductionPhase(france);
    const prodSlow = france.resources.food.production;
    expect(prodSlow).toBeCloseTo(prodNormal * 0.88, 0);
    expect(prodSlow).toBeLessThan(prodNormal);
    // Coût net quotidien (défini, borné)
    const cost = directiveDailyCost(france);
    expect(Number.isFinite(cost)).toBe(true);
    expect(cost).toBeLessThan(0); // ralenti = économie
    act('normal');
    expect(directiveDailyCost(france)).toBe(0);
  });

  it('maximum 3 boosts simultanés, mode invalide refusé', () => {
    const france = ctx.world.country('france')!;
    france.economy.cash = 5000;
    france.actionCooldowns = {};
    for (const r of ['energy', 'oil', 'gas'] as const) {
      const res = executeAction(ctx.world, 'france', { type: 'set_production', resource: r, mode: 'boost' }, actor);
      expect(res.ok, `boost ${r} refusé`).toBe(true);
    }
    const fourth = executeAction(ctx.world, 'france', { type: 'set_production', resource: 'minerals', mode: 'boost' }, actor);
    expect(fourth.ok).toBe(false);
    expect(fourth.error).toMatch(/3/i);
    // Nettoyage
    for (const r of ['energy', 'oil', 'gas'] as const) {
      france.actionCooldowns = {};
      executeAction(ctx.world, 'france', { type: 'set_production', resource: r, mode: 'normal' }, actor);
    }
  });

  it('le coût des consignes passe bien par la trésorerie (flux quotidien)', async () => {
    const france = ctx.world.country('france')!;
    france.actionCooldowns = {};
    executeAction(ctx.world, 'france', { type: 'set_production', resource: 'food', mode: 'boost' }, actor);
    const cost = directiveDailyCost(france);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeCloseTo(france.economy.gdp * 0.00012, 3);
    france.actionCooldowns = {};
    executeAction(ctx.world, 'france', { type: 'set_production', resource: 'food', mode: 'normal' }, actor);
    expect(directiveDailyCost(france)).toBe(0);
  });

  it('synchro immédiate : poser un boost met à jour la production affichée SANS attendre le tick', () => {
    const france = ctx.world.country('france')!;
    france.economy.cash = 500;
    france.actionCooldowns = {};
    executeAction(ctx.world, 'france', { type: 'set_production', resource: 'food', mode: 'normal' }, actor);
    runProductionPhase(france); // état de référence stocké
    const prodAvant = france.resources.food.production;
    france.actionCooldowns = {};
    const res = executeAction(ctx.world, 'france', { type: 'set_production', resource: 'food', mode: 'boost' }, actor);
    expect(res.ok).toBe(true);
    // La valeur affichée (r.production) a changé IMMÉDIATEMENT, sans tick
    expect(france.resources.food.production).toBeGreaterThan(prodAvant);
    expect(france.resources.food.production).toBeCloseTo(prodAvant * 1.15, 0);
    france.actionCooldowns = {};
    executeAction(ctx.world, 'france', { type: 'set_production', resource: 'food', mode: 'normal' }, actor);
  });
});

describe('Achat bilatéral à un pays', () => {
  let ctx: TestContext;
  let actor: ActionContext;

  beforeAll(async () => {
    ctx = await createTestContext();
    setPlayerController(ctx.world, 'france', 'user_bi_fr', 'Lucas');
    actor = { world: ctx.world, actor: { kind: 'player', name: 'Lucas', userId: 'user_bi_fr' } };
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('achat réussi : stocks transférés, TRÉSORERIE du vendeur créditée, relations améliorées', () => {
    const france = ctx.world.country('france')!;
    const russie = ctx.world.country('russie')!;
    france.economy.cash = 500;
    russie.resources.energy.capacity = 2000;
    russie.resources.energy.stock = 1600; // 80 % → disponible au-delà de 35 %
    france.resources.energy.capacity = 2000;
    france.resources.energy.stock = 100;
    france.relations['russie']!.score = 60;
    russie.relations['france']!.score = 60;

    const units = 50;
    const expectedCost = valueOf(units, russie.resources.energy.price * 1.06);
    const cashFr = france.economy.cash;
    const cashRu = russie.economy.cash;
    const stockRu = russie.resources.energy.stock;

    const res = executeAction(ctx.world, 'france', { type: 'buy_from_country', sellerId: 'russie', resource: 'energy', units }, actor);
    expect(res.ok, res.error ?? '').toBe(true);
    expect(france.resources.energy.stock).toBeCloseTo(100 + units, 0);
    expect(russie.resources.energy.stock).toBeCloseTo(stockRu - units, 0);
    // Trésorerie : débit acheteur, CRÉDIT AUTOMATIQUE vendeur
    expect(cashFr - france.economy.cash).toBeCloseTo(expectedCost, 1);
    expect(russie.economy.cash - cashRu).toBeCloseTo(expectedCost, 1);
    expect(france.relations['russie']!.score).toBeGreaterThan(60);
    expect(ctx.world.transactions.some((t) => t.note?.includes('Achat bilatéral'))).toBe(true);
  });

  it('refus : vendeur joueur, relations basses, marge de sécurité, entrepôts pleins', () => {
    const france = ctx.world.country('france')!;
    // Vendeur joueur
    setPlayerController(ctx.world, 'allemagne', 'user_bi_de', 'Hans');
    const joueur = executeAction(ctx.world, 'france', { type: 'buy_from_country', sellerId: 'allemagne', resource: 'industrial', units: 10 }, actor);
    expect(joueur.ok).toBe(false);
    expect(joueur.error).toMatch(/joueur/i);
    // Relations insuffisantes
    const coree = ctx.world.country('fed-coreenne')!;
    coree.resources.industrial.stock = coree.resources.industrial.capacity * 0.9;
    france.relations['fed-coreenne']!.score = 10;
    coree.relations['france']!.score = 10;
    france.relations['fed-coreenne']!.agreements = [];
    const lowRel = executeAction(ctx.world, 'france', { type: 'buy_from_country', sellerId: 'fed-coreenne', resource: 'industrial', units: 10 }, actor);
    expect(lowRel.ok).toBe(false);
    expect(lowRel.error).toMatch(/relations/i);
    // Marge de sécurité : la Chine ne peut pas vendre au-delà de sa réserve
    const chine = ctx.world.country('chine')!;
    chine.resources.food.capacity = 1000;
    chine.resources.food.stock = 360; // dispo = min(360-350, 144) = 10
    france.relations['chine']!.score = 70;
    chine.relations['france']!.score = 70;
    const tooMuch = executeAction(ctx.world, 'france', { type: 'buy_from_country', sellerId: 'chine', resource: 'food', units: 200 }, actor);
    expect(tooMuch.ok).toBe(false);
    expect(tooMuch.error).toMatch(/vendre plus|marge/i);
    // Entrepôts pleins
    france.resources.food.capacity = 100;
    france.resources.food.stock = 99;
    chine.resources.food.stock = 900;
    const full = executeAction(ctx.world, 'france', { type: 'buy_from_country', sellerId: 'chine', resource: 'food', units: 5 }, actor);
    expect(full.ok).toBe(false);
    expect(full.error).toMatch(/entrepôts/i);
  });
});

describe('Offres de vente inter-états', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
    setPlayerController(ctx.world, 'france', 'user_off_fr', 'Lucas');
  });

  afterAll(async () => {
    await ctx.close();
  });

  const frActor = (): ActionContext => ({ world: ctx.world, actor: { kind: 'player', name: 'Lucas', userId: 'user_off_fr' } });

  it('publication, limites (4 offres, 40 % du stock, plage de prix) et retrait', () => {
    const france = ctx.world.country('france')!;
    france.resources.industrial.stock = 500;
    france.resources.industrial.capacity = 1000;
    france.actionCooldowns = {};
    const o1 = executeAction(ctx.world, 'france', { type: 'create_offer', resource: 'industrial', units: 100, unitPrice: 2.2 }, frActor());
    expect(o1.ok, o1.error ?? '').toBe(true);
    expect(ctx.world.openOffers().length).toBe(1);
    const offer = ctx.world.openOffers()[0]!;
    expect(offer.expiresDay).toBe(ctx.world.meta.day + 14);
    // Trop d'unités (> 40 % du stock)
    const big = executeAction(ctx.world, 'france', { type: 'create_offer', resource: 'industrial', units: 400, unitPrice: 2.2 }, frActor());
    expect(big.ok).toBe(false);
    expect(big.error).toMatch(/40 %|Réserve/i);
    // Prix hors marché
    const cheap = executeAction(ctx.world, 'france', { type: 'create_offer', resource: 'industrial', units: 10, unitPrice: 0.1 }, frActor());
    expect(cheap.ok).toBe(false);
    expect(cheap.error).toMatch(/hors marché/i);
    // Max 4 offres
    for (let i = 0; i < 3; i++) {
      france.actionCooldowns = {};
      const r = executeAction(ctx.world, 'france', { type: 'create_offer', resource: 'materials', units: 5, unitPrice: 1 }, frActor());
      expect(r.ok, r.error ?? '').toBe(true);
    }
    france.actionCooldowns = {};
    const fifth = executeAction(ctx.world, 'france', { type: 'create_offer', resource: 'materials', units: 5, unitPrice: 1 }, frActor());
    expect(fifth.ok).toBe(false);
    expect(fifth.error).toMatch(/4 offres/i);
    // Retrait
    const cancel = executeAction(ctx.world, 'france', { type: 'cancel_offer', offerId: offer.id }, frActor());
    expect(cancel.ok).toBe(true);
    expect(ctx.world.offer(offer.id)).toBeUndefined();
    // Un autre pays ne peut pas annuler mon offre
    const stolen = executeAction(ctx.world, 'japon', { type: 'cancel_offer', offerId: ctx.world.openOffers()[0]!.id }, { world: ctx.world, actor: { kind: 'ai', name: 'IA' } });
    expect(stolen.ok).toBe(false);
  });

  it('achat d\'une offre : vendeur payé AUTOMATIQUESMENT, stocks transférés', () => {
    const france = ctx.world.country('france')!;
    const japon = ctx.world.country('japon')!;
    const offer = ctx.world.openOffers().find((o) => o.sellerId === 'france' && o.resource === 'materials')!;
    expect(offer).toBeDefined();
    japan_setup: {
      japon.resources.materials.capacity = 3000;
      japon.resources.materials.stock = 10;
      japon.economy.cash = 400;
      japon.relations['france']!.score = 70;
      france.relations['japon']!.score = 70;
    }
    const expected = valueOf(offer.units, offer.unitPrice);
    const cashFr = france.economy.cash;
    const cashJp = japon.economy.cash;
    const res = executeAction(ctx.world, 'japon', { type: 'buy_offer', offerId: offer.id }, { world: ctx.world, actor: { kind: 'ai', name: 'IA Japon' } });
    expect(res.ok, res.error ?? '').toBe(true);
    // Vendeur (joueur) crédité automatiquement
    expect(france.economy.cash - cashFr).toBeCloseTo(expected, 1);
    expect(cashJp - japon.economy.cash).toBeCloseTo(expected, 1);
    expect(japon.resources.materials.stock).toBeCloseTo(10 + offer.units, 0);
    expect(ctx.world.offer(offer.id)).toBeUndefined(); // offre close
    expect(ctx.world.transactions.some((t) => t.note?.includes("Offre d'achat"))).toBe(true);
    // Impossible d'acheter sa propre offre
    const fr2 = executeAction(ctx.world, 'france', { type: 'create_offer', resource: 'gas', units: 5, unitPrice: 1.3 }, frActor());
    expect(fr2.ok).toBe(true);
    const selfBuy = executeAction(ctx.world, 'france', { type: 'buy_offer', offerId: ctx.world.openOffers().find((o) => o.sellerId === 'france')!.id }, frActor());
    expect(selfBuy.ok).toBe(false);
    expect(selfBuy.error).toMatch(/propre offre/i);
  });

  it('expiration automatique des offres', () => {
    const before = ctx.world.openOffers().length;
    expect(before).toBeGreaterThan(0);
    ctx.world.meta.day += 30;
    const expired = ctx.world.expireOffers(ctx.world.meta.day);
    expect(expired).toBeGreaterThanOrEqual(before);
    expect(ctx.world.openOffers().length).toBe(0);
  });

  it('les IA achètent les offres bien placées (marché vivant) — vendeur joueur crédité', async () => {
    const france = ctx.world.country('france')!;
    // France : producteur d'énergie isolé du commerce auto pour un test net
    france.resources.energy.capacity = 3000;
    france.resources.energy.stock = 1200;
    france.resources.energy.production = france.resources.energy.consumption;
    france.actionCooldowns = {};
    const japon = ctx.world.country('japon')!;
    japon.resources.energy.capacity = 3000;
    japon.resources.energy.stock = 300;             // 10 % → besoin fort
    japon.resources.energy.consumption = japon.resources.energy.production + 5;
    japon.resources.energy.price = 2.6;             // prix local ÉLEVÉ → l'offre à 1,6 est une aubaine
    japon.economy.cash = 900;
    japon.relations['france']!.score = 75;
    france.relations['japon']!.score = 75;
    japon.relations['france']!.agreements = [];

    const offerRes = executeAction(ctx.world, 'france', { type: 'create_offer', resource: 'energy', units: 100, unitPrice: 1.6 }, frActor());
    expect(offerRes.ok, offerRes.error ?? '').toBe(true);
    const offerId = ctx.world.openOffers().find((o) => o.sellerId === 'france' && o.resource === 'energy')!.id;

    let sold = false;
    for (let i = 0; i < 50 && !sold; i++) {
      await ctx.engine.forceTicks(1);
      sold = ctx.world.offer(offerId) === undefined;
    }
    expect(sold, "aucune IA n'a acheté l'offre en 50 jours").toBe(true);
    // Journal : la vente est tracée
    expect(ctx.world.journal.some((j) => j.text.includes('achète le lot'))).toBe(true);
    const buyer = ctx.world.transactions.find((t) => t.note?.includes("Offre d'achat à France"));
    expect(buyer).toBeDefined();
  }, 180_000);
});

describe('API Ressources', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
    setPlayerController(ctx.world, 'france', 'user_api_fr', 'Lucas');
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('GET /api/world/offers et /api/world/resource-sellers sont publics et exacts', async () => {
    const offers = await fetch(`${ctx.baseUrl}/api/world/offers`).then((r) => r.json()) as { offers: unknown[]; revision: number };
    expect(Array.isArray(offers.offers)).toBe(true);

    const france = ctx.world.country('france')!;
    const russie = ctx.world.country('russie')!;
    russie.resources.energy.stock = russie.resources.energy.capacity * 0.9;
    france.relations['russie']!.score = 65;
    const sel = await fetch(`${ctx.baseUrl}/api/world/resource-sellers?resource=energy&me=france`).then((r) => r.json()) as {
      sellers: { id: string; available: number; eligible: boolean; price: number }[]; worldPrice: number;
    };
    expect(sel.worldPrice).toBeGreaterThan(0);
    expect(sel.sellers.some((s) => s.id === 'france'), 'le pays lui-même ne doit pas être vendeur').toBe(false);
    const ru = sel.sellers.find((s) => s.id === 'russie');
    expect(ru).toBeDefined();
    expect(ru!.available).toBeGreaterThan(0);
    expect(ru!.eligible).toBe(true);
    // Ressource inconnue → 400
    const bad = await fetch(`${ctx.baseUrl}/api/world/resource-sellers?resource=xyz`);
    expect(bad.status).toBe(400);
  });
});
