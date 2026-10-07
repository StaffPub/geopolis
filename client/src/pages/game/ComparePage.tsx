/**
 * GEOPOLIS — Comparateur de nations : rendre le monde observable.
 */
import { useMemo, useState } from 'react';
import { formatMoney, formatPopulation } from 'shared';
import { useAuth } from '../../state/AuthContext.js';
import { useGame } from '../../state/GameContext.js';
import { GlassCard, PageHeader } from '../../components/ui.js';
import { BackButton } from '../../components/BackButton.js';

const METRICS: { key: string; label: string; get: (c: import('shared').PublicCountry) => number; format: (v: number) => string; better: 'high' | 'low' }[] = [
  { key: 'gdp', label: 'PIB', get: (c) => c.gdp, format: (v) => formatMoney(v), better: 'high' },
  { key: 'growth', label: 'Croissance', get: (c) => c.growth, format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} %`, better: 'high' },
  { key: 'population', label: 'Population', get: (c) => c.population, format: (v) => formatPopulation(v), better: 'high' },
  { key: 'inflation', label: 'Inflation', get: (c) => c.inflation, format: (v) => `${v.toFixed(1)} %`, better: 'low' },
  { key: 'unemployment', label: 'Chômage', get: (c) => c.unemployment, format: (v) => `${v.toFixed(1)} %`, better: 'low' },
  { key: 'popularity', label: 'Popularité', get: (c) => c.popularity, format: (v) => `${v.toFixed(0)} %`, better: 'high' },
  { key: 'stability', label: 'Stabilité', get: (c) => c.stability, format: (v) => `${v.toFixed(0)} %`, better: 'high' },
  { key: 'living', label: 'Niveau de vie', get: (c) => c.standardOfLiving, format: (v) => v.toFixed(0), better: 'high' },
  { key: 'debt', label: 'Dette / PIB', get: (c) => c.debtRatio, format: (v) => `${v.toFixed(0)} %`, better: 'low' },
  { key: 'difficulty', label: 'Difficulté', get: (c) => c.difficulty, format: (v) => `${v.toFixed(0)}/5`, better: 'low' },
];

export function ComparePage() {
  const { countries } = useGame();
  const { countryId } = useAuth();
  const [aId, setAId] = useState<string>(countryId ?? countries[0]?.id ?? '');
  const [bId, setBId] = useState<string>(
    countries.find((c) => c.id !== (countryId ?? countries[0]?.id))?.id ?? countries[1]?.id ?? '',
  );

  const a = useMemo(() => countries.find((c) => c.id === aId), [countries, aId]);
  const b = useMemo(() => countries.find((c) => c.id === bId), [countries, bId]);

  return (
    <div className="page">
      <div className="mb-16"><BackButton to="/game/world" label="Retour vue monde" /></div>
      <PageHeader
        icon="⚖️"
        title="Comparateur de nations"
        subtitle="Deux nations côte à côte : économie, société, politiques et relations. Les écarts sont colorés colonne par colonne pour voir d'un coup d'œil qui domine quoi — et où votre pays doit progresser."
      />

      <div className="grid grid-2 mb-16">
        {[{ id: aId, set: setAId, other: bId, c: a }, { id: bId, set: setBId, other: aId, c: b }].map((sel, i) => (
          <GlassCard key={i}>
            <select
              className="input"
              value={sel.id}
              onChange={(e) => sel.set(e.target.value)}
              aria-label={`Nation ${i === 0 ? 'A' : 'B'}`}
            >
              {countries.map((c) => (
                <option key={c.id} value={c.id} disabled={c.id === sel.other}>{c.name}</option>
              ))}
            </select>
            {sel.c && (
              <div className="row mt-8" style={{ gap: 10 }}>
                <span style={{ width: 14, height: 14, borderRadius: 5, background: sel.c.color, display: 'inline-block' }} aria-hidden />
                <div>
                  <div style={{ fontWeight: 800 }}>{sel.c.name}</div>
                  <div className="tiny muted">
                    {sel.c.region} · {sel.c.controllerKind === 'player' ? `Joueur : ${sel.c.presidentName}` : `IA : ${sel.c.presidentName}`}
                  </div>
                </div>
              </div>
            )}
          </GlassCard>
        ))}
      </div>

      {a && b && (
        <GlassCard>
          <div className="table-wrap">
            <table className="data responsive">
              <thead>
                <tr>
                  <th>Indicateur</th>
                  <th style={{ color: a.color }}>{a.name}</th>
                  <th style={{ color: b.color }}>{b.name}</th>
                </tr>
              </thead>
              <tbody>
                {METRICS.map((m) => {
                  const va = m.get(a);
                  const vb = m.get(b);
                  const aWins = m.better === 'high' ? va > vb : va < vb;
                  const bWins = m.better === 'high' ? vb > va : vb < va;
                  return (
                    <tr key={m.key}>
                      <td data-label="Indicateur"><strong>{m.label}</strong></td>
                      <td data-label={a.name} className="mono" style={{ fontWeight: aWins ? 800 : 400, color: aWins ? 'var(--good)' : undefined }}>
                        {m.format(va)} {aWins ? '◂' : ''}
                      </td>
                      <td data-label={b.name} className="mono" style={{ fontWeight: bWins ? 800 : 400, color: bWins ? 'var(--good)' : undefined }}>
                        {bWins ? '▸' : ''} {m.format(vb)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
