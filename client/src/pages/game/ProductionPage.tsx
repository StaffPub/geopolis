/**
 * GEOPOLIS — Production v1 : les bâtiments productifs achetables.
 * 16 bâtiments (2 paliers × 8 ressources) : fermes, centrales, puits, mines,
 * usines, campus… Achetés avec la TRÉSORERIE, livrés après construction, ils
 * ajoutent une production quotidienne réelle (mise à l'échelle du pays) contre
 * un entretien journalier. Les IA bâtissent aussi et vendent leurs surplus sur
 * le marché inter-états (onglet Ressources) — tout est synchronisé temps réel.
 * Ultra-animé : hero à engrenages, tapis roulant, cartes en stagger, jauges de
 * construction à rayures animées, compteurs glissants.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FACILITIES, RESOURCE_KEYS, RESOURCE_MAP, facilityOutput } from 'shared';
import type { ActionParams, FacilityKey, ResourceKey } from 'shared';
import { formatMoney } from 'shared';
import { useAuth } from '../../state/AuthContext.js';
import { useGame } from '../../state/GameContext.js';
import { ActionModal } from '../../components/ActionModal.js';
import { InfoTip } from '../../components/InfoTip.js';
import { AnimatedNumber, Badge, EmptyState, GlassCard, SectionCard, SectionTitle, StatCard } from '../../components/ui.js';

export function ProductionPage() {
  const { user, countryId } = useAuth();
  const { myCountry, market, meta, refreshMyCountry } = useGame();
  const [pending, setPending] = useState<{ params: ActionParams; title: string; description?: string } | null>(null);
  const [filter, setFilter] = useState<ResourceKey | 'all'>('all');

  const c = myCountry && myCountry.id === countryId ? myCountry : null;
  const isPlayer = !!c && c.controller.kind === 'player' && c.controller.userId === user?.id;
  const day = meta?.day ?? 0;

  const totals = useMemo(() => {
    if (!c) return { owned: 0, building: 0, upkeep: 0 };
    let owned = 0;
    let building = 0;
    let upkeep = 0;
    for (const f of FACILITIES) {
      const st = c.facilities?.[f.key];
      if (!st) continue;
      owned += st.owned;
      upkeep += st.owned * f.upkeepPerDay;
      building += st.queue.reduce((s, q) => s + q.count, 0);
    }
    return { owned, building, upkeep };
  }, [c]);

  if (!c) {
    return (
      <div className="page">
        <SectionTitle>Production</SectionTitle>
        <GlassCard>
          <EmptyState title="Aucune nation dirigée" hint="Prenez la tête d'un pays pour bâtir son appareil productif." icon="🏭" />
          <div className="row mt-16" style={{ justifyContent: 'center' }}>
            <Link className="btn btn-primary" to="/countries">Choisir ma nation</Link>
          </div>
        </GlassCard>
      </div>
    );
  }

  const groups = RESOURCE_KEYS
    .filter((k) => filter === 'all' || filter === k)
    .map((k) => ({
      key: k,
      facilities: FACILITIES.filter((f) => f.resource === k),
    }));

  return (
    <div className="page">
      {/* ---------------- HERO Production ---------------- */}
      <div className="prod-hero anim-fade-up">
        <div className="prod-hero-deco" aria-hidden>
          <span className="prod-gear prod-gear-1">⚙️</span>
          <span className="prod-gear prod-gear-2">⚙️</span>
          <span className="prod-gear prod-gear-3">⚙️</span>
          <div className="prod-conveyor">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span key={i} className="prod-crate" style={{ animationDelay: `${i * 1.1}s` }}>📦</span>
            ))}
          </div>
        </div>
        <div className="prod-hero-content">
          <h1 style={{ margin: 0 }}>🏭 Production — {c.name}</h1>
          <p className="small" style={{ margin: '6px 0 0', color: 'rgba(255,255,255,0.78)', maxWidth: 660 }}>
            Bâtissez votre appareil productif : <strong>fermes, centrales, mines, usines, campus</strong>…
            Chaque bâtiment est payé par la <strong>trésorerie</strong>, livré après construction, puis produit
            <strong> chaque jour</strong> — et alimente vos stocks, vos exportations et vos offres de vente.
          </p>
        </div>
      </div>

      {/* ---------------- KPIs ---------------- */}
      <div className="grid grid-4 mt-16 stagger">
        <StatCard label="Bâtiments en service" value={totals.owned} format={(v) => v.toFixed(0)} tone="var(--good)" icon={<InfoTip text="Total de vos bâtiments productifs livrés. Chacun ajoute sa production quotidienne (mise à l'échelle de votre main-d'œuvre) et coûte son entretien." />} />
        <StatCard label="En construction" value={totals.building} format={(v) => v.toFixed(0)} tone="var(--warn)" icon={<InfoTip text="Bâtiments commandés mais pas encore livrés. Suivez leur progression sur les cartes (jour de livraison affiché)." />} />
        <StatCard label="Entretien quotidien" value={totals.upkeep} format={(v) => `${v.toFixed(3)} Md €`} tone="var(--accent-pink)" icon={<InfoTip text="Somme des entretiens journaliers de vos bâtiments, prélevée sur la trésorerie chaque jour (comme les chantiers et les consignes)." />} />
        <StatCard label="Trésorerie" value={c.economy.cash} format={(v) => formatMoney(v)} glide tone="var(--accent-blue)" icon={<InfoTip text="Votre cash disponible : c'est lui qui paie les bâtiments, immédiatement à la commande." />} />
      </div>

      {/* ---------------- Urgences vitales ---------------- */}
      {(() => {
        const vital: { key: ResourceKey; ratio: number; deficit: number }[] = [];
        for (const k of ['food', 'energy'] as ResourceKey[]) {
          const r = c.resources[k];
          const ratio = r.capacity > 0 ? r.stock / r.capacity : 1;
          if (ratio < 0.35 || r.production - r.consumption < -0.5) {
            vital.push({ key: k, ratio, deficit: r.consumption - r.production });
          }
        }
        if (vital.length === 0) return null;
        return (
          <div className="vital-banner anim-fade-up mt-16">
            <span aria-hidden style={{ fontSize: '1.4rem' }}>🚨</span>
            <div className="flex1">
              <strong>
                {vital.map((v) => RESOURCE_MAP[v.key].name).join(' + ')} : production insuffisante
              </strong>
              <div className="tiny" style={{ opacity: 0.85 }}>
                {vital.map((v) => {
                  const f1 = FACILITIES.find((x) => x.resource === v.key && x.tier === 1)!;
                  const each = facilityOutput(f1, 1, c.population);
                  const needed = v.deficit > 0 ? Math.ceil(v.deficit / each) : 1;
                  return (
                    <span key={v.key}>
                      Déficit {RESOURCE_MAP[v.key].name.toLowerCase()} : <b>{v.deficit > 0 ? `−${v.deficit.toFixed(1)}` : v.deficit.toFixed(1)}</b> {RESOURCE_MAP[v.key].unit}/j
                      {v.deficit > 0 && <> → <b>{needed} × {f1.icon} {f1.name}</b> le comblent (livraison {f1.buildDays} j)</>}
                      {' '}
                    </span>
                  );
                })}
                — construisez ci-dessous, boostez dans l'onglet Ressources, ou achetez en urgence au marché.
              </div>
            </div>
            <a className="btn btn-sm" href="#groupe-food" onClick={(e) => {
              const el = document.getElementById(vital[0]!.key === 'food' ? 'groupe-food' : 'groupe-energy');
              if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
            }}>
              ⬇️ Voir les bâtiments
            </a>
          </div>
        );
      })()}

      {/* ---------------- Filtres ---------------- */}
      <SectionCard
        className="mt-16"
        icon="🧠"
        title="Comment fonctionne votre appareil productif"
        desc="Chaque bâtiment produit CHAQUE jour de monde dès sa livraison — et prélève un entretien quotidien sur votre trésorerie."
      >
        <ul className="explain-list">
          <li>🏭 <span><b>2 paliers par ressource</b> : rapide et abordable (ferme, puits, atelier…) ou lourd et puissant (complexe agro-industriel, plateforme offshore, usine intégrée…).</span></li>
          <li>⏳ <span><b>Construction de 3 à 12 jours</b> : la commande débite la trésorerie, la production démarre à la livraison (barre de progression + notification).</span></li>
          <li>👷 <span><b>Rendement mis à l'échelle</b> de votre population : plus votre pays est peuplé, plus chaque bâtiment produit.</span></li>
          <li>🤖 <span><b>Les IA bâtissent aussi</b> : elles comblent leurs pénuries et développent leurs dotations pour exporter — achetez leurs offres dans l'onglet Ressources.</span></li>
        </ul>
      </SectionCard>

      <div className="trade-section-head mt-24">
        <div className="row wrap" style={{ gap: 10 }}>
          <h2 style={{ margin: 0 }}>🔧 Catalogue des bâtiments</h2>
          <InfoTip text="Deux paliers par ressource : le palier 1 est rapide et abordable, le palier 2 produit massivement mais coûte cher et se construit lentement. Le rendement affiché est déjà mis à l'échelle de votre pays (main-d'œuvre = population). Plafond par bâtiment indiqué sur la carte." />
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <button className={`assist-cat ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>Toutes</button>
          {RESOURCE_KEYS.map((k) => (
            <button key={k} className={`assist-cat ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
              <span className="res-chip-dot" style={{ background: RESOURCE_MAP[k].color }} aria-hidden /> {RESOURCE_MAP[k].short}
            </button>
          ))}
        </div>
      </div>

      {/* ---------------- Groupes par ressource ---------------- */}
      {groups.map((g) => {
        const def = RESOURCE_MAP[g.key];
        const r = c.resources[g.key];
        const ratio = r.capacity > 0 ? r.stock / r.capacity : 0;
        const net = r.production - r.consumption;
        const worldPrice = market?.[g.key]?.price ?? def.basePrice;
        return (
          <div key={g.key} className="mt-16" id={`groupe-${g.key}`}>
            <div className="prod-group-head anim-fade-in">
              <span className="res-dot" style={{ background: def.color, width: 12, height: 12 }} aria-hidden />
              <strong style={{ color: def.color }}>{def.name}</strong>
              <span className="tiny muted mono">
                prod <strong style={{ color: 'var(--text-0)' }}>{r.production.toFixed(1)}</strong>/j ·
                conso <strong style={{ color: 'var(--text-0)' }}>{r.consumption.toFixed(1)}</strong>/j ·
                stocks {(ratio * 100).toFixed(0)} % · mondial {worldPrice.toFixed(2)} Md €
              </span>
              {ratio < 0.3 && <Badge tone="danger">TENSION</Badge>}
              {ratio > 0.82 && <Badge tone="info">SURSTOCK</Badge>}
              {(c.productionDirectives?.[g.key] ?? null) === 'boost' && <Badge tone="good">BOOST +15 %</Badge>}
              {(c.productionDirectives?.[g.key] ?? null) === 'slow' && <Badge tone="warn">RALENTI −12 %</Badge>}
              {net < -0.5 && (() => {
                const f1 = FACILITIES.find((x) => x.resource === g.key && x.tier === 1)!;
                const needed = Math.max(1, Math.ceil(-net / facilityOutput(f1, 1, c.population)));
                return (
                  <span className="tiny" style={{ color: 'var(--warn)', fontWeight: 700 }}>
                    💡 {needed} × {f1.icon} {f1.name} comblent le déficit
                  </span>
                );
              })()}
            </div>
            <div className="prod-grid stagger">
              {g.facilities.map((f) => {
                const st = c.facilities?.[f.key] ?? { owned: 0, queue: [] };
                const queued = st.queue.reduce((s, q) => s + q.count, 0);
                const totalCommitted = st.owned + queued;
                const atCap = totalCommitted >= f.maxOwned;
                const outEach = facilityOutput(f, 1, c.population);
                const cash1 = c.economy.cash >= f.cost;
                const cash3 = c.economy.cash >= f.cost * 3;
                const exportValue = outEach * st.owned * worldPrice * 0.045;
                return (
                  <div key={f.key} className={`prod-card ${atCap ? 'capped' : ''}`} style={{ '--res': def.color } as React.CSSProperties}>
                    <div className="row-between">
                      <div className="row" style={{ gap: 10 }}>
                        <span className="prod-ico" aria-hidden>{f.icon}</span>
                        <div>
                          <strong>{f.name}</strong>
                          <div className="tiny muted">Palier {f.tier === 1 ? 'I — essentiel' : 'II — massif'}</div>
                        </div>
                      </div>
                      <div className="prod-owned">
                        <AnimatedNumber value={st.owned} format={(v) => v.toFixed(0)} duration={600} />
                        <span className="tiny muted">/{f.maxOwned}</span>
                      </div>
                    </div>

                    <p className="tiny muted mt-8" style={{ minHeight: 30 }}>{f.description}</p>

                    <div className="prod-stats">
                      <span title="Production ajoutée par bâtiment et par jour (échelle de votre pays incluse)">
                        <b style={{ color: def.color }}>+{outEach.toFixed(2)}</b> {def.unit}/j
                      </span>
                      <span title="Coût d'achat unitaire"><b>{f.cost}</b> Md €</span>
                      <span title="Entretien quotidien unitaire"><b>−{f.upkeepPerDay.toFixed(3)}</b> Md €/j</span>
                      <span title="Durée de construction"><b>{f.buildDays}</b> jours</span>
                    </div>

                    {st.owned > 0 && (
                      <div className="tiny mt-8" style={{ color: 'var(--good)' }}>
                        Rendement actuel : <strong className="mono">+{facilityOutput(f, st.owned, c.population).toFixed(1)} {def.unit}/j</strong>
                        {exportValue > 0.005 && <> · export potentiel ≈ <strong className="mono">{exportValue.toFixed(2)} Md €/j</strong></>}
                      </div>
                    )}

                    {/* File de construction */}
                    {st.queue.length > 0 && (
                      <div className="prod-build mt-8">
                        {st.queue.map((q, i) => {
                          const started = q.readyDay - f.buildDays;
                          const pctRaw = f.buildDays > 0 ? ((day - started) / f.buildDays) * 100 : 100;
                          const pct = Math.max(3, Math.min(100, pctRaw));
                          return (
                            <div key={i} className="prod-build-row">
                              <span className="tiny mono">🔨 {q.count} × livraison J{q.readyDay}</span>
                              <div className="prod-build-bar">
                                <div className="prod-build-fill" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="tiny mono">{pct.toFixed(0)} %</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Jauge de plafond */}
                    <div className="prod-cap mt-8">
                      <div className="prod-cap-bar"><div className="prod-cap-fill" style={{ width: `${(totalCommitted / f.maxOwned) * 100}%` }} /></div>
                      <span className="tiny muted mono">{totalCommitted}/{f.maxOwned}</span>
                    </div>

                    {isPlayer && (
                      <div className="row wrap mt-8" style={{ gap: 8 }}>
                        <button
                          className="btn btn-sm btn-primary btn3d"
                          disabled={atCap || !cash1}
                          title={atCap ? 'Plafond atteint' : !cash1 ? `Trésorerie insuffisante (${f.cost} Md €)` : `Construire 1 × ${f.name}`}
                          onClick={() => setPending({
                            params: { type: 'build_facility', facility: f.key as FacilityKey, count: 1 },
                            title: `Construire « ${f.name} »`,
                            description: `${f.cost} Md € débités immédiatement · livraison dans ${f.buildDays} jours · +${outEach.toFixed(2)} ${def.unit}/jour ensuite · entretien ${f.upkeepPerDay.toFixed(3)} Md €/jour.`,
                          })}
                        >
                          🏗️ Construire ({f.cost} Md €)
                        </button>
                        {!atCap && totalCommitted + 3 <= f.maxOwned && (
                          <button
                            className="btn btn-sm btn3d"
                            disabled={!cash3}
                            title={cash3 ? 'Construire 3 bâtiments d\'un coup' : 'Trésorerie insuffisante pour 3'}
                            onClick={() => setPending({
                              params: { type: 'build_facility', facility: f.key as FacilityKey, count: 3 },
                              title: `Construire 3 × « ${f.name} »`,
                              description: `${(f.cost * 3).toFixed(0)} Md € débités immédiatement · livraison groupée dans ${f.buildDays} jours.`,
                            })}
                          >
                    ×3
                          </button>
                        )}
                        {!atCap && totalCommitted + 5 <= f.maxOwned && (
                          <button
                            className="btn btn-sm btn3d"
                            disabled={c.economy.cash < f.cost * 5}
                            title={c.economy.cash >= f.cost * 5 ? 'Construire 5 bâtiments d\'un coup' : `Trésorerie insuffisante pour 5 (${(f.cost * 5).toFixed(0)} Md €)`}
                            onClick={() => setPending({
                              params: { type: 'build_facility', facility: f.key as FacilityKey, count: 5 },
                              title: `Construire 5 × « ${f.name} »`,
                              description: `${(f.cost * 5).toFixed(0)} Md € débités immédiatement · livraison groupée dans ${f.buildDays} jours.`,
                            })}
                          >
                    ×5
                          </button>
                        )}
                        {atCap && <Badge tone="neutral">PLAFOND ATTEINT</Badge>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* ---------------- Rappels ---------------- */}
      <GlassCard className="mt-24 anim-fade-up">
        <div className="row wrap" style={{ gap: 14, alignItems: 'center' }}>
          <span style={{ fontSize: '1.6rem' }} aria-hidden>🔗</span>
          <div className="flex1" style={{ minWidth: 220 }}>
            <strong>Comment tout s'articule ?</strong>
            <div className="tiny muted">
              Les bâtiments livrés augmentent votre production quotidienne → vos stocks montent → vos surplus partent en
              <strong> exportations automatiques</strong>, se vendent sur le <Link to="/game/resources">marché mondial</Link> ou via vos{' '}
              <strong>offres inter-états</strong> (les IA les achètent seules). L'entretien journalier est prélevé sur la trésorerie.
              Boostez temporairement une production avec les <strong>consignes</strong> (onglet Ressources).
            </div>
          </div>
          <Link className="btn btn-sm" to="/game/resources">🛢️ Gérer les stocks & vendre</Link>
          <Link className="btn btn-sm" to="/game/infrastructure">🏗️ Infrastructures stratégiques</Link>
        </div>
      </GlassCard>

      {pending && (
        <ActionModal
          countryId={c.id}
          params={pending.params}
          title={pending.title}
          description={pending.description}
          onClose={() => { setPending(null); void refreshMyCountry(); }}
        />
      )}
    </div>
  );
}
