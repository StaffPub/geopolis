/**
 * GEOPOLIS — Assistant : construction de la base de connaissances.
 * Combine le contenu rédigé (kb-data.ts) et les entrées GÉNÉRÉES depuis les
 * catalogues du jeu (nations, routes, ressources, lois, infrastructures,
 * événements, accords, budgets, actions) + les données RÉELLES de votre pays.
 * Total : plus de 2000 réponses possibles.
 */
import type { Country, MarketResource, PublicCountry, ResourceKey, TradeCorridor, WorldMeta } from 'shared';
import {
  AGREEMENT_TYPES, EVENT_CATALOG, FACILITIES, INFRA, LAWS, REGIMES, RESOURCES, RESOURCE_MAP,
  SPENDING_SECTORS, facilityOutput, regimeAlignment,
} from 'shared';
import {
  BEGINNER, CORE_CONCEPTS, ERRORS, FAQ, FAQ2, GLOSSARY, GLOSSARY2,
  REGIME_ERRORS, REGIME_FAQ, REGIME_GLOSSARY,
  REGIONS, RESOURCES_MGMT, SITUATIONS, STRATEGIES, THRESHOLDS, UI_PAGES,
  type AssistCategory,
} from './kb-data.js';

export type { AssistCategory };

export interface AssistContext {
  country: Country | null;
  countries: PublicCountry[];
  corridors: TradeCorridor[];
  market: Record<ResourceKey, MarketResource> | null;
  meta: WorldMeta | null;
}

export interface KbEntry {
  id: string;
  cat: AssistCategory;
  title: string;
  patterns: string[];
  answer: string;
  followups?: string[];
}

