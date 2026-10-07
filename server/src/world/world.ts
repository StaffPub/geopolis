/**
 * GEOPOLIS — WorldStore : état du monde en mémoire + persistance.
 * Le serveur est la seule source de vérité. Toutes les mutations importantes
 * passent par ici (marquage "dirty", incrémentation de la version globale).
 */
import type {
  Country,
  JournalEntry,
  MarketResource,
  PublicCountry,
  ResourceKey,
  TradeRoute,
  TradeTransaction,
  WorldMeta,
  WorldSummary,
} from 'shared';
import { SIM_VERSION } from 'shared';
import { createLogger } from '../logger.js';
import { Repositories, type Storage } from '../storage/index.js';
import { K } from '../storage/storage.js';
import { uid } from '../util/core.js';
import { reportIssues, sanitizeCountry, sanitizeMarket, sanitizeMeta } from './integrity.js';
import { buildCorridors, buildSeedWorld, CORRIDOR_DEFS } from './seed.js';

const log = createLogger('WORLD');

export const JOURNAL_CAP = 200;
export const TRANSACTIONS_CAP = 150;
export const OFFERS_CAP = 60;
export const DELIVERIES_CAP = 40;

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export class WorldStore {
  meta: WorldMeta;
  countries = new Map<string, Country>();
  market: Record<ResourceKey, MarketResource>;
  routes = new Map<string, TradeRoute>();
  corridors = new Map<string, import('shared').TradeCorridor>();
  journal: JournalEntry[] = [];
  transactions: TradeTransaction[] = [];
  /** Offres de vente inter-états (onglet Ressources) : les IA et joueurs peuvent les acheter. */
  offers: import('shared').TradeOffer[] = [];
  offersRevision = 0;
  /** Livraisons exceptionnelles en attente d'acceptation par le destinataire.
   *  Le stock de l'expéditeur est réservé dès la création ; l'argent ne bouge
   *  qu'à l'acceptation (destinataire débité + crédité en ressources). */
  pendingDeliveries: import('shared').PendingDelivery[] = [];
  deliveriesRevision = 0;

  repos: Repositories;

  private dirty = new Set<string>();
  private metaDirty = true;
  private listsDirty = false;
  private marketDirty = false;
  private routesDirty = false;
  private corridorsDirty = false;
  private offersDirty = false;
  private deliveriesDirty = false;
  private aiDecisionBuffer: import('shared').AiDecisionLog[] = [];

  private constructor(
    private storage: Storage,
    meta: WorldMeta,
    countries: Country[],
    market: Record<ResourceKey, MarketResource>,
  ) {
    this.repos = new Repositories(storage);
    this.meta = meta;
    this.market = market;
    for (const c of countries) this.countries.set(c.id, c);
  }

  /* -------------------------------- Chargement -------------------------------- */

  static async load(storage: Storage): Promise<WorldStore> {
    const meta = await storage.get<WorldMeta>(K.meta);
    const index = (await storage.get<string[]>(K.countriesIndex)) ?? [];
    if (meta && index.length > 0) {
      const countries: Country[] = [];
      for (const id of index) {
        const c = await storage.get<Country>(K.country(id));
        if (c) countries.push(c);
      }
      const market =
        (await storage.get<Record<ResourceKey, MarketResource>>(K.market)) ?? null;
      if (countries.length === index.length && market) {
        // Intégrité au chargement (reprise après crash)
        let fixed = 0;
        for (const c of countries) {
          const r = sanitizeCountry(c);
          reportIssues(`load:${c.id}`, r);
          fixed += r.fixed;
        }
        const rm = sanitizeMarket(market);
        fixed += rm.fixed;
        const rmeta = sanitizeMeta(meta);
        fixed += rmeta.fixed;
        meta.integrityIssues += fixed;
        const store = new WorldStore(storage, meta, countries, market);
        store.journal = (await storage.get<JournalEntry[]>(K.journal)) ?? [];
        store.transactions = (await storage.get<TradeTransaction[]>(K.transactions)) ?? [];
        store.offers = (await storage.get<import('shared').TradeOffer[]>(K.offers)) ?? [];
        store.pendingDeliveries = (await storage.get<import('shared').PendingDelivery[]>(K.pendingDeliveries)) ?? [];
        const routes = (await storage.get<TradeRoute[]>(K.routes)) ?? [];
        for (const r of routes) store.routes.set(r.id, r);
        const corridors = (await storage.get<import('shared').TradeCorridor[]>(K.corridors)) ?? buildCorridors();
        for (const co of corridors) store.corridors.set(co.id, co);
        // Migration : les corridors du catalogue qui n'existent pas encore dans ce
        // monde (réseau étendu) sont ajoutés, libres et sans péage. Jamais de
        // suppression ni d'écrasement : les propriétaires/péages existants sont préservés.
        let added = 0;
        for (const def of CORRIDOR_DEFS) {
          if (!store.corridors.has(def.id)) {
            store.corridors.set(def.id, { ...def, owner: null, toll: 0, traffic: 0 });
            added++;
          }
        }
        if (added > 0) {
          store.corridorsDirty = true;
          log.info(`Migration corridors : ${added} nouvelle(s) route(s) commerciale(s) ajoutée(s) au monde existant`);
        }
        log.info(
          `Monde chargé : ${store.countries.size} nations, ${store.corridors.size} routes commerciales, tick ${meta.tick}, jour ${meta.day}, version ${meta.version} (${fixed} correction(s) d'intégrité)`,
        );
        return store;
      }
      log.warn('Monde incomplet en base : réinitialisation depuis le seed');
    }
    return WorldStore.seed(storage);
  }

  static async seed(storage: Storage): Promise<WorldStore> {
    const seeded = buildSeedWorld();
    for (const c of seeded.countries) {
      const r = sanitizeCountry(c);
      reportIssues(`seed:${c.id}`, r);
    }
    const store = new WorldStore(storage, seeded.meta, seeded.countries, seeded.market);
    for (const co of buildCorridors()) store.corridors.set(co.id, co);
    store.journal = seeded.countries[0]?.history.slice() ?? [];
    store.metaDirty = true;
    store.listsDirty = true;
    store.marketDirty = true;
    store.corridorsDirty = true;
    for (const c of store.countries.keys()) store.dirty.add(c);
    await store.save();
    log.info(`Monde initialisé depuis le seed : ${store.countries.size} nations, version ${SIM_VERSION}`);
    return store;
  }

  /* -------------------------------- Accès -------------------------------- */

  country(id: string): Country | undefined {
    return this.countries.get(id);
  }

  allCountries(): Country[] {
    return [...this.countries.values()];
  }

  countryByUser(userId: string): Country | undefined {
    return this.allCountries().find((c) => c.controller.kind === 'player' && c.controller.userId === userId);
  }

  get version(): number {
    return this.meta.version;
  }

  /* -------------------------------- Mutations -------------------------------- */

  bumpVersion(): number {
    this.meta.version += 1;
    return this.meta.version;
  }

  markDirty(countryId: string): void {
    this.dirty.add(countryId);
  }

  markAllDirty(): void {
    for (const id of this.countries.keys()) this.dirty.add(id);
  }

  touch(countryId: string): void {
    const c = this.countries.get(countryId);
    if (c) c.updatedAt = Date.now();
    this.markDirty(countryId);
    this.bumpVersion();
  }

  addJournal(entry: Omit<JournalEntry, 'id' | 'ts'>): JournalEntry {
    const full: JournalEntry = { ...entry, id: uid('jrn'), ts: Date.now() };
    this.journal.push(full);
    if (this.journal.length > JOURNAL_CAP) this.journal.splice(0, this.journal.length - JOURNAL_CAP);
    for (const cid of full.countryIds) {
      const c = this.countries.get(cid);
      if (c) {
        c.history.push(full);
        if (c.history.length > 150) c.history.splice(0, c.history.length - 150);
        this.markDirty(cid);
      }
    }
    this.listsDirty = true;
    return full;
  }

  /** Bufferise les décisions IA : une seule écriture stockage par cycle complet. */
  addAiDecisions(entries: Omit<import('shared').AiDecisionLog, 'id' | 'ts'>[]): void {
    for (const e of entries) {
      this.aiDecisionBuffer.push({ ...e, id: uid('aid'), ts: Date.now() });
    }
    if (this.aiDecisionBuffer.length > 150) {
      this.aiDecisionBuffer = this.aiDecisionBuffer.slice(-150);
    }
  }

  addTransaction(tx: Omit<TradeTransaction, 'id' | 'ts'>): TradeTransaction {
    const full: TradeTransaction = { ...tx, id: uid('trx'), ts: Date.now() };
    this.transactions.push(full);
    if (this.transactions.length > TRANSACTIONS_CAP) {
      this.transactions.splice(0, this.transactions.length - TRANSACTIONS_CAP);
    }
    for (const cid of [full.fromId, full.toId]) {
      const c = this.countries.get(cid);
      if (c) {
        c.transactions.push(full);
        if (c.transactions.length > 60) c.transactions.splice(0, c.transactions.length - 60);
        this.markDirty(cid);
      }
    }
    this.listsDirty = true;
    return full;
  }

  upsertRoute(route: TradeRoute): void {
    this.routes.set(route.id, route);
    this.routesDirty = true;
  }

  removeRoute(id: string): void {
    this.routes.delete(id);
    this.routesDirty = true;
  }

  /* ------------------------- Offres de vente inter-états ------------------------- */

  openOffers(): import('shared').TradeOffer[] {
    return this.offers.filter((o) => o.status === 'open');
  }

  offer(id: string): import('shared').TradeOffer | undefined {
    return this.offers.find((o) => o.id === id);
  }

  addOffer(offer: import('shared').TradeOffer): import('shared').TradeOffer {
    this.offers.push(offer);
    if (this.offers.length > OFFERS_CAP) {
      // Purge : d'abord les offres non ouvertes les plus anciennes, sinon les plus vieilles
      const idx = this.offers.findIndex((o) => o.status !== 'open');
      this.offers.splice(idx >= 0 ? idx : 0, 1);
    }
    this.offersRevision += 1;
    this.offersDirty = true;
    return offer;
  }

  removeOffer(id: string): void {
    const i = this.offers.findIndex((o) => o.id === id);
    if (i >= 0) {
      this.offers.splice(i, 1);
      this.offersRevision += 1;
      this.offersDirty = true;
    }
  }

  /** Marque une offre vendue/annulée puis la retire de la liste publique. */
  closeOffer(id: string, status: 'sold' | 'cancelled' | 'expired', buyerId?: string): void {
    const o = this.offer(id);
    if (!o) return;
    o.status = status;
    if (buyerId) o.buyerId = buyerId;
    this.removeOffer(id);
  }

  /** Expiration quotidienne des offres arrivées à échéance. */
  expireOffers(day: number): number {
    let n = 0;
    for (const o of [...this.offers]) {
      if (o.status === 'open' && day > o.expiresDay) {
        this.closeOffer(o.id, 'expired');
        n++;
      }
    }
    return n;
  }

  /* ------------------- Livraisons exceptionnelles en attente ------------------- */

  delivery(id: string): import('shared').PendingDelivery | undefined {
    return this.pendingDeliveries.find((d) => d.id === id);
  }

  addDelivery(d: import('shared').PendingDelivery): import('shared').PendingDelivery {
    this.pendingDeliveries.push(d);
    if (this.pendingDeliveries.length > DELIVERIES_CAP) {
      this.pendingDeliveries.splice(0, this.pendingDeliveries.length - DELIVERIES_CAP);
    }
    this.deliveriesRevision += 1;
    this.deliveriesDirty = true;
    return d;
  }

  removeDelivery(id: string): void {
    const i = this.pendingDeliveries.findIndex((d) => d.id === id);
    if (i >= 0) {
      this.pendingDeliveries.splice(i, 1);
      this.deliveriesRevision += 1;
      this.deliveriesDirty = true;
    }
  }

  /** Livraisons en attente impliquant un pays (envoi ou réception). */
  deliveriesFor(countryId: string): import('shared').PendingDelivery[] {
    return this.pendingDeliveries.filter((d) => d.fromId === countryId || d.toId === countryId);
  }

  /** Livraisons en attente dont le délai de réponse est dépassé (à retourner). */
  expiredDeliveries(day: number): import('shared').PendingDelivery[] {
    return this.pendingDeliveries.filter((d) => day > d.expiresDay);
  }

  /** Nombre de livraisons en attente envoyées par un pays. */
  openDeliveriesBySender(countryId: string): number {
    return this.pendingDeliveries.filter((d) => d.fromId === countryId).length;
  }

  /* -------------------------------- Persistance -------------------------------- */

  /** Sauvegarde légère (meta + marché) : appelée à chaque tick, coût minuscule. */
  async saveLight(): Promise<void> {
    const entries: Array<[string, unknown]> = [];
    if (this.metaDirty) {
      const r = sanitizeMeta(this.meta);
      if (r.fixed > 0) reportIssues('save:meta', r);
      entries.push([K.meta, this.meta]);
      this.metaDirty = false;
    }
    if (this.marketDirty) {
      entries.push([K.market, this.market]);
      this.marketDirty = false;
    }
    if (entries.length > 0) await this.storage.setMany(entries);
  }

  /** Sauvegarde complète : pays, listes, routes, décisions IA bufferisées.
      Ordre important : market → pays (sanitize) → meta (compteurs à jour). */
  async save(): Promise<void> {
    const entries: Array<[string, unknown]> = [];
    if (this.marketDirty) {
      const rm = sanitizeMarket(this.market);
      if (rm.fixed > 0) {
        reportIssues('save:market', rm);
        this.meta.integrityIssues += rm.fixed;
        this.metaDirty = true;
      }
      entries.push([K.market, this.market]);
      this.marketDirty = false;
    }
    for (const id of this.dirty) {
      const c = this.countries.get(id);
      if (!c) continue;
      const r = sanitizeCountry(c);
      if (r.fixed > 0) {
        reportIssues(`save:${id}`, r);
        this.meta.integrityIssues += r.fixed;
        this.metaDirty = true; // persister le compteur d'intégrité
      }
      entries.push([K.country(id), c]);
    }
    this.dirty.clear();
    // meta APRÈS les pays : le compteur d'intégrité doit être à jour
    if (this.metaDirty) {
      const r = sanitizeMeta(this.meta);
      if (r.fixed > 0) reportIssues('save:meta', r);
      entries.push([K.meta, this.meta]);
      this.metaDirty = false;
    }
    if (this.listsDirty) {
      entries.push([K.journal, this.journal]);
      entries.push([K.transactions, this.transactions]);
      this.listsDirty = false;
    }
    if (this.routesDirty) {
      entries.push([K.routes, [...this.routes.values()]]);
      this.routesDirty = false;
    }
    if (this.corridorsDirty) {
      entries.push([K.corridors, [...this.corridors.values()]]);
      this.corridorsDirty = false;
    }
    if (this.offersDirty) {
      entries.push([K.offers, this.offers]);
      this.offersDirty = false;
    }
    if (this.deliveriesDirty) {
      entries.push([K.pendingDeliveries, this.pendingDeliveries]);
      this.deliveriesDirty = false;
    }
    entries.push([K.countriesIndex, [...this.countries.keys()]]);
    if (entries.length > 0) await this.storage.setMany(entries);
    // décisions IA : une seule écriture batch
    if (this.aiDecisionBuffer.length > 0) {
      await this.repos.appendAiDecisionsBatch(this.aiDecisionBuffer);
      this.aiDecisionBuffer = [];
    }
  }

  markMarketDirty(): void {
    this.marketDirty = true;
  }

  markMetaDirty(): void {
    this.metaDirty = true;
  }

  markCorridorsDirty(): void {
    this.corridorsDirty = true;
  }

  corridor(id: string): import('shared').TradeCorridor | undefined {
    return this.corridors.get(id);
  }

  /** ADMIN uniquement : réinitialise le monde depuis le seed déterministe. */
  async reseed(): Promise<void> {
    const seeded = buildSeedWorld();
    this.countries.clear();
    for (const c of seeded.countries) this.countries.set(c.id, c);
    this.meta = seeded.meta;
    this.market = seeded.market;
    this.routes.clear();
    this.corridors.clear();
    for (const co of buildCorridors()) this.corridors.set(co.id, co);
    this.corridorsDirty = true;
    this.journal = [];
    this.transactions = [];
    this.offers = [];
    this.offersRevision += 1;
    this.offersDirty = true;
    this.pendingDeliveries = [];
    this.deliveriesRevision += 1;
    this.deliveriesDirty = true;
    this.metaDirty = true;
    this.marketDirty = true;
    this.listsDirty = true;
    this.routesDirty = true;
    this.markAllDirty();
    await this.save();
    log.warn('MONDE RÉINITIALISÉ depuis le seed (action admin)');
  }

  /* -------------------------------- Projections publiques -------------------------------- */

  publicCountry(c: Country): PublicCountry {
    return {
      id: c.id,
      name: c.name,
      code: c.code,
      color: c.color,
      region: c.region,
      population: c.population,
      gdp: c.economy.gdp,
      growth: c.economy.growth,
      inflation: c.economy.inflation,
      unemployment: c.economy.unemployment,
      popularity: c.popularity,
      stability: c.stability,
      standardOfLiving: c.economy.standardOfLiving,
      controllerKind: c.controller.kind,
      presidentName: c.controller.presidentName,
      difficulty: c.difficulty,
      debtRatio: c.economy.gdp > 0 ? (c.economy.debt / c.economy.gdp) * 100 : 0,
      strategy: c.ai.personality.strategy,
    };
  }

  topFlows(limit = 24): TradeRoute[] {
    return [...this.routes.values()].sort((a, b) => b.value - a.value).slice(0, limit);
  }

  activeEvents(): { event: import('shared').ActiveEvent; country: Country }[] {
    const out: { event: import('shared').ActiveEvent; country: Country }[] = [];
    for (const c of this.countries.values()) {
      for (const e of c.activeEvents) out.push({ event: e, country: c });
    }
    return out;
  }

  summary(actors: { total: number; humans: number; ai: number; humansOnline: number }): WorldSummary {
    return {
      meta: this.meta,
      actors,
      nations: this.countries.size,
      activeTrades: this.routes.size,
      activeEvents: this.activeEvents().length,
      market: this.market,
      countries: this.allCountries().map((c) => this.publicCountry(c)),
      flows: this.topFlows(40),
    };
  }
}
