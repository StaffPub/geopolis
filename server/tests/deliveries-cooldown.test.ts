/**
 * Tests v1.12 : livraisons exceptionnelles avec ACCEPTATION obligatoire
 * (flux API complet joueur → joueur), cooldown de retour de 4 jours réels
 * après avoir quitté un pays, et nouveaux outils admin (expulsion, octroi
 * de ressources/trésorerie, purge de cooldown).
 * IMPORTANT : ADMIN_EMAIL est défini AVANT l'import des modules serveur.
 */
process.env.ADMIN_EMAIL = 'root@geopolis.test';
process.env.SESSION_SECRET = 'test-secret';

const { describe, it, expect, beforeAll, afterAll } = await import('vitest');
const { ApiClient, createTestContext, registerAndLogin } = await import('./helpers.js');
type TestContext = Awaited<ReturnType<typeof createTestContext>>;

describe('Livraisons exceptionnelles — acceptation obligatoire (v1.12)', () => {
  let ctx: TestContext;
  let shipA: ApiClient;
  let shipB: ApiClient;

  beforeAll(async () => {
    ctx = await createTestContext();
    shipA = new ApiClient(ctx.baseUrl);
    await registerAndLogin(shipA, 'Expedito');
    shipB = new ApiClient(ctx.baseUrl);
    await registerAndLogin(shipB, 'Recepto');
    await shipA.post('/api/countries/france/claim');
    await shipB.post('/api/countries/usa/claim');
    // Relations bilatérales suffisantes pour expédier
    const france = ctx.world.country('france')!;
    const usa = ctx.world.country('usa')!;
    france.relations['usa']!.score = 70;
    usa.relations['france']!.score = 70;
    france.resources.industrial.stock = 500;
    usa.resources.industrial.capacity = Math.max(usa.resources.industrial.capacity, 2000);
    usa.resources.industrial.stock = 20;
    usa.economy.cash = 1000;
    france.economy.cash = 100;
    ctx.world.markDirty('france');
    ctx.world.markDirty('usa');
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('ship_goods met la livraison en attente : rien n’est livré ni payé immédiatement', async () => {
    const usa = ctx.world.country('usa')!;
    const stockUsa = usa.resources.industrial.stock;
    const cashUsa = usa.economy.cash;
    const res = await shipA.post<{ ok: boolean; message?: string }>('/api/countries/france/actions', {
      params: { type: 'ship_goods', toId: 'usa', resource: 'industrial', units: 40, corridorId: 'auto' },
    });
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(true);
    expect(res.data.message).toMatch(/attente d'acceptation/i);
    // Destinataire : rien n'a bougé
    expect(usa.resources.industrial.stock).toBe(stockUsa);
    expect(usa.economy.cash).toBe(cashUsa);
    // Livraison en attente visible via l'API
    const list = await shipB.get<{ deliveries: { id: string; fromId: string; toId: string; units: number; value: number }[] }>('/api/world/deliveries?country=usa');
    expect(list.status).toBe(200);
    expect(list.data.deliveries).toHaveLength(1);
    expect(list.data.deliveries[0]!.fromId).toBe('france');
    expect(list.data.deliveries[0]!.units).toBeCloseTo(40, 0);
  });

  it('le destinataire joueur reçoit une notification actionnable respond_delivery', async () => {
    const notifs = await shipB.get<{ notifications: { type: string; title: string; action?: { kind: string; deliveryId: string } }[] }>('/api/notifications');
    const d = notifs.data.notifications.find((n) => n.action?.kind === 'respond_delivery');
    expect(d, 'aucune notification de livraison actionnable').toBeDefined();
    expect(d!.title).toMatch(/acceptation/i);
  });

  it('acceptation : le destinataire est débité et reçoit les ressources (conservation monétaire)', async () => {
    const france = ctx.world.country('france')!;
    const usa = ctx.world.country('usa')!;
    const list = await shipB.get<{ deliveries: { id: string; value: number; toll: number; freight: number }[] }>('/api/world/deliveries?country=usa');
    const d = list.data.deliveries[0]!;
    const cashUsa = usa.economy.cash;
    const cashFr = france.economy.cash;
    const stockUsa = usa.resources.industrial.stock;
    const res = await shipB.post<{ ok: boolean }>('/api/countries/usa/actions', {
      params: { type: 'respond_delivery', deliveryId: d.id, accept: true },
    });
    expect(res.data.ok).toBe(true);
    // Le destinataire PAIE la valeur et REÇOIT les ressources
    expect(usa.economy.cash).toBeCloseTo(cashUsa - d.value, 1);
    expect(usa.resources.industrial.stock).toBeCloseTo(stockUsa + 40, 0);
    // L'expéditeur encaisse valeur − péages − fret (jamais plus que ce que l'autre paie)
    expect(france.economy.cash).toBeCloseTo(cashFr + d.value - d.toll - d.freight, 1);
    expect(ctx.world.pendingDeliveries).toHaveLength(0);
  });

  it('refus : la marchandise retourne à l’expéditeur, aucun transfert d’argent', async () => {
    const france = ctx.world.country('france')!;
    const usa = ctx.world.country('usa')!;
    france.resources.industrial.stock = 300;
    const stockFr = france.resources.industrial.stock;
    const cashFr = france.economy.cash;
    const cashUsa = usa.economy.cash;
    const stockUsa = usa.resources.industrial.stock;
    const ship = await shipA.post<{ ok: boolean }>('/api/countries/france/actions', {
      params: { type: 'ship_goods', toId: 'usa', resource: 'industrial', units: 30, corridorId: 'auto' },
    });
    expect(ship.data.ok).toBe(true);
    expect(france.resources.industrial.stock).toBeCloseTo(stockFr - 30, 0); // réservé
    const list = await shipB.get<{ deliveries: { id: string }[] }>('/api/world/deliveries?country=usa');
    const refuse = await shipB.post<{ ok: boolean }>('/api/countries/usa/actions', {
      params: { type: 'respond_delivery', deliveryId: list.data.deliveries[0]!.id, accept: false },
    });
    expect(refuse.data.ok).toBe(true);
    expect(france.resources.industrial.stock).toBeCloseTo(stockFr, 0); // retour intégral
    expect(usa.resources.industrial.stock).toBe(stockUsa);
    expect(france.economy.cash).toBe(cashFr);
    expect(usa.economy.cash).toBe(cashUsa);
  });

  it('un tiers ne peut pas répondre à une livraison qui ne lui est pas destinée', async () => {
    const ship = await shipA.post<{ ok: boolean }>('/api/countries/france/actions', {
      params: { type: 'ship_goods', toId: 'usa', resource: 'industrial', units: 10, corridorId: 'auto' },
    });
    expect(ship.data.ok).toBe(true);
    const list = await shipB.get<{ deliveries: { id: string }[] }>('/api/world/deliveries?country=usa');
    const id = list.data.deliveries[0]!.id;
    // L'expéditeur lui-même ne peut pas « accepter » à la place du destinataire
    const hack = await shipA.post<{ ok: boolean; error?: string }>('/api/countries/france/actions', {
      params: { type: 'respond_delivery', deliveryId: id, accept: true },
    });
    expect(hack.data.ok).toBe(false);
    expect(hack.data.error).toMatch(/destinée/i);
    // Nettoyage : le destinataire refuse
    await shipB.post('/api/countries/usa/actions', { params: { type: 'respond_delivery', deliveryId: id, accept: false } });
  });

  it('plafond de livraisons en attente par expéditeur', async () => {
    const france = ctx.world.country('france')!;
    france.resources.industrial.stock = 600;
    for (let i = 0; i < 3; i++) {
      const r = await shipA.post<{ ok: boolean }>('/api/countries/france/actions', {
        params: { type: 'ship_goods', toId: 'usa', resource: 'industrial', units: 10, corridorId: 'auto' },
      });
      expect(r.data.ok).toBe(true);
    }
    const tooMany = await shipA.post<{ ok: boolean; error?: string }>('/api/countries/france/actions', {
      params: { type: 'ship_goods', toId: 'usa', resource: 'industrial', units: 10, corridorId: 'auto' },
    });
    expect(tooMany.data.ok).toBe(false);
    expect(tooMany.data.error).toMatch(/attente d'acceptation/i);
    // Le destinataire refuse tout pour nettoyer
    const list = await shipB.get<{ deliveries: { id: string }[] }>('/api/world/deliveries?country=usa');
    for (const d of list.data.deliveries) {
      await shipB.post('/api/countries/usa/actions', { params: { type: 'respond_delivery', deliveryId: d.id, accept: false } });
    }
    expect(ctx.world.pendingDeliveries).toHaveLength(0);
  });

  it('audit de cohérence : livraisons, offres et transactions vérifiées par validateWorld', async () => {
    // Monde sain : aucune anomalie remontée (l’audit tourne aussi côté admin)
    expect(ctx.engine.validateWorld()).toEqual([]);
    const france = ctx.world.country('france')!;
    france.resources.industrial.stock = 300;
    const ship = await shipA.post<{ ok: boolean }>('/api/countries/france/actions', {
      params: { type: 'ship_goods', toId: 'usa', resource: 'industrial', units: 10, corridorId: 'auto' },
    });
    expect(ship.data.ok).toBe(true);
    expect(ctx.engine.validateWorld()).toEqual([]);
    // Corruption volontaire d'une livraison en attente → détection garantie
    const d = ctx.world.pendingDeliveries[0]!;
    const valeurSaine = d.value;
    d.value = -5;
    expect(ctx.engine.validateWorld().some((p) => p.includes('valeur invalide'))).toBe(true);
    d.value = valeurSaine;
    expect(ctx.engine.validateWorld()).toEqual([]);
    // Nettoyage : refus du destinataire
    await shipB.post('/api/countries/usa/actions', { params: { type: 'respond_delivery', deliveryId: d.id, accept: false } });
    expect(ctx.world.pendingDeliveries).toHaveLength(0);
  });
});

describe('Cooldown de retour — 4 jours réels après avoir quitté un pays', () => {
  let ctx: TestContext;
  let admin: ApiClient;
  let player: ApiClient;

  beforeAll(async () => {
    ctx = await createTestContext();
    admin = new ApiClient(ctx.baseUrl);
    await registerAndLogin(admin, 'LeRoot', 'root@geopolis.test');
    player = new ApiClient(ctx.baseUrl);
    await registerAndLogin(player, 'Voyageur');
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('release → claim immédiat refusé (409) avec le délai restant', async () => {
    const claim = await player.post<{ ok: boolean }>('/api/countries/italie/claim');
    expect(claim.status).toBe(200);
    const rel = await player.post<{ ok: boolean; cooldownUntil?: number }>('/api/countries/italie/release');
    expect(rel.data.ok).toBe(true);
    expect(rel.data.cooldownUntil).toBeGreaterThan(Date.now());
    // /me expose le cooldown
    const me = await player.get<{ user: { countryCooldownUntil: number | null } }>('/api/me');
    expect(me.data.user.countryCooldownUntil).toBeGreaterThan(Date.now());
    // Claim immédiat → 409
    const reClaim = await player.post<{ error?: string }>('/api/countries/grece/claim');
    expect(reClaim.status).toBe(409);
    expect(reClaim.data.error).toMatch(/cooldown|jours? réels|j \d|quitté/i);
  });

  it('un AUTRE joueur n’est pas affecté par le cooldown', async () => {
    const other = new ApiClient(ctx.baseUrl);
    await registerAndLogin(other, 'AutreJoueur');
    const claim = await other.post<{ ok: boolean }>('/api/countries/italie/claim');
    expect(claim.status).toBe(200);
  });

  it('admin : purge du cooldown → claim possible immédiatement', async () => {
    const users = await admin.get<{ users: { id: string; username: string }[] }>('/api/admin/users');
    const target = users.data.users.find((u) => u.username === 'Voyageur')!;
    const clear = await admin.post<{ ok: boolean }>(`/api/admin/users/${target.id}/clear-cooldown`);
    expect(clear.data.ok).toBe(true);
    const claim = await player.post<{ ok: boolean }>('/api/countries/grece/claim');
    expect(claim.status).toBe(200);
  });

  it('admin : expulsion d’un joueur → IA + cooldown + claim refusé', async () => {
    // Le joueur Voyageur dirige grece ; un admin l'exclut
    const expel = await admin.post<{ ok: boolean; cooldownUntil: number | null }>('/api/admin/countries/grece/expel');
    expect(expel.data.ok).toBe(true);
    expect(expel.data.cooldownUntil).toBeGreaterThan(Date.now());
    const c = ctx.world.country('grece')!;
    expect(c.controller.kind).toBe('ai');
    // Le joueur exclu ne peut pas reprendre un pays tout de suite
    const claim = await player.post<{ error?: string }>('/api/countries/turquie/claim');
    expect(claim.status).toBe(409);
    // Expulser un pays déjà IA → 400
    const bad = await admin.post('/api/admin/countries/grece/expel');
    expect(bad.status).toBe(400);
  });
});

describe('Admin — octroi de ressources et de trésorerie (deltas)', () => {
  let ctx: TestContext;
  let admin: ApiClient;

  beforeAll(async () => {
    ctx = await createTestContext();
    admin = new ApiClient(ctx.baseUrl);
    await registerAndLogin(admin, 'LeRoot2', 'root@geopolis.test');
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('grant : trésorerie, ressources, popularité — positifs et négatifs, bornés', async () => {
    const grece = ctx.world.country('grece')!;
    const cash0 = grece.economy.cash;
    grece.resources.food.capacity = 5000;
    grece.resources.food.stock = 200;
    const food0 = 200;
    const pop0 = grece.popularity;
    const res = await admin.post<{ ok: boolean; applied: string[] }>('/api/admin/countries/grece/grant', {
      cash: 50,
      resources: { food: 120 },
      popularity: 5,
    });
    expect(res.data.ok).toBe(true);
    expect(grece.economy.cash).toBeCloseTo(cash0 + 50, 1);
    expect(grece.resources.food.stock).toBeCloseTo(food0 + 120, 0);
    expect(grece.popularity).toBeCloseTo(Math.min(100, pop0 + 5), 0);
    // Retrait
    const res2 = await admin.post<{ ok: boolean }>('/api/admin/countries/grece/grant', { cash: -20, resources: { food: -60 } });
    expect(res2.data.ok).toBe(true);
    expect(grece.economy.cash).toBeCloseTo(cash0 + 30, 1);
    expect(grece.resources.food.stock).toBeCloseTo(food0 + 60, 0);
    // Les stocks ne peuvent pas devenir négatifs ni dépasser la capacité
    await admin.post('/api/admin/countries/grece/grant', { resources: { food: -100000 } });
    expect(grece.resources.food.stock).toBe(0);
    await admin.post('/api/admin/countries/grece/grant', { resources: { food: 100000 } });
    expect(grece.resources.food.stock).toBeLessThanOrEqual(grece.resources.food.capacity);
  });

  it('grant : deltas nuls refusés, route protégée des non-admins', async () => {
    const empty = await admin.post('/api/admin/countries/grece/grant', {});
    expect(empty.status).toBe(400);
    const normal = new ApiClient(ctx.baseUrl);
    await registerAndLogin(normal, 'Quidam');
    const forbidden = await normal.post('/api/admin/countries/grece/grant', { cash: 1000 });
    expect(forbidden.status).toBe(403);
    const expelForbidden = await normal.post('/api/admin/countries/grece/expel');
    expect(expelForbidden.status).toBe(403);
  });
});
