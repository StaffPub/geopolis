/**
 * GEOPOLIS — Protocole WebSocket (client ↔ serveur).
 * Messages structurés, mises à jour ciblées (jamais le monde entier à chaque seconde).
 */
import type {
  ActiveEvent,
  Country,
  GameNotification,
  JournalEntry,
  MarketResource,
  PresenceEntry,
  PublicCountry,
  ResourceKey,
  TradeRoute,
  TradeTransaction,
  WorldMeta,
} from './types.js';

/* ------------------------------ Client → Serveur ------------------------------ */

export type ClientMessage =
  | { type: 'hello'; token: string }
  | { type: 'ping'; t: number }
  | { type: 'subscribe'; countryId: string }
  | { type: 'unsubscribe' }
  | { type: 'request_full_sync' };

/* ------------------------------ Serveur → Client ------------------------------ */

export interface WorldSnapshotMessage {
  type: 'world_snapshot';
  meta: WorldMeta;
  actors: { total: number; humans: number; ai: number; humansOnline: number };
  market: Record<ResourceKey, MarketResource>;
  countries: PublicCountry[];
  flows: TradeRoute[];
  activeEventCount: number;
  activeTradeCount: number;
}

export interface CountrySnapshotMessage {
  type: 'country_snapshot';
  country: Country;
  relationsSummary: RelationSummary[];
}

export interface RelationSummary {
  countryId: string;
  name: string;
  color: string;
  score: number;
  trust: number;
  sanctionByUs: boolean;
  sanctionByThem: boolean;
  agreements: { id: string; type: string; status: string }[];
  tradeVolume: number;
}

export type ServerMessage =
  | WorldSnapshotMessage
  | CountrySnapshotMessage
  | { type: 'world_update'; meta: WorldMeta; actors: { total: number; humans: number; ai: number; humansOnline: number }; activeEventCount: number; activeTradeCount: number }
  | { type: 'market_update'; market: Record<ResourceKey, MarketResource> }
  | { type: 'country_update'; country: Country; relationsSummary: RelationSummary[] }
  | { type: 'country_public_update'; countries: PublicCountry[] }
  | { type: 'trade_update'; flows: TradeRoute[] }
  | { type: 'diplomacy_update'; countryId: string; relationsSummary: RelationSummary[] }
  | { type: 'event_created'; event: ActiveEvent }
  | { type: 'event_ended'; eventId: string; countryIds: string[] }
  | { type: 'notification_created'; notification: GameNotification }
  | { type: 'presence_update'; presence: PresenceEntry[] }
  | { type: 'mandate_update'; countryId: string; controllerKind: 'ai' | 'player'; presidentName: string; reason?: string }
  | { type: 'journal_update'; entries: JournalEntry[] }
  | { type: 'transaction_update'; transactions: TradeTransaction[] }
  | { type: 'offers_update'; offers: import('./types.js').TradeOffer[] }
  | { type: 'deliveries_update'; deliveries: import('./types.js').PendingDelivery[] }
  | { type: 'bigwin'; amount: number; source: string }
  | { type: 'pong'; t: number }
  | { type: 'welcome'; userId: string; username: string; countryId: string | null; role: string }
  | { type: 'error'; code: string; message: string };

export const WS_CLOSE_CODES = {
  NORMAL: 1000,
  UNAUTHORIZED: 4001,
  RATE_LIMITED: 4008,
} as const;
