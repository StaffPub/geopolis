/**
 * GEOPOLIS — Page Diplomatie : relations, confiance, accords, propositions,
 * mesures économiques. Aucun système de guerre : tout est économique.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AGREEMENT_TYPES, relationLabel } from 'shared';
import type { AgreementType, ActionParams } from 'shared';
import { useAuth } from '../../state/AuthContext.js';
import { useGame } from '../../state/GameContext.js';
import { ActionModal } from '../../components/ActionModal.js';
import { Badge, EmptyState, GlassCard, Modal, PageHeader, ProgressBar, SectionTitle } from '../../components/ui.js';

interface PendingAction {
  params: ActionParams;
  title: string;
  description?: string;
}

const MIN_RELATION_CLIENT: Record<string, number> = {
  free_trade: 42,
  economic_treaty: 48,
  tech_cooperation: 52,
  trade_zone: 45,
  aid_pact: 38,
};

export function DiplomacyPage() {
  const { countryId } = useAuth();
  const { myCountry, relationsSummary, countries, runAction } = useGame();
  const c = myCountry && myCountry.id === countryId ? myCountry : null;
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [proposalTarget, setProposalTarget] = useState<string | null>(null);
  const [aidTarget, setAidTarget] = useState<string | null>(null);
  const [aidAmount, setAidAmount] = useState(1);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'score' | 'trade' | 'name'>('score');

  const nameOf = useMemo(() => new Map(countries.map((x) => [x.id, x])), [countries]);

  const relations = useMemo(() => {
    if (!relationsSummary.length) return [];
    let list = [...relationsSummary];
    const q = search.toLowerCase();
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q));
    list.sort((a, b) =>
      sortBy === 'score' ? b.score - a.score :
      sortBy === 'trade' ? b.tradeVolume - a.tradeVolume :
      a.name.localeCompare(b.name),
    );
    return list;
  }, [relationsSummary, search, sortBy]);

  if (!c) {
    return (
      <div className="page">
        <SectionTitle>Diplomatie</SectionTitle>
        <GlassCard>
          <EmptyState title="Aucune nation dirigée" hint="Signez des accords et bâtissez des alliances en prenant la tête d'un pays." icon="🤝" />
          <div className="row mt-16" style={{ justifyContent: 'center' }}>
            <Link className="btn btn-primary" to="/countries">Choisir ma nation</Link>
          </div>
        </GlassCard>
      </div>
    );
  }

  const isPlayer = c.controller.kind === 'player';

  const pendingProposals = relationsSummary
    .flatMap((r) => r.agreements.filter((a) => a.status === 'proposed').map((a) => ({ ...a, other: r })))
    .filter((a) => c.relations[a.other.countryId]?.agreements.some((x) => x.id === a.id && x.status === 'proposed'));

  return (
    <div className="page">
      <PageHeader
        icon="🤝"
        title={`Diplomatie — ${c.name}`}
        subtitle="Relations, confiance, accords et mesures économiques avec chacune des 35 autres nations. Proposez un accord, répondez aux propositions, aidez un allié ou imposez des sanctions : chaque geste a un effet RÉEL sur votre commerce et votre stabilité."
        chips={<>
          <Badge tone="good">{Object.values(c.relations).filter((r) => r.agreements.some((a) => a.status === 'active')).length} accord(s) actif(s)</Badge>
          <Badge tone="warn">{pendingProposals.length} proposition(s) reçue(s)</Badge>
          <Badge tone="info">Relation moyenne {(Object.values(c.relations).reduce((s, r) => s + r.score, 0) / Math.max(1, Object.values(c.relations).length)).toFixed(0)}/100</Badge>
        </>}
        right={
          <div className="row">
            <select className="input" style={{ width: 'auto', padding: '6px 10px', minHeight: 34 }} value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} aria-label="Trier les relations">
              <option value="score">Trier : relations</option>
              <option value="trade">Trier : commerce</option>
              <option value="name">Trier : nom</option>
            </select>
            <input className="input" style={{ width: 180, padding: '6px 10px', minHeight: 34 }} placeholder="Rechercher un pays…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher" />
          </div>
        }
      />

      {/* Bandeau résumé */}
      <div className="diplo-summary stagger mb-16">
        <GlassCard className="card3d">
          <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Accords actifs</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{relationsSummary.reduce((n, r) => n + r.agreements.filter((a) => a.status === 'active').length, 0)}</div>
        </GlassCard>
        <GlassCard className="card3d">
          <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Propositions reçues</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: pendingProposals.length ? 'var(--accent-pink)' : undefined }}>{pendingProposals.length}</div>
        </GlassCard>
        <GlassCard className="card3d">
          <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Mesures éco.</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: relationsSummary.some((r) => r.sanctionByUs || r.sanctionByThem) ? 'var(--danger)' : 'var(--good)' }}>
            {relationsSummary.filter((r) => r.sanctionByUs || r.sanctionByThem).length}
          </div>
        </GlassCard>
        <GlassCard className="card3d">
          <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Relations moyennes</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>
            {(relationsSummary.reduce((n, r) => n + r.score, 0) / Math.max(1, relationsSummary.length)).toFixed(0)}/100
          </div>
        </GlassCard>
      </div>

      {/* Propositions entrantes */}
      {isPlayer && pendingProposals.length > 0 && (
        <GlassCard className="mb-16" style={{ borderLeft: '3px solid var(--accent-pink)' }}>
          <h3>📨 Propositions en attente</h3>
          <div className="col">
            {pendingProposals.map((p) => (
              <div key={p.id} className="row-between small">
                <span>
                  <strong>{p.other.name}</strong> propose : {AGREEMENT_TYPES.find((a) => a.type === p.type)?.name ?? p.type}
                </span>
                <span className="row">
                  <button className="btn btn-sm btn-good" onClick={() => void runAction(c.id, { type: 'respond_proposal', proposalId: p.id, accept: true })}>Accepter</button>
                  <button className="btn btn-sm btn-danger" onClick={() => void runAction(c.id, { type: 'respond_proposal', proposalId: p.id, accept: false })}>Refuser</button>
                </span>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {relations.length === 0 && (
        <GlassCard><EmptyState title="Aucune relation trouvée" /></GlassCard>
      )}

      <div className="grid grid-2 stagger">
        {relations.map((r) => {
          const tone = relationLabel(r.score);
          const rel = c.relations[r.countryId];
          const activeAgreements = r.agreements.filter((a) => a.status === 'active');
          const hasSanction = r.sanctionByUs || r.sanctionByThem;
          return (
            <GlassCard key={r.countryId} className="anim-fade-up rel-card">
              <div className="row-between">
                <div className="row" style={{ gap: 10 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 4, background: r.color, display: 'inline-block' }} aria-hidden />
                  <strong>{r.name}</strong>
                  {hasSanction && <Badge tone="danger">MESURE ÉCONOMIQUE</Badge>}
                </div>
                <Badge tone={tone.tone === 'good' ? 'good' : tone.tone === 'neutral' ? 'neutral' : tone.tone === 'tense' ? 'warn' : 'danger'}>
                  {r.score.toFixed(0)}/100 · {tone.label}
                </Badge>
              </div>

              <div className="grid grid-2 mt-8" style={{ gap: 10 }}>
                <div>
                  <div className="tiny muted">Confiance</div>
                  <ProgressBar value={r.trust} height={6} tone={r.trust >= 60 ? 'good' : r.trust >= 40 ? 'warn' : 'danger'} />
                </div>
                <div>
                  <div className="tiny muted">Commerce bilatéral</div>
                  <div className="small mono" style={{ fontWeight: 700 }}>
                    {r.tradeVolume > 0.005 ? `${(r.tradeVolume * 1000).toFixed(1)} M €/j` : '—'}
                  </div>
                </div>
              </div>

              {(() => {
                const pub = countries.find((x) => x.id === r.countryId);
                const rep = pub ? (pub.popularity + pub.stability) / 2 : 100;
                return rep < 45 ? (
                  <div className="tiny mt-8" style={{ color: 'var(--warn)' }}>
                    ⚠ Partenaire impopulaire ou instable ({rep.toFixed(0)}/100) : signer un accord avec lui peut mécontenter votre opinion.
                  </div>
                ) : null;
              })()}

              {activeAgreements.length > 0 && (
                <div className="col mt-8" style={{ gap: 6 }}>
                  {activeAgreements.map((a) => (
                    <div key={a.id} className="agreement-row">
                      <Badge tone="violet">{AGREEMENT_TYPES.find((t) => t.type === a.type)?.name ?? a.type}</Badge>
                      <span className="tiny muted">en vigueur</span>
                      {isPlayer && (
                        <button
                          className="btn btn-sm btn-danger"
                          style={{ marginLeft: 'auto' }}
                          onClick={() => setPending({ params: { type: 'break_agreement', agreementId: a.id }, title: `Rompre : ${AGREEMENT_TYPES.find((t) => t.type === a.type)?.name ?? a.type}`, description: 'Rupture unilatérale : relations -10, confiance -8. Le partenaire sera notifié.' })}
                        >
                          ✂ Rompre
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {rel?.agreements.some((a) => a.status === 'proposed') && (
                <div className="tiny mt-8" style={{ color: 'var(--accent-pink)' }}>⏳ Proposition en cours…</div>
              )}

              {isPlayer && (
                <div className="row wrap mt-8" style={{ gap: 6 }}>
                  <button className="btn btn-sm" disabled={hasSanction} onClick={() => setProposalTarget(r.countryId)}>
                    Proposer un accord
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => setPending({ params: { type: 'improve_relations', targetId: r.countryId }, title: `Initiative diplomatique envers ${r.name}`, description: 'Un geste officiel pour améliorer durablement vos relations.' })}
                  >
                    Améliorer les relations
                  </button>
                  <button className="btn btn-sm" onClick={() => { setAidTarget(r.countryId); setAidAmount(1); }}>
                    Négocier une aide
                  </button>
                  {r.sanctionByUs ? (
                    <button className="btn btn-sm btn-good" onClick={() => setPending({ params: { type: 'lift_sanction', targetId: r.countryId }, title: `Lever la mesure économique envers ${r.name}` })}>
                      Lever la mesure
                    </button>
                  ) : (
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => setPending({ params: { type: 'impose_sanction', targetId: r.countryId }, title: `Mesure économique envers ${r.name}`, description: 'Suspend les échanges bilatéraux et dégrade fortement les relations. Outil de pression économique — jamais militaire.' })}
                    >
                      Mesure économique
                    </button>
                  )}
                  <Link className="btn btn-sm btn-ghost" to={`/game/trade?partner=${r.countryId}`}>Commerce →</Link>
                </div>
              )}
            </GlassCard>
          );
        })}
      </div>

      {/* Modale : proposer un accord (interface riche et guidée) */}
      {proposalTarget && (
        <Modal
          title={`Proposer un accord à ${nameOf.get(proposalTarget)?.name ?? proposalTarget}`}
          onClose={() => setProposalTarget(null)}
          wide
        >
          <p className="small muted">
            Relation actuelle : <strong style={{ color: 'var(--text-0)' }}>{relationsSummary.find((r) => r.countryId === proposalTarget)?.score.toFixed(0) ?? '?/100'}</strong> ·
            chaque accord exige un niveau minimal de relations. Le partenaire (joueur ou IA) répondra en temps réel.
          </p>
          <div className="grid grid-2 mt-8" style={{ gap: 12 }}>
            {AGREEMENT_TYPES.map((a) => {
              const icon = a.type === 'free_trade' ? '🚢' : a.type === 'economic_treaty' ? '🏛️' : a.type === 'tech_cooperation' ? '🔬' : a.type === 'trade_zone' ? '🗺️' : '🎁';
              const min = MIN_RELATION_CLIENT[a.type];
              const score = relationsSummary.find((r) => r.countryId === proposalTarget)?.score ?? 0;
              const enough = score >= min;
              const already = relationsSummary.find((r) => r.countryId === proposalTarget)?.agreements.some((x) => x.type === a.type && x.status !== 'rejected' && x.status !== 'expired');
              return (
                <div key={a.type} className="deal-card" style={{ opacity: enough && !already ? 1 : 0.72 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <span className="deal-ico" aria-hidden>{icon}</span>
                    <div className="flex1">
                      <strong className="small">{a.name}</strong>
                      <div className="tiny muted mt-8">{a.description}</div>
                    </div>
                  </div>
                  <div className="row-between mt-8">
                    <Badge tone={enough ? 'good' : 'danger'}>
                      {enough ? `Relations OK (${score.toFixed(0)}/${min})` : `Requiert ${min} (actuel ${score.toFixed(0)})`}
                    </Badge>
                  </div>
                  <button
                    className="btn btn-sm btn-primary btn3d btn-block mt-8"
                    disabled={!enough || !!already}
                    title={already ? 'Accord déjà proposé ou actif' : !enough ? 'Améliorez d’abord vos relations (initiative diplomatique)' : `Proposer ${a.name}`}
                    onClick={() => {
                      setPending({
                        params: { type: 'propose_agreement', targetId: proposalTarget, agreementType: a.type as AgreementType },
                        title: `${a.name} — ${nameOf.get(proposalTarget)?.name ?? ''}`,
                        description: a.description,
                      });
                      setProposalTarget(null);
                    }}
                  >
                    {already ? 'Déjà proposé / actif' : 'Proposer'}
                  </button>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {/* Modale : aide économique */}
      {aidTarget && (
        <Modal
          title={`Aide économique à ${nameOf.get(aidTarget)?.name ?? aidTarget}`}
          onClose={() => setAidTarget(null)}
          footer={
            <>
              <button className="btn" onClick={() => setAidTarget(null)}>Annuler</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const amount = Math.min(Math.max(0.5, aidAmount), Math.max(1, (c.economy.gdp * 0.02)));
                  setPending({ params: { type: 'send_aid', targetId: aidTarget, amount }, title: `Aide de ${amount.toFixed(1)} Md €`, description: 'Renforce la confiance, les relations et la stabilité du partenaire.' });
                  setAidTarget(null);
                }}
              >
                Envoyer
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="aid-amount">Montant (Md €) — max {(c.economy.gdp * 0.02).toFixed(1)} Md €</label>
            <input
              id="aid-amount"
              type="range"
              min={0.5}
              max={Math.max(1, c.economy.gdp * 0.02)}
              step={0.5}
              value={aidAmount}
              onChange={(e) => setAidAmount(Number(e.target.value))}
            />
            <div className="center mono" style={{ fontSize: '1.3rem', fontWeight: 800 }}>{aidAmount.toFixed(1)} Md €</div>
            <div className="tiny muted center">Trésorerie disponible : {c.economy.cash.toFixed(1)} Md €</div>
          </div>
        </Modal>
      )}

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
