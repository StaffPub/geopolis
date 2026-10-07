/**
 * GEOPOLIS — Fabrique de stockage + couche "repository" typée.
 * Le reste du code n'accède jamais aux clés brutes : tout passe par ici.
 */
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { uid, sha256 } from '../util/core.js';
import type { AuditLog, AiDecisionLog, GameNotification, PresenceEntry, Session, User, WorldMeta } from 'shared';
import { FileStorage } from './file.js';
import { MemoryStorage } from './memory.js';
import { K, type Storage } from './storage.js';
import { UpstashStorage } from './upstash.js';

const log = createLogger('STORAGE');

export type { Storage } from './storage.js';
export { K } from './storage.js';

export function createStorage(opts?: { kind?: 'auto' | 'file' | 'memory' }): Storage {
  const kind = opts?.kind ?? 'auto';
  if (kind === 'memory') return new MemoryStorage();
  if (kind === 'file') return new FileStorage(config.dataDir);
  if (config.upstashUrl && config.upstashToken) {
    log.info('Stockage : Upstash Redis (REST)');
    return new UpstashStorage(config.upstashUrl, config.upstashToken);
  }
  log.info(`Stockage : fichier local (${config.dataDir}) — Upstash non configuré`);
  return new FileStorage(config.dataDir);
}

/* ------------------------------------------------------------------ */
/* Repository : utilisateurs, sessions, notifications, audit, présence */
/* ------------------------------------------------------------------ */

export const CAPS = {
  notifications: 50,
  audit: 200,
  aiDecisions: 150,
} as const;

function capped<T>(arr: T[], cap: number): T[] {
  return arr.length > cap ? arr.slice(arr.length - cap) : arr;
}

export class Repositories {
  constructor(private storage_: Storage) {}

  get storage(): Storage {
    return this.storage_;
  }

  /* ---------------- Users ---------------- */

  async createUser(data: Omit<User, 'id' | 'createdAt' | 'lastLoginAt' | 'suspended' | 'role' | 'countryId'> & Partial<Pick<User, 'role'>>): Promise<User> {
    const user: User = {
      id: uid('usr'),
      role: data.role ?? 'user',
      suspended: false,
      createdAt: Date.now(),
      lastLoginAt: null,
      username: data.username,
      email: data.email,
      passwordHash: data.passwordHash,
      countryId: null,
    };
    const index = (await this.storage_.get<string[]>(K.usersIndex)) ?? [];
    index.push(user.id);
    await this.storage_.setMany([
      [K.user(user.id), user],
      [K.usersIndex, index],
      [K.userByEmail(user.email), user.id],
      [K.userByName(user.username), user.id],
    ]);
    return user;
  }

  async getUser(id: string): Promise<User | null> {
    return this.storage_.get<User>(K.user(id));
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const id = await this.storage_.get<string>(K.userByEmail(email.toLowerCase()));
    return id ? this.getUser(id) : null;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const id = await this.storage_.get<string>(K.userByName(username));
    return id ? this.getUser(id) : null;
  }

  async updateUser(user: User): Promise<void> {
    await this.storage_.set(K.user(user.id), user);
  }

  async listUsers(): Promise<User[]> {
    const index = (await this.storage_.get<string[]>(K.usersIndex)) ?? [];
    const users: User[] = [];
    for (const id of index) {
      const u = await this.getUser(id);
      if (u) users.push(u);
    }
    return users;
  }

  async deleteUser(id: string): Promise<void> {
    const user = await this.getUser(id);
    if (!user) return;
    const index = ((await this.storage_.get<string[]>(K.usersIndex)) ?? []).filter((x) => x !== id);
    await this.storage_.del(K.user(id));
    await this.storage_.del(K.userByEmail(user.email));
    await this.storage_.del(K.userByName(user.username));
    await this.storage_.del(K.notifications(id));
    await this.storage_.set(K.usersIndex, index);
  }

  /* ---------------- Sessions ---------------- */

  async createSession(userId: string, secret: string): Promise<{ token: string; session: Session }> {
    const token = uid('tok') + sha256(userId + Date.now()).slice(0, 16);
    const tokenHash = sha256(secret + token);
    const session: Session = {
      tokenHash,
      userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + config.sessionTtlMs,
      lastSeenAt: Date.now(),
    };
    await this.storage_.set(K.session(tokenHash), session);
    return { token, session };
  }

