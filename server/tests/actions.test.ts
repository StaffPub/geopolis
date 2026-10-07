/**
 * Tests des actions métier : validation serveur, conséquences réelles,
 * cooldowns, double-présidence, estimation avant application.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { executeAction, estimateAction, infraCost } from '../src/actions/registry.js';
import { createTestContext, setPlayerController, type TestContext } from './helpers.js';
import type { ActionContext } from '../src/actions/registry.js';

describe('Actions joueur — conséquences réelles', () => {
  let ctx: TestContext;
  let france: string;
  let actorCtx: ActionContext;

  beforeAll(async () => {
    ctx = await createTestContext();
    france = 'france';
    setPlayerController(ctx.world, france, 'user_test', 'Lucas');
    actorCtx = { world: ctx.world, actor: { kind: 'player', name: 'Lucas', userId: 'user_test' } };
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('set_tax : +recettes, −popularité, −consommation (conséquences serveur)', () => {
    const c = ctx.world.country(france)!;
    const before = { revenue: c.economy.revenue, pop: c.popularity, cons: c.economy.consumptionIndex, tax: c.policy.taxRate };
    const est = estimateAction(ctx.world, france, { type: 'set_tax', value: before.tax + 6 });
    expect(est.ok).toBe(true);
    expect(est.effects!.length).toBeGreaterThanOrEqual(3);

    const res = executeAction(ctx.world, france, { type: 'set_tax', value: before.tax + 6 }, actorCtx);
    expect(res.ok).toBe(true);
    expect(c.policy.taxRate).toBeCloseTo(before.tax + 6, 1);
    expect(c.economy.revenue).toBeGreaterThan(before.revenue);
    expect(c.popularity).toBeLessThan(before.pop);
    expect(c.economy.consumptionIndex).toBeLessThan(before.cons);
    // Journalisé
    expect(c.history.some((h) => h.text.includes('fiscalité'))).toBe(true);
  });

  it('set_tax : cooldown appliqué (double action protégée)', () => {
    const res = executeAction(ctx.world, france, { type: 'set_tax', value: 25 }, actorCtx);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/cooldown/i);
  });

  it('valeurs invalides rejetées par le serveur', () => {
    const res = executeAction(ctx.world, france, { type: 'set_tax', value: 999 }, actorCtx);
    expect(res.ok).toBe(false);
    const res2 = executeAction(ctx.world, france, { type: 'start_project', infra: 'inconnu' as never }, actorCtx);
    expect(res2.ok).toBe(false);
  });

  it('start_project : trésorerie débitée, chantier progressif, niveau livré', async () => {
    const c = ctx.world.country(france)!;
    c.economy.cash = 500; // trésorerie suffisante pour le test
    ctx.world.markDirty(france);
    const levelBefore = c.infra.rail.level;
    const cost = infraCost(c, 'rail');
    const res = executeAction(ctx.world, france, { type: 'start_project', infra: 'rail' }, actorCtx);
    expect(res.ok).toBe(true);
    expect(c.economy.cash).toBeCloseTo(500 - cost * 0.15, 1);
    expect(c.projects.length).toBe(1);

    // Le chantier avance avec les ticks du moteur
    const buildDays = c.projects[0]!.buildDays;
    for (let i = 0; i < buildDays + 2; i++) {
      await ctx.engine.forceTicks(1);
    }
    expect(c.projects.length).toBe(0);
    expect(c.infra.rail.level).toBe(levelBefore + 1);
    expect(c.history.some((h) => h.text.includes('achève'))).toBe(true);
  }, 60_000);

  it('trésorerie insuffisante → action refusée', () => {
    const c = ctx.world.country('bresil')!;
    setPlayerController(ctx.world, 'bresil', 'user_b', 'Maria');
    c.economy.cash = 0;
    const res = executeAction(ctx.world, 'bresil', { type: 'start_project', infra: 'ports' }, { world: ctx.world, actor: { kind: 'player', name: 'Maria', userId: 'user_b' } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/trésorerie/i);
  });

  it('buy_resource : transfert réel de cash et de stock (vente mondiale retirée en v1.19)', () => {
    const c = ctx.world.country('france')!;
    c.economy.cash = 200;
    const stockBefore = c.resources.energy.stock;
    const buy = executeAction(ctx.world, 'france', { type: 'buy_resource', resource: 'energy', units: 100 }, actorCtx);
    expect(buy.ok).toBe(true);
    expect(c.resources.energy.stock).toBeCloseTo(stockBefore + 100, 0);
    expect(c.economy.cash).toBeLessThan(200);

    const cashAfterBuy = c.economy.cash;
    // v1.19 : la vente au marché mondial n'existe plus
    const gone = executeAction(ctx.world, 'france', { type: 'sell_resource', resource: 'energy', units: 50 }, actorCtx);
    expect(gone.ok).toBe(false);
    expect(c.economy.cash).toBe(cashAfterBuy);
    // Vendre = publier une offre qu'une autre nation achète
    c.resources.energy.stock = 500;
    const pub = executeAction(ctx.world, 'france', { type: 'create_offer', resource: 'energy', units: 100, unitPrice: 1.5 }, actorCtx);
    expect(pub.ok).toBe(true);
    const o = ctx.world.openOffers().find((x) => x.sellerId === 'france')!;
    const cashBeforeSell = c.economy.cash;
    const buyOfferRes = executeAction(ctx.world, 'allemagne', { type: 'buy_offer', offerId: o.id }, { world: ctx.world, actor: { kind: 'ai', name: 'IA' } });
    expect(buyOfferRes.ok).toBe(true);
    expect(c.economy.cash).toBeGreaterThan(cashBeforeSell);
  });

  it('diplomatie : proposition → réponse → accord actif, relations améliorées', () => {
    const franceC = ctx.world.country('france')!;
    const italie = ctx.world.country('italie')!;
    const scoreBefore = franceC.relations['italie']!.score;
    // Neutraliser les accords/propositions free_trade préexistants (l'IA a pu
    // proposer le même accord pendant les ticks précédents — comportement normal)
    franceC.relations['italie']!.agreements = franceC.relations['italie']!.agreements.filter((a) => a.type !== 'free_trade');
    italie.relations['france']!.agreements = italie.relations['france']!.agreements.filter((a) => a.type !== 'free_trade');
    franceC.actionCooldowns = {};

    const prop = executeAction(ctx.world, 'france', { type: 'propose_agreement', targetId: 'italie', agreementType: 'free_trade' }, actorCtx);
    expect(prop.ok).toBe(true);
    const agreement = franceC.relations['italie']!.agreements.find((a) => a.status === 'proposed');
    expect(agreement).toBeDefined();
    // Miroir présent chez le destinataire
    const mirror = italie.relations['france']!.agreements.find((a) => a.id === agreement!.id);
    expect(mirror).toBeDefined();
    expect(mirror!.status).toBe('proposed');

    // L'Italie (contrôlée IA ici) accepte via la même couche d'actions
    const resp = executeAction(ctx.world, 'italie', { type: 'respond_proposal', proposalId: agreement!.id, accept: true }, { world: ctx.world, actor: { kind: 'ai', name: italie.controller.presidentName } });
    expect(resp.ok).toBe(true);
    expect(franceC.relations['italie']!.agreements.find((a) => a.id === agreement!.id)!.status).toBe('active');
    expect(italie.relations['france']!.agreements.find((a) => a.id === agreement!.id)!.status).toBe('active');
    expect(franceC.relations['italie']!.score).toBeGreaterThan(scoreBefore);
    expect(italie.relations['france']!.score).toBeCloseTo(franceC.relations['italie']!.score, 1);
  });

  it('proposition impossible avec des relations trop basses', () => {
    const grece = ctx.world.country('grece')!;
    const turquie = ctx.world.country('turquie')!;
    // Forcer des relations très basses
    grece.relations['turquie']!.score = 10;
    turquie.relations['grece']!.score = 10;
    const res = executeAction(ctx.world, 'grece', { type: 'propose_agreement', targetId: 'turquie', agreementType: 'economic_treaty' }, { world: ctx.world, actor: { kind: 'player', name: 'Test', userId: 'u' } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/relations/i);
  });

  it('sanctions : blocage commercial réel puis levée', () => {
    const a = ctx.world.country('france')!;
    const b = ctx.world.country('bresil')!;
    const res = executeAction(ctx.world, 'france', { type: 'impose_sanction', targetId: 'bresil' }, actorCtx);
    expect(res.ok).toBe(true);
    expect(a.relations['bresil']!.sanctionByUs).toBe(true);
    expect(b.relations['france']!.sanctionByThem).toBe(true);
    const lift = executeAction(ctx.world, 'france', { type: 'lift_sanction', targetId: 'bresil' }, actorCtx);
    expect(lift.ok).toBe(true);
    expect(a.relations['bresil']!.sanctionByUs).toBe(false);
    expect(b.relations['france']!.sanctionByThem).toBe(false);
  });

  it('lois : promulgation avec coût réel, abrogation remboursée', () => {
    const c = ctx.world.country('france')!;
    const spendBefore = c.economy.spending;
    const res = executeAction(ctx.world, 'france', { type: 'enact_law', lawId: 'education_reform' }, actorCtx);
    expect(res.ok).toBe(true);
    expect(c.laws.some((l) => l.lawId === 'education_reform')).toBe(true);
    expect(c.economy.spending).toBeGreaterThan(spendBefore);

    const twice = executeAction(ctx.world, 'france', { type: 'enact_law', lawId: 'education_reform' }, actorCtx);
    expect(twice.ok).toBe(false);

    const repeal = executeAction(ctx.world, 'france', { type: 'repeal_law', lawId: 'education_reform' }, actorCtx);
    expect(repeal.ok).toBe(true);
    expect(c.laws.some((l) => l.lawId === 'education_reform')).toBe(false);
    expect(c.economy.spending).toBeLessThanOrEqual(spendBefore + 0.01);
  });

  it('set_spending : le solde budgétaire suit la décision', () => {
    const c = ctx.world.country('france')!;
    const spendBefore = c.economy.spending;
    const res = executeAction(ctx.world, 'france', { type: 'set_spending', sector: 'health', value: c.policy.spending.health + 1 }, actorCtx);
    expect(res.ok).toBe(true);
    expect(c.economy.spending).toBeGreaterThan(spendBefore);
    expect(c.economy.balance).toBeCloseTo(c.economy.revenue - c.economy.spending, 1);
  });
});
