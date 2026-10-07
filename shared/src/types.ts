/**
 * GEOPOLIS — Types partagés (client + serveur).
 * Source de vérité unique pour toutes les structures de données du jeu.
 */

export type ResourceKey =
  | 'food'
  | 'energy'
  | 'oil'
  | 'gas'
  | 'minerals'
  | 'materials'
  | 'industrial'
  | 'tech';

export type SectorKey = 'agriculture' | 'industry' | 'energy' | 'services' | 'tech';

export type InfraKey =
  | 'roads'
  | 'ports'
  | 'rail'
  | 'powerGrid'
  | 'plants'
  | 'housing'
  | 'schools'
  | 'universities'
  | 'hospitals'
  | 'industrialZones'
  | 'techHubs'
  | 'logistics'
  | 'airports'
  | 'telecom'
  | 'research'
  | 'water'
  | 'finance'
  | 'culture';

/** Bâtiments de production achetables (onglet Production) : 2 paliers par ressource. */
export type FacilityKey =
  | 'farm' | 'agriplex'
  | 'solar' | 'nuclear'
  | 'well' | 'offshore'
  | 'gasfield' | 'lng'
  | 'quarry' | 'deepmine'
  | 'sawmill' | 'foundry'
  | 'workshop' | 'gigafactory'
  | 'lab' | 'campus';

export type SpendingKey =
  | 'health'
  | 'education'
  | 'transport'
  | 'energy'
  | 'industry'
  | 'agriculture'
  | 'research'
  | 'social';

export type AgreementType =
  | 'free_trade'
  | 'economic_treaty'
  | 'tech_cooperation'
  | 'trade_zone'
  | 'aid_pact';

export type AgreementStatus = 'proposed' | 'active' | 'rejected' | 'expired';

export type RegimeType =
  | 'République démocratique'
  | 'République parlementaire'
  | 'République fédérale'
  | 'Fédération'
  | 'Monarchie constitutionnelle'
  | 'Technocratie';

export type ControllerKind = 'ai' | 'player';

export type JournalType =
  | 'economy'
  | 'politics'
  | 'diplomacy'
  | 'trade'
  | 'infrastructure'
  | 'event'
  | 'population'
  | 'mandate'
  | 'ai'
  | 'admin';

export type ResourceType =
  | 'economy'
  | 'politics'
  | 'diplomacy'
  | 'resources'
  | 'infrastructure'
  | 'event'
  | 'mandate'
  | 'trade';

/* ---------------------------------- Ressources & marchés ---------------------------------- */

export interface ResourceState {
  stock: number;          // unités en stock
  capacity: number;       // capacité maximale de stockage
  production: number;     // unités / jour
  consumption: number;    // unités / jour
  price: number;          // prix local (€ / unité)
}

export interface MarketResource {
  key: ResourceKey;
  price: number;          // prix mondial
  prevPrice: number;
  change24h: number;      // % sur 24 ticks (jours)
  series: number[];       // historique (derniers points)
}

/* ---------------------------------- Politiques ---------------------------------- */

export interface PolicyState {
  taxRate: number;        // % fiscalité générale
  corporateTax: number;   // % impôt sur les sociétés
  tariff: number;         // % tarif douanier par défaut
  interestRate: number;   // % taux directeur
  spending: Record<SpendingKey, number>; // % du PIB annuel alloué par secteur
}

/* ---------------------------------- Accords & relations ---------------------------------- */

export interface Agreement {
  id: string;
  type: AgreementType;
  status: AgreementStatus;
  fromId: string;         // initiateur
  toId: string;           // destinataire
  createdDay: number;
  expiresDay: number | null;
}

export interface Relation {
  score: number;          // 0..100 (50 = neutre)
  trust: number;          // 0..100
  sanctionByUs: boolean;  // nous avons imposé une mesure économique
  sanctionByThem: boolean;
  agreements: Agreement[];
  tradeVolume: number;    // valeur quotidienne actuelle
  lastContactDay: number;
}

/* ---------------------------------- Infrastructures ---------------------------------- */

export interface InfraState {
  level: number;          // 0..10
}

/** État des bâtiments de production d'un pays : possédés + file de construction. */
export interface FacilityState {
  owned: number;
  /** Lots en construction : deviennent « owned » au jour readyDay. */
  queue: { count: number; readyDay: number }[];
}

