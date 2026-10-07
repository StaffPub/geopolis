/**
 * GEOPOLIS — Ressources v2 (v1.19) : centre névralgique des matières premières.
 *   1. Statistiques du marché — valeur mondiale, évolution 24 h, pénurie ou
 *      abondance mondiale, valeur de VOTRE stock, prix conseillé pour offrir.
 *   2. Mes ressources & consignes — jauges animées, production/consommation,
 *      prix local vs mondial (sparkline), boost/ralenti, recommandation.
 *   3. Marché inter-états — TOUTES les offres (joueurs ET IA), filtrables
 *      (toutes / joueurs / IA / bons prix), tri par prix, liste scrollable :
 *      plus aucune offre joueur noyée sous les offres IA.
 *   4. Publier une offre — prix assisté (boutons ± vs marché), recette estimée.
 *   5. Achats d'urgence & bilatéral — marché mondial (achat seul, la vente au
 *      marché mondial a été supprimée : on vend via ses offres) + nations IA.
 * Hyper synchronisé : WebSocket (offers_update, market_update) + devis serveur.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RESOURCE_KEYS, RESOURCE_MAP } from 'shared';
import type { ActionParams, ResourceKey, TradeOffer } from 'shared';
import { formatMoney } from 'shared';
import { useAuth } from '../../state/AuthContext.js';
import { useGame } from '../../state/GameContext.js';
import { game as gameApi } from '../../lib/api.js';
import { ActionModal } from '../../components/ActionModal.js';
import { InfoTip } from '../../components/InfoTip.js';
import { Badge, EmptyState, GlassCard, PageHeader, ProgressBar, SectionCard, StatCard } from '../../components/ui.js';

interface Seller {
  id: string; name: string; code: string; color: string; region: string;
  playerOwned: boolean; available: number; price: number; rel: number;
  sanction: boolean; eligible: boolean;
}

const VALUE_SCALE_UI = 0.000045;
const BILATERAL_PREMIUM = 1.06;

type OfferFilter = 'all' | 'players' | 'ai' | 'deals';

function statusOf(ratio: number, net: number): { label: string; tone: 'good' | 'warn' | 'danger' | 'info' } {
  if (ratio < 0.3) return { label: 'PÉNURIE', tone: 'danger' };
  if (ratio < 0.45) return { label: 'TENSION', tone: 'warn' };
  if (ratio > 0.82) return { label: 'SURSTOCK', tone: 'info' };
  if (net > 0.5) return { label: 'EXCÉDENT', tone: 'good' };
  return { label: 'ÉQUILIBRE', tone: 'good' };
}

/** État du marché MONDIAL d'une ressource (pénurie/abondance globale). */
function worldStateOf(change24h: number): { label: string; tone: 'good' | 'warn' | 'danger' | 'info' } {
  if (change24h >= 8) return { label: 'PÉNURIE MONDIALE', tone: 'danger' };
  if (change24h >= 3) return { label: 'DEMANDE SOUTENUE', tone: 'warn' };
  if (change24h <= -8) return { label: 'ABONDANCE MONDIALE', tone: 'info' };
  return { label: 'MARCHÉ CALME', tone: 'good' };
}

/** Recommandation simple et cohérente pour le joueur. */
function advise(ratio: number, net: number, local: number, world: number): { label: string; tone: 'good' | 'warn' | 'danger' | 'info' } {
  if (ratio < 0.35 && net < 0) return { label: 'ACHETEZ (pénurie chez vous)', tone: 'danger' };
  if (net > 0.5 && ratio > 0.6) return { label: 'VENDEZ via une offre', tone: 'good' };
  if (world > local * 1.12 && net > 0) return { label: 'VENDEZ (cours mondial haut)', tone: 'good' };
  if (world < local * 0.88 && net < 0) return { label: 'ACHETEZ (cours mondial bas)', tone: 'info' };
  return { label: 'CONSERVEZ', tone: 'warn' };
}

