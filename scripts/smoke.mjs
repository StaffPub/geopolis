/**
 * Smoke test end-to-end : serveur réel + HTTP + WebSocket.
 * Lancé en une seule passe (le sandbox ne conserve pas les process entre appels).
 */
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = '/tmp/gpdata-smoke';

fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });

const results = [];
function check(name, cond, extra = '') {
  results.push({ name, ok: Boolean(cond), extra });
  console.log(`${cond ? '✓' : '✗'} ${name} ${extra}`);
}

const server = spawn('node', ['server/dist/index.js'], {
  env: {
    ...process.env,
    DATA_DIR: DATA,
    PORT: String(PORT),
    TICK_MS: '1500',
    ADMIN_EMAIL: 'admin@geopolis.test',
    SESSION_SECRET: 'smoke-secret',
    LOG_LEVEL: 'warn',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => undefined);
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth(maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return await r.json();
    } catch { /* pas encore prêt */ }
    await sleep(400);
  }
  throw new Error('serveur non démarré');
}

function cookieJar() {
  let cookie = null;
  return {
    get cookie() { return cookie; },
    async req(method, path, body) {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const sc = res.headers.getSetCookie?.() ?? [];
      if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data };
    },
  };
}

try {
  const health = await waitHealth();
  check('health: ok + storage + nations', health.ok && health.storage && health.nations === 36);

  // --- Joueur 1 : inscription, claim, action ---
  const p1 = cookieJar();
  let r = await p1.req('POST', '/api/auth/register', { username: 'Lucas', email: 'lucas@test.dev', password: 'MotDePasse123!' });
  check('register 201', r.status === 201, `(${r.status})`);
  check('register: cookie de session émis', Boolean(p1.cookie));

  r = await p1.req('GET', '/api/me');
  check('/me authentifié', r.status === 200 && r.data.user.username === 'Lucas');

  r = await p1.req('GET', '/api/countries');
  check('36 pays listés', r.data.countries?.length === 36);
  check('stratégie IA exposée', Boolean(r.data.countries?.[0]?.strategy));

  r = await p1.req('POST', '/api/countries/france/claim');
  check('claim France', r.status === 200 && r.data.ok);

  r = await p1.req('POST', '/api/countries/allemagne/claim');
  check('double présidence refusée (409)', r.status === 409, `(${r.status})`);

  r = await p1.req('POST', '/api/countries/france/actions/estimate', { params: { type: 'set_tax', value: 27 } });
  check('estimate: effets serveur', r.data.ok && Array.isArray(r.data.effects) && r.data.effects.length >= 3);

  r = await p1.req('POST', '/api/countries/france/actions', { params: { type: 'set_tax', value: 27 }, requestId: 'smoke-1' });
  check('action set_tax appliquée', r.data.ok === true, JSON.stringify(r.data.error ?? ''));

  r = await p1.req('GET', '/api/countries/france');
  check('fiscalité persistée à 27', r.data.country.policy.taxRate === 27);

  // --- Joueur 2 : contrôle exclusif ---
  const p2 = cookieJar();
  await p2.req('POST', '/api/auth/register', { username: 'Anna', email: 'anna@test.dev', password: 'MotDePasse123!' });
  r = await p2.req('POST', '/api/countries/france/claim');
  check('pays joueur non prenable (409)', r.status === 409, `(${r.status})`);
  r = await p2.req('POST', '/api/countries/france/actions', { params: { type: 'set_tax', value: 10 } });
  check('action sur pays d’un autre refusée (403)', r.status === 403, `(${r.status})`);
  r = await p2.req('POST', '/api/countries/allemagne/claim');
  check('claim Allemagne (joueur 2)', r.status === 200);

  // --- Admin ---
  const adm = cookieJar();
  await adm.req('POST', '/api/auth/register', { username: 'Root', email: 'admin@geopolis.test', password: 'MotDePasse123!' });
  r = await adm.req('GET', '/api/admin/overview');
  check('admin overview 200 + rôle serveur', r.status === 200 && r.data.nations === 36, `(${r.status})`);
  r = await p1.req('GET', '/api/admin/overview');
  check('admin refusé au non-admin (403)', r.status === 403, `(${r.status})`);
  r = await adm.req('POST', '/api/admin/simulation/tick', { n: 3 });
  check('tick forcé admin', r.data.ok === true);
  r = await adm.req('POST', '/api/admin/integrity/check');
  check('intégrité OK', r.data.ok === true, JSON.stringify(r.data.problems?.slice(0, 3)));

  // --- Endpoints monde ---
  r = await p1.req('GET', '/api/world/snapshot');
  check('snapshot monde (meta+acteurs+flux)', r.data.meta && r.data.actors && Array.isArray(r.data.flows));
  r = await p1.req('GET', '/api/world/map-metrics');
  check('map-metrics 36 pays', Object.keys(r.data.perCountry || {}).length === 36);
  r = await p1.req('GET', '/api/world/journal?limit=20');
  check('journal mondial alimenté', Array.isArray(r.data.entries) && r.data.entries.length > 0, `(${r.data.entries?.length} entrées)`);
  r = await p1.req('GET', '/api/world/market');
  check('marché mondial 8 ressources', Object.keys(r.data.market || {}).length === 8);

  // --- WebSocket temps réel ---
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: p1.cookie } });
  const msgs = [];
  ws.on('message', (raw) => msgs.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await sleep(700);
  check('WS: world_snapshot reçu', msgs.some((m) => m.type === 'world_snapshot'));
  check('WS: welcome authentifié', msgs.some((m) => m.type === 'welcome' && m.username === 'Lucas'));

  ws.send(JSON.stringify({ type: 'subscribe', countryId: 'france' }));
  await sleep(500);
  check('WS: country_snapshot France', msgs.some((m) => m.type === 'country_snapshot' && m.country?.id === 'france'));

  const before = msgs.length;
  ws.send(JSON.stringify({ type: 'ping', t: 123 }));
  await sleep(400);
  check('WS: pong', msgs.slice(before).some((m) => m.type === 'pong' && m.t === 123));

  // Attente d'un tick réel (TICK_MS=1500) → diffusions
  const before2 = msgs.length;
  await sleep(4000);
  const fresh = msgs.slice(before2);
  check('WS: world_update sur tick', fresh.some((m) => m.type === 'world_update'));
  check('WS: market_update sur tick', fresh.some((m) => m.type === 'market_update'));
  check('WS: country_update ciblé (abonné France)', fresh.some((m) => (m.type === 'country_snapshot' || m.type === 'country_update') && m.country?.id === 'france'));

  // Second WS (joueur 2) : les deux voient le monde
  const ws2 = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: p2.cookie } });
  const msgs2 = [];
  ws2.on('message', (raw) => msgs2.push(JSON.parse(raw.toString())));
  await new Promise((resolve) => ws2.once('open', resolve));
  await sleep(1000);
  check('WS2: présence 2 humains', msgs2.some((m) => m.type === 'world_snapshot' && m.actors.humans >= 1) && msgs.some((m) => m.type === 'presence_update' && m.presence.length >= 2));

  // --- Persistance : redémarrage ---
  const vBefore = (await p1.req('GET', '/api/world/snapshot')).data.meta.version;
  ws.close(); ws2.close();
  server.kill('SIGTERM');
  await sleep(1500);

  const server2 = spawn('node', ['server/dist/index.js'], {
    env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), TICK_MS: '1500', ADMIN_EMAIL: 'admin@geopolis.test', SESSION_SECRET: 'smoke-secret', LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server2.stdout.on('data', () => undefined);
  server2.stderr.on('data', () => undefined);
  await waitHealth();
  const p3 = cookieJar();
  await p3.req('POST', '/api/auth/login', { email: 'lucas@test.dev', password: 'MotDePasse123!' });
  r = await p3.req('GET', '/api/countries/france');
  check('après redémarrage : France toujours à Lucas', r.data.country.controller.kind === 'player' && r.data.country.controller.presidentName === 'Lucas');
  check('après redémarrage : fiscalité 27 préservée', r.data.country.policy.taxRate === 27);
  r = await p3.req('GET', '/api/world/snapshot');
  check('après redémarrage : version monde >= avant', r.data.meta.version >= vBefore, `(${vBefore} → ${r.data.meta.version})`);
  check('après redémarrage : jour >= 4 (ticks écoulés)', r.data.meta.day >= 4, `(jour ${r.data.meta.day})`);
  server2.kill('SIGTERM');
} catch (e) {
  console.error('SMOKE FAIL:', e);
  results.push({ name: 'exception', ok: false, extra: String(e) });
  try { server.kill('SIGKILL'); } catch { /* déjà mort */ }
}

await sleep(500);
const failed = results.filter((r) => !r.ok);
console.log(`\n=== SMOKE : ${results.length - failed.length}/${results.length} checks OK ===`);
if (failed.length) {
  console.log('ÉCHECS :', failed.map((f) => `${f.name} ${f.extra}`).join(' | '));
  process.exit(1);
}
process.exit(0);
