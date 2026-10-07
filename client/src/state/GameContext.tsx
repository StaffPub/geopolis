/**
 * GEOPOLIS — État du monde côté client.
 * Toutes les données affichées proviennent du serveur (WebSocket temps réel +
 * API). Le client ne simule rien : il met en scène l'état autoritaire.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import type {
  ActiveEvent, Country, GameNotification, JournalEntry, MarketResource,
  PresenceEntry, PublicCountry, RelationSummary, ResourceKey, ServerMessage,
  TradeOffer, TradeRoute, TradeTransaction, PendingDelivery, WorldMeta, ActionParams, ActionResult, ActionEstimate,
} from 'shared';
import { game as gameApi } from '../lib/api';
import { RealtimeClient, type ConnectionStatus } from '../lib/realtime';
import { useAuth } from './AuthContext.js';
import { JackpotOverlay } from '../components/JackpotOverlay.js';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  title: string;
  body?: string;
}

interface GameState {
  status: ConnectionStatus;
  meta: WorldMeta | null;
  actors: { total: number; humans: number; ai: number; humansOnline: number };
  market: Record<ResourceKey, MarketResource> | null;
  countries: PublicCountry[];
  flows: TradeRoute[];
  journal: JournalEntry[];
  transactions: TradeTransaction[];
  offers: TradeOffer[];
  deliveries: PendingDelivery[];
  events: ActiveEvent[];
  presence: PresenceEntry[];
  notifications: GameNotification[];
  myCountry: Country | null;
  relationsSummary: RelationSummary[];
  countryCache: Map<string, Country>;
  activeEventCount: number;
  activeTradeCount: number;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  selectCountry: (id: string | null) => Promise<void>;
  runAction: (countryId: string, params: ActionParams) => Promise<ActionResult>;
  estimateAction: (countryId: string, params: ActionParams) => Promise<{ ok: boolean; error?: string; effects?: ActionEstimate[] }>;
  refreshMyCountry: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
}

const GameContext = createContext<GameState | null>(null);

let toastId = 0;

export function GameProvider({ children }: { children: ReactNode }) {
  const { user, countryId, refresh: refreshAuth } = useAuth();

  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [meta, setMeta] = useState<WorldMeta | null>(null);
  const [actors, setActors] = useState({ total: 0, humans: 0, ai: 0, humansOnline: 0 });
  const [market, setMarket] = useState<Record<ResourceKey, MarketResource> | null>(null);
  const [countries, setCountries] = useState<PublicCountry[]>([]);
  const [flows, setFlows] = useState<TradeRoute[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [transactions, setTransactions] = useState<TradeTransaction[]>([]);
  const [offers, setOffers] = useState<TradeOffer[]>([]);
  /* File des célébrations « gain exceptionnel » (joueurs humains, temps réel). */
  const [bigWinQueue, setBigWinQueue] = useState<import('../components/JackpotOverlay.js').BigWinEvent[]>([]);
  const [deliveries, setDeliveries] = useState<PendingDelivery[]>([]);
  const [events, setEvents] = useState<ActiveEvent[]>([]);
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const [notifications, setNotifications] = useState<GameNotification[]>([]);
  const [myCountry, setMyCountry] = useState<Country | null>(null);
  const [relationsSummary, setRelationsSummary] = useState<RelationSummary[]>([]);
  const [countryCache, setCountryCache] = useState<Map<string, Country>>(new Map());
  const [activeEventCount, setActiveEventCount] = useState(0);
  const [activeTradeCount, setActiveTradeCount] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const subscribedRef = useRef<string | null>(null);
  const clientRef = useRef<RealtimeClient | null>(null);

  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    toastId += 1;
    const id = toastId;
    setToasts((prev) => [...prev.slice(-4), { ...t, id }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 6500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /* ----------------------------- Réception temps réel ----------------------------- */

  const handleSnapshotCountries = useCallback((list: PublicCountry[]) => {
    setCountries(list);
  }, []);

  const applyMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'world_snapshot':
        setMeta(msg.meta);
        setActors(msg.actors);
        setMarket(msg.market);
        handleSnapshotCountries(msg.countries);
        setFlows(msg.flows);
        setActiveEventCount(msg.activeEventCount);
        setActiveTradeCount(msg.activeTradeCount);
        break;
      case 'world_update':
        setMeta(msg.meta);
        setActors(msg.actors);
        setActiveEventCount(msg.activeEventCount);
        setActiveTradeCount(msg.activeTradeCount);
        break;
      case 'market_update':
        setMarket(msg.market);
        break;
      case 'country_public_update':
        handleSnapshotCountries(msg.countries);
        break;
      case 'country_snapshot':
      case 'country_update': {
        setCountryCache((prev) => {
          const next = new Map(prev);
          next.set(msg.country.id, msg.country);
          if (next.size > 40) {
            const firstKey = next.keys().next().value;
            if (firstKey !== undefined && firstKey !== msg.country.id) next.delete(firstKey);
          }
          return next;
        });
        if (msg.country.id === subscribedRef.current) {
          setMyCountry(msg.country);
          setRelationsSummary(msg.relationsSummary);
        }
        break;
      }
      case 'trade_update':
        setFlows(msg.flows);
        break;
      case 'diplomacy_update':
        if (msg.countryId === subscribedRef.current) setRelationsSummary(msg.relationsSummary);
        break;
      case 'journal_update':
        setJournal((prev) => {
          const known = new Set(prev.map((e) => e.id));
          const fresh = msg.entries.filter((e) => !known.has(e.id));
          if (fresh.length === 0) return prev;
          return [...fresh.reverse(), ...prev].slice(0, 150);
        });
        break;
      case 'transaction_update':
        setTransactions((prev) => {
          const known = new Set(prev.map((t) => t.id));
          const fresh = msg.transactions.filter((t) => !known.has(t.id));
          if (fresh.length === 0) return prev;
          return [...fresh.reverse(), ...prev].slice(0, 120);
        });
        break;
      case 'offers_update':
        setOffers(msg.offers);
        break;
      case 'deliveries_update':
        setDeliveries(msg.deliveries);
        break;
      case 'bigwin':
        setBigWinQueue((q) => [...q, { id: Date.now() + Math.random(), amount: msg.amount, source: msg.source }]);
        break;
      case 'event_created':
        setEvents((prev) => (prev.some((e) => e.id === msg.event.id) ? prev : [msg.event, ...prev].slice(0, 60)));
        break;
      case 'event_ended':
        setEvents((prev) => prev.filter((e) => e.id !== msg.eventId));
        break;
      case 'notification_created':
        setNotifications((prev) => [msg.notification, ...prev].slice(0, 80));
        pushToast({ kind: 'info', title: msg.notification.title, body: msg.notification.body });
        // Une notification de mandat (chute, reseed admin…) resynchronise le compte
        if (msg.notification.type === 'mandate') void refreshAuth();
        break;
      case 'presence_update':
        setPresence(msg.presence);
        break;
      case 'mandate_update':
        setCountries((prev) =>
          prev.map((c) =>
            c.id === msg.countryId
              ? { ...c, controllerKind: msg.controllerKind, presidentName: msg.presidentName }
              : c,
          ),
        );
        if (msg.reason) {
          pushToast({ kind: 'error', title: 'Changement de gouvernement', body: `${msg.reason}` });
        }
        void refreshAuth();
        break;
      case 'welcome':
        break;
      case 'pong':
        break;
      case 'error':
        pushToast({ kind: 'error', title: 'Erreur serveur', body: msg.message });
        break;
      default:
        break;
    }
  }, [handleSnapshotCountries, pushToast, refreshAuth]);

  /* ----------------------------- Connexion WS + fallback ----------------------------- */

  useEffect(() => {
    const client = new RealtimeClient({
      onMessage: applyMessage,
      onStatusChange: setStatus,
      pollWorld: async () => {
        try {
          const snap = await gameApi.worldSnapshot();
          applyMessage({
            type: 'world_snapshot',
            meta: snap.meta,
            actors: snap.actors,
            market: snap.market,
            countries: snap.countries,
            flows: snap.flows,
            activeEventCount: snap.activeEvents,
            activeTradeCount: snap.activeTrades,
          });
          // Offres + livraisons en attente : rafraîchies même en mode secours
          const [offersRes, deliveriesRes] = await Promise.all([
            gameApi.offers().catch(() => null),
            gameApi.deliveries().catch(() => null),
          ]);
          if (offersRes) setOffers(offersRes.offers);
          if (deliveriesRes) setDeliveries(deliveriesRes.deliveries);
        } catch {
          /* le polling échoue silencieusement : la reconnexion WS prendra le relais */
        }
      },
    });
    clientRef.current = client;
    client.connect();
    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [applyMessage]);

  /* ----------------------------- Détection de redéploiement -----------------------------
     Si le serveur redémarre (nouveau deploy → nouveau bundle), le client se
     recharge une fois proprement pour éviter tout cache périmé. */
  useEffect(() => {
    let firstBoot: string | null = null;
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch('/api/health');
        if (!res.ok || stopped) return;
        const h = (await res.json()) as { bootId?: string };
        if (!h.bootId) return;
        if (firstBoot === null) {
          firstBoot = h.bootId;
          return;
        }
        if (h.bootId !== firstBoot) {
          const key = `gp-reloaded-${h.bootId}`;
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, '1');
            window.location.reload();
          }
        }
      } catch {
        /* serveur injoignable : le WS/polling gère déjà la reprise */
      }
    };
    void check();
    const t = window.setInterval(check, 90_000);
    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, []);

  /* ----------------------------- Abonnements & chargements initiaux ----------------------------- */

  const selectCountry = useCallback(async (id: string | null) => {
    subscribedRef.current = id;
    if (!id) {
      clientRef.current?.unsubscribe();
      setMyCountry(null);
      setRelationsSummary([]);
      return;
    }
    // Chargement HTTP immédiat (le WS suivra avec les mises à jour)
    try {
      const res = await gameApi.country(id);
      setMyCountry(res.country);
      setRelationsSummary(res.relationsSummary);
      setCountryCache((prev) => new Map(prev).set(id, res.country));
    } catch {
      /* le snapshot WS arrivera */
    }
    clientRef.current?.subscribe(id);
  }, []);

  useEffect(() => {
    if (user && countryId) {
      void selectCountry(countryId);
    } else if (!countryId) {
      subscribedRef.current = null;
      clientRef.current?.unsubscribe();
    }
  }, [user, countryId, selectCountry]);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }
    void gameApi.notifications().then((r) => setNotifications(r.notifications)).catch(() => undefined);
    void gameApi.events().then((r) => setEvents(r.events)).catch(() => undefined);
    void gameApi.journal({ limit: 60 }).then((r) => setJournal(r.entries)).catch(() => undefined);
    void gameApi.offers().then((r) => setOffers(r.offers)).catch(() => undefined);
    void gameApi.deliveries().then((r) => setDeliveries(r.deliveries)).catch(() => undefined);
  }, [user]);

  /* ----------------------------- Actions ----------------------------- */

  const refreshMyCountry = useCallback(async () => {
    const id = subscribedRef.current;
    if (!id) return;
    try {
      const res = await gameApi.country(id);
      setMyCountry(res.country);
      setRelationsSummary(res.relationsSummary);
    } catch {
      /* ignore : le tick suivant resynchronisera */
    }
  }, []);

  /* Identité STABLE : sinon chaque render (push WS) recréait le callback et
     réinitialisait le timer de 15 s de la célébration → ne se terminait jamais. */
  const dismissBigWin = useCallback((id: number) => {
    setBigWinQueue((q) => q.filter((x) => x.id !== id));
  }, []);

  const runAction = useCallback(async (targetCountryId: string, params: ActionParams): Promise<ActionResult> => {
    const res = await gameApi.action(targetCountryId, params);
    if (res.ok) {
      pushToast({ kind: 'success', title: res.message ?? 'Action appliquée', body: res.effects?.slice(0, 3).map((e) => `${e.label} : ${e.value}`).join(' · ') });
      await refreshMyCountry();
    } else {
      pushToast({ kind: 'error', title: 'Action refusée', body: res.error });
    }
    return res;
  }, [pushToast, refreshMyCountry]);

  const estimateAction = useCallback(async (targetCountryId: string, params: ActionParams) => {
    try {
      return await gameApi.estimate(targetCountryId, params);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Erreur' };
    }
  }, []);

  const markNotificationRead = useCallback(async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await gameApi.markRead(id).catch(() => undefined);
  }, []);

  const markAllNotificationsRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await gameApi.markAllRead().catch(() => undefined);
  }, []);

  const value = useMemo<GameState>(() => ({
    status, meta, actors, market, countries, flows, journal, transactions, events, presence,
    notifications, myCountry, relationsSummary, countryCache, activeEventCount, activeTradeCount,
    offers, deliveries, toasts, pushToast, dismissToast, selectCountry, runAction, estimateAction, refreshMyCountry,
    markNotificationRead, markAllNotificationsRead,
  }), [
    status, meta, actors, market, countries, flows, journal, transactions, events, presence,
    notifications, myCountry, relationsSummary, countryCache, activeEventCount, activeTradeCount,
    offers, deliveries, toasts, pushToast, dismissToast, selectCountry, runAction, estimateAction, refreshMyCountry,
    markNotificationRead, markAllNotificationsRead,
  ]);

  return (
    <GameContext.Provider value={value}>
      {children}
      {bigWinQueue[0] && <JackpotOverlay event={bigWinQueue[0]} onDone={dismissBigWin} />}
    </GameContext.Provider>
  );
}

export function useGame(): GameState {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame doit être utilisé dans GameProvider');
  return ctx;
}