/** Sparkline SVG animée (série des prix mondiaux). */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 4) return null;
  const pts = data.slice(-60);
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = Math.max(0.001, max - min);
  const w = 110;
  const h = 30;
  const path = pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="res-spark">
      <polyline points={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="res-spark-line" />
    </svg>
  );
}

export function ResourcesPage() {
  const { user, countryId } = useAuth();
  const { myCountry, countries, market, offers, estimateAction, refreshMyCountry } = useGame();
  const [pending, setPending] = useState<{ params: ActionParams; title: string; description?: string } | null>(null);

  // Bilatéral
  const [biRes, setBiRes] = useState<ResourceKey>('energy');
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [biSeller, setBiSeller] = useState<string | null>(null);
  const [biUnits, setBiUnits] = useState(10);

  // Achat d'urgence au marché mondial (la vente mondiale a été supprimée)
  const [wmRes, setWmRes] = useState<ResourceKey>('energy');
  const [wmUnits, setWmUnits] = useState(10);
  const [wmQuote, setWmQuote] = useState<{ label: string; value: string; positive: boolean }[] | null>(null);

  // Offres
  const [offRes, setOffRes] = useState<ResourceKey>('industrial');
  const [offUnits, setOffUnits] = useState(10);
  const [offPrice, setOffPrice] = useState(1);
  const [offFilter, setOffFilter] = useState<OfferFilter>('all');
  const [offSort, setOffSort] = useState<'price' | 'total' | 'recent'>('price');

  const c = myCountry && myCountry.id === countryId ? myCountry : null;
  const nameOf = useMemo(() => new Map(countries.map((x) => [x.id, x])), [countries]);
  const isPlayer = !!c && c.controller.kind === 'player' && c.controller.userId === user?.id;

  const cid = c?.id;
  const [sellersTick, setSellersTick] = useState(0);
  useEffect(() => {
    if (!cid) return;
    let cancelled = false;
    const load = (): void => {
      gameApi.sellers(biRes, cid).then((r) => { if (!cancelled) setSellers(r.sellers); }).catch(() => undefined);
    };
    load();
    const t = window.setInterval(load, 20_000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [cid, biRes, sellersTick]);

  // Devis d'achat d'urgence (serveur)
  useEffect(() => {
    if (!c) { setWmQuote(null); return; }
    const t = window.setTimeout(() => {
      void estimateAction(c.id, { type: 'buy_resource', resource: wmRes, units: wmUnits })
        .then((r) => setWmQuote(r.ok ? (r.effects ?? []) : [{ positive: false, label: 'Refus', value: r.error ?? '—' }]));
    }, 220);
    return () => window.clearTimeout(t);
  }, [c, wmRes, wmUnits, estimateAction]);

  // Prix de l'offre aligné sur le marché par défaut
  useEffect(() => {
    const m = market?.[offRes];
    if (m) setOffPrice(Math.round(m.price * 100) / 100);
  }, [offRes, market]);

  const refreshAll = (): void => {
    void refreshMyCountry();
    setSellersTick((x) => x + 1);
    window.dispatchEvent(new Event('gp-trade-changed'));
  };

  if (!c) {
    return (
      <div className="page">
        <PageHeader icon="🛢️" title="Ressources" subtitle="Statistiques du marché, stocks, consignes de production, offres inter-états et achats : tout le cycle des matières premières, en temps réel." />
        <GlassCard>
          <EmptyState title="Aucune nation dirigée" hint="Prenez la tête d'un pays pour gérer ses ressources, sa production et son commerce." icon="🛢️" />
          <div className="row mt-16" style={{ justifyContent: 'center' }}>
            <Link className="btn btn-primary" to="/countries">Choisir ma nation</Link>
          </div>
        </GlassCard>
      </div>
    );
  }

  const myOffers = offers.filter((o) => o.sellerId === c.id);
  const allOthers = offers.filter((o) => o.sellerId !== c.id);
  const filteredOffers = allOthers
    .filter((o) => {
      const seller = nameOf.get(o.sellerId);
      if (offFilter === 'players') return seller?.controllerKind === 'player';
      if (offFilter === 'ai') return seller?.controllerKind === 'ai';
      if (offFilter === 'deals') {
        const world = market?.[o.resource]?.price ?? 0;
        return world > 0 && o.unitPrice <= world * 0.97;
      }
      return true;
    })
    .sort((a, b) => {
      if (offSort === 'price') return a.unitPrice - b.unitPrice;
      if (offSort === 'total') return b.units * b.unitPrice - a.units * a.unitPrice;
      return b.createdDay - a.createdDay;
    });

  const tensionCount = RESOURCE_KEYS.filter((k) => {
    const r = c.resources[k];
    return r.capacity > 0 && r.stock / r.capacity < 0.35;
  }).length;

  return (
    <div className="page">
      <PageHeader
        icon="🛢️"
        title={`Ressources — ${c.name}`}
        subtitle="Statistiques du marché en direct (valeur, pénurie mondiale, conseil), vos stocks et consignes, le marché inter-états où JOUEURS et IA publient et achètent des offres, et les achats d'urgence. La vente au marché mondial n'existe plus : on vend en publiant des offres — l'argent tombe dans votre trésorerie dès qu'un acheteur (joueur ou IA) prend le lot."
        chips={<>
          <Badge tone={tensionCount > 0 ? 'danger' : 'good'}>{tensionCount} ressource(s) en tension</Badge>
          <Badge tone="info">{offers.length} offre(s) sur le marché</Badge>
          <Badge tone={myOffers.length > 0 ? 'violet' : 'neutral'}>{myOffers.length}/4 de mes offres</Badge>
        </>}
      />

      {/* ---------------- 1. Statistiques du marché ---------------- */}
      <SectionCard
        icon="📊"
        title="Statistiques du marché — combien vaut quoi, et pourquoi"
        desc="Cours mondial en direct, évolution 24 h, état du marché (pénurie = prix qui grimpent), valeur de VOTRE stock au prix local, et prix conseillé si vous publiez une offre."
        right={<InfoTip text="Le cours mondial est la moyenne pondérée des prix locaux : une pénurie quelque part tire le prix vers le haut. « Valeur de votre stock » = unités × prix local × échelle du jeu. Le prix conseillé suit le cours mondial (premium si demande soutenue, décote si abondance)." />}
      >
        <div className="table-wrap">
          <table className="data responsive">
            <thead>
              <tr><th>Ressource</th><th>Cours mondial</th><th>24 h</th><th>État du marché</th><th>Votre stock</th><th>Valeur de votre stock</th><th>Prix conseillé (offre)</th></tr>
            </thead>
            <tbody>
              {RESOURCE_KEYS.map((k) => {
                const m = market?.[k];
                const r = c.resources[k];
                const world = m?.price ?? RESOURCE_MAP[k].basePrice;
                const change = m?.change24h ?? 0;
                const ws = worldStateOf(change);
                const stockValue = r.stock * r.price * VALUE_SCALE_UI * 1000;
                const advised = world * (change >= 3 ? 1.05 : change <= -3 ? 0.95 : 1);
                return (
                  <tr key={k}>
                    <td data-label="Ressource">
                      <span className="row" style={{ gap: 8 }}>
                        <span className="res-dot" style={{ background: RESOURCE_MAP[k].color }} aria-hidden />
                        <strong>{RESOURCE_MAP[k].name}</strong>
                      </span>
                    </td>
                    <td data-label="Cours mondial" className="mono">{world.toFixed(2)} €</td>
                    <td data-label="24 h" className="mono" style={{ color: change >= 0 ? 'var(--good)' : 'var(--danger)', fontWeight: 800 }}>
                      {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)} %
                    </td>
                    <td data-label="État"><Badge tone={ws.tone}>{ws.label}</Badge></td>
                    <td data-label="Votre stock" className="mono">{Math.round(r.stock)} u · {r.capacity > 0 ? Math.round((r.stock / r.capacity) * 100) : 0} %</td>
                    <td data-label="Valeur" className="mono" style={{ fontWeight: 800 }}>{formatMoney(stockValue)}</td>
                    <td data-label="Conseil" className="mono">{advised.toFixed(2)} €/u</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* ---------------- 2. Mes ressources & consignes ---------------- */}
      <SectionCard
        className="mt-16"
        icon="🛢️"
        title="Mes ressources & consignes de production"
        desc="Jauges de stock, flux quotidiens, prix local vs mondial et conseil d'action. Boost (+15 %, subventionné) ou ralenti (−12 %, économe) : effet immédiat."
      >
        <div className="grid grid-4 stagger" style={{ gap: 12 }}>
          {RESOURCE_KEYS.map((k) => {
            const r = c.resources[k];
            const ratio = r.capacity > 0 ? r.stock / r.capacity : 0;
            const net = r.production - r.consumption;
            const st = statusOf(ratio, net);
            const adv = advise(ratio, net, r.price, market?.[k]?.price ?? r.price);
            const m = market?.[k];
            return (
              <div key={k} className="res-card anim-rise" style={{ '--res': RESOURCE_MAP[k].color } as React.CSSProperties}>
                <div className="row-between">
                  <span className="small" style={{ fontWeight: 800 }}>{RESOURCE_MAP[k].name}</span>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </div>
                <div className="tiny mono muted mt-8">
                  {r.price.toFixed(2)} € {net >= 0 ? <span style={{ color: 'var(--good)' }}>+{net.toFixed(1)}/j</span> : <span style={{ color: 'var(--danger)' }}>{net.toFixed(1)}/j</span>}
                </div>
                <div className="mt-8"><ProgressBar value={ratio * 100} height={8} tone={ratio < 0.3 ? 'danger' : ratio < 0.45 ? 'warn' : 'good'} /></div>
                <div className="row-between tiny muted mt-8">
                  <span>{Math.round(ratio * 100)} %</span>
                  <span style={{ color: net >= 0 ? 'var(--good)' : 'var(--danger)' }}>{net >= 0 ? '+' : ''}{net.toFixed(1)}/j</span>
                </div>
                {m && <div className="mt-8"><Sparkline data={m.series} color={RESOURCE_MAP[k].color} /></div>}
                <div className="tiny mt-8">
                  <Badge tone={adv.tone}>{adv.label}</Badge>
                </div>
                {isPlayer && (
                  <div className="row mt-8 seg-row" role="group" aria-label={`Consigne ${RESOURCE_MAP[k].name}`}>
                    {(['slow', 'normal', 'boost'] as const).map((mode) => (
                      <button
                        key={mode}
                        className={`res-seg-btn ${c.productionDirectives?.[k] === mode || (mode === 'normal' && !c.productionDirectives?.[k]) ? 'active' : ''}`}
                        onClick={() => setPending({ params: { type: 'set_production', resource: k, mode }, title: `Consigne ${RESOURCE_MAP[k].name} : ${mode === 'boost' ? 'BOOST +15 %' : mode === 'slow' ? 'RALENTI −12 %' : 'normal'}` })}
                      >
                        {mode === 'slow' ? '▾ Ralenti' : mode === 'boost' ? '▴ Boost' : '• Normal'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* ---------------- 3. Marché inter-états : TOUTES les offres ---------------- */}
      <SectionCard
        className="mt-16"
        icon="🏷️"
        title="Marché inter-états — offres des joueurs ET des IA"
        desc="Chaque offre est visible par tout le monde en temps réel. Filtrez (joueurs / IA / bons prix), triez, achetez : le vendeur encaisse immédiatement, vous recevez le stock."
        right={
          <div className="row wrap" style={{ gap: 8 }}>
            {([['all', `Toutes (${allOthers.length})`], ['players', 'Joueurs'], ['ai', 'IA'], ['deals', 'Bons prix']] as [OfferFilter, string][]).map(([id, label]) => (
              <button key={id} className={`cat-btn ${offFilter === id ? 'active' : ''}`} onClick={() => setOffFilter(id)}>{label}</button>
            ))}
            <select className="input" style={{ width: 'auto', padding: '6px 10px', minHeight: 34 }} value={offSort} onChange={(e) => setOffSort(e.target.value as typeof offSort)} aria-label="Trier les offres">
              <option value="price">Tri : prix/unité</option>
              <option value="total">Tri : valeur totale</option>
              <option value="recent">Tri : récence</option>
            </select>
          </div>
        }
      >
        <div className="offers-scroll col" style={{ gap: 10 }}>
          {filteredOffers.length === 0 && (
            <EmptyState title="Aucune offre dans ce filtre" hint="Les offres des autres nations (joueurs compris) apparaissent ici en temps réel dès leur publication." icon="🏷️" />
          )}
          {filteredOffers.map((o) => {
            const seller = nameOf.get(o.sellerId);
            const world = market?.[o.resource]?.price ?? RESOURCE_MAP[o.resource].basePrice;
            const vsWorld = world > 0 ? (o.unitPrice / world - 1) * 100 : 0;
            const total = o.units * o.unitPrice * VALUE_SCALE_UI * 1000;
            const rel = c.relations[o.sellerId];
            const sanctioned = !!rel && (rel.sanctionByUs || rel.sanctionByThem);
            const relOk = !rel || rel.score >= 30 || rel.agreements.some((a) => a.status === 'active');
            const canBuy = isPlayer && !sanctioned && relOk && c.economy.cash >= total && c.resources[o.resource].capacity - c.resources[o.resource].stock >= o.units;
            const whyNot = sanctioned
              ? 'Mesure économique active avec ce vendeur'
              : !relOk
                ? `Relations insuffisantes avec ${seller?.name ?? 'ce pays'} (30 requises)`
                : c.economy.cash < total
                  ? `Trésorerie insuffisante (${formatMoney(total)} requis)`
                  : c.resources[o.resource].capacity - c.resources[o.resource].stock < o.units
                    ? 'Entrepôts insuffisants pour ce lot'
                    : !isPlayer
                      ? 'Seul le président peut acheter'
                      : null;
            return (
              <div key={o.id} className="offer-card anim-rise" style={{ '--res': RESOURCE_MAP[o.resource].color } as React.CSSProperties}>
                <span className="res-dot" style={{ background: RESOURCE_MAP[o.resource].color }} aria-hidden />
                <div className="flex1" style={{ minWidth: 0 }}>
                  <div className="row-between wrap" style={{ gap: 8 }}>
                    <strong className="small">
                      {Math.round(o.units)} u · {RESOURCE_MAP[o.resource].name}
                      {' '}<Badge tone={seller?.controllerKind === 'player' ? 'violet' : 'info'}>{seller?.controllerKind === 'player' ? `JOUEUR · ${seller?.name}` : `IA · ${seller?.name}`}</Badge>
                    </strong>
                    <span className="mono small" style={{ fontWeight: 800, color: RESOURCE_MAP[o.resource].color }}>{o.unitPrice.toFixed(2)} Md €/u</span>
                  </div>
                  <div className="row wrap tiny muted mt-8" style={{ gap: 10 }}>
                    <span>total <strong className="mono">{total.toFixed(2)} Md €</strong></span>
                    <span>expire J{o.expiresDay}</span>
                    <Badge tone={vsWorld <= -3 ? 'good' : vsWorld >= 6 ? 'warn' : 'neutral'}>
                      {vsWorld >= 0 ? '+' : ''}{vsWorld.toFixed(0)} % vs cours mondial
                    </Badge>
                  </div>
                </div>
                <button
                  className="btn btn-sm btn-primary btn3d"
                  disabled={!canBuy}
                  title={whyNot ?? `Acheter le lot de ${seller?.name ?? o.sellerId}`}
                  onClick={() => setPending({
                    params: { type: 'buy_offer', offerId: o.id },
                    title: `Acheter le lot de ${seller?.name ?? o.sellerId}`,
                    description: `${Math.round(o.units)} unités de ${RESOURCE_MAP[o.resource].name} à ${o.unitPrice.toFixed(2)} Md €/u (${total.toFixed(2)} Md €). Le vendeur encaisse automatiquement.`,
                  })}
                >
                  Acheter
                </button>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* ---------------- 4. Publier une offre ---------------- */}
      <SectionCard
        className="mt-16"
        icon="📢"
        title="Publier une offre de vente"
        desc="Votre lot, VOTRE prix. Joueurs et IA le voient immédiatement et peuvent l'acheter à tout moment ; la recette tombe dans votre trésorerie, même hors ligne. 4 offres max, 40 % du stock par lot, expiration à 14 jours."
        right={<InfoTip text="Prix assisté : les boutons calent votre prix sur le cours mondial (±). Un prix sous le cours mondial part vite ; au-dessus, vous misez sur une pénurie future. Les IA achètent dès que votre prix passe sous ~115 % de leur prix local (et sous leur prix local en temps normal, jusqu'à +10 % en pénurie critique)." />}
      >
        <div className="grid grid-3" style={{ gap: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="off-res">Ressource</label>
            <select id="off-res" className="input" value={offRes} disabled={!isPlayer} onChange={(e) => setOffRes(e.target.value as ResourceKey)}>
              {RESOURCE_KEYS.map((k) => (
                <option key={k} value={k}>{RESOURCE_MAP[k].name} · stock {Math.floor(c.resources[k].stock * 0.4)}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="off-units">Unités · max {Math.floor(c.resources[offRes].stock * 0.4)}</label>
            <input
              id="off-units"
              type="range"
              min={1}
              max={Math.max(1, Math.floor(c.resources[offRes].stock * 0.4))}
              value={Math.min(offUnits, Math.max(1, Math.floor(c.resources[offRes].stock * 0.4)))}
              disabled={!isPlayer}
              onChange={(e) => setOffUnits(Number(e.target.value))}
            />
            <span className="mono small" style={{ fontWeight: 800 }}>{offUnits} u</span>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="off-price">Prix unitaire (Md €)</label>
            <div className="row" style={{ gap: 6 }}>
              <input id="off-price" className="input" type="number" step="0.05" min={0.1} value={offPrice} disabled={!isPlayer} onChange={(e) => setOffPrice(Number(e.target.value))} style={{ width: 110 }} />
              {([-0.1, -0.05, 0, 0.05, 0.1] as number[]).map((d) => (
                <button
                  key={d}
                  className="btn btn-sm"
                  disabled={!isPlayer || !market?.[offRes]}
                  title={d === 0 ? 'Aligner sur le cours mondial' : `Cours mondial ${d > 0 ? '+' : ''}${d * 100} %`}
                  onClick={() => setOffPrice(Math.round((market?.[offRes]?.price ?? 1) * (1 + d) * 100) / 100)}
                >
                  {d === 0 ? '= marché' : `${d > 0 ? '+' : ''}${d * 100} %`}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="row-between wrap mt-16" style={{ gap: 10 }}>
          <div className="small muted">
            Recette si vendu : <strong className="mono" style={{ color: 'var(--good)' }}>{formatMoney(offUnits * offPrice * VALUE_SCALE_UI * 1000)}</strong>
            {' '}· cours mondial actuel : <strong className="mono">{(market?.[offRes]?.price ?? 0).toFixed(2)} €/u</strong>
          </div>
          <button
            className="btn btn-primary btn3d btn-wiggle"
            disabled={!isPlayer || myOffers.length >= 4 || offUnits > Math.floor(c.resources[offRes].stock * 0.4)}
            onClick={() => setPending({
              params: { type: 'create_offer', resource: offRes, units: offUnits, unitPrice: offPrice },
              title: 'Publier cette offre sur le marché inter-états',
              description: 'Visible immédiatement par tous les joueurs et toutes les IA. Achat possible à tout moment : la recette rejoint votre trésorerie automatiquement.',
            })}
          >
            🏷️ Publier l'offre {myOffers.length >= 4 ? '(max 4 atteintes)' : ''}
          </button>
        </div>
        <div className="grid grid-2 mt-16" style={{ gap: 12 }}>
          <div>
            <h3 style={{ margin: '0 0 10px' }}>Mes offres ({myOffers.length}/4)</h3>
            {myOffers.length === 0 && <div className="small muted">Aucune offre en cours. Publiez un lot : joueurs et IA surveillent le marché en permanence.</div>}
            <div className="col" style={{ gap: 8 }}>
              {myOffers.map((o) => (
                <OfferRow key={o.id} o={o} mine nameOf={nameOf} onCancel={() => setPending({ params: { type: 'cancel_offer', offerId: o.id }, title: 'Retirer cette offre' })} />
              ))}
            </div>
          </div>
          <div>
            <h3 style={{ margin: '0 0 10px' }}>Le marché en un coup d'œil</h3>
            <div className="grid grid-2" style={{ gap: 8 }}>
              <StatCard label="Offres ouvertes (monde)" value={offers.length} format={(v) => v.toFixed(0)} tone="var(--accent-blue)" />
              <StatCard label="Dont offres de joueurs" value={offers.filter((o) => nameOf.get(o.sellerId)?.controllerKind === 'player').length} format={(v) => v.toFixed(0)} tone="var(--accent-violet)" />
            </div>
          </div>
        </div>
      </SectionCard>

      {/* ---------------- 5. Achats d'urgence & bilatéral ---------------- */}
      <SectionCard
        className="mt-16"
        icon="🚨"
        title="Achats d'urgence & marché bilatéral"
        desc="Le marché mondial permet d'ACHETER instantanément (plus de vente mondiale : vendez via vos offres). Le bilatéral puise dans les stocks des nations IA au prix vendeur + 6 %."
      >
        <div className="grid grid-2" style={{ gap: 14 }}>
          <div className="glass" style={{ padding: 14, borderRadius: 14 }}>
            <h3 style={{ margin: '0 0 10px' }}>🌍 Achat instantané au marché mondial</h3>
            <div className="row wrap" style={{ gap: 8 }}>
              <select className="input" style={{ width: 'auto' }} value={wmRes} disabled={!isPlayer} onChange={(e) => setWmRes(e.target.value as ResourceKey)} aria-label="Ressource à acheter">
                {RESOURCE_KEYS.map((k) => <option key={k} value={k}>{RESOURCE_MAP[k].name}</option>)}
              </select>
              <input className="input" type="number" min={1} value={wmUnits} disabled={!isPlayer} onChange={(e) => setWmUnits(Math.max(1, Number(e.target.value)))} style={{ width: 100 }} aria-label="Unités à acheter" />
              <button
                className="btn btn-primary btn-sm btn3d"
                disabled={!isPlayer}
                onClick={() => setPending({ params: { type: 'buy_resource', resource: wmRes, units: wmUnits }, title: `Acheter ${wmUnits} u de ${RESOURCE_MAP[wmRes].name} au marché mondial` })}
              >
                Acheter maintenant
              </button>
            </div>
            {wmQuote && (
              <div className="ship-quote mt-8 anim-fade-in">
                {wmQuote.map((q, i) => (
                  <span key={i} className="small"><span className="muted">{q.label} : </span><strong style={{ color: q.positive ? 'var(--good)' : 'var(--danger)' }}>{q.value}</strong></span>
                ))}
              </div>
            )}
            <p className="tiny muted mt-8" style={{ margin: '8px 0 0' }}>
              ℹ️ La VENTE au marché mondial a été retirée du jeu : pour encaisser, publiez une offre ci-dessus — joueurs et IA achètent au prix que VOUS fixez.
            </p>
          </div>

          <div className="glass" style={{ padding: 14, borderRadius: 14 }}>
            <h3 style={{ margin: '0 0 10px' }}>🤝 Acheter directement à une nation (IA)</h3>
            <div className="row wrap" style={{ gap: 8 }}>
              <select className="input" style={{ width: 'auto' }} value={biRes} disabled={!isPlayer} onChange={(e) => { setBiRes(e.target.value as ResourceKey); setBiSeller(null); }} aria-label="Ressource bilatérale">
                {RESOURCE_KEYS.map((k) => <option key={k} value={k}>{RESOURCE_MAP[k].name}</option>)}
              </select>
              <select className="input" style={{ width: 'auto', maxWidth: 240 }} value={biSeller ?? ''} disabled={!isPlayer} onChange={(e) => setBiSeller(e.target.value || null)} aria-label="Vendeur">
                <option value="">Choisir un vendeur…</option>
                {sellers.filter((s) => s.eligible).map((s) => (
                  <option key={s.id} value={s.id}>{s.name} · {s.available} u · {s.price.toFixed(2)} €</option>
                ))}
              </select>
              <input className="input" type="number" min={1} value={biUnits} disabled={!isPlayer || !biSeller} onChange={(e) => setBiUnits(Math.max(1, Number(e.target.value)))} style={{ width: 90 }} aria-label="Unités bilatérales" />
              <button
                className="btn btn-primary btn-sm btn3d"
                disabled={!isPlayer || !biSeller}
                onClick={() => biSeller && setPending({ params: { type: 'buy_from_country', sellerId: biSeller, resource: biRes, units: biUnits }, title: `Achat bilatéral à ${nameOf.get(biSeller)?.name ?? biSeller}` })}
              >
                Acheter (+{Math.round((BILATERAL_PREMIUM - 1) * 100)} %)
              </button>
            </div>
            <p className="tiny muted mt-8" style={{ margin: '8px 0 0' }}>
              ℹ️ Les pays dirigés par des joueurs ne vendent que via leurs <strong>offres</strong> (section marché inter-états). Disponibilités recalculées en direct par le serveur.
            </p>
          </div>
        </div>
      </SectionCard>

      {pending && (
        <ActionModal
          countryId={c.id}
          params={pending.params}
          title={pending.title}
          description={pending.description}
          onClose={() => { setPending(null); refreshAll(); }}
        />
      )}
    </div>
  );
}

/** Ligne d'offre compacte (mes offres). */
function OfferRow({ o, mine, nameOf, onCancel }: { o: TradeOffer; mine?: boolean; nameOf: Map<string, { name: string; color: string }>; onCancel?: () => void }) {
  void nameOf;
  const def = RESOURCE_MAP[o.resource];
  const total = o.units * o.unitPrice * VALUE_SCALE_UI * 1000;
  return (
    <div className="offer-card mine anim-rise" style={{ '--res': def.color } as React.CSSProperties}>
      <span className="res-dot" style={{ background: def.color }} aria-hidden />
      <div className="flex1" style={{ minWidth: 0 }}>
        <div className="row-between" style={{ gap: 8 }}>
          <strong className="small">{Math.round(o.units)} u · {def.name}</strong>
          <span className="mono small" style={{ fontWeight: 800, color: def.color }}>{o.unitPrice.toFixed(2)} €/u</span>
        </div>
        <div className="tiny muted">total <strong className="mono">{total.toFixed(2)} Md €</strong> · expire J{o.expiresDay}{mine ? ' · visible par TOUS les joueurs et IA' : ''}</div>
      </div>
      {mine && onCancel && <button className="btn btn-sm btn-danger" onClick={onCancel}>Retirer</button>}
    </div>
  );
}
