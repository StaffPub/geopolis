/**
 * GEOPOLIS — API REST.
 * Toutes les routes sensibles vérifient l'authentification ET les permissions
 * côté serveur. Le client ne fait que demander ; le serveur valide, applique,
 * persiste puis diffuse (via le hub temps réel).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { ActionParams, Country, GameNotification } from 'shared';
import { LAWS, INFRA, AGREEMENT_TYPES, SPENDING_SECTORS, RESOURCE_KEYS, FACILITIES, REGIMES, COUNTRY_JOIN_COOLDOWN_MS } from 'shared';
import { createLogger } from '../logger.js';
import { hashPassword, isAdminUser, normalizeEmail, resolveRole, toPublicUser, verifyPassword, cookieOptions, SESSION_COOKIE, sessionSecret, type AuthenticatedRequest } from '../auth/auth.js';
import { rateLimit } from '../util/ratelimit.js';
import { clamp, round } from '../util/core.js';
import type { Repositories } from '../storage/index.js';
import type { WorldStore } from '../world/world.js';
import type { RealtimeHub } from '../realtime/hub.js';
import type { WorldSimulationEngine } from '../simulation/engine.js';
import { aiPresidentName } from '../simulation/engine.js';
import { executeAction, estimateAction, allActionTypes } from '../actions/registry.js';
import { sanitizeCountry } from '../world/integrity.js';

const log = createLogger('API');

/** Identifiant de boot du processus : permet au client de détecter un
 *  redéploiement (nouveau bundle) et de proposer un rechargement propre. */
const BOOT_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export interface ApiDeps {
  world: WorldStore;
  repos: Repositories;
  hub: RealtimeHub;
  engine: WorldSimulationEngine;
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
function ah(fn: AsyncHandler) {
  return (req: Request, res: Response): void => {
    fn(req, res).catch((e) => {
      log.error(`Erreur route ${req.method} ${req.path}`, e instanceof Error ? e.stack : String(e));
      if (!res.headersSent) res.status(500).json({ error: 'Erreur interne du serveur' });
    });
  };
}

/* ------------------------------- Schémas zod ------------------------------- */

const registerSchema = z.object({
  username: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_.\- ]+$/, 'Caractères autorisés : lettres, chiffres, . _ - espace'),
  email: z.string().email().max(160),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(1).max(128),
});

const FACILITY_KEYS = FACILITIES.map((f) => f.key) as [import('shared').FacilityKey, ...import('shared').FacilityKey[]];
const INFRA_KEYS = INFRA.map((i) => i.key) as [import('shared').InfraKey, ...import('shared').InfraKey[]];
const REGIME_IDS = REGIMES.map((r) => r.id) as [import('shared').RegimeType, ...import('shared').RegimeType[]];

const actionParamsSchema: z.ZodType<ActionParams> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_tax'), value: z.number() }),
  z.object({ type: z.literal('set_corporate_tax'), value: z.number() }),
  z.object({ type: z.literal('set_tariff'), value: z.number(), partnerId: z.string().optional() }),
  z.object({ type: z.literal('set_interest_rate'), value: z.number() }),
  z.object({ type: z.literal('set_spending'), sector: z.enum(['health', 'education', 'transport', 'energy', 'industry', 'agriculture', 'research', 'social']), value: z.number() }),
  z.object({ type: z.literal('start_project'), infra: z.enum(INFRA_KEYS) }),
  z.object({ type: z.literal('cancel_project'), projectId: z.string() }),
  z.object({ type: z.literal('enact_law'), lawId: z.string() }),
  z.object({ type: z.literal('repeal_law'), lawId: z.string() }),
  z.object({ type: z.literal('propose_agreement'), targetId: z.string(), agreementType: z.enum(['free_trade', 'economic_treaty', 'tech_cooperation', 'trade_zone', 'aid_pact']) }),
  z.object({ type: z.literal('respond_proposal'), proposalId: z.string(), accept: z.boolean() }),
  z.object({ type: z.literal('improve_relations'), targetId: z.string() }),
  z.object({ type: z.literal('send_aid'), targetId: z.string(), amount: z.number() }),
  z.object({ type: z.literal('impose_sanction'), targetId: z.string() }),
  z.object({ type: z.literal('lift_sanction'), targetId: z.string() }),
  z.object({ type: z.literal('buy_resource'), resource: z.enum(RESOURCE_KEYS as [ResourceKeySchema, ...ResourceKeySchema[]]), units: z.number() }),
  z.object({ type: z.literal('buy_corridor'), corridorId: z.string().min(3).max(40) }),
  z.object({ type: z.literal('abandon_corridor'), corridorId: z.string().min(3).max(40) }),
  z.object({ type: z.literal('set_toll'), corridorId: z.string().min(3).max(40), value: z.number() }),
  z.object({ type: z.literal('ship_goods'), toId: z.string().min(2).max(40), resource: z.enum(RESOURCE_KEYS as [ResourceKeySchema, ...ResourceKeySchema[]]), units: z.number(), corridorId: z.string().min(3).max(40) }),
  z.object({ type: z.literal('respond_delivery'), deliveryId: z.string().min(2).max(60), accept: z.boolean() }),
  z.object({ type: z.literal('break_agreement'), agreementId: z.string().min(3).max(80) }),
  z.object({ type: z.literal('set_route'), partnerId: z.string().min(2).max(40), pathId: z.string().min(3).max(120) }),
  z.object({ type: z.literal('set_production'), resource: z.enum(RESOURCE_KEYS as [ResourceKeySchema, ...ResourceKeySchema[]]), mode: z.enum(['boost', 'normal', 'slow']) }),
  z.object({ type: z.literal('buy_from_country'), sellerId: z.string().min(2).max(40), resource: z.enum(RESOURCE_KEYS as [ResourceKeySchema, ...ResourceKeySchema[]]), units: z.number() }),
  z.object({ type: z.literal('create_offer'), resource: z.enum(RESOURCE_KEYS as [ResourceKeySchema, ...ResourceKeySchema[]]), units: z.number(), unitPrice: z.number() }),
  z.object({ type: z.literal('cancel_offer'), offerId: z.string().min(2).max(60) }),
  z.object({ type: z.literal('buy_offer'), offerId: z.string().min(2).max(60) }),
  z.object({ type: z.literal('build_facility'), facility: z.enum(FACILITY_KEYS), count: z.number().int().min(1).max(5) }),
  z.object({ type: z.literal('change_regime'), regime: z.enum(REGIME_IDS) }),
]);
type ResourceKeySchema = (typeof RESOURCE_KEYS)[number];

