/**
 * Test de simulation long : le moteur doit tourner des centaines de ticks
 * sans crash, sans NaN, sans état impossible, et faire évoluer le monde.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext, allNumbersValid, type TestContext } from './helpers.js';

describe('Moteur de simulation — run long', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('seed : 36 nations cohérentes au démarrage', () => {
    expect(ctx.world.countries.size).toBe(36);
    for (const c of ctx.world.allCountries()) {
      expect(c.population).toBeGreaterThan(0);
      expect(c.economy.gdp).toBeGreaterThan(0);
      expect(c.economy.cash).toBeGreaterThanOrEqual(0);
      expect(c.popularity).toBeGreaterThanOrEqual(0);
      expect(c.popularity).toBeLessThanOrEqual(100);
      expect(c.controller.kind).toBe('ai');
      expect(c.controller.presidentName.length).toBeGreaterThan(2);
      expect(Object.keys(c.relations).length).toBe(35);
    }
    // Équilibrage initial : pas d'hyperinflation extrême ni de dette irréaliste
    // (valeurs seed = données réelles : Turquie ~60 % d'inflation, Japon ~250 % de dette)
    for (const c of ctx.world.allCountries()) {
      expect(c.economy.inflation).toBeLessThan(70);
      expect(c.economy.debt / c.economy.gdp).toBeLessThan(3);
      expect(c.popularity).toBeGreaterThan(35);
    }
  });

  it('300 ticks : aucune valeur NaN, aucune corruption', async () => {
    for (let i = 0; i < 300; i++) {
      await ctx.engine.forceTicks(1);
    }
    expect(ctx.world.meta.tick).toBe(300);
    expect(ctx.world.meta.day).toBe(300);

    for (const c of ctx.world.allCountries()) {
      const problems = allNumbersValid({
        economy: c.economy,
        population: c.population,
        popularity: c.popularity,
        stability: c.stability,
        resources: c.resources,
        policy: c.policy,
      }, c.id);
      expect(problems, `NaN dans ${c.id}: ${problems.join(', ')}`).toEqual([]);
      expect(c.population, `${c.id} : population négative`).toBeGreaterThan(0);
      expect(c.economy.gdp, `${c.id} : PIB négatif`).toBeGreaterThan(0);
      expect(c.economy.cash, `${c.id} : trésorerie négative`).toBeGreaterThanOrEqual(0);
      expect(c.economy.debt, `${c.id} : dette négative`).toBeGreaterThanOrEqual(0);
      for (const [k, r] of Object.entries(c.resources)) {
        expect(r.stock, `${c.id}.${k} stock négatif`).toBeGreaterThanOrEqual(0);
        expect(r.price, `${c.id}.${k} prix invalide`).toBeGreaterThan(0);
      }
    }
    const problems = ctx.engine.validateWorld();
    expect(problems, problems.join(' | ')).toEqual([]);
  }, 120_000);

  it('le monde évolue réellement (PIB, commerce, journal)', () => {
    // Du commerce existe
    expect(ctx.world.routes.size).toBeGreaterThan(0);
    // Le journal mondial est alimenté
    expect(ctx.world.journal.length).toBeGreaterThan(10);
    // Les séries historiques sont bornées et remplies
    for (const c of ctx.world.allCountries()) {
      expect(c.series.length).toBeGreaterThan(120);
      expect(c.series.length).toBeLessThanOrEqual(160);
    }
    // Relations toujours symétriques et dans les bornes
    for (const c of ctx.world.allCountries()) {
      for (const [oid, rel] of Object.entries(c.relations)) {
        expect(rel.score).toBeGreaterThanOrEqual(0);
        expect(rel.score).toBeLessThanOrEqual(100);
        const mirror = ctx.world.country(oid)!.relations[c.id]!;
        expect(Math.abs(mirror.score - rel.score)).toBeLessThan(0.011);
      }
    }
    // Transactions : aucune duplication d'id
    const ids = new Set(ctx.world.transactions.map((t) => t.id));
    expect(ids.size).toBe(ctx.world.transactions.length);
  });

  it('les prix du marché mondial restent dans des bornes saines', () => {
    for (const [key, m] of Object.entries(ctx.world.market)) {
      expect(m.price, `prix ${key}`).toBeGreaterThan(0.05);
      expect(m.price, `prix ${key}`).toBeLessThan(100);
      expect(m.series.length).toBeGreaterThan(100);
    }
  });

  it('200 ticks supplémentaires : stabilité long terme', async () => {
    for (let i = 0; i < 200; i++) {
      await ctx.engine.forceTicks(1);
    }
    expect(ctx.world.meta.tick).toBe(500);
    expect(ctx.world.countries.size).toBe(36);
    const problems = ctx.engine.validateWorld();
    expect(problems, problems.join(' | ')).toEqual([]);
    // Aucun pays n'a disparu ni explosé en valeur absurde
    for (const c of ctx.world.allCountries()) {
      expect(c.economy.gdp).toBeGreaterThan(1);
      expect(c.economy.gdp).toBeLessThan(1e6);
      expect(c.economy.inflation).toBeLessThan(60);
      expect(c.population).toBeGreaterThan(0.05);
    }
  }, 120_000);
});