  async getSession(token: string, secret: string): Promise<Session | null> {
    const tokenHash = sha256(secret + token);
    const session = await this.storage_.get<Session>(K.session(tokenHash));
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      await this.storage_.del(K.session(tokenHash)).catch(() => undefined);
      return null;
    }
    return session;
  }

  async touchSession(session: Session): Promise<void> {
    session.lastSeenAt = Date.now();
    await this.storage_.set(K.session(session.tokenHash), session);
  }

  async destroySession(token: string, secret: string): Promise<void> {
    await this.storage_.del(K.session(sha256(secret + token)));
  }

  async destroyUserSessions(userId: string, secret: string, keepToken?: string): Promise<void> {
    const keys = await this.storage_.keys('session:');
    for (const key of keys) {
      const s = await this.storage_.get<Session>(key);
      if (s && s.userId === userId) {
        const keepHash = keepToken ? sha256(secret + keepToken) : null;
        if (s.tokenHash !== keepHash) await this.storage_.del(key);
      }
    }
  }

  /* ---------------- Notifications ---------------- */

  async pushNotification(n: Omit<GameNotification, 'id' | 'ts' | 'read'>): Promise<GameNotification> {
    const full: GameNotification = { ...n, id: uid('ntf'), ts: Date.now(), read: false };
    const list = (await this.storage_.get<GameNotification[]>(K.notifications(n.userId))) ?? [];
    list.push(full);
    await this.storage_.set(K.notifications(n.userId), capped(list, CAPS.notifications));
    return full;
  }

  async listNotifications(userId: string): Promise<GameNotification[]> {
    return (await this.storage_.get<GameNotification[]>(K.notifications(userId))) ?? [];
  }

  async markNotificationRead(userId: string, notificationId: string): Promise<void> {
    const list = (await this.storage_.get<GameNotification[]>(K.notifications(userId))) ?? [];
    const item = list.find((n) => n.id === notificationId);
    if (item) {
      item.read = true;
      await this.storage_.set(K.notifications(userId), list);
    }
  }

  async markAllNotificationsRead(userId: string): Promise<void> {
    const list = (await this.storage_.get<GameNotification[]>(K.notifications(userId))) ?? [];
    for (const n of list) n.read = true;
    await this.storage_.set(K.notifications(userId), list);
  }

  /* ---------------- Journaux globaux (listes bornées) ---------------- */

  async appendAudit(entry: Omit<AuditLog, 'id' | 'ts'>): Promise<void> {
    const full: AuditLog = { ...entry, id: uid('aud'), ts: Date.now() };
    const list = (await this.storage_.get<AuditLog[]>(K.audit)) ?? [];
    list.push(full);
    await this.storage_.set(K.audit, capped(list, CAPS.audit));
  }

  async listAudit(): Promise<AuditLog[]> {
    return (await this.storage_.get<AuditLog[]>(K.audit)) ?? [];
  }

  async appendAiDecision(entry: Omit<AiDecisionLog, 'id' | 'ts'>): Promise<void> {
    const full: AiDecisionLog = { ...entry, id: uid('aid'), ts: Date.now() };
    const list = (await this.storage_.get<AiDecisionLog[]>(K.aiDecisions)) ?? [];
    list.push(full);
    await this.storage_.set(K.aiDecisions, capped(list, CAPS.aiDecisions));
  }

  async appendAiDecisionsBatch(entries: AiDecisionLog[]): Promise<void> {
    if (entries.length === 0) return;
    const list = (await this.storage.get<AiDecisionLog[]>(K.aiDecisions)) ?? [];
    list.push(...entries);
    await this.storage.set(K.aiDecisions, capped(list, CAPS.aiDecisions));
  }

  async listAiDecisions(limit = 100): Promise<AiDecisionLog[]> {
    const list = (await this.storage_.get<AiDecisionLog[]>(K.aiDecisions)) ?? [];
    return list.slice(-limit);
  }

  /* ---------------- Présence ---------------- */

  async savePresence(entries: PresenceEntry[]): Promise<void> {
    await this.storage_.set(K.presence, entries);
  }

  async loadPresence(): Promise<PresenceEntry[]> {
    return (await this.storage_.get<PresenceEntry[]>(K.presence)) ?? [];
  }

  /* ---------------- World meta ---------------- */

  async loadMeta(): Promise<WorldMeta | null> {
    return this.storage_.get<WorldMeta>(K.meta);
  }

  async saveMeta(meta: WorldMeta): Promise<void> {
    await this.storage_.set(K.meta, meta);
  }
}
