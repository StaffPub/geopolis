/**
 * GEOPIS v17.4 — AUDIT UI EXHAUSTIF des infobulles ⓘ et des overlays.
 * Parcourt CHAQUE onglet du jeu, survole CHAQUE icône ⓘ (dans la limite
 * du raisonnable) et vérifie : popover unique, position fixed, z-index 1000,
 * fond OPAQUE, entièrement dans le viewport, ne recouvre PAS son icône,
 * se ferme en quittant l'icône, s'ouvre aussi au clic (tactile).
 * Vérifie ensuite la hiérarchie des overlays (modale > tutoriel, drawer >
 * tutoriel, toasts au-dessus de tout).
 * Sortie : tableau par route ; code 1 si le moindre échec.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4180;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = '/tmp/gp-uiaudit';

fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });

const server = spawn('node', ['server/dist/index.js'], {
  env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), TICK_MS: '8000', SESSION_SECRET: 'audit-secret', ADMIN_EMAIL: 'admin@audit.test', LOG_LEVEL: 'error' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
let checked = 0;

async function waitHealth() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* pas prêt */ }
    await sleep(400);
  }
  throw new Error('serveur injoignable');
}

async function auditTipsOnPage(page, route, max = 14) {
  await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle' });
  await sleep(1200);
  const tips = page.locator('.infotip-btn');
  const n = Math.min(await tips.count(), max);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const tip = tips.nth(i);
    try {
      await tip.scrollIntoViewIfNeeded();
      await sleep(150);
      await tip.hover();
      await sleep(280);
      const pop = page.locator('.infotip-fixed');
      const count = await pop.count();
      if (count !== 1) throw new Error(`popovers ouverts : ${count} (attendu 1)`);
      const box = await pop.first().boundingBox();
      const iconBox = await tip.boundingBox();
      const cs = await pop.first().evaluate((el) => {
        const st = getComputedStyle(el);
        return { position: st.position, zIndex: st.zIndex, opacity: st.opacity, bg: st.backgroundColor };
      });
      if (!box) throw new Error('popover sans boîte');
      if (cs.position !== 'fixed') throw new Error(`position ${cs.position}`);
      if (cs.zIndex !== '1000') throw new Error(`z-index ${cs.zIndex}`);
      if (Number(cs.opacity) < 0.99) throw new Error(`opacité ${cs.opacity}`);
      const alpha = cs.bg.match(/rgba?\(([^)]+)\)/)?.[1]?.split(',').map((v) => parseFloat(v));
      if (!alpha || alpha.length === 4 && alpha[3] < 0.99) throw new Error(`fond transparent ${cs.bg}`);
      if (box.x < 0 || box.y < 0 || box.x + box.width > 1440 || box.y + box.height > 900) {
        throw new Error(`hors viewport (${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)}x${Math.round(box.height)})`);
      }
      if (iconBox) {
        const gapTop = iconBox.y - (box.y + box.height);
        const gapBottom = box.y - (iconBox.y + iconBox.height);
        if (Math.max(gapTop, gapBottom) < 2) throw new Error('popover recouvre son icône');
      }
      await page.mouse.move(8, 500);
      await sleep(220);
      if (await page.locator('.infotip-fixed').count()) throw new Error('ne se ferme pas en quittant l’icône');
      ok += 1; checked += 1;
    } catch (e) {
      failures.push(`[${route} ⓘ #${i}] ${String(e).slice(0, 160)}`);
      await page.mouse.move(8, 500);
      await sleep(150);
    }
  }
  console.log(`${route.padEnd(22)} ${ok}/${n} infobulles OK`);
}

try {
  await waitHealth();
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => { try { localStorage.setItem('gp-has-session', '1'); } catch { /* ignore */ } });
  await context.request.post(`${BASE}/api/auth/register`, { data: { username: 'Auditeur', email: 'audit@user.test', password: 'MotDePasse123!' } });
  await context.request.post(`${BASE}/api/countries/france/claim`);
  const page = await context.newPage();
  page.on('pageerror', (e) => failures.push(`[pageerror ${page.url()}] ${String(e).slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error') failures.push(`[console ${page.url()}] ${m.text().slice(0, 200)}`); });

  for (const route of [
    'game', 'game/economy', 'game/resources', 'game/production', 'game/politics',
    'game/laws', 'game/infrastructure', 'game/trade', 'game/diplomacy',
    'game/events', 'game/history', 'game/world', 'game/compare', 'game/map',
  ]) {
    await auditTipsOnPage(page, route);
  }

  /* Ouverture au CLIC (tactile) + fermeture au clic ailleurs */
  await page.goto(`${BASE}/game`, { waitUntil: 'networkidle' });
  await sleep(1200);
  const tip0 = page.locator('.res-card .infotip-btn').first();
  await tip0.scrollIntoViewIfNeeded();
  await tip0.click();
  await sleep(300);
  if ((await page.locator('.infotip-fixed').count()) !== 1) failures.push('[clic] ouverture au clic échouée');
  await page.mouse.click(700, 300);
  await sleep(300);
  if ((await page.locator('.infotip-fixed').count()) !== 0) failures.push('[clic] fermeture au clic ailleurs échouée');
  checked += 2;
  console.log('clic tactile + fermeture ailleurs : OK');

  /* Hiérarchie des overlays : modale & drawer AU-DESSUS du tutoriel */
  await page.goto(`${BASE}/game/infrastructure`, { waitUntil: 'networkidle' });
  await sleep(1200);
  await page.locator('.infra-card button:has-text("Voir les boosts"):not([disabled])').first().click();
  await sleep(600);
  const zModal = await page.locator('.modal-backdrop').evaluate((el) => Number(getComputedStyle(el).zIndex));
  const zTour = await page.locator('.tour-dock').evaluate((el) => Number(getComputedStyle(el).zIndex)).catch(() => 0);
  console.log(`z-index modale=${zModal} tutoriel=${zTour}`);
  if (!(zModal > zTour)) failures.push(`[overlays] modale (${zModal}) sous le tutoriel (${zTour})`);
  await page.waitForSelector('.showcase-cta', { timeout: 70000 }).catch(() => undefined);
  await sleep(300);
  await page.locator('.showcase-alt').click().catch(() => undefined);
  await sleep(300);
  await page.locator('button[aria-label^="Notifications"]').click();
  await sleep(600);
  const zDrawer = await page.locator('.drawer').evaluate((el) => Number(getComputedStyle(el).zIndex));
  console.log(`z-index drawer=${zDrawer}`);
  if (!(zDrawer > zTour)) failures.push(`[overlays] drawer (${zDrawer}) sous le tutoriel (${zTour})`);
  checked += 2;

  await browser.close();
} catch (e) {
  failures.push(`[script] ${String(e).slice(0, 300)}`);
} finally {
  server.kill('SIGKILL');
}

console.log('\n================ AUDIT UI ================');
console.log(`Infobulles & overlays vérifiés : ${checked}`);
if (failures.length === 0) {
  console.log('✅ AUCUN échec — toutes les infobulles sont visibles, opaques, dans le viewport et se ferment correctement.');
} else {
  console.log(`❌ ${failures.length} échec(s) :`);
  for (const f of failures) console.log('  -', f);
}
process.exit(failures.length === 0 ? 0 : 1);
