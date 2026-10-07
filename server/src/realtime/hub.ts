/**
 * GEOPOLIS — Hub temps réel (WebSocket, serveur-authoritative).
 * - authentification par session (cookie d'upgrade ou message `hello`)
 * - heartbeat ping/pong + détection des connexions mortes
 * - présence (joueurs humains) + comptage honnête des dirigeants IA actifs
 * - mises à jour CIBLÉES : chaque client ne reçoit que ce dont il a besoin
 * - resynchronisation complète à la reconnexion
 */
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  ActiveEvent,
  Country,
  GameNotification,
  PresenceEntry,
  ResourceType,
} from 'shared';
import { createLogger } from '../logger.js';
import { sessionSecret } from '../auth/auth.js';
import type { Repositories } from '../storage/index.js';
import type { WorldStore } from '../world/world.js';
import type { TickInfo } from '../simulation/engine.js';
import { rateLimit } from '../util/ratelimit.js';
import type {
  ClientMessage,
  RelationSummary,
  ServerMessage,
  WorldSnapshotMessage,
} from 'shared';

const log = createLogger('REALTIME');

const SESSION_COOKIE = 'gp_session';

interface ClientConn {
  id: number;
  ws: WebSocket;
  userId: string | null;
  username: string | null;
  role: 'user' | 'admin';
  subscribedCountry: string | null;
  alive: boolean;
  connectedAt: number;
}

export interface HubDeps {
  world: WorldStore;
  repos: Repositories;
}

export class RealtimeHub {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, ClientConn>();
  private presence = new Map<string, { username: string; countryId: string | null; countryName: string | null; since: number }>();
  private nextId = 1;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private presencePersistTimer: ReturnType<typeof setTimeout> | null = null;
  private lastOffersRevision = -1;
  private lastDeliveriesRevision = -1;

