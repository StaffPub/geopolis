/**
 * GEOPOLIS — Vue Monde : explorer le monde sans posséder de pays.
 * Classements, comparaisons, carte, marchés — données publiques réelles.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, formatPopulation, RESOURCE_MAP } from 'shared';
import { useGame } from '../../state/GameContext.js';
import { WorldMap, type MapMode } from '../../components/WorldMap.js';
import { CountryPanel } from '../../components/CountryPanel.js';
import { Badge, GlassCard, PageHeader, StatCard, AnimatedNumber } from '../../components/ui.js';

type Ranking = 'gdp' | 'population' | 'growth' | 'popularity' | 'living' | 'debt';

export function WorldViewPage() {
  const { countries, flows, actors, meta, activeTradeCount, activeEventCount, market } = useGame();
  const [mode, setMode] = useState<MapMode>('economy');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ranking, setRanking] = useState<Ranking>('gdp');

  const worldGdp = countries.reduce((s, c) => s + c.gdp, 0);
  const worldPop = countries.reduce((s, c) => s + c.population, 0);

  const ranked = useMemo(() => {
    const sorted = [...countries];
    switch (ranking) {
      case 'gdp': sorted.sort((a, b) => b.gdp - a.gdp); break;
      case 'population': sorted.sort((a, b) => b.population - a.population); break;
      case 'growth': sorted.sort((a, b) => b.growth - a.growth); break;
      case 'popularity': sorted.sort((a, b) => b.popularity - a.popularity); break;
      case 'living': sorted.sort((a, b) => b.standardOfLiving - a.standardOfLiving); break;
      case 'debt': sorted.sort((a, b) => b.debtRatio - a.debtRatio); break;
    }
    return sorted;
  }, [countries, ranking]);

  const valueFor = (c: (typeof countries)[number]): string => {
    switch (ranking) {
      case 'gdp': return formatMoney(c.gdp);
      case 'population': return formatPopulation(c.population);
      case 'growth': return `${c.growth >= 0 ? '+' : ''}${c.growth.toFixed(1)} %`;
      case 'popularity': return `${c.popularity.toFixed(0)} %`;
      case 'living': return `${c.standardOfLiving.toFixed(0)}/100`;
      case 'debt': return `${c.debtRatio.toFixed(0)} %`;
    }
  };

  return (
    <div className="page">
      <PageHeader
        icon="🌐"
        title="Vue monde"
        subtitle="Le monde entier en un coup d'œil : classements des nations, marché mondial des 8 ressources, présence des joueurs et dirigeants IA, flux commerciaux animés. Tout vient du moteur, en direct."
        chips={<>
          <Badge tone="good">{countries.filter((x) => x.controllerKind === 'player').length} joueur(s) au pouvoir</Badge>
          <Badge tone="info">{countries.filter((x) => x.controllerKind === 'ai').length} dirigeants IA</Badge>
        </>}
        right={
          <Link className="btn btn-primary btn-sm btn-rocket" to="/countries"><span className="rk" aria-hidden>🚀</span>Prendre la tête d'une nation</Link>
        }
      />

      <div className="grid grid-5 stagger">
        <StatCard label="PIB mondial" value={worldGdp} format={(v) => formatMoney(v)} tone="var(--accent-violet)" />
        <StatCard label="Population mondiale" value={worldPop / 1000} format={(v) => `${v.toFixed(2)} Md`} tone="var(--accent-blue)" />
        <StatCard label="Acteurs actifs" value={actors.total} format={(v) => v.toFixed(0)} tone="var(--good)" />
        <StatCard label="Échanges actifs" value={activeTradeCount} format={(v) => v.toFixed(0)} tone="var(--accent-cyan)" />
        <StatCard label="Événements en cours" value={activeEventCount} format={(v) => v.toFixed(0)} tone="var(--accent-pink)" />
      </div>

      <div className="mt-16">
        <WorldMap
          countries={countries}
          flows={flows}
          selectedId={selectedId}
          referenceId={selectedId}
          mode={mode}
          onModeChange={setMode}
          onSelect={setSelectedId}
          height="56vh"
        />
      </div>

      <div className="grid mt-16" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 16 }}>
        <GlassCard>
          <div className="row-between mb-16">
            <h3 style={{ margin: 0 }}>Classement des nations</h3>
            <select className="input" style={{ width: 'auto', padding: '6px 10px', minHeight: 34 }} value={ranking} onChange={(e) => setRanking(e.target.value as Ranking)} aria-label="Critère de classement">
              <option value="gdp">PIB</option>
              <option value="population">Population</option>
              <option value="growth">Croissance</option>
              <option value="popularity">Popularité</option>
              <option value="living">Niveau de vie</option>
              <option value="debt">Dette / PIB</option>
            </select>
          </div>
          <div className="table-wrap">
            <table className="data responsive">
              <thead>
                <tr><th>#</th><th>Nation</th><th>Valeur</th><th>Contrôle</th><th>Président</th></tr>
              </thead>
              <tbody>
                {ranked.slice(0, 36).map((c, i) => (
                  <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(c.id)}>
                    <td data-label="#" className="mono muted">{i + 1}</td>
                    <td data-label="Nation">
                      <span className="row" style={{ gap: 8 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color, display: 'inline-block' }} aria-hidden />
                        <strong>{c.name}</strong>
                      </span>
                    </td>
                    <td data-label="Valeur" className="mono">{valueFor(c)}</td>
                    <td data-label="Contrôle">
                      <Badge tone={c.controllerKind === 'player' ? 'violet' : 'info'}>{c.controllerKind === 'player' ? 'JOUEUR' : 'IA'}</Badge>
                    </td>
                    <td data-label="Président">{c.presidentName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>

        <div className="col">
          <GlassCard>
            <h3>Marché mondial</h3>
            {market ? (
              <div className="col">
                {Object.values(market).map((m) => (
                  <div key={m.key} className="row-between small">
                    <span>{RESOURCE_MAP[m.key]?.name ?? m.key}</span>
                    <span className="mono">
                      <AnimatedNumber value={m.price} format={(v) => v.toFixed(2)} /> €{' '}
                      <span className={m.change24h >= 0 ? 'delta-up' : 'delta-down'}>
                        {m.change24h >= 0 ? '+' : ''}{m.change24h.toFixed(1)} %
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            ) : <div className="small muted">Chargement…</div>}
          </GlassCard>

          <GlassCard>
            <h3>État du monde</h3>
            <div className="col small">
              <div className="row-between"><span className="muted">Jour</span><span className="mono">{meta?.day ?? 0}</span></div>
              <div className="row-between"><span className="muted">Version monde</span><span className="mono">{meta?.version ?? 0}</span></div>
              <div className="row-between"><span className="muted">Dernier tick</span><span className="mono">{meta ? `${meta.lastTickDurationMs} ms` : '—'}</span></div>
              <div className="row-between"><span className="muted">Nations</span><span className="mono">{countries.length}</span></div>
              <div className="row-between"><span className="muted">Joueurs en ligne</span><span className="mono">{actors.humansOnline}</span></div>
              <div className="row-between"><span className="muted">Dirigeants IA actifs</span><span className="mono">{actors.ai}</span></div>
            </div>
            <Link to="/game/compare" className="btn btn-sm btn-block mt-16">⇄ Comparer deux nations</Link>
          </GlassCard>
        </div>
      </div>

      <CountryPanel countryId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