export interface Project {
  id: string;
  infra: InfraKey;
  targetLevel: number;
  startedDay: number;
  buildDays: number;
  progress: number;       // 0..1
  cost: number;           // coût total (Md €)
  invested: number;
}

/* ---------------------------------- Lois ---------------------------------- */

export interface ActiveLaw {
  id: string;             // instance id
  lawId: string;          // catalog id
  enactedDay: number;
}

/* ---------------------------------- Événements ---------------------------------- */

export interface ActiveEvent {
  id: string;
  eventId: string;        // catalog id
  title: string;
  description: string;
  countryIds: string[];
  startedDay: number;
  endsDay: number;
  source: string;         // ce qui a déclenché l'événement
  modifiers: EventModifiers;
}

export interface EventModifiers {
  productionMul?: Partial<Record<SectorKey, number>>;
  consumptionMul?: Partial<Record<ResourceKey, number>>;
  priceMul?: Partial<Record<ResourceKey, number>>;
  popularityDelta?: number;   // par jour
  stabilityDelta?: number;
  growthDelta?: number;
  inflationDelta?: number;
  unemploymentDelta?: number;
}

/* ---------------------------------- Alertes ---------------------------------- */

export interface Alert {
  id: string;
  severity: 'info' | 'warning' | 'critical' | 'opportunity' | 'politics' | 'trade';
  title: string;
  message: string;
  day: number;
  read: boolean;
}

/* ---------------------------------- Économie ---------------------------------- */

export interface EconomyState {
  gdp: number;            // Md € (annuel)
  growth: number;         // % annuel
  inflation: number;      // % annuel
  unemployment: number;   // %
  productivity: number;   // indice 0..200 (100 = base)
  consumptionIndex: number; // indice 0..200
  investment: number;     // Md € / an
  standardOfLiving: number; // indice 0..100
  cash: number;           // Md € trésorerie
  debt: number;           // Md € dette publique
  revenue: number;        // Md € / an
  spending: number;       // Md € / an
  balance: number;        // Md € / an (revenue - spending)
  interestPaid: number;   // Md € / an
  /** Croissance structurelle de référence (seed réel), ancre du modèle. */
  growthPotential: number;
  /** Décomposition pédagogique de la croissance (contributions en points de %). */
  growthBreakdown?: GrowthBreakdown;
}

export interface GrowthBreakdown {
  base: number;        // potentiel structurel (investissement, productivité)
  commerce: number;    // solde commercial & ouverture
  inflation: number;   // frein inflation (négatif)
  taux: number;        // frein taux directeur (négatif)
  penuries: number;    // frein pénuries/énergie (négatif)
  dette: number;       // frein dette (négatif)
  evenements: number;  // événements en cours (+/-)
  regime: number;      // régime politique + lune de miel (+/-)
  total: number;       // cible de croissance résultante
}

export interface SectorState {
  output: number;         // Md € / an
  capacity: number;       // indice 0..200
  employment: number;     // % de la population active
}

/* ---------------------------------- Séries historiques ---------------------------------- */

export interface SeriesPoint {
  day: number;
  gdp: number;
  population: number;
  cash: number;
  debt: number;
  inflation: number;
  unemployment: number;
  popularity: number;
  stability: number;
  growth: number;
  balance: number;
  living: number;
}

/* ---------------------------------- Journal ---------------------------------- */

export interface JournalEntry {
  id: string;
  day: number;
  ts: number;             // epoch ms réel
  type: JournalType;
  countryIds: string[];
  actor: string;          // nom du président / "IA" / "Système" / pseudo joueur
  text: string;
  payload?: Record<string, unknown>;
}


/* ---------------------------------- Mandat ---------------------------------- */

export interface MandateState {
  lowPopularityTicks: number;
  risk: 'faible' | 'modéré' | 'élevé' | 'critique';
  warningsSent: number;
  popularityTrend: number; // variation récente (%)
}

/* ---------------------------------- IA ---------------------------------- */

export type AIStrategy =
  | 'industrielle'
  | 'commerciale'
  | 'ressources'
  | 'innovation'
  | 'agricole'
  | 'équilibrée'
  | 'sociale'
  | 'financière';

