/**
 * GEOPOLIS — Lois & Réformes v2 : refonte complète.
 * - Hero animé (sceau, plume) + KPIs agrégés du paquet législatif actuel.
 * - Jauge « humeur du peuple » animée avec marqueur glissant.
 * - SIMULATEUR législatif : basculez des lois (sans les voter) et voyez les
 *   effets AGRÉGÉS en direct (coût, popularité/semaine, productivité,
 *   stabilité, inflation, faisabilité budgétaire) — chiffres animés.
 * - Cartes de lois riches : sceau de cire pulsant si en vigueur, chips
 * d'effets colorés, coût en Md €, verrou de popularité, synergies & conflits.
 * - Recherche + filtres, stagger d'entrée, hover glow par catégorie.
 * Tout passe par le serveur pour l'exécution (ActionModal + estimations).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LAWS } from 'shared';
import type { ActionParams, LawDef } from 'shared';
import { formatMoney, worldDate } from 'shared';
import { useAuth } from '../../state/AuthContext.js';
import { useGame } from '../../state/GameContext.js';
import { ActionModal } from '../../components/ActionModal.js';
import { InfoTip } from '../../components/InfoTip.js';
import { AnimatedNumber, Badge, Delta, EmptyState, GlassCard, SectionCard, SectionTitle } from '../../components/ui.js';

interface Pending { params: ActionParams; title: string; description?: string }

const LAW_ICONS: Record<string, string> = {
  national_infra_program: '🏗️', education_reform: '🎓', health_coverage: '🏥',
  green_transition: '🌿', business_deregulation: '📈', labor_protection: '🤝',
  innovation_fund: '💡', food_sovereignty: '🌾', trade_facilitation: '🚢',
  fiscal_discipline: '⚖️', national_festival: '🎉', purchasing_power_bonus: '💶',
  civic_service: '🎖️', citizens_referendum: '🗳️',
};

const LAW_CATS: Record<string, { label: string; color: string }> = {
  social: { label: 'Social & peuple', color: '#d9b45f' },
  eco: { label: 'Économie', color: '#7fb2c9' },
  savoir: { label: 'Savoir & innovation', color: '#e0b050' },
  secteur: { label: 'Secteurs & territoire', color: '#3ec9a7' },
  democratie: { label: 'Démocratie', color: '#e0b050' },
};

function lawCat(id: string): keyof typeof LAW_CATS {
  if (['health_coverage', 'labor_protection', 'civic_service', 'national_festival', 'purchasing_power_bonus'].includes(id)) return 'social';
  if (['business_deregulation', 'fiscal_discipline', 'trade_facilitation'].includes(id)) return 'eco';
  if (['education_reform', 'innovation_fund'].includes(id)) return 'savoir';
  if (['citizens_referendum'].includes(id)) return 'democratie';
  return 'secteur';
}

/** Paires synergie / conflit pour conseils contextuels. */
const INTERACTIONS: { a: string; b: string; kind: 'synergie' | 'conflit'; tip: string }[] = [
  { a: 'business_deregulation', b: 'labor_protection', kind: 'conflit', tip: 'Flexibilité contre protection : les deux ensemble se neutralisent socialement.' },
  { a: 'fiscal_discipline', b: 'national_festival', kind: 'conflit', tip: 'Austérité et fêtes nationales : le grand écart budgétaire.' },
  { a: 'fiscal_discipline', b: 'purchasing_power_bonus', kind: 'conflit', tip: 'Plafond de déficit contre chèques : choisissez votre camp.' },
  { a: 'education_reform', b: 'innovation_fund', kind: 'synergie', tip: 'Le pipeline savoir → innovation : productivité technologique maximale.' },
  { a: 'health_coverage', b: 'purchasing_power_bonus', kind: 'synergie', tip: 'Soins + pouvoir d\'achat : le double bouclier populaire.' },
  { a: 'food_sovereignty', b: 'civic_service', kind: 'synergie', tip: 'Cohésion nationale : assiettes pleines et lien social.' },
  { a: 'green_transition', b: 'innovation_fund', kind: 'synergie', tip: 'Technologies vertes : efficacité énergétique et innovation se renforcent.' },
];

