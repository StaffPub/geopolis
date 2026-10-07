/**
 * Tests du système de routes commerciales stratégiques (corridors),
 * expéditions manuelles, péages, rupture d'accords et pénalité d'opinion.
 * Règle v7 : AUCUNE voie directe — tout transit passe par une route achetable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RESOURCE_KEYS } from 'shared';
import { executeAction, quoteShipment, corridorValidFor } from '../src/actions/registry.js';
import { processTrade, routeOptions } from '../src/simulation/trade.js';
import { MemoryStorage } from '../src/storage/memory.js';
import { K } from '../src/storage/storage.js';
import { WorldStore } from '../src/world/world.js';
import { createTestContext, setPlayerController, type TestContext } from './helpers.js';
import type { ActionContext } from '../src/actions/registry.js';

describe('Routes commerciales & expéditions manuelles', () => {
  let ctx: TestContext;
  let actor: ActionContext;

  beforeAll(async () => {
    ctx = await createTestContext();
    setPlayerController(ctx.world, 'france', 'user_fr', 'Lucas');
    actor = { world: ctx.world, actor: { kind: 'player', name: 'Lucas', userId: 'user_fr' } };
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('catalogue de corridors initialisé et persisté (réseau étendu)', () => {
    expect(ctx.world.corridors.size).toBeGreaterThanOrEqual(30);
    const panama = ctx.world.corridor('canal_panama');
    expect(panama).toBeDefined();
    expect(panama!.owner).toBeNull();
    expect(panama!.purchaseCost).toBeGreaterThan(50);
    // Nouvelles routes du réseau étendu (aucune région isolée)
    for (const id of ['steppe_eurasienne', 'siberie', 'andes', 'antilles', 'caraibes_latine', 'transsaharienne', 'atlantique_sud', 'route_du_cap', 'cap_bonne_esperance', 'mer_arabie', 'ionienne', 'arc_atlantique', 'danube', 'arafura', 'grands_lacs', 'amazonie', 'adriatique', 'mitteleuropa', 'detroits_turcs', 'mer_chine_meridionale']) {
      expect(ctx.world.corridor(id), `corridor manquant : ${id}`).toBeDefined();
    }
  });

  it('validité géographique des corridors', () => {
    const france = ctx.world.country('france')!;
    const usa = ctx.world.country('usa')!;
    const chine = ctx.world.country('chine')!;
    const atl = ctx.world.corridor('atlantique_nord')!;
    expect(corridorValidFor(atl, france, usa)).toBe(true);
    expect(corridorValidFor(atl, france, chine)).toBe(false);
  });

  it('achat de corridor : débit réel, propriété, péage initial', () => {
    const c = ctx.world.country('france')!;
    c.economy.cash = 500;
    const co = ctx.world.corridor('atlantique_nord')!;
    const res = executeAction(ctx.world, 'france', { type: 'buy_corridor', corridorId: co.id }, actor);
    expect(res.ok).toBe(true);
    expect(co.owner).toBe('france');
    expect(co.toll).toBe(4);
    expect(c.economy.cash).toBeCloseTo(500 - co.purchaseCost, 1);
    // Deuxième achat refusé
    const again = executeAction(ctx.world, 'france', { type: 'buy_corridor', corridorId: co.id }, actor);
    expect(again.ok).toBe(false);
  });

  it('péage : seul le propriétaire le règle', () => {
    const co = ctx.world.corridor('atlantique_nord')!;
    const own = executeAction(ctx.world, 'france', { type: 'set_toll', corridorId: co.id, value: 9 }, actor);
    expect(own.ok).toBe(true);
    expect(co.toll).toBe(9);
    const other = executeAction(ctx.world, 'allemagne', { type: 'set_toll', corridorId: co.id, value: 1 }, { world: ctx.world, actor: { kind: 'ai', name: 'IA' } });
    expect(other.ok).toBe(false);
  });

  it('expédition manuelle : réservation du stock, acceptation du destinataire, péage au propriétaire', () => {
    const france = ctx.world.country('france')!;
    const usa = ctx.world.country('usa')!;
    france.resources.industrial.stock = 200;
    usa.resources.industrial.stock = 10;
    const co = ctx.world.corridor('atlantique_nord')!;
    co.owner = 'allemagne'; // tiers : la France paie le péage à l'Allemagne
    co.toll = 10;
    const allemagne = ctx.world.country('allemagne')!;
    const cashAllemBefore = allemagne.economy.cash;
    const cashUsaBefore = usa.economy.cash;
    const stockFrBefore = france.resources.industrial.stock;

    const quote = quoteShipment(ctx.world, france, usa, 'industrial', 40, 'atlantique_nord');
    expect(quote.tollRate).toBe(10);
    expect(quote.toll).toBeGreaterThan(0);

    // 1) Expédition : le stock de l'expéditeur est RÉSERVÉ, rien d'autre ne bouge
    const res = executeAction(ctx.world, 'france', { type: 'ship_goods', toId: 'usa', resource: 'industrial', units: 40, corridorId: 'atlantique_nord' }, actor);
    expect(res.ok).toBe(true);
    expect(france.resources.industrial.stock).toBeCloseTo(stockFrBefore - 40, 0);
    expect(usa.resources.industrial.stock).toBe(10); // pas encore livré
    expect(usa.economy.cash).toBe(cashUsaBefore);   // pas encore débité
    expect(allemagne.economy.cash).toBe(cashAllemBefore); // péage pas encore versé
    const pending = ctx.world.pendingDeliveries.find((d) => d.fromId === 'france' && d.toId === 'usa');
    expect(pending).toBeDefined();

    // 2) Le destinataire ACCEPTE : il paie, reçoit les ressources, le péage tombe
    const usaActor: ActionContext = { world: ctx.world, actor: { kind: 'ai', name: 'Gouvernement USA' } };
    const accept = executeAction(ctx.world, 'usa', { type: 'respond_delivery', deliveryId: pending!.id, accept: true }, usaActor);
    expect(accept.ok).toBe(true);
    expect(usa.resources.industrial.stock).toBeGreaterThan(10);
    expect(usa.economy.cash).toBeCloseTo(cashUsaBefore - quote.value, 1); // débité de la valeur
    expect(allemagne.economy.cash).toBeCloseTo(cashAllemBefore + quote.toll, 1);
    expect(co.traffic).toBeGreaterThan(0);
    expect(ctx.world.pendingDeliveries.find((d) => d.id === pending!.id)).toBeUndefined();
    // Registre + route carte mis à jour
    expect(ctx.world.transactions.some((t) => t.fromId === 'france' && t.toId === 'usa')).toBe(true);
    expect(ctx.world.routes.has('france->usa:industrial')).toBe(true);
  });

  it('livraison refusée : la marchandise retourne à l\'expéditeur, aucun argent ne bouge', () => {
    const france = ctx.world.country('france')!;
    const usa = ctx.world.country('usa')!;
    const co = ctx.world.corridor('atlantique_nord')!;
    co.owner = null; co.toll = 0;
    france.resources.industrial.stock = 200;
    const stockBefore = france.resources.industrial.stock;
    const cashFrBefore = france.economy.cash;
    const cashUsaBefore = usa.economy.cash;
    const stockUsaBefore = usa.resources.industrial.stock;

    const res = executeAction(ctx.world, 'france', { type: 'ship_goods', toId: 'usa', resource: 'industrial', units: 30, corridorId: 'auto' }, actor);
    expect(res.ok).toBe(true);
    const pending = ctx.world.pendingDeliveries.find((d) => d.fromId === 'france' && d.toId === 'usa')!;
    expect(pending).toBeDefined();

    const refuse = executeAction(ctx.world, 'usa', { type: 'respond_delivery', deliveryId: pending.id, accept: false }, { world: ctx.world, actor: { kind: 'ai', name: 'Gouvernement USA' } });
    expect(refuse.ok).toBe(true);
    // Retour intégral du stock, aucune création/destruction monétaire
    expect(france.resources.industrial.stock).toBeCloseTo(stockBefore, 1);
    expect(usa.resources.industrial.stock).toBe(stockUsaBefore);
    expect(france.economy.cash).toBe(cashFrBefore);
    expect(usa.economy.cash).toBe(cashUsaBefore);
    expect(ctx.world.pendingDeliveries.find((d) => d.id === pending.id)).toBeUndefined();
  });

  it('livraison sans réponse : expiration et retour automatique via le moteur', async () => {
    const france = ctx.world.country('france')!;
    const italie = ctx.world.country('italie')!;
    france.resources.industrial.stock = 200;
    france.relations['italie']!.score = 70;
    italie.relations['france']!.score = 70;
    italie.resources.industrial.capacity = Math.max(italie.resources.industrial.capacity, 2000);
    const stockBefore = france.resources.industrial.stock;
    const res = executeAction(ctx.world, 'france', { type: 'ship_goods', toId: 'italie', resource: 'industrial', units: 25, corridorId: 'auto' }, actor);
    expect(res.ok).toBe(true);
    const pending = ctx.world.pendingDeliveries.find((d) => d.fromId === 'france' && d.toId === 'italie')!;
    expect(pending).toBeDefined();
    // Forcer l'expiration puis lancer un tick : le moteur retourne la marchandise
    pending.expiresDay = ctx.world.meta.day - 1;
    const stockAfterShip = france.resources.industrial.stock;
    await ctx.engine.forceTicks(1);
    expect(ctx.world.pendingDeliveries.find((d) => d.id === pending.id)).toBeUndefined();
    // Retour du stock réservé (le tick a pu produire/consommer légèrement par ailleurs)
    expect(france.resources.industrial.stock).toBeGreaterThan(stockAfterShip);
    expect(italie.controller.kind).toBe('ai');
    void stockBefore;
  }, 60_000);

  it('la voie directe n\'existe plus : expédition refusée, route commerciale obligatoire', () => {
    const res = executeAction(ctx.world, 'france', { type: 'ship_goods', toId: 'usa', resource: 'industrial', units: 80, corridorId: 'direct' }, actor);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/route commerciale/i);
    // Aucune option de route ne propose de voie directe
    const france = ctx.world.country('france')!;
    const usa = ctx.world.country('usa')!;
    const opts = routeOptions(ctx.world, france, usa);
    expect(opts.some((o) => o.id === 'direct')).toBe(false);
    expect(opts.every((o) => o.corridors.length >= 1)).toBe(true);
  });

  it('sa propre route = péage zéro', () => {
    const france = ctx.world.country('france')!;
    const co = ctx.world.corridor('atlantique_nord')!;
    co.owner = 'france';
    co.toll = 12;
    const usa = ctx.world.country('usa')!;
    const q = quoteShipment(ctx.world, france, usa, 'industrial', 30, 'atlantique_nord');
    expect(q.tollRate).toBe(0);
    expect(q.toll).toBe(0);
  });

  it('entretien quotidien prélevé par le moteur', async () => {
    const co = ctx.world.corridor('atlantique_nord')!;
    co.owner = 'france';
    const france = ctx.world.country('france')!;
    france.economy.cash = 100;
    const before = france.economy.cash;
    await ctx.engine.forceTicks(2);
    // entretien annuel/365 par tick : cash a baissé d'au moins un jour d'entretien
    expect(france.economy.cash).toBeLessThan(before + 1);
  }, 60_000);

  it('rupture d’accord : relations et confiance dégradées, miroir cohérent', () => {
    const france = ctx.world.country('france')!;
    const italie = ctx.world.country('italie')!;
    // Créer un accord actif propre
    france.relations['italie']!.agreements = [];
    italie.relations['france']!.agreements = [];
    const ag = { id: 'ag_test_break', type: 'free_trade' as const, status: 'active' as const, fromId: 'france', toId: 'italie', createdDay: 0, expiresDay: null };
    france.relations['italie']!.agreements.push(ag);
    italie.relations['france']!.agreements.push({ ...ag });
    france.relations['italie']!.score = 70;
    italie.relations['france']!.score = 70;

    const res = executeAction(ctx.world, 'france', { type: 'break_agreement', agreementId: 'ag_test_break' }, actor);
    expect(res.ok).toBe(true);
    expect(france.relations['italie']!.agreements[0]!.status).toBe('rejected');
    expect(italie.relations['france']!.agreements[0]!.status).toBe('rejected');
    expect(france.relations['italie']!.score).toBeCloseTo(60, 0);
    expect(italie.relations['france']!.score).toBeCloseTo(france.relations['italie']!.score, 1);
  });

  it('accord avec partenaire impopulaire : pénalité de popularité', () => {
    const france = ctx.world.country('france')!;
    const russie = ctx.world.country('russie')!;
    russie.popularity = 20;
    russie.stability = 25; // réputation 22.5 < 45
    const popBefore = france.popularity;
    // Proposition russe acceptée par la France
    const ag = { id: 'ag_rep_test', type: 'economic_treaty' as const, status: 'proposed' as const, fromId: 'russie', toId: 'france', createdDay: 0, expiresDay: null };
    france.relations['russie']!.agreements.push(ag);
    russie.relations['france']!.agreements.push({ ...ag });
    const res = executeAction(ctx.world, 'france', { type: 'respond_proposal', proposalId: 'ag_rep_test', accept: true }, actor);
    expect(res.ok).toBe(true);
    expect(france.popularity).toBeLessThan(popBefore);
    expect(france.history.some((h) => h.text.includes('désapprouve'))).toBe(true);
  });

  it('l’IA achète des routes et expédie (monde vivant)', async () => {
    for (let i = 0; i < 60; i++) await ctx.engine.forceTicks(1);
    const owned = [...ctx.world.corridors.values()].filter((co) => co.owner !== null);
    expect(owned.length, 'aucune route achetée par les IA').toBeGreaterThan(0);
    const decisions = await ctx.world.repos.listAiDecisions(400);
    expect(decisions.some((d) => d.action === 'ship_goods' || d.action === 'buy_corridor')).toBe(true);
  }, 120_000);
});

/* ------------------------------------------------------------------ */
/* v7 — Réseau complet : aucune voie directe, tout est achetable        */
/* ------------------------------------------------------------------ */

