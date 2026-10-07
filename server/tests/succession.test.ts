/**
 * Test de succession (spec §9/§30) : la perte de mandat n'est jamais
 * instantanée — seuil + durée + avertissements — et le pays repasse à l'IA
 * sans perdre son état. Le joueur reste connecté à son compte.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MANDATE_LOSS_TICKS } from '../src/simulation/politics.js';
import { ApiClient, createTestContext, registerAndLogin, type TestContext } from './helpers.js';

describe('Popularité & succession de mandat', () => {
  let ctx: TestContext;
  let player: ApiClient;

  beforeAll(async () => {
    ctx = await createTestContext();
    player = new ApiClient(ctx.baseUrl);
    await registerAndLogin(player, 'PresidentTest');
    await player.post('/api/countries/argentine/claim');
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('popularité basse : risque progressif, avertissements, PAS d’expulsion instantanée', async () => {
    const c = ctx.world.country('argentine')!;
    expect(c.controller.kind).toBe('player');

    // Situation dégradée mais pas de perte immédiate
    c.popularity = 20;
    c.stability = 30;
    c.economy.inflation = 12;
    c.economy.unemployment = 15;
    ctx.world.markDirty('argentine');

    await ctx.engine.forceTicks(3);
    expect(c.controller.kind, 'expulsion instantanée interdite').toBe('player');
    expect(c.mandate.lowPopularityTicks).toBeGreaterThan(0);
    expect(c.mandate.risk).not.toBe('critique');

    // Avertissement au premier seuil (12 jours sous le seuil)
    const notifs0 = (await ctx.world.repos.listNotifications(c.controller.userId!)).length;
    for (let i = 0; i < 12; i++) await ctx.engine.forceTicks(1);
    c.popularity = 20; // le joueur ne redresse rien
    const notifs = await ctx.world.repos.listNotifications(c.controller.userId!);
    expect(notifs.length).toBeGreaterThan(notifs0);
    expect(notifs.some((n) => n.type === 'mandate')).toBe(true);
  }, 120_000);

  it('redressement possible : la popularité remonte, le compteur baisse', async () => {
    const c = ctx.world.country('argentine')!;
    const ticksBefore = c.mandate.lowPopularityTicks;
    c.popularity = 60;
    c.stability = 70;
    c.economy.inflation = 2;
    c.economy.unemployment = 6;
    c.economy.growth = 3;
    ctx.world.markDirty('argentine');
    await ctx.engine.forceTicks(2);
    expect(c.mandate.lowPopularityTicks).toBeLessThan(ticksBefore);
    expect(c.controller.kind).toBe('player');
  }, 60_000);

  it('perte de mandat après la durée critique : IA reprend, état préservé, joueur libre', async () => {
    const c = ctx.world.country('argentine')!;
    const userId = c.controller.userId!;
    const gdpBefore = c.economy.gdp;
    const popBefore = c.population;

    // Pousser le compteur juste sous le seuil, puis basculer
    c.mandate.lowPopularityTicks = MANDATE_LOSS_TICKS - 1;
    c.popularity = 15;
    c.stability = 25;
    ctx.world.markDirty('argentine');

    await ctx.engine.forceTicks(2);

    expect(c.controller.kind).toBe('ai');
    expect(c.controller.userId).toBeNull();
    expect(c.controller.presidentName.length).toBeGreaterThan(2);
    // Aucune donnée du pays n'est supprimée
    expect(c.economy.gdp).toBeCloseTo(gdpBefore, -1);
    expect(c.population).toBeGreaterThan(popBefore * 0.9);
    expect(c.economy.debt).toBeGreaterThanOrEqual(0);
    // Le hook de succession a libéré le compte joueur
    const user = await ctx.world.repos.getUser(userId);
    expect(user!.countryId).toBeNull();
    // Le joueur reste connecté et peut consulter/rejoindre un autre pays
    const me = await player.get<{ user: { username: string }; countryId: string | null }>('/api/me');
    expect(me.status).toBe(200);
    expect(me.data.user.username).toBe('PresidentTest');
    expect(me.data.countryId).toBeNull();
    const claim = await player.post<{ ok: boolean }>('/api/countries/chili/claim');
    expect(claim.status).toBe(404); // 'chili' n'existe pas : la liste est figée
    const claim2 = await player.post<{ ok: boolean }>('/api/countries/bresil/claim');
    expect(claim2.status).toBe(200);
    // Notification de fin de mandat reçue
    const notifs = await ctx.world.repos.listNotifications(userId);
    expect(notifs.some((n) => n.title.toLowerCase().includes('tombé'))).toBe(true);
    expect(ctx.mandateLosses.length).toBeGreaterThan(0);
  }, 60_000);
});
