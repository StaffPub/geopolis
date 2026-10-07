/**
 * GEOPOLIS — Vérification visuelle des modules v1.12+ (v19 : 3 sessions
 * navigateur courtes pour éviter l'usure mémoire du rendu logiciel) :
 *  S1 : livraison joueur→joueur, offres JOUEUR visibles/achetables,
 *       release→cooldown, pages admin ;
 *  S2 : infrastructures (catégories, diaporama obligatoire, cas bloqué,
 *       réseaux v16, CTA→chantier réel), infobulle ⓘ portal ;
 *  S3 : célébration « gain exceptionnel » (achat joueur→joueur ≥ 10 Md),
 *       expulsion admin.
 * Serveur dev : TICK_MS 4000.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = 4124;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = '/tmp/gp-visual12';
const SHOTS = path.join(process.cwd(), 'scripts', 'shots12');

fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const server = spawn('node', ['server/dist/index.js'], {
  env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), TICK_MS: '4000', SESSION_SECRET: 'visual-secret', ADMIN_EMAIL: 'admin@visual.test', LOG_LEVEL: 'error' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const shot = async (page, name) => {
  try {
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false, timeout: 45000 });
  } catch (e) {
    errors.push(`[shot] ${name} : ${String(e).slice(0, 90)}`);
  }
};

async function waitHealth() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* pas prêt */ }
    await sleep(400);
  }
  throw new Error('serveur injoignable');
}
async function makeUser(browser, username, email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => { try { localStorage.setItem('gp-has-session', '1'); } catch { /* ignore */ } });
  const reg = await context.request.post(`${BASE}/api/auth/register`, { data: { username, email, password: 'MotDePasse123!' } });
  if (reg.status() === 409) {
    const log = await context.request.post(`${BASE}/api/auth/login`, { data: { email, password: 'MotDePasse123!' } });
    if (log.status() !== 200) throw new Error(`login ${username} ${log.status()}`);
  } else if (reg.status() !== 201) {
    throw new Error(`register ${username} ${reg.status()}`);
  }
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console.error ${username}] ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror ${username}] ${String(e).slice(0, 300)}`));
  page.on('crash', () => errors.push(`[crash ${username}] page crash`));
  return { context, page };
}
const LAUNCH = { args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] };

try {
  await waitHealth();
  const RUN = Date.now() % 1000000;
  const names = {
    a: [`Expedito${RUN}`, `expedito${RUN}@visual.test`],
    b: [`Recepto${RUN}`, `recepto${RUN}@visual.test`],
    adm: ['RootAdmin', 'admin@visual.test'],
  };

  /* ==================== SESSION 1 ==================== */
  {
    const browser = await chromium.launch(LAUNCH);
    const A = await makeUser(browser, ...names.a);
    const B = await makeUser(browser, ...names.b);
    const ADM = await makeUser(browser, ...names.adm);
    if ((await A.context.request.post(`${BASE}/api/countries/france/claim`)).status() !== 200) throw new Error('claim france');
    if ((await B.context.request.post(`${BASE}/api/countries/usa/claim`)).status() !== 200) throw new Error('claim usa');
    await sleep(1000);

    /* --- 1. Livraison joueur → joueur --- */
    const ship = await A.context.request.post(`${BASE}/api/countries/france/actions`, { data: { params: { type: 'ship_goods', toId: 'usa', resource: 'industrial', units: 30, corridorId: 'auto' } } });
    const shipBody = await ship.json();
    if (!shipBody.ok) errors.push(`[ship] refusée : ${shipBody.error}`);
    await A.page.goto(`${BASE}/game/trade`, { waitUntil: 'networkidle' });
    await sleep(1500);
    if (!(await A.page.locator('text=Livraisons en attente').isVisible().catch(() => false))) errors.push('[trade] panneau livraisons absent (A)');
    await shot(A.page, '30-commerce-A-envoi');
    await B.page.goto(`${BASE}/game/trade`, { waitUntil: 'networkidle' });
    await sleep(1500);
    if (!(await B.page.locator('button:has-text("Accepter (payer")').first().isVisible().catch(() => false))) errors.push('[trade] boutons accepter/refuser absents (B)');
    await shot(B.page, '31-commerce-B-reception');
    await B.page.goto(`${BASE}/game`, { waitUntil: 'networkidle' });
    await sleep(1200);
    await B.page.locator('button[aria-label^="Notifications"]').click();
    await sleep(900);
    if (!(await B.page.locator('.notif-item button:has-text("Accepter")').first().isVisible().catch(() => false))) errors.push('[notif] boutons absents');
    await shot(B.page, '32-notifications-B-livraison');
    await B.page.locator('.notif-item button:has-text("Accepter")').first().click();
    await sleep(1500);
    const dl = await (await B.context.request.get(`${BASE}/api/world/deliveries?country=usa`)).json();
    if (dl.deliveries.length !== 0) errors.push('[delivery] encore pending après acceptation');

    /* --- 2. Offres JOUEUR visibles & achetables --- */
    const pubB = await B.context.request.post(`${BASE}/api/countries/usa/actions`, { data: { params: { type: 'create_offer', resource: 'industrial', units: 60, unitPrice: 1.8 } } });
    const pubBody = await pubB.json();
    if (!pubBody.ok) errors.push(`[offers] publication B refusée : ${pubBody.error}`);
    await A.page.goto(`${BASE}/game/resources`, { waitUntil: 'networkidle' });
    await sleep(1600);
    await A.page.locator('.cat-btn:has-text("Joueurs")').click();
    await sleep(700);
    const playerOffer = await A.page.locator('.offer-card:has-text("JOUEUR")').count();
    console.log(playerOffer >= 1 ? '✅ Offre JOUEUR visible chez un autre joueur (filtre Joueurs)' : '❌ Offre joueur invisible chez les autres');
    if (playerOffer < 1) errors.push('[offers] offre joueur non visible chez un autre joueur');
    await shot(A.page, '50-ressources-marche');
    const buyBtn = A.page.locator('.offer-card:has-text("JOUEUR") button:has-text("Acheter")').first();
    if (await buyBtn.isEnabled().catch(() => false)) {
      await buyBtn.click();
      await sleep(700);
      await A.page.locator('.modal button:has-text("Confirmer")').first().click().catch(() => undefined);
      await sleep(1400);
      const left = await A.page.locator('.offer-card:has-text("JOUEUR")').count();
      console.log(left === 0 ? '✅ Achat joueur→joueur d’une offre : OK' : `⚠ Offre encore listée après achat (${left})`);
      if (left !== 0) errors.push('[offers] achat joueur→joueur sans effet');
    } else {
      errors.push('[offers] bouton Acheter désactivé entre joueurs éligibles');
    }

    /* --- 3. Release → cooldown --- */
    const rel = await B.context.request.post(`${BASE}/api/countries/usa/release`);
    const relBody = await rel.json();
    if (!relBody.ok || !(relBody.cooldownUntil > Date.now())) errors.push('[cooldown] release ne pose pas le cooldown');
    await B.page.goto(`${BASE}/countries`, { waitUntil: 'networkidle' });
    await sleep(1400);
    if (!(await B.page.locator('text=Cooldown de retour actif').isVisible().catch(() => false))) errors.push('[cooldown] bannière absente');
    await shot(B.page, '34-choose-country-cooldown');

    /* --- 4. Admin --- */
    await ADM.page.goto(`${BASE}/admin/countries`, { waitUntil: 'networkidle' });
    await sleep(1500);
    if ((await ADM.page.locator('button:has-text("Expulser")').count()) < 1) errors.push('[admin] bouton expulser absent');
    await shot(ADM.page, '35-admin-pays');
    await ADM.page.locator('button:has-text("Octroyer")').first().click();
    await sleep(800);
    await shot(ADM.page, '36-admin-octroi-modale');
    await ADM.page.keyboard.press('Escape').catch(() => undefined);
    await ADM.page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle' });
    await sleep(1500);
    if (!(await ADM.page.locator('text=/COOLDOWN/').first().isVisible().catch(() => false))) errors.push('[admin] badge cooldown absent');
    if ((await ADM.page.locator('button:has-text("Purger cooldown")').count()) < 1) errors.push('[admin] bouton purge absent');
    await shot(ADM.page, '37-admin-users-cooldown');
    await browser.close();
  }

  /* ==================== SESSION 2 ==================== */
  {
    const browser = await chromium.launch(LAUNCH);
    const A = await makeUser(browser, ...names.a);
    const ADM = await makeUser(browser, ...names.adm);

    await A.page.goto(`${BASE}/game/infrastructure`, { waitUntil: 'networkidle' });
    await sleep(1500);
    const catBtn = A.page.locator('.cat-btn:has-text("Société & savoir")');
    if (!(await catBtn.isVisible().catch(() => false))) errors.push('[infra] menu catégories absent');
    await catBtn.click();
    await sleep(900);
    if (!(await A.page.locator('.infra-card:has-text("Écoles")').isVisible().catch(() => false))) errors.push('[infra] filtre catégorie ne montre pas les écoles');
    await shot(A.page, '43-infra-categorie');
    const buildBtn = A.page.locator('.infra-card button:has-text("Voir les boosts")').first();
    if (!(await buildBtn.isVisible().catch(() => false))) errors.push('[infra] bouton boosts/construire absent');
    await buildBtn.click();
    await sleep(700);
    if (!(await A.page.locator('.showcase').isVisible().catch(() => false))) errors.push('[infra] diaporama absent');
    const skipBtn = A.page.locator('.showcase button:has-text("Passer")');
    if (!(await skipBtn.isVisible().catch(() => false))) errors.push('[infra] bouton Passer absent (demandé par l utilisateur)');
    await shot(A.page, '44-infra-diapo-intro');
    await skipBtn.click();
    await sleep(500);
    if (!(await A.page.locator('.showcase-cta').isVisible().catch(() => false))) errors.push('[infra] Passer n amène pas à la diapo finale');
    else console.log('✅ Bouton Passer → diapo finale directe');
    await sleep(600);
    if (!(await A.page.locator('.showcase-alt').isVisible().catch(() => false))) errors.push('[infra] diapo finale incomplète');
    await shot(A.page, '44-infra-modale');
    await A.page.locator('.showcase-cta').click();
    await sleep(1500);
    const frBody = await (await A.context.request.get(`${BASE}/api/countries/france`)).json();
    console.log(frBody.country.projects.length >= 1 ? '✅ CTA diaporama → chantier réellement lancé' : '❌ CTA sans effet');
    if (frBody.country.projects.length < 1) errors.push('[infra] CTA diaporama ne lance pas le chantier');
    await A.page.locator('.infra-card button:has-text("Voir les boosts"):not([disabled])').nth(1).click();
    await sleep(600);
    await A.page.waitForSelector('.showcase-cta', { timeout: 70000 });
    await A.page.locator('.showcase-alt').click();
    await sleep(500);
    if (await A.page.locator('.showcase').count()) errors.push('[infra] « Faire autre chose » ne ferme pas le diaporama');

    /* Cas bloqué : trésorerie à 0 */
    const admReq = ADM.context.request;
    const grant0 = await admReq.post(`${BASE}/api/admin/countries/france/grant`, { data: { cash: -1000000 } });
    if (grant0.status() !== 200) errors.push(`[infra] grant admin échoué (${grant0.status()})`);
    await A.page.reload({ waitUntil: 'networkidle' });
    await sleep(1200);
    const disabledCount = await A.page.locator('.infra-card button[disabled]:has-text("Voir les boosts")').count();
    console.log(disabledCount > 0 ? `✅ Trésorerie 0 : ${disabledCount} boutons désactivés avec raison` : '❌ Boutons non désactivés malgré trésorerie 0');
    if (disabledCount === 0) errors.push('[infra] boutons non désactivés malgré trésorerie insuffisante');
    await shot(A.page, '46-infra-bloque');
    /* Réseau v16 (aéroports) */
    await admReq.post(`${BASE}/api/admin/countries/france/grant`, { data: { cash: 3000 } });
    await A.page.reload({ waitUntil: 'networkidle' });
    await sleep(1200);
    await A.page.locator('.cat-btn:has-text("Transports")').click();
    await sleep(800);
    const airBtn = A.page.locator('.infra-card:has-text("Aéroports") button:has-text("Voir les boosts")').first();
    if (!(await airBtn.isVisible().catch(() => false))) errors.push('[infra] carte Aéroports introuvable dans Transports');
    else {
      await airBtn.click();
      await sleep(700);
      await A.page.waitForSelector('.showcase-cta', { timeout: 70000 });
      await sleep(400);
      const ctaDis = await A.page.locator('.showcase-cta').isDisabled();
      console.log(!ctaDis ? '✅ Réseau v16 (aéroports) : estimation OK, CTA actif' : '❌ CTA désactivé sur aéroports');
      if (ctaDis) errors.push('[infra] CTA désactivé sur un réseau v16 éligible');
      await shot(A.page, '48-infra-aeroports-cta');
      await A.page.locator('.showcase-alt').click();
      await sleep(400);
    }

    /* Infobulle ⓘ portal */
    await A.page.goto(`${BASE}/game`, { waitUntil: 'networkidle' });
    await sleep(1500);
    const tip = A.page.locator('.res-card .infotip-btn').first();
    if (!(await tip.isVisible().catch(() => false))) errors.push('[infotip] icône ⓘ absente de Ressources & stocks');
    await tip.hover();
    await sleep(500);
    const pop = A.page.locator('.infotip-fixed');
    let popOk = (await pop.count()) > 0;
    if (popOk) {
      const box = await pop.first().boundingBox();
      const cs = await pop.first().evaluate((el) => {
        const st = getComputedStyle(el);
        return { position: st.position, zIndex: st.zIndex, opacity: st.opacity };
      });
      popOk = !!box && cs.position === 'fixed' && Number(cs.opacity) > 0.9
        && box.y >= 0 && box.y + box.height <= 900 && box.x >= 0 && box.x + box.width <= 1440;
      console.log(popOk ? '✅ Infobulle Ressources & stocks : portal fixed, entièrement visible' : `❌ Infobulle mal placée (${JSON.stringify(box)} ${JSON.stringify(cs)})`);
    } else {
      console.log('❌ Infobulle absente au survol');
    }
    if (!popOk) errors.push('[infotip] popover caché/absent au survol');
    await shot(A.page, '45-infobulle-ouverte');
    await browser.close();
  }

  /* ==================== SESSION 3 : jackpot + expulsion ==================== */
  {
    const browser = await chromium.launch(LAUNCH);
    const A = await makeUser(browser, ...names.a);
    const B = await makeUser(browser, ...names.b);
    const ADM = await makeUser(browser, ...names.adm);
    const admReq = ADM.context.request;
    // B a libéré son pays en session 1 (cooldown 4 j) : purge admin + re-claim
    const users = await (await admReq.get(`${BASE}/api/admin/users`)).json();
    const bUser = users.users.find((u) => u.username === names.b[0]);
    if (bUser) await admReq.post(`${BASE}/api/admin/users/${bUser.id}/clear-cooldown`);
    const claimB = await B.context.request.post(`${BASE}/api/countries/usa/claim`);
    if (claimB.status() !== 200) errors.push(`[bigwin] re-claim usa par B : ${claimB.status()}`);
    await sleep(600);
    // Alimentation : gros stocks côté France ET place libre côté USA
    await admReq.post(`${BASE}/api/admin/countries/france/grant`, { data: { resources: { food: 99999 } } });
    await admReq.post(`${BASE}/api/admin/countries/usa/grant`, { data: { cash: 5000, resources: { food: -1000000 } } });
    await sleep(600);
    const frState = await (await A.context.request.get(`${BASE}/api/countries/france`)).json();
    const mkt = await (await A.context.request.get(`${BASE}/api/world/market`)).json();
    const foodStock = frState.country.resources.food.stock;
    const units = Math.floor(foodStock * 0.4);
    const minPrice = 10.5 / (units * 0.045);
    const unitPrice = Math.min(4.99, Math.round(Math.max(mkt.market.food.price, minPrice) * 100) / 100);
    console.log(`[bigwin] foodStock=${foodStock} units=${units} minPrice=${minPrice.toFixed(3)} unitPrice=${unitPrice}`);
    const pubA = await A.context.request.post(`${BASE}/api/countries/france/actions`, { data: { params: { type: 'create_offer', resource: 'food', units, unitPrice } } });
    const pubABody = await pubA.json();
    if (!pubABody.ok) errors.push(`[bigwin] publication A refusée : ${pubABody.error}`);
    await A.page.goto(`${BASE}/game/resources`, { waitUntil: 'networkidle' });
    await sleep(1200);
    const offersNow = await (await A.context.request.get(`${BASE}/api/world/offers`)).json();
    const bigOffer = offersNow.offers.find((o) => o.sellerId === 'france' && o.resource === 'food');
    if (!bigOffer) errors.push('[bigwin] grande offre introuvable');
    else {
      const buyBig = await B.context.request.post(`${BASE}/api/countries/usa/actions`, { data: { params: { type: 'buy_offer', offerId: bigOffer.id } } });
      const buyBigBody = await buyBig.json();
      if (!buyBigBody.ok) errors.push(`[bigwin] achat B refusé : ${buyBigBody.error}`);
      await sleep(1500);
      const jp = A.page.locator('.jackpot-backdrop');
      const jpVisible = await jp.isVisible().catch(() => false);
      const noClose = (await A.page.locator('.jackpot-backdrop button').count()) === 0;
      console.log(jpVisible && noClose ? '✅ Gain ≥ 10 Md entre JOUEURS : célébration inratable chez le vendeur' : `❌ Célébration (visible=${jpVisible}, noClose=${noClose})`);
      if (!jpVisible) errors.push('[bigwin] célébration absente après achat joueur→joueur ≥ 10 Md');
      if (!noClose) errors.push('[bigwin] célébration skippable');
      const freezeTag = await A.page.addStyleTag({ content: '.jackpot-rays,.jp-rays2,.jp-fall,.jp-coin,.jp-bill,.jp-spark,.jackpot-card,.jackpot-glow,.jackpot-kicker,.jackpot-bar span,.jp-ring,.jp-ring2{animation:none !important}' });
      await sleep(300);
      await shot(A.page, '49-gain-exceptionnel');
      await freezeTag.evaluate((el) => el.remove()).catch(() => undefined); // remise en route des VRAIES animations
      await sleep(4200);
      await shot(A.page, '49b-gain-en-mouvement'); // pièces/billets/fontaines en pleine animation
      /* Sortie ANIMÉE : on guette la classe .leaving (fenêtre ~900 ms avant
         le démontage) par polling actif, puis la disparition totale. */
      let sawLeaving = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 18000) {
        if (await A.page.locator('.jackpot-backdrop.leaving').count()) { sawLeaving = true; break; }
        if (!(await A.page.locator('.jackpot-backdrop').count())) break; // déjà démonté
        await sleep(100);
      }
      console.log(sawLeaving ? '✅ Sortie animée de la célébration (fondu + envol de la carte)' : '❌ Pas de phase de sortie animée');
      if (!sawLeaving) errors.push('[bigwin] sortie non animée');
      const t1 = Date.now();
      while (Date.now() - t1 < 5000 && (await A.page.locator('.jackpot-backdrop').count())) await sleep(150);
      if (await A.page.locator('.jackpot-backdrop').count()) errors.push('[bigwin] célébration ne se termine pas après 15 s');
      else console.log('✅ Célébration terminée seule après 15 s (sortie animée)');
    }
    /* Exclusion admin */
    const expel = await admReq.post(`${BASE}/api/admin/countries/france/expel`);
    const expelBody = await expel.json();
    console.log(expelBody.ok ? '✅ Expulsion admin OK (cooldown posé)' : `❌ Expulsion échouée : ${JSON.stringify(expelBody)}`);
    if (!expelBody.ok) errors.push('[admin] expulsion échouée');
    await A.page.goto(`${BASE}/game`, { waitUntil: 'networkidle' });
    await sleep(1200);
    await shot(A.page, '40-A-apres-expulsion');
    await browser.close();
  }
} catch (e) {
  errors.push(`[script] ${String(e).slice(0, 400)}`);
} finally {
  server.kill('SIGKILL');
}

console.log('\n================ RÉSUMÉ VISUEL v1.12+ ================');
if (errors.length === 0) console.log('✅ Aucune erreur détectée.');
else { console.log(`❌ ${errors.length} problème(s) :`); for (const e of errors) console.log('  -', e); }
console.log(`Captures : ${SHOTS}`);
process.exit(errors.length === 0 ? 0 : 1);