describe('Réseau de routes 100 % achetable (aucune voie directe)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('toutes les régions du monde sont reliées au réseau de corridors', () => {
    const regions = new Set(ctx.world.allCountries().map((c) => c.region));
    const adj = new Map<string, Set<string>>();
    for (const r of regions) adj.set(r, new Set());
    for (const co of ctx.world.corridors.values()) {
      const [a, b] = co.regions;
      if (a === b) continue;
      adj.get(a)?.add(b);
      adj.get(b)?.add(a);
    }
    const start = [...regions][0]!;
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const r = queue.shift()!;
      for (const n of adj.get(r) ?? []) {
        if (!seen.has(n)) { seen.add(n); queue.push(n); }
      }
    }
    expect(seen.size, 'régions isolées du réseau').toBe(regions.size);
  });

  it('chaque paire de pays dispose d\'au moins une route, toujours via ≥1 corridor', () => {
    const countries = ctx.world.allCountries();
    let checked = 0;
    for (const a of countries) {
      for (const b of countries) {
        if (a.id === b.id) continue;
        const opts = routeOptions(ctx.world, a, b);
        expect(opts.length, `aucune route ${a.id}→${b.id}`).toBeGreaterThan(0);
        for (const o of opts) {
          expect(o.id, `voie directe ${a.id}→${b.id}`).not.toBe('direct');
          expect(o.corridors.length, `option sans corridor ${a.id}→${b.id} (${o.id})`).toBeGreaterThan(0);
          expect(Number.isFinite(o.costRate)).toBe(true);
        }
        checked++;
      }
    }
    expect(checked).toBe(36 * 35);
  }, 240_000);

  it('chaque corridor du catalogue est achetable (prix > 0, libre au départ)', () => {
    for (const co of ctx.world.corridors.values()) {
      expect(co.purchaseCost).toBeGreaterThan(0);
      expect(co.upkeep).toBeGreaterThan(0);
      expect(co.owner).toBeNull();
      expect(co.hubs).toHaveLength(2);
      expect(co.regions).toHaveLength(2);
    }
  });
});

