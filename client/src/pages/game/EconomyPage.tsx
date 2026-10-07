/**
 * GEOPOLIS — Page Économie : PIB, croissance, inflation, chômage, dette,
 * budget, production, consommation, ressources, prix & marchés.
 * Tous les graphiques utilisent les séries réelles du moteur.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { RESOURCE_KEYS, RESOURCE_MAP } from 'shared';
import { formatMoney, formatPopulation } from 'shared';
import { useAuth } from '../../state/AuthContext.js';
import { useGame } from '../../state/GameContext.js';
import { AreaChartCard, BarChartCard, LineChartCard, Sparkline } from '../../components/Charts.js';
import { Badge, EmptyState, GlassCard, InfoTipCard, PageHeader, ProgressBar, SectionTitle, StatCard } from '../../components/ui.js';

const GROWTH_LABELS: Record<string, { label: string; tip: string }> = {
  base: { label: 'Potentiel structurel', tip: 'Investissement, productivité et éducation : le moteur de fond de votre croissance.' },
  commerce: { label: 'Commerce extérieur', tip: 'Excédent commercial et ouverture : vendre plus que vous n’achetez tire la croissance.' },
  inflation: { label: 'Frein : inflation', tip: 'Au-delà de 3 % d’inflation, chaque point rogne la croissance (pouvoir d’achat, incertitude).' },
  taux: { label: 'Frein : taux directeur', tip: 'Un taux directeur au-dessus de 3,5 % refroidit le crédit et l’investissement.' },
  penuries: { label: 'Frein : pénuries', tip: 'Pénuries de ressources et tension énergétique : usines ralenties, coûts subis.' },
  dette: { label: 'Frein : dette', tip: 'Au-delà de 100 % du PIB, la dette pèse (intérêts, confiance des marchés).' },
  evenements: { label: 'Événements & lois', tip: 'Chocs temporaires (booms, crises) et effets de vos lois en cours.' },
  regime: { label: 'Régime politique', tip: 'Effet permanent du régime en place + lune de miel (ou gueule de bois) temporaire après un changement de régime.' },
};

export function EconomyPage() {
  const { countryId } = useAuth();
  const { myCountry, market } = useGame();
  const c = myCountry && myCountry.id === countryId ? myCountry : null;

  const series = useMemo(() => {
    if (!c) return [];
    return c.series.map((s) => ({ ...s }));
  }, [c]);

  if (!c) {
    return (
      <div className="page">
        <SectionTitle>Économie</SectionTitle>
        <GlassCard>
          <EmptyState title="Aucune nation dirigée" hint="Choisissez un pays pour piloter son économie, ou explorez les économies du monde." icon="📈" />
          <div className="row mt-16" style={{ justifyContent: 'center' }}>
            <Link className="btn btn-primary" to="/countries">Choisir ma nation</Link>
            <Link className="btn" to="/game/world">Vue monde</Link>
          </div>
        </GlassCard>
      </div>
    );
  }

  const debtRatio = (c.economy.debt / Math.max(1, c.economy.gdp)) * 100;

  const sectorData = Object.entries(c.sectors).map(([k, s]) => ({ name: k, value: Math.round(s.output) }));

  const revenueBreakdown = [
    { name: 'Fiscalité', value: Math.round((c.economy.gdp * c.policy.taxRate * 0.55) / 100) },
    { name: 'Sociétés', value: Math.round((c.economy.gdp * c.policy.corporateTax * 0.25) / 100) },
    { name: 'Douanes', value: Math.max(0, Math.round(c.economy.revenue - (c.economy.gdp * (c.policy.taxRate * 0.55 + c.policy.corporateTax * 0.25)) / 100)) },
  ];
  const spendingBreakdown = [
    ...Object.entries(c.policy.spending).map(([k, v]) => ({ name: k, value: Math.round((c.economy.gdp * v) / 100) })),
    { name: 'intérêts', value: Math.round(c.economy.interestPaid) },
  ];

  return (
    <div className="page">
      <PageHeader
        icon="📈"
        title={`Économie — ${c.name}`}
        subtitle="PIB, croissance, inflation, dette et budget : tout ce que le moteur calcule chaque jour de monde, expliqué contribution par contribution. Les graphiques ci-dessous sont les séries RÉELLES du moteur (1 point = 1 jour de monde)."
        chips={<>
          <Badge tone={c.economy.growth >= 0 ? 'good' : 'danger'}>Croissance {c.economy.growth >= 0 ? '+' : ''}{c.economy.growth.toFixed(1)} %</Badge>
          <Badge tone={c.economy.balance >= 0 ? 'good' : 'danger'}>Solde {formatMoney(c.economy.balance)}/an</Badge>
          <Badge tone="info">Dette {debtRatio.toFixed(0)} % du PIB</Badge>
        </>}
        right={<span className="tiny muted">Séries issues du moteur (1 point = 1 jour de monde)</span>}
      />

      <div className="grid grid-4 stagger">
        <StatCard label="PIB" value={c.economy.gdp} format={(v) => formatMoney(v)} delta={c.economy.growth} tone="var(--accent-violet)" />
        <StatCard label="Croissance" value={c.economy.growth} format={(v) => `${v.toFixed(2)} %`} tone={c.economy.growth >= 0 ? 'var(--good)' : 'var(--danger)'} />
        <StatCard label="Inflation" value={c.economy.inflation} format={(v) => `${v.toFixed(1)} %`} tone={c.economy.inflation > 5 ? 'var(--warn)' : 'var(--accent-blue)'} />
        <StatCard label="Chômage" value={c.economy.unemployment} format={(v) => `${v.toFixed(1)} %`} tone={c.economy.unemployment > 9 ? 'var(--warn)' : 'var(--accent-blue)'} />
        <StatCard
          label="Solde budgétaire"
          value={c.economy.balance}
          format={(v) => `${v >= 0 ? '+' : ''}${formatMoney(v)}`}
          tone={c.economy.balance >= 0 ? 'var(--good)' : 'var(--danger)'}
          icon={
            <InfoTipCard
              label="Explication du solde budgétaire"
              text="Solde budgétaire (Md €/an) = RECETTES − DÉPENSES. Recettes : impôts (revenu, sociétés) et douanes sur les importations. Dépenses : budgets sectoriels, entretien des infrastructures, intérêts de la dette. Chaque jour, solde/365 alimente (positif) ou ponctionne (négatif) la trésorerie ; un déficit persistant creuse la dette quand la trésorerie est à zéro. Pour le faire MONTER : hausser la fiscalité ou les tarifs douaniers (arbitrage popularité/consommation), réduire les budgets sectoriels, rembourser la dette, soutenir la croissance (recettes ↑). Pour éviter qu'il DESCENDE : surveillez les intérêts (dette + taux), l'entretien des infrastructures et les budgets sectoriels. Les péages de vos routes commerciales vont directement dans la TRÉSORERIE (hors solde)."
            />
          }
        />
        <StatCard label="Dette / PIB" value={debtRatio} format={(v) => `${v.toFixed(0)} %`} tone={debtRatio > 90 ? 'var(--danger)' : 'var(--accent-cyan)'} />
        <StatCard label="Trésorerie" value={c.economy.cash} format={(v) => formatMoney(v)} tone="var(--accent-blue)" />
        <StatCard label="Productivité" value={c.economy.productivity} format={(v) => v.toFixed(0)} tone="var(--accent-pink)" />
      </div>

      {/* Explicateur de croissance */}
      {c.economy.growthBreakdown && (
        <GlassCard className="mt-16 anim-fade-up">
          <div className="row-between mb-8" style={{ flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>
              Pourquoi {c.economy.growth >= 0 ? '+' : ''}{c.economy.growth.toFixed(1)} % de croissance ?
            </h3>
            <InfoTipCard text="Le moteur décompose chaque jour la croissance cible en contributions positives (vert) et freins (rouge), en points de pourcentage. Agissez sur les plus gros freins : pénuries, inflation, dette, taux." />
          </div>
          <GrowthBreakdownBars bd={c.economy.growthBreakdown} />
        </GlassCard>
      )}

      <div className="grid grid-2 mt-16">
        <LineChartCard
          title="PIB (Md €)"
          data={series.map((s) => ({ day: s.day, value: s.gdp }))}
          color="#5b8cff"
        />
        <LineChartCard
          title="Inflation vs Chômage (%)"
          data={series.map((s) => ({ day: s.day, value: s.inflation }))}
          secondData={series.map((s) => ({ day: s.day, value: s.unemployment }))}
          color="#3ddc97"
          secondColor="#7fb2c9"
        />
        <AreaChartCard
          title="Solde budgétaire (Md €/an)"
          data={series.map((s) => ({ day: s.day, value: s.balance }))}
          color="#3ec9a7"
        />
        <AreaChartCard
          title="Dette (Md €)"
          data={series.map((s) => ({ day: s.day, value: s.debt }))}
          color="#5b8cff"
        />
      </div>

      <div className="grid grid-2 mt-16">
        <BarChartCard title="Production sectorielle (Md €/an)" data={sectorData} color="#8b5cf6" />
        <div className="col">
          <GlassCard>
            <h3>Recettes ({formatMoney(c.economy.revenue)}/an)</h3>
            {revenueBreakdown.map((r) => (
              <ProgressBar key={r.name} label={r.name} value={r.value} max={Math.max(...revenueBreakdown.map((x) => x.value), 1)} height={7} />
            ))}
          </GlassCard>
          <GlassCard>
            <h3>Dépenses ({formatMoney(c.economy.spending)}/an)</h3>
            {spendingBreakdown.map((r) => (
              <ProgressBar key={r.name} label={r.name} value={r.value} max={Math.max(...spendingBreakdown.map((x) => x.value), 1)} height={7} />
            ))}
          </GlassCard>
        </div>
      </div>

      {/* Ressources & marchés */}
      <GlassCard className="mt-16">
        <div className="row-between mb-16">
          <h3 style={{ margin: 0 }}>Ressources : production, consommation, stocks, prix</h3>
          <Link to="/game/trade" className="tiny">Commerce →</Link>
        </div>
        <div className="table-wrap">
          <table className="data responsive">
            <thead>
              <tr>
                <th>Ressource</th><th>Stock</th><th>Production/j</th><th>Consommation/j</th><th>Balance</th><th>Prix local</th><th>Prix mondial</th><th>24 j</th><th>Tendance</th>
              </tr>
            </thead>
            <tbody>
              {RESOURCE_KEYS.map((k) => {
                const r = c.resources[k];
                const m = market?.[k];
                const ratio = r.capacity > 0 ? (r.stock / r.capacity) * 100 : 0;
                const bal = r.production - r.consumption;
                return (
                  <tr key={k}>
                    <td data-label="Ressource">
                      <span className="row" style={{ gap: 8 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 3, background: RESOURCE_MAP[k].color, display: 'inline-block' }} aria-hidden />
                        <strong>{RESOURCE_MAP[k].name}</strong>
                      </span>
                    </td>
                    <td data-label="Stock">
                      <div style={{ minWidth: 110 }}>
                        <ProgressBar value={ratio} tone={ratio < 25 ? 'danger' : ratio < 45 ? 'warn' : 'good'} height={6} />
                        <span className="tiny muted mono">{ratio.toFixed(0)} % · {r.stock.toFixed(0)} {RESOURCE_MAP[k].unit}</span>
                      </div>
                    </td>
                    <td data-label="Production" className="mono">{r.production.toFixed(1)}</td>
                    <td data-label="Consommation" className="mono">{r.consumption.toFixed(1)}</td>
                    <td data-label="Balance" className={`mono ${bal >= 0 ? 'delta-up' : 'delta-down'}`}>{bal >= 0 ? '+' : ''}{bal.toFixed(1)}</td>
                    <td data-label="Prix local" className="mono">{r.price.toFixed(2)} €</td>
                    <td data-label="Prix mondial" className="mono">{m ? `${m.price.toFixed(2)} €` : '—'}</td>
                    <td data-label="24 j">
                      {m ? <span className={m.change24h >= 0 ? 'delta-up' : 'delta-down'}>{m.change24h >= 0 ? '+' : ''}{m.change24h.toFixed(1)} %</span> : '—'}
                    </td>
                    <td data-label="Tendance">
                      {m ? <Sparkline data={m.series.slice(-40)} color={m.change24h >= 0 ? '#3ec9a7' : '#e0705a'} width={80} height={26} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* Macro complémentaire */}
      <div className="grid grid-3 mt-16">
        <GlassCard>
          <h3>Consommation</h3>
          <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{c.economy.consumptionIndex.toFixed(0)}</div>
          <div className="tiny muted">indice (100 = référence)</div>
          <div className="mt-8"><Sparkline data={series.slice(-60).map((s) => s.living)} color="#7fb2c9" width={200} height={36} /></div>
        </GlassCard>
        <GlassCard>
          <h3>Investissement</h3>
          <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{formatMoney(c.economy.investment)}</div>
          <div className="tiny muted">par an · {((c.economy.investment / Math.max(1, c.economy.gdp)) * 100).toFixed(1)} % du PIB</div>
        </GlassCard>
        <GlassCard>
          <h3>Niveau de vie</h3>
          <div className="row" style={{ gap: 10 }}>
            <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{c.economy.standardOfLiving.toFixed(0)}</div>
            <Badge tone={c.economy.standardOfLiving >= 65 ? 'good' : c.economy.standardOfLiving >= 40 ? 'warn' : 'danger'}>
              {c.economy.standardOfLiving >= 65 ? 'ÉLEVÉ' : c.economy.standardOfLiving >= 40 ? 'MOYEN' : 'FAIBLE'}
            </Badge>
          </div>
          <div className="tiny muted">Population {formatPopulation(c.population)}</div>
        </GlassCard>
      </div>
    </div>
  );
}


function GrowthBreakdownBars({ bd }: { bd: import('shared').GrowthBreakdown }) {
  const entries = Object.entries(GROWTH_LABELS)
    .map(([k, meta]) => ({ k, ...meta, v: (bd as unknown as Record<string, number>)[k] ?? 0 }))
    .filter((x) => Math.abs(x.v) > 0.005);
  const maxAbs = Math.max(0.5, ...entries.map((x) => Math.abs(x.v)));
  return (
    <div className="col" style={{ gap: 2 }}>
      {entries.map((x) => (
        <div key={x.k} className="growth-row">
          <span className="small muted row" style={{ gap: 6 }}>
            {x.label} <InfoTipCard text={x.tip} />
          </span>
          <div className="growth-bar" role="img" aria-label={`${x.label} : ${x.v >= 0 ? '+' : ''}${x.v.toFixed(2)} point`}>
            <span className="growth-axis" aria-hidden />
            <span
              className={`growth-fill ${x.v >= 0 ? 'pos' : 'neg'}`}
              style={{ width: `${(Math.abs(x.v) / maxAbs) * 50}%` }}
            />
          </div>
          <span className="mono small" style={{ fontWeight: 700, color: x.v >= 0 ? 'var(--good)' : 'var(--danger)', minWidth: 64, textAlign: 'right' }}>
            {x.v >= 0 ? '+' : ''}{x.v.toFixed(2)} pt
          </span>
        </div>
      ))}
      <div className="row-between mt-8" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8 }}>
        <strong className="small">Croissance cible du moteur</strong>
        <strong className={bd.total >= 0 ? 'delta-up' : 'delta-down'}>{bd.total >= 0 ? '+' : ''}{bd.total.toFixed(1)} %/an</strong>
      </div>
    </div>
  );
}