export interface AIPersonality {
  strategy: AIStrategy;
  debtTolerance: number;   // 0..1 (tolérance au déficit)
  taxPreference: number;   // 0..1 (0 = baisse d'impôts, 1 = fiscalité haute)
  tradeOpenness: number;   // 0..1
  diplomacy: number;       // 0..1 (0 = unilatéral, 1 = coopératif)
  growthFocus: number;     // 0..1
  stabilityFocus: number;  // 0..1
  sectorFocus: Partial<Record<SectorKey, number>>;
}

export interface AIState {
  personality: AIPersonality;
  lastDecisionTick: number;
  nextDecisionTick: number;
  lastActionDay: number;
  recentProblems: string[];
  /** Poids appris par type d'action (renforcement : ce qui a marché pèse plus). */
  learned: Record<string, number>;
  /** Dernières actions jugées sur résultat : { action, problème, jour }. */
  lastMoves: { action: string; problem: string; day: number }[];
  /** Métriques du dernier cycle évalué (apprentissage par comparaison). */
  memory: { day: number; popularity: number; balance: number; cash: number } | null;
}

/* ---------------------------------- Contrôleur ---------------------------------- */

export interface Controller {
  kind: ControllerKind;
  userId: string | null;
  presidentName: string;
  since: number;          // epoch ms
  sinceDay: number;
}

/* ---------------------------------- Pays ---------------------------------- */

export interface Country {
  id: string;
  name: string;
  code: string;           // code court (3 lettres)
  color: string;
  region: string;
  capital: string;
  difficulty: number;     // 1..5
  createdAt: number;
  updatedAt: number;

  population: number;     // millions
  controller: Controller;
  regime: RegimeType;

  economy: EconomyState;
  policy: PolicyState;
  sectors: Record<SectorKey, SectorState>;
  resources: Record<ResourceKey, ResourceState>;
  endowment: Partial<Record<ResourceKey, number>>; // richesse naturelle 0..1
  infra: Record<InfraKey, InfraState>;
  facilities: Record<FacilityKey, FacilityState>;
  projects: Project[];
  laws: ActiveLaw[];
  relations: Record<string, Relation>; // key = autre countryId

  popularity: number;     // 0..100
  stability: number;      // 0..100
  mandate: MandateState;

  tariffOverrides: Record<string, number>; // countryId → tarif spécifique (%)
  actionCooldowns: Record<string, number>; // actionType → day de fin de cooldown
  routePrefs: Record<string, string>;      // partnerId → pathId de route choisi ('auto' par défaut)
  /** Jour du dernier changement de régime (transition historique). */
  regimeSinceDay: number;
  /** Lune de miel / gueule de bois post-changement de régime (bonus ou malus temporaire). */
  regimeHoneymoon: { untilDay: number; popularityDaily: number; growthDelta: number } | null;
  /** Consignes de production par ressource : absente/normal = 1, boost = +15 %, slow = −12 %. */
  productionDirectives: Partial<Record<ResourceKey, 'boost' | 'slow'>>;

  ai: AIState;
  series: SeriesPoint[];
  history: JournalEntry[];
  alerts: Alert[];
  activeEvents: ActiveEvent[];
  transactions: TradeTransaction[];
}

/* ---------------------------------- Commerce ---------------------------------- */

export interface TradeRoute {
  id: string;             // `${from}->${to}:${resource}`
  fromId: string;
  toId: string;
  resource: ResourceKey;
  volume: number;         // unités / jour
  value: number;          // Md € / jour
  updatedDay: number;
  corridors?: string[];   // corridors empruntés par ce flux (multi-étapes)
}

/** Route commerciale stratégique (corridor) : achetable, taxable, entretenue. */
export interface TradeCorridor {
  id: string;
  name: string;
  description: string;
  owner: string | null;          // countryId propriétaire, null = voie libre
  toll: number;                  // % prélevé sur la valeur transitante (fixé par le proprio)
  purchaseCost: number;          // Md € à l'achat
  upkeep: number;                // Md € / an d'entretien
  hubs: [string, string];        // ancres géographiques (countryIds) pour la carte
  regions: [string, string];     // régions reliées
  traffic: number;               // valeur cumulée transitée (Md €) — sert à la carte/IA
}

/** Combination de routes (multi-étapes) entre deux pays. */
export interface RouteOption {
  id: string;
  label: string;
  corridors: string[];
  tollRate: number;
  freightRate: number;
  costRate: number;
}