  constructor(server: Server, private deps: HubDeps) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => {
      void this.onConnection(ws, req);
    });
    this.heartbeat = setInterval(() => this.sweep(), 25_000);
    log.info('Hub WebSocket prêt sur /ws');
  }

  /* ------------------------------- Connexion ------------------------------- */

  private async onConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const conn: ClientConn = {
      id: this.nextId++,
      ws,
      userId: null,
      username: null,
      role: 'user',
      subscribedCountry: null,
      alive: true,
      connectedAt: Date.now(),
    };
    this.clients.set(ws, conn);

    // Authentification immédiate via cookie d'upgrade si présent
    const token = this.cookieToken(req);
    if (token) await this.bindSession(conn, token);

    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('message', (raw) => {
      void this.onMessage(conn, raw.toString());
    });
    ws.on('close', () => {
      this.clients.delete(ws);
      this.refreshPresence();
    });
    ws.on('error', () => {
      this.clients.delete(ws);
      this.refreshPresence();
    });

    this.send(conn, this.worldSnapshotMessage());
    this.refreshPresence();
    // Renvoie un snapshot à jour une fois la présence rafraîchie (acteurs exacts)
    this.send(conn, this.worldSnapshotMessage());
  }

  private cookieToken(req: IncomingMessage): string | null {
    const header = req.headers.cookie;
    if (!header) return null;
    for (const part of header.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
    }
    return null;
  }

  private async bindSession(conn: ClientConn, token: string): Promise<boolean> {
    try {
      const session = await this.deps.repos.getSession(token, sessionSecret());
      if (!session) return false;
      const user = await this.deps.repos.getUser(session.userId);
      if (!user || user.suspended) return false;
      conn.userId = user.id;
      conn.username = user.username;
      conn.role = user.role;
      if (user.countryId) conn.subscribedCountry = user.countryId;
      this.send(conn, {
        type: 'welcome',
        userId: user.id,
        username: user.username,
        countryId: user.countryId,
        role: user.role,
      });
      return true;
    } catch (e) {
      log.warn('bindSession échoué', String(e));
      return false;
    }
  }

  /* ------------------------------- Messages ------------------------------- */

  private async onMessage(conn: ClientConn, raw: string): Promise<void> {
    if (!rateLimit(`ws:${conn.id}`, 240, 60_000)) {
      this.send(conn, { type: 'error', code: 'rate_limited', message: 'Trop de messages' });
      conn.ws.close(4008, 'rate limited');
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(conn, { type: 'error', code: 'bad_json', message: 'Message invalide' });
      return;
    }
    switch (msg?.type) {
      case 'hello': {
        if (typeof msg.token !== 'string') return;
        const ok = await this.bindSession(conn, msg.token);
        if (!ok) this.send(conn, { type: 'error', code: 'unauthorized', message: 'Session invalide' });
        this.refreshPresence();
        break;
      }
      case 'ping':
        conn.alive = true;
        this.send(conn, { type: 'pong', t: typeof msg.t === 'number' ? msg.t : Date.now() });
        break;
      case 'subscribe': {
        if (typeof msg.countryId !== 'string' || !this.deps.world.country(msg.countryId)) {
          this.send(conn, { type: 'error', code: 'bad_country', message: 'Pays inconnu' });
          return;
        }
        conn.subscribedCountry = msg.countryId;
        const c = this.deps.world.country(msg.countryId);
        if (c) this.send(conn, this.countrySnapshotMessage(c));
        break;
      }
      case 'unsubscribe':
        conn.subscribedCountry = null;
        break;
      case 'request_full_sync':
        this.fullSync(conn);
        break;
      default:
        this.send(conn, { type: 'error', code: 'unknown_type', message: 'Type de message inconnu' });
    }
  }

  private sweep(): void {
    for (const [ws, conn] of this.clients) {
      if (!conn.alive) {
        log.debug(`Connexion morte terminée (${conn.username ?? 'anonyme'})`);
        ws.terminate();
        this.clients.delete(ws);
        continue;
      }
      conn.alive = false;
      try {
        ws.ping();
      } catch {
        this.clients.delete(ws);
      }
    }
    this.refreshPresence();
  }

  /* ------------------------------- Envois ------------------------------- */

  private send(conn: ClientConn, msg: ServerMessage): void {
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    try {
      conn.ws.send(JSON.stringify(msg));
    } catch (e) {
      log.warn('send WS échoué', String(e));
    }
  }

  broadcast(msg: ServerMessage): void {
    for (const conn of this.clients.values()) this.send(conn, msg);
  }

  sendToUser(userId: string, msg: ServerMessage): void {
    for (const conn of this.clients.values()) {
      if (conn.userId === userId) this.send(conn, msg);
    }
  }

  private sendToSubscribers(countryId: string, msg: ServerMessage): void {
    for (const conn of this.clients.values()) {
      if (conn.subscribedCountry === countryId) this.send(conn, msg);
    }
  }

  fullSync(conn: ClientConn): void {
    this.send(conn, this.worldSnapshotMessage());
    if (conn.subscribedCountry) {
      const c = this.deps.world.country(conn.subscribedCountry);
      if (c) this.send(conn, this.countrySnapshotMessage(c));
    }
  }

  fullSyncAll(): void {
    for (const conn of this.clients.values()) this.fullSync(conn);
  }

  /** Mise à jour ciblée immédiate après une action (appelé par les routes API). */
  pushCountryUpdate(countryId: string): void {
    const c = this.deps.world.country(countryId);
    if (!c) return;
    this.sendToSubscribers(countryId, this.countrySnapshotMessage(c));
    this.broadcast({ type: 'country_public_update', countries: this.deps.world.allCountries().map((x) => this.deps.world.publicCountry(x)) });
  }

  pushNotificationToUser(userId: string, n: GameNotification): void {
    this.sendToUser(userId, { type: 'notification_created', notification: n });
  }

  /** Célébration « gain exceptionnel » (joueurs humains connectés uniquement). */
  sendBigWin(userId: string, amount: number, source: string): void {
    this.sendToUser(userId, { type: 'bigwin', amount, source });
  }

  /* ------------------------------- Projections ------------------------------- */

  actorsCount(): { total: number; humans: number; ai: number; humansOnline: number } {
    const humansOnline = this.presence.size;
    const { world } = this.deps;
    // "Dirigeants IA actifs" : pays IA ayant exécuté un cycle de décision récemment
    let ai = 0;
    for (const c of world.allCountries()) {
      if (c.controller.kind !== 'ai') continue;
      if (world.meta.tick - c.ai.lastDecisionTick <= 8 || c.ai.lastActionDay >= world.meta.day - 5) ai += 1;
    }
    return { total: humansOnline + ai, humans: humansOnline, ai, humansOnline };
  }

  worldSnapshotMessage(): WorldSnapshotMessage {
    const { world } = this.deps;
    return {
      type: 'world_snapshot',
      meta: world.meta,
      actors: this.actorsCount(),
      market: world.market,
      countries: world.allCountries().map((c) => world.publicCountry(c)),
      flows: world.topFlows(40),
      activeEventCount: world.activeEvents().length,
      activeTradeCount: world.routes.size,
    };
  }

  relationsSummary(c: Country): RelationSummary[] {
    return Object.entries(c.relations)
      .map(([id, rel]) => {
        const other = this.deps.world.country(id);
        return {
          countryId: id,
          name: other?.name ?? id,
          color: other?.color ?? '#888',
          score: rel.score,
          trust: rel.trust,
          sanctionByUs: rel.sanctionByUs,
          sanctionByThem: rel.sanctionByThem,
          agreements: rel.agreements.map((a) => ({ id: a.id, type: a.type, status: a.status })),
          tradeVolume: rel.tradeVolume,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  countrySnapshotMessage(c: Country): ServerMessage {
    return {
      type: 'country_snapshot',
      country: c,
      relationsSummary: this.relationsSummary(c),
    };
  }

  /* ------------------------------- Présence ------------------------------- */

  refreshPresence(): void {
    const seen = new Set<string>();
    for (const conn of this.clients.values()) {
      if (!conn.userId || seen.has(conn.userId)) continue;
      seen.add(conn.userId);
      const existing = this.presence.get(conn.userId);
      const country = conn.subscribedCountry ? this.deps.world.country(conn.subscribedCountry) : null;
      if (!existing) {
        this.presence.set(conn.userId, {
          username: conn.username ?? 'Joueur',
          countryId: conn.subscribedCountry,
          countryName: country?.name ?? null,
          since: conn.connectedAt,
        });
      } else {
        existing.countryId = conn.subscribedCountry;
        existing.countryName = country?.name ?? null;
      }
    }
    for (const userId of [...this.presence.keys()]) {
      if (!seen.has(userId)) this.presence.delete(userId);
    }
    const entries: PresenceEntry[] = [...this.presence.entries()].map(([userId, p]) => ({
      userId,
      username: p.username,
      countryId: p.countryId,
      countryName: p.countryName,
      since: p.since,
      isAi: false,
    }));
    this.broadcast({ type: 'presence_update', presence: entries });
    this.broadcast({
      type: 'world_update',
      meta: this.deps.world.meta,
      actors: this.actorsCount(),
      activeEventCount: this.deps.world.activeEvents().length,
      activeTradeCount: this.deps.world.routes.size,
    });
    this.schedulePresencePersist(entries);
  }

  private schedulePresencePersist(entries: PresenceEntry[]): void {
    if (this.presencePersistTimer) return;
    this.presencePersistTimer = setTimeout(() => {
      this.presencePersistTimer = null;
      void this.deps.repos.savePresence(entries).catch((e) => log.warn('persistance présence échouée', String(e)));
    }, 5000);
  }

  presenceList(): PresenceEntry[] {
    return [...this.presence.entries()].map(([userId, p]) => ({
      userId,
      username: p.username,
      countryId: p.countryId,
      countryName: p.countryName,
      since: p.since,
      isAi: false,
    }));
  }

  onlineUserIds(): string[] {
    return [...this.presence.keys()];
  }

  clientCount(): number {
    return this.clients.size;
  }

  /* ------------------------------- Tick → diffusion ------------------------------- */

  onTick(info: TickInfo): void {
    const { world } = this.deps;
    const actors = this.actorsCount();

    this.broadcast({
      type: 'world_update',
      meta: world.meta,
      actors,
      activeEventCount: world.activeEvents().length,
      activeTradeCount: world.routes.size,
    });
    this.broadcast({ type: 'market_update', market: world.market });
    this.broadcast({
      type: 'country_public_update',
      countries: world.allCountries().map((c) => world.publicCountry(c)),
    });
    this.broadcast({ type: 'trade_update', flows: world.topFlows(40) });

    if (world.journal.length > 0) {
      this.broadcast({ type: 'journal_update', entries: world.journal.slice(-10) });
    }
    if (info.transactions.length > 0) {
      this.broadcast({ type: 'transaction_update', transactions: info.transactions.slice(-12) });
    }
    for (const { event } of info.newEvents) {
      this.broadcast({ type: 'event_created', event });
    }
    // Offres du marché inter-états : diffusion dès qu'elles changent (IA, expiration, joueurs)
    if (info.offersRevision !== this.lastOffersRevision) {
      this.lastOffersRevision = info.offersRevision;
      this.broadcast({ type: 'offers_update', offers: world.openOffers() });
    }
    // Livraisons exceptionnelles en attente : diffusion dès qu'elles changent
    if (world.deliveriesRevision !== this.lastDeliveriesRevision) {
      this.lastDeliveriesRevision = world.deliveriesRevision;
      this.broadcast({ type: 'deliveries_update', deliveries: world.pendingDeliveries });
    }
    for (const { event } of info.endedEvents) {
      this.broadcast({ type: 'event_ended', eventId: event.id, countryIds: event.countryIds });
    }
    for (const loss of info.mandateLosses) {
      const c = world.country(loss.countryId);
      this.broadcast({
        type: 'mandate_update',
        countryId: loss.countryId,
        controllerKind: 'ai',
        presidentName: c?.controller.presidentName ?? 'Gouvernement IA',
        reason: loss.reason,
      });
    }

    // Mises à jour pays complètes : tous les 3 ticks pour limiter le volume
    const fullCycle = world.meta.tick % 3 === 0;
    const subscribed = new Map<string, Country>();
    for (const conn of this.clients.values()) {
      if (!conn.subscribedCountry || subscribed.has(conn.subscribedCountry)) continue;
      const c = world.country(conn.subscribedCountry);
      if (c) subscribed.set(c.id, c);
    }
    for (const c of subscribed.values()) {
      if (fullCycle || info.mandateLosses.some((l) => l.countryId === c.id)) {
        this.sendToSubscribers(c.id, this.countrySnapshotMessage(c));
      }
    }
  }

  async notifyUser(
    userId: string,
    n: { type: ResourceType; title: string; body: string; day: number; action?: GameNotification['action'] },
  ): Promise<void> {
    const stored = await this.deps.repos.pushNotification({ userId, ...n });
    this.pushNotificationToUser(userId, stored);
  }

  /** Diffuse un événement créé hors-tick (ex. propositions entre joueurs). */
  broadcastEvent(event: ActiveEvent): void {
    this.broadcast({ type: 'event_created', event });
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.presencePersistTimer) clearTimeout(this.presencePersistTimer);
    for (const ws of this.wss.clients) ws.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}
