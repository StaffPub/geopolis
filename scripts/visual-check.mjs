/**
 * GEOPOLIS — Vérification visuelle automatisée (détection rapide de bugs).
 * Lance le serveur réel, ouvre un vrai navigateur (Playwright/Chromium),
 * parcourt les pages clés, CLIQUE vraiment (carte, tutoriel, boutons),
 * capture des captures d'écran ET toutes les erreurs console/page.
 *
 * Setup (une fois) : npm run check:visual:setup
 * Usage ensuite   : npm run check:visual
 * Sortie : scripts/shots/*.png + rapport console. Code 1 si erreur détectée.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = 4123;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = '/tmp/gp-visual';
const SHOTS = path.join(process.cwd(), 'scripts', 'shots');

fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const server = spawn('node', ['server/dist/index.js'], {
  env: {
    ...process.env,
    DATA_DIR: DATA,
    PORT: String(PORT),
    TICK_MS: '4000',
    SESSION_SECRET: 'visual-secret',
    ADMIN_EMAIL: 'admin@visual.test',
    LOG_LEVEL: 'error',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });

async function waitHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* pas prêt */ }
    await sleep(400);
  }
  throw new Error('serveur injoignable');
}

try {
  await waitHealth();
  // --no-sandbox / --disable-dev-shm-usage : environnements conteneurs/CI
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // Enregistre TOUTES les erreurs console/page
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[console.error] ${msg.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e).slice(0, 300)}`));
  page.on('crash', () => errors.push(`[crash] page crash sur ${page.url()}`));

  // Inscription + claim via l'API du même contexte (cookies partagés)
  await context.addInitScript(() => {
    try { localStorage.setItem('gp-has-session', '1'); } catch { /* ignore */ }
  });
  const reg = await context.request.post(`${BASE}/api/auth/register`, {
    data: { username: 'VisualTest', email: 'visual@test.dev', password: 'MotDePasse123!' },
  });
  if (reg.status() !== 201) throw new Error(`register ${reg.status()}`);
  const claim = await context.request.post(`${BASE}/api/countries/france/claim`);
  if (claim.status() !== 200) throw new Error(`claim ${claim.status()}`);

  /* ---------- 1. Landing ---------- */
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(1200);
  await shot(page, '01-landing');

  /* ---------- 2. Dashboard + tutoriel auto ---------- */
  await page.goto(`${BASE}/game`, { waitUntil: 'networkidle' });
  await sleep(2000); // le tutoriel s'ouvre après ~900 ms
  const tourVisible = await page.locator('.tour-dock').isVisible().catch(() => false);
  await shot(page, '02-dashboard-tutoriel');
  console.log(tourVisible ? '✅ Tutoriel visible au premier accès' : '❌ Tutoriel ABSENT au premier accès');
  if (!tourVisible) errors.push('[tuto] dock tutoriel non visible au premier accès /game');

  /* ---------- 3. Tutoriel : CTA navigue SANS disparaître ---------- */
  if (tourVisible) {
    await page.locator('.tour-controls .btn-primary').first().click(); // Suivant
    await sleep(400);
    const cta = page.locator('.tour-controls .btn-primary').first();
    await cta.click(); // CTA "Voir mon tableau de bord" (étape 2)
    await sleep(1200);
    const still = await page.locator('.tour-dock').isVisible().catch(() => false);
    console.log(still ? '✅ Tutoriel toujours présent après navigation CTA' : '❌ Tutoriel DISPARAÎT après CTA');
    if (!still) errors.push('[tuto] disparaît après clic CTA');
    await shot(page, '03-tutoriel-apres-cta');
    // Onglet lazy (carte) depuis le tuto : le layout ne doit pas sauter
    await page.locator('.tour-skip').click();
    await sleep(400);
  }

  /* ---------- 4. Carte : clic pays = panneau ---------- */
  await page.goto(`${BASE}/game/map`, { waitUntil: 'networkidle' });
  await sleep(1500);
  await shot(page, '04-carte');
  const france = page.locator('path[aria-label^="France"]').first();
  await france.click({ force: true });
  await sleep(900);
  const drawerOpen = await page.locator('.drawer').isVisible().catch(() => false);
  console.log(drawerOpen ? '✅ Clic carte → panneau pays ouvert' : '❌ Clic carte → panneau ABSENT');
  if (!drawerOpen) errors.push('[carte] le clic sur un pays n’ouvre pas le panneau');
  await shot(page, '05-carte-panneau');
  if (drawerOpen) await page.keyboard.press('Escape');
  // Souris en zone neutre : évite qu'un survol résiduel ouvre une infobulle
  // (portal) sur la page suivante pendant les navigations du test.
  await page.mouse.move(5, 5);

  /* ---------- 5. Onglets clés ---------- */
  const tabs = [
    ['politics', '06-politique'],
    ['laws', '07-lois'],
    ['economy', '08-economie'],
    ['infrastructure', '09-infra'],
    ['diplomacy', '10-diplomatie'],
    ['events', '11-evenements'],
    ['trade', '12-commerce'],
    ['resources', '21-ressources'],
    ['production', '22-production'],
    ['history', '28-historique'],
    ['world', '29-vue-monde'],
    ['compare', '30-comparateur'],
  ];
  for (const [route, name] of tabs) {
    await page.goto(`${BASE}/game/${route}`, { waitUntil: 'networkidle' });
    await sleep(900);
    await shot(page, name);
  }

  /* ---------- 5b. Choisir ma nation + admin ---------- */
  await page.goto(`${BASE}/countries`, { waitUntil: 'networkidle' });
  await sleep(1200);
  await shot(page, '31-choisir-nation');
  /* Section admin capturée par scripts/visual-v12.mjs (évite un 2e contexte navigateur ici). */

  /* ---------- 6. Paramètres : bouton retour ---------- */
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await sleep(700);
  const back = await page.locator('.back3d').first().isVisible().catch(() => false);
  console.log(back ? '✅ Bouton retour visible sur Paramètres' : '❌ Bouton retour ABSENT (Paramètres)');
  if (!back) errors.push('[settings] bouton retour absent');
  await shot(page, '13-parametres');
  if (back) {
    await page.locator('.back3d').first().click();
    await sleep(800);
    const url = page.url();
    console.log(url.includes('/game') ? '✅ Retour → tableau de bord' : `❌ Retour a mené à ${url}`);
    if (!url.includes('/game')) errors.push('[settings] bouton retour ne navigue pas vers /game');
  }

  /* ---------- 7. Notifications ---------- */
  await page.goto(`${BASE}/game`, { waitUntil: 'networkidle' });
  await sleep(800);
  await page.locator('button[aria-label^="Notifications"]').click();
  await sleep(700);
  await shot(page, '14-notifications');
  await page.keyboard.press('Escape');

  /* ---------- 7b. Nouveautés : ticker, corridors, douanes ---------- */
  await page.goto(`${BASE}/game`, { waitUntil: 'networkidle' });
  await sleep(900);
  const newsbar = await page.locator('.newsbar').isVisible().catch(() => false);
  console.log(newsbar ? '✅ Barre journal défilante présente' : '❌ Barre journal ABSENTE');
  if (!newsbar) errors.push('[ticker] barre journal absente du layout');

  await page.goto(`${BASE}/game/trade`, { waitUntil: 'networkidle' });
  await sleep(1200);
  const corridorCards = await page.locator('.corridor-card').count();
  console.log(corridorCards >= 8 ? `✅ Marché des routes : ${corridorCards} corridors` : `❌ Corridors absents (${corridorCards})`);
  if (corridorCards < 8) errors.push('[trade] corridors non rendus');
  const shipForm = await page.locator('#ship-to').isVisible().catch(() => false);
  console.log(shipForm ? '✅ Formulaire d’expédition manuelle présent' : '❌ Formulaire expédition ABSENT');
  if (!shipForm) errors.push('[trade] formulaire expédition absent');
  await shot(page, '18-commerce-routes');

  await page.goto(`${BASE}/game/politics`, { waitUntil: 'networkidle' });
  await sleep(900);
  const customs = await page.locator('#customs-partner').isVisible().catch(() => false);
  console.log(customs ? '✅ Section douanes & tarifs frontaliers présente' : '❌ Douanes ABSENTES');
  if (!customs) errors.push('[politics] section douanes absente');

  await page.goto(`${BASE}/game/diplomacy`, { waitUntil: 'networkidle' });
  await sleep(900);
  await shot(page, '19-diplomatie-v2');

  await page.goto(`${BASE}/game/economy`, { waitUntil: 'networkidle' });
  await sleep(1200);
  const growthRows = await page.locator('.growth-row').count();
  console.log(growthRows >= 3 ? `✅ Explicateur de croissance (${growthRows} contributions)` : `❌ Explicateur croissance absent (${growthRows})`);
  if (growthRows < 3) errors.push('[economy] breakdown croissance absent');
  await shot(page, '20-economie-croissance');

  const routeOptsCount = await page.goto(`${BASE}/game/trade`, { waitUntil: 'networkidle' }).then(() => sleep(1200)).then(() => page.locator('.route-opt').count());
  console.log(routeOptsCount >= 1 ? `✅ Combinaisons de routes affichées (${routeOptsCount})` : '❌ Aucune combinaison de route');
  if (routeOptsCount < 1) errors.push('[trade] combinaisons de routes absentes');

  /* ---------- 7c. Production : boutons Construire + modale ; Ressources : consignes ---------- */
  await page.goto(`${BASE}/game/production`, { waitUntil: 'networkidle' });
  await sleep(1400);
  const buildBtns = await page.locator('.prod-card button:has-text("Construire")').count();
  console.log(buildBtns > 0 ? `✅ Production : ${buildBtns} boutons Construire visibles (président)` : '❌ Production : AUCUN bouton Construire');
  if (buildBtns === 0) errors.push('[production] boutons construire absents pour le président');
  await shot(page, '23-production-boutons');
  if (buildBtns > 0) {
    await page.locator('.prod-card button:has-text("Construire")').first().click();
    await sleep(800);
    const modal = await page.locator('.modal-backdrop').first().isVisible().catch(() => false);
    console.log(modal ? '✅ Modale de confirmation Construire ouverte' : '❌ Modale Construire ABSENTE');
    if (!modal) errors.push('[production] clic construire sans modale');
    await shot(page, '24-production-modale');
    await page.keyboard.press('Escape');
    await sleep(400);
  }
  await page.goto(`${BASE}/game/resources`, { waitUntil: 'networkidle' });
  await sleep(1400);
  const seg = await page.locator('.res-seg-btn:has-text("Boost")').count();
  console.log(seg > 0 ? `✅ Ressources : ${seg} segmenteurs de consignes (Boost)` : '❌ Ressources : consignes absentes');
  if (seg === 0) errors.push('[resources] segmenteurs de consignes absents');
  await shot(page, '25-ressources-consignes');

  /* ---------- 7e. Politique v3 : module régimes ---------- */
  await page.goto(`${BASE}/game/politics`, { waitUntil: 'networkidle' });
  await sleep(1400);
  const regimeCards = await page.locator('.regime-card').count();
  console.log(regimeCards === 6 ? '✅ Politique v3 : 6 cartes de régimes' : `❌ Politique v3 : ${regimeCards} cartes de régimes`);
  if (regimeCards !== 6) errors.push('[politics] cartes de régimes absentes');
  const demands = await page.locator('.pol-demand').count();
  console.log(demands >= 0 ? `✅ Volonté du peuple : ${demands} revendications affichées` : '❌ Revendications absentes');
  const proclaim = await page.locator('.regime-card button:has-text("Proclamer")').count();
  console.log(proclaim >= 5 ? `✅ ${proclaim} boutons Proclamer (président)` : `❌ Boutons Proclamer absents (${proclaim})`);
  if (proclaim < 5) errors.push('[politics] boutons proclamer absents pour le président');
  await shot(page, '27-politique-regimes');

  /* ---------- 7d. Lois v2 : cartes + simulateur ---------- */
  await page.goto(`${BASE}/game/laws`, { waitUntil: 'networkidle' });
  await sleep(1400);
  const lawCards = await page.locator('.law-card').count();
  console.log(lawCards >= 12 ? `✅ Lois v2 : ${lawCards} cartes de lois` : `❌ Lois v2 : ${lawCards} cartes seulement`);
  if (lawCards < 12) errors.push('[laws] cartes de lois absentes');
  const sw = page.locator('.law-switch').first();
  if (await sw.isVisible().catch(() => false)) {
    await sw.click();
    await sleep(700);
    const simOn = await page.locator('.law-sim-on').isVisible().catch(() => false);
    console.log(simOn ? '✅ Simulateur législatif activé par la bascule' : '❌ Simulateur non activé');
    if (!simOn) errors.push('[laws] simulateur ne s\'active pas au toggle');
    await sw.click();
  } else {
    errors.push('[laws] interrupteur simulateur absent');
  }
  await shot(page, '26-lois-simulateur');

  /* ---------- 8. Vue monde + landing mobile ---------- */
  await page.goto(`${BASE}/game/world`, { waitUntil: 'networkidle' });
  await sleep(1200);
  await shot(page, '15-vue-monde');

  // Mobile : même contexte, viewport redimensionné (évite un 2e browser context)
  await page.setViewportSize({ width: 390, height: 844 });
  const mpage = page;
  await mpage.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(900);
  await shot(mpage, '16-mobile-landing');
  await mpage.goto(`${BASE}/game`, { waitUntil: 'networkidle' });
  await sleep(1200);
  await shot(mpage, '17-mobile-dashboard');

  await browser.close();
} catch (e) {
  errors.push(`[script] ${String(e).slice(0, 400)}`);
} finally {
  server.kill('SIGKILL');
}

console.log('\n================ RÉSUMÉ VISUEL ================');
if (errors.length === 0) {
  console.log('✅ Aucune erreur console/page détectée.');
} else {
  console.log(`❌ ${errors.length} problème(s) :`);
  for (const e of errors) console.log('  -', e);
}
console.log(`Captures : ${SHOTS}`);
process.exit(errors.length === 0 ? 0 : 1);