/** Chips d'effets lisibles depuis les modificateurs de la loi. */
function effectChips(l: LawDef): { label: string; good: boolean }[] {
  const m = l.modifiers;
  const out: { label: string; good: boolean }[] = [];
  if (m.popularity) out.push({ label: `popularité ${m.popularity > 0 ? '+' : ''}${m.popularity.toFixed(2)}/sem`, good: m.popularity > 0 });
  if (m.stability) out.push({ label: `stabilité ${m.stability > 0 ? '+' : ''}${m.stability.toFixed(2)}/sem`, good: m.stability > 0 });
  if (m.productivity) out.push({ label: `productivité ${m.productivity > 0 ? '+' : ''}${(m.productivity * 100).toFixed(0)} %`, good: m.productivity > 0 });
  if (m.growth) out.push({ label: `croissance ${m.growth > 0 ? '+' : ''}${m.growth.toFixed(1)}`, good: m.growth > 0 });
  if (m.consumption) out.push({ label: `consommation ${m.consumption > 0 ? '+' : ''}${(m.consumption * 100).toFixed(0)} %`, good: m.consumption > 0 });
  if (m.inflation) out.push({ label: `inflation ${m.inflation > 0 ? '+' : ''}${m.inflation.toFixed(1)}`, good: m.inflation < 0 });
  if (m.unemployment) out.push({ label: `chômage ${m.unemployment > 0 ? '+' : ''}${m.unemployment.toFixed(1)}`, good: m.unemployment < 0 });
  if (m.resourceEfficiency) out.push({ label: `efficacité +${(m.resourceEfficiency * 100).toFixed(0)} %`, good: true });
  for (const [k, v] of Object.entries(m.sectorBoost ?? {})) {
    if (v) out.push({ label: `${k} +${((v as number) * 100).toFixed(0)} %`, good: true });
  }
  return out;
}

