/**
 * GEOPOLIS — Politique v3 : refonte complète, hyper animée.
 * - Hero de régime : blason animé (anneau rotatif, glow pulsé), devise,
 *   président, ancienneté, badge lune de miel / gueule de bois.
 * - Module CHANGEMENT DE RÉGIME : la « volonté du peuple » (revendications
 *   calculées depuis l'état réel) détermine l'ALIGNEMENT de chaque régime ;
 *   changer vers un régime aligné donne un boost immédiat de popularité ET
 *   une lune de miel (popularité + croissance pendant 30 jours). Contre la
 *   volonté du peuple : malus. Cooldown 90 jours, stabilité ≥ 25 requise.
 * - Cartes de régimes : effets permanents en chips, jauge d'alignement
 *   animée, badge AU POUVOIR, bouton Proclamer (modale serveur).
 * - Sections fiscales/monétaire/douanes/budget conservées et restylées
 *   (sliders animés, cartes verre, stagger), colonne popularité/mandat/social.
 * Tout est synchronisé temps réel (push country_update après chaque action).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { REGIMES, REGIME_MAP, SPENDING_SECTORS, demandSeverities, regimeAlignment, worldDate } from 'shared';
import type { ActionParams, DemandId, RegimeType, SpendingKey } from 'shared';
import { formatMoney } from 'shared';
import { useAuth } from '../../state/AuthContext.js';
import { useGame } from '../../state/GameContext.js';
import { ActionModal } from '../../components/ActionModal.js';
import { InfoTip } from '../../components/InfoTip.js';
import { AnimatedNumber, Badge, Delta, EmptyState, GlassCard, ProgressBar, SectionCard, SectionTitle, StatCard } from '../../components/ui.js';
import { Sparkline } from '../../components/Charts.js';

const SPENDING_TIPS: Record<string, string> = {
  health: "Hôpitaux, soins, espérance de vie. ↑ = niveau de vie & popularité ↑, mais coût budgétaire.",
  education: "Écoles & universités. ↑ = productivité future et capacité technologique ↑ (effet progressif).",
  transport: "Routes, rail, ports. ↑ = logistique et commerce intérieur ↑.",
  energy: "Réseau & centrales. ↑ = production et distribution d'énergie ↑, moins de pénuries.",
  industry: "Soutien industriel. ↑ = capacité industrielle et emploi ↑.",
  agriculture: "Soutien agricole. ↑ = production alimentaire ↑, sécurité des stocks.",
  research: "R&D publique. ↑ = innovation, production technologique et croissance potentielle ↑.",
  social: "Aides & filets sociaux. ↑ = popularité et stabilité ↑, surtout en période de chômage.",
};

const DEMAND_META: Record<DemandId, { icon: string; label: string }> = {
  jobs: { icon: '💼', label: 'Emploi pour tous' },
  prices: { icon: '🛒', label: 'Pouvoir d’achat' },
  tax: { icon: '🧾', label: 'Moins d’impôts' },
  health: { icon: '🏥', label: 'Mieux se soigner' },
  education: { icon: '🎓', label: 'École & universités' },
  housing: { icon: '🏠', label: 'Se loger décemment' },
  social: { icon: '🤲', label: 'Filet social' },
  food: { icon: '🌾', label: 'Assurance alimentaire' },
  energy: { icon: '⚡', label: 'Énergie abondante' },
  change: { icon: '🗳️', label: 'Changer de cap' },
  calm: { icon: '🕊️', label: 'Stabilité & sécurité' },
};

interface PendingAction { params: ActionParams; title: string; description?: string }

export function PoliticsPage() {
  const { countryId, user } = useAuth();
  const { myCountry, meta } = useGame();
  const c = myCountry && myCountry.id === countryId ? myCountry : null;
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [draftSpending, setDraftSpending] = useState<Partial<Record<SpendingKey, number>>>({});
  const [draftTax, setDraftTax] = useState<number | null>(null);
  const [draftCorp, setDraftCorp] = useState<number | null>(null);
  const [draftRate, setDraftRate] = useState<number | null>(null);
  const [draftTariff, setDraftTariff] = useState<number | null>(null);
  const [partnerSel, setPartnerSel] = useState<string>('');
  const [draftPartnerTariff, setDraftPartnerTariff] = useState<number | null>(null);

  const demands = useMemo(() => {
    if (!c) return [] as { id: DemandId; sev: number }[];
    const sev = demandSeverities(c);
    return (Object.entries(sev) as [DemandId, number][])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, v]) => ({ id, sev: v }));
  }, [c]);

  if (!c) {
    return (
      <div className="page">
        <SectionTitle>Politique</SectionTitle>
        <GlassCard>
          <EmptyState title="Aucune nation dirigée" hint="Prenez le pouvoir pour voter les lois, fixer la fiscalité… et changer de régime." icon="🏛" />
          <div className="row mt-16" style={{ justifyContent: 'center' }}>
            <Link className="btn btn-primary" to="/countries">Choisir ma nation</Link>
          </div>
        </GlassCard>
      </div>
    );
  }

  const isPlayer = !!c && c.controller.kind === 'player' && c.controller.userId === user?.id;
  const day = meta?.day ?? 0;
  const regime = REGIME_MAP[c.regime];
  const honey = c.regimeHoneymoon;
  const honeyLeft = honey ? Math.max(0, honey.untilDay - day) : 0;
  const regimeCooldownUntil = c.actionCooldowns['change_regime'] ?? 0;
  const regimeLocked = regimeCooldownUntil > day;

  const spendingValue = (k: SpendingKey) => draftSpending[k] ?? c.policy.spending[k];
  const taxValue = draftTax ?? c.policy.taxRate;
  const corpValue = draftCorp ?? c.policy.corporateTax;
  const rateValue = draftRate ?? c.policy.interestRate;

  return (
    <div className="page">
      {/* ---------------- HERO DE RÉGIME ---------------- */}
      <div className="pol-hero anim-fade-up">
        <div className="pol-crest" aria-hidden>
          <span className="pol-crest-ring" />
          <span className="pol-crest-ring pol-crest-ring2" />
          <span className="pol-crest-icon">{regime?.icon ?? '🏛️'}</span>
        </div>
        <div className="pol-hero-main">
          <div className="row wrap" style={{ gap: 10, alignItems: 'baseline' }}>
            <h1 style={{ margin: 0 }}>{c.regime}</h1>
            <Badge tone="violet">{regime?.tagline}</Badge>
          </div>
          <p className="small" style={{ margin: '6px 0 0', color: 'rgba(255,255,255,0.75)', fontStyle: 'italic', maxWidth: 640 }}>
            « {regime?.motto} »
          </p>
          <div className="tiny muted mt-8">
            {c.name} · président {c.controller.presidentName} · régime en place depuis le jour {c.regimeSinceDay || 0}
            {meta && <> · {worldDate(meta.day)}</>}
          </div>
          {honey && honeyLeft > 0 && (
            <div className={`pol-honey ${honey.popularityDaily >= 0 ? 'good' : 'bad'} anim-scale-in`}>
              {honey.popularityDaily >= 0 ? '🍯 Lune de miel' : '🌩️ Gueule de bois'} : {honey.popularityDaily >= 0 ? '+' : ''}{honey.popularityDaily.toFixed(2)} pop/j et {honey.growthDelta >= 0 ? '+' : ''}{honey.growthDelta.toFixed(2)} croissance · encore {honeyLeft} j
            </div>
          )}
        </div>
        <div className="pol-hero-kpis">
          <div className="law-kpi">
            <span className="tiny muted">Alignement peuple</span>
            <strong style={{ color: 'var(--accent-cyan)' }}>
              <AnimatedNumber value={regimeAlignment(c, c.regime) * 100} format={(v) => `${v.toFixed(0)} %`} duration={800} />
            </strong>
          </div>
          <div className="law-kpi">
            <span className="tiny muted">Croissance régime</span>
            <strong style={{ color: (regime?.effects.growthDelta ?? 0) >= 0 ? 'var(--good)' : 'var(--danger)' }}>
              {(regime?.effects.growthDelta ?? 0) >= 0 ? '+' : ''}{(regime?.effects.growthDelta ?? 0).toFixed(2)}
            </strong>
          </div>
          <div className="law-kpi">
            <span className="tiny muted">Recettes</span>
            <strong>×{(regime?.effects.revenueMul ?? 1).toFixed(2)}</strong>
          </div>
        </div>
      </div>

      <SectionCard
        className="mt-16"
        icon="🧠"
        title="Comment fonctionne votre vie politique"
        desc="Popularité, stabilité, mandat et régime : quatre jauges liées qui décident de la durée de votre gouvernement."
      >
        <ul className="explain-list">
          <li>❤️ <span><b>Popularité sous 35 %</b> pendant 72 jours = chute du gouvernement (un IA assure la succession, l'État continue). Avertissements progressifs dès 28 jours.</span></li>
          <li>️ <span><b>Régimes politiques</b> : 6 régimes à effets PERMANENTS (croissance, recettes fiscales, opinion). L'alignement avec les revendications RÉELLES du peuple déclenche lune de miel ou gueule de bois (30 jours).</span></li>
          <li>💰 <span><b>Fiscalité & budgets</b> : recettes = impôts + douanes ; dépenses = budgets sectoriels + entretien + intérêts de la dette. Le solde rejoint (ou creuse) votre trésorerie chaque jour.</span></li>
          <li>🛡️ <span><b>Stabilité sous 25</b> : changement de régime impossible ; cooldown de 90 jours entre deux transitions.</span></li>
        </ul>
      </SectionCard>

      {/* ---------------- KPIs ---------------- */}
      <div className="grid grid-4 mt-16 stagger">
        <StatCard label="Popularité" value={c.popularity} format={(v) => `${v.toFixed(1)} %`} delta={c.mandate.popularityTrend} tone="var(--accent-pink)" icon={<InfoTip text="Sous 35 % pendant 72 jours : le gouvernement tombe. Les régimes alignés avec le peuple gagnent de l'opinion chaque jour." />} />
        <StatCard label="Stabilité" value={c.stability} format={(v) => `${v.toFixed(1)} %`} tone={c.stability >= 60 ? 'var(--good)' : 'var(--warn)'} icon={<InfoTip text="Chaque changement de régime coûte de la stabilité (transition). Sous 25 : changement de régime impossible." />} />
        <StatCard label="Risque politique" value={c.mandate.lowPopularityTicks} format={(v) => `${v.toFixed(0)}/72 j`} tone={c.mandate.risk === 'faible' ? 'var(--good)' : c.mandate.risk === 'modéré' ? 'var(--warn)' : 'var(--danger)'} icon={<InfoTip text={`Risque actuel : ${c.mandate.risk}. Jours passés sous le seuil critique de popularité.`} />} />
        <StatCard label="Solde budgétaire" value={c.economy.balance} format={(v) => `${v >= 0 ? '+' : ''}${formatMoney(v)}`} glide tone={c.economy.balance >= 0 ? 'var(--good)' : 'var(--danger)'} icon={<InfoTip text="Les régimes à recettes ×1,06/×1,08 remplissent davantage les caisses à fiscalité égale." />} />
      </div>

      {/* ---------------- VOLONTÉ DU PEUPLE + RÉGIMES ---------------- */}
      <div className="trade-section-head mt-24">
        <div className="row wrap" style={{ gap: 10 }}>
          <h2 style={{ margin: 0 }}>🗳️ La volonté du peuple & les régimes</h2>
          <InfoTip text="Les revendications ci-dessous sont calculées depuis l'état RÉEL du pays. Chaque régime écoute certaines demandes : son ALIGNEMENT est la part des revendications actuelles qu'il sait traiter. Proclamer un régime aligné (≥ 50 %) donne un boost immédiat de popularité et une lune de miel de 30 jours (popularité + croissance). Un régime imposé contre le peuple coûte popularité et stabilité. Cooldown : 90 jours." />
        </div>
        {regimeLocked && (
          <Badge tone="warn">🔒 Transition verrouillée jusqu'au jour {regimeCooldownUntil}</Badge>
        )}
      </div>

      <div className="pol-grid">
        {/* Volonté du peuple */}
        <GlassCard className="anim-fade-up">
          <h3 style={{ marginTop: 0 }}>📣 Ce que le peuple réclame</h3>
          {demands.length === 0 && (
            <div className="small" style={{ color: 'var(--good)' }}>🎉 Peuple satisfait : aucune revendication majeure — tous les régimes sont alignés à ~50 %.</div>
          )}
          <div className="col" style={{ gap: 10 }}>
            {demands.map((d, i) => {
              const regimesFor = REGIMES.filter((r) => r.affinities.includes(d.id));
              return (
                <div key={d.id} className="pol-demand anim-slide-right" style={{ animationDelay: `${i * 60}ms` }}>
                  <span className="pol-demand-ico" aria-hidden>{DEMAND_META[d.id].icon}</span>
                  <div className="flex1">
                    <div className="row-between">
                      <strong className="small">{DEMAND_META[d.id].label}</strong>
                      <span className="tiny mono" style={{ color: d.sev > 0.6 ? 'var(--danger)' : d.sev > 0.35 ? 'var(--warn)' : 'var(--good)' }}>
                        {(d.sev * 100).toFixed(0)} %
                      </span>
                    </div>
                    <div className="pol-demand-bar">
                      <div className="pol-demand-fill" style={{ width: `${Math.min(100, d.sev * 100)}%`, background: d.sev > 0.6 ? 'linear-gradient(90deg,#dc2626,#e0705a)' : d.sev > 0.35 ? 'linear-gradient(90deg,#d97706,#e0b050)' : 'linear-gradient(90deg,#059669,#3ec9a7)' }} />
                    </div>
                    <div className="tiny muted">
                      Écouté par : {regimesFor.map((r) => `${r.icon} ${r.id}`).join(' · ') || '—'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>

        {/* Cartes de régimes */}
        <div className="pol-regimes">
          {REGIMES.map((r, i) => {
            const align = regimeAlignment(c, r.id);
            const isCurrent = r.id === c.regime;
            const better = align - regimeAlignment(c, c.regime);
            return (
              <div key={r.id} className={`regime-card ${isCurrent ? 'regime-current' : ''} anim-fade-up`} style={{ animationDelay: `${i * 70}ms`, '--reg': isCurrent ? 'var(--good)' : align >= 0.5 ? 'var(--accent-cyan)' : 'var(--warn)' } as React.CSSProperties}>
                <div className="row-between">
                  <div className="row" style={{ gap: 10 }}>
                    <span className="regime-ico" aria-hidden>{r.icon}</span>
                    <div>
                      <strong>{r.id}</strong>
                      <div className="tiny muted">{r.tagline}</div>
                    </div>
                  </div>
                  {isCurrent ? <Badge tone="good">AU POUVOIR</Badge> : align >= 0.5 ? <Badge tone="info">PLÉBISCITÉ {Math.round(align * 100)} %</Badge> : <Badge tone="neutral">{Math.round(align * 100)} %</Badge>}
                </div>

                <div className="pol-align mt-8" role="img" aria-label={`Alignement ${r.id} : ${Math.round(align * 100)} %`}>
                  <div className="pol-align-bar">
                    <div className="pol-align-fill" style={{ width: `${Math.max(3, align * 100)}%` }} />
                    <span className="pol-align-mid" aria-hidden />
                  </div>
                  <span className="tiny mono" style={{ fontWeight: 800 }}>{(align * 100).toFixed(0)} %</span>
                </div>

                <div className="row wrap mt-8" style={{ gap: 6 }}>
                  <span className={`law-chip ${r.effects.growthDelta >= 0 ? 'good' : 'bad'}`}>croissance {r.effects.growthDelta >= 0 ? '+' : ''}{r.effects.growthDelta.toFixed(2)}</span>
                  <span className={`law-chip ${r.effects.revenueMul >= 1 ? 'good' : 'bad'}`}>recettes ×{r.effects.revenueMul.toFixed(2)}</span>
                  <span className={`law-chip ${r.effects.popularityDaily >= 0 ? 'good' : 'bad'}`}>pop {(r.effects.popularityDaily * 7).toFixed(2)}/sem</span>
                  <span className={`law-chip ${r.effects.stabilityDaily >= 0 ? 'good' : 'bad'}`}>stabilité {(r.effects.stabilityDaily * 7).toFixed(2)}/sem</span>
                </div>

                {!isCurrent && isPlayer && (
                  <div className="row-between mt-8 wrap" style={{ gap: 8 }}>
                    <span className="tiny muted">
                      {better > 0.05 ? `✅ Mieux écouté que votre régime (+${Math.round(better * 100)} pts)` : better < -0.05 ? `⚠️ Moins aligné que votre régime (${Math.round(better * 100)} pts)` : '≈ autant aligné que votre régime'}
                    </span>
                    <button
                      className="btn btn-sm btn-primary btn3d"
                      disabled={regimeLocked || c.stability < 25}
                      title={regimeLocked ? `Verrouillé jusqu'au jour ${regimeCooldownUntil}` : c.stability < 25 ? 'Stabilité < 25 : transition impossible' : `Proclamer ${r.id}`}
                      onClick={() => setPending({
                        params: { type: 'change_regime', regime: r.id as RegimeType },
                        title: `Proclamer ${r.icon} ${r.id}`,
                        description: `Transition historique : coût immédiat en stabilité, boost ou malus selon l'alignement avec le peuple (${Math.round(align * 100)} %). Effets permanents ensuite. Cooldown 90 jours.`,
                      })}
                    >
                      🏛️ Proclamer
                    </button>
                  </div>
                )}
                {isCurrent && (
                  <div className="tiny muted mt-8">Votre régime actuel — ses effets permanents s'appliquent déjà (voir hero).</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------------- GOUVERNANCE QUOTIDIENNE ---------------- */}
      <div className="trade-section-head mt-24">
        <h2 style={{ margin: 0 }}>🎚️ Gouvernance quotidienne</h2>
        {!isPlayer && <Badge tone="info">GOUVERNEMENT IA — lecture seule</Badge>}
      </div>
      <div className="pol-gov-grid">
        <div className="col">
          <GlassCard className="anim-fade-up">
            <h3 style={{ marginTop: 0 }}>Fiscalité & politique monétaire</h3>
            <PolicySlider
              label="Fiscalité générale"
              tip="Impôts sur revenus & TVA. ↑ = recettes ↑ mais consommation, croissance et popularité ↓."
              unit="% du revenu"
              value={taxValue}
              min={0} max={60} step={0.5}
              disabled={!isPlayer}
              onChange={(v) => setDraftTax(v)}
              onApply={() => {
                if (draftTax === null || draftTax === c.policy.taxRate) return;
                setPending({ params: { type: 'set_tax', value: draftTax }, title: `Fiscalité : ${c.policy.taxRate.toFixed(1)} % → ${draftTax.toFixed(1)} %`, description: 'La fiscalité influence les recettes, la consommation, la popularité et la croissance.' });
              }}
              applied={draftTax !== null && draftTax !== c.policy.taxRate}
            />
            <PolicySlider
              label="Impôt sur les sociétés"
              tip="Taxation des entreprises. ↑ = recettes ↑ mais investissement privé ↓."
              unit="%"
              value={corpValue}
              min={0} max={60} step={0.5}
              disabled={!isPlayer}
              onChange={(v) => setDraftCorp(v)}
              onApply={() => {
                if (draftCorp === null || draftCorp === c.policy.corporateTax) return;
                setPending({ params: { type: 'set_corporate_tax', value: draftCorp }, title: `Impôt sociétés → ${draftCorp.toFixed(1)} %` });
              }}
              applied={draftCorp !== null && draftCorp !== c.policy.corporateTax}
            />
            <PolicySlider
              label="Taux directeur (banque centrale)"
              tip="↑ = inflation freinée mais croissance ralentie et dette plus chère. ↓ = l'inverse."
              unit="%"
              value={rateValue}
              min={0} max={15} step={0.25}
              disabled={!isPlayer}
              onChange={(v) => setDraftRate(v)}
              onApply={() => {
                if (draftRate === null || draftRate === c.policy.interestRate) return;
                setPending({ params: { type: 'set_interest_rate', value: draftRate }, title: `Taux directeur → ${draftRate.toFixed(2)} %`, description: 'Un taux plus haut freine l’inflation mais aussi la croissance.' });
              }}
              applied={draftRate !== null && draftRate !== c.policy.interestRate}
            />
          </GlassCard>

          <GlassCard className="anim-fade-up">
            <div className="row-between mb-8">
              <h3 style={{ margin: 0 }}>🛃 Douanes & tarifs frontaliers</h3>
              <InfoTip text="Le tarif général s'applique à toutes les importations. Vous pouvez fixer un tarif SPÉCIFIQUE par partenaire : utile pour protéger un secteur ou punir un rival — au risque de refroidir la relation." />
            </div>
            <PolicySlider
              label="Tarif douanier général"
              unit="%"
              value={draftTariff ?? c.policy.tariff}
              min={0} max={60} step={0.5}
              disabled={!isPlayer}
              onChange={(v) => setDraftTariff(v)}
              onApply={() => {
                if (draftTariff === null || draftTariff === c.policy.tariff) return;
                setPending({ params: { type: 'set_tariff', value: draftTariff }, title: `Tarif général → ${draftTariff.toFixed(1)} %`, description: 'S’applique à toutes les importations. Un tarif haut protège l’industrie mais renchérit les prix.' });
              }}
              applied={draftTariff !== null && draftTariff !== c.policy.tariff}
            />
            <div className="customs-row mt-8">
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="customs-partner">Partenaire visé</label>
                <select
                  id="customs-partner"
                  className="input"
                  value={partnerSel}
                  disabled={!isPlayer}
                  onChange={(e) => { setPartnerSel(e.target.value); setDraftPartnerTariff(null); }}
                >
                  <option value="">— choisir —</option>
                  {Object.entries(c.relations)
                    .sort((a, b) => b[1].tradeVolume - a[1].tradeVolume)
                    .map(([id, r]) => (
                      <option key={id} value={id}>
                        {id} · commerce {(r.tradeVolume * 1000).toFixed(0)} M €/j
                      </option>
                    ))}
                </select>
              </div>
              <div>
                {partnerSel ? (
                  <PolicySlider
                    label={`Tarif spécifique (actuel : ${(c.tariffOverrides[partnerSel] ?? c.policy.tariff).toFixed(1)} %)`}
                    unit="%"
                    value={draftPartnerTariff ?? (c.tariffOverrides[partnerSel] ?? c.policy.tariff)}
                    min={0} max={60} step={0.5}
                    disabled={!isPlayer}
                    onChange={(v) => setDraftPartnerTariff(v)}
                    onApply={() => {
                      if (draftPartnerTariff === null) return;
                      setPending({ params: { type: 'set_tariff', value: draftPartnerTariff, partnerId: partnerSel }, title: `Tarif frontalier spécifique → ${draftPartnerTariff.toFixed(1)} %` });
                    }}
                    applied={draftPartnerTariff !== null && draftPartnerTariff !== (c.tariffOverrides[partnerSel] ?? c.policy.tariff)}
                  />
                ) : (
                  <p className="tiny muted" style={{ margin: 0 }}>Choisissez un partenaire pour lui appliquer un tarif frontalier spécifique.</p>
                )}
              </div>
              <div className="col" style={{ gap: 6, minWidth: 170 }}>
                {Object.entries(c.tariffOverrides).length === 0 && <span className="tiny muted">Aucun tarif spécifique actif.</span>}
                {Object.entries(c.tariffOverrides).map(([id, v]) => (
                  <div key={id} className="row-between tiny">
                    <span>{id} : <strong className="mono">{v.toFixed(1)} %</strong></span>
                    <button
                      className="btn btn-sm btn-ghost"
                      disabled={!isPlayer}
                      onClick={() => setPending({ params: { type: 'set_tariff', value: c.policy.tariff, partnerId: id }, title: `Réinitialiser le tarif de ${id}` })}
                    >
                      Réinit.
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>

          <GlassCard className="anim-fade-up">
            <h3 style={{ marginTop: 0 }}>Budget de l'État (% du PIB)</h3>
            <p className="tiny muted">Dépenses totales : {formatMoney(c.economy.spending)}/an · Solde : <span className={c.economy.balance >= 0 ? 'delta-up' : 'delta-down'}>{c.economy.balance >= 0 ? '+' : ''}{formatMoney(c.economy.balance)}</span></p>
            {SPENDING_SECTORS.map((s) => (
              <PolicySlider
                key={s.key}
                label={s.name}
                hint={s.description}
                tip={SPENDING_TIPS[s.key]}
                unit="% PIB"
                value={spendingValue(s.key)}
                min={s.min} max={s.max} step={0.1}
                disabled={!isPlayer}
                onChange={(v) => setDraftSpending((prev) => ({ ...prev, [s.key]: v }))}
                onApply={() => {
                  const v = draftSpending[s.key];
                  if (v === undefined || v === c.policy.spending[s.key]) return;
                  setPending({ params: { type: 'set_spending', sector: s.key, value: v }, title: `Budget « ${s.name} » → ${v.toFixed(1)} % du PIB` });
                }}
                applied={draftSpending[s.key] !== undefined && draftSpending[s.key] !== c.policy.spending[s.key]}
              />
            ))}
          </GlassCard>
        </div>

        <div className="col">
          <GlassCard className="anim-fade-up">
            <h3 style={{ marginTop: 0 }}>Courbe de popularité</h3>
            <Sparkline data={c.series.slice(-90).map((s) => s.popularity)} color="#3ddc97" width={340} height={64} />
            <div className="row-between tiny muted mt-8">
              <span>90 derniers jours</span>
              <Delta value={c.mandate.popularityTrend} />
            </div>
            {isPlayer && (
              <div className="mt-8">
                <ProgressBar
                  label={`Mandat : ${c.mandate.lowPopularityTicks}/72 jours sous le seuil`}
                  value={c.mandate.lowPopularityTicks}
                  max={72}
                  tone={c.mandate.lowPopularityTicks > 48 ? 'danger' : c.mandate.lowPopularityTicks > 28 ? 'warn' : 'good'}
                />
              </div>
            )}
          </GlassCard>

          <GlassCard className="anim-fade-up law-cta">
            <div className="row-between">
              <div>
                <h3 style={{ margin: 0 }}>📜 Lois & Réformes</h3>
                <p className="tiny muted mt-8">
                  {c.laws.length}/6 lois en vigueur · le simulateur législatif vous aide à composer un paquet populaire.
                </p>
              </div>
              <Link className="btn btn-primary btn3d" to="/game/laws">Ouvrir l'onglet Lois</Link>
            </div>
          </GlassCard>

          <GlassCard className="anim-fade-up">
            <div className="row-between mb-8">
              <h3 style={{ margin: 0 }}>Indicateurs sociaux</h3>
              <InfoTip text="Niveau de vie, chômage inversé et indice de consommation : le ressenti concret de la population — la matière première des revendications." />
            </div>
            <ProgressBar label="Niveau de vie" value={c.economy.standardOfLiving} tone={c.economy.standardOfLiving >= 60 ? 'good' : 'warn'} />
            <div className="mt-8"><ProgressBar label="Emploi (chômage inversé)" value={100 - c.economy.unemployment * 4} tone={c.economy.unemployment < 7 ? 'good' : 'warn'} /></div>
            <div className="mt-8"><ProgressBar label="Consommation" value={c.economy.consumptionIndex} max={160} /></div>
          </GlassCard>
        </div>
      </div>

      {pending && (
        <ActionModal
          countryId={c.id}
          params={pending.params}
          title={pending.title}
          description={pending.description}
          onClose={() => {
            setPending(null);
            setDraftSpending({});
            setDraftTax(null);
            setDraftCorp(null);
            setDraftRate(null);
            setDraftTariff(null);
            setDraftPartnerTariff(null);
          }}
        />
      )}
    </div>
  );
}

function PolicySlider({
  label, value, min, max, step, unit, hint, tip, disabled, onChange, onApply, applied,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  hint?: string;
  tip?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
  onApply: () => void;
  applied?: boolean;
}) {
  return (
    <div className="pol-slider">
      <div className="row-between">
        <span className="small row" style={{ fontWeight: 600, gap: 6 }}>
          {label}
          {tip && <InfoTip text={tip} />}
        </span>
        <span className="row" style={{ gap: 8 }}>
          <span className="mono small" style={{ fontWeight: 800, color: applied ? 'var(--accent-violet)' : 'var(--text-0)' }}>
            {value.toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0)} {unit}
          </span>
          {applied && !disabled && (
            <button className="btn btn-sm btn-primary" onClick={onApply}>Appliquer</button>
          )}
        </span>
      </div>
      {hint && <div className="tiny muted">{hint}</div>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="pol-range"
      />
    </div>
  );
}
