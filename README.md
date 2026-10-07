# ◈ GEOPOLIS

**Un monde. 36 nations. Une économie vivante.**

GEOPOLIS est un **simulateur géopolitique persistant, multijoueur et temps réel** : politique, économie et diplomatie — **sans aucun système de guerre**. Chaque nation est dirigée soit par un **joueur humain** (un seul à la fois), soit par un **dirigeant IA autonome** qui gouverne en continu. Le monde est **unique** : pas de parties, pas de lobbies, pas de tours, pas de reset. Il tourne même quand personne n'est connecté.

> Client React/Vite + serveur Express/WebSocket + moteur de simulation serveur-authoritative.
> Stockage : Upstash Redis (production) ou fichier JSON local (développement).

---

## ✨ Le jeu en un coup d'œil

| Système | Détail |
|---|---|
| 🌍 Monde persistant | 36 nations d'un monde alternatif, état stocké côté serveur (jamais dans le navigateur), survie aux redéploiages |
| ⏱ Simulation continue | 1 tick = **1 jour de jeu = 10 minutes réelles** (plancher serveur garanti, `TICK_MS_FORCE` pour tester). Reprise après crash avec rattrapage (jusqu'à 144 jours) |
| 👥 Multijoueur temps réel | WebSocket (heartbeat, reconnexion auto, resync complète, fallback polling HTTP). Pushs : économie, offres, livraisons, diplomatie, **gains exceptionnels** |
| 🤖 IA décisionnelle | Cycle : analyser → identifier les problèmes → évaluer → agir → observer → ajuster. 8 personnalités stratégiques, décisions journalisées. Achats d'offres des joueurs quand le prix est bon (immédiat en pénurie critique), relance −8 % des offres invendues, achat de routes au ROI mesuré, péages optimisés (logique de Laffer), diplomatie de complémentarité |
| 📈 Économie | PIB, croissance, inflation, chômage, productivité, consommation, investissement, niveau de vie, dette, intérêts, trésorerie. **Élasticités par ressource** (demande 0.80–1.30, offre 0.72–1.12), **détérioration des stocks au-delà de 90 % de capacité** (3 %/jour), **plafond de trésorerie** (1.2×PIB : remboursement de dette puis stérilisation ; borne d'intégrité 2×PIB) |
| 🛢 Ressources & marchés | 8 ressources, production/consommation/stocks, pénuries réelles, prix locaux + marché mondial, historique des prix |
| ⚖ Commerce international | Appariement offre/demande mondial pondéré par relations, accords, tarifs, sanctions et infrastructures. **Réseau de 32 routes stratégiques — toutes achetables, AUCUNE voie directe** : chaque marchandise transite par au moins une route que son propriétaire peut taxer ; les péages tombent dans sa trésorerie |
| 📦 Livraisons exceptionnelles | Réservation de marchandise + **ACCEPTATION obligatoire du destinataire** (accepte → débité et livré ; refuse → retour) ; sans réponse sous 3 jours de jeu, retour automatique. **Aucun argent créé** |
| 🤝 Offres de vente | Les joueurs et les IA publient des lots (≤40 % du stock) ; **le marché est visible par tout le monde** : filtres (joueurs/IA/bons prix), tri, badges, statistiques du marché et prix conseillés par ressource. Les IA y répondent. **La vente directe au marché mondial a été retirée** — seule la vente inter-états existe |
| 💰 Achats bilatéraux | Achat direct chez une autre nation au prix vendeur +6 % (disponibilité calculée serveur, péages de transit) |
| 🤝 Diplomatie | Score relationnel + confiance par paire, 5 types d'accords, propositions/acceptations (joueurs et IA), aides économiques, mesures économiques (jamais militaires) |
| 🏗 Infrastructures | **18 infrastructures en 5 catégories** (Énergie & Production, Transport & Commerce, Santé & Bien-être, Éducation & Recherche, Sécurité & Gouvernance). Niveaux 1→10, coûts et durées croissants, **entretien journalier réel**, et **bonus réels appliqués au moteur** : logistique, productivité, énergie, export, agriculture, croissance, recettes, dette, popularité, stabilité. Chaque catégorie a des **effets de synergie par niveau de complétion** (2/4/6/8/10). Diaporama d'impact animé avant chaque chantier (bouton **Passer** disponible) |
| 🎆 Gains exceptionnels | Un joueur humain qui encaisse **≥ 10 Md € d'un coup** (offre achetée, achat bilatéral, livraison acceptée) déclenche une **célébration plein écran de 15 s** : compteur d'argent, pièces € en rotation 3D, billets ondulants, fontaines en vagues, double nappe de rayons, anneaux d'onde, sortie animée. **Inratable par conception** (aucun bouton de fermeture). Son optionnel fourni par le joueur : `client/public/sounds/bigwin.mp3` (13 s ; silencieux si absent) |
| 🏛 Politique | Changement de **régime** (6 régimes à effets permanents, alignement sur les revendications réelles du peuple, lune de miel 30 j, cooldown 90 j — les IA transitionnent aussi), fiscalité, budget par secteur, taux directeur, **14 lois** (coûts annuels réels ; dont 4 lois de popularité), **simulateur législatif**, popularité multi-factorielle, stabilité, **mandat à risque progressif** (seuil + durée + avertissements + redressement possible → succession IA sans perte de données) |
| ⚡ Événements | 12 événements conditionnels (déclenchés par l'état réel du pays, jamais purement aléatoires), durée + modificateurs appliqués aux autres sous-systèmes |
| 🏭 Production | **16 bâtiments productifs achetables** (2 paliers × 8 ressources), payés par la trésorerie, construction 3–12 jours (barres de progression, notifications), production quotidienne réelle à l'échelle du pays, entretien journalier, plafonds. Les IA bâtissent aussi et vendent leurs surplus en offres |
| ❓ Assistant de jeu | Fenêtre ❓ : **2000+ réponses** (concepts, nations, routes, lois, ressources, événements, erreurs, stratégies), détection de question (normalisation, intentions, TF-IDF, index inversé, tolérance aux fautes Levenshtein), réponses avec **vos chiffres réels**, effet machine à écrire |
| 🔐 Comptes & sécurité | Inscription/connexion (bcrypt, sessions serveur hashées `SESSION_SECRET`), rate limiting, idempotence des actions (`requestId`), validation zod sur chaque route, permissions vérifiées côté serveur. **Cooldown de retour : 4 jours RÉELS** après avoir quitté un pays (release ou expulsion) avant tout nouveau mandat — anti country-hopping |
| 🛡 Admin | Rôle déterminé côté serveur par `ADMIN_EMAIL`. Dashboard supervision (moteur, stockage, intégrité, erreurs), gestion utilisateurs (suspension, suppression, purge du cooldown), édition pays, **expulsion** (retour IA + cooldown + notification), **octroi/retrait** de trésorerie, dette, popularité, stabilité et stocks (deltas journalisés), ticks forcés, réparation, reseed avec confirmation forte |
| 🗺 Carte 2D | SVG local (aucune API externe), zoom/pan/hover/sélection, 7 modes (nations, économie, ressources, commerce, diplomatie, population, infrastructures), flux commerciaux animés issus des vraies données |
| 🎨 UI | Thème « Cartoon Pro » : bleu nuit, bleu vif, menthe, corail et violet ; police ronde Nunito (repli système), cartes glass façon Apple, tilt 3D au pointeur, sheen balayé, entrées rebond, fusée au survol des CTA, en-têtes pédagogiques avec chips live, cartes « Comment ça marche », accessibilité (focus visible, `prefers-reduced-motion`), responsive desktop→mobile |
| 🗒 Journal | 200 derniers événements mondiaux (accords, routes, offres, livraisons, chantiers…) avec heure, catégorie et pays |

**Règle absolue : aucune guerre.** Les tensions sont exclusivement économiques, commerciales, diplomatiques et politiques. Les 36 entités restent toujours présentes.

---

## 🏗️ Architecture

```
geopolis/
├── shared/    Types, constantes et protocole communs (types.ts, constants.ts, protocol.ts)
├── server/    Express + WS + moteur autoritaire
│   └── src/
│       ├── api/           routes.ts, middleware.ts, index.ts (zod, auth, rate limit)
│       ├── auth/          bcrypt, sessions serveur hashées
│       ├── simulation/    engine.ts (tick), economy.ts, production.ts, trade.ts,
│       │                  politics.ts, ai.ts, model.ts (types internes)
│       ├── world/         world.ts (état), seed.ts (génération), integrity.ts
│       │                  (validateWorld + bornes économiques + réparations)
│       ├── storage/       upstash.ts (Redis) + fallback fichier JSON local
│       ├── realtime/      hub.ts (WS, resync, sendBigWin, notifications)
│       ├── actions/       registry.ts (toutes les actions joueurs/IA + estimation
│       │                  de coût + déclenchement bigWin)
│       └── config.ts      résout TICK_MS (plancher 10 min en production,
│                          TICK_MS_FORCE=true pour forcer en test)
├── client/    React 18 + Vite + TypeScript
│   └── src/
│       ├── pages/         ChooseCountry, game/{Dashboard,Politics,Laws,Budget,
│       │                  Trade,Taxes,Production,Infrastructure,Resources,
│       │                  Diplomacy,Map,Journal,...}, admin/*
│       ├── components/    GameHeader, WorldMap (SVG), InfoTip (portail),
│       │                  JackpotOverlay (célébration), NotificationCenter, ui/*
│       ├── state/         GameContext (WS, resync, files bigwin/livraisons)
│       ├── lib/           api.ts, ws.ts, assistant/* (moteur de réponses)
│       ├── data/          worldMap.ts (atlas SVG 36 nations)
│       └── styles/        global.css (thème complet + couches v13→v20)
└── scripts/   smoke.mjs (34 scénarios), visual-check.mjs + visual-v12.mjs
               (captures Playwright), ui-audit.mjs (audit accessibilité),
               econ-probe.mjs (sonde économique longue durée)
```

**Flux d'une action joueur** : clic UI → `POST /api/action` (auth + zod + requestId) → `registry.executeAction` (validation métier, effets sur le monde, coûts réels) → `commitWorld` (Upstash) → push WS aux concernés (`sendEconomy`, `sendTrade`, `sendBigWin`…) → le `GameContext` met à jour l'UI.

**Flux d'un tick (10 min)** : `engine.ts` → production → consommation → prix (élasticités) → échanges (routes, péages, livraisons) → économie (lois, entretiens, intérêts, plafond de trésorerie) → politique (événements, régimes, mandat) → IA (cycle décisionnel) → sauvegarde + `validateWorld` (réparations si dérive) → pushs WS.

---

## 🚀 Installation & développement local

Prérequis : **Node.js ≥ 20**.

```bash
git clone https://github.com/StaffPub/geopolis.git
cd geopolis
npm ci --include=dev
npm run build -w shared     # nécessaire pour le typecheck serveur
npm run dev                 # client : http://localhost:5173 — serveur : http://localhost:8080
```

En développement, le monde est stocké dans `data/world.json` (fichier local) — supprimez-le pour repartir d'un monde neuf. Le tick de 10 minutes s'applique partout ; pour tester avec des ticks rapides : `TICK_MS_FORCE=true TICK_MS=15000 npm run dev -w server`.

### Scripts utiles

| Commande | Rôle |
|---|---|
| `npm test` | Suite complète (**167 tests** : économie, production, commerce, politique, IA, actions, routes, livraisons, cooldown, intégrité, infrastructures, assistant…) |
| `npm run smoke` | 34 scénarios bout-en-bout sur un serveur réel |
| `npm run audit:ui` | Audit d'interface (contrastes, focus, tailles, hiérarchie z-index) |
| `npm run typecheck` | TypeScript strict sur les 3 workspaces |
| `npm run lint` | ESLint (0 warning toléré) |
| `npm run build` | Builds production (shared → server → client) |
| `node scripts/visual-check.mjs` | Captures + assertions des parcours joueurs |
| `node scripts/visual-v12.mjs` | Captures de la version courante en 3 sessions (pages, admin, offre joueur→joueur + célébration) |

### Déploiement (Render + Upstash)

1. Créer le service Web Render sur ce dépôt — build `npm ci && npm run build`, start `npm start`, **instance persistante**.
2. Variables : `NODE_ENV=production`, `PORT`, `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
3. Le monde Upstash **survit aux redéploiages** (`/api/admin/supervision` affiche `storage: upstash`).
4. Après chaque `git push`, Render redéploie automatiquement.

Pour pousser depuis votre poste Windows : double-cliquez **`MAJ-REPO.bat`** à la racine (il demande votre token `ghp_…` une fois, puis force-push tout le dossier). Le fichier reste local (`.gitignore`).

### Son de célébration (optionnel)

Déposez votre son de **13 secondes** dans `client/public/sounds/bigwin.mp3` (le fichier n'est PAS versionné — il subsiste à chaque maj). Sans lui, la célébration est silencieuse.

---

## 🧮 Modèle économique (l'essentiel)

- **Valeur d'une ressource** : `unités × prix × VALUE_SCALE × 1000` (`VALUE_SCALE = 0.000045`).
- **Prix** : les prix locaux convergent vers le cours mondial via un flux net par ressource ; la pression sature les stocks (détérioration > 90 % de capacité) et les pénuries font grimper les prix (élasticités par ressource).
- **Trésorerie** : plafonnée à 1.2×PIB — au-delà, remboursement automatique de dette, puis stérilisation progressive (50 %/jour) ; la borne d'intégrité (2×PIB) ne sert plus jamais de réparation visible.
- **Livraisons exceptionnelles** : `send_resource` réserve la marchandise (le vendeur est débité du stock, pas payé) ; `accept_delivery`/`reject_delivery` côté destinataire (accepté → trésorerie débitée, stock reçu ; aucune création monétaire). Péages de transit toujours appliqués.
- **Big win** : tout encaissement joueur ≥ `BIG_WIN_THRESHOLD` (10 Md €) en une action de commerce déclenche l'événement WS `bigwin` → célébration (jamais pour les IA, jamais pour l'admin).
- **Lois** : coût annuel réel prélevé chaque tick-jour (fraction du coût annuel).

---

## 📜 Historique des versions (résumé)

- **v1.20** — Célébration v3 (sortie animée, fontaines en vagues, rayons doubles, anneaux), bouton **Passer** restauré sur le diaporama, estimation de chantier stabilisée, nettoyage du code mort, README complet.
- **v1.19** — Stabilisation économique (élasticités, détérioration des stocks, coefficient aérien par niveau, plafond de trésorerie), sonde 250 jours saine.
- **v1.18** — Intelligence IA des ressources : achat hors-cycle en pénurie critique, pricing avisé des offres, relance −8 %, réponses aux propositions des joueurs.
- **v1.17** — Refonte du marché des offres (filtres, tri, badges, stats, prix conseillés) ; suppression de la vente au marché mondial ; performance (pause des décors sous modale, halo unique, zéro blur plein écran).
- **v1.16** — Célébration des gains exceptionnels (compteur, pluie, son joueur) ; **18 infrastructures** en 5 catégories avec bonus moteur réels, synergies et diaporama d'impact animé ; InfoTip en portail (jamais rogné).
- **v1.15** — Thème « Cartoon Pro » (bleu nuit / menthe / corail / violet, Nunito, glass, tilt 3D).
- **v1.14** — Refonte des 13 onglets : en-têtes pédagogiques, cartes « Comment ça marche », atlas mondial animé, jauges et cartes 3D.
- **v1.13** — Thème « Cabinet » (supersédé), modale de chantier avec boosts animés.
- **v1.12** — Diaporama d'infrastructure, journal mondial 200 événements, notifications.
- **v1.11** — **1 jour = 10 minutes** (plancher serveur garanti, `TICK_MS_FORCE`), livraisons avec acceptation, cooldown de retour 4 jours, pouvoirs admin étendus (expulsion, octrois, purge cooldown), correctifs économiques (coûts des lois, plafond de cash).
- **v1.10 et avant** — régimes, lois de popularité, mandat à risque, bâtiments productifs, assistant 2000+ réponses, cartes SVG, sécurité (bcrypt/zod/rate-limit), IA décisionnelle complète.

---

## 📄 Licence

Usage privé / démonstration.