export function LawsPage() {
  const { countryId, user } = useAuth();
  const { myCountry, meta } = useGame();
  const [pending, setPending] = useState<Pending | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'free' | 'popular' | 'risky' | 'costly'>('all');
  const [search, setSearch] = useState('');
  const [sim, setSim] = useState<Set<string>>(new Set());

  const c = myCountry && myCountry.id === countryId ? myCountry : null;
  const isMe = !!c && c.controller.kind === 'player' && c.controller.userId === user?.id;
  const enactedIds = useMemo(() => new Set((c?.laws ?? []).map((l) => l.lawId)), [c]);

  /* -------- Agrégats du paquet EN VIGUEUR -------- */
  const activeAgg = useMemo(() => {
    const agg = { costPct: 0, popDay: 0, prod: 0, stab: 0, infl: 0, growth: 0 };
    if (!c) return agg;
    for (const law of c.laws) {
      const def = LAWS.find((l) => l.id === law.lawId);
      if (!def) continue;
      agg.costPct += def.annualCostPctGdp;
      agg.popDay += def.modifiers.popularity ?? 0; // somme de deltas hebdo
      agg.prod += def.modifiers.productivity ?? 0;
      agg.stab += def.modifiers.stability ?? 0;
      agg.infl += def.modifiers.inflation ?? 0;
      agg.growth += def.modifiers.growth ?? 0;
    }
    return agg;
  }, [c]);

  /* -------- Agrégats du SIMULATEUR (lois basculées) -------- */
  const simAgg = useMemo(() => {
    const agg = { costPct: 0, popWeek: 0, prod: 0, stab: 0, infl: 0, growth: 0, count: 0 };
    for (const id of sim) {
      const def = LAWS.find((l) => l.id === id);
      if (!def) continue;
      agg.count++;
      agg.costPct += def.annualCostPctGdp;
      agg.popWeek += def.modifiers.popularity ?? 0;
      agg.prod += (def.modifiers.productivity ?? 0) * 100;
      agg.stab += def.modifiers.stability ?? 0;
      agg.infl += def.modifiers.inflation ?? 0;
      agg.growth += def.modifiers.growth ?? 0;
    }
    return agg;
  }, [sim]);

  if (!c) {
    return (
      <div className="page">
        <SectionTitle>Lois & Réformes</SectionTitle>
        <GlassCard>
          <EmptyState title="Aucune nation dirigée" hint="Adoptez des lois qui transforment durablement votre pays." icon="📜" />
          <div className="row mt-16" style={{ justifyContent: 'center' }}>
            <Link className="btn btn-primary" to="/countries">Choisir ma nation</Link>
          </div>
        </GlassCard>
      </div>
    );
  }

  const gdp = c.economy.gdp;
  const simCostMd = (gdp * simAgg.costPct) / 100;
  const simBalanceAfter = c.economy.balance - simCostMd;

  const laws = LAWS.map((law) => {
    const annualCost = (gdp * law.annualCostPctGdp) / 100;
    const popWeek = law.modifiers.popularity ?? 0; // delta HEBDO (le moteur divise par 7 pour le quotidien)
    const tags: string[] = [];
    if (annualCost <= 0.01) tags.push('free'); else tags.push('costly');
    if (popWeek > 0) tags.push('popular');
    if (popWeek < 0) tags.push('risky');
    if (enactedIds.has(law.id)) tags.push('active');
    return { law, annualCost, popWeek, tags, active: enactedIds.has(law.id), cat: lawCat(law.id) };
  });

  const filtered = laws.filter((l) => {
    if (filter !== 'all' && !l.tags.includes(filter)) return false;
    if (search && !`${l.law.name} ${l.law.description}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const toggleSim = (id: string): void => {
    setSim((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 6) next.add(id);
      return next;
    });
  };

  return (
    <div className="page">
      {/* ---------------- HERO ---------------- */}
      <div className="law-hero anim-fade-up">
        <span className="law-hero-quill" aria-hidden>🪶</span>
        <span className="law-hero-seal" aria-hidden>📜</span>
        <div className="law-hero-content">
          <h1 style={{ margin: 0 }}>Lois & Réformes — {c.name}</h1>
          <p className="small" style={{ margin: '6px 0 0', color: 'rgba(255,255,255,0.78)', maxWidth: 680 }}>
            Chaque loi transforme durablement votre pays : coûts, popularité, productivité, stabilité.
            <strong> Simulez un paquet législatif</strong> avant de le voter — le sceau ne se pose qu'une fois.
            {meta && <> · {worldDate(meta.day)}</>}
          </p>
        </div>
        <div className="law-hero-kpis">
          <div className="law-kpi">
            <span className="tiny muted">En vigueur</span>
            <strong><AnimatedNumber value={c.laws.length} format={(v) => `${v.toFixed(0)}/6`} duration={500} /></strong>
          </div>
          <div className="law-kpi">
            <span className="tiny muted">Coût du paquet</span>
            <strong style={{ color: activeAgg.costPct > 0 ? 'var(--warn)' : 'var(--good)' }}>
              <AnimatedNumber value={(gdp * activeAgg.costPct) / 100} format={(v) => formatMoney(v)} duration={700} />/an
            </strong>
          </div>
          <div className="law-kpi">
            <span className="tiny muted">Popularité</span>
            <strong style={{ color: activeAgg.popDay >= 0 ? 'var(--good)' : 'var(--danger)' }}>
              {activeAgg.popDay >= 0 ? '+' : ''}{(activeAgg.popDay * 7).toFixed(1)}/sem
            </strong>
          </div>
          <div className="law-kpi">
            <span className="tiny muted">Productivité</span>
            <strong style={{ color: activeAgg.prod >= 0 ? 'var(--good)' : 'var(--danger)' }}>
              {activeAgg.prod >= 0 ? '+' : ''}{(activeAgg.prod * 100).toFixed(0)} %
            </strong>
          </div>
        </div>
      </div>

      {/* ---------------- Humeur du peuple ---------------- */}
      <GlassCard className="mt-16 anim-fade-up">
        <div className="row-between wrap" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 10 }}>
            <span style={{ fontSize: '1.5rem' }} aria-hidden>🫀</span>
            <div>
              <strong>Humeur du peuple</strong>
              <div className="tiny muted">Le cœur de votre mandat : sous 35 % trop longtemps, le gouvernement tombe.</div>
            </div>
          </div>
          <div className="row" style={{ gap: 14, alignItems: 'baseline' }}>
            <span style={{ fontSize: '1.9rem', fontWeight: 900, color: c.popularity >= 55 ? 'var(--good)' : c.popularity >= 35 ? 'var(--warn)' : 'var(--danger)' }}>
              <AnimatedNumber value={c.popularity} format={(v) => `${v.toFixed(0)} %`} duration={900} />
            </span>
            <Delta value={c.mandate.popularityTrend} />
          </div>
        </div>
        <div className="law-mood mt-8" role="img" aria-label={`Popularité ${c.popularity.toFixed(0)} %`}>
          <div className="law-mood-track" />
          <div className="law-mood-marker" style={{ left: `calc(${Math.min(100, Math.max(0, c.popularity))}% - 9px)` }} />
          <span className="law-mood-zone law-mood-danger" style={{ width: '35%' }} />
          <span className="law-mood-zone law-mood-warn" style={{ left: '35%', width: '20%' }} />
          <span className="law-mood-zone law-mood-good" style={{ left: '55%', width: '45%' }} />
        </div>
        <div className="row-between tiny muted mt-8">
          <span>0 % — chute du gouvernement</span>
          <span>35 % — seuil de risque</span>
          <span>55 %+ — confort politique</span>
        </div>
      </GlassCard>

      {/* ---------------- Simulateur ---------------- */}
      <GlassCard className={`law-sim mt-16 anim-fade-up ${sim.size > 0 ? 'law-sim-on' : ''}`}>
        <div className="row-between wrap" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            <span style={{ fontSize: '1.4rem' }} aria-hidden>🧪</span>
            <div>
              <strong>Simulateur législatif</strong>
              <div className="tiny muted">Basculez des lois sur leurs cartes (interrupteur) : effets agrégés calculés en direct, sans rien voter.</div>
            </div>
          </div>
          {sim.size > 0 && (
            <button className="btn btn-sm" onClick={() => setSim(new Set())}>Vider le simulateur</button>
          )}
        </div>
        {sim.size === 0 ? (
          <div className="tiny muted mt-8">
            Paquet vide — ajoutez jusqu'à 6 lois depuis les interrupteurs des cartes ci-dessous pour voir leur coût et leurs effets cumulés AVANT de les voter.
          </div>
        ) : (
          <div className="law-sim-grid mt-8">
            <div className="law-sim-cell">
              <span className="tiny muted">Coût annuel</span>
              <strong style={{ color: simCostMd > 0 ? 'var(--warn)' : 'var(--good)' }}>
                <AnimatedNumber value={simCostMd} format={(v) => formatMoney(v)} duration={600} />
              </strong>
              <span className="tiny muted">{simAgg.costPct.toFixed(2)} % du PIB</span>
            </div>
            <div className="law-sim-cell">
              <span className="tiny muted">Popularité</span>
              <strong style={{ color: simAgg.popWeek >= 0 ? 'var(--good)' : 'var(--danger)' }}>
                <AnimatedNumber value={simAgg.popWeek} format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`} duration={600} />/sem
              </strong>
              <span className="tiny muted">effet cumulé des lois simulées</span>
            </div>
            <div className="law-sim-cell">
              <span className="tiny muted">Productivité</span>
              <strong style={{ color: simAgg.prod >= 0 ? 'var(--good)' : 'var(--danger)' }}>
                <AnimatedNumber value={simAgg.prod} format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} %`} duration={600} />
              </strong>
              <span className="tiny muted">stabilité {simAgg.stab >= 0 ? '+' : ''}{simAgg.stab.toFixed(1)}/sem</span>
            </div>
            <div className="law-sim-cell">
              <span className="tiny muted">Croissance</span>
              <strong style={{ color: simAgg.growth >= 0 ? 'var(--good)' : 'var(--danger)' }}>
                <AnimatedNumber value={simAgg.growth} format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`} duration={600} />
              </strong>
              <span className="tiny muted">inflation {simAgg.infl >= 0 ? '+' : ''}{simAgg.infl.toFixed(1)}</span>
            </div>
            <div className="law-sim-cell">
              <span className="tiny muted">Solde après paquet</span>
              <strong style={{ color: simBalanceAfter >= 0 ? 'var(--good)' : 'var(--danger)' }}>
                <AnimatedNumber value={simBalanceAfter} format={(v) => `${v >= 0 ? '+' : ''}${formatMoney(v)}`} duration={600} />
              </strong>
              <span className="tiny muted">
                {simBalanceAfter >= 0 ? 'tenable ✓' : simBalanceAfter > -gdp * 0.03 ? 'déficit accru — prudence' : 'DANGEREUX : déficit profond'}
              </span>
            </div>
            <div className="law-sim-cell">
              <span className="tiny muted">Place restante</span>
              <strong>{6 - c.laws.length - sim.size >= 0 ? 6 - c.laws.length - sim.size : 0} slot(s)</strong>
              <span className="tiny muted">max 6 lois en vigueur</span>
            </div>
          </div>
        )}
      </GlassCard>

      {/* ---------------- Filtres + recherche ---------------- */}
      <SectionCard
        className="mt-16"
        icon="🧠"
        title="Comment fonctionnent les lois"
        desc="Une loi votée s'applique IMMÉDIATEMENT et durablement : effets permanents + coût annuel réellement prélevé sur votre budget."
      >
        <ul className="explain-list">
          <li>💰 <span><b>Coût annuel réel</b> : le pourcentage de PIB affiché est prélevé chaque jour par le moteur (solde budgétaire impacté) — pas un simple affichage.</span></li>
          <li>🧪 <span><b>Simulateur législatif</b> : activez la bascule pour empiler des lois virtuellement et voir coût + effets AVANT de voter.</span></li>
          <li>❤️ <span><b>Popularité & stabilité</b> : certaines lois ravissent le peuple (santé, éducation), d'autres le fâchent (dérégulation) — arbitrez.</span></li>
          <li>♻️ <span><b>Abroger</b> rend le budget mais coûte 1 à 2 points de popularité : les réforme s'annulent rarement sans trace.</span></li>
        </ul>
      </SectionCard>

      <div className="trade-section-head mt-24">
        <div className="row wrap" style={{ gap: 6 }}>
          {([['all', `Toutes (${laws.length})`], ['active', `En vigueur (${c.laws.length})`], ['popular', 'Populaires'], ['risky', 'Impopulaires'], ['free', 'Gratuites'], ['costly', 'Payantes']] as const).map(([id, label]) => (
            <button key={id} className={`assist-cat ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
        <input
          className="input"
          style={{ maxWidth: 260, minHeight: 34, padding: '6px 12px' }}
          placeholder="Rechercher une loi…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Rechercher une loi"
        />
      </div>

      {/* ---------------- Cartes de lois ---------------- */}
      <div className="law-grid stagger">
        {filtered.map((l) => {
          const cat = LAW_CATS[l.cat];
          const inSim = sim.has(l.law.id);
          const slotsLeft = 6 - c.laws.length;
          const lockSlots = !l.active && slotsLeft <= 0;
          const interactions = INTERACTIONS.filter((i) => {
            const other = i.a === l.law.id ? i.b : i.b === l.law.id ? i.a : null;
            if (!other) return false;
            return enactedIds.has(other) || sim.has(other);
          });
          return (
            <div key={l.law.id} className={`law-card ${l.active ? 'law-active' : ''} ${inSim ? 'law-insim' : ''}`} style={{ '--lawcat': cat.color } as React.CSSProperties}>
              {l.active && <span className="law-seal" aria-hidden>🔏</span>}
              <div className="row-between">
                <div className="row" style={{ gap: 10 }}>
                  <span className="law-ico" aria-hidden>{LAW_ICONS[l.law.id] ?? '📜'}</span>
                  <div>
                    <strong>{l.law.name}</strong>
                    <div className="tiny" style={{ color: cat.color, fontWeight: 700 }}>{cat.label}</div>
                  </div>
                </div>
                {l.active ? <Badge tone="good">EN VIGUEUR</Badge> : inSim ? <Badge tone="violet">SIMULÉE</Badge> : <Badge tone="neutral">DISPONIBLE</Badge>}
              </div>
              <p className="tiny muted mt-8" style={{ minHeight: 30 }}>{l.law.description}</p>

              <div className="row wrap mt-8" style={{ gap: 6 }}>
                {effectChips(l.law).map((ch, i) => (
                  <span key={i} className={`law-chip ${ch.good ? 'good' : 'bad'}`}>{ch.label}</span>
                ))}
                <span className={`law-chip ${l.annualCost <= 0.01 ? 'good' : 'cost'}`}>
                  {l.annualCost <= 0.01 ? 'coût nul' : `${formatMoney(l.annualCost)}/an`}
                </span>
              </div>

              {interactions.map((it, i) => (
                <div key={i} className={`law-inter ${it.kind}`} title={it.tip}>
                  {it.kind === 'synergie' ? '✨' : '⚡'} {it.tip}
                </div>
              ))}

              <div className="row-between mt-8 wrap" style={{ gap: 8 }}>
                <label className="law-switch" title="Ajouter/retirer du simulateur">
                  <input type="checkbox" checked={inSim} disabled={l.active} onChange={() => toggleSim(l.law.id)} />
                  <span className="law-switch-track" aria-hidden><span className="law-switch-thumb" /></span>
                  <span className="tiny muted">simuler</span>
                </label>
                {isMe && (
                  l.active ? (
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => setPending({ params: { type: 'repeal_law', lawId: l.law.id }, title: `Abroger « ${l.law.name} »`, description: 'Les effets cessent immédiatement ; le coût annuel est économisé.' })}
                    >
                      Abroger
                    </button>
                  ) : (
                    <button
                      className="btn btn-sm btn-primary btn3d"
                      disabled={lockSlots}
                      title={lockSlots ? '6 lois déjà en vigueur : abrogez-en une d\'abord' : `Adopter ${l.law.name}`}
                      onClick={() => setPending({ params: { type: 'enact_law', lawId: l.law.id }, title: `Adopter « ${l.law.name} »`, description: `Coût ${formatMoney(l.annualCost)}/an. Effets permanents tant que la loi est en vigueur.` })}
                    >
                      🖋️ Adopter
                    </button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <GlassCard className="mt-16">
          <EmptyState title="Aucune loi ne correspond" hint="Changez de filtre ou videz la recherche." icon="🔎" />
        </GlassCard>
      )}

      {/* ---------------- Rappel pédagogique ---------------- */}
      <GlassCard className="mt-24 anim-fade-up">
        <div className="row wrap" style={{ gap: 14, alignItems: 'center' }}>
          <span style={{ fontSize: '1.6rem' }} aria-hidden>🎓</span>
          <div className="flex1" style={{ minWidth: 240 }}>
            <strong>Bien légiférer</strong>
            <div className="tiny muted">
              6 lois maximum en vigueur. Une loi coûte chaque année son % de PIB et s'applique tant qu'elle n'est pas abrogée.
              Les lois populaires (festivals, primes, service civique…) regagnent le peuple semaine après semaine — mais se paient.
              Le simulateur agrège coût et effets : visez un paquet que votre solde budgétaire encaisse.
              <InfoTip text="Popularité < 35 % pendant 72 jours = chute du gouvernement. Les lois à popularité positive sont votre meilleur levier de redressement, avec les budgets social/santé et les baisses d'impôts." />
            </div>
          </div>
          <Link className="btn btn-sm" to="/game/politics">🏛️ Budgets & fiscalité</Link>
        </div>
      </GlassCard>

      {pending && (
        <ActionModal
          countryId={c.id}
          params={pending.params}
          title={pending.title}
          description={pending.description}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