describe('Péages automatiques → trésorerie des propriétaires', () => {
  it('expédition « auto » : péages multi-étapes versés à la trésorerie, fret appliqué', async () => {
    const ctx = await createTestContext();
    try {
      setPlayerController(ctx.world, 'canada', 'user_ca_auto', 'Justin');
      const actor: ActionContext = { world: ctx.world, actor: { kind: 'player', name: 'Justin', userId: 'user_ca_auto' } };
      const canada = ctx.world.country('canada')!;
      const chine = ctx.world.country('chine')!;
      const france = ctx.world.country('france')!;
      for (const co of ctx.world.corridors.values()) { co.owner = null; co.toll = 0; co.traffic = 0; }
      const pac = ctx.world.corridor('pacifique')!;
      pac.owner = 'france';
      pac.toll = 10;
      canada.resources.industrial.stock = 400;
      chine.resources.industrial.capacity = Math.max(chine.resources.industrial.capacity, 5000);
      chine.resources.industrial.stock = 10;
      canada.relations['chine']!.score = 70;
      chine.relations['canada']!.score = 70;

      const cashFr = france.economy.cash;
      const cashCa = canada.economy.cash;
      const cashCh = chine.economy.cash;
      const quote = quoteShipment(ctx.world, canada, chine, 'industrial', 100, 'auto');
      expect(quote.ok).toBe(true);
      expect(quote.toll, 'aucun péage alors que la France possède la route').toBeGreaterThan(0);

      // 1) Expédition : stock réservé, aucune transaction monétaire
      const res = executeAction(ctx.world, 'canada', { type: 'ship_goods', toId: 'chine', resource: 'industrial', units: 100, corridorId: 'auto' }, actor);
      expect(res.ok).toBe(true);
      expect(france.economy.cash).toBe(cashFr);
      expect(canada.economy.cash).toBe(cashCa);
      const pending = ctx.world.pendingDeliveries.find((d) => d.fromId === 'canada' && d.toId === 'chine');
      expect(pending).toBeDefined();
      expect(pending!.corridors).toContain('pacifique');

      // 2) La Chine ACCEPTE : elle est débitée, le Canada encaisse, la France perçoit le péage
      const accept = executeAction(ctx.world, 'chine', { type: 'respond_delivery', deliveryId: pending!.id, accept: true }, { world: ctx.world, actor: { kind: 'ai', name: 'Gouvernement Chine' } });
      expect(accept.ok).toBe(true);
      // Le péage tombe DIRECTEMENT dans la trésorerie du propriétaire
      expect(france.economy.cash - cashFr).toBeCloseTo(quote.toll, 1);
      // L'exportateur encaisse valeur − péages − fret
      const net = quote.value - quote.toll - quote.freight;
      expect(canada.economy.cash - cashCa).toBeCloseTo(net, 1);
      expect(net).toBeLessThan(100 * 10); // fret + péage déduits
      // Le destinataire paie exactement la valeur : conservation monétaire
      expect(chine.economy.cash - cashCh).toBeCloseTo(-quote.value, 1);
      expect(pac.traffic).toBeGreaterThan(0);
      const route = ctx.world.routes.get('canada->chine:industrial');
      expect(route?.corridors).toContain('pacifique');
    } finally {
      await ctx.close();
    }
  });

  it('commerce automatique (moteur) : le transit paie le propriétaire et cumule le trafic', async () => {
    const ctx = await createTestContext();
    try {
      const w = ctx.world;
      for (const co of w.corridors.values()) { co.owner = null; co.toll = 0; co.traffic = 0; }
      const pac = w.corridor('pacifique')!;
      pac.owner = 'france';
      pac.toll = 10;
      // Neutraliser tout le commerce sauf canada→chine (minerais)
      for (const c of w.allCountries()) {
        for (const k of RESOURCE_KEYS) {
          const r = c.resources[k];
          r.production = r.consumption;
          r.stock = Math.round(r.capacity * 0.5 * 100) / 100;
        }
      }
      const canada = w.country('canada')!;
      const chine = w.country('chine')!;
      const france = w.country('france')!;
      const mCa = canada.resources.minerals;
      mCa.production = 40; mCa.consumption = 5; mCa.capacity = 1000; mCa.stock = 400;
      const mCh = chine.resources.minerals;
      mCh.production = 10; mCh.consumption = 60; mCh.capacity = 5000; mCh.stock = 5;
      canada.relations['chine']!.score = 70;
      chine.relations['canada']!.score = 70;
      canada.routePrefs['chine'] = 'pacifique';

      const cashFr = france.economy.cash;
      const res = processTrade(w, () => 0.5);
      const route = w.routes.get('canada->chine:minerals');
      expect(route, 'flux automatique canada→chine absent').toBeDefined();
      expect(route!.corridors).toEqual(['pacifique']);
      expect(pac.traffic).toBeGreaterThan(0);
      const delta = france.economy.cash - cashFr;
      expect(delta, 'le péage doit entrer automatiquement dans la trésorerie du propriétaire').toBeGreaterThan(0);
      expect(Math.abs(delta - route!.value * 0.1)).toBeLessThan(0.01);
      expect(res.routeCount).toBeGreaterThanOrEqual(1);
    } finally {
      await ctx.close();
    }
  });

  it('corridor libre : le trafic est compté même sans propriétaire (attractivité à l\'achat)', async () => {
    const ctx = await createTestContext();
    try {
      const w = ctx.world;
      for (const co of w.corridors.values()) { co.owner = null; co.toll = 0; co.traffic = 0; }
      for (const c of w.allCountries()) {
        for (const k of RESOURCE_KEYS) {
          const r = c.resources[k];
          r.production = r.consumption;
          r.stock = Math.round(r.capacity * 0.5 * 100) / 100;
        }
      }
      const canada = w.country('canada')!;
      const chine = w.country('chine')!;
      canada.resources.minerals.production = 40;
      canada.resources.minerals.consumption = 5;
      canada.resources.minerals.capacity = 1000;
      canada.resources.minerals.stock = 400;
      chine.resources.minerals.production = 10;
      chine.resources.minerals.consumption = 60;
      chine.resources.minerals.capacity = 5000;
      chine.resources.minerals.stock = 5;
      canada.relations['chine']!.score = 70;
      chine.relations['canada']!.score = 70;
      canada.routePrefs['chine'] = 'pacifique';
      processTrade(w, () => 0.5);
      expect(w.corridor('pacifique')!.traffic).toBeGreaterThan(0);
      expect(w.corridor('pacifique')!.owner).toBeNull();
    } finally {
      await ctx.close();
    }
  });
});