const actionBodySchema = z.object({
  params: actionParamsSchema,
  requestId: z.string().min(4).max(64).optional(),
});

const adminVariablesSchema = z.object({
  cash: z.number().min(0).optional(),
  debt: z.number().min(0).optional(),
  gdp: z.number().min(1).optional(),
  population: z.number().min(0.1).optional(),
  popularity: z.number().min(0).max(100).optional(),
  stability: z.number().min(0).max(100).optional(),
  inflation: z.number().min(-5).max(60).optional(),
  unemployment: z.number().min(0).max(40).optional(),
  growth: z.number().min(-10).max(15).optional(),
  taxRate: z.number().min(0).max(60).optional(),
});

/* ------------------------------- Idempotence ------------------------------- */

const recentRequests = new Map<string, { at: number; result: unknown }>();
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [k, v] of recentRequests) if (v.at < cutoff) recentRequests.delete(k);
}, 60_000).unref();

/* ------------------------------- Fabrique ------------------------------- */

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();
  const { world, repos, hub, engine } = deps;
  const secret = sessionSecret();

  const authed = (req: Request): AuthenticatedRequest => req as AuthenticatedRequest;

  async function audit(actorId: string | null, actorName: string, countryId: string | null, type: string, detail: string, result: 'ok' | 'rejected' | 'error', day = world.meta.day): Promise<void> {
    await repos.appendAudit({ actorId, actorName, countryId, type, detail, result, day }).catch((e) => log.warn('audit échoué', String(e)));
  }

  /* ------------------------------- Santé ------------------------------- */

  router.get('/health', ah(async (_req, res) => {
    const storageOk = await deps.repos.storage.health().catch(() => false);
    res.json({
      ok: true,
      storage: storageOk,
      storageKind: deps.repos.storage.kind,
      engine: engine.status,
      worldVersion: world.version,
      nations: world.countries.size,
      time: Date.now(),
      bootId: BOOT_ID,
    });
  }));

  /* ------------------------------- Auth ------------------------------- */

  router.post('/auth/register', ah(async (req, res) => {
    const ip = req.ip ?? 'unknown';
    if (!rateLimit(`register:${ip}`, 25, 10 * 60_000)) {
      res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
      return;
    }
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Données invalides' });
      return;
    }
    const { username, password } = parsed.data;
    const email = normalizeEmail(parsed.data.email);
    if (await repos.getUserByEmail(email)) {
      res.status(409).json({ error: 'Un compte existe déjà avec cet email' });
      return;
    }
    if (await repos.getUserByUsername(username)) {
      res.status(409).json({ error: 'Ce pseudo est déjà utilisé' });
      return;
    }
    const passwordHash = await hashPassword(password);
    const user = await repos.createUser({ username, email, passwordHash, role: resolveRole(email) });
    const { token } = await repos.createSession(user.id, secret);
    res.cookie(SESSION_COOKIE, token, cookieOptions());
    user.lastLoginAt = Date.now();
    await repos.updateUser(user);
    await audit(user.id, user.username, null, 'register', 'Création de compte', 'ok');
    log.info(`Nouveau compte : ${user.username} (${user.email})${user.role === 'admin' ? ' — ADMIN' : ''}`);
    res.status(201).json({ user: toPublicUser(user) });
  }));

  router.post('/auth/login', ah(async (req, res) => {
    const ip = req.ip ?? 'unknown';
    if (!rateLimit(`login:${ip}`, 12, 10 * 60_000)) {
      res.status(429).json({ error: 'Trop de tentatives de connexion. Réessayez dans quelques minutes.' });
      return;
    }
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Email ou mot de passe invalide' });
      return;
    }
    const email = normalizeEmail(parsed.data.email);
    const user = await repos.getUserByEmail(email);
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      await audit(null, email, null, 'login', 'Échec authentification', 'rejected');
      res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      return;
    }
    if (user.suspended) {
      res.status(403).json({ error: 'Compte suspendu. Contactez un administrateur.' });
      return;
    }
    // Rôle admin déterminé côté serveur par ADMIN_EMAIL
    const role = resolveRole(user.email);
    if (role !== user.role) {
      user.role = role;
    }
    user.lastLoginAt = Date.now();
    await repos.updateUser(user);
    const { token } = await repos.createSession(user.id, secret);
    res.cookie(SESSION_COOKIE, token, cookieOptions());
    await audit(user.id, user.username, user.countryId, 'login', 'Connexion réussie', 'ok');
    res.json({ user: toPublicUser(user) });
  }));

  router.post('/auth/logout', ah(async (req, res) => {
    const r = authed(req);
    if (r.token) await repos.destroySession(r.token, secret);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  }));

  router.get('/me', ah(async (req, res) => {
    const r = authed(req);
    if (!r.user) {
      res.status(401).json({ error: 'Non authentifié' });
      return;
    }
    // Auto-guérison : si le compte pointe vers un pays qu'il ne contrôle plus
    // (monde reseedé, mandat perdu, crash partiel), on resynchronise le compte.
    if (r.user.countryId) {
      const c = world.country(r.user.countryId);
      if (!c || c.controller.kind !== 'player' || c.controller.userId !== r.user.id) {
        log.info(`Resync compte ${r.user.username} : countryId ${r.user.countryId} invalide → null`);
        r.user.countryId = null;
        await repos.updateUser(r.user);
      }
    }
    const notifications = await repos.listNotifications(r.user.id);
    res.json({
      user: toPublicUser(r.user),
      countryId: r.user.countryId,
      notifications,
      worldVersion: world.version,
    });
  }));

  router.patch('/me/password', ah(async (req, res) => {
    const r = authed(req);
    if (!r.user) { res.status(401).json({ error: 'Non authentifié' }); return; }
    const body = z.object({ current: z.string(), next: z.string().min(8).max(128) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }
    if (!(await verifyPassword(body.data.current, r.user.passwordHash))) {
      res.status(401).json({ error: 'Mot de passe actuel incorrect' });
      return;
    }
    r.user.passwordHash = await hashPassword(body.data.next);
    await repos.updateUser(r.user);
    await audit(r.user.id, r.user.username, r.user.countryId, 'password_change', 'Mot de passe modifié', 'ok');
    res.json({ ok: true });
  }));

  /* ------------------------------- Monde (public) ------------------------------- */

  router.get('/world/snapshot', ah(async (_req, res) => {
    res.json(world.summary(hub.actorsCount()));
  }));

  router.get('/world/journal', ah(async (req, res) => {
    const limit = clamp(Number(req.query.limit ?? 60), 1, 200);
    const type = typeof req.query.type === 'string' ? req.query.type : null;
    const countryId = typeof req.query.country === 'string' ? req.query.country : null;
    const search = typeof req.query.q === 'string' ? req.query.q.toLowerCase() : null;
    let entries = world.journal.slice(-limit * 4);
    if (type) entries = entries.filter((e) => e.type === type);
    if (countryId) entries = entries.filter((e) => e.countryIds.includes(countryId));
    if (search) entries = entries.filter((e) => e.text.toLowerCase().includes(search));
    res.json({ entries: entries.slice(-limit).reverse(), worldVersion: world.version });
  }));


  router.get('/world/market', ah(async (_req, res) => {
    res.json({ market: world.market, day: world.meta.day });
  }));

  router.get('/world/events', ah(async (_req, res) => {
    const events = world.activeEvents().map(({ event, country }) => ({ ...event, countryName: country.name }));
    res.json({ events, day: world.meta.day });
  }));

  router.get('/world/transactions', ah(async (req, res) => {
    const limit = clamp(Number(req.query.limit ?? 40), 1, 200);
    const countryId = typeof req.query.country === 'string' ? req.query.country : null;
    let txs = world.transactions;
    if (countryId) txs = txs.filter((t) => t.fromId === countryId || t.toId === countryId);
    res.json({ transactions: txs.slice(-limit).reverse() });
  }));

  router.get('/world/presence', ah(async (_req, res) => {
    res.json({ presence: hub.presenceList(), actors: hub.actorsCount() });
  }));

  router.get('/world/routes', ah(async (req, res) => {
    const countryId = typeof req.query.country === 'string' ? req.query.country : null;
    let routes = [...world.routes.values()];
    if (countryId) routes = routes.filter((r) => r.fromId === countryId || r.toId === countryId);
    res.json({ routes: routes.sort((a, b) => b.value - a.value).slice(0, 300) });
  }));

  /** Combinaisons de routes possibles entre deux pays (+ sélection actuelle). */
  router.get('/world/route-options', ah(async (req, res) => {
    const fromId = typeof req.query.from === 'string' ? req.query.from : null;
    const toId = typeof req.query.to === 'string' ? req.query.to : null;
    const a = fromId ? world.country(fromId) : undefined;
    const b = toId ? world.country(toId) : undefined;
    if (!a || !b || a.id === b.id) {
      res.status(400).json({ error: 'Pays invalides' });
      return;
    }
    const { routeOptions } = await import('../simulation/trade.js');
    // Les anciennes préférences « direct » (voies directes supprimées) redeviennent « auto ».
    const pref = a.routePrefs[b.id];
    const selected = pref && pref !== 'direct' ? pref : 'auto';
    if (pref === 'direct') a.routePrefs[b.id] = 'auto';
    res.json({ options: routeOptions(world, a, b), selected });
  }));

  /** Routes commerciales stratégiques (corridors) : propriété, péages, trafic. */
  router.get('/world/corridors', ah(async (_req, res) => {
    res.json({ corridors: [...world.corridors.values()], day: world.meta.day });
  }));

  /** Marché inter-états : offres de vente ouvertes (onglet Ressources). */
  router.get('/world/offers', ah(async (_req, res) => {
    res.json({ offers: world.openOffers(), day: world.meta.day, revision: world.offersRevision });
  }));

  /** Livraisons exceptionnelles en attente d'acceptation (onglet Commerce).
   *  Filtrées sur un pays : envois en cours + réceptions à accepter. */
  router.get('/world/deliveries', ah(async (req, res) => {
    const countryId = typeof req.query.country === 'string' ? req.query.country : null;
    const deliveries = countryId ? world.deliveriesFor(countryId) : world.pendingDeliveries;
    res.json({ deliveries, day: world.meta.day, revision: world.deliveriesRevision });
  }));

  /** Vendeurs bilatéraux d'une ressource : disponibilités réelles + éligibilité. */
  router.get('/world/resource-sellers', ah(async (req, res) => {
    const resource = String(req.query.resource ?? '') as import('shared').ResourceKey;
    if (!RESOURCE_KEYS.includes(resource)) {
      res.status(400).json({ error: 'Ressource inconnue' });
      return;
    }
    const meId = typeof req.query.me === 'string' ? req.query.me : null;
    const me = meId ? world.country(meId) : null;
    const sellers = world.allCountries()
      .filter((c) => c.id !== meId)
      .map((c) => {
        const r = c.resources[resource];
        const available = Math.max(0, Math.min(r.stock - r.capacity * 0.35, r.stock * 0.4));
        const rel = me?.relations[c.id];
        const sanction = !!(rel && (rel.sanctionByUs || rel.sanctionByThem || c.relations[me!.id]?.sanctionByUs || c.relations[me!.id]?.sanctionByThem));
        const agreement = !!rel?.agreements.some((a) => a.status === 'active');
        const playerOwned = c.controller.kind === 'player';
        const eligible = available >= 1 && !sanction && !playerOwned && (!!rel && (rel.score >= 30 || agreement));
        return {
          id: c.id, name: c.name, code: c.code, color: c.color, region: c.region,
          playerOwned,
          available: Math.floor(available),
          price: round(r.price, 3),
          rel: Math.round(rel?.score ?? 0),
          sanction,
          eligible,
        };
      })
      .filter((s) => s.available >= 1)
      .sort((a, b) => a.price - b.price);
    res.json({ sellers, worldPrice: world.market[resource]?.price ?? 0, day: world.meta.day });
  }));

  /** Métriques légères pour les modes d'affichage de la carte mondiale. */
  router.get('/world/map-metrics', ah(async (_req, res) => {
    const perCountry: Record<string, {
      stocks: Record<string, number>;
      infraAvg: number;
      tradeByPartner: Record<string, number>;
      relations: Record<string, number>;
      production: Record<string, number>;
    }> = {};
    for (const c of world.allCountries()) {
      const stocks: Record<string, number> = {};
      const production: Record<string, number> = {};
      for (const [k, r] of Object.entries(c.resources)) {
        stocks[k] = r.capacity > 0 ? Math.min(1, r.stock / r.capacity) : 0;
        production[k] = r.production;
      }
      const infraLevels = Object.values(c.infra).map((i) => i.level);
      const tradeByPartner: Record<string, number> = {};
      const relations: Record<string, number> = {};
      for (const [oid, rel] of Object.entries(c.relations)) {
        relations[oid] = Math.round(rel.score);
        if (rel.tradeVolume > 0.001) tradeByPartner[oid] = round(rel.tradeVolume, 3);
      }
      perCountry[c.id] = {
        stocks,
        infraAvg: infraLevels.reduce((a, b) => a + b, 0) / Math.max(1, infraLevels.length),
        tradeByPartner,
        relations,
        production,
      };
    }
    res.json({ perCountry, day: world.meta.day, version: world.version });
  }));

  router.get('/meta/catalog', ah(async (_req, res) => {
    res.json({ laws: LAWS, infra: INFRA, agreements: AGREEMENT_TYPES, spending: SPENDING_SECTORS, actions: allActionTypes() });
  }));

  /* ------------------------------- Pays ------------------------------- */

  router.get('/countries', ah(async (_req, res) => {
    res.json({
      countries: world.allCountries().map((c) => world.publicCountry(c)),
      day: world.meta.day,
    });
  }));

  router.get('/countries/:id', ah(async (req, res) => {
    const c = world.country(req.params.id!);
    if (!c) { res.status(404).json({ error: 'Pays introuvable' }); return; }
    res.json({
      country: c,
      relationsSummary: hub.relationsSummary(c),
      worldVersion: world.version,
    });
  }));

  router.get('/countries/:id/history', ah(async (req, res) => {
    const c = world.country(req.params.id!);
    if (!c) { res.status(404).json({ error: 'Pays introuvable' }); return; }
    const limit = clamp(Number(req.query.limit ?? 80), 1, 300);
    res.json({ history: c.history.slice(-limit).reverse(), series: c.series.slice(-240) });
  }));

  /* ------------------------------- Choix / libération de pays ------------------------------- */

  router.post('/countries/:id/claim', ah(async (req, res) => {
    const r = authed(req);
    if (!r.user) { res.status(401).json({ error: 'Authentification requise' }); return; }
    if (!rateLimit(`claim:${r.user.id}`, 6, 60_000)) {
      res.status(429).json({ error: 'Trop de tentatives, réessayez dans une minute.' });
      return;
    }
    const c = world.country(req.params.id!);
    if (!c) { res.status(404).json({ error: 'Pays introuvable' }); return; }
    // Auto-guérison : un countryId fantôme (pays repassé à l'IA) ne bloque plus le claim
    if (r.user.countryId && r.user.countryId !== c.id) {
      const cur = world.country(r.user.countryId);
      if (!cur || cur.controller.kind !== 'player' || cur.controller.userId !== r.user.id) {
        r.user.countryId = null;
      }
    }
    // Contrôle exclusif : un pays dirigé par un joueur ne peut pas être pris
    if (c.controller.kind === 'player') {
      res.status(409).json({ error: `Ce pays est déjà dirigé par ${c.controller.presidentName}` });
      return;
    }
    if (r.user.countryId && r.user.countryId !== c.id) {
      res.status(409).json({ error: 'Vous dirigez déjà un pays. Libérez-le d’abord.' });
      return;
    }
    if (r.user.countryId === c.id) {
      res.json({ ok: true, countryId: c.id, already: true });
      return;
    }
    // Cooldown de retour : 4 jours RÉELS après avoir quitté un pays (release ou
    // expulsion admin) — empêche le « country hopping » et les abus de transfert.
    const cooldownUntil = r.user.countryCooldownUntil ?? 0;
    if (cooldownUntil > Date.now()) {
      const hours = Math.ceil((cooldownUntil - Date.now()) / 3600_000);
      const days = Math.floor(hours / 24);
      res.status(409).json({
        error: `Vous avez quitté un pays récemment : nouveau mandat possible dans ${days > 0 ? `${days} j ` : ''}${hours % 24} h (cooldown de 4 jours réels).`,
        cooldownUntil,
      });
      return;
    }
    const previousAiName = c.controller.presidentName;
    c.controller = { kind: 'player', userId: r.user.id, presidentName: r.user.username, since: Date.now(), sinceDay: world.meta.day };
    c.mandate = { lowPopularityTicks: 0, risk: 'faible', warningsSent: 0, popularityTrend: 0 };
    r.user.countryId = c.id;
    await repos.updateUser(r.user);
    world.addJournal({
      day: world.meta.day, type: 'mandate', countryIds: [c.id], actor: r.user.username,
      text: `${r.user.username} prend la tête de ${c.name} (succède au gouvernement IA « ${previousAiName} »).`,
    });
    world.touch(c.id);
    await world.save();
    await audit(r.user.id, r.user.username, c.id, 'claim_country', `Prise de contrôle de ${c.name}`, 'ok');
    hub.broadcast({ type: 'mandate_update', countryId: c.id, controllerKind: 'player', presidentName: r.user.username });
    hub.pushCountryUpdate(c.id);
    hub.refreshPresence();
    res.json({ ok: true, countryId: c.id });
  }));

  router.post('/countries/:id/release', ah(async (req, res) => {
    const r = authed(req);
    if (!r.user) { res.status(401).json({ error: 'Authentification requise' }); return; }
    const c = world.country(req.params.id!);
    if (!c) { res.status(404).json({ error: 'Pays introuvable' }); return; }
    // Cas nominal : le joueur dirige effectivement ce pays
    const isPresident = c.controller.kind === 'player' && c.controller.userId === r.user.id;
    // Cas désynchronisé (reseed admin, mandat perdu…) : le compte pointe vers un
    // pays qu'il ne contrôle plus → on nettoie au lieu de bloquer (plus de 403 piège)
    if (!isPresident) {
      if (c.controller.kind === 'player' && c.controller.userId !== r.user.id) {
        res.status(403).json({ error: 'Vous ne dirigez pas ce pays' });
        return;
      }
      if (r.user.countryId === c.id) {
        r.user.countryId = null;
        await repos.updateUser(r.user);
      }
      res.json({ ok: true, alreadyReleased: true });
      return;
    }
    const playerName = c.controller.presidentName;
    c.controller = { kind: 'ai', userId: null, presidentName: aiPresidentName(c.id), since: Date.now(), sinceDay: world.meta.day };
    c.mandate = { lowPopularityTicks: 0, risk: 'faible', warningsSent: 0, popularityTrend: 0 };
    r.user.countryId = null;
    // Cooldown de 4 jours RÉELS avant de pouvoir reprendre un pays (anti-abus :
    // impossible de sauter d'un pays à l'autre pour transférer de la valeur).
    r.user.countryCooldownUntil = Date.now() + COUNTRY_JOIN_COOLDOWN_MS;
    await repos.updateUser(r.user);
    world.addJournal({
      day: world.meta.day, type: 'mandate', countryIds: [c.id], actor: playerName,
      text: `${playerName} quitte la direction de ${c.name}. Un gouvernement IA reprend la main — l'État continue.`,
    });
    world.touch(c.id);
    await world.save();
    await audit(r.user.id, r.user.username, c.id, 'release_country', `Libération de ${c.name}`, 'ok');
    hub.broadcast({ type: 'mandate_update', countryId: c.id, controllerKind: 'ai', presidentName: c.controller.presidentName });
    hub.pushCountryUpdate(c.id);
    hub.refreshPresence();
    res.json({ ok: true, cooldownUntil: r.user.countryCooldownUntil });
  }));

  /* ------------------------------- Actions joueur ------------------------------- */

  function presidentGuard(req: Request, res: Response): Country | null {
    const r = authed(req);
    if (!r.user) {
      res.status(401).json({ error: 'Authentification requise' });
      return null;
    }
    const c = world.country(req.params.id!);
    if (!c) {
      res.status(404).json({ error: 'Pays introuvable' });
      return null;
    }
    if (c.controller.kind !== 'player' || c.controller.userId !== r.user.id) {
      res.status(403).json({ error: 'Seul le président de ce pays peut effectuer cette action' });
      return null;
    }
    return c;
  }

  router.post('/countries/:id/actions/estimate', ah(async (req, res) => {
    const c = presidentGuard(req, res);
    if (!c) return;
    const parsed = actionBodySchema.safeParse({ params: req.body?.params });
    if (!parsed.success) { res.status(400).json({ ok: false, error: 'Paramètres d’action invalides' }); return; }
    const result = estimateAction(world, c.id, parsed.data.params);
    res.json(result);
  }));

  router.post('/countries/:id/actions', ah(async (req, res) => {
    const r = authed(req);
    const c = presidentGuard(req, res);
    if (!c || !r.user) return;
    if (!rateLimit(`action:${r.user.id}`, 45, 60_000)) {
      res.status(429).json({ ok: false, error: 'Trop d’actions par minute. Le gouvernement doit souffler.' });
      return;
    }
    const parsed = actionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Paramètres d’action invalides' });
      return;
    }
    // Protection doubles actions : idempotence par requestId
    const requestId = parsed.data.requestId;
    if (requestId) {
      const cached = recentRequests.get(`${r.user.id}:${requestId}`);
      if (cached) {
        res.json(cached.result);
        return;
      }
    }
    const result = executeAction(world, c.id, parsed.data.params, {
      world,
      actor: { kind: 'player', name: r.user.username, userId: r.user.id },
      notify: (userId, n) => { void hub.notifyUser(userId, n as Omit<GameNotification, 'userId' | 'id' | 'ts' | 'read'>); },
      onBigWin: (bw) => {
        const g = world.country(bw.countryId);
        if (g && g.controller.kind === 'player' && g.controller.userId) {
          hub.sendBigWin(g.controller.userId, bw.amount, bw.source);
        }
      },
    });
    if (result.ok) {
      await world.save();
      await audit(r.user.id, r.user.username, c.id, `action:${parsed.data.params.type}`, JSON.stringify(parsed.data.params).slice(0, 300), 'ok');
      hub.pushCountryUpdate(c.id);
      hub.broadcast({ type: 'journal_update', entries: world.journal.slice(-3) });
      // Marché inter-états : resynchronisation immédiate de tous les clients
      if (['create_offer', 'cancel_offer', 'buy_offer'].includes(parsed.data.params.type)) {
        hub.broadcast({ type: 'offers_update', offers: world.openOffers() });
      }
      if (parsed.data.params.type === 'buy_from_country' || parsed.data.params.type === 'buy_offer') {
        const otherId = 'sellerId' in parsed.data.params ? parsed.data.params.sellerId : null;
        if (otherId) hub.pushCountryUpdate(otherId);
      }
      // Livraisons exceptionnelles : les deux pays et tous les clients à jour
      if (parsed.data.params.type === 'ship_goods') {
        const toId = 'toId' in parsed.data.params ? parsed.data.params.toId : null;
        if (toId) hub.pushCountryUpdate(toId);
        hub.broadcast({ type: 'deliveries_update', deliveries: world.pendingDeliveries });
      }
      if (parsed.data.params.type === 'respond_delivery') {
        const d = world.delivery('deliveryId' in parsed.data.params ? parsed.data.params.deliveryId : '');
        // d peut être déjà retirée (acceptée/refusée) : on rediffuse l'état complet
        void d;
        hub.broadcast({ type: 'deliveries_update', deliveries: world.pendingDeliveries });
        hub.broadcast({ type: 'transaction_update', transactions: world.transactions.slice(-12) });
      }
    } else {
      await audit(r.user.id, r.user.username, c.id, `action:${parsed.data.params.type}`, result.error ?? 'rejetée', 'rejected');
    }
    const payload = { ...result, version: world.version };
    if (requestId) recentRequests.set(`${r.user.id}:${requestId}`, { at: Date.now(), result: payload });
    res.json(payload);
  }));

  /* ------------------------------- Notifications ------------------------------- */

  router.get('/notifications', ah(async (req, res) => {
    const r = authed(req);
    if (!r.user) { res.status(401).json({ error: 'Non authentifié' }); return; }
    res.json({ notifications: await repos.listNotifications(r.user.id) });
  }));

  router.post('/notifications/:nid/read', ah(async (req, res) => {
    const r = authed(req);
    if (!r.user) { res.status(401).json({ error: 'Non authentifié' }); return; }
    await repos.markNotificationRead(r.user.id, req.params.nid!);
    res.json({ ok: true });
  }));

  router.post('/notifications/read-all', ah(async (req, res) => {
    const r = authed(req);
    if (!r.user) { res.status(401).json({ error: 'Non authentifié' }); return; }
    await repos.markAllNotificationsRead(r.user.id);
    res.json({ ok: true });
  }));

  /* ------------------------------- ADMIN ------------------------------- */

  const adminOnly = (req: Request, res: Response): boolean => {
    const r = authed(req);
    if (!r.user) { res.status(401).json({ error: 'Authentification requise' }); return false; }
    if (!isAdminUser(r.user)) {
      log.warn(`Accès admin refusé : ${r.user.email}`);
      res.status(403).json({ error: 'Droits administrateur requis' });
      return false;
    }
    return true;
  };

  router.get('/admin/overview', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const users = await repos.listUsers();
    const players = world.allCountries().filter((c) => c.controller.kind === 'player');
    const bots = world.allCountries().filter((c) => c.controller.kind === 'ai');
    res.json({
      users: users.length,
      usersSuspended: users.filter((u) => u.suspended).length,
      playersOnline: hub.presenceList().length,
      countriesControlled: players.length,
      botsActive: bots.length,
      engine: {
        ...engine.status,
        storage: repos.storage.kind,
        wsClients: hub.clientCount(),
        humansOnline: hub.actorsCount().humans,
        aiActive: hub.actorsCount().ai,
      },
      actors: hub.actorsCount(),
      worldVersion: world.version,
      nations: world.countries.size,
      lastError: world.meta.lastError,
      integrityIssues: world.meta.integrityIssues,
      routes: world.routes.size,
      events: world.activeEvents().length,
    });
  }));

  router.get('/admin/users', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const q = typeof req.query.q === 'string' ? req.query.q.toLowerCase() : '';
    let users = await repos.listUsers();
    if (q) users = users.filter((u) => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    res.json({ users: users.map(toPublicUser) });
  }));

  router.post('/admin/users/:uid/suspend', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const user = await repos.getUser(req.params.uid!);
    if (!user) { res.status(404).json({ error: 'Utilisateur introuvable' }); return; }
    user.suspended = true;
    await repos.updateUser(user);
    await audit(authed(req).user!.id, authed(req).user!.username, user.countryId, 'admin_suspend', `Suspension de ${user.username}`, 'ok');
    res.json({ ok: true, user: toPublicUser(user) });
  }));

  router.post('/admin/users/:uid/reactivate', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const user = await repos.getUser(req.params.uid!);
    if (!user) { res.status(404).json({ error: 'Utilisateur introuvable' }); return; }
    user.suspended = false;
    await repos.updateUser(user);
    await audit(authed(req).user!.id, authed(req).user!.username, user.countryId, 'admin_reactivate', `Réactivation de ${user.username}`, 'ok');
    res.json({ ok: true, user: toPublicUser(user) });
  }));

  router.post('/admin/users/:uid/delete', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const user = await repos.getUser(req.params.uid!);
    if (!user) { res.status(404).json({ error: 'Utilisateur introuvable' }); return; }
    if (isAdminUser(user)) { res.status(400).json({ error: 'Impossible de supprimer le compte administrateur actif' }); return; }
    // Le pays repasse à l'IA, jamais supprimé
    if (user.countryId) {
      const c = world.country(user.countryId);
      if (c && c.controller.userId === user.id) {
        c.controller = { kind: 'ai', userId: null, presidentName: aiPresidentName(c.id), since: Date.now(), sinceDay: world.meta.day };
        world.touch(c.id);
        await world.save();
        hub.broadcast({ type: 'mandate_update', countryId: c.id, controllerKind: 'ai', presidentName: c.controller.presidentName });
      }
    }
    await repos.deleteUser(user.id);
    await audit(authed(req).user!.id, authed(req).user!.username, user.countryId, 'admin_delete_user', `Suppression de ${user.username}`, 'ok');
    res.json({ ok: true });
  }));

  router.get('/admin/countries', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    res.json({
      countries: world.allCountries().map((c) => ({
        ...world.publicCountry(c),
        cash: round(c.economy.cash, 2),
        debt: round(c.economy.debt, 1),
        controllerUserId: c.controller.userId,
        aiStrategy: c.ai.personality.strategy,
        projects: c.projects.length,
        laws: c.laws.length,
        events: c.activeEvents.length,
      })),
    });
  }));

  router.post('/admin/countries/:id/force-ai', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const c = world.country(req.params.id!);
    if (!c) { res.status(404).json({ error: 'Pays introuvable' }); return; }
    const previousUserId = c.controller.userId;
    c.controller = { kind: 'ai', userId: null, presidentName: aiPresidentName(c.id), since: Date.now(), sinceDay: world.meta.day };
    if (previousUserId) {
      const user = await repos.getUser(previousUserId);
      if (user && user.countryId === c.id) {
        user.countryId = null;
        await repos.updateUser(user);
        await hub.notifyUser(user.id, { type: 'mandate', title: 'Fin de mandat (admin)', body: `Un administrateur a transféré ${c.name} au contrôle de l'IA.`, day: world.meta.day });
      }
    }
    world.addJournal({ day: world.meta.day, type: 'admin', countryIds: [c.id], actor: authed(req).user!.username, text: `Admin : ${c.name} repasse sous contrôle IA.` });
    world.touch(c.id);
    await world.save();
    await audit(authed(req).user!.id, authed(req).user!.username, c.id, 'admin_force_ai', 'Contrôle IA forcé', 'ok');
    hub.broadcast({ type: 'mandate_update', countryId: c.id, controllerKind: 'ai', presidentName: c.controller.presidentName });
    hub.pushCountryUpdate(c.id);
    res.json({ ok: true });
  }));

  /** EXCLUSION d'un joueur : le pays repasse à l'IA, le joueur est notifié et
   *  écope du cooldown de 4 jours réels avant tout nouveau mandat. */
  router.post('/admin/countries/:id/expel', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const c = world.country(req.params.id!);
    if (!c) { res.status(404).json({ error: 'Pays introuvable' }); return; }
    if (c.controller.kind !== 'player' || !c.controller.userId) {
      res.status(400).json({ error: 'Ce pays n’est pas dirigé par un joueur' });
      return;
    }
    const expelledUserId = c.controller.userId;
    const expelledName = c.controller.presidentName;
    c.controller = { kind: 'ai', userId: null, presidentName: aiPresidentName(c.id), since: Date.now(), sinceDay: world.meta.day };
    c.mandate = { lowPopularityTicks: 0, risk: 'faible', warningsSent: 0, popularityTrend: 0 };
    const user = await repos.getUser(expelledUserId);
    let cooldownUntil: number | null = null;
    if (user) {
      if (user.countryId === c.id) user.countryId = null;
      user.countryCooldownUntil = Date.now() + COUNTRY_JOIN_COOLDOWN_MS;
      cooldownUntil = user.countryCooldownUntil;
      await repos.updateUser(user);
      await hub.notifyUser(user.id, {
        type: 'mandate', title: 'Vous avez été exclu de votre pays',
        body: `Un administrateur a mis fin à votre mandat sur ${c.name}. Un gouvernement IA reprend la main. Vous pourrez reprendre un pays dans 4 jours réels.`,
        day: world.meta.day,
      });
    }
    world.addJournal({
      day: world.meta.day, type: 'admin', countryIds: [c.id], actor: authed(req).user!.username,
      text: `Admin : ${expelledName} est EXCLU de la direction de ${c.name} — un gouvernement IA reprend la main.`,
    });
    world.touch(c.id);
    await world.save();
    await audit(authed(req).user!.id, authed(req).user!.username, c.id, 'admin_expel', `Exclusion de ${expelledName} de ${c.name}`, 'ok');
    hub.broadcast({ type: 'mandate_update', countryId: c.id, controllerKind: 'ai', presidentName: c.controller.presidentName, reason: `${expelledName} a été exclu par un administrateur.` });
    hub.pushCountryUpdate(c.id);
    hub.refreshPresence();
    res.json({ ok: true, cooldownUntil });
  }));

  /** OCTROI admin : deltas de trésorerie, dette, popularité, stabilité et
   *  stocks de ressources d'un pays (donner OU retirer). Validé + borné. */
  router.post('/admin/countries/:id/grant', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const c = world.country(req.params.id!);
    if (!c) { res.status(404).json({ error: 'Pays introuvable' }); return; }
    const grantSchema = z.object({
      cash: z.number().min(-1_000_000).max(1_000_000).optional(),
      debt: z.number().min(-10_000_000).max(10_000_000).optional(),
      popularity: z.number().min(-100).max(100).optional(),
      stability: z.number().min(-100).max(100).optional(),
      resources: z.record(z.enum(RESOURCE_KEYS as [ResourceKeySchema, ...ResourceKeySchema[]]), z.number().min(-1_000_000).max(1_000_000)).optional(),
    });
    const body = grantSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Octroi invalide' }); return; }
    const v = body.data;
    const applied: string[] = [];
    if (v.cash !== undefined && v.cash !== 0) {
      c.economy.cash = round(Math.max(0, c.economy.cash + v.cash), 2);
      applied.push(`trésorerie ${v.cash >= 0 ? '+' : ''}${v.cash} Md €`);
    }
    if (v.debt !== undefined && v.debt !== 0) {
      c.economy.debt = round(Math.max(0, c.economy.debt + v.debt), 1);
      applied.push(`dette ${v.debt >= 0 ? '+' : ''}${v.debt} Md €`);
    }
    if (v.popularity !== undefined && v.popularity !== 0) {
      c.popularity = clamp(round(c.popularity + v.popularity, 1), 0, 100);
      applied.push(`popularité ${v.popularity >= 0 ? '+' : ''}${v.popularity}`);
    }
    if (v.stability !== undefined && v.stability !== 0) {
      c.stability = clamp(round(c.stability + v.stability, 1), 0, 100);
      applied.push(`stabilité ${v.stability >= 0 ? '+' : ''}${v.stability}`);
    }
    for (const [key, delta] of Object.entries(v.resources ?? {})) {
      if (!delta) continue;
      const r = c.resources[key as import('shared').ResourceKey];
      if (!r) continue;
      r.stock = clamp(round(r.stock + delta, 1), 0, r.capacity);
      applied.push(`${key} ${delta >= 0 ? '+' : ''}${delta} u`);
    }
    if (applied.length === 0) { res.status(400).json({ error: 'Rien à octroyer (tous les deltas sont nuls)' }); return; }
    const report = sanitizeCountry(c);
    world.addJournal({
      day: world.meta.day, type: 'admin', countryIds: [c.id], actor: authed(req).user!.username,
      text: `Admin : octroi à ${c.name} — ${applied.join(', ')}.`,
    });
    world.touch(c.id);
    await world.save();
    await audit(authed(req).user!.id, authed(req).user!.username, c.id, 'admin_grant', applied.join(', ').slice(0, 250), 'ok');
    hub.pushCountryUpdate(c.id);
    res.json({ ok: true, applied, corrections: report.issues });
  }));

  /** Purge le cooldown de retour d'un joueur (après exclusion ou release). */
  router.post('/admin/users/:uid/clear-cooldown', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const user = await repos.getUser(req.params.uid!);
    if (!user) { res.status(404).json({ error: 'Utilisateur introuvable' }); return; }
    user.countryCooldownUntil = null;
    await repos.updateUser(user);
    await audit(authed(req).user!.id, authed(req).user!.username, user.countryId, 'admin_clear_cooldown', `Cooldown purgé pour ${user.username}`, 'ok');
    res.json({ ok: true, user: toPublicUser(user) });
  }));

  router.post('/admin/countries/:id/president', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const c = world.country(req.params.id!);
    if (!c) { res.status(404).json({ error: 'Pays introuvable' }); return; }
    const body = z.object({ name: z.string().min(2).max(48) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Nom invalide' }); return; }
    if (c.controller.kind === 'player') { res.status(400).json({ error: 'Pays dirigé par un joueur : utilisez force-ai d’abord' }); return; }
    c.controller.presidentName = body.data.name;
    world.touch(c.id);
    await world.save();
    await audit(authed(req).user!.id, authed(req).user!.username, c.id, 'admin_set_president', body.data.name, 'ok');
    hub.pushCountryUpdate(c.id);
    res.json({ ok: true });
  }));

  router.patch('/admin/countries/:id/variables', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const c = world.country(req.params.id!);
    if (!c) { res.status(404).json({ error: 'Pays introuvable' }); return; }
    const body = adminVariablesSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Variables invalides' }); return; }
    const v = body.data;
    if (v.cash !== undefined) c.economy.cash = v.cash;
    if (v.debt !== undefined) c.economy.debt = v.debt;
    if (v.gdp !== undefined) c.economy.gdp = v.gdp;
    if (v.population !== undefined) c.population = v.population;
    if (v.popularity !== undefined) c.popularity = v.popularity;
    if (v.stability !== undefined) c.stability = v.stability;
    if (v.inflation !== undefined) c.economy.inflation = v.inflation;
    if (v.unemployment !== undefined) c.economy.unemployment = v.unemployment;
    if (v.growth !== undefined) c.economy.growth = v.growth;
    if (v.taxRate !== undefined) c.policy.taxRate = v.taxRate;
    const report = sanitizeCountry(c);
    world.touch(c.id);
    await world.save();
    await audit(authed(req).user!.id, authed(req).user!.username, c.id, 'admin_edit_variables', JSON.stringify(v).slice(0, 250), 'ok');
    hub.pushCountryUpdate(c.id);
    res.json({ ok: true, corrections: report.issues });
  }));

  router.get('/admin/simulation', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const problems = engine.validateWorld();
    const actors = hub.actorsCount();
    res.json({
      engine: {
        ...engine.status,
        storage: repos.storage.kind,
        wsClients: hub.clientCount(),
        humansOnline: actors.humans,
        aiActive: actors.ai,
      },
      meta: world.meta,
      actors,
      wsClients: hub.clientCount(),
      validation: problems.length === 0 ? 'OK' : problems.slice(0, 50),
      aiDecisions: await repos.listAiDecisions(30),
      recentAudit: (await repos.listAudit()).slice(-30).reverse(),
    });
  }));

  router.post('/admin/simulation/tick', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const body = z.object({ n: z.number().int().min(1).max(10).default(1) }).safeParse(req.body ?? {});
    if (!body.success) { res.status(400).json({ error: 'Paramètre invalide' }); return; }
    const info = await engine.forceTicks(body.data.n);
    await audit(authed(req).user!.id, authed(req).user!.username, null, 'admin_force_tick', `${body.data.n} tick(s)`, 'ok');
    res.json({ ok: true, tick: info ? { tick: info.tick, day: info.day, durationMs: info.durationMs } : null });
  }));

  router.post('/admin/simulation/resync', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    hub.fullSyncAll();
    await audit(authed(req).user!.id, authed(req).user!.username, null, 'admin_resync', 'Resynchronisation de tous les clients', 'ok');
    res.json({ ok: true });
  }));

  router.post('/admin/integrity/check', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const problems = engine.validateWorld();
    res.json({ ok: problems.length === 0, problems: problems.slice(0, 100), integrityIssues: world.meta.integrityIssues });
  }));

  router.post('/admin/integrity/repair', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    let fixed = 0;
    for (const c of world.allCountries()) {
      const report = sanitizeCountry(c);
      fixed += report.fixed;
      world.markDirty(c.id);
    }
    world.markMarketDirty();
    world.markMetaDirty();
    await world.save();
    await audit(authed(req).user!.id, authed(req).user!.username, null, 'admin_repair', `${fixed} valeur(s) réparée(s)`, 'ok');
    hub.fullSyncAll();
    res.json({ ok: true, fixed });
  }));

  router.post('/admin/world/reseed', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const body = z.object({ confirm: z.string() }).safeParse(req.body);
    if (!body.success || body.data.confirm !== 'RESEED WORLD') {
      res.status(400).json({ error: 'Confirmation forte requise : { confirm: "RESEED WORLD" }' });
      return;
    }
    await world.reseed();
    // Les utilisateurs gardent leur compte mais perdent leur pays (le monde repart du seed)
    const users = await repos.listUsers();
    for (const u of users) {
      if (u.countryId) {
        u.countryId = null;
        await repos.updateUser(u);
        await hub.notifyUser(u.id, { type: 'mandate', title: 'Monde réinitialisé', body: 'Un administrateur a réinitialisé le monde depuis le seed. Choisissez une nouvelle nation.', day: 0 });
      }
    }
    await audit(authed(req).user!.id, authed(req).user!.username, null, 'admin_reseed', 'MONDE RÉINITIALISÉ', 'ok');
    // Resynchronise IMMÉDIATEMENT tous les clients (comptes + monde)
    hub.broadcast({
      type: 'mandate_update',
      countryId: '__world_reset__',
      controllerKind: 'ai',
      presidentName: '',
      reason: 'Monde réinitialisé par un administrateur : choisissez une nouvelle nation.',
    });
    hub.fullSyncAll();
    res.json({ ok: true });
  }));

  router.get('/admin/audit', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const limit = clamp(Number(req.query.limit ?? 100), 1, 500);
    const logs = await repos.listAudit();
    res.json({ logs: logs.slice(-limit).reverse() });
  }));

  router.get('/admin/ai-decisions', ah(async (req, res) => {
    if (!adminOnly(req, res)) return;
    const limit = clamp(Number(req.query.limit ?? 100), 1, 400);
    res.json({ decisions: await repos.listAiDecisions(limit) });
  }));

  return router;
}
