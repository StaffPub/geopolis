/**
 * GEOPOLIS — Moteur de simulation central (WorldSimulationEngine).
 * Autoritaire, serveur-side, persistant. Un seul moteur applique les ticks
 * mondiaux grâce à un lock distribué (compatible multi-instances Render).
 *
 * Pipeline d'un tick (= 1 jour de jeu) :
 *   1. infrastructures  2. événements  3. population  4. production/consommation
 *   5. prix locaux      6. marché mondial  7. commerce international
 *   8. économie/finances  9. politique & mandat  10. diplomatie  11. IA
 *   12. séries/alertes  13. persistance  14. diffusion temps réel
 */
import type { ActiveEvent, AiDecisionLog, Alert, Country, ResourceKey, TradeTransaction } from 'shared';
import { MAX_CATCHUP_TICKS } from 'shared';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import type { Storage } from '../storage/index.js';
import { makeRng, seedFrom, round } from '../util/core.js';
import type { WorldStore } from '../world/world.js';
import { aggregateEventModifiers, lawEffects } from './model.js';
import { expirePendingDeliveries } from '../actions/registry.js';
import { processInfrastructure } from './infrastructure.js';
import { processEvents } from './events.js';
import { processPopulation } from './population.js';
import { runProductionPhase, updateSectorCapacities, directiveDailyCost, deliverFacilities, facilitiesDailyUpkeep } from './production.js';
import { investRateOf, processEconomy, processPrices, updateGlobalMarket } from './economy.js';
import { processTrade } from './trade.js';
import { processPolitics, politicalAlerts } from './politics.js';
import { processDiplomacy } from './diplomacy.js';
import { processAI } from './ai.js';

const log = createLogger('SIMULATION');

const AI_PRESIDENT_NAMES = [
  'Gabriel Mercier', 'Nadia Karlsen', 'Thomas Reiner', 'Aïcha Diallo', 'Mikael Vos',
  'Elena Petrova', 'Hugo Salas', 'Yuki Tanabe', 'Omar Haddad', 'Clara Nyman',
  'Diego Fuentes', 'Ingrid Solberg', 'Rashid Amari', 'Marta Kovac', 'Léon Dubreuil',
  'Sofia Marchetti', 'Anders Holm', 'Leila Nasser', 'Viktor Orszag', 'Naomi Clarke',
];

export function aiPresidentName(countryId: string): string {
  const idx = seedFrom(`ai-president-${countryId}`) % AI_PRESIDENT_NAMES.length;
  return AI_PRESIDENT_NAMES[idx] ?? 'Gouvernement IA';
}

export interface MandateLoss {
  countryId: string;
  countryName: string;
  userId: string | null;
  username: string;
  reason: string;
}

export interface TickInfo {
  tick: number;
  day: number;
  durationMs: number;
  newEvents: { event: ActiveEvent; countryId: string }[];
  endedEvents: { event: ActiveEvent; countryId: string }[];
  mandateLosses: MandateLoss[];
  mandateWarnings: { countryId: string; userId: string | null; threshold: number }[];
  transactions: TradeTransaction[];
  aiDecisions: Omit<AiDecisionLog, 'id' | 'ts'>[];
  infraCompleted: { countryId: string; name: string }[];
  offersRevision: number;
}

export interface EngineHooks {
  onTickCompleted?(world: WorldStore, info: TickInfo): void | Promise<void>;
  onMandateLost?(loss: MandateLoss): void | Promise<void>;
  notifyUser?(userId: string, n: { type: import('shared').ResourceType; title: string; body: string; day: number; action?: import('shared').GameNotification['action'] }): void | Promise<void>;
  onAiDecisions?(decisions: Omit<AiDecisionLog, 'id' | 'ts'>[]): void | Promise<void>;
  onBigWin?(userId: string, amount: number, source: string): void;
}

export interface EngineOptions {
  tickMs: number;
  instanceId: string;
  enabled: boolean;
}

interface CountryTickData {
  energyStrain: number;
  unmet: Record<ResourceKey, number>;
  projectDailyCost: number;
}

export class WorldSimulationEngine {
  running = false;
  leader = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;
  lastInfo: TickInfo | null = null;

