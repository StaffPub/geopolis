/**
 * GEOPOLIS — Panneau d'information pays (carte & vue monde) :
 * données publiques réelles, onglets Économie / Population / Ressources /
 * Infrastructures / Commerce / Diplomatie / Politique.
 */
import { useEffect, useState } from 'react';
import type { Country, RelationSummary } from 'shared';
import { formatMoney, formatPopulation, relationLabel, worldDate } from 'shared';
import { INFRA, RESOURCE_KEYS, RESOURCE_MAP, SPENDING_SECTORS } from 'shared';
import { game as gameApi } from '../lib/api';
import { useGame } from '../state/GameContext.js';
import { Badge, Drawer, ProgressBar, Spinner, KeyValue } from './ui.js';

const TABS = ['Économie', 'Population', 'Ressources', 'Infrastructures', 'Commerce', 'Diplomatie', 'Politique'] as const;
type Tab = (typeof TABS)[number];

export function CountryPanel({ countryId, onClose }: { countryId: string | null; onClose: () => void }) {
  const { countries, meta } = useGame();
  const [tab, setTab] = useState<Tab>('Économie');
  const [full, setFull] = useState<Country | null>(null);
  const [relations, setRelations] = useState<RelationSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!countryId) {
      setFull(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setTab('Économie');
    gameApi
      .country(countryId)
      .then((res) => {
        if (!cancelled) {
          setFull(res.country);
          setRelations(res.relationsSummary);
        }
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [countryId]);

  if (!countryId) return null;
  const pub = countries.find((c) => c.id === countryId);
  const name = full?.name ?? pub?.name ?? countryId;

  return (
    <Drawer
      title={
        <span className="row" style={{ gap: 8 }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: full?.color ?? pub?.color ?? '#888', display: 'inline-block' }} aria-hidden />
          {name.toUpperCase()}
        </span>
      }
      onClose={onClose}
    >
      {loading && <Spinner label="Chargement des données du pays…" />}
      {!loading && !full && <p className="small muted">Données indisponibles (serveur injoignable ?).</p>}
      {full && (
        <>
          <div className="row-between mb-16">
            <div>
              <div className="small muted">Président</div>
              <div style={{ fontWeight: 800 }}>{full.controller.presidentName}</div>
              <div className="tiny muted mt-8">
                {full.controller.kind === 'player' ? (
                  <>Statut : <Badge tone="violet">HUMAIN</Badge> · Actif depuis {worldDate(Math.max(0, (meta?.day ?? 0) - full.controller.sinceDay))}</>
                ) : (
                  <>Statut : <Badge tone="info">IA ACTIVE</Badge> · Stratégie {full.ai.personality.strategy}</>
                )}
              </div>
            </div>
            <Badge tone={full.difficulty <= 2 ? 'good' : full.difficulty <= 3 ? 'warn' : 'danger'}>
              DIFFICULTÉ {full.difficulty}/5
            </Badge>
          </div>

          <div className="tabs mb-16" role="tablist">
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>

          {tab === 'Économie' && (
            <div className="col anim-fade-in">
              <KeyValue k="PIB" v={formatMoney(full.economy.gdp)} />
              <KeyValue k="Croissance" v={`${full.economy.growth >= 0 ? '+' : ''}${full.economy.growth.toFixed(1)} %`} tone={full.economy.growth >= 0 ? 'var(--good)' : 'var(--danger)'} />
              <KeyValue k="Inflation" v={`${full.economy.inflation.toFixed(1)} %`} />
              <KeyValue k="Chômage" v={`${full.economy.unemployment.toFixed(1)} %`} />
              <KeyValue k="Budget (solde)" v={`${full.economy.balance >= 0 ? '+' : ''}${formatMoney(full.economy.balance)}`} tone={full.economy.balance >= 0 ? 'var(--good)' : 'var(--danger)'} />
              <KeyValue k="Trésorerie" v={formatMoney(full.economy.cash)} />
              <KeyValue k="Dette" v={`${((full.economy.debt / Math.max(1, full.economy.gdp)) * 100).toFixed(0)} % du PIB`} />
              <KeyValue k="Productivité" v={full.economy.productivity.toFixed(0)} />
              <KeyValue k="Niveau de vie" v={`${full.economy.standardOfLiving.toFixed(0)}/100`} />
              <KeyValue k="Investissement" v={formatMoney(full.economy.investment)} />
            </div>
          )}

          {tab === 'Population' && (
            <div className="col anim-fade-in">
              <KeyValue k="Population" v={formatPopulation(full.population)} />
              <KeyValue k="Niveau de vie" v={`${full.economy.standardOfLiving.toFixed(0)}/100`} />
              <KeyValue k="Chômage" v={`${full.economy.unemployment.toFixed(1)} %`} />
              <KeyValue k="Indice de consommation" v={full.economy.consumptionIndex.toFixed(0)} />
              <h4 className="mt-8">Emploi sectoriel</h4>
              {Object.entries(full.sectors).map(([k, s]) => (
                <ProgressBar key={k} label={k} value={s.employment} max={60} height={6} />
              ))}
            </div>
          )}

          {tab === 'Ressources' && (
            <div className="col anim-fade-in">
              {RESOURCE_KEYS.map((k) => {
                const r = full.resources[k];
                const ratio = r.capacity > 0 ? (r.stock / r.capacity) * 100 : 0;
                const deficit = r.production - r.consumption;
                return (
                  <div key={k} className="glass" style={{ padding: '10px 12px', borderRadius: 12 }}>
                    <div className="row-between">
                      <strong className="small">{RESOURCE_MAP[k].name}</strong>
                      <span className="tiny mono">{r.price.toFixed(2)} €/u</span>
                    </div>
                    <div className="mt-8"><ProgressBar value={ratio} tone={ratio < 25 ? 'danger' : ratio < 45 ? 'warn' : 'good'} height={6} /></div>
                    <div className="row-between tiny muted mt-8">
                      <span>Prod {r.production.toFixed(1)}/j · Conso {r.consumption.toFixed(1)}/j</span>
                      <span className={deficit >= 0 ? 'delta-up' : 'delta-down'}>{deficit >= 0 ? 'Excédent' : 'Déficit'} {Math.abs(deficit).toFixed(1)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'Infrastructures' && (
            <div className="col anim-fade-in">
              {INFRA.map((def) => (
                <div key={def.key}>
                  <div className="row-between small">
                    <span>{def.name}</span>
                    <span className="mono muted">Niv. {full.infra[def.key]?.level ?? 0}/{def.maxLevel}</span>
                  </div>
                  <div className="mt-8"><ProgressBar value={full.infra[def.key]?.level ?? 0} max={def.maxLevel} height={5} /></div>
                </div>
              ))}
              {full.projects.length > 0 && (
                <>
                  <h4 className="mt-8">Chantiers en cours</h4>
                  {full.projects.map((p) => (
                    <div key={p.id} className="small">
                      {p.infra} — {(p.progress * 100).toFixed(0)} %
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {tab === 'Commerce' && (
            <div className="col anim-fade-in">
              <KeyValue k="Flux actifs" v={relations.filter((r) => r.tradeVolume > 0.01).length} />
              {relations
                .filter((r) => r.tradeVolume > 0.005)
                .sort((a, b) => b.tradeVolume - a.tradeVolume)
                .slice(0, 12)
                .map((r) => (
                  <div key={r.countryId} className="row-between small">
                    <span className="row" style={{ gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 3, background: r.color, display: 'inline-block' }} aria-hidden />
                      {r.name}
                    </span>
                    <span className="mono tiny muted">{(r.tradeVolume * 1000).toFixed(1)} M €/j</span>
                  </div>
                ))}
              {full.transactions.length === 0 && <div className="small muted">Aucune transaction enregistrée récemment.</div>}
              {full.transactions.length > 0 && (
                <>
                  <h4 className="mt-8">Dernières transactions</h4>
                  {full.transactions.slice(-6).reverse().map((t) => (
                    <div key={t.id} className="tiny muted">
                      J{t.day} · {t.fromId} → {t.toId} · {RESOURCE_MAP[t.resource]?.name ?? t.resource} · {t.value.toFixed(2)} Md €
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {tab === 'Diplomatie' && (
            <div className="col anim-fade-in">
              {relations.slice(0, 14).map((r) => {
                const tone = relationLabel(r.score);
                return (
                  <div key={r.countryId} className="row-between small">
                    <span className="row" style={{ gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 3, background: r.color, display: 'inline-block' }} aria-hidden />
                      {r.name}
                      {r.sanctionByUs || r.sanctionByThem ? <Badge tone="danger">MESURE ÉCO.</Badge> : null}
                    </span>
                    <span className="mono tiny" style={{ color: tone.tone === 'good' ? 'var(--good)' : tone.tone === 'bad' || tone.tone === 'tense' ? 'var(--danger)' : 'var(--text-1)' }}>
                      {r.score.toFixed(0)} · {tone.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'Politique' && (
            <div className="col anim-fade-in">
              <KeyValue k="Régime" v={full.regime} />
              <KeyValue k="Popularité" v={`${full.popularity.toFixed(1)} %`} tone={full.popularity < 35 ? 'var(--danger)' : undefined} />
              <KeyValue k="Stabilité" v={`${full.stability.toFixed(1)} %`} />
              <KeyValue k="Risque politique" v={full.mandate.risk} tone={full.mandate.risk === 'faible' ? 'var(--good)' : full.mandate.risk === 'modéré' ? 'var(--warn)' : 'var(--danger)'} />
              <KeyValue k="Fiscalité" v={`${full.policy.taxRate.toFixed(1)} %`} />
              <KeyValue k="Impôt sociétés" v={`${full.policy.corporateTax.toFixed(1)} %`} />
              <KeyValue k="Tarif douanier" v={`${full.policy.tariff.toFixed(1)} %`} />
              <KeyValue k="Taux directeur" v={`${full.policy.interestRate.toFixed(2)} %`} />
              <h4 className="mt-8">Budget (% PIB)</h4>
              {SPENDING_SECTORS.map((s) => (
                <ProgressBar key={s.key} label={s.name} value={full.policy.spending[s.key]} max={8} height={5} />
              ))}
              <h4 className="mt-8">Lois en vigueur</h4>
              {full.laws.length === 0 && <div className="small muted">Aucune loi spécifique.</div>}
              {full.laws.map((l) => (
                <div key={l.id} className="small">📜 {l.lawId.replace(/_/g, ' ')} <span className="tiny muted">(jour {l.enactedDay})</span></div>
              ))}
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
