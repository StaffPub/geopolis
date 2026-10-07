/**
 * GEOPOLIS — Panneau administrateur : dashboard, utilisateurs, pays,
 * simulation & intégrité. Toutes les données viennent des routes admin
 * protégées côté serveur (ADMIN_EMAIL).
 */
import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { admin } from '../../lib/api';
import { useAuth } from '../../state/AuthContext.js';
import { useGame } from '../../state/GameContext.js';
import { Badge, GlassCard, KeyValue, SectionTitle, Spinner, EmptyState } from '../../components/ui.js';
import { BackButton } from '../../components/BackButton.js';
import { worldDate, RESOURCE_KEYS, RESOURCE_MAP } from 'shared';

/* ------------------------------- Layout ------------------------------- */

export function AdminLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && user.role !== 'admin') navigate('/game');
  }, [user, navigate]);

  if (!user || user.role !== 'admin') {
    return (
      <div className="page">
        <GlassCard><EmptyState title="Accès refusé" hint="Le rôle administrateur est vérifié côté serveur." icon="⛔" /></GlassCard>
      </div>
    );
  }

  const links = [
    { to: '/admin', label: 'Dashboard', end: true },
    { to: '/admin/users', label: 'Utilisateurs' },
    { to: '/admin/countries', label: 'Pays' },
    { to: '/admin/simulation', label: 'Simulation' },
  ];

  return (
    <div className="page">
      <div className="mb-16"><BackButton to="/game" label="Retour au jeu" /></div>
      <SectionTitle right={<Badge tone="pink">ADMINISTRATION</Badge>}>Panneau administrateur</SectionTitle>
      <div className="tabs mb-16">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            {l.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}

/* ------------------------------- Dashboard ------------------------------- */

export function AdminDashboard() {
  const [data, setData] = useState<Record<string, never> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    admin.overview().then((d) => setData(d as Record<string, never>)).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 10_000);
    return () => window.clearInterval(t);
  }, [load]);

  if (error) return <GlassCard><p style={{ color: 'var(--danger)' }}>{error}</p></GlassCard>;
  if (!data) return <Spinner label="Chargement de la supervision…" />;

  const d = data as unknown as {
    users: number; usersSuspended: number; playersOnline: number; countriesControlled: number;
    botsActive: number; engine: { running: boolean; leader: boolean; tick: number; day: number; lastTickDurationMs: number; lastTickAt: number; worldVersion: number; storage: string };
    actors: { total: number; humans: number; ai: number }; worldVersion: number; nations: number;
    lastError: string | null; integrityIssues: number; routes: number; events: number;
  };

  const lastTickAgo = Math.max(0, Math.round((Date.now() - d.engine.lastTickAt) / 1000));

  return (
    <div className="col">
      <div className="grid grid-4 stagger">
        <GlassCard><div className="tiny muted">UTILISATEURS</div><div style={{ fontSize: '1.8rem', fontWeight: 800 }}>{d.users}</div><div className="tiny muted">{d.usersSuspended} suspendu(s)</div></GlassCard>
        <GlassCard><div className="tiny muted">JOUEURS EN LIGNE</div><div style={{ fontSize: '1.8rem', fontWeight: 800 }}>{d.playersOnline}</div></GlassCard>
        <GlassCard><div className="tiny muted">PAYS CONTRÔLÉS</div><div style={{ fontSize: '1.8rem', fontWeight: 800 }}>{d.countriesControlled}</div><div className="tiny muted">{d.botsActive} dirigés par l'IA</div></GlassCard>
        <GlassCard><div className="tiny muted">MOTEUR</div><div style={{ fontSize: '1.8rem', fontWeight: 800, color: d.engine.running ? 'var(--good)' : 'var(--danger)' }}>{d.engine.running ? (d.engine.leader ? 'RUNNING' : 'STANDBY') : 'STOPPÉ'}</div><div className="tiny muted">tick {d.engine.tick} · {worldDate(d.engine.day)}</div></GlassCard>
      </div>

      <GlassCard>
        <h3>Supervision (spec §86)</h3>
        <div className="grid grid-2">
          <div>
            <KeyValue k="World State" v={<Badge tone="good">OK</Badge>} />
            <KeyValue k="Simulation" v={d.engine.running ? <Badge tone="good">RUNNING</Badge> : <Badge tone="danger">ARRÊTÉE</Badge>} />
            <KeyValue k="WebSocket" v={<Badge tone={d.playersOnline >= 0 ? 'good' : 'warn'}>{d.playersOnline} CLIENT(S)</Badge>} />
            <KeyValue k="Storage" v={<Badge tone="good">{(d.engine.storage ?? 'upstash/file').toUpperCase()}</Badge>} />
          </div>
          <div>
            <KeyValue k="Countries" v={`${d.nations} / 36`} />
            <KeyValue k="Players" v={d.actors.humans} />
            <KeyValue k="Bots actifs" v={d.actors.ai} />
            <KeyValue k="Last Tick" v={`${lastTickAgo}s ago (${d.engine.lastTickDurationMs} ms)`} />
            <KeyValue k="World version" v={d.worldVersion} />
            <KeyValue k="Routes commerciales" v={d.routes} />
            <KeyValue k="Événements actifs" v={d.events} />
            <KeyValue k="Corrections d'intégrité" v={d.integrityIssues} />
            <KeyValue k="Last Error" v={d.lastError ? <span style={{ color: 'var(--danger)' }}>{d.lastError}</span> : <Badge tone="good">NONE</Badge>} />
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

/* ------------------------------- Utilisateurs ------------------------------- */

export function AdminUsers() {
  const { pushToast } = useGame();
  const [users, setUsers] = useState<Awaited<ReturnType<typeof admin.users>>['users']>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    admin.users(q).then((r) => setUsers(r.users)).catch(() => undefined).finally(() => setLoading(false));
  }, [q]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      pushToast({ kind: 'success', title: msg });
      load();
    } catch (e) {
      pushToast({ kind: 'error', title: 'Échec', body: String(e) });
    }
  };

  return (
    <div className="col">
      <div className="row">
        <input className="input" style={{ maxWidth: 320 }} placeholder="Rechercher (pseudo ou email)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un utilisateur" />
        <button className="btn btn-sm" onClick={load}>Rafraîchir</button>
      </div>
      <GlassCard>
        {loading && <Spinner />}
        <div className="table-wrap">
          <table className="data responsive">
            <thead><tr><th>Pseudo</th><th>Email</th><th>Rôle</th><th>Pays</th><th>Statut</th><th>Inscrit</th><th>Actions</th></tr></thead>
            <tbody>
              {users.map((u) => {
                const cooldownActive = (u.countryCooldownUntil ?? 0) > Date.now();
                return (
                <tr key={u.id}>
                  <td data-label="Pseudo"><strong>{u.username}</strong></td>
                  <td data-label="Email" className="tiny">{u.email}</td>
                  <td data-label="Rôle">{u.role === 'admin' ? <Badge tone="pink">ADMIN</Badge> : 'user'}</td>
                  <td data-label="Pays" className="tiny">{u.countryId ?? '—'}</td>
                  <td data-label="Statut">
                    {u.suspended ? <Badge tone="danger">SUSPENDU</Badge> : <Badge tone="good">ACTIF</Badge>}
                    {cooldownActive && (
                      <span style={{ marginLeft: 6 }}>
                        <Badge tone="warn">COOLDOWN {Math.ceil(((u.countryCooldownUntil ?? 0) - Date.now()) / 3600_000)} h</Badge>
                      </span>
                    )}
                  </td>
                  <td data-label="Inscrit" className="tiny">{new Date(u.createdAt).toLocaleDateString('fr-FR')}</td>
                  <td data-label="Actions">
                    <span className="row" style={{ gap: 4 }}>
                      {u.suspended ? (
                        <button className="btn btn-sm btn-good" onClick={() => void act(() => admin.reactivate(u.id), 'Utilisateur réactivé')}>Réactiver</button>
                      ) : (
                        <button className="btn btn-sm btn-danger" onClick={() => void act(() => admin.suspend(u.id), 'Utilisateur suspendu')}>Suspendre</button>
                      )}
                      {cooldownActive && (
                        <button className="btn btn-sm" onClick={() => void act(() => admin.clearCooldown(u.id), 'Cooldown purgé')}>Purger cooldown</button>
                      )}
                      <button className="btn btn-sm" onClick={() => { if (window.confirm(`Supprimer définitivement ${u.username} ? Son pays repassera à l'IA.`)) void act(() => admin.deleteUser(u.id), 'Utilisateur supprimé'); }}>Supprimer</button>
                    </span>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && users.length === 0 && <EmptyState title="Aucun utilisateur" />}
      </GlassCard>
    </div>
  );
}

/* ------------------------------- Pays ------------------------------- */

export function AdminCountries() {
  const { pushToast, countries: pubCountries } = useGame();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [vars, setVars] = useState<Record<string, number>>({});
  const [granting, setGranting] = useState<string | null>(null);
  const [grant, setGrant] = useState<{ cash: string; debt: string; popularity: string; stability: string; resource: string; units: string }>({
    cash: '', debt: '', popularity: '', stability: '', resource: 'food', units: '',
  });

  const load = useCallback(() => {
    setLoading(true);
    admin.countries().then((r) => setRows(r.countries)).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitGrant = () => {
    if (!granting) return;
    const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
    const payload: { cash?: number; debt?: number; popularity?: number; stability?: number; resources?: Record<string, number> } = {};
    const cash = num(grant.cash); if (cash !== undefined && Number.isFinite(cash)) payload.cash = cash;
    const debt = num(grant.debt); if (debt !== undefined && Number.isFinite(debt)) payload.debt = debt;
    const pop = num(grant.popularity); if (pop !== undefined && Number.isFinite(pop)) payload.popularity = pop;
    const stab = num(grant.stability); if (stab !== undefined && Number.isFinite(stab)) payload.stability = stab;
    const units = num(grant.units);
    if (units !== undefined && Number.isFinite(units) && units !== 0 && grant.resource) {
      payload.resources = { [grant.resource]: units };
    }
    if (Object.keys(payload).length === 0) {
      pushToast({ kind: 'error', title: 'Rien à octroyer', body: 'Renseignez au moins un delta non nul.' });
      return;
    }
    void admin.grant(granting, payload).then((r) => {
      pushToast({ kind: 'success', title: 'Octroi appliqué', body: r.applied.join(' · ') });
      setGranting(null);
      load();
    }).catch((e) => pushToast({ kind: 'error', title: 'Échec', body: String(e) }));
  };

  return (
    <div className="col">
      <GlassCard>
        <div className="row-between mb-8">
          <h3 style={{ margin: 0 }}>Les 36 nations</h3>
          <button className="btn btn-sm" onClick={load}>Rafraîchir</button>
        </div>
        {loading && <Spinner />}
        <div className="table-wrap">
          <table className="data responsive">
            <thead><tr><th>Nation</th><th>Contrôle</th><th>PIB</th><th>Trésorerie</th><th>Dette</th><th>Stratégie IA</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const id = String(r['id']);
                const pub = pubCountries.find((c) => c.id === id);
                return (
                  <tr key={id}>
                    <td data-label="Nation">
                      <span className="row" style={{ gap: 8 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 3, background: pub?.color ?? '#888', display: 'inline-block' }} aria-hidden />
                        <strong>{String(r['name'])}</strong>
                      </span>
                    </td>
                    <td data-label="Contrôle">
                      <Badge tone={r['controllerKind'] === 'player' ? 'violet' : 'info'}>
                        {r['controllerKind'] === 'player' ? `JOUEUR (${String(r['presidentName'])})` : `IA (${String(r['presidentName'])})`}
                      </Badge>
                    </td>
                    <td data-label="PIB" className="mono">{Number(r['gdp']).toFixed(0)} Md</td>
                    <td data-label="Trésorerie" className="mono">{Number(r['cash']).toFixed(1)} Md</td>
                    <td data-label="Dette" className="mono">{(Number(r['debt']) / Math.max(1, Number(r['gdp'])) * 100).toFixed(0)} %</td>
                    <td data-label="Stratégie" className="tiny">{String(r['aiStrategy'])}</td>
                    <td data-label="Actions">
                      <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                        {r['controllerKind'] === 'player' && (
                          <>
                            <button className="btn btn-sm btn-danger" onClick={() => void admin.forceAi(id).then(() => { pushToast({ kind: 'success', title: 'Contrôle IA forcé' }); load(); })}>Forcer IA</button>
                            <button
                              className="btn btn-sm btn-danger"
                              style={{ borderColor: 'rgba(244,114,182,0.5)' }}
                              onClick={() => {
                                if (window.confirm(`EXCLURE ${String(r['presidentName'])} de ${String(r['name'])} ? Le pays repasse à l'IA et le joueur écope de 4 jours réels de cooldown avant tout nouveau mandat.`)) {
                                  void admin.expel(id).then(() => { pushToast({ kind: 'success', title: 'Joueur exclu', body: 'Pays rendu à l’IA · cooldown de 4 jours appliqué au joueur.' }); load(); })
                                    .catch((e) => pushToast({ kind: 'error', title: 'Échec', body: String(e) }));
                                }
                              }}
                            >
                              ⛔ Expulser
                            </button>
                          </>
                        )}
                        <button className="btn btn-sm" onClick={() => { setEditing(id); setVars({ cash: Number(r['cash']), popularity: Number(r['popularity']), stability: Number(r['stability']) }); }}>Variables</button>
                        <button
                          className="btn btn-sm btn-good"
                          onClick={() => { setGranting(id); setGrant({ cash: '', debt: '', popularity: '', stability: '', resource: 'food', units: '' }); }}
                        >
                          🎁 Octroyer
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="glass modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Modifier les variables — {editing}</h3>
              <button className="modal-close" onClick={() => setEditing(null)}>✕</button>
            </div>
            {['cash', 'popularity', 'stability', 'inflation', 'unemployment'].map((k) => (
              <div className="field" key={k}>
                <label htmlFor={`var-${k}`}>{k}</label>
                <input id={`var-${k}`} className="input" type="number" step="0.1" value={vars[k] ?? ''} onChange={(e) => setVars((v) => ({ ...v, [k]: Number(e.target.value) }))} />
              </div>
            ))}
            <button
              className="btn btn-primary btn-block"
              onClick={() => {
                const payload: Record<string, number> = {};
                for (const [k, v] of Object.entries(vars)) if (Number.isFinite(v)) payload[k] = v;
                void admin.editVariables(editing, payload).then((r) => {
                  pushToast({ kind: 'success', title: 'Variables appliquées', body: r.corrections.length ? `Corrections : ${r.corrections.join(', ')}` : undefined });
                  setEditing(null);
                  load();
                }).catch((e) => pushToast({ kind: 'error', title: 'Échec', body: String(e) }));
              }}
            >
              Appliquer (validation serveur)
            </button>
          </div>
        </div>
      )}

      {granting && (
        <div className="modal-backdrop" onClick={() => setGranting(null)}>
          <div className="glass modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🎁 Octroyer / retirer — {rows.find((r) => String(r['id']) === granting)?.['name'] as string ?? granting}</h3>
              <button className="modal-close" onClick={() => setGranting(null)}>✕</button>
            </div>
            <p className="tiny muted">
              Deltas (positif = donner, négatif = retirer). Trésorerie/dette en Md €, popularité/stabilité en points,
              ressources en unités (bornées par les entrepôts du pays). Chaque octroi est journalisé et audité.
            </p>
            <div className="field">
              <label htmlFor="grant-cash">Trésorerie (Md €)</label>
              <input id="grant-cash" className="input" type="number" step="0.5" placeholder="ex : 50 ou -20" value={grant.cash} onChange={(e) => setGrant((g) => ({ ...g, cash: e.target.value }))} />
            </div>
            <div className="field">
              <label htmlFor="grant-debt">Dette (Md €)</label>
              <input id="grant-debt" className="input" type="number" step="1" placeholder="ex : -100 (effacer) ou 50" value={grant.debt} onChange={(e) => setGrant((g) => ({ ...g, debt: e.target.value }))} />
            </div>
            <div className="field">
              <label htmlFor="grant-pop">Popularité (points)</label>
              <input id="grant-pop" className="input" type="number" step="1" min={-100} max={100} placeholder="ex : 10 ou -5" value={grant.popularity} onChange={(e) => setGrant((g) => ({ ...g, popularity: e.target.value }))} />
            </div>
            <div className="field">
              <label htmlFor="grant-stab">Stabilité (points)</label>
              <input id="grant-stab" className="input" type="number" step="1" min={-100} max={100} placeholder="ex : 5" value={grant.stability} onChange={(e) => setGrant((g) => ({ ...g, stability: e.target.value }))} />
            </div>
            <div className="row" style={{ gap: 10 }}>
              <div className="field flex1">
                <label htmlFor="grant-res">Ressource</label>
                <select id="grant-res" className="input" value={grant.resource} onChange={(e) => setGrant((g) => ({ ...g, resource: e.target.value }))}>
                  {RESOURCE_KEYS.map((k) => (
                    <option key={k} value={k}>{RESOURCE_MAP[k].name} ({RESOURCE_MAP[k].unit})</option>
                  ))}
                </select>
              </div>
              <div className="field flex1">
                <label htmlFor="grant-units">Unités (+/−)</label>
                <input id="grant-units" className="input" type="number" step="10" placeholder="ex : 200 ou -50" value={grant.units} onChange={(e) => setGrant((g) => ({ ...g, units: e.target.value }))} />
              </div>
            </div>
            <button className="btn btn-primary btn-block" onClick={submitGrant}>
              Appliquer l’octroi (validation serveur)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Simulation ------------------------------- */

export function AdminSimulation() {
  const { pushToast } = useGame();
  const [data, setData] = useState<Awaited<ReturnType<typeof admin.simulation>> | null>(null);
  const [reseedText, setReseedText] = useState('');

  const load = useCallback(() => {
    admin.simulation().then(setData).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 10_000);
    return () => window.clearInterval(t);
  }, [load]);

  if (!data) return <Spinner label="Chargement de l'état du moteur…" />;

  const validationOk = data.validation === 'OK';

  return (
    <div className="col">
      <div className="grid grid-2">
        <GlassCard>
          <h3>État du moteur</h3>
          <KeyValue k="Statut" v={data.engine.running ? (data.engine.leader ? 'RUNNING (leader)' : 'STANDBY (non-leader)') : 'STOPPÉ'} />
          <KeyValue k="Dernier tick" v={`${data.meta.tick} (jour ${data.meta.day})`} />
          <KeyValue k="Durée dernier tick" v={`${data.meta.lastTickDurationMs} ms`} />
          <KeyValue k="Intervalle" v={`${data.engine.tickIntervalMs} ms`} />
          <KeyValue k="Version monde" v={data.meta.version} />
          <KeyValue k="Version simulation" v={data.meta.simVersion} />
          <KeyValue k="Clients WS" v={data.wsClients} />
          <KeyValue k="Humains en ligne" v={data.actors.humans} />
          <KeyValue k="IA actives" v={data.actors.ai} />
          <KeyValue k="Storage" v={data.engine.storage ?? '—'} />
        </GlassCard>

        <GlassCard>
          <h3>Intégrité des données</h3>
          <KeyValue k="Validation" v={validationOk ? <Badge tone="good">OK</Badge> : <Badge tone="danger">{(data.validation as string[]).length} PROBLÈME(S)</Badge>} />
          <KeyValue k="Corrections cumulées" v={data.meta.integrityIssues} />
          <KeyValue k="Dernière erreur" v={data.meta.lastError ?? 'NONE'} />
          {!validationOk && (
            <pre className="tiny" style={{ maxHeight: 180, overflow: 'auto', background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 8 }}>
              {(data.validation as string[]).join('\n')}
            </pre>
          )}
          <div className="row wrap mt-8">
            <button className="btn btn-sm" onClick={() => void admin.integrityCheck().then((r) => pushToast({ kind: r.ok ? 'success' : 'error', title: r.ok ? 'Intégrité OK' : `${r.problems.length} problème(s)` }))}>Vérifier</button>
            <button className="btn btn-sm btn-good" onClick={() => void admin.integrityRepair().then((r) => { pushToast({ kind: 'success', title: `Réparation : ${r.fixed} valeur(s)` }); load(); })}>Réparer</button>
            <button className="btn btn-sm" onClick={() => void admin.resync().then(() => pushToast({ kind: 'success', title: 'Resynchronisation diffusée' }))}>Resync clients</button>
            <button className="btn btn-sm" onClick={() => void admin.forceTick(1).then(() => { pushToast({ kind: 'success', title: 'Tick forcé' }); load(); })}>Forcer 1 tick</button>
          </div>
        </GlassCard>
      </div>

      <GlassCard>
        <h3>Dernières décisions IA</h3>
        {data.aiDecisions.length === 0 && <EmptyState title="Aucune décision enregistrée" />}
        <div className="table-wrap">
          <table className="data responsive">
            <thead><tr><th>Jour</th><th>Pays</th><th>Problème</th><th>Action</th><th>Rationale</th></tr></thead>
            <tbody>
              {data.aiDecisions.slice(-20).reverse().map((d) => (
                <tr key={d.id}>
                  <td data-label="Jour" className="mono">{d.day}</td>
                  <td data-label="Pays">{d.countryId}</td>
                  <td data-label="Problème" className="tiny">{d.problem}</td>
                  <td data-label="Action" className="tiny mono">{d.action}</td>
                  <td data-label="Rationale" className="tiny">{d.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <GlassCard style={{ borderLeft: '3px solid var(--danger)' }}>
        <h3 style={{ color: 'var(--danger)' }}>Zone dangereuse — réinitialisation du monde</h3>
        <p className="small">
          Reconstruit le monde depuis le seed déterministe. <strong>Toutes les évolutions seront perdues</strong> et les
          joueurs devront choisir une nouvelle nation. Tapez <code>RESEED WORLD</code> pour confirmer.
        </p>
        <div className="row wrap">
          <input className="input" style={{ maxWidth: 260 }} placeholder="RESEED WORLD" value={reseedText} onChange={(e) => setReseedText(e.target.value)} aria-label="Confirmation de réinitialisation" />
          <button
            className="btn btn-danger"
            disabled={reseedText !== 'RESEED WORLD'}
            onClick={() => {
              if (!window.confirm('Réinitialiser TOUT le monde ? Action irréversible.')) return;
              void admin.reseed(reseedText).then(() => { pushToast({ kind: 'success', title: 'Monde réinitialisé' }); load(); });
            }}
          >
            Réinitialiser le monde
          </button>
        </div>
      </GlassCard>

      <GlassCard>
        <h3>Audit récent</h3>
        <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
          <table className="data responsive">
            <thead><tr><th>Heure</th><th>Acteur</th><th>Type</th><th>Détail</th><th>Résultat</th></tr></thead>
            <tbody>
              {data.recentAudit.map((a) => (
                <tr key={a.id}>
                  <td data-label="Heure" className="tiny mono">{new Date(a.ts).toLocaleString('fr-FR')}</td>
                  <td data-label="Acteur" className="tiny">{a.actorName}</td>
                  <td data-label="Type" className="tiny mono">{a.type}</td>
                  <td data-label="Détail" className="tiny">{a.detail}</td>
                  <td data-label="Résultat"><Badge tone={a.result === 'ok' ? 'good' : a.result === 'rejected' ? 'warn' : 'danger'}>{a.result}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  );
}
