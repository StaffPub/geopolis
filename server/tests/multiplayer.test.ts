/**
 * Test multijoueur temps réel (scénario spec §56) :
 *   Joueur A → France, Joueur B → Allemagne, Joueur C → observateur.
 * A agit ; B reçoit les changements pertinents ; C voit les indicateurs globaux.
 * Plus : reconnexion, resynchronisation, présence, refus d'action illégale.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApiClient, createTestContext, registerAndLogin, TestWsClient, type TestContext } from './helpers.js';
import type { ServerMessage } from 'shared';

describe('Multijoueur temps réel (WebSocket)', () => {
  let ctx: TestContext;
  let clientA: ApiClient;
  let clientB: ApiClient;
  let wsA: TestWsClient;
  let wsB: TestWsClient;
  let wsC: TestWsClient;

  beforeAll(async () => {
    ctx = await createTestContext({ tickMs: 300 });

    clientA = new ApiClient(ctx.baseUrl);
    await registerAndLogin(clientA, 'JoueurA');
    await clientA.post('/api/countries/france/claim');

    clientB = new ApiClient(ctx.baseUrl);
    await registerAndLogin(clientB, 'JoueurB');
    await clientB.post('/api/countries/allemagne/claim');

    wsA = new TestWsClient(`ws://127.0.0.1:${ctx.port}/ws`, clientA.cookie);
    wsB = new TestWsClient(`ws://127.0.0.1:${ctx.port}/ws`, clientB.cookie);
    wsC = new TestWsClient(`ws://127.0.0.1:${ctx.port}/ws`, null);
    await Promise.all([wsA.open(), wsB.open(), wsC.open()]);
  }, 30_000);

  afterAll(async () => {
    wsA?.close();
    wsB?.close();
    wsC?.close();
    await ctx.close();
  });

  it('connexion : welcome authentifié + snapshot du monde pour tous', async () => {
    const welcomeA = await wsA.waitFor('welcome');
    expect(welcomeA.type === 'welcome' && welcomeA.username).toBe('JoueurA');
    expect(welcomeA.type === 'welcome' && welcomeA.countryId).toBe('france');

    const snapC = await wsC.waitFor('world_snapshot');
    expect(snapC.type === 'world_snapshot' && snapC.countries.length).toBe(36);
  });

  it('indicateur EN DIRECT : acteurs comptés honnêtement (humains + IA)', async () => {
    // refreshPresence diffuse un world_update à chaque connexion : on attend
    // celui qui reflète les deux joueurs connectés.
    const wu = await wsA.waitFor(
      'world_update',
      10000,
      (m) => m.type === 'world_update' && m.actors.humans >= 2,
    );
    if (wu.type !== 'world_update') throw new Error('world_update manquant');
    expect(wu.actors.humans).toBeGreaterThanOrEqual(2);
    expect(wu.actors.ai).toBeGreaterThanOrEqual(0);
    expect(wu.actors.total).toBe(wu.actors.humans + wu.actors.ai);
  }, 15_000);

  it('présence : les deux joueurs sont listés, pas les IA en tant qu’humains', async () => {
    await new Promise((r) => setTimeout(r, 200));
    const presenceMsgs = wsA.messages.filter((m): m is Extract<ServerMessage, { type: 'presence_update' }> => m.type === 'presence_update');
    expect(presenceMsgs.length).toBeGreaterThan(0);
    const last = presenceMsgs[presenceMsgs.length - 1]!;
    const usernames = last.presence.map((p) => p.username).sort();
    expect(usernames).toContain('JoueurA');
    expect(usernames).toContain('JoueurB');
    expect(last.presence.every((p) => p.isAi === false)).toBe(true);
  });

  it('A agit → B reçoit les mises à jour publiques pertinentes', async () => {
    const markB = wsB.messages.length;
    const res = await clientA.post<{ ok: boolean }>('/api/countries/france/actions', {
      params: { type: 'improve_relations', targetId: 'allemagne' },
      requestId: 'mp-test-0001',
    });
    expect(res.data.ok).toBe(true);

    const update = await wsB.waitFor(
      'country_public_update',
      8000,
      (m) => wsB.messages.indexOf(m) >= markB,
    );
    expect(update.type === 'country_public_update');
    const journal = await wsB.waitFor('journal_update', 8000, (m) => wsB.messages.indexOf(m) >= markB);
    expect(journal.type === 'journal_update');
  }, 20_000);

  it('abonnement pays : B reçoit le snapshot complet de l’Allemagne', async () => {
    wsB.send({ type: 'subscribe', countryId: 'allemagne' });
    const snap = await wsB.waitFor('country_snapshot', 8000, (m) => m.type === 'country_snapshot' && m.country.id === 'allemagne');
    expect(snap.type === 'country_snapshot' && snap.relationsSummary.length).toBe(35);
  }, 15_000);

  it('tick moteur → diffusion monde (world_update, market_update, trade_update)', async () => {
    const mark = wsC.messages.length;
    await ctx.engine.forceTicks(1);
    const wu = await wsC.waitFor('world_update', 8000, (m) => wsC.messages.indexOf(m) >= mark);
    expect(wu.type === 'world_update' && wu.meta.tick).toBe(ctx.world.meta.tick);
    await wsC.waitFor('market_update', 8000, (m) => wsC.messages.indexOf(m) >= mark);
    await wsC.waitFor('trade_update', 8000, (m) => wsC.messages.indexOf(m) >= mark);
  }, 20_000);

  it('action illégale refusée via API (pays d’un autre joueur)', async () => {
    const res = await clientB.post('/api/countries/france/actions', { params: { type: 'set_tax', value: 50 } });
    expect(res.status).toBe(403);
  });

  it('payload WebSocket invalide → message d’erreur, connexion maintenue', async () => {
    wsC.send({ type: 'nimporte_quoi' });
    const err = await wsC.waitFor('error', 5000);
    expect(err.type === 'error' && err.code).toBe('unknown_type');
    expect(wsC.ws.readyState).toBe(wsC.ws.OPEN);
  });

  it('reconnexion : resynchronisation complète automatique', async () => {
    const ws2 = new TestWsClient(`ws://127.0.0.1:${ctx.port}/ws`, clientA.cookie);
    await ws2.open();
    const snap = await ws2.waitFor('world_snapshot', 8000);
    expect(snap.type === 'world_snapshot' && snap.meta.tick).toBe(ctx.world.meta.tick);
    const welcome = await ws2.waitFor('welcome', 8000);
    expect(welcome.type === 'welcome' && welcome.countryId).toBe('france');
    ws2.send({ type: 'request_full_sync' });
    const countBefore = ws2.messages.filter((m) => m.type === 'world_snapshot').length;
    await new Promise((r) => setTimeout(r, 400));
    const countAfter = ws2.messages.filter((m) => m.type === 'world_snapshot').length;
    expect(countAfter).toBeGreaterThan(countBefore);
    ws2.close();
  }, 20_000);

  it('heartbeat ping/pong fonctionnel', async () => {
    const t0 = Date.now();
    wsA.send({ type: 'ping', t: t0 });
    const pong = await wsA.waitFor('pong', 5000, (m) => m.type === 'pong' && m.t === t0);
    expect(pong.type === 'pong' && pong.t).toBe(t0);
  });
});
