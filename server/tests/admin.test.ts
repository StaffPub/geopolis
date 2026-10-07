/**
 * Tests admin : le rôle est déterminé CÔTÉ SERVEUR par ADMIN_EMAIL,
 * chaque route sensible est protégée, les outils de supervision fonctionnent.
 * IMPORTANT : ADMIN_EMAIL est défini AVANT l'import des modules serveur.
 */
process.env.ADMIN_EMAIL = 'admin@geopolis.test';
process.env.SESSION_SECRET = 'test-secret';

const { describe, it, expect, beforeAll, afterAll } = await import('vitest');
const { ApiClient, createTestContext, registerAndLogin } = await import('./helpers.js');
type TestContext = Awaited<ReturnType<typeof createTestContext>>;

describe('Admin — sécurité & supervision', () => {
  let ctx: TestContext;
  let admin: ApiClient;
  let normal: ApiClient;

  beforeAll(async () => {
    ctx = await createTestContext();

    admin = new ApiClient(ctx.baseUrl);
    await registerAndLogin(admin, 'RootAdmin', 'admin@geopolis.test');

    normal = new ApiClient(ctx.baseUrl);
    await registerAndLogin(normal, 'SimpleJoueur');
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('l’admin est reconnu côté serveur (rôle dans /me)', async () => {
    const me = await admin.get<{ user: { role: string } }>('/api/me');
    expect(me.data.user.role).toBe('admin');
    const meNormal = await normal.get<{ user: { role: string } }>('/api/me');
    expect(meNormal.data.user.role).toBe('user');
  });

  it('routes admin refusées aux non-admins (403)', async () => {
    for (const route of ['/api/admin/overview', '/api/admin/users', '/api/admin/countries', '/api/admin/simulation', '/api/admin/audit']) {
      const res = await normal.get(route);
      expect(res.status, `${route} devrait être 403`).toBe(403);
    }
    const anon = new ApiClient(ctx.baseUrl);
    const res = await anon.get('/api/admin/overview');
    expect(res.status).toBe(401);
  });

  it('overview admin : indicateurs réels', async () => {
    const res = await admin.get<{ nations: number; engine: { running: boolean }; users: number }>('/api/admin/overview');
    expect(res.status).toBe(200);
    expect(res.data.nations).toBe(36);
    expect(res.data.users).toBe(2);
    expect(res.data.engine).toBeDefined();
  });

  it('suspension/réactivation d’utilisateur', async () => {
    const users = await admin.get<{ users: { id: string; username: string }[] }>('/api/admin/users');
    const target = users.data.users.find((u) => u.username === 'SimpleJoueur')!;
    const susp = await admin.post<{ ok: boolean }>(`/api/admin/users/${target.id}/suspend`);
    expect(susp.data.ok).toBe(true);
    // Un utilisateur suspendu ne peut plus se connecter
    const login = new ApiClient(ctx.baseUrl);
    const res = await login.post('/api/auth/login', { email: 'simplejoueur@test.dev', password: 'MotDePasse123!' });
    expect(res.status).toBe(403);
    const react = await admin.post<{ ok: boolean }>(`/api/admin/users/${target.id}/reactivate`);
    expect(react.data.ok).toBe(true);
  });

  it('modification de variables pays + force-ai', async () => {
    const res = await admin.patch<{ ok: boolean; corrections: string[] }>('/api/admin/countries/grece/variables', { cash: 42, popularity: 66 });
    expect(res.status).toBe(200);
    const c = ctx.world.country('grece')!;
    expect(c.economy.cash).toBeCloseTo(42, 1);
    expect(c.popularity).toBeCloseTo(66, 0);

    const invalid = await admin.patch('/api/admin/countries/grece/variables', { popularity: 5000 });
    expect(invalid.status).toBe(400);

    const force = await admin.post<{ ok: boolean }>('/api/admin/countries/grece/force-ai');
    expect(force.data.ok).toBe(true);
    expect(c.controller.kind).toBe('ai');
  });

  it('simulation : tick forcé, check d’intégrité, resync', async () => {
    const tick0 = ctx.world.meta.tick;
    const tickRes = await admin.post<{ ok: boolean; tick: { tick: number } }>('/api/admin/simulation/tick', { n: 2 });
    expect(tickRes.data.ok).toBe(true);
    expect(ctx.world.meta.tick).toBe(tick0 + 2);

    const check = await admin.post<{ ok: boolean; problems: string[] }>('/api/admin/integrity/check');
    expect(check.data.ok).toBe(true);
    expect(check.data.problems).toEqual([]);

    const repair = await admin.post<{ ok: boolean }>('/api/admin/integrity/repair');
    expect(repair.data.ok).toBe(true);

    const resync = await admin.post<{ ok: boolean }>('/api/admin/simulation/resync');
    expect(resync.data.ok).toBe(true);
  }, 60_000);

  it('reseed protégé par confirmation forte', async () => {
    const bad = await admin.post('/api/admin/world/reseed', { confirm: 'oui' });
    expect(bad.status).toBe(400);
    const good = await admin.post<{ ok: boolean }>('/api/admin/world/reseed', { confirm: 'RESEED WORLD' });
    expect(good.data.ok).toBe(true);
    expect(ctx.world.countries.size).toBe(36);
    expect(ctx.world.meta.tick).toBe(0);
  }, 60_000);

  it('après reseed : plus aucun joueur bloqué (release tolérant + reclaim possible)', async () => {
    const p = new ApiClient(ctx.baseUrl);
    await registerAndLogin(p, 'JoueurReseed');
    const claim0 = await p.post<{ ok: boolean }>('/api/countries/italie/claim');
    expect(claim0.status).toBe(200);

    const reseed = await admin.post<{ ok: boolean }>('/api/admin/world/reseed', { confirm: 'RESEED WORLD' });
    expect(reseed.data.ok).toBe(true);

    // Release tolérant : le pays est contrôlé par l'IA, le compte n'est pas bloqué
    const rel = await p.post<{ ok: boolean }>('/api/countries/italie/release');
    expect(rel.status).toBe(200);
    expect(rel.data.ok).toBe(true);

    // Reclaim immédiat possible
    const claim = await p.post<{ ok: boolean }>('/api/countries/italie/claim');
    expect(claim.status).toBe(200);
    const me = await p.get<{ countryId: string }>('/api/me');
    expect(me.data.countryId).toBe('italie');
  }, 60_000);
});
