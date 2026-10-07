/**
 * Tests du lock distribué Upstash : 100 % REST (SET NX PX / GET / SET / DEL),
 * AUCUN script Lua (l'endpoint /lua renvoie HTTP 400 sur certaines instances
 * et bloquait l'acquisition du lock moteur → ticks gelés).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { UpstashStorage } from '../src/storage/upstash.js';

interface Call { url: string; body: unknown }

function mockFetch(handler: (url: string, body: unknown) => unknown): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    const result = handler(url, body);
    return new Response(JSON.stringify({ result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

describe('Lock Upstash sans Lua', () => {
  let restore: (() => void) | null = null;
  afterEach(() => { if (restore) { restore(); restore = null; } });

  it('lock libre : SET NX PX prend le lock, aucun appel /lua', async () => {
    const m = mockFetch((_url, body) => {
      const args = body as (string | number)[];
      if (args[0] === 'SET' && args.includes('NX')) return 'OK';
      return null;
    });
    restore = m.restore;
    const s = new UpstashStorage('https://fake.upstash.io', 'tok');
    const got = await s.acquireLock('moteur', 'instance-1', 60_000);
    expect(got).toBe(true);
    expect(m.calls.every((c) => !c.url.includes('/lua'))).toBe(true);
    const set = m.calls[0]!.body as (string | number)[];
    expect(set[0]).toBe('SET');
    expect(set).toContain('NX');
    expect(set).toContain('PX');
  });

  it('lock déjà pris par NOUS : renouvellement GET + SET, jamais de /lua', async () => {
    const m = mockFetch((_url, body) => {
      const args = body as (string | number)[];
      if (args[0] === 'SET' && args.includes('NX')) return null; // déjà pris
      if (args[0] === 'GET') return 'instance-1';                // c'est nous
      if (args[0] === 'SET') return 'OK';                        // renouvellement
      return null;
    });
    restore = m.restore;
    const s = new UpstashStorage('https://fake.upstash.io', 'tok');
    const got = await s.acquireLock('moteur', 'instance-1', 60_000);
    expect(got).toBe(true);
    expect(m.calls.some((c) => c.url.includes('/lua'))).toBe(false);
    expect(m.calls.length).toBe(3); // SET NX, GET, SET renew
  });

  it('lock pris par UN AUTRE : refus sans renouveler', async () => {
    const m = mockFetch((_url, body) => {
      const args = body as (string | number)[];
      if (args[0] === 'SET' && args.includes('NX')) return null;
      if (args[0] === 'GET') return 'instance-2'; // un autre holder
      return null;
    });
    restore = m.restore;
    const s = new UpstashStorage('https://fake.upstash.io', 'tok');
    const got = await s.acquireLock('moteur', 'instance-1', 60_000);
    expect(got).toBe(false);
    expect(m.calls.length).toBe(2); // SET NX + GET, pas de SET renew
  });

  it('releaseLock : DEL seulement si nous sommes le holder', async () => {
    // Cas 1 : nous sommes holder → DEL
    const m1 = mockFetch((_url, body) => {
      const args = body as (string | number)[];
      if (args[0] === 'GET') return 'instance-1';
      if (args[0] === 'DEL') return 1;
      return null;
    });
    restore = m1.restore;
    const s = new UpstashStorage('https://fake.upstash.io', 'tok');
    await s.releaseLock('moteur', 'instance-1');
    expect(m1.calls.some((c) => (c.body as string[])[0] === 'DEL')).toBe(true);
    m1.restore();
    // Cas 2 : autre holder → pas de DEL
    const m2 = mockFetch((_url, body) => {
      const args = body as (string | number)[];
      if (args[0] === 'GET') return 'instance-2';
      return null;
    });
    restore = m2.restore;
    await s.releaseLock('moteur', 'instance-1');
    expect(m2.calls.some((c) => (c.body as string[])[0] === 'DEL')).toBe(false);
  });

  it('health : PING simple, sans Lua', async () => {
    const m = mockFetch(() => 'PONG');
    restore = m.restore;
    const s = new UpstashStorage('https://fake.upstash.io', 'tok');
    expect(await s.health()).toBe(true);
  });
});
