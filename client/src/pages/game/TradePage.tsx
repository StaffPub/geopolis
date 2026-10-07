/**
 * GEOPOLIS — Commerce v4 : page refondue, claire et animée.
 * Structure en 4 blocs lisibles :
 *   1. Hero + KPIs (flux, balance, routes possédées, trafic capté)
 *   2. Expédition exceptionnelle (formulaire épuré, devis serveur live)
 *   3. Marché des routes stratégiques (filtres, tri, cartes premium)
 *   4. Mes routes par partenaire + registre des échanges
 * Règle du monde : AUCUNE voie directe — toute marchandise passe par au moins
 * une route commerciale achetable et taxable ; les péages tombent directement
 * dans la trésorerie des propriétaires.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RESOURCE_KEYS, RESOURCE_MAP } from 'shared';
import type { ActionEstimate, ActionParams, ResourceKey, TradeCorridor, TradeRoute } from 'shared';
import { formatMoney } from 'shared';
import { useAuth } from '../../state/AuthContext.js';
import { useGame } from '../../state/GameContext.js';
import { game as gameApi } from '../../lib/api.js';
import type { RouteOption } from 'shared';
import { ActionModal } from '../../components/ActionModal.js';
import { InfoTip } from '../../components/InfoTip.js';
import { Badge, EmptyState, GlassCard, ProgressBar, SectionCard, SectionTitle, StatCard } from '../../components/ui.js';
import { BarChartCard } from '../../components/Charts.js';

type CorridorFilter = 'all' | 'mine' | 'free' | 'owned';
type CorridorSort = 'traffic' | 'price' | 'name';

export function TradePage() {
  const { countryId } = useAuth();
  const { myCountry, countries, transactions, estimateAction, runAction, deliveries, meta } = useGame();
  const [routes, setRoutes] = useState<TradeRoute[]>([]);
  const [corridors, setCorridors] = useState<TradeCorridor[]>([]);
  const [pending, setPending] = useState<{ params: ActionParams; title: string; description?: string } | null>(null);

  // Formulaire d'expédition
  const [shipTo, setShipTo] = useState<string>('');
  const [shipRes, setShipRes] = useState<ResourceKey>('industrial');
  const [shipUnits, setShipUnits] = useState(20);
  const [shipCorridor, setShipCorridor] = useState<string>('auto');
  const [quote, setQuote] = useState<ActionEstimate[] | null>(null);

  // Marché des routes : filtres & tri
  const [filter, setFilter] = useState<CorridorFilter>('all');
  const [sort, setSort] = useState<CorridorSort>('traffic');

  // Péage d'une route possédée
  const [tollDraft, setTollDraft] = useState<Record<string, number>>({});

  // Routes par partenaire
  const [routePartner, setRoutePartner] = useState<string>('');
  const [routeOpts, setRouteOpts] = useState<RouteOption[]>([]);
  const [routeSel, setRouteSel] = useState<string>('auto');

  const c = myCountry && myCountry.id === countryId ? myCountry : null;
  const nameOf = useMemo(() => new Map(countries.map((x) => [x.id, x])), [countries]);
  const colorOf = (id: string | null) => (id ? nameOf.get(id)?.color ?? '#8b90ab' : '#5d6280');

  const refresh = () => {
    if (!c) return;
    gameApi.routes(c.id).then((r) => setRoutes(r.routes)).catch(() => undefined);
    gameApi.corridors().then((r) => setCorridors(r.corridors)).catch(() => undefined);
    window.dispatchEvent(new Event('gp-trade-changed'));
  };

  const cid = c?.id;
  useEffect(() => {
    if (!cid) return;
    let cancelled = false;
    const load = () => {
      gameApi.routes(cid).then((r) => !cancelled && setRoutes(r.routes)).catch(() => undefined);
      gameApi.corridors().then((r) => !cancelled && setCorridors(r.corridors)).catch(() => undefined);
    };
    load();
    const t = window.setInterval(load, 30_000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [cid]);

  /* Combinaisons de routes pour le partenaire choisi */
  useEffect(() => {
    if (!c || !routePartner) return;
    let cancelled = false;
    gameApi.routeOptions(c.id, routePartner)
      .then((r) => { if (!cancelled) { setRouteOpts(r.options); setRouteSel(r.selected); } })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [c, routePartner]);

  /* Devis serveur en direct pour l'expédition */
  useEffect(() => {
    if (!c || !shipTo) {
      setQuote(null);
      return;
    }
    const t = window.setTimeout(() => {
      void estimateAction(c.id, { type: 'ship_goods', toId: shipTo, resource: shipRes, units: shipUnits, corridorId: shipCorridor })
        .then((r) => setQuote(r.ok ? (r.effects ?? []) : [{ positive: false, label: 'Refus serveur', value: r.error ?? '—' }]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [c, shipTo, shipRes, shipUnits, shipCorridor, estimateAction]);

  /* Partners exportables : relations >= 30 ou accord actif, sans sanction */
  const partners = useMemo(() => {
    if (!c) return [] as { id: string; score: number; name: string }[];
    return Object.entries(c.relations)
      .filter(([, r]) => !r.sanctionByUs && !r.sanctionByThem && (r.score >= 30 || r.agreements.some((a) => a.status === 'active')))
      .map(([id, r]) => ({ id, score: r.score, name: nameOf.get(id)?.name ?? id }))
      .sort((a, b) => b.score - a.score);
  }, [c, nameOf]);

  useEffect(() => {
    if (!shipTo && partners.length > 0) setShipTo(partners[0]!.id);
  }, [partners, shipTo]);

  useEffect(() => {
    if (!routePartner && partners.length > 0) setRoutePartner(partners[0]!.id);
  }, [partners, routePartner]);

  const validCorridors = useMemo(() => {
    const to = shipTo ? nameOf.get(shipTo) : null;
    if (!to || !c) return [];
    return corridors.filter((co) => {
      const [ra, rb] = co.regions;
      const regionsOk = (c.region === ra && to.region === rb) || (c.region === rb && to.region === ra);
      const hubsOk = co.hubs.includes(c.id) && co.hubs.includes(to.id);
      return regionsOk || hubsOk;
    });
  }, [corridors, shipTo, c, nameOf]);

  useEffect(() => {
    if (shipCorridor !== 'auto' && !validCorridors.some((v) => v.id === shipCorridor)) {
      setShipCorridor('auto');
    }
  }, [validCorridors, shipCorridor]);

  /* Marché des routes : filtrage + tri */
  const visibleCorridors = useMemo(() => {
    let list = corridors;
    if (filter === 'mine') list = list.filter((co) => c && co.owner === c.id);
    if (filter === 'free') list = list.filter((co) => !co.owner);
    if (filter === 'owned') list = list.filter((co) => co.owner && co.owner !== c?.id);
    const sorted = [...list];
    if (sort === 'traffic') sorted.sort((a, b) => b.traffic - a.traffic);
    if (sort === 'price') sorted.sort((a, b) => a.purchaseCost - b.purchaseCost);
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return sorted;
  }, [corridors, filter, sort, c]);

  if (!c) {
    return (
      <div className="page">
        <SectionTitle>Commerce</SectionTitle>
        <GlassCard>
          <EmptyState title="Aucune nation dirigée" hint="Le commerce manuel (expéditions, routes, péages) s'ouvre aux présidents." icon="🚢" />
          <div className="row mt-16" style={{ justifyContent: 'center' }}>
            <Link className="btn btn-primary" to="/countries">Choisir ma nation</Link>
          </div>
        </GlassCard>
      </div>
    );
  }

  const isPlayer = c.controller.kind === 'player';

  /* KPIs depuis les flux */
  const exportsByPartner = new Map<string, number>();
  const importsByPartner = new Map<string, number>();
  for (const r of routes) {
    if (r.fromId === c.id) exportsByPartner.set(r.toId, (exportsByPartner.get(r.toId) ?? 0) + r.value * 365);
    if (r.toId === c.id) importsByPartner.set(r.fromId, (importsByPartner.get(r.fromId) ?? 0) + r.value * 365);
  }
  const totalExports = [...exportsByPartner.values()].reduce((a, b) => a + b, 0);
  const totalImports = [...importsByPartner.values()].reduce((a, b) => a + b, 0);
  const myCorridors = corridors.filter((co) => co.owner === c.id);
  const tollIncome = myCorridors.reduce((s, co) => s + co.traffic, 0);

  const stock = c.resources[shipRes];
  const maxUnits = Math.floor(stock?.stock * 0.5 ?? 0);

  /* Livraisons exceptionnelles en attente (réception = à accepter ; envoi = suivi) */
  const deliveriesIn = deliveries.filter((d) => d.toId === c.id);
  const deliveriesOut = deliveries.filter((d) => d.fromId === c.id);

  return (
    <div className="page">
      {/* ---------------- HERO Commerce ---------------- */}
      <div className="trade-hero anim-fade-up">
        <svg className="trade-hero-lines" viewBox="0 0 800 120" preserveAspectRatio="none" aria-hidden>
          <path d="M -20 90 Q 200 20 400 70 T 820 40" fill="none" stroke="rgba(96,165,250,0.35)" strokeWidth="1.5" strokeDasharray="6 8" className="hero-route hero-route-1" />
          <path d="M -20 40 Q 240 100 480 50 T 820 90" fill="none" stroke="rgba(52,211,153,0.3)" strokeWidth="1.5" strokeDasharray="6 8" className="hero-route hero-route-2" />
          <path d="M -20 65 Q 300 10 560 85 T 820 60" fill="none" stroke="rgba(244,114,182,0.25)" strokeWidth="1.5" strokeDasharray="6 8" className="hero-route hero-route-3" />
          <circle r="3" fill="#7fb2c9" className="hero-ship hero-ship-1"><animateMotion dur="9s" repeatCount="indefinite" path="M -20 90 Q 200 20 400 70 T 820 40" /></circle>
          <circle r="3" fill="#3ec9a7" className="hero-ship hero-ship-2"><animateMotion dur="12s" repeatCount="indefinite" path="M -20 40 Q 240 100 480 50 T 820 90" /></circle>
          <circle r="2.5" fill="#d9b45f" className="hero-ship hero-ship-3"><animateMotion dur="15s" repeatCount="indefinite" path="M -20 65 Q 300 10 560 85 T 820 60" /></circle>
        </svg>
        <div className="trade-hero-content">
          <div>
            <h1 style={{ margin: 0 }}>🚢 Commerce — {c.name}</h1>
            <p className="small" style={{ margin: '6px 0 0', color: 'rgba(255,255,255,0.75)', maxWidth: 640 }}>
              Toutes vos marchandises voyagent par les <strong>routes commerciales</strong> du monde — chacune est achetable et taxable.
              Achetez une route, et chaque transit tiers remplit <strong>automatiquement votre trésorerie</strong>.
            </p>
          </div>
          <div className="trade-hero-badges">
            <Badge tone="info">Aucune voie directe</Badge>
            <Badge tone="violet">{corridors.length} routes dans le monde</Badge>
            <Badge tone={myCorridors.length > 0 ? 'good' : 'neutral'}>
              {myCorridors.length > 0 ? `${myCorridors.length} route(s) à vous` : 'Aucune route à vous (encore)'}
            </Badge>
          </div>
        </div>
      </div>

      <SectionCard
        className="mt-16"
        icon="🧠"
        title="Comment fonctionne le commerce"
        desc="Aucune voie directe n'existe : TOUTE marchandise emprunte au moins une route commerciale achetable et taxable."
      >
        <ul className="explain-list">
          <li>🛣️ <span><b>Routes stratégiques</b> : achetez une route libre, fixez son péage (0-15 %) — chaque transit tiers remplit AUTOMATIQUEMENT votre trésorerie.</span></li>
          <li>📦 <span><b>Expédition exceptionnelle</b> : vous choisissez le lot et la route ; le destinataire DOIT accepter (il paie la valeur et reçoit les ressources). Refus ou silence 3 jours = retour automatique. Aucun argent n'est créé.</span></li>
          <li>🔁 <span><b>Flux automatiques</b> : le moteur expédie chaque jour vos excédents via la combinaison de routes la moins chère (ou celle que vous imposez par partenaire).</span></li>
          <li>⚖️ <span><b>Péages trop gourmands = trafic détourné</b> : au-delà de ~55 % de la valeur perdue en transit, plus personne n'emprunte la route (logique de Laffer).</span></li>
        </ul>
      </SectionCard>

      {/* ---------------- KPIs ---------------- */}
      <div className="grid grid-4 mt-16 stagger">
        <StatCard label="Exportations (flux)" value={totalExports} format={(v) => formatMoney(v)} glide tone="var(--good)" icon={<InfoTip text="Valeur annualisée de vos flux sortants actuels (carte + registre moteur)." />} />
        <StatCard label="Importations (flux)" value={totalImports} format={(v) => formatMoney(v)} glide tone="var(--accent-blue)" icon={<InfoTip text="Valeur annualisée de vos flux entrants actuels." />} />
        <StatCard label="Balance des flux" value={totalExports - totalImports} format={(v) => `${v >= 0 ? '+' : ''}${formatMoney(v)}`} glide tone={totalExports >= totalImports ? 'var(--good)' : 'var(--danger)'} icon={<InfoTip text="Exportations − importations annualisées. Un excédent soutient votre croissance (effet commerce de la décomposition)." />} />
        <StatCard label="Trafic capté (péages)" value={tollIncome} format={(v) => formatMoney(v)} glide tone="var(--accent-violet)" icon={<InfoTip text="Trafic cumulé sur VOS routes : chaque transit tiers vous a versé son péage directement en trésorerie." />} />
      </div>

      {/* ---------------- 1. Expédition exceptionnelle ---------------- */}
      <div className="trade-section-head mt-24">
        <h2 style={{ margin: 0 }}>📦 Expédition exceptionnelle</h2>
        <InfoTip text="Vos échanges courants restent AUTOMATIQUES : le moteur expédie chaque jour vos excédents et ils passent TOUJOURS par une route commerciale. Il n'existe plus de voie directe : quiconque possède la route que vous empruntez y prélève son péage, qui tombe directement dans sa trésorerie. Ce formulaire envoie un lot exceptionnel : la marchandise quitte vos entrepôts, puis le DESTINATAIRE doit l'ACCEPTER (notification 🔔 ou panneau ci-dessous). À l'acceptation il est débité de la valeur et reçoit les ressources — aucun argent n'est créé. Refus ou absence de réponse sous 3 jours : retour automatique dans vos entrepôts." />
      </div>
      <GlassCard className="anim-fade-up">
        {!isPlayer && <p className="tiny" style={{ color: 'var(--warn)' }}>Seul le président (joueur) peut expédier.</p>}
        <div className="ship-form">
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="ship-to">Destinataire</label>
            <select id="ship-to" className="input" value={shipTo} disabled={!isPlayer} onChange={(e) => setShipTo(e.target.value)}>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>{p.name} · relations {p.score.toFixed(0)}</option>
              ))}
              {partners.length === 0 && <option value="">Aucun partenaire éligible</option>}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="ship-res">Ressource</label>
            <select id="ship-res" className="input" value={shipRes} disabled={!isPlayer} onChange={(e) => setShipRes(e.target.value as ResourceKey)}>
              {RESOURCE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {RESOURCE_MAP[k].name} · stock {c.resources[k].stock.toFixed(0)}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="ship-units">Quantité · max {maxUnits}</label>
            <input
              id="ship-units"
              type="range"
              min={1}
              max={Math.max(1, maxUnits)}
              value={Math.min(shipUnits, Math.max(1, maxUnits))}
              disabled={!isPlayer}
              onChange={(e) => setShipUnits(Number(e.target.value))}
            />
            <span className="mono small" style={{ fontWeight: 800 }}>{shipUnits} unités</span>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="ship-route">Route</label>
            <select id="ship-route" className="input" value={shipCorridor} disabled={!isPlayer} onChange={(e) => setShipCorridor(e.target.value)}>
              <option value="auto">🧭 Meilleure route (choix du serveur)</option>
              {validCorridors.map((co) => (
                <option key={co.id} value={co.id}>
                  {co.name} — {co.owner === c.id ? 'À VOUS (péage 0 %)' : co.owner ? `${nameOf.get(co.owner)?.name} · ${co.toll} %` : 'libre · 0 %'}
                </option>
              ))}
            </select>
          </div>
        </div>

        {quote && (
          <div className="ship-quote mt-16 anim-fade-in">
            {quote.map((q, i) => (
              <span key={i} className="small">
                <span className="muted">{q.label} : </span>
                <strong style={{ color: q.positive ? 'var(--good)' : 'var(--danger)' }}>{q.value}</strong>
              </span>
            ))}
          </div>
        )}

        <div className="row-between wrap mt-16" style={{ gap: 10 }}>
          <p className="tiny muted" style={{ margin: 0, maxWidth: 620 }}>
            ℹ️ Aucune voie directe n'existe : chaque marchandise emprunte au moins une route commerciale.
            Les péages sont versés <strong>automatiquement à la trésorerie</strong> de leurs propriétaires.
            Le destinataire doit <strong>accepter</strong> la livraison : il paie la valeur et reçoit les ressources.
          </p>
          {isPlayer && shipTo && (
            <button
              className="btn btn-primary btn3d btn-rocket"
              disabled={maxUnits < 1}
              onClick={() =>
                setPending({
                  params: { type: 'ship_goods', toId: shipTo, resource: shipRes, units: Math.min(shipUnits, Math.max(1, maxUnits)), corridorId: shipCorridor },
                  title: `Expédier vers ${nameOf.get(shipTo)?.name ?? shipTo}`,
                  description: 'Le stock quitte vos entrepôts et le destinataire devra ACCEPTER la livraison (il est débité de la valeur et reçoit les marchandises). Refus ou silence pendant 3 jours : retour automatique. Le serveur valide stocks, entrepôts, relations et péages.',
                })
              }
            >
              <span className="rk" aria-hidden>🚀</span> Expédier la marchandise
            </button>
          )}
        </div>
      </GlassCard>

      {/* ---------------- 1b. Livraisons en attente d'acceptation ---------------- */}
      {(deliveriesIn.length > 0 || deliveriesOut.length > 0) && (
        <>
          <div className="trade-section-head mt-24">
            <div className="row wrap" style={{ gap: 10 }}>
              <h2 style={{ margin: 0 }}>📬 Livraisons en attente</h2>
              <InfoTip text="Les expéditions exceptionnelles doivent être ACCEPTÉES par le destinataire : à l'acceptation, il est débité de la valeur (trésorerie) et reçoit les ressources — aucun argent n'est créé. Refus ou absence de réponse (3 jours) : la marchandise retourne à l'expéditeur. Les gouvernements IA répondent automatiquement selon leurs besoins, le prix et leur trésorerie." />
            </div>
            {deliveriesIn.length > 0 && <Badge tone="warn">{deliveriesIn.length} à traiter</Badge>}
          </div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            {deliveriesIn.map((d) => (
              <GlassCard key={d.id} className="anim-fade-up" style={{ borderLeft: '3px solid var(--warn)' }}>
                <div className="row-between">
                  <strong className="small">📥 Livraison de {nameOf.get(d.fromId)?.name ?? d.fromId}</strong>
                  <Badge tone="warn">À ACCEPTER</Badge>
                </div>
                <p className="small mt-8" style={{ marginBottom: 4 }}>
                  {Math.round(d.units)} unités de <strong>{RESOURCE_MAP[d.resource]?.name ?? d.resource}</strong> — contre <strong style={{ color: 'var(--danger)' }}>{d.value.toFixed(2)} Md €</strong> (débités de votre trésorerie).
                </p>
                <p className="tiny muted" style={{ margin: 0 }}>
                  Route « {d.routeLabel} » · péages {d.toll.toFixed(2)} Md € · fret {d.freight.toFixed(2)} Md € · réponse avant le jour {d.expiresDay}{meta ? ` (nous sommes au jour ${meta.day})` : ''}.
                </p>
                <div className="row mt-8" style={{ gap: 8 }}>
                  <button
                    className="btn btn-sm btn-good btn3d"
                    disabled={!isPlayer}
                    onClick={() => void runAction(c.id, { type: 'respond_delivery', deliveryId: d.id, accept: true }).then(refresh)}
                  >
                    ✓ Accepter (payer {d.value.toFixed(2)} Md €)
                  </button>
                  <button
                    className="btn btn-sm btn-danger btn3d"
                    disabled={!isPlayer}
                    onClick={() => void runAction(c.id, { type: 'respond_delivery', deliveryId: d.id, accept: false }).then(refresh)}
                  >
                    ✕ Refuser (retour)
                  </button>
                </div>
              </GlassCard>
            ))}
            {deliveriesOut.map((d) => (
              <GlassCard key={d.id} className="anim-fade-up" style={{ borderLeft: '3px solid var(--accent-cyan)' }}>
                <div className="row-between">
                  <strong className="small">📤 Vers {nameOf.get(d.toId)?.name ?? d.toId}</strong>
                  <Badge tone="info">EN ATTENTE</Badge>
                </div>
                <p className="small mt-8" style={{ marginBottom: 4 }}>
                  {Math.round(d.units)} unités de <strong>{RESOURCE_MAP[d.resource]?.name ?? d.resource}</strong> — recette nette si acceptée : <strong style={{ color: 'var(--good)' }}>{(d.value - d.toll - d.freight).toFixed(2)} Md €</strong>.
                </p>
                <p className="tiny muted" style={{ margin: 0 }}>
                  Route « {d.routeLabel} » · stock déjà réservé · {nameOf.get(d.toId)?.name ?? d.toId} doit accepter avant le jour {d.expiresDay} — sinon retour automatique dans vos entrepôts.
                </p>
              </GlassCard>
            ))}
          </div>
        </>
      )}

      {/* ---------------- 2. Marché des routes ---------------- */}
      <div className="trade-section-head mt-24">
        <div className="row wrap" style={{ gap: 10 }}>
          <h2 style={{ margin: 0 }}>🗺️ Routes commerciales stratégiques</h2>
          <InfoTip text="TOUTES les marchandises du monde (livraisons automatiques incluses) passent par ces routes : il n'existe aucune voie directe. Achetez une route et vous percevez son péage sur chaque transit tiers — l'argent tombe automatiquement dans votre trésorerie — et vous ne payez plus le vôtre. Entretien annuel à charge. Les IA achètent aussi : les flux suivent la combinaison la moins chère, donc un péage modéré attire plus de trafic (et rapporte souvent davantage)." />
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {([
            ['all', `Toutes (${corridors.length})`],
            ['mine', `À vous (${myCorridors.length})`],
            ['free', `Libres (${corridors.filter((x) => !x.owner).length})`],
            ['owned', `Possédées (${corridors.filter((x) => x.owner && x.owner !== c.id).length})`],
          ] as [CorridorFilter, string][]).map(([id, label]) => (
            <button key={id} className={`assist-cat ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
          <select className="input" style={{ width: 'auto', minHeight: 32, padding: '4px 10px' }} value={sort} onChange={(e) => setSort(e.target.value as CorridorSort)} aria-label="Trier les routes">
            <option value="traffic">Tri : trafic</option>
            <option value="price">Tri : prix</option>
            <option value="name">Tri : nom</option>
          </select>
        </div>
      </div>
      <div className="grid grid-2 stagger">
        {visibleCorridors.map((co) => {
          const mine = co.owner === c.id;
          const toll = tollDraft[co.id] ?? co.toll;
          const maxTraffic = Math.max(1, ...corridors.map((x) => x.traffic));
          return (
            <div key={co.id} className={`corridor-card ${mine ? 'mine' : ''}`} style={{ '--corridor': colorOf(co.owner) } as React.CSSProperties}>
              <div className="row-between">
                <strong>{co.name}</strong>
                {mine ? <Badge tone="good">À VOUS</Badge> : co.owner ? <Badge tone="warn">PÉAGE {co.toll} %</Badge> : <Badge tone="neutral">VOIE LIBRE</Badge>}
              </div>
              <div className="tiny muted mt-8">{co.description}</div>
              <div className="row-between tiny muted mt-8">
                <span>
                  Propriétaire : <strong style={{ color: colorOf(co.owner) }}>{co.owner ? nameOf.get(co.owner)?.name ?? co.owner : 'personne'}</strong>
                </span>
                <span>Trafic : <span className="mono">{co.traffic.toFixed(0)} Md €</span></span>
              </div>
              <div className="mt-8">
                <ProgressBar label="Part du trafic mondial" value={(co.traffic / maxTraffic) * 100} height={5} tone={co.traffic > 20 ? 'good' : 'default'} />
              </div>
              <div className="row-between tiny muted mt-8">
                <span>Prix : <strong className="mono">{co.purchaseCost} Md €</strong></span>
                <span>Entretien : <strong className="mono">{co.upkeep} Md €/an</strong></span>
                <span>Régions : <strong>{co.regions[0] === co.regions[1] ? co.regions[0] : `${co.regions[0]} ↔ ${co.regions[1]}`}</strong></span>
              </div>

              {isPlayer && (
                <div className="row wrap mt-8" style={{ gap: 8 }}>
                  {!co.owner && (
                    <button
                      className="btn btn-sm btn-primary btn3d"
                      disabled={c.economy.cash < co.purchaseCost}
                      title={c.economy.cash < co.purchaseCost ? `Trésorerie insuffisante (${co.purchaseCost} Md €)` : `Acheter ${co.name}`}
                      onClick={() => setPending({ params: { type: 'buy_corridor', corridorId: co.id }, title: `Acheter « ${co.name} »`, description: `Péage initial 4 %. Entretien ${co.upkeep} Md €/an. Tout transit tiers vous rapportera — versé automatiquement dans votre trésorerie.` })}
                    >
                      💰 Acheter ({co.purchaseCost} Md €)
                    </button>
                  )}
                  {mine && (
                    <>
                      <div className="row" style={{ gap: 8, flex: 1, minWidth: 180 }}>
                        <input
                          type="range" min={0} max={15} step={0.5} value={toll}
                          aria-label={`Péage ${co.name}`}
                          onChange={(e) => setTollDraft((d) => ({ ...d, [co.id]: Number(e.target.value) }))}
                        />
                        <span className="mono small" style={{ fontWeight: 800, minWidth: 46 }}>{toll.toFixed(1)} %</span>
                        {toll !== co.toll && (
                          <button className="btn btn-sm btn3d" onClick={() => setPending({ params: { type: 'set_toll', corridorId: co.id, value: toll }, title: `Péage « ${co.name} » → ${toll.toFixed(1)} %` })}>
                            Appliquer
                          </button>
                        )}
                      </div>
                      <button className="btn btn-sm btn-danger" onClick={() => setPending({ params: { type: 'abandon_corridor', corridorId: co.id }, title: `Abandonner « ${co.name} »`, description: 'La route redevient libre : fin des péages et de l’entretien. Investissement non remboursé.' })}>
                        Abandonner
                      </button>
                    </>
                  )}
                  {co.owner && !mine && (
                    <span className="tiny muted">
                      Vos transits via cette route paient <strong style={{ color: 'var(--danger)' }}>{co.toll} %</strong> à {nameOf.get(co.owner)?.name}.
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {visibleCorridors.length === 0 && (
        <GlassCard className="mt-16">
          <EmptyState title="Aucune route dans ce filtre" hint="Changez de filtre pour voir les autres routes du monde." icon="🧭" />
        </GlassCard>
      )}

      {/* ---------------- 3. Mes routes par partenaire ---------------- */}
      <div className="trade-section-head mt-24">
        <div className="row wrap" style={{ gap: 10 }}>
          <h2 style={{ margin: 0 }}>🧭 Mes routes par partenaire</h2>
          <InfoTip text="Vos échanges automatiques avec chaque partenaire suivent la route choisie. Chaque route traversée qui ne vous appartient pas prélève son péage sur la valeur transportée. Changez de combinaison pour éviter les péages coûteux — la carte se met à jour avec le trafic." />
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <label htmlFor="route-partner" className="tiny muted">Partenaire :</label>
          <select
            id="route-partner"
            className="input"
            style={{ maxWidth: 260 }}
            value={routePartner || partners[0]?.id || ''}
            disabled={!isPlayer || partners.length === 0}
            onChange={(e) => setRoutePartner(e.target.value)}
          >
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <span className="tiny muted">
            Sélection actuelle : <strong style={{ color: 'var(--accent-cyan)' }}>{routeSel === 'auto' ? 'automatique (moins chère)' : routeSel.split('+').length + ' route(s)'}</strong>
          </span>
        </div>
      </div>
      <GlassCard className="anim-fade-up">
        {routeOpts.length === 0 && <div className="small muted">Choisissez un partenaire pour voir les combinaisons de routes.</div>}
        <div className="grid grid-2" style={{ gap: 12 }}>
          {routeOpts.map((o) => {
            const selected = (routeSel === 'auto' && o.id === routeOpts[0]?.id) || routeSel === o.id;
            return (
              <div key={o.id} className={`route-opt ${selected ? 'selected' : ''}`}>
                <div className="row-between">
                  <strong className="small">🧭 {o.label}</strong>
                  {selected && <Badge tone="good">SÉLECTION</Badge>}
                </div>
                <div className="route-steps mt-8">
                  {o.corridors.map((cid, i) => {
                    const co = corridors.find((x) => x.id === cid);
                    const owned = co?.owner === c.id;
                    return (
                      <span key={cid} className="row" style={{ gap: 4 }}>
                        {i > 0 && <span className="route-step-arrow" aria-hidden>→</span>}
                        <span
                          className="route-step"
                          style={{
                            borderColor: owned ? 'rgba(52,211,153,0.5)' : co?.owner ? 'rgba(251,191,36,0.4)' : 'rgba(139,144,171,0.35)',
                            color: owned ? '#6ee7b7' : co?.owner ? '#fcd34d' : 'var(--text-1)',
                          }}
                        >
                          {co?.name ?? cid}{co?.owner ? (owned ? ' · à vous' : ` · ${co.toll} %`) : ' · libre'}
                        </span>
                      </span>
                    );
                  })}
                </div>
                <div className="row wrap mt-8" style={{ gap: 8 }}>
                  <Badge tone={o.tollRate === 0 ? 'good' : 'warn'}>Péages {o.tollRate.toFixed(1)} %</Badge>
                  <Badge tone="neutral">Fret {o.freightRate.toFixed(1)} %</Badge>
                  <Badge tone={o.costRate <= 5 ? 'good' : o.costRate <= 12 ? 'warn' : 'danger'}>Coût total {o.costRate.toFixed(1)} %</Badge>
                </div>
                {isPlayer && (
                  <button
                    className="btn btn-sm btn3d mt-8"
                    disabled={selected && routeSel !== 'auto'}
                    onClick={() => {
                      void runAction(c.id, { type: 'set_route', partnerId: routePartner || partners[0]?.id || '', pathId: o.id }).then(() => {
                        gameApi.routeOptions(c.id, routePartner || partners[0]?.id || '').then((r) => { setRouteOpts(r.options); setRouteSel(r.selected); }).catch(() => undefined);
                        refresh();
                      });
                    }}
                  >
                    {selected && routeSel !== 'auto' ? 'Route active' : 'Emprunter cette route'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </GlassCard>

      {/* ---------------- 4. Flux & registre ---------------- */}
      <div className="trade-section-head mt-24">
        <h2 style={{ margin: 0 }}>📊 Flux & registre</h2>
      </div>
      <div className="grid grid-2">
        <BarChartCard
          title="Exportations par partenaire (Md €/an)"
          data={[...exportsByPartner.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, v]) => ({ name: nameOf.get(id)?.code ?? id, value: Math.round(v) }))}
          color="#3ec9a7"
        />
        <BarChartCard
          title="Importations par partenaire (Md €/an)"
          data={[...importsByPartner.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, v]) => ({ name: nameOf.get(id)?.code ?? id, value: Math.round(v) }))}
          color="#7fb2c9"
        />
      </div>

      <GlassCard className="mt-16">
        <div className="row-between mb-8">
          <h3 style={{ margin: 0 }}>Registre des échanges</h3>
          <span className="tiny muted">Péages perçus cumulés sur vos routes : {formatMoney(tollIncome)}</span>
        </div>
        {transactions.filter((t) => t.fromId === c.id || t.toId === c.id).length === 0 && (
          <EmptyState title="Aucune transaction" hint="Expédiez des marchandises ou recevez une livraison IA." icon="📒" />
        )}
        <div className="table-wrap">
          <table className="data responsive">
            <thead>
              <tr><th>Jour</th><th>Sens</th><th>Partenaire</th><th>Ressource</th><th>Route</th><th>Valeur</th></tr>
            </thead>
            <tbody>
              {transactions
                .filter((t) => t.fromId === c.id || t.toId === c.id)
                .slice(0, 25)
                .map((t) => (
                  <tr key={t.id}>
                    <td data-label="Jour" className="mono">J{t.day}</td>
                    <td data-label="Sens">{t.fromId === c.id ? <Badge tone="good">EXPORT</Badge> : <Badge tone="info">IMPORT</Badge>}</td>
                    <td data-label="Partenaire">{nameOf.get(t.fromId === c.id ? t.toId : t.fromId)?.name ?? 'Marché'}</td>
                    <td data-label="Ressource">{RESOURCE_MAP[t.resource]?.name ?? t.resource}</td>
                    <td data-label="Route" className="tiny">{t.note ?? '—'}</td>
                    <td data-label="Valeur" className="mono">{t.value.toFixed(2)} Md €</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {pending && (
        <ActionModal
          countryId={c.id}
          params={pending.params}
          title={pending.title}
          description={pending.description}
          onClose={() => {
            setPending(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
