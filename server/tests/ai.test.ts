/**
 * Tests IA : les dirigeants IA analysent réellement leur pays, prennent des
 * décisions traçables, répondent aux propositions diplomatiques et adaptent
 * leur stratégie. Aucun simple bruit aléatoire.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { analyzeCountry, runAiCountry } from '../src/simulation/ai.js';
import { round } from '../src/util/core.js';
import { executeAction } from '../src/actions/registry.js';
import { createTestContext, setPlayerController, type TestContext } from './helpers.js';

describe('IA des pays', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('analyse : les problèmes détectés correspondent à l’état réel du pays', () => {
    const c = ctx.world.country('italie')!;
    // Italie seedée avec dette ~88 % → problème 'debt' attendu
    c.economy.debt = c.economy.gdp * 0.95;
    c.economy.balance = -c.economy.gdp * 0.05;
    const problems = analyzeCountry(c, ctx.world);
    const keys = problems.map((p) => p.key);
    expect(keys).toContain('debt');
    expect(keys).toContain('deficit');
    for (const p of problems) {
      expect(p.severity).toBeGreaterThan(0);
      expect(p.severity).toBeLessThanOrEqual(1);
      expect(p.description.length).toBeGreaterThan(3);
    }
  });

  it('cycles IA : des décisions sont prises et journalisées sur 40 ticks', async () => {
    const decisionsBefore = (await ctx.world.repos.listAiDecisions()).length;
    for (let i = 0; i < 40; i++) {
      await ctx.engine.forceTicks(1);
    }
    const decisions = await ctx.world.repos.listAiDecisions();
    expect(decisions.length).toBeGreaterThan(decisionsBefore);
    // Chaque décision référence un pays réel et une action connue
    for (const d of decisions.slice(-30)) {
      expect(ctx.world.country(d.countryId)).toBeDefined();
      expect(d.rationale.length).toBeGreaterThan(3);
      expect(d.action.length).toBeGreaterThan(2);
    }
  }, 60_000);

  it('l’IA répond aux propositions diplomatiques des joueurs', async () => {
    const c = ctx.world.country('japon')!;
    setPlayerController(ctx.world, 'france', 'user_fr', 'Lucas');
    // Relations fortes pour favoriser l'acceptation
    const rel = ctx.world.country('france')!.relations['japon']!;
    rel.score = 85;
    rel.trust = 85;
    c.relations['france']!.score = 85;
    c.relations['france']!.trust = 85;
    // Isoler l'état : les ticks précédents ont pu laisser des propositions
    // ou accords entre ces deux pays (le catalogue de tests tourne en monde complet).
    rel.agreements = [];
    c.relations['france']!.agreements = [];

    const res = executeAction(ctx.world, 'france', { type: 'propose_agreement', targetId: 'japon', agreementType: 'free_trade' }, { world: ctx.world, actor: { kind: 'player', name: 'Lucas', userId: 'user_fr' } });
    expect(res.ok).toBe(true);
    const agId = rel.agreements.find((a) => a.status === 'proposed')!.id;

    let answered = false;
    for (let i = 0; i < 30 && !answered; i++) {
      await ctx.engine.forceTicks(1);
      const ag = rel.agreements.find((a) => a.id === agId);
      answered = ag?.status === 'active' || ag?.status === 'rejected';
    }
    expect(answered, 'l’IA n’a jamais répondu à la proposition').toBe(true);
    const decisions = await ctx.world.repos.listAiDecisions();
    expect(decisions.some((d) => d.countryId === 'japon' && d.action === 'respond_proposal')).toBe(true);
  }, 90_000);

  it('pas de frénésie : cool-down respecté (peu d’actions par pays et par jour)', async () => {
    const c = ctx.world.country('allemagne')!;
    // On compte les actions PROPRES du pays (les événements, messages système
    // et actions des AUTRES pays le concernant ne sont pas des actions de l'IA)
    const own = () => c.history.filter((h) => h.actor === c.controller.presidentName).length;
    const actionsBefore = own();
    for (let i = 0; i < 10; i++) await ctx.engine.forceTicks(1);
    const actionsAfter = own();
    // Au plus quelques décisions par pays sur 10 jours de jeu
    // (1,4/jour en moyenne : initiatives + réponses diplomatiques incluses)
    expect(actionsAfter - actionsBefore).toBeLessThan(14);
  }, 60_000);

  it('stratégies distinctes : personnalités conformes au seed', () => {
    const de = ctx.world.country('allemagne')!;
    expect(de.ai.personality.strategy).toBe('industrielle');
    expect(de.ai.personality.debtTolerance).toBeLessThan(0.4);
    const br = ctx.world.country('bresil')!;
    expect(br.ai.personality.strategy).toBe('agricole');
    const jp = ctx.world.country('japon')!;
    expect(jp.ai.personality.strategy).toBe('innovation');
  });
});

describe('IA v1.19 : pénurie critique → achat d’une offre JOUEUR (scan hors cycle)', () => {
  it('l’IA achète sans attendre le cycle décisionnel quand ses stocks sont critiques', async () => {
    const ctxLocal = await createTestContext();
    try {
      setPlayerController(ctxLocal.world, 'france', 'user_vendeur', 'Vendeur');
      const france = ctxLocal.world.country('france')!;
      const japon = ctxLocal.world.country('japon')!;
      france.resources.food.stock = 800;
      // Japon en pénurie critique de nourriture
      japon.resources.food.capacity = 1000;
      japon.resources.food.stock = 120; // 12 %
      japon.resources.food.consumption = 30;
      japon.resources.food.production = 10;
      japon.economy.cash = 800;
      japon.ai.nextDecisionTick = 999999; // gate décisionnel FERMÉ : seul le scan critique agit
      // Le joueur publie une offre à 90 % du prix local japonais (sous le seuil critique 115 %)
      const unitPrice = Math.max(0.1, round(japon.resources.food.price * 0.9, 2));
      const pub = executeAction(ctxLocal.world, 'france', { type: 'create_offer', resource: 'food', units: 150, unitPrice }, { world: ctxLocal.world, actor: { kind: 'player', name: 'Vendeur', userId: 'user_vendeur' } });
      expect(pub.ok).toBe(true);
      const decisions: Omit<import('shared').AiDecisionLog, 'id' | 'ts'>[] = [];
      runAiCountry(japon, ctxLocal.world, {
        rng: () => 0.1,
        ctx: { world: ctxLocal.world, actor: { kind: 'ai', name: 'IA Japon' } },
        decisions,
      });
      expect(decisions.some((d) => d.action === 'buy_offer'), 'l’IA n’a pas acheté l’offre du joueur en pénurie critique').toBe(true);
      expect(ctxLocal.world.openOffers().filter((o) => o.sellerId === 'france')).toHaveLength(0);
      expect(japon.resources.food.stock).toBeGreaterThan(120);
    } finally {
      await ctxLocal.close();
    }
  }, 120_000);
});