/** Expédition manuelle (échange commercial décidé par un président ou une IA). */
export interface Shipment {
  id: string;
  day: number;
  fromId: string;
  toId: string;
  resource: ResourceKey;
  units: number;
  value: number;        // Md € payés par l'importateur
  toll: number;         // Md € prélevés par les propriétaires des corridors traversés
  corridorId: string;   // id du corridor, combinaison 'a+b', ou 'auto' (meilleure route)
}

/** Offre de vente d'un pays sur le marché inter-états : les autres nations
 *  (IA et joueurs) peuvent l'acheter. Le vendeur garde la marchandise jusqu'à
 *  la vente : rien n'est bloqué, mais il doit encore avoir le stock au moment
 *  de la transaction (sinon l'offre expire d'elle-même). */
export interface TradeOffer {
  id: string;
  sellerId: string;
  resource: ResourceKey;
  units: number;
  /** Md € par unité. */
  unitPrice: number;
  createdDay: number;
  expiresDay: number;
  status: 'open' | 'sold' | 'expired' | 'cancelled';
  buyerId?: string;
}

export interface TradeTransaction {
  id: string;
  day: number;
  ts: number;
  fromId: string;
  toId: string;
  resource: ResourceKey;
  units: number;
  value: number;          // Md €
  kind: 'export' | 'import' | 'aid' | 'deal';
  note?: string;
}

/** Livraison exceptionnelle en attente d'ACCEPTATION par le destinataire.
 *  Le stock de l'expéditeur est réservé (débité) dès l'expédition ; l'argent
 *  ne bouge qu'à l'acceptation : le destinataire est débité de la valeur et
 *  reçoit les ressources (aucune création monétaire). Refus ou expiration →
 *  les unités retournent à l'expéditeur. */
export interface PendingDelivery {
  id: string;
  createdDay: number;
  expiresDay: number;       // au-delà : retour automatique à l'expéditeur
  fromId: string;
  toId: string;
  resource: ResourceKey;
  units: number;            // unités réservées sur le stock de l'expéditeur
  value: number;            // Md € que le destinataire paiera à l'acceptation
  toll: number;             // Md € de péages (propriétaires des routes traversées)
  freight: number;          // Md € de fret logistique (coût perdu)
  routeLabel: string;       // nom de la combinaison de routes empruntée
  corridors: string[];      // ids des corridors traversés
  legs: { corridorId: string; ownerId: string | null; toll: number }[];
  status: 'pending';
}

/* ---------------------------------- Utilisateurs ---------------------------------- */

export type UserRole = 'user' | 'admin';

export interface User {
  id: string;
  username: string;
  email: string;          // normalisé (minuscules)
  passwordHash: string;
  role: UserRole;
  countryId: string | null;
  suspended: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  /** Époque (ms) à partir de laquelle le joueur peut reprendre un pays.
   *  Posé après un départ volontaire (release) ou une expulsion admin :
   *  4 jours RÉELS sans nouveau mandat (anti-abus de transfert). */
  countryCooldownUntil?: number | null;
}

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  countryId: string | null;
  suspended: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  countryCooldownUntil: number | null;
}

export interface Session {
  tokenHash: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
}

export interface GameNotification {
  id: string;
  userId: string;
  type: ResourceType;
  title: string;
  body: string;
  day: number;
  ts: number;
  read: boolean;
  action?:
    | {
        kind: 'respond_proposal';
        proposalId: string;
        countryId: string;
        fromCountry: string;
        agreementType: AgreementType;
      }
    | {
        kind: 'respond_delivery';
        deliveryId: string;
        countryId: string;
        fromCountry: string;
        resource: ResourceKey;
        units: number;
        value: number;
        expiresDay: number;
      };
}

export interface AuditLog {
  id: string;
  ts: number;
  day: number;
  actorId: string | null;   // userId ou 'system' ou 'ai'
  actorName: string;
  countryId: string | null;
  type: string;
  detail: string;
  result: 'ok' | 'rejected' | 'error';
}

/* ---------------------------------- Monde ---------------------------------- */

