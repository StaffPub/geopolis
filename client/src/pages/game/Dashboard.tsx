/**
 * GEOPOLIS — Vue générale v3 : hero animé aux couleurs de la nation,
 * tuiles d'action 3D, revendications du PEUPLE calculées depuis l'état réel
 * du pays, balance nationale expliquée, journal live, alertes, événements.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, formatPopulation, worldDate } from 'shared';
import { RESOURCE_KEYS, RESOURCE_MAP } from 'shared';
import { useAuth } from '../../state/AuthContext.js';
import { useGame } from '../../state/GameContext.js';
import { InfoTip } from '../../components/InfoTip.js';
import { AnimatedNumber, Badge, Delta, EmptyState, GlassCard, ProgressBar, StatCard } from '../../components/ui.js';
import { Sparkline } from '../../components/Charts.js';

/** Explication du solde budgétaire (partagée par l'infobulle du hero et la carte KPI). */
export const BALANCE_TIP =
  "Solde budgétaire (Md €/an) = RECETTES − DÉPENSES de l'État. " +
  "Recettes : impôts sur le revenu, impôts sur les sociétés, droits de douane sur les importations. " +
  "Dépenses : budgets sectoriels (santé, éducation, transports…), entretien des infrastructures, intérêts de la dette. " +
  "Chaque jour, solde/365 entre dans votre trésorerie (positif) ou en sort (négatif) ; si la trésorerie tombe à zéro, le déficit augmente la DETTE. " +
  "Il DESCEND si : vous montez les budgets sectoriels, la dette gonfle (intérêts), la croissance/l'assiette fiscale faiblit, les importations taxées baissent. " +
  "Il MONTE si : vous relevez la fiscalité ou les tarifs douaniers (attention à la popularité et à la consommation), vous réduisez les budgets sectoriels, vous remboursez la dette (moins d'intérêts), la croissance augmente les recettes, les douanes progressent. " +
  "À noter : les péages de vos routes commerciales et vos ventes de ressources alimentent directement la TRÉSORERIE, sans passer par le solde budgétaire.";

/* ---------------- Revendications du peuple (dérivées de l'état RÉEL) ---------------- */

interface Demand {
  id: string;
  icon: string;
  label: string;
  why: string;
  severity: number; // 0..1
}

function computeDemands(c: NonNullable<ReturnType<typeof useGame>['myCountry']>): Demand[] {
  const e = c.economy;
  const out: Demand[] = [];
  const push = (id: string, icon: string, label: string, why: string, severity: number) => {
    if (severity > 0.12) out.push({ id, icon, label, why, severity: Math.min(1, severity) });
  };
  push('jobs', '💼', 'Emploi pour tous', `Chômage à ${e.unemployment.toFixed(1)} % : les quartiers populaires réclament des embauches.`, (e.unemployment - 6) / 12);
  push('prices', '🛒', 'Pouvoir d’achat', `Inflation à ${e.inflation.toFixed(1)} % : les prix rongent les salaires.`, (e.inflation - 3) / 12);
  push('tax', '🧾', 'Moins d’impôts', `Fiscalité à ${c.policy.taxRate.toFixed(0)} % : les contribuables trouvent la charge lourde.`, (c.policy.taxRate - 22) / 25);
  push('health', '🏥', 'Mieux se soigner', `Budget santé à ${c.policy.spending.health.toFixed(1)} % du PIB : hôpitaux sous tension.`, (3.8 - c.policy.spending.health) / 3);
  push('education', '🎓', 'École & universités', `Budget éducation à ${c.policy.spending.education.toFixed(1)} % du PIB : enseignants et étudiants s’impatientent.`, (3.4 - c.policy.spending.education) / 3);
  push('housing', '🏠', 'Se loger décemment', `Logements niveau ${c.infra.housing?.level ?? 0}/10 : loyers et mal-logement préoccupent.`, (5 - (c.infra.housing?.level ?? 0)) / 6);
  push('social', '🤲', 'Filet social', `Budget social à ${c.policy.spending.social.toFixed(1)} % du PIB : les plus fragiles demandent protection.`, (3.4 - c.policy.spending.social) / 3);
  push('food', '🌾', 'Assurance alimentaire', `Stocks alimentaires à ${((c.resources.food.stock / Math.max(1, c.resources.food.capacity)) * 100).toFixed(0)} % : crainte de pénurie.`, (0.45 - c.resources.food.stock / Math.max(1, c.resources.food.capacity)) / 0.4);
  push('energy', '⚡', 'Énergie abondante', `Stocks d’énergie à ${((c.resources.energy.stock / Math.max(1, c.resources.energy.capacity)) * 100).toFixed(0)} % : risque de coupures et de prix hauts.`, (0.45 - c.resources.energy.stock / Math.max(1, c.resources.energy.capacity)) / 0.4);
  push('change', '🗳️', 'Changer de cap', `Popularité à ${c.popularity.toFixed(0)} % : une partie du peuple doute de la direction prise.`, (45 - c.popularity) / 30);
  push('calm', '🕊️', 'Stabilité & sécurité', `Stabilité à ${c.stability.toFixed(0)} % : tensions sociales perceptibles.`, (50 - c.stability) / 35);
  return out.sort((a, b) => b.severity - a.severity).slice(0, 5);
}