const money = (v: number): string =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} Td €` : `${v.toFixed(1)} Md €`;

const ACTIONS_CATALOG: { id: string; label: string; what: string; how: string; when: string }[] = [
  { id: 'set_tax', label: 'Impôt sur le revenu', what: "Fixe le taux d'imposition des ménages : recettes directes contre popularité et consommation.", how: "Page Politique → curseur Impôt revenu → confirmer (effets estimés affichés).", when: "En croissance pour engranger, en crise de popularité pour lâcher du lest." },
  { id: 'set_corporate_tax', label: 'Impôt sur les sociétés', what: "Taxe les entreprises : recettes contre investissement privé.", how: "Page Politique → curseur Impôt sociétés → confirmer.", when: "Moins douloureux politiquement que l'impôt revenu : à préférer pour redresser un déficit." },
  { id: 'set_tariff', label: 'Tarifs douaniers', what: "Taxe vos importations (recette douanière) et renchérit les prix intérieurs.", how: "Page Politique → douanes (tarif global + dépassements par partenaire).", when: "Pour financer l'État via le commerce, ou protéger un secteur naissant — jamais pendant une pénurie." },
  { id: 'set_interest_rate', label: 'Taux directeur', what: "Arme monétaire : refroidit inflation (et croissance) quand il monte.", how: "Page Politique → taux directeur → confirmer.", when: "Inflation > 5-6 % : +0,5. Croissance molle et inflation basse : −0,25." },
  { id: 'set_spending', label: 'Budgets sectoriels', what: "Huit curseurs (santé, éducation, transports, énergie, industrie, agriculture, recherche, social) en % du PIB.", how: "Page Politique → budgets → ajuster → confirmer.", when: "Social/santé pour la popularité ; industrie/recherche/éducation pour l'avenir." },
  { id: 'start_project', label: 'Lancer un chantier', what: "Démarre la construction d'une infrastructure (coût débité immédiatement).", how: "Page Infrastructures → Lancer le chantier sur le type voulu.", when: "Trésorerie > coût + marge ; priorité aux ports/logistique (commerce) ou au besoin du moment." },
  { id: 'cancel_project', label: 'Annuler un chantier', what: "Stoppe un chantier en cours (sans remboursement).", how: "Page Infrastructures → chantier actif → Annuler.", when: "Crise de trésorerie aiguë uniquement." },
  { id: 'enact_law', label: 'Adopter une loi', what: "Active une réforme permanente (coût annuel, effets ciblés).", how: "Page Lois → Adopter sur la fiche de la loi.", when: "Quand le problème visé est durable ; max 6 lois actives." },
  { id: 'repeal_law', label: 'Révoquer une loi', what: "Supprime une loi active (fin du coût ET des effets).", how: "Page Lois → Révoquer.", when: "Une loi impopulaire en pleine crise de popularité, ou un coût devenu insoutenable." },
  { id: 'propose_agreement', label: 'Proposer un accord', what: "Ouvre une négociation (5 types d'accords) avec un pays.", how: "Page Diplomatie → pays → Proposer un accord → type.", when: "Relations ≥ 45-50 ; libre-échange d'abord avec les partenaires complémentaires." },
  { id: 'respond_proposal', label: 'Répondre à une proposition', what: "Accepte ou refuse un accord proposé (joueurs et IA).", how: "Notifications ou page Diplomatie → Accepter/Refuser.", when: "Un libre-échange d'un gros partenaire se refuse rarement ; vérifiez sa popularité (désapprobation)." },
  { id: 'improve_relations', label: 'Améliorer les relations', what: "Geste diplomatique direct : petit gain de score immédiat.", how: "Page Diplomatie → pays → Améliorer les relations.", when: "Pour débloquer le seuil de 30 (commerce) ou préparer un accord (45+)." },
  { id: 'send_aid', label: 'Aide économique', what: "Transfert de trésorerie (min 0,5 Md €) : relations, confiance et stabilité du partenaire ↑.", how: "Page Diplomatie → pays → Aide économique → montant.", when: "Pour ancrer une alliance ou sauver un partenaire stratégique en crise." },
  { id: 'impose_sanction', label: 'Mesure économique', what: "Gèle les échanges bilatéraux (sanction). Coût commercial partagé.", how: "Page Diplomatie → pays → Mesure économique.", when: "Contre un rival dépendant de VOUS (asymétrie) ; jamais contre votre premier client." },
  { id: 'lift_sanction', label: 'Lever une mesure', what: "Normalise les échanges avec un pays sanctionné.", how: "Page Diplomatie → pays → Lever la mesure.", when: "Quand le coût commercial dépasse le bénéfice politique." },
  { id: 'buy_resource', label: 'Acheter une ressource', what: "Achat au prix du marché mondial : trésorerie → stocks.", how: "Page Commerce/marché → Acheter → ressource → quantité.", when: "URGENCE pénurie (stocks < 35 %) ou pari sur une hausse de prix." },
  { id: 'sell_via_offer', label: 'Vendre une ressource (offre)', what: "On ne vend plus au marché mondial : on PUBLIE UNE OFFRE (lot + votre prix) visible par tous les joueurs et toutes les IA.", how: "Onglet Ressources → « Publier une offre » → ressource, unités (40 % du stock max), prix (boutons ± vs cours mondial).", when: "Surstock (> 60-70 %), cours mondial haut, ou besoin de cash : l'acheteur (joueur ou IA) paie et la recette tombe dans votre trésorerie." },
  { id: 'buy_corridor', label: 'Acheter une route', what: "Acquiert un corridor libre : péages sur transit tiers versés à votre trésorerie.", how: "Page Commerce → marché des routes → Acheter (prix affiché).", when: "Route à fort trafic encore libre, ou route qui taxe vos propres flux. Cooldown 5 jours." },
  { id: 'abandon_corridor', label: 'Abandonner une route', what: "Libère un corridor possédé (fin de l'entretien et des péages, non remboursé).", how: "Page Commerce → votre route → Abandonner.", when: "Route devenue non rentable (trafic détourné durablement). Cooldown 10 jours." },
  { id: 'set_toll', label: 'Fixer un péage', what: "Règle le % prélevé sur chaque transit tiers de votre route (0-15).", how: "Page Commerce → votre route → curseur péage → Appliquer.", when: "Trafic fort et peu d'alternative : montez. Trafic en fuite : baissez. Cooldown 2 jours." },
  { id: 'ship_goods', label: 'Expédier des marchandises', what: "Livraison manuelle d'un lot (partenaire, ressource, quantité, route) — le destinataire doit l'ACCEPTER : il paie la valeur et reçoit les ressources (aucun argent créé).", how: "Page Commerce → Expédition exceptionnelle → formulaire → devis → confirmer ; le destinataire répond via sa notification ou le panneau « Livraisons en attente » (retour automatique après 3 jours sans réponse).", when: "Saisir un prix local haut chez le partenaire, dépanner un allié, ou vider un surstock." },
  { id: 'break_agreement', label: 'Rompre un accord', what: "Dénonce un accord actif : −10 relations, −8 confiance, fin des bonus.", how: "Page Diplomatie → accord actif → Rompre.", when: "Un accord devenu structurellement défavorable — et seulement lui." },
  { id: 'set_production', label: 'Consigne de production', what: "Règle le rythme d'une ressource : boost (+15 %, subventionné), normal, ou ralenti (−12 %, économies). 3 boosts max.", how: "Onglet Ressources → carte de la ressource → segmenteur ▾Ralenti / ●Normal / ▲Boost → confirmer.", when: "Boost dès 40 % de stocks (pénurie imminente) ; ralenti en surstock quand les prix sont bas." },
  { id: 'buy_from_country', label: 'Acheter à un pays', what: "Achat bilatéral immédiat dans les stocks d'une nation : prix local du vendeur + 6 % de prime, relations +0,2.", how: "Onglet Ressources → « Acheter à un pays » → choisir la ressource, le vendeur, le lot → Acheter.", when: "Quand un vendeur éligible affiche un prix sous le cours mondial, ou en urgence pénurie." },
  { id: 'create_offer', label: 'Publier une offre de vente', what: "Met en vente un lot (quantité + prix unitaire) sur le marché inter-états : IA et joueurs peuvent l'acheter.", how: "Onglet Ressources → section Offres → ressource, quantité (40 % du stock max), prix → Publier.", when: "Surstock, prix mondiaux hauts, ou besoin de trésorerie passive (les IA achètent seules)." },
  { id: 'cancel_offer', label: 'Retirer une offre', what: "Retire votre lot du marché inter-états (sans frais).", how: "Onglet Ressources → Mes offres → bouton Retirer.", when: "Si les prix remontent (mieux vaut revendre plus tard) ou si vos stocks deviennent tendus." },
  { id: 'buy_offer', label: 'Acheter une offre', what: "Achète un lot publié par une autre nation au prix fixé par le vendeur ; paiement immédiat, livraison immédiate.", how: "Onglet Ressources → Offres des autres nations → bouton Acheter.", when: "Dès qu'un lot passe sous votre prix local : c'est moins cher que le marché mondial." },
  { id: 'change_regime', label: 'Changer de régime politique', what: "Proclame un nouveau régime (6 choix) : coût immédiat en stabilité, popularité ± selon l'alignement avec le peuple, puis effets permanents + lune de miel ou gueule de bois 30 jours.", how: "Page Politique → carte du régime visé → « Proclamer » → confirmer (effets estimés par le serveur). Cooldown 90 jours, stabilité ≥ 25 requise.", when: "Quand une revendication dominante du peuple correspond au régime visé (alignement ≥ 50 %) : le boost immédiat et la lune de miel paient la transition." },
  { id: 'build_facility', label: 'Construire un bâtiment de production', what: "Achète un bâtiment productif (16 types, 2 paliers × 8 ressources) : débit immédiat de la trésorerie, construction 3-12 jours, puis production quotidienne réelle + entretien journalier.", how: "Onglet Production 🏭 → carte du bâtiment → Construire ×1 ou ×3 → confirmer (devis serveur affiché).", when: "Pénurie/tension sur une ressource, trésorerie qui dort, ou stratégie d'exportation ciblée sur une ressource bien payée." },
  { id: 'set_route', label: 'Choisir une route par partenaire', what: "Impose la combinaison de corridors pour vos flux automatiques vers un pays.", how: "Page Commerce → Mes routes par partenaire → Emprunter cette route.", when: "Pour éviter un péage abusif ou sécuriser vos propres routes (péage nul sur les vôtres)." },
];

export const POPULAR_QUESTIONS: string[] = [
  'Comment fonctionne le solde budgétaire ?',
  'Comment acheter une route commerciale ?',
  'Comment faire monter ma popularité ?',
  'Pourquoi mes marchandises paient un péage ?',
  'Comment baisser mon chômage ?',
  'Comment booster ma production de ressources ?',
  'Comment acheter une ferme ?',
  'Que se passe-t-il si mon gouvernement tombe ?',
  'Comment gagner de l\'argent ?',
  'Quelle est la meilleure loi ?',
  'Comment signer un accord de libre-échange ?',
  'Pourquoi mon déficit se creuse ?',
  'Comment réduire mon inflation ?',
];

export function buildKb(ctx: AssistContext): KbEntry[] {
  const out: KbEntry[] = [];
  const push = (id: string, cat: AssistCategory, title: string, patterns: string[], answer: string, followups?: string[]): void => {
    out.push({ id, cat, title, patterns, answer, followups });
  };

  /* ---- Concepts fondamentaux (28 × 9 facettes) ---- */
  for (const c of CORE_CONCEPTS) {
    const base = c.term.toLowerCase();
    const al = c.aliases;
    push(`cc-${base}-def`, c.cat, c.term, [base, `c'est quoi ${base}`, `définition ${base}`, ...al], c.def);
    push(`cc-${base}-meca`, c.cat, `${c.term} — mécanisme`, [`comment marche ${base}`, `comment fonctionne ${base}`, `mécanisme ${base}`, ...al.map((a) => `comment marche ${a}`)], c.meca);
    push(`cc-${base}-up`, c.cat, `${c.term} — augmenter`, [`comment augmenter ${base}`, `comment monter ${base}`, `faire monter ${base}`, `améliorer ${base}`, ...al.map((a) => `augmenter ${a}`)], c.up);
    push(`cc-${base}-down`, c.cat, `${c.term} — baisser`, [`comment baisser ${base}`, `comment réduire ${base}`, `faire descendre ${base}`, `diminuer ${base}`, ...al.map((a) => `baisser ${a}`)], c.down);
    push(`cc-${base}-pop`, c.cat, `${c.term} — popularité`, [`effet ${base} popularité`, `${base} et popularité`, `impact ${base} opinion`], c.pop);
    push(`cc-${base}-growth`, c.cat, `${c.term} — croissance`, [`effet ${base} croissance`, `${base} et pib`, `impact ${base} croissance`], c.growth);
    push(`cc-${base}-cash`, c.cat, `${c.term} — trésorerie`, [`effet ${base} trésorerie`, `${base} et argent`, `impact ${base} cash`], c.cash);
    push(`cc-${base}-mistake`, c.cat, `${c.term} — erreur classique`, [`erreur ${base}`, `piège ${base}`, `mal gérer ${base}`], c.mistake);
    push(`cc-${base}-tip`, c.cat, `${c.term} — astuce`, [`astuce ${base}`, `conseil ${base}`, `optimiser ${base}`, `stratégie ${base}`], c.tip, ['Comment fonctionne le solde budgétaire ?', 'Comment gagner de l\'argent ?']);
  }

  /* ---- Situations (10 × 5 + checklist) ---- */
  SITUATIONS.forEach((s, i) => {
    s.a.forEach((line, j) => {
      push(`sit-${i}-${j}`, s.cat, `${s.title} — étape ${j + 1}`, [`${s.title.toLowerCase()} ${j + 1}`, ...s.q.map((q) => `${q} ${j + 1}`), ...(j === 0 ? s.q : [])], line);
    });
    push(`sit-${i}-all`, s.cat, `${s.title} — plan complet`, [s.title.toLowerCase(), ...s.q], s.a.map((l, j) => `${j + 1}. ${l}`).join('\n'));
  });

  /* ---- Pages & interface ---- */
  UI_PAGES.forEach((p, i) => {
    push(`ui-${i}`, p.cat, p.page, [p.page.toLowerCase(), ...p.q], p.a);
  });

  /* ---- FAQ & glossaire & seuils ---- */
  FAQ.forEach((f, i) => push(`faq-${i}`, f.cat, f.q[0]!, f.q, f.a));
  FAQ2.forEach((f, i) => push(`faq2-${i}`, f.cat, f.q[0]!, f.q, f.a));
  GLOSSARY.forEach((g, i) => push(`gl-${i}`, g.cat, `Glossaire : ${g.t[0]!}`, g.t, g.a));
  GLOSSARY2.forEach((g, i) => push(`gl2-${i}`, g.cat, `Glossaire : ${g.t[0]!}`, g.t, g.a));
  BEGINNER.forEach((b, i) => push(`beg-${i}`, 'débutant', b.q[0]!, b.q, b.a));
  THRESHOLDS.forEach((t, i) => push(`th-${i}`, 'général', t.q[0]!, t.q, t.a));
  RESOURCES_MGMT.forEach((r, i) => push(`rm-${i}`, 'ressources', r.q[0]!, r.q, r.a));
  REGIME_FAQ.forEach((r, i) => push(`regfaq-${i}`, r.cat, r.q[0]!, r.q, r.a));
  REGIME_ERRORS.forEach((r, i) => { push(`regerr-${i}-why`, 'erreurs', `« ${r.msg} » — pourquoi`, [`pourquoi ${r.msg.toLowerCase()}`, `erreur ${r.msg.toLowerCase()}`], r.why); push(`regerr-${i}-fix`, 'erreurs', `« ${r.msg} » — que faire`, [`que faire ${r.msg.toLowerCase()}`, `solution ${r.msg.toLowerCase()}`], r.fix); });
  REGIME_GLOSSARY.forEach((r, i) => push(`reggl-${i}`, r.cat, `Glossaire : ${r.t[0]!}`, r.t, r.a));

  /* ---- Erreurs serveur (40 × 2) ---- */
  ERRORS.forEach((e, i) => {
    push(`err-${i}-why`, 'erreurs', `« ${e.msg} » — pourquoi`, [`pourquoi ${e.msg.toLowerCase()}`, `erreur ${e.msg.toLowerCase()}`, e.msg.toLowerCase()], e.why);
    push(`err-${i}-fix`, 'erreurs', `« ${e.msg} » — que faire`, [`que faire ${e.msg.toLowerCase()}`, `corriger ${e.msg.toLowerCase()}`, `solution ${e.msg.toLowerCase()}`], e.fix);
  });

  /* ---- Régions (19 × 5) ---- */
  REGIONS.forEach((r, i) => {
    const n = r.name.toLowerCase();
    const regionCorridors = ctx.corridors.filter((co) => co.regions.includes(r.name)).map((co) => co.name).join(', ') || 'voir la page Commerce';
    push(`reg-${i}-geo`, 'général', `Région ${r.name} — géographie`, [n, `région ${n}`, `c'est quoi ${n}`], r.geo);
    push(`reg-${i}-trade`, 'commerce', `Région ${r.name} — commerce`, [`${n} commerce`, `${n} échanges`, `${n} économique`], r.trade);
    push(`reg-${i}-routes`, 'routes', `Région ${r.name} — routes`, [`${n} routes`, `${n} corridors`, `routes région ${n}`], `${r.routes} Routes de la région dans ce monde : ${regionCorridors}.`);
    push(`reg-${i}-play`, 'débutant', `Région ${r.name} — y jouer`, [`${n} jouer`, `${n} pays`, `nation ${n}`], r.play);
    push(`reg-${i}-nations`, 'général', `Région ${r.name} — nations`, [`${n} nations`, `${n} pays liste`, `qui dans ${n}`], `Nations de la région : ${ctx.countries.filter((c) => c.region === r.name).map((c) => c.name).join(', ') || '—'}.`);
  });

  /* ---- Stratégies IA (8 × 6) ---- */
  STRATEGIES.forEach((s, i) => {
    const n = s.name;
    const bearers = ctx.countries.filter((c) => c.strategy === n).map((c) => c.name).slice(0, 6).join(', ') || 'plusieurs nations';
    push(`strat-${i}-desc`, 'général', `Stratégie IA « ${n} »`, [`stratégie ${n}`, `ia ${n}`, `personnalité ${n}`], s.desc);
    push(`strat-${i}-vs`, 'diplomatie', `Contrer une IA « ${n} »`, [`contre ${n}`, `vs ${n}`, `battre ia ${n}`], s.vs);
    push(`strat-${i}-with`, 'diplomatie', `Négocier avec une IA « ${n} »`, [`négocier ${n}`, `accord avec ia ${n}`, `alliance ${n}`], s.with);
    push(`strat-${i}-routes`, 'routes', `Routes & IA « ${n} »`, [`routes ${n}`, `péages ${n}`, `commerce ia ${n}`], s.routes);
    push(`strat-${i}-tip`, 'diplomatie', `Astuce — IA « ${n} »`, [`astuce ${n}`, `conseil ${n}`], s.tip);
    push(`strat-${i}-who`, 'général', `Qui suit la stratégie « ${n} » ?`, [`qui est ${n}`, `pays ${n}`, `nations ${n}`], `Nations actuellement sur cette stratégie : ${bearers}.`);
  });

  /* ---- Nations (36 × 12 facettes) ---- */
  for (const pc of ctx.countries) {
    const n = pc.name.toLowerCase();
    const me = ctx.country && ctx.country.id === pc.id ? ctx.country : null;
    const rel = me && ctx.country ? (ctx.country.relations[pc.id]?.score ?? null) : null;
    const ownedRoutes = ctx.corridors.filter((co) => co.owner === pc.id);
    push(`cty-${pc.id}-ov`, 'général', `${pc.name} — vue d'ensemble`, [n, `${pc.code.toLowerCase()}`, `pays ${n}`, `nation ${n}`, `c'est quoi ${n}`],
      `${pc.name} (${pc.code}) — région ${pc.region}, population ${(pc.population).toFixed(1)} M hab., PIB ${money(pc.gdp)}, croissance ${pc.growth.toFixed(1)} %, popularité ${pc.popularity.toFixed(0)} %. Dirigée par ${pc.controllerKind === 'player' ? `un joueur (${pc.presidentName})` : `une IA (${pc.presidentName})`}.`);
    push(`cty-${pc.id}-eco`, 'économie', `${pc.name} — économie`, [`${n} économie`, `${n} pib`, `${n} croissance`, `${n} inflation`],
      `Économie de ${pc.name} : PIB ${money(pc.gdp)} (${pc.growth.toFixed(1)} %/an), inflation ${pc.inflation.toFixed(1)} %, chômage ${pc.unemployment.toFixed(1)} %, niveau de vie ${pc.standardOfLiving.toFixed(0)}/100, dette ${pc.debtRatio.toFixed(0)} % du PIB.`);
    push(`cty-${pc.id}-fin`, 'économie', `${pc.name} — finances`, [`${n} finances`, `${n} dette`, `${n} budget`],
      `Finances de ${pc.name} : dette à ${pc.debtRatio.toFixed(0)} % du PIB${pc.debtRatio > 95 ? ' — zone critique (crise budgétaire possible)' : pc.debtRatio > 60 ? ' — sous surveillance (prime de risque active)' : ' — situation saine'}. Popularité ${pc.popularity.toFixed(0)} %, stabilité ${pc.stability.toFixed(0)} %.`);
    push(`cty-${pc.id}-diplo`, 'diplomatie', `${pc.name} — diplomatie`, [`${n} diplomatie`, `${n} relations`, `${n} alliés`],
      rel !== null
        ? `Vos relations avec ${pc.name} : ${rel.toFixed(0)}/100${rel >= 70 ? ' (excellent — accord de haut niveau possible)' : rel >= 45 ? ' (correct — négociable)' : rel >= 30 ? ' (juste au-dessus du seuil commercial)' : ' — sous le seuil de commerce (30) : améliorez-les avant tout accord'}.`
        : `Diplomatie de ${pc.name} : stratégie IA « ${pc.strategy} ». Approchez selon sa personnalité (voir l'entrée Stratégies).`);
    push(`cty-${pc.id}-routes`, 'routes', `${pc.name} — routes possédées`, [`${n} routes`, `${n} corridors`, `${n} péages`, `routes ${n}`],
      ownedRoutes.length > 0
        ? `${pc.name} possède : ${ownedRoutes.map((co) => `« ${co.name} » (péage ${co.toll} %, trafic ${co.traffic.toFixed(0)} Md €)`).join(', ')}.`
        : `${pc.name} ne possède aucune route commerciale pour l'instant.`);
    push(`cty-${pc.id}-region`, 'général', `${pc.name} — région`, [`${n} région`, `${n} où`, `où est ${n}`],
      `${pc.name} appartient à la région « ${pc.region} » : ${REGIONS.find((r) => r.name === pc.region)?.geo ?? ''}`);
    push(`cty-${pc.id}-diff`, 'débutant', `${pc.name} — difficulté`, [`${n} difficulté`, `${n} facile`, `${n} dur`, `jouer ${n}`],
      `Difficulté de ${pc.name} : ${pc.difficulty}/5. ${pc.difficulty <= 2 ? 'Finances saines et vulnérabilités limitées : idéal pour débuter.' : pc.difficulty === 3 ? 'Équilibré : quelques défis sans piège majeur.' : 'Réservé aux présidents expérimentés : cumule dette, pénuries ou instabilité.'}`);
    push(`cty-${pc.id}-ai`, 'général', `${pc.name} — dirigeant`, [`${n} président`, `${n} dirigeant`, `${n} ia`, `qui dirige ${n}`],
      `${pc.name} est dirigée par ${pc.presidentName} (${pc.controllerKind === 'player' ? 'joueur humain' : 'IA autonome'}). Stratégie : « ${pc.strategy} ».`);
    push(`cty-${pc.id}-play`, 'débutant', `${pc.name} — faut-il la jouer ?`, [`faut il jouer ${n}`, `${n} bon choix`, `choisir ${n}`],
      `${pc.name} : difficulté ${pc.difficulty}, région ${pc.region}, PIB ${money(pc.gdp)}, popularité ${pc.popularity.toFixed(0)} %. ${pc.gdp > 4000 ? 'Une superpuissance : leviers immenses, attentes du peuple exigeantes.' : pc.gdp > 1200 ? 'Une puissance moyenne : le meilleur terrain d\'apprentissage des mécaniques avancées.' : 'Une nation modeste : survie d\'abord, puis spécialisation (routes, niche de ressources, diplomatie).'}`);
    push(`cty-${pc.id}-forces`, 'général', `${pc.name} — points forts`, [`${n} forces`, `${n} atouts`, `${n} avantages`],
      `Atouts de ${pc.name} : ${[pc.growth > 2.5 ? 'croissance dynamique' : '', pc.debtRatio < 60 ? 'dette maîtrisée' : '', pc.popularity > 60 ? 'popularité solide' : '', pc.standardOfLiving > 55 ? 'bon niveau de vie' : ''].filter(Boolean).join(', ') || 'à construire — aucun atout dominant pour l\'instant'}.`);
    push(`cty-${pc.id}-faib`, 'général', `${pc.name} — faiblesses`, [`${n} faiblesses`, `${n} problèmes`, `${n} risques`],
      `Vigilances sur ${pc.name} : ${[pc.inflation > 5 ? 'inflation élevée' : '', pc.unemployment > 9 ? 'chômage important' : '', pc.debtRatio > 95 ? 'dette critique' : '', pc.popularity < 40 ? 'popularité fragile' : ''].filter(Boolean).join(', ') || 'aucune faiblesse majeure signalée actuellement'}.`);
    push(`cty-${pc.id}-trade`, 'commerce', `${pc.name} — commerce`, [`${n} commerce`, `${n} exportations`, `${n} importations`, `commercer ${n}`],
      rel !== null
        ? `Commercer avec ${pc.name} : relations ${rel.toFixed(0)}/100${rel < 30 ? ' — sous le seuil (30), aucun flux possible sans accord' : ''}. Consultez la page Commerce pour vos flux actuels et la meilleure combinaison de routes vers ce pays.`
        : `Commerce de ${pc.name} : stratégie « ${pc.strategy} », région ${pc.region}. Les flux passent par les routes de sa région (voir l'entrée Routes de la région).`);
  }

  /* ---- Corridors (32 × 9 facettes) ---- */
  for (const co of ctx.corridors) {
    const n = co.name.toLowerCase();
    const owner = co.owner ? (ctx.countries.find((c) => c.id === co.owner)?.name ?? co.owner) : null;
    push(`cor-${co.id}-what`, 'routes', `${co.name} — qu'est-ce que c'est`, [n, `route ${n}`, `corridor ${n}`, `c'est quoi ${n}`], `${co.name} : ${co.description} Relie ${co.regions[0]} ↔ ${co.regions[1]}.`);
    push(`cor-${co.id}-geo`, 'routes', `${co.name} — géographie`, [`${n} hubs`, `${n} où`, `${n} carte`, `position ${n}`], `« ${co.name} » s'ancre sur ${co.hubs.map((h) => ctx.countries.find((c) => c.id === h)?.name ?? h).join(' et ')} et relie les régions ${co.regions[0]} ↔ ${co.regions[1]}.`);
    push(`cor-${co.id}-buy`, 'routes', `${co.name} — acheter`, [`acheter ${n}`, `${n} prix`, `${n} coût`, `combien ${n}`], `Prix d'achat : ${co.purchaseCost} Md € (débités de la trésorerie, cooldown 5 j). Entretien : ${co.upkeep} Md €/an. ${owner ? `Déjà possédée par ${owner} — surveillez un éventuel abandon.` : 'Voie LIBRE : premier arrivé, premier servi.'}`);
    push(`cor-${co.id}-toll`, 'routes', `${co.name} — péage`, [`${n} péage`, `${n} taxe`, `${n} tarif`, `péage ${n}`], owner ? `Péage actuel : ${co.toll} % (propriétaire : ${owner}). Chaque marchandise tierce qui transite laisse ${co.toll} % de sa valeur à ${owner} — trésorerie automatique.` : `Aucun péage (voie libre) : le transit est gratuit… pour l'instant. Son trafic cumulé (${co.traffic.toFixed(0)} Md €) montre ce qu'un propriétaire gagnerait.`);
    push(`cor-${co.id}-upkeep`, 'routes', `${co.name} — entretien`, [`${n} entretien`, `${n} upkeep`, `coût entretien ${n}`], `Entretien : ${co.upkeep} Md €/an, prélevé quotidiennement (÷365) sur la trésorerie du propriétaire. À comparer au revenu de péage : trafic ${co.traffic.toFixed(0)} Md € cumulé.`);
    push(`cor-${co.id}-traffic`, 'routes', `${co.name} — trafic`, [`${n} trafic`, `${n} fréquentation`, `trafic ${n}`], `Trafic cumulé : ${co.traffic.toFixed(1)} Md €. ${co.traffic > 60 ? 'Artère majeure du monde : chaque point de péage pèse lourd.' : co.traffic > 15 ? 'Trafic solide et régulier.' : co.traffic > 1 ? 'Trafic modéré — le péage doit rester attractif.' : 'Trafic encore faible : route d\'avenir ou axis secondaire.'}`);
    push(`cor-${co.id}-owner`, 'routes', `${co.name} — propriétaire`, [`${n} propriétaire`, `${n} appartient`, `qui possède ${n}`], owner ? `Propriétaire actuel : ${owner}. Vous ne payez jamais de péage sur VOS routes ; les siennes vous taxent à ${co.toll} % si vous transitez.` : `Aucun propriétaire : voie libre. L'acheter vous donne le monopole du péage sur cet axe.`);
    push(`cor-${co.id}-strat`, 'routes', `${co.name} — stratégie`, [`${n} stratégie`, `${n} rentable`, `${n} intérêt`, `faut il acheter ${n}`],
      `Analyse « ${co.name} » : ${co.regions[0] === co.regions[1] ? 'voie INTÉRIEURE — tout le cabotage de la région y passe, trafic captif idéal pour un péage modéré régulier.' : 'axe INTER-RÉGIONAL — capte les flux entre deux régions ; plus les économies voisines commercent, plus il rapporte.'} ${co.purchaseCost <= 100 ? 'Prix d\'entrée abordable : bon premier actif réseau.' : 'Actif majeur : à réserver aux trésoreries solides.'}`);
    push(`cor-${co.id}-mine`, 'routes', `${co.name} — votre situation`, [`mon péage ${n}`, `ma route ${n}`, `${n} à moi`],
      ctx.country && co.owner === ctx.country.id
        ? `C'est VOTRE route : péage ${co.toll} %, trafic ${co.traffic.toFixed(0)} Md €, entretien ${co.upkeep} Md €/an. Ajustez le péage page Commerce (le produit péage × trafic compte plus que le taux).`
        : owner ? `Elle appartient à ${owner} : vos transits y paient ${co.toll} %. Options : combinaison alternative (page Commerce), accord avec le propriétaire, ou rachat s'il l'abandonne.` : `Elle est LIBRE et coûte ${co.purchaseCost} Md €. Si vos flux (ou ceux de votre région) l'empruntent, l'achat transforme une dépense en revenu.`);
  }

  /* ---- Ressources (8 × 7) ---- */
  for (const r of RESOURCES) {
    const n = r.name.toLowerCase();
    const m = ctx.market ? ctx.market[r.key] : null;
    const mine = ctx.country ? ctx.country.resources[r.key] : null;
    push(`res-${r.key}-what`, 'commerce', `${r.name} — rôle`, [n, `${r.short.toLowerCase()}`, `ressource ${n}`, `c'est quoi ${n}`], `${r.name} (${r.short}, en ${r.unit}) : prix de base ${r.basePrice} Md €/${r.unit}. ${r.key === 'food' ? 'Nourrit la population — la pénurie est mortelle politiquement.' : r.key === 'energy' ? 'Le sang de l\'industrie : toute tension énergétique freine production et productivité.' : r.key === 'oil' || r.key === 'gas' ? 'Hydrocarbures : énergie et industrie, très sensibles au marché mondial.' : r.key === 'minerals' || r.key === 'materials' ? 'Chaîne amont de l\'industrie : métaux et matières pour produire.' : r.key === 'industrial' ? 'Biens manufacturés : le cœur des exportations à valeur ajoutée.' : 'Technologie : la ressource la plus chère (4,5 Md €/unité) — l\'exporter est très rémunérateur.'}`);
    push(`res-${r.key}-price`, 'commerce', `${r.name} — prix`, [`${n} prix`, `cours ${n}`, `prix ${n}`], m ? `Prix mondial actuel : ${m.price.toFixed(2)} Md € (${m.change24h >= 0 ? '+' : ''}${m.change24h.toFixed(1)} % sur 24 jours). ${Math.abs(m.change24h) > 4 ? 'Forte variation : surveillez stocks et approvisionnements.' : 'Marché calme.'}` : `Prix mondial : voir la page Commerce/Économie (le marché n'est pas encore chargé).`);
    push(`res-${r.key}-short`, 'commerce', `${r.name} — pénurie`, [`${n} pénurie`, `manque ${n}`, `${n} stock bas`], `Pénurie de ${n} : stocks < 30 % → prix locaux ×1,3-1,35, production freinée, popularité en chute. Parade : achat immédiat sur le marché, accord d'approvisionnement, infrastructures dédiées.`);
    push(`res-${r.key}-prod`, 'économie', `${r.name} — produire plus`, [`${n} production`, `produire ${n}`, `augmenter ${n}`], `Augmenter ${n} : infrastructures dédiées, lois sectorielles, budget du secteur, productivité (écoles/universités). L'énergie dépend des centrales et du réseau ; la tech des pôles technologiques.`);
    push(`res-${r.key}-trade`, 'commerce', `${r.name} — commerce`, [`${n} export`, `${n} import`, `vendre ${n}`, `acheter ${n}`], `Commerce de ${n} : vos surplus s'exportent automatiquement (flux ≥ 0,3 du surplus), vos déficits s'importent. Acheter/vendre manuellement au prix mondial complète — attention à ne pas créer vous-même la pénurie.`);
    push(`res-${r.key}-mine`, 'économie', `${r.name} — chez vous`, [`mon stock ${n}`, `mes réserves ${n}`, `${n} mon pays`], mine && ctx.country ? `Votre ${n} : stock ${mine.stock.toFixed(0)}/${mine.capacity.toFixed(0)} ${r.unit} (${(mine.capacity > 0 ? (mine.stock / mine.capacity) * 100 : 0).toFixed(0)} %), production ${mine.production.toFixed(1)}/j, consommation ${mine.consumption.toFixed(1)}/j, prix local ${mine.price.toFixed(2)} Md €. ${mine.stock / Math.max(1, mine.capacity) < 0.35 ? '⚠️ Zone de tension : sécurisez l\'approvisionnement.' : mine.production > mine.consumption ? 'Excédent : opportunité d\'exportation/vente.' : 'Équilibre.'}` : `Sélectionnez votre nation pour voir vos stocks de ${n} en direct.`);
    push(`res-${r.key}-event`, 'général', `${r.name} — événements liés`, [`${n} événement`, `${n} crise`], r.key === 'energy' ? "Événements liés : « Pénurie énergétique » (stocks < 30 %) — prix ×1,35, industrie −6 %, inflation +0,6." : r.key === 'food' ? "Événement lié : « Tensions alimentaires » (stocks < 30 %) — popularité −0,18/j, stabilité −0,15/j. Le plus dangereux politiquement." : r.key === 'materials' || r.key === 'minerals' ? "Événement lié : « Rupture d'approvisionnement » (dépendance > 35 %) — prix matières ×1,18." : "Pas d'événement propre, mais toute ressource nourrit la production sectorielle et les pénuries en cascade.");
  }

  /* ---- Lois (12 × 5) ---- */
  for (const l of LAWS) {
    const n = l.name.toLowerCase();
    const active = ctx.country?.laws.some((x) => x.lawId === l.id) ?? false;
    push(`law-${l.id}-ov`, 'politique', `${l.name} — effets`, [n, `loi ${n}`, `réforme ${n}`, `c'est quoi ${n}`], `${l.name} : ${l.description} Effets : ${l.effects.join(' · ')}. Coût : ${l.annualCostPctGdp > 0 ? `${l.annualCostPctGdp} % du PIB/an` : 'nul'}.`);
    push(`law-${l.id}-cost`, 'politique', `${l.name} — coût`, [`${n} coût`, `${n} prix`, `combien ${n}`], l.annualCostPctGdp > 0 ? `Coût annuel : ${l.annualCostPctGdp} % du PIB (soit ~${money((ctx.country?.economy.gdp ?? 1000) * l.annualCostPctGdp / 100)} pour votre pays). Ligne « lois » implicite dans les dépenses du solde.` : `Coût nul — c'est une loi de cadrage (effets structurels sans ligne budgétaire).`);
    push(`law-${l.id}-when`, 'politique', `${l.name} — quand l'adopter`, [`${n} quand`, `faut il voter ${n}`, `adopter ${n}`], l.modifiers.popularity && l.modifiers.popularity < 0 ? `À réserver aux périodes de popularité confortable : elle coûte ${(-l.modifiers.popularity).toFixed(2)} point d'opinion par semaine en continu.` : l.modifiers.popularity ? `Adoptable même en période tendue : elle soutient la popularité (+${l.modifiers.popularity.toFixed(2)}/semaine).` : `Loi neutre politiquement : adoptez-la quand son effet structurel sert votre problème principal.`);
    push(`law-${l.id}-risk`, 'politique', `${l.name} — limites`, [`${n} risques`, `${n} inconvénients`, `${n} limites`], l.modifiers.productivity && l.modifiers.productivity < 0 ? `Contrepartie : ${(l.modifiers.productivity * 100).toFixed(0)} % de productivité — le coût caché de la protection.` : l.modifiers.popularity && l.modifiers.popularity < 0 ? `Contrepartie : popularité en baisse continue — surveillez le mandat.` : `Pas de contrepartie majeure, mais ${l.annualCostPctGdp > 0 ? `son coût (${l.annualCostPctGdp} % PIB) pèse sur le solde` : 'son effet est lent — patience'}.`);
    push(`law-${l.id}-mine`, 'politique', `${l.name} — chez vous`, [`${n} active`, `j'ai ${n}`, `${n} votée`], active ? `✅ Cette loi est ACTIVE chez vous : ses effets s'appliquent déjà (révoquable page Lois).` : `Cette loi n'est pas active chez vous. ${ctx.country ? `Il vous reste ${6 - (ctx.country.laws.length)} emplacement(s) sur 6.` : ''}`);
  }

  /* ---- Infrastructures (12 × 5) ---- */
  for (const inf of INFRA) {
    const n = inf.name.toLowerCase();
    const lvl = ctx.country?.infra[inf.key]?.level ?? 0;
    push(`inf-${inf.key}-ov`, 'économie', `${inf.name} — effets`, [n, `infrastructure ${n}`, `construire ${n}`, `c'est quoi ${n}`], `${inf.name} : ${inf.effect}. Coût ${inf.baseCost} Md €/niveau (ajusté à la taille du pays), durée ${inf.buildDays} jours, entretien ${inf.upkeepPerLevel} Md €/an/niveau.`);
    push(`inf-${inf.key}-when`, 'économie', `${inf.name} — quand construire`, [`${n} quand`, `faut il construire ${n}`, `priorité ${n}`], inf.key === 'ports' || inf.key === 'logistics' ? `Priorité haute pour tout pays commerçant : les volumes export/import en dépendent directement (donc la valeur de vos routes et flux).` : inf.key === 'plants' || inf.key === 'powerGrid' ? `Dès que la tension énergétique apparaît (stocks < 45 %, strain élevé) : l'énergie est le goulot de toute l'industrie.` : inf.key === 'schools' || inf.key === 'universities' ? `Tôt et régulièrement : la productivité se construit avant d'en avoir besoin.` : inf.key === 'housing' || inf.key === 'hospitals' ? `Quand le niveau de vie ou la popularité décroche : effets directs et visibles sur l'opinion.` : `Selon votre stratégie : ${inf.effect.toLowerCase()}.`);
    push(`inf-${inf.key}-roi`, 'économie', `${inf.name} — rentabilité`, [`${n} rentable`, `${n} roi`, `${n} retour`], `Rentabilité « ${inf.name} » : coût ~${inf.baseCost} Md €/niveau × taille, entretien ${inf.upkeepPerLevel} Md €/an/niveau. ${inf.key === 'ports' || inf.key === 'logistics' || inf.key === 'industrialZones' ? 'Retour via les volumes commerciaux et la production exportable — généralement le meilleur ROI du jeu.' : inf.key === 'schools' || inf.key === 'universities' || inf.key === 'techHubs' ? 'Retour lent mais cumulatif (productivité, tech à 4,5 Md €/unité).' : 'Retour social/stabilité : difficile à chiffrer, précieux en crise.'}`);
    push(`inf-${inf.key}-lvl`, 'économie', `${inf.name} — votre niveau`, [`mon ${n}`, `niveau ${n}`, `${n} chez moi`], ctx.country ? `Votre ${inf.name} : niveau ${lvl}/10${ctx.country.projects.some((p) => p.infra === inf.key) ? ' (chantier en cours ✓)' : ''}. ${lvl === 0 ? 'Aucun niveau — les effets sont nuls, premier chantier très rentable.' : lvl < 5 ? 'Niveau modéré : chaque niveau supplémentaire compte.' : lvl < 10 ? 'Bon niveau : la suite est un choix de spécialisation.' : 'Niveau maximal atteint.'}` : `Sélectionnez votre nation pour voir votre niveau de ${inf.name}.`);
    push(`inf-${inf.key}-cost`, 'économie', `${inf.name} — coût & durée`, [`${n} coût`, `${n} prix`, `${n} durée`, `${n} temps`], `${inf.name} : base ${inf.baseCost} Md €/niveau (× facteur de taille), ${inf.buildDays} jours de chantier, débit immédiat à la commande. Entretien ensuite : ${inf.upkeepPerLevel} Md €/an/niveau (dans les dépenses du solde).`);
  }

  /* ---- Événements (12 × 4) ---- */
  for (const ev of EVENT_CATALOG) {
    const n = ev.title.toLowerCase();
    const activeHere = ctx.country?.activeEvents.some((x) => x.title === ev.title) ?? false;
    push(`ev-${ev.id}-cond`, 'général', `${ev.title} — déclenchement`, [n, `événement ${n}`, `cause ${n}`, `déclenche ${n}`], `${ev.title} : ${ev.description} Condition moteur : ${ev.condition}. Durée : ${ev.minDays} à ${ev.maxDays} jours.`);
    push(`ev-${ev.id}-eff`, 'général', `${ev.title} — effets`, [`${n} effets`, `${n} conséquences`, `impact ${n}`], `${ev.title} : ${[ev.modifiers.popularityDelta ? `popularité ${ev.modifiers.popularityDelta > 0 ? '+' : ''}${ev.modifiers.popularityDelta}/j` : '', ev.modifiers.growthDelta ? `croissance ${ev.modifiers.growthDelta > 0 ? '+' : ''}${ev.modifiers.growthDelta}` : '', ev.modifiers.inflationDelta ? `inflation +${ev.modifiers.inflationDelta}` : '', ev.modifiers.productionMul ? `production ${Object.entries(ev.modifiers.productionMul).map(([k, v]) => `${RESOURCE_MAP[k as ResourceKey]?.name ?? k} ×${v}`).join(', ')}` : '', ev.modifiers.priceMul ? `prix ${Object.entries(ev.modifiers.priceMul).map(([k, v]) => `${RESOURCE_MAP[k as ResourceKey]?.name ?? k} ×${v}`).join(', ')}` : ''].filter(Boolean).join(' · ') || 'modificateurs ciblés (voir fiche)'}.`);
    push(`ev-${ev.id}-fix`, 'général', `${ev.title} — comment réagir`, [`${n} solution`, `${n} éviter`, `${n} réagir`, `stopper ${n}`], `${ev.title} : la parade est de sortir de sa condition (${ev.condition}) — l'événement finit sa durée puis ne récidive plus tant que la condition reste fausse. Agissez sur les stocks, la dette, l'emploi ou la croissance selon le cas.`);
    push(`ev-${ev.id}-now`, 'général', `${ev.title} — chez vous`, [`${n} actif`, `j'ai ${n}`, `${n} en cours`], activeHere ? `⚡ Cet événement est ACTIF chez vous en ce moment (page Événements pour la durée restante).` : `Cet événement n'est pas actif chez vous. Sa condition : ${ev.condition}.`);
  }

  /* ---- Accords (5 × 4) ---- */
  for (const ag of AGREEMENT_TYPES) {
    const n = ag.name.toLowerCase();
    const myActive = ctx.country ? Object.values(ctx.country.relations).flatMap((r) => r.agreements).filter((a) => a.type === ag.type && a.status === 'active').length : 0;
    push(`ag-${ag.type}-ov`, 'diplomatie', `${ag.name} — effets`, [n, `accord ${n}`, `c'est quoi ${n}`], `${ag.name} : ${ag.description}`);
    push(`ag-${ag.type}-when`, 'diplomatie', `${ag.name} — quand proposer`, [`${n} quand`, `proposer ${n}`, `${n} utile`], ag.type === 'free_trade' ? `Le libre-échange se propose à vos plus gros partenaires potentiels (complémentarité, relations ≥ 45) : tarifs −60 %, volumes ×1,5 — le meilleur ROI diplomatique du jeu.` : ag.type === 'trade_zone' ? `La zone commerciale complète un libre-échange existant ou le remplace quand le partenaire est déjà très intégré : −40 % tarifs, ×1,35 volumes.` : ag.type === 'tech_cooperation' ? `La coopération technologique vise les nations à fort secteur tech (stratégie « innovation » surtout) : +productivité tech bilatérale.` : ag.type === 'economic_treaty' ? `Le traité économique ancre une relation durable (investissement croisé, −20 % tarifs) : idéal avec les alliés stables.` : `Le pacte d'aide se propose aux partenaires en difficulté ou aux amitiés naissantes : confiance et stabilité.`);
    push(`ag-${ag.type}-risk`, 'diplomatie', `${ag.name} — limites`, [`${n} risques`, `${n} défauts`, `${n} inconvénients`], ag.type === 'free_trade' ? `Contrepartie : vos douanes baissent sur ce partenaire (recette douanière réduite) et vos producteurs sensibles sont exposés.` : ag.type === 'aid_pact' ? `Contrepartie : les aides coûtent de la trésorerie ; l'effet volumes est modeste (×1,05).` : `Contrepartie : effet plus diffus que le libre-échange ; à combiner plutôt qu'à isoler. Rupture = −10 relations, −8 confiance.`);
    push(`ag-${ag.type}-mine`, 'diplomatie', `${ag.name} — vos accords`, [`mes ${n}`, `${n} actifs`, `combien ${n}`], ctx.country ? `Vous avez ${myActive} accord(s) « ${ag.name} » actif(s) en ce moment (page Diplomatie pour la liste détaillée).` : `Sélectionnez votre nation pour compter vos accords actifs.`);
  }

  /* ---- Budgets sectoriels (8 × 4) ---- */
  for (const s of SPENDING_SECTORS) {
    const n = s.name.toLowerCase();
    const cur = ctx.country?.policy.spending[s.key as keyof Country['policy']['spending']] ?? null;
    push(`sp-${s.key}-ov`, 'politique', `Budget ${s.name} — rôle`, [`budget ${n}`, `${n} budget`, `dépense ${n}`, `c'est quoi budget ${n}`], `Budget ${s.name} (${s.min}-${s.max} % du PIB) : ${s.description}.`);
    push(`sp-${s.key}-up`, 'politique', `Budget ${s.name} — augmenter`, [`augmenter budget ${n}`, `${n} plus`, `monter ${n}`], `Augmenter le budget ${s.name} améliore : ${s.description.toLowerCase()}. Coût : +1 point = +1 % du PIB de dépenses annuelles (solde ↓).`);
    push(`sp-${s.key}-down`, 'politique', `Budget ${s.name} — réduire`, [`baisser budget ${n}`, `${n} moins`, `couper ${n}`, `réduire ${n}`], `Réduire le budget ${s.name} soigne le solde mais dégrade : ${s.description.toLowerCase()}. ${s.key === 'health' || s.key === 'social' ? '⚠️ Secteur politiquement sensible : la popularité réagit vite.' : 'Secteur plutôt technique : l\'effet politique est diffus.'}`);
    push(`sp-${s.key}-mine`, 'politique', `Budget ${s.name} — votre niveau`, [`mon budget ${n}`, `${n} actuel`, `niveau ${n}`], cur !== null ? `Votre budget ${s.name} : ${cur.toFixed(1)} % du PIB (plage ${s.min}-${s.max}). ${cur < s.max * 0.3 ? 'Niveau bas.' : cur > s.max * 0.75 ? 'Niveau élevé.' : 'Niveau médian.'}` : `Sélectionnez votre nation pour voir votre budget ${s.name}.`);
  }

  /* ---- Actions (23 × 3) ---- */
  for (const a of ACTIONS_CATALOG) {
    const n = a.label.toLowerCase();
    push(`act-${a.id}-what`, 'général', `${a.label} — à quoi ça sert`, [n, `action ${n}`, `c'est quoi ${n}`], a.what);
    push(`act-${a.id}-how`, 'interface', `${a.label} — comment faire`, [`comment ${n}`, `${n} comment`, `où ${n}`, `faire ${n}`], a.how);
    push(`act-${a.id}-when`, 'général', `${a.label} — quand`, [`quand ${n}`, `${n} quand`, `moment ${n}`], a.when);
  }


  /* ---- Bâtiments de production (16 × 5 facettes) ---- */
  for (const f of FACILITIES) {
    const n = f.name.toLowerCase();
    const resName = RESOURCE_MAP[f.resource].name;
    const owned = ctx.country?.facilities?.[f.key]?.owned ?? 0;
    const queued = (ctx.country?.facilities?.[f.key]?.queue ?? []).reduce((s, q) => s + q.count, 0);
    const outMine = ctx.country ? facilityOutput(f, 1, ctx.country.population) : f.outputPerDay;
    const worldP = ctx.market?.[f.resource]?.price ?? RESOURCE_MAP[f.resource].basePrice;
    push(`fac-${f.key}-what`, 'ressources', `${f.name} — qu'est-ce que c'est`, [n, `bâtiment ${n}`, `construire ${n}`, `c'est quoi ${n}`, f.key.replace(/[_-]/g, ' ')], `${f.icon} ${f.name} (palier ${f.tier}) : ${f.description} Produit ${resName.toLowerCase()}.`);
    push(`fac-${f.key}-eco`, 'ressources', `${f.name} — coût & rendement`, [`${n} coût`, `${n} prix`, `${n} rendement`, `${n} rentable`, `combien ${n}`], `${f.name} : ${f.cost} Md € à l'achat, ${f.buildDays} jours de construction, entretien ${f.upkeepPerDay.toFixed(3)} Md €/jour. Rendement +${outMine.toFixed(2)} ${RESOURCE_MAP[f.resource].unit}/jour pour votre pays (≈ ${(outMine * worldP * 0.045).toFixed(3)} Md €/jour exportés au cours mondial ${worldP.toFixed(2)}).`);
    push(`fac-${f.key}-when`, 'ressources', `${f.name} — quand le construire`, [`${n} quand`, `faut il construire ${n}`, `${n} utile`], f.tier === 1 ? `${f.name} : le palier essentiel, rapide (${f.buildDays} j) et abordable (${f.cost} Md €). À construire dès que la ressource « ${resName.toLowerCase()} » est tendue ou que la trésorerie dort.` : `${f.name} : le palier massif (${f.cost} Md €, ${f.buildDays} jours). Réservé aux trésoreries solides et aux stratégies de volume — rendement ≈ ${(f.outputPerDay / FACILITIES.find((x) => x.resource === f.resource && x.tier === 1)!.outputPerDay).toFixed(1)}× le palier 1.`);
    push(`fac-${f.key}-mine`, 'ressources', `${f.name} — chez vous`, [`mon ${n}`, `mes ${n}`, `${n} possédés`, `combien de ${n} ai je`], ctx.country ? `Vos ${f.name} : ${owned} en service${queued > 0 ? `, ${queued} en construction` : ''} (plafond ${f.maxOwned}). Production actuelle : +${facilityOutput(f, owned, ctx.country.population).toFixed(1)} ${RESOURCE_MAP[f.resource].unit}/jour, entretien ${(owned * f.upkeepPerDay).toFixed(3)} Md €/jour.` : `Sélectionnez votre nation pour voir vos ${f.name}.`);
    push(`fac-${f.key}-strat`, 'ressources', `${f.name} — stratégie`, [`${n} stratégie`, `${n} conseil`, `${n} astuce`], `Stratégie « ${f.name} » : ${f.resource === 'food' || f.resource === 'energy' ? 'sécurise un besoin vital — chaque unité produite évite des importations et des pénuries qui coûtent bien plus cher.' : `produit une ressource vendable ${worldP.toFixed(2)} Md €/unité au cours mondial : empilez jusqu'au retour sur investissement visé, puis vendez via exportations automatiques ou offres inter-états.`}`);
  }


  /* ---- Régimes politiques (6 × 4 facettes) ---- */
  for (const r of REGIMES) {
    const n = r.id.toLowerCase();
    const align = ctx.country ? regimeAlignment(ctx.country, r.id) : 0.5;
    push(`rg-${r.id}-what`, 'politique', `${r.id} — présentation`, [n, `régime ${n}`, `c'est quoi ${n}`, r.id], `${r.icon} ${r.id} : ${r.tagline}. « ${r.motto} » Effets permanents : popularité ${(r.effects.popularityDaily * 7).toFixed(2)}/sem, stabilité ${(r.effects.stabilityDaily * 7).toFixed(2)}/sem, croissance ${r.effects.growthDelta >= 0 ? '+' : ''}${r.effects.growthDelta}, recettes ×${r.effects.revenueMul}.`);
    push(`rg-${r.id}-align`, 'politique', `${r.id} — alignement actuel`, [`${n} alignement`, `${n} peuple`, `${n} plébiscité`, `le peuple veut ${n}`], ctx.country ? `Alignement actuel de « ${r.id} » avec VOS revendications : ${Math.round(align * 100)} %. ${align >= 0.5 ? 'Le peuple l\'appelle : le proclamer déclencherait une lune de miel.' : align >= 0.3 ? 'Alignement moyen : transition neutre.' : 'Mal aligné aujourd\'hui : le proclamer coûterait popularité et stabilité.'}` : `Sélectionnez votre nation pour voir l'alignement de « ${r.id} » avec votre peuple.`);
    push(`rg-${r.id}-when`, 'politique', `${r.id} — quand le choisir`, [`${n} quand`, `choisir ${n}`, `pourquoi ${n}`], r.id === 'Technocratie' ? 'À choisir contre une inflation tenace ou un besoin de recettes : +0,3 croissance, ×1,08 recettes — en acceptant l\'impopularité chronique.' : r.id === 'Monarchie constitutionnelle' ? 'À choisir pour stabiliser un pays nerveux : +0,28 stabilité/semaine et opinion positive, au prix d\'un peu de croissance.' : r.id === 'Fédération' ? 'À choisir pour les économies de volume (énergie, alimentation) : recettes ×1,06, mais stabilité érodée.' : r.id === 'République fédérale' ? 'À choisir contre chômage et mal-logement : +0,2 croissance, recettes ×1,04, écoute emploi/logement/social.' : r.id === 'République parlementaire' ? 'À choisir pour un équilibre durable : +0,15 croissance, +0,14 stabilité/semaine, écoute éducation/emploi/calme.' : 'À choisir quand le peuple réclame du changement ou des impôts bas : +0,14 opinion/semaine, +0,1 croissance.');
    push(`rg-${r.id}-aff`, 'politique', `${r.id} — revendications écoutées`, [`${n} écoute`, `${n} revendications`, `${n} demandes`], `« ${r.id} » écoute : ${r.affinities.join(', ')}. Quand ces demandes dominent votre peuple, son alignement monte et la transition rapporte.`);
  }

  /* ---- Chiffres clés du monde ---- */
  const NUMBERS: { q: string[]; a: string }[] = [
    { q: ['combien de nations', 'nombre de pays', '36 nations'], a: `36 nations fixes réparties en ${REGIONS.length} régions, dirigées par des joueurs ou des IA. Aucune ne peut disparaître (règle absolue : pas de guerre).` },
    { q: ['combien de routes', 'nombre routes', '32 routes'], a: `${ctx.corridors.length || 32} routes commerciales stratégiques relient les 19 régions. Toutes sont achetables ; aucune voie directe n'existe.` },
    { q: ['combien de ressources', 'nombre ressources', '8 ressources'], a: `8 ressources : ${RESOURCES.map((r) => r.name.toLowerCase()).join(', ')}. Prix de base de 1,0 (alimentation) à 4,5 Md € (technologie).` },
    { q: ['combien de lois', 'nombre lois', '14 lois'], a: `${LAWS.length} lois au catalogue (dont 4 lois de popularité : festival national, prime de pouvoir d'achat, service civique, référendum), 6 actives simultanées maximum. Coûts de 0 à 0,7 % du PIB/an.` },
    { q: ['combien infrastructures', 'nombre infrastructures', '18 infrastructures'], a: `18 types d'infrastructures répartis en 5 catégories, niveaux 1 à 10, chantiers de 18 à 34 jours, 6 simultanés maximum. Chaque niveau applique des bonus RÉELS au moteur (logistique, productivité, énergie, export, agriculture, croissance, recettes, dette, popularité, stabilité).` },
    { q: ['combien événements', 'nombre événements', '12 événements'], a: `12 événements conditionnels, durées de 6 à 24 jours, déclenchés par l'état réel du pays (jamais par pur hasard).` },
    { q: ['combien accords', 'nombre accords', '5 accords'], a: `5 types d'accords diplomatiques : libre-échange, traité économique, coopération technologique, zone commerciale, pacte d'aide.` },
    { q: ['combien budgets', 'nombre budgets', '8 budgets'], a: `8 budgets sectoriels : santé, éducation, transports, énergie, industrie, agriculture, recherche, social (plages 0-5 à 0-8 % du PIB).` },
    { q: ['combien actions', 'nombre actions', '23 actions'], a: `${ACTIONS_CATALOG.length} actions de gouvernance (fiscalité, budgets, taux, chantiers, lois, diplomatie, marché, routes, expéditions) — toutes avec estimation serveur avant confirmation.` },
    { q: ['combien de régimes', 'nombre régimes', '6 régimes'], a: `${REGIMES.length} régimes politiques : ${REGIMES.map((r) => r.id).join(', ')}. Changement : cooldown 90 jours, stabilité ≥ 25, effets permanents + lune de miel 30 jours.` },
    { q: ['combien de bâtiments', 'nombre bâtiments', '16 bâtiments'], a: `${FACILITIES.length} bâtiments de production (2 paliers × 8 ressources), plafonds de 8 à 25 unités par pays, construction de 3 à 12 jours.` },
  ];
  NUMBERS.forEach((x, i) => push(`num-${i}`, 'général', x.q[0]!, x.q, x.a));

  return out;
}

/** Compteur d'entrées (affiché dans l'UI de l'assistant). */
export function kbCount(entries: KbEntry[]): number {
  return entries.length;
}
