/**
 * Helpers de test : contexte serveur complet (stockage mémoire, monde,
 * hub WebSocket, moteur, API HTTP réelle sur port éphémère).
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import type { Country, ServerMessage, User } from 'shared';
import { MemoryStorage } from '../src/storage/memory.js';
import { resetRateLimits } from '../src/util/ratelimit.js';
import { WorldStore } from '../src/world/world.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { WorldSimulationEngine, aiPresidentName, type MandateLoss } from '../src/simulation/engine.js';
import { createApp } from '../src/app.js';

export interface TestContext {
  storage: MemoryStorage;
  world: WorldStore;
  hub: RealtimeHub;
  engine: WorldSimulationEngine;
  server: http.Server;
  port: number;
  baseUrl: string;
  mandateLosses: MandateLoss[];
  close(): Promise<void>;
}

export async function createTestContext(opts: { tickMs?: number } = {}): Promise<TestContext> {
  resetRateLimits();
  const storage = new MemoryStorage();
  const world = await WorldStore.load(storage);
  const repos = world.repos;
  const server = http.createServer();
  const hub = new RealtimeHub(server, { world, repos });
  const mandateLosses: MandateLoss[] = [];

  const engine = new WorldSimulationEngine(
    world,
    storage,
    {
      onTickCompleted: (_w, info) => hub.onTick(info),
      notifyUser: (userId, n) => hub.notifyUser(userId, n),
      onMandateLost: async (loss) => {
        mandateLosses.push(loss);
        if (!loss.userId) return;
        const user = await repos.getUser(loss.userId);
        if (user && user.countryId === loss.countryId) {
          user.countryId = null;
          await repos.updateUser(user);
        }
        await hub.notifyUser(loss.userId, {
          type: 'mandate',
          title: 'Votre gouvernement est tombé',
          body: `${loss.countryName} : ${loss.reason}. Un dirigeant IA assure la succession. Vous pouvez choisir une autre nation.`,
          day: world.meta.day,
        });
      },
      onAiDecisions: async (decisions) => {
        for (const d of decisions) await repos.appendAiDecision(d);
      },
    },
    { tickMs: opts.tickMs ?? 20_000, instanceId: 'test-instance', enabled: true },
  );

  const app = createApp({ world, repos, hub, engine }, repos);
  server.on('request', app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    storage,
    world,
    hub,
    engine,
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    mandateLosses,
    close: async () => {
      await engine.stop();
      await hub.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/* ------------------------------- Client HTTP ------------------------------- */

export class ApiClient {
  cookie: string | null = null;
  constructor(public baseUrl: string) {}

  async req<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cookie) headers['Cookie'] = this.cookie;
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) {
      this.cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    }
    const text = await res.text();
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = text as unknown as T;
    }
    return { status: res.status, data };
  }

  get<T>(path: string) { return this.req<T>('GET', path); }
  post<T>(path: string, body?: unknown) { return this.req<T>('POST', path, body); }
  patch<T>(path: string, body?: unknown) { return this.req<T>('PATCH', path, body); }
}

export async function registerAndLogin(
  client: ApiClient,
  username: string,
  email = `${username}@test.dev`,
  password = 'MotDePasse123!',
): Promise<User & { id: string }> {
  const res = await client.post<{ user: { id: string } }>('/api/auth/register', { username, email, password });
  if (res.status !== 201) throw new Error(`register échoué (${res.status}) : ${JSON.stringify(res.data)}`);
  return res.data.user as User & { id: string };
}

/* ------------------------------- Client WS ------------------------------- */

export class TestWsClient {
  ws: WebSocket;
  messages: ServerMessage[] = [];
  private waiters: Array<(m: ServerMessage) => void> = [];

  constructor(url: string, cookie?: string | null) {
    this.ws = new WebSocket(url, cookie ? { headers: { Cookie: cookie } } : undefined);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      this.messages.push(msg);
      const next = this.waiters.shift();
      if (next) next(msg);
    });
  }

  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  async waitFor<T extends ServerMessage['type']>(
    type: T,
    timeoutMs = 10_000,
    predicate?: (m: ServerMessage) => boolean,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const existing = this.messages.find((m) => m.type === type && (predicate ? predicate(m) : true));
    if (existing) return existing as Extract<ServerMessage, { type: T }>;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout en attendant ${type}`)), timeoutMs);
      const check = (m: ServerMessage): void => {
        if (m.type === type && (predicate ? predicate(m) : true)) {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { type: T }>);
        } else {
          this.waiters.push(check);
        }
      };
      this.waiters.push(check);
    });
  }

  close(): void {
    this.ws.close();
  }
}

/* ------------------------------- Divers ------------------------------- */

export function setPlayerController(world: WorldStore, countryId: string, userId: string, username: string): Country {
  const c = world.country(countryId)!;
  c.controller = { kind: 'player', userId, presidentName: username, since: Date.now(), sinceDay: world.meta.day };
  world.markDirty(countryId);
  return c;
}

export function allNumbersValid(obj: unknown, path = ''): string[] {
  const problems: string[] = [];
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) problems.push(`${path} = ${obj}`);
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => problems.push(...allNumbersValid(v, `${path}[${i}]`)));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      problems.push(...allNumbersValid(v, path ? `${path}.${k}` : k));
    }
  }
  return problems;
}

export { aiPresidentName };