  constructor(
    private world: WorldStore,
    private storage: Storage,
    private hooks: EngineHooks,
    private opts: EngineOptions,
  ) {}

  get status(): import('shared').EngineStatus {
    return {
      running: this.running,
      leader: this.leader,
      tick: this.world.meta.tick,
      day: this.world.meta.day,
      lastTickAt: this.world.meta.lastTickAt,
      lastTickDurationMs: this.world.meta.lastTickDurationMs,
      tickIntervalMs: this.opts.tickMs,
      worldVersion: this.world.meta.version,
      storage: '', // complété par la route (hub/repos)
      wsClients: 0,
      humansOnline: 0,
      aiActive: 0,
      countries: this.world.countries.size,
      lastError: this.world.meta.lastError,
      uptimeMs: Math.round(process.uptime() * 1000),
    };
  }

  async start(): Promise<void> {
    if (!this.opts.enabled) {
      log.warn('Simulation désactivée (SIMULATION_ENABLED=false)');
      return;
    }
    if (this.running) return;
    this.running = true;
    log.info(`Moteur démarré (tick = ${this.opts.tickMs} ms, instance ${this.opts.instanceId})`);
    this.schedule();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.leader) {
      await this.storage.releaseLock('engine:leader', this.opts.instanceId).catch(() => undefined);
      this.leader = false;
    }
    log.info('Moteur arrêté');
  }

  private schedule(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, this.opts.tickMs);
  }

  async tryLeadership(): Promise<boolean> {
    try {
      const ok = await this.storage.acquireLock('engine:leader', this.opts.instanceId, this.opts.tickMs * 3);
      if (ok && !this.leader) log.info('Lock moteur acquis : cette instance est le moteur autoritaire');
      if (!ok && this.leader) log.warn('Lock moteur perdu : une autre instance reprend la simulation');
      this.leader = ok;
      this.world.meta.leaderId = ok ? this.opts.instanceId : this.world.meta.leaderId;
      return ok;
    } catch (e) {
      log.error('Erreur acquisition lock moteur', String(e));
      return false;
    }
  }

  /** Tick périodique : réservé au leader. */
  async tick(): Promise<TickInfo | null> {
    if (!this.running) return null;
    try {
      const isLeader = await this.tryLeadership();
      if (!isLeader) return null;
      const info = await this.tickNow();
      await this.emitTick(info);
      return info;
    } catch (e) {
      this.world.meta.lastError = String(e);
      this.world.meta.lastErrorAt = Date.now();
      this.world.markMetaDirty();
      log.error('Erreur pendant le tick', e instanceof Error ? e.stack : String(e));
      return null;
    } finally {
      this.schedule();
    }
  }

  /** Rattrapage après redémarrage : le monde continue même serveur éteint. */
  async catchUp(now = Date.now()): Promise<number> {
    const elapsed = Math.max(0, now - this.world.meta.lastTickAt);
    const missed = Math.min(Math.floor(elapsed / this.opts.tickMs), MAX_CATCHUP_TICKS);
    if (missed <= 0) return 0;
    log.info(`Reprise : ${missed} tick(s) à rattraper (${Math.round(elapsed / 60000)} min écoulées)`);
    for (let i = 0; i < missed; i++) {
      try {
        await this.tickNow({ silent: true });
        if (i % 20 === 19) await this.world.save();
      } catch (e) {
        log.error('Erreur pendant le rattrapage', String(e));
        break;
      }
    }
    await this.world.save();
    log.info(`Rattrapage terminé au jour ${this.world.meta.day}`);
    return missed;
  }

  /** Exécute un tick complet (utilisé par tick() et catchUp()). */
  async tickNow(opts: { silent?: boolean } = {}): Promise<TickInfo> {
    const t0 = Date.now();
    const meta = this.world.meta;
    meta.tick += 1;
    meta.day += 1;
    const day = meta.day;
    const rng = makeRng(seedFrom(`tick-${meta.tick}`));
    const info: TickInfo = {
      tick: meta.tick, day, durationMs: 0,
      newEvents: [], endedEvents: [], mandateLosses: [], mandateWarnings: [],
      transactions: [], aiDecisions: [], infraCompleted: [], offersRevision: 0,
    };
    const perCountry = new Map<string, CountryTickData>();

    /* ---- 1-4. Phases par pays : infra, événements, population, production ---- */
    for (const c of this.world.allCountries()) {
      const infraRes = processInfrastructure(c);
      for (const name of infraRes.completed) {
        info.infraCompleted.push({ countryId: c.id, name });
        this.world.addJournal({
          day, type: 'infrastructure', countryIds: [c.id], actor: c.controller.presidentName,
          text: `${c.name} achève la construction : ${name}.`,
        });
        this.notifyController(c, {
          type: 'infrastructure', title: 'Chantier achevé',
          body: `${name} est opérationnel : ses effets s'appliquent dès maintenant.`, day,
        });
      }

      const evRes = processEvents(c, day, rng);
      for (const ev of evRes.created) {
        info.newEvents.push({ event: ev, countryId: c.id });
        this.world.addJournal({
          day, type: 'event', countryIds: [c.id], actor: 'Système',
          text: `${c.name} : ${ev.title} — ${ev.source}.`,
        });
        this.notifyController(c, { type: 'event', title: ev.title, body: `${ev.description} (source : ${ev.source})`, day });
      }
      for (const ev of evRes.ended) {
        info.endedEvents.push({ event: ev, countryId: c.id });
        this.world.addJournal({
          day, type: 'event', countryIds: [c.id], actor: 'Système',
          text: `${c.name} : fin de l'événement « ${ev.title} ».`,
        });
      }

      // Expiration de la lune de miel / gueule de bois post-changement de régime
      if (c.regimeHoneymoon && c.regimeHoneymoon.untilDay <= day) {
        c.regimeHoneymoon = null;
        this.world.markDirty(c.id);
      }

      processPopulation(c);
      // Bâtiments de production : livraison des constructions terminées
      const delivered = deliverFacilities(c, day);
      for (const name of delivered) {
        this.world.addJournal({
          day, type: 'infrastructure', countryIds: [c.id], actor: c.controller.presidentName,
          text: `${c.name} met en service : ${name}. La production augmente immédiatement.`,
        });
        this.notifyController(c, {
          type: 'infrastructure', title: 'Bâtiment de production livré',
          body: `${name} est opérationnel : sa production et son entretien s'appliquent dès maintenant.`, day,
        });
      }
      const prodRes = runProductionPhase(c);
      perCountry.set(c.id, {
        energyStrain: prodRes.energyStrain,
        unmet: prodRes.unmet,
        // Coût des chantiers + consignes de production + entretien des bâtiments productifs
        projectDailyCost: infraRes.projectDailyCost + directiveDailyCost(c) + facilitiesDailyUpkeep(c),
      });
    }

    /* ---- 5-6. Prix locaux puis marché mondial ---- */
    const globalBefore = Object.fromEntries(
      (Object.keys(this.world.market) as ResourceKey[]).map((k) => [k, this.world.market[k].price]),
    ) as Record<ResourceKey, number>;
    for (const c of this.world.allCountries()) {
      processPrices(c, globalBefore, aggregateEventModifiers(c));
    }
    updateGlobalMarket(this.world.allCountries(), this.world.market);
    this.world.markMarketDirty();

    /* ---- 7. Commerce international ---- */
    const tradeRes = processTrade(this.world, rng);
    for (const tx of tradeRes.bigTransactions) {
      this.world.addTransaction(tx);
      info.transactions.push(tx);
    }

    /* ---- 7b. Corridors : entretien quotidien payé par le propriétaire ---- */
    for (const co of this.world.corridors.values()) {
      if (!co.owner) continue;
      const owner = this.world.country(co.owner);
      if (!owner) continue;
      owner.economy.cash = round(owner.economy.cash - co.upkeep / 365, 3);
      this.world.markDirty(owner.id);
    }

    /* ---- 8-9. Économie, politique, mandat, séries, alertes ---- */
    for (const c of this.world.allCountries()) {
      const data = perCountry.get(c.id)!;
      const trade = tradeRes.perCountry.get(c.id)!;
      processEconomy(c, {
        tariffRevenueDaily: trade.tariffRevenue,
        netExportShare: trade.netExportShare,
        energyStrain: data.energyStrain,
        unmet: data.unmet,
        projectDailyCost: data.projectDailyCost,
      });
      const events = aggregateEventModifiers(c);
      const laws = lawEffects(c);
      updateSectorCapacities(c, investRateOf(c), data.energyStrain, laws, events);

      const pol = processPolitics(c, { unmet: data.unmet, energyStrain: data.energyStrain });
      if (pol.warningThreshold !== null && c.controller.kind === 'player') {
        info.mandateWarnings.push({ countryId: c.id, userId: c.controller.userId, threshold: pol.warningThreshold });
        this.notifyController(c, {
          type: 'mandate',
          title: pol.warningThreshold >= 48 ? 'Risque politique CRITIQUE' : pol.warningThreshold >= 28 ? 'Risque politique élevé' : 'Risque politique modéré',
          body: `Popularité sous 35 % depuis ${pol.warningThreshold} jours. Redressez la situation (popularité > 45 %) pour stabiliser votre mandat.`,
          day,
        });
      }
      if (pol.mandateLost && c.controller.kind === 'player') {
        const loss: MandateLoss = {
          countryId: c.id,
          countryName: c.name,
          userId: c.controller.userId,
          username: c.controller.presidentName,
          reason: pol.mandateLost,
        };
        info.mandateLosses.push(loss);
        // Succession : l'IA reprend le contrôle, l'état du pays est intégralement préservé
        c.controller = { kind: 'ai', userId: null, presidentName: aiPresidentName(c.id), since: Date.now(), sinceDay: day };
        c.mandate.lowPopularityTicks = 0;
        c.mandate.warningsSent = 0;
        c.mandate.risk = 'faible';
        this.world.addJournal({
          day, type: 'mandate', countryIds: [c.id], actor: 'Système',
          text: `${c.name} : le gouvernement de ${loss.username} tombe (${loss.reason}). Un dirigeant IA assure la succession — l'État continue.`,
        });
      }

      // Série historique quotidienne
      c.series.push({
        day,
        gdp: c.economy.gdp,
        population: round(c.population, 3),
        cash: c.economy.cash,
        debt: c.economy.debt,
        inflation: c.economy.inflation,
        unemployment: c.economy.unemployment,
        popularity: c.popularity,
        stability: c.stability,
        growth: c.economy.growth,
        balance: c.economy.balance,
        living: c.economy.standardOfLiving,
      });
      if (c.series.length > 160) c.series.shift();

      // Alertes (ids stables, état "lu" préservé)
      const oldRead = new Map(c.alerts.map((a) => [a.id, a.read]));
      const newAlerts: Alert[] = politicalAlerts(c).map((a) => ({
        ...a,
        id: a.id,
        day,
        read: oldRead.get(a.id) ?? false,
      }));
      for (const ev of c.activeEvents.slice(0, 4)) {
        if (!newAlerts.some((a) => a.id === `ev_${ev.id}`)) {
          newAlerts.push({
            id: `ev_${ev.id}`,
            severity: 'info',
            title: ev.title,
            message: `${ev.description} (jusqu'au jour ${ev.endsDay})`,
            day: ev.startedDay,
            read: oldRead.get(`ev_${ev.id}`) ?? false,
          });
        }
      }
      c.alerts = newAlerts.slice(-14);

      c.updatedAt = Date.now();
      this.world.markDirty(c.id);
    }

    /* ---- 10. Diplomatie ---- */
    const diploEvents = processDiplomacy(this.world);
    for (const de of diploEvents) {
      const [aId, bId] = de.countryIds;
      const a = this.world.country(aId);
      const b = this.world.country(bId);
      this.world.addJournal({
        day, type: 'diplomacy', countryIds: [aId, bId], actor: 'Système',
        text: `L'accord ${de.agreement.type.replace(/_/g, ' ')} entre ${a?.name ?? aId} et ${b?.name ?? bId} a expiré.`,
      });
      if (a) this.notifyController(a, { type: 'diplomacy', title: 'Accord expiré', body: `Votre accord avec ${b?.name ?? bId} a expiré.`, day });
    }

    /* ---- 11. IA des pays ---- */
    const notifyHook = this.hooks.notifyUser
      ? (userId: string, n: Parameters<NonNullable<EngineHooks['notifyUser']>>[1]) => { void this.hooks.notifyUser?.(userId, n); }
      : undefined;

    /* ---- 10b. Offres de vente inter-états : expiration ---- */
    this.world.expireOffers(day);

    /* ---- 10c. Livraisons exceptionnelles sans réponse : retour à l'expéditeur ---- */
    const expiredDeliveries = expirePendingDeliveries(this.world, notifyHook);
    if (expiredDeliveries > 0) {
      log.debug(`${expiredDeliveries} livraison(s) expirée(s) retournée(s) à l'expéditeur`);
    }

    const bigWinHook = (bw: { countryId: string; amount: number; source: string }): void => {
      const g = this.world.country(bw.countryId);
      if (g && g.controller.kind === 'player' && g.controller.userId) {
        this.hooks.onBigWin?.(g.controller.userId, bw.amount, bw.source);
      }
    };
    const aiRes = processAI(this.world, rng, notifyHook, bigWinHook);
    info.aiDecisions = aiRes.decisions;
    info.offersRevision = this.world.offersRevision;


    /* ---- 12. Meta + intégrité ---- */
    meta.lastTickAt = Date.now();
    meta.lastTickDurationMs = Date.now() - t0;
    meta.lastError = null;
    this.world.bumpVersion();
    this.world.markMetaDirty();

    /* ---- 13. Persistance ----
       Chaque tick : sauvegarde LÉGÈRE (meta + marché, quelques Ko).
       Tous les N ticks : sauvegarde COMPLÈTE (pays compressés).
       Les actions joueurs/admin sauvegardent immédiatement par ailleurs. */
    if (!opts.silent) {
      this.world.markMetaDirty();
      await this.world.saveLight();
      if (meta.tick % config.persistEveryTicks === 0) {
        await this.world.save();
      }
    }
    info.durationMs = meta.lastTickDurationMs;
    this.lastInfo = info;
    if (meta.tick % 12 === 0) {
      log.info(`Tick ${meta.tick} (jour ${day}) en ${meta.lastTickDurationMs} ms — ${tradeRes.routeCount} routes, ${aiRes.actionsExecuted} action(s) IA`);
    }
    return info;
  }

  private async emitTick(info: TickInfo): Promise<void> {
    if (!this.hooks.onTickCompleted) return;
    try {
      await this.hooks.onTickCompleted(this.world, info);
    } catch (e) {
      log.error('Erreur hook onTickCompleted', String(e));
    }
    if (info.aiDecisions.length > 0 && this.hooks.onAiDecisions) {
      try {
        await this.hooks.onAiDecisions(info.aiDecisions);
      } catch (e) {
        log.error('Erreur hook onAiDecisions', String(e));
      }
    }
    for (const loss of info.mandateLosses) {
      if (this.hooks.onMandateLost) {
        try {
          await this.hooks.onMandateLost(loss);
        } catch (e) {
          log.error('Erreur hook onMandateLost', String(e));
        }
      }
    }
  }

  private notifyController(
    c: Country,
    n: { type: import('shared').ResourceType; title: string; body: string; day: number },
  ): void {
    if (c.controller.kind === 'player' && c.controller.userId && this.hooks.notifyUser) {
      void this.hooks.notifyUser(c.controller.userId, n);
    }
  }

  /** Utilitaire admin : force N ticks immédiats (tests/supervision).
   *  Chaque tick émet ses hooks (pertes de mandat, événements…) — rien n'est perdu. */
  async forceTicks(n: number): Promise<TickInfo | null> {
    let last: TickInfo | null = null;
    for (let i = 0; i < n; i++) {
      last = await this.tickNow();
      await this.emitTick(last);
    }
    await this.world.save();
    return last;
  }

  /** Vérifie qu'aucune valeur du monde n'est corrompue (page admin / tests). */
  validateWorld(): string[] {
    const problems: string[] = [];
    const seenPresidents = new Map<string, string>();
    for (const c of this.world.allCountries()) {
      for (const [path, v] of [
        ['economy.gdp', c.economy.gdp], ['economy.cash', c.economy.cash], ['economy.debt', c.economy.debt],
        ['economy.inflation', c.economy.inflation], ['population', c.population],
        ['popularity', c.popularity], ['stability', c.stability],
      ] as [string, number][]) {
        if (!Number.isFinite(v)) problems.push(`${c.id}.${path} = ${v}`);
      }
      if (c.population <= 0) problems.push(`${c.id} : population <= 0`);
      if (c.economy.gdp <= 0) problems.push(`${c.id} : PIB <= 0`);
      if (c.economy.debt < 0) problems.push(`${c.id} : dette négative`);
      for (const [k, r] of Object.entries(c.resources)) {
        if (r.stock < -0.001) problems.push(`${c.id}.resources.${k}.stock < 0`);
        if (!Number.isFinite(r.price) || r.price <= 0) problems.push(`${c.id}.resources.${k}.price invalide`);
      }
      for (const [oid, rel] of Object.entries(c.relations)) {
        if (rel.score < 0 || rel.score > 100) problems.push(`${c.id}.rel.${oid}.score hors bornes`);
        const mirror = this.world.country(oid)?.relations[c.id];
        if (mirror && Math.abs(mirror.score - rel.score) > 0.01) {
          problems.push(`asymétrie relation ${c.id}<->${oid}`);
        }
      }
      if (c.controller.kind === 'player') {
        if (!c.controller.userId) problems.push(`${c.id} : président joueur sans userId`);
        else if (seenPresidents.has(c.controller.userId)) {
          problems.push(`double présidence : ${c.controller.userId} sur ${seenPresidents.get(c.controller.userId)} et ${c.id}`);
        } else {
          seenPresidents.set(c.controller.userId, c.id);
        }
      }
    }
    if (this.world.countries.size !== 36) problems.push(`nombre de pays : ${this.world.countries.size} ≠ 36`);
    const ids = new Set(this.world.allCountries().map((c) => c.id));
    if (ids.size !== this.world.countries.size) problems.push('ids de pays dupliqués');
    // transactions dupliquées ? + cohérence des contreparties et montants
    const txIds = new Set<string>();
    for (const tx of this.world.transactions) {
      if (txIds.has(tx.id)) problems.push(`transaction dupliquée : ${tx.id}`);
      txIds.add(tx.id);
      if (tx.fromId !== 'market' && !ids.has(tx.fromId)) problems.push(`transaction orpheline (émetteur) : ${tx.id}`);
      if (tx.toId !== 'market' && !ids.has(tx.toId)) problems.push(`transaction orpheline (récepteur) : ${tx.id}`);
      if (!Number.isFinite(tx.value) || tx.value < 0) problems.push(`transaction à valeur invalide : ${tx.id}`);
      if (!Number.isFinite(tx.units) || tx.units < 0) problems.push(`transaction à unités invalides : ${tx.id}`);
    }
    // livraisons en attente : références, montants et péages cohérents (aucune fuite)
    const dlvIds = new Set<string>();
    for (const d of this.world.pendingDeliveries) {
      if (dlvIds.has(d.id)) problems.push(`livraison dupliquée : ${d.id}`);
      dlvIds.add(d.id);
      if (!ids.has(d.fromId) || !ids.has(d.toId)) problems.push(`livraison orpheline : ${d.id}`);
      if (d.fromId === d.toId) problems.push(`livraison auto-référente : ${d.id}`);
      if (!Number.isFinite(d.units) || d.units <= 0) problems.push(`livraison à unités invalides : ${d.id}`);
      if (!Number.isFinite(d.value) || d.value < 0) problems.push(`livraison à valeur invalide : ${d.id}`);
      if (d.expiresDay < d.createdDay) problems.push(`livraison à échéance inversée : ${d.id}`);
      const legSum = d.legs.reduce((s, l) => s + (Number.isFinite(l.toll) ? l.toll : 0), 0);
      if (Math.abs(legSum - d.toll) > 0.01) problems.push(`livraison à péages incohérents : ${d.id}`);
    }
    // offres inter-états : vendeur connu, prix et quantités sains
    for (const o of this.world.offers) {
      if (!ids.has(o.sellerId)) problems.push(`offre orpheline : ${o.id}`);
      if (!Number.isFinite(o.units) || o.units <= 0) problems.push(`offre à unités invalides : ${o.id}`);
      if (!Number.isFinite(o.unitPrice) || o.unitPrice <= 0) problems.push(`offre à prix invalide : ${o.id}`);
    }
    return problems;
  }
}
