/**
 * GEOPOLIS — Abstraction de stockage.
 * Toutes les lectures/écritures persistantes passent par cette interface :
 * le reste du code ne sait jamais s'il parle à Upstash Redis ou au fallback fichier.
 */

export interface Storage {
  readonly kind: string;
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  /** Écriture par lot (pipeline). */
  setMany(entries: Array<[string, unknown]>): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
  keys(prefix: string): Promise<string[]>;
  /** Lock distribué : renvoie un token si acquis/renouvelé, null sinon. */
  acquireLock(name: string, holder: string, ttlMs: number): Promise<boolean>;
  releaseLock(name: string, holder: string): Promise<void>;
  health(): Promise<boolean>;
  close(): Promise<void>;
}

export const K = {
  meta: 'world:meta',
  market: 'world:market',
  routes: 'world:routes',
  corridors: 'world:corridors',
  journal: 'world:journal',
  transactions: 'world:transactions',
  offers: 'world:offers',
  pendingDeliveries: 'world:pending_deliveries',
  aiDecisions: 'world:ai_decisions',
  audit: 'world:audit_logs',
  usersIndex: 'users:index',
  country: (id: string) => `country:${id}`,
  countriesIndex: 'countries:index',
  user: (id: string) => `user:${id}`,
  userByEmail: (email: string) => `user_email:${email}`,
  userByName: (name: string) => `user_name:${name.toLowerCase()}`,
  session: (tokenHash: string) => `session:${tokenHash}`,
  notifications: (userId: string) => `notifications:${userId}`,
  presence: 'world:presence',
} as const;