export interface WorldMeta {
  version: number;          // worldVersion globale
  tick: number;             // compteur de ticks
  day: number;              // jour de jeu
  startedAt: number;        // epoch ms
  lastTickAt: number;       // epoch ms
  lastTickDurationMs: number;
  simVersion: string;
  seededAt: number;
  leaderId: string | null;
  integrityIssues: number;
  lastError: string | null;
  lastErrorAt: number | null;
}

export interface PublicCountry {
  id: string;
  name: string;
  code: string;
  color: string;
  region: string;
  population: number;
  gdp: number;
  growth: number;
  inflation: number;
  unemployment: number;
  popularity: number;
  stability: number;
  standardOfLiving: number;
  controllerKind: ControllerKind;
  presidentName: string;
  difficulty: number;
  debtRatio: number;
  strategy: string;
}

export interface WorldSummary {
  meta: WorldMeta;
  actors: { total: number; humans: number; ai: number; humansOnline: number };
  nations: number;
  activeTrades: number;
  activeEvents: number;
  market: Record<ResourceKey, MarketResource>;
  countries: PublicCountry[];
  flows: TradeRoute[];
}

export interface PresenceEntry {
  userId: string;
  username: string;
  countryId: string | null;
  countryName: string | null;
  since: number;
  isAi: boolean;
}

/* ---------------------------------- Actions ---------------------------------- */

export interface ActionEstimate {
  label: string;
  value: string;
  positive: boolean;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  effects?: ActionEstimate[];
  journal?: string;
  /** Gain commercial unique ≥ BIG_WIN_THRESHOLD encaissé par un pays :
   *  déclenche la célébration temps réel si ce pays est dirigé par un humain. */
  bigWin?: { countryId: string; amount: number; source: string };
}

export type ActionParams =
  | { type: 'set_tax'; value: number }
  | { type: 'set_corporate_tax'; value: number }
  | { type: 'set_tariff'; value: number; partnerId?: string }
  | { type: 'set_interest_rate'; value: number }
  | { type: 'set_spending'; sector: SpendingKey; value: number }
  | { type: 'start_project'; infra: InfraKey }
  | { type: 'cancel_project'; projectId: string }
  | { type: 'enact_law'; lawId: string }
  | { type: 'repeal_law'; lawId: string }
  | { type: 'propose_agreement'; targetId: string; agreementType: AgreementType }
  | { type: 'respond_proposal'; proposalId: string; accept: boolean }
  | { type: 'improve_relations'; targetId: string }
  | { type: 'send_aid'; targetId: string; amount: number }
  | { type: 'impose_sanction'; targetId: string }
  | { type: 'lift_sanction'; targetId: string }
  | { type: 'buy_resource'; resource: ResourceKey; units: number }
  | { type: 'buy_corridor'; corridorId: string }
  | { type: 'abandon_corridor'; corridorId: string }
  | { type: 'set_toll'; corridorId: string; value: number }
  | { type: 'ship_goods'; toId: string; resource: ResourceKey; units: number; corridorId: string }
  | { type: 'respond_delivery'; deliveryId: string; accept: boolean }
  | { type: 'break_agreement'; agreementId: string }
  | { type: 'set_route'; partnerId: string; pathId: string }
  | { type: 'set_production'; resource: ResourceKey; mode: 'boost' | 'normal' | 'slow' }
  | { type: 'buy_from_country'; sellerId: string; resource: ResourceKey; units: number }
  | { type: 'create_offer'; resource: ResourceKey; units: number; unitPrice: number }
  | { type: 'cancel_offer'; offerId: string }
  | { type: 'buy_offer'; offerId: string }
  | { type: 'build_facility'; facility: FacilityKey; count: number }
  | { type: 'change_regime'; regime: RegimeType };

export type ActionType = ActionParams['type'];

/* ---------------------------------- Divers ---------------------------------- */

export interface AiDecisionLog {
  id: string;
  day: number;
  ts: number;
  countryId: string;
  problem: string;
  action: ActionType;
  detail: string;
  rationale: string;
}

export interface EngineStatus {
  running: boolean;
  leader: boolean;
  tick: number;
  day: number;
  lastTickAt: number;
  lastTickDurationMs: number;
  tickIntervalMs: number;
  worldVersion: number;
  storage: string;
  wsClients: number;
  humansOnline: number;
  aiActive: number;
  countries: number;
  lastError: string | null;
  uptimeMs: number;
}
