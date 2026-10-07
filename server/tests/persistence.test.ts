/**
 * Tests de persistance & reprise : le monde survit au redémarrage,
 * le temps écoulé est rattrapé, les données restent intègres.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from '../src/storage/file.js';
import { WorldStore } from '../src/world/world.js';
import { WorldSimulationEngine } from '../src/simulation/engine.js';

describe('Persistance & reprise après redémarrage', () => {
  it('FileStorage : écriture/lecture atomique', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-storage-'));
    const storage = new FileStorage(dir);
    await storage.set('test:key', { hello: 'monde', n: 42 });
    const back = await storage.get<{ hello: string; n: number }>('test:key');
    expect(back).toEqual({ hello: 'monde', n: 42 });
    const keys = await storage.keys('test:');
    expect(keys).toContain('test:key');
    await storage.del('test:key');
    expect(await storage.get('test:key')).toBeNull();
    await storage.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('le monde survit à un redémarrage complet (rechargement)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-world-'));
    const storage1 = new FileStorage(dir);
    const world1 = await WorldStore.load(storage1);
    expect(world1.countries.size).toBe(36);

    // Modifications + ticks
    const c = world1.country('france')!;
    c.economy.cash = 123.456;
    c.popularity = 61;
    world1.markDirty('france');
    const engine1 = new WorldSimulationEngine(world1, storage1, {}, { tickMs: 1000, instanceId: 'i1', enabled: true });
    await engine1.forceTicks(5);
    const gdpAfter = world1.country('france')!.economy.gdp;
    await world1.save();

    // "Redémarrage" : nouvelle instance de stockage + rechargement
    const storage2 = new FileStorage(dir);
    const world2 = await WorldStore.load(storage2);
    expect(world2.countries.size).toBe(36);
    expect(world2.meta.tick).toBe(5);
    expect(world2.meta.day).toBe(5);
    const c2 = world2.country('france')!;
    expect(c2.popularity).toBeCloseTo(world1.country('france')!.popularity, 5);
    expect(c2.economy.gdp).toBeCloseTo(gdpAfter, 5);

    await storage2.close();
    await fs.rm(dir, { recursive: true, force: true });
  }, 60_000);

  it('catch-up : le temps écoulé hors ligne est rattrapé', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-catchup-'));
    const storage = new FileStorage(dir);
    const world = await WorldStore.load(storage);
    // Simuler une absence de 30 minutes (tick = 20 s → 90 ticks)
    world.meta.lastTickAt = Date.now() - 30 * 60 * 1000;
    const engine = new WorldSimulationEngine(world, storage, {}, { tickMs: 20_000, instanceId: 'i2', enabled: true });
    const caught = await engine.catchUp();
    expect(caught).toBe(90);
    expect(world.meta.day).toBe(90);
    // L'état reste valide après rattrapage
    expect(engine.validateWorld()).toEqual([]);
    await storage.close();
    await fs.rm(dir, { recursive: true, force: true });
  }, 120_000);

  it('intégrité : valeurs corrompues détectées et réparées', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-integrity-'));
    const storage = new FileStorage(dir);
    const world = await WorldStore.load(storage);
    const c = world.country('france')!;
    c.economy.cash = Number.NaN;
    c.population = -50;
    c.resources.energy.stock = -10;
    c.relations['allemagne']!.score = 500;
    world.markDirty('france');
    // La sauvegarde assainit
    await world.save();
    const storage2 = new FileStorage(dir);
    const world2 = await WorldStore.load(storage2);
    const c2 = world2.country('france')!;
    expect(Number.isFinite(c2.economy.cash)).toBe(true);
    expect(c2.population).toBeGreaterThan(0);
    expect(c2.resources.energy.stock).toBeGreaterThanOrEqual(0);
    expect(c2.relations['allemagne']!.score).toBeLessThanOrEqual(100);
    expect(world2.meta.integrityIssues).toBeGreaterThan(0);
    await storage2.close();
    await fs.rm(dir, { recursive: true, force: true });
  }, 30_000);
});