const DEMAND_TONE = (s: number) => (s > 0.6 ? 'danger' : s > 0.35 ? 'warn' : 'good');

export function Dashboard() {
  const { countryId, user } = useAuth();
  const { myCountry, market, meta, actors, countries } = useGame();

  const c = myCountry && myCountry.id === countryId ? myCountry : null;
  const isMe = !!c && c.controller.kind === 'player' && c.controller.userId === user?.id;

  const derived = useMemo(() => {
    if (!c) return null;
    const debtRatio = c.economy.gdp > 0 ? (c.economy.debt / c.economy.gdp) * 100 : 0;
    const balancePct = c.economy.gdp > 0 ? (c.economy.balance / c.economy.gdp) * 100 : 0;
    const infraLevels = Object.values(c.infra).map((i) => i.level);
    const infraAvg = infraLevels.reduce((a, b) => a + b, 0) / Math.max(1, infraLevels.length);
    const relScores = Object.values(c.relations).map((r) => r.score);
    const diploAvg = relScores.length ? relScores.reduce((a, b) => a + b, 0) / relScores.length : 50;
    const partners = Object.entries(c.relations)
      .filter(([, r]) => r.tradeVolume > 0.01)
      .sort((a, b) => b[1].tradeVolume - a[1].tradeVolume)
      .slice(0, 5)
      .map(([id, r]) => ({ country: countries.find((x) => x.id === id), volume: r.tradeVolume }));
    const clamp01 = (v: number) => Math.min(100, Math.max(0, v));
    return {
      debtRatio, balancePct, infraAvg, diploAvg, partners,
      economyScore: clamp01(50 + c.economy.growth * 8 - Math.max(0, c.economy.inflation - 2) * 4 - Math.max(0, c.economy.unemployment - 5) * 3),
      financeScore: clamp01(50 + balancePct * 6 + Math.min(20, (c.economy.cash / Math.max(1, c.economy.gdp)) * 400) - Math.max(0, debtRatio - 60) * 0.5),
      populationScore: clamp01(c.economy.standardOfLiving),
      infraScore: clamp01((infraAvg / 8) * 100),
      stabilityScore: clamp01(c.stability),
    };
  }, [c, countries]);

  const demands = useMemo(() => (c ? computeDemands(c) : []), [c]);

  /* ---------------- Mode observateur ---------------- */
  if (!c || !derived) {
    return (
      <div className="page">
        <GlassCard>
          <EmptyState
            title="Vous observez le monde sans diriger de nation"
            hint="Prenez la tête d'un des 36 pays libres pour gouverner en temps réel, ou explorez le monde."
            icon="🌐"
          />
          <div className="row mt-16" style={{ justifyContent: 'center' }}>
            <Link className="btn btn-primary" to="/countries">Choisir ma nation</Link>
            <Link className="btn" to="/game/world">Explorer le monde</Link>
          </div>
        </GlassCard>
        <div className="grid grid-4 mt-16 stagger">
          <StatCard label="Nations" value={countries.length || 36} format={(v) => v.toFixed(0)} />
          <StatCard label="Acteurs actifs" value={actors.total} format={(v) => v.toFixed(0)} />
          <StatCard label="Jour du monde" value={meta?.day ?? 0} format={(v) => v.toFixed(0)} />
          <StatCard label="Version monde" value={meta?.version ?? 0} format={(v) => v.toFixed(0)} />
        </div>
      </div>
    );
  }

  const popTrend = c.mandate.popularityTrend;
  const lastPt = c.series[c.series.length - 1];
  const prevPt = c.series[c.series.length - 2];
  const cashPerDay = lastPt && prevPt ? lastPt.cash - prevPt.cash : undefined;
  const gdpPerDay = lastPt && prevPt ? lastPt.gdp - prevPt.gdp : undefined;
  const RING_R = 34;
  const RING_C = 2 * Math.PI * RING_R;

  return (
    <div className="page">
      {/* ---------- HERO v2 ---------- */}
      <div className="nation-hero anim-fade-up" style={{ '--hero': c.color } as React.CSSProperties} data-tour="hero">
        <div className="nh-glow" aria-hidden />
        <div className="nh-main">
          <div className="nh-emblem" aria-hidden>{c.code}</div>
          <div className="nh-id">
            <h1>{c.name}</h1>
            <div className="nh-chips">
              <span className="chip">{c.regime}</span>
              <span className="chip">👤 {c.controller.presidentName}</span>
              <span className={`chip ${isMe ? 'chip-me' : 'chip-ai'}`}>{isMe ? '✓ VOUS' : c.controller.kind === 'player' ? 'AUTRE JOUEUR' : 'IA ACTIVE'}</span>
              {meta && <span className="chip">🕰️ {worldDate(meta.day)}</span>}
            </div>
          </div>
        </div>

        <div className="nh-stats">
          <div className="nh-stat">
            <span className="tiny muted">PIB</span>
            <strong><AnimatedNumber value={c.economy.gdp} format={(v) => formatMoney(v)} duration={55000} easing="linear" /></strong>
            <Delta value={c.economy.growth} />
          </div>
          <div className="nh-stat">
            <span className="tiny muted">Trésorerie</span>
            <strong><AnimatedNumber value={c.economy.cash} format={(v) => formatMoney(v)} duration={55000} easing="linear" /></strong>
            {cashPerDay !== undefined && (
              <span className="tiny mono" style={{ color: cashPerDay >= 0 ? 'var(--good)' : 'var(--danger)' }}>
                {cashPerDay >= 0 ? '+' : ''}{cashPerDay.toFixed(1)} Md €/jour
              </span>
            )}
          </div>
          <div className="nh-stat">
            <span className="tiny muted with-tip">
              Solde budgétaire
              <InfoTip label="Explication du solde budgétaire" text={BALANCE_TIP} />
            </span>
            <strong style={{ color: c.economy.balance >= 0 ? 'var(--good)' : 'var(--danger)' }}>
              <AnimatedNumber value={c.economy.balance} format={(v) => `${v >= 0 ? '+' : ''}${formatMoney(v)}`} duration={55000} easing="linear" />
            </strong>
            <span className="tiny mono muted">{(c.economy.balance / 365).toFixed(2)} Md €/jour</span>
          </div>
        </div>

        <div className="nh-ring-wrap">
          <svg width="92" height="92" viewBox="0 0 92 92" aria-label={`Popularité ${c.popularity.toFixed(0)} %`}>
            <defs>
              <linearGradient id="popgrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#5b8cff" />
                <stop offset="100%" stopColor="#3ddc97" />
              </linearGradient>
            </defs>
            <circle cx="46" cy="46" r={RING_R} stroke="rgba(255,255,255,0.08)" strokeWidth="9" fill="none" />
            <circle
              cx="46" cy="46" r={RING_R}
              stroke="url(#popgrad)" strokeWidth="9" fill="none" strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - Math.min(100, Math.max(0, c.popularity)) / 100)}
              transform="rotate(-90 46 46)"
              className="nh-ring-fill"
            />
            <text x="46" y="44" textAnchor="middle" className="nh-ring-num">
              {Math.round(c.popularity)}%
            </text>
            <text x="46" y="58" textAnchor="middle" className="nh-ring-lbl">popularité</text>
          </svg>
          <Badge tone={c.mandate.risk === 'faible' ? 'good' : c.mandate.risk === 'modéré' ? 'warn' : 'danger'}>
            RISQUE {c.mandate.risk.toUpperCase()}
          </Badge>
        </div>
      </div>

      {/* ---------- Bannière de contrôle ---------- */}
      {isMe ? (
        <div className="control-banner">
          <span style={{ fontSize: '1.3rem' }} aria-hidden>✅</span>
          <div className="flex1">
            <strong>Vous gouvernez {c.name}</strong>
            <div className="tiny muted">Mandat depuis le jour {c.controller.sinceDay} · chaque décision a des conséquences réelles et durables.</div>
          </div>
          <Badge tone="good">PRÉSIDENT EN EXERCICE</Badge>
        </div>
      ) : (
        <div className="control-banner lost">
          <span style={{ fontSize: '1.3rem' }} aria-hidden>⚠️</span>
          <div className="flex1">
            <strong>{c.name} est dirigée par un gouvernement IA</strong>
            <div className="tiny muted">Votre mandat a pris fin ou n'a pas encore commencé. L'État a continué de tourner : aucune donnée perdue.</div>
          </div>
          <Link className="btn btn-sm btn-primary" to="/countries">Reprendre une nation</Link>
        </div>
      )}

      {/* ---------- Tuiles d'action 3D ---------- */}
      {isMe && (
        <div className="action-tiles">
          <Link className="action-tile" style={{ '--tile': '#5b8cff' } as React.CSSProperties} to="/game/politics">
            <span className="tile-ico" aria-hidden>🏛️</span>
            <span className="tile-txt"><strong>Décider</strong><span>Fiscalité, budget, monétaire</span></span>
          </Link>
          <Link className="action-tile" style={{ '--tile': '#7fb2c9' } as React.CSSProperties} to="/game/infrastructure">
            <span className="tile-ico" aria-hidden>🏗️</span>
            <span className="tile-txt"><strong>Investir</strong><span>Chantiers rentables à long terme</span></span>
          </Link>
          <Link className="action-tile" style={{ '--tile': '#b28cff' } as React.CSSProperties} to="/game/laws">
            <span className="tile-ico" aria-hidden>📜</span>
            <span className="tile-txt"><strong>Légiférer</strong><span>Lois & réformes (popularité ±)</span></span>
          </Link>
          <Link className="action-tile" style={{ '--tile': '#ff7a6b' } as React.CSSProperties} to="/game/diplomacy">
            <span className="tile-ico" aria-hidden>🤝</span>
            <span className="tile-txt"><strong>Négocier</strong><span>Accords, aides, mesures</span></span>
          </Link>
        </div>
      )}

      {/* ---------- KPIs : deux groupes lisibles ---------- */}
      <div className="kpi-group mt-16">
        <div className="kpi-group-title">💰 Finances publiques</div>
        <div className="grid grid-4 stagger">
          <StatCard label="PIB" value={c.economy.gdp} format={(v) => formatMoney(v)} delta={c.economy.growth} glide perDay={gdpPerDay} perDayFormat={(v) => formatMoney(v)} tone="var(--gold)" />
          <StatCard
            label="Budget (solde)"
            value={c.economy.balance}
            format={(v) => `${v >= 0 ? '+' : ''}${formatMoney(v)}`}
            glide
            tone={c.economy.balance >= 0 ? 'var(--good)' : 'var(--danger)'}
            icon={<InfoTip label="Explication du solde budgétaire" text={BALANCE_TIP} />}
          />
          <StatCard label="Trésorerie" value={c.economy.cash} format={(v) => formatMoney(v)} glide perDay={cashPerDay} perDayFormat={(v) => `${v.toFixed(1)} Md €`} tone="var(--azure)" />
          <StatCard label="Dette / PIB" value={derived.debtRatio} format={(v) => `${v.toFixed(0)} %`} tone={derived.debtRatio > 90 ? 'var(--danger)' : 'var(--teal)'} />
        </div>
      </div>
      <div className="kpi-group mt-16">
        <div className="kpi-group-title">👥 Société & prix</div>
        <div className="grid grid-4 stagger">
          <StatCard label="Population" value={c.population} format={(v) => formatPopulation(v)} tone="var(--teal)" />
          <StatCard label="Inflation" value={c.economy.inflation} format={(v) => `${v.toFixed(1)} %`} glide tone={c.economy.inflation > 5 ? 'var(--warn)' : 'var(--azure)'} />
          <StatCard label="Chômage" value={c.economy.unemployment} format={(v) => `${v.toFixed(1)} %`} glide tone={c.economy.unemployment > 9 ? 'var(--warn)' : 'var(--azure)'} />
          <StatCard label="Niveau de vie" value={c.economy.standardOfLiving} format={(v) => `${v.toFixed(0)}/100`} glide tone="var(--copper)" />
        </div>
      </div>

      <div className="dash-grid mt-16">
        {/* ---------- Colonne gauche ---------- */}
        <div className="col">
          {/* Revendications du peuple */}
          <GlassCard className="anim-fade-up" dataTour="demands">
            <div className="row-between mb-8">
              <h3 style={{ margin: 0 }}>📣 Revendications du peuple</h3>
              <InfoTip text="Calculées en direct depuis l'état réel de votre pays : chômage, inflation, fiscalité, services publics, stocks, popularité. Plus la barre est rouge, plus la demande est pressante." />
            </div>
            {demands.length === 0 ? (
              <div className="small" style={{ color: 'var(--good)' }}>
                🎉 Le peuple est satisfait : aucune revendication majeure en ce moment.
              </div>
            ) : (
              <div className="col">
                {demands.map((d, i) => (
                  <div key={d.id} className="demand-row anim-slide-right" style={{ animationDelay: `${i * 70}ms` }}>
                    <span className="demand-ico" aria-hidden>{d.icon}</span>
                    <div className="flex1">
                      <div className="row-between">
                        <strong className="small">{d.label}</strong>
                        <span className="tiny mono" style={{ color: d.severity > 0.6 ? 'var(--danger)' : d.severity > 0.35 ? 'var(--warn)' : 'var(--good)' }}>
                          {d.severity > 0.6 ? 'URGENT' : d.severity > 0.35 ? 'FORT' : 'MODÉRÉ'}
                        </span>
                      </div>
                      <ProgressBar value={d.severity * 100} tone={DEMAND_TONE(d.severity)} height={6} />
                      <div className="tiny muted mt-8">{d.why}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          {/* Balance nationale */}
          <GlassCard className="anim-fade-up">
            <div className="row-between mb-8">
              <h3 style={{ margin: 0 }}>Situation nationale</h3>
              <InfoTip text="Synthèse 0-100 calculée depuis vos indicateurs réels : économie (croissance/inflation/chômage), finances (solde, dette, trésorerie), population (niveau de vie), infrastructures, diplomatie (relations moyennes), stabilité." />
            </div>
            <div className="col mt-8">
              <ScoreBar label="Économie" score={derived.economyScore} tip="Croissance, inflation et chômage combinés." />
              <ScoreBar label="Finances" score={derived.financeScore} tip="Solde budgétaire, poids de la dette et réserves de trésorerie." />
              <ScoreBar label="Population" score={derived.populationScore} tip="Niveau de vie : consommation, services, logement, santé." />
              <ScoreBar label="Infrastructure" score={derived.infraScore} tip="Niveau moyen de vos 18 infrastructures (0-10)." />
              <ScoreBar label="Diplomatie" score={derived.diploAvg} tip="Score relationnel moyen avec les 35 autres nations." />
              <ScoreBar label="Stabilité" score={derived.stabilityScore} tip="Cohésion sociale : popularité, inflation, pénuries, tensions." />
            </div>
          </GlassCard>

          {/* Ressources */}
          <GlassCard className="anim-fade-up">
            <div className="row-between mb-8">
              <h3 style={{ margin: 0 }}>Ressources & stocks</h3>
              <Link to="/game/economy" className="tiny">Détails & marchés →</Link>
            </div>
            <div className="grid grid-2" style={{ gap: 12 }}>
              {RESOURCE_KEYS.map((k) => {
                const r = c.resources[k];
                const ratio = r.capacity > 0 ? (r.stock / r.capacity) * 100 : 0;
                const deficit = r.production - r.consumption;
                const price = market?.[k]?.price ?? r.price;
                const change = market?.[k]?.change24h ?? 0;
                return (
                  <div key={k} className="res-card">
                    <div className="row-between">
                      <span className="small" style={{ fontWeight: 700 }}>{RESOURCE_MAP[k].name}</span>
                      <InfoTip text={`Stock ${ratio.toFixed(0)} % de la capacité. Production ${r.production.toFixed(1)}/j vs consommation ${r.consumption.toFixed(1)}/j. Sous 25 % : pénurie → prix ↑, production ↓, popularité ↓.`} />
                    </div>
                    <div className="tiny mono muted">
                      {price.toFixed(2)} € <span className={change >= 0 ? 'delta-up' : 'delta-down'}>{change >= 0 ? '+' : ''}{change.toFixed(1)} %</span>
                    </div>
                    <div className="mt-8"><ProgressBar value={ratio} tone={ratio < 25 ? 'danger' : ratio < 45 ? 'warn' : 'good'} height={6} /></div>
                    <div className="row-between tiny muted mt-8">
                      <span>{ratio.toFixed(0)} %</span>
                      <span className={deficit >= 0 ? 'delta-up' : 'delta-down'}>{deficit >= 0 ? '+' : ''}{deficit.toFixed(1)}/j</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </GlassCard>
        </div>

        {/* ---------- Colonne droite ---------- */}
        <div className="col">
          {/* Mandat */}
          <GlassCard className="anim-fade-up" style={{ borderLeft: c.mandate.risk === 'faible' ? '3px solid var(--good)' : c.mandate.risk === 'modéré' ? '3px solid var(--warn)' : '3px solid var(--danger)' }}>
            <div className="row-between mb-8">
              <h3 style={{ margin: 0 }}>Mandat & popularité</h3>
              <InfoTip text="La popularité dépend de l'économie, des services, de la fiscalité et des événements. Sous 35 % pendant 72 jours de monde : le gouvernement tombe et l'IA assure la succession (avertissements à 12, 28 et 48 jours)." />
            </div>
            <div className="row-between">
              <div>
                <div style={{ fontSize: '1.9rem', fontWeight: 800 }}>
                  <AnimatedNumber value={c.popularity} format={(v) => `${v.toFixed(1)} %`} />
                </div>
                <Delta value={popTrend} />
              </div>
              <div className="center">
                <Badge tone={c.mandate.risk === 'faible' ? 'good' : c.mandate.risk === 'modéré' ? 'warn' : 'danger'}>
                  RISQUE {c.mandate.risk.toUpperCase()}
                </Badge>
                <div className="tiny muted mt-8">Stabilité {c.stability.toFixed(0)} %</div>
              </div>
            </div>
            <div className="mt-8"><Sparkline data={c.series.slice(-60).map((s) => s.popularity)} color="#3ddc97" width={240} height={44} /></div>
            {c.mandate.lowPopularityTicks > 0 && (
              <div className="mt-8">
                <ProgressBar label={`Jours sous le seuil critique : ${c.mandate.lowPopularityTicks}/72`} value={c.mandate.lowPopularityTicks} max={72} tone={c.mandate.lowPopularityTicks > 48 ? 'danger' : c.mandate.lowPopularityTicks > 28 ? 'warn' : 'good'} />
              </div>
            )}
          </GlassCard>

          {/* Alertes */}
          <GlassCard className="anim-fade-up">
            <div className="row-between mb-8">
              <h3 style={{ margin: 0 }}>Alertes</h3>
              <InfoTip text="Déclenchées automatiquement par le moteur : déficits, stocks critiques, chômage, inflation, risque de mandat." />
            </div>
            {c.alerts.length === 0 && <EmptyState title="Aucune alerte" hint="Tout va bien dans la nation." icon="✓" />}
            <div className="col">
              {c.alerts.slice(-5).reverse().map((a) => (
                <div key={a.id} className="row" style={{ gap: 10, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <Badge tone={a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warn' : a.severity === 'opportunity' ? 'good' : a.severity === 'politics' ? 'pink' : 'info'}>
                    {a.severity === 'critical' ? 'ALERTE' : a.severity === 'warning' ? 'ATTENTION' : a.severity === 'opportunity' ? 'OPPORTUNITÉ' : a.severity === 'politics' ? 'POLITIQUE' : 'INFO'}
                  </Badge>
                  <div>
                    <div className="small" style={{ fontWeight: 700 }}>{a.title}</div>
                    <div className="tiny muted">{a.message}</div>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* Journal live */}
          <GlassCard className="anim-fade-up">
            <div className="row-between mb-8">
              <h3 style={{ margin: 0 }}><span className="live-dot" style={{ display: 'inline-block', marginRight: 8 }} aria-hidden />Journal de la nation</h3>
              <Link to="/game/history" className="tiny">Historique →</Link>
            </div>
            <div className="col journal-feed">
              {c.history.slice(-6).reverse().map((h) => (
                <div key={h.id} className="journal-item">
                  <span className="tiny muted mono">J{h.day}</span>
                  <span className="small">{h.text}</span>
                </div>
              ))}
              {c.history.length === 0 && <div className="small muted">Le journal se remplit au fil des jours de monde…</div>}
            </div>
          </GlassCard>

          {/* Événements */}
          <GlassCard className="anim-fade-up">
            <div className="row-between mb-8">
              <h3 style={{ margin: 0 }}>Événements en cours</h3>
              <Link to="/game/events" className="tiny">Tous →</Link>
            </div>
            {c.activeEvents.length === 0 && <div className="small muted">Aucun événement actif.</div>}
            <div className="col">
              {c.activeEvents.map((ev) => (
                <div key={ev.id} className="res-card">
                  <div className="row-between">
                    <strong className="small">⚡ {ev.title}</strong>
                    <span className="tiny muted">J{Math.max(0, ev.endsDay - (meta?.day ?? 0))} restants</span>
                  </div>
                  <div className="tiny muted mt-8">{ev.source}</div>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* Partenaires */}
          <GlassCard className="anim-fade-up">
            <div className="row-between mb-8">
              <h3 style={{ margin: 0 }}>Top partenaires</h3>
              <Link to="/game/trade" className="tiny">Commerce →</Link>
            </div>
            {derived.partners.length === 0 && <div className="small muted">Aucun flux significatif pour l'instant.</div>}
            <div className="col">
              {derived.partners.map((p) => (
                <div key={p.country?.id ?? '?'} className="row-between small">
                  <span className="row" style={{ gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 3, background: p.country?.color ?? '#888', display: 'inline-block' }} aria-hidden />
                    {p.country?.name ?? p.country?.id}
                  </span>
                  <span className="mono tiny muted">{(p.volume * 1000).toFixed(1)} M €/j</span>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

function ScoreBar({ label, score, tip }: { label: string; score: number; tip: string }) {
  const tone = score >= 70 ? 'good' : score >= 45 ? 'warn' : 'danger';
  const word = score >= 80 ? 'Très bonne' : score >= 65 ? 'Bonne' : score >= 45 ? 'Moyenne' : score >= 25 ? 'Faible' : 'Critique';
  return (
    <div className="row-between" style={{ gap: 10 }}>
      <span className="small muted row" style={{ width: 128, gap: 5 }}>
        {label} <InfoTip text={tip} />
      </span>
      <div style={{ flex: 1 }}><ProgressBar value={score} tone={tone} height={9} /></div>
      <span className="small mono" style={{ width: 86, textAlign: 'right', fontWeight: 600 }}>{word}</span>
    </div>
  );
}