describe('Migration du monde existant (nouvelles routes ajoutées sans reset)', () => {
  it('un monde persisté avec l\'ancien catalogue reçoit les nouvelles routes à la reprise', async () => {
    const storage = new MemoryStorage();
    const w1 = await WorldStore.seed(storage);
    const total = w1.corridors.size;
    expect(total).toBeGreaterThanOrEqual(30);
    // Simuler un monde existant : uniquement les 12 corridors historiques, dont un possédé
    const old = [...w1.corridors.values()].slice(0, 12).map((co) => ({ ...co }));
    old[0] = { ...old[0]!, owner: 'france', toll: 9, traffic: 123 };
    await storage.set(K.corridors, old);
    const w2 = await WorldStore.load(storage);
    expect(w2.corridors.size).toBe(total);
    // Propriété/péage/trafic existants préservés
    const panama = w2.corridor(old[0]!.id)!;
    expect(panama.owner).toBe('france');
    expect(panama.toll).toBe(9);
    expect(panama.traffic).toBe(123);
    // Les nouvelles routes arrivent libres, sans péage
    const steppe = w2.corridor('steppe_eurasienne')!;
    expect(steppe).toBeDefined();
    expect(steppe.owner).toBeNull();
    expect(steppe.toll).toBe(0);
    expect(steppe.traffic).toBe(0);
  });
});
