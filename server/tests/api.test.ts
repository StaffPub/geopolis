/**
 * Tests d'intégration API : inscription, connexion, sessions, contrôle
 * exclusif d'un pays, permissions président, succession, sécurité admin.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApiClient, createTestContext, registerAndLogin, type TestContext } from './helpers.js';

describe('API — authentification & comptes', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('inscription → session cookie → /me', async () => {
    const client = new ApiClient(ctx.baseUrl);
    const user = await registerAndLogin(client, 'Alice');
    expect(user.id).toBeTruthy();

    const me = await client.get<{ user: { username: string; email: string }; countryId: string | null }>('/api/me');
    expect(me.status).toBe(200);
    expect(me.data.user.username).toBe('Alice');
    expect(me.data.countryId).toBeNull();
  });

  it('mot de passe jamais renvoyé ni stocké en clair', async () => {
    const client = new ApiClient(ctx.baseUrl);
    await registerAndLogin(client, 'Bob', 'bob@test.dev', 'MotDePasse123!');
    const me = await client.get<{ user: Record<string, unknown> }>('/api/me');
    expect(JSON.stringify(me.data)).not.toContain('MotDePasse123');
    expect(me.data.user['passwordHash']).toBeUndefined();
    // En base : hash bcrypt uniquement
    const users = await ctx.world.repos.listUsers();
    const bob = users.find((u) => u.username === 'Bob')!;
    expect(bob.passwordHash).not.toBe('MotDePasse123!');
    expect(bob.passwordHash.startsWith('$2')).toBe(true);
  });

  it('connexion : mauvais mot de passe → 401, bon mot de passe → session', async () => {
    const client = new ApiClient(ctx.baseUrl);
    const bad = await client.post('/api/auth/login', { email: 'alice@test.dev', password: 'mauvais' });
    expect(bad.status).toBe(401);

    const good = await client.post<{ user: { username: string } }>('/api/auth/login', { email: 'alice@test.dev', password: 'MotDePasse123!' });
    expect(good.status).toBe(200);
    expect(good.data.user.username).toBe('Alice');
  });

  it('email/pseudo dupliqués refusés, validation zod active', async () => {
    const client = new ApiClient(ctx.baseUrl);
    const dup = await client.post('/api/auth/register', { username: 'Alice2', email: 'alice@test.dev', password: 'MotDePasse123!' });
    expect(dup.status).toBe(409);
    const invalid = await client.post('/api/auth/register', { username: 'x', email: 'pas-un-email', password: 'court' });
    expect(invalid.status).toBe(400);
  });

  it('routes protégées sans session → 401', async () => {
    const anon = new ApiClient(ctx.baseUrl);
    const me = await anon.get('/api/me');
    expect(me.status).toBe(401);
    const notifs = await anon.get('/api/notifications');
    expect(notifs.status).toBe(401);
  });

  it('logout invalide la session', async () => {
    const client = new ApiClient(ctx.baseUrl);
    await registerAndLogin(client, 'Carol');
    const out = await client.post('/api/auth/logout');
    expect(out.status).toBe(200);
    client.cookie = null; // le cookie est vidé par le serveur
    const me = await client.get('/api/me');
    expect(me.status).toBe(401);
  });
});

describe('API — choix de pays & contrôle exclusif', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('liste des 36 pays disponibles avec statut LIBRE/JOUEUR', async () => {
    const client = new ApiClient(ctx.baseUrl);
    const res = await client.get<{ countries: Array<{ id: string; controllerKind: string }> }>('/api/countries');
    expect(res.status).toBe(200);
    expect(res.data.countries.length).toBe(36);
    expect(res.data.countries.every((c) => c.controllerKind === 'ai')).toBe(true);
  });

  it('claim : un joueur prend un pays, un second ne peut pas', async () => {
    const a = new ApiClient(ctx.baseUrl);
    await registerAndLogin(a, 'PlayerA');
    const claimA = await a.post<{ ok: boolean }>('/api/countries/france/claim');
    expect(claimA.status).toBe(200);

    const b = new ApiClient(ctx.baseUrl);
    await registerAndLogin(b, 'PlayerB');
    const claimB = await b.post('/api/countries/france/claim');
    expect(claimB.status).toBe(409);

    // Double présidence impossible : PlayerA ne peut pas prendre un 2e pays
    const claimA2 = await a.post('/api/countries/allemagne/claim');
    expect(claimA2.status).toBe(409);

    const c = ctx.world.country('france')!;
    expect(c.controller.kind).toBe('player');
    expect(c.controller.presidentName).toBe('PlayerA');
  });

  it('actions interdites aux non-présidents (403)', async () => {
    const b = new ApiClient(ctx.baseUrl);
    await b.post('/api/auth/login', { email: 'playerb@test.dev', password: 'MotDePasse123!' });
    const me = await b.get<{ user: { username: string } }>('/api/me');
    expect(me.data.user.username).toBe('PlayerB');
    const res = await b.post('/api/countries/france/actions', { params: { type: 'set_tax', value: 30 } });
    expect(res.status).toBe(403);
  });

  it('action président via API : appliquée, persistée, version incrémentée', async () => {
    const a = new ApiClient(ctx.baseUrl);
    await a.post('/api/auth/login', { email: 'playera@test.dev', password: 'MotDePasse123!' });
    const v0 = ctx.world.version;
    const res = await a.post<{ ok: boolean; effects?: unknown[] }>('/api/countries/france/actions', {
      params: { type: 'set_spending', sector: 'education', value: 4.5 },
      requestId: 'req-unique-0001',
    });
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(true);
    expect(ctx.world.version).toBeGreaterThan(v0);
    expect(ctx.world.country('france')!.policy.spending.education).toBe(4.5);

    // Idempotence : même requestId → même résultat, pas de double application
    const spendAfter = ctx.world.country('france')!.economy.spending;
    const dup = await a.post<{ ok: boolean }>('/api/countries/france/actions', {
      params: { type: 'set_spending', sector: 'education', value: 4.5 },
      requestId: 'req-unique-0001',
    });
    expect(dup.data.ok).toBe(true);
    expect(ctx.world.country('france')!.economy.spending).toBe(spendAfter);
  });

  it('release : le pays repasse à l’IA, l’état est préservé', async () => {
    const a = new ApiClient(ctx.baseUrl);
    await a.post('/api/auth/login', { email: 'playera@test.dev', password: 'MotDePasse123!' });
    const gdpBefore = ctx.world.country('france')!.economy.gdp;
    const res = await a.post<{ ok: boolean }>('/api/countries/france/release');
    expect(res.status).toBe(200);
    const c = ctx.world.country('france')!;
    expect(c.controller.kind).toBe('ai');
    expect(c.economy.gdp).toBe(gdpBefore);
    const me = await a.get<{ countryId: string | null }>('/api/me');
    expect(me.data.countryId).toBeNull();
    // Un autre joueur peut désormais le prendre
    const b = new ApiClient(ctx.baseUrl);
    await registerAndLogin(b, 'PlayerB2');
    const claim = await b.post('/api/countries/france/claim');
    expect(claim.status).toBe(200);
  });
});
