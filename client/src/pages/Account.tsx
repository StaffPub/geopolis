/**
 * GEOPOLIS — Profil & Paramètres du compte (données réelles serveur).
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext.js';
import { useGame } from '../state/GameContext.js';
import { auth, ApiError, game as gameApi } from '../lib/api';
import { Badge, GlassCard, KeyValue, SectionTitle } from '../components/ui.js';
import { BackButton } from '../components/BackButton.js';
import { worldDate } from 'shared';

export function Profile() {
  const { user, countryId, logout } = useAuth();
  const { countries, myCountry, meta, presence } = useGame();
  const navigate = useNavigate();
  const myPublic = countries.find((c) => c.id === countryId);

  if (!user) return null;

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="mb-16"><BackButton to="/game" label="Retour au tableau de bord" /></div>
      <SectionTitle>Profil</SectionTitle>
      <div className="grid grid-2">
        <GlassCard>
          <h3>Compte</h3>
          <KeyValue k="Pseudo" v={user.username} />
          <KeyValue k="Email" v={user.email} />
          <KeyValue k="Rôle" v={user.role === 'admin' ? <Badge tone="pink">ADMINISTRATEUR</Badge> : 'Joueur'} />
          <KeyValue k="Créé le" v={new Date(user.createdAt).toLocaleDateString('fr-FR')} />
          <KeyValue k="Dernier accès" v={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('fr-FR') : '—'} />
          <KeyValue k="Statut" v={user.suspended ? <Badge tone="danger">SUSPENDU</Badge> : <Badge tone="good">ACTIF</Badge>} />
        </GlassCard>

        <GlassCard>
          <h3>Nation</h3>
          {myPublic ? (
            <>
              <KeyValue k="Pays" v={<span className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: myPublic.color, display: 'inline-block' }} />{myPublic.name}</span>} />
              <KeyValue k="Président" v={myPublic.presidentName} />
              <KeyValue k="Popularité" v={`${myPublic.popularity.toFixed(1)} %`} />
              <KeyValue k="Risque politique" v={myCountry?.mandate.risk ?? '—'} />
              {meta && <KeyValue k="Jour du monde" v={worldDate(meta.day)} />}
              <div className="row mt-16 wrap">
                <Link className="btn btn-sm" to="/game">Tableau de bord</Link>
                <Link className="btn btn-sm" to="/countries">Changer de nation</Link>
              </div>
            </>
          ) : (
            <>
              <p className="small muted">Vous ne dirigez aucune nation actuellement.</p>
              <Link className="btn btn-primary btn-sm" to="/countries">Choisir une nation</Link>
            </>
          )}
        </GlassCard>

        <GlassCard>
          <h3>Présence en ligne</h3>
          <KeyValue k="Joueurs connectés" v={presence.length} />
          <div className="col mt-8">
            {presence.map((p) => (
              <div key={p.userId} className="row-between small">
                <span>{p.username} {p.userId === user.id && <span className="tiny muted">(vous)</span>}</span>
                <span className="tiny muted">{p.countryName ?? 'observateur'}</span>
              </div>
            ))}
            {presence.length === 0 && <span className="small muted">Aucun autre joueur connecté.</span>}
          </div>
        </GlassCard>

        <GlassCard>
          <h3>Session</h3>
          <p className="small muted">La déconnexion libère votre session mais jamais votre pays : le monde continue.</p>
          <button className="btn btn-danger btn-sm" onClick={() => void logout().then(() => navigate('/'))}>Se déconnecter</button>
        </GlassCard>
      </div>
    </div>
  );
}

export function Settings() {
  const { pushToast } = useGame();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(
    () => localStorage.getItem('gp-reduce-motion') === '1',
  );

  const savePassword = async () => {
    if (next.length < 8) {
      pushToast({ kind: 'error', title: 'Mot de passe trop court', body: '8 caractères minimum.' });
      return;
    }
    if (next !== confirm) {
      pushToast({ kind: 'error', title: 'Confirmation différente' });
      return;
    }
    setBusy(true);
    try {
      await auth.changePassword(current, next);
      pushToast({ kind: 'success', title: 'Mot de passe modifié' });
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e) {
      pushToast({ kind: 'error', title: 'Échec', body: e instanceof ApiError ? e.message : 'Erreur' });
    } finally {
      setBusy(false);
    }
  };

  const applyReduceMotion = (v: boolean) => {
    setReduceMotion(v);
    localStorage.setItem('gp-reduce-motion', v ? '1' : '0');
    document.documentElement.style.setProperty('--motion-override', v ? 'reduce' : '');
    if (v) document.documentElement.classList.add('reduce-motion');
    else document.documentElement.classList.remove('reduce-motion');
    pushToast({ kind: 'info', title: v ? 'Animations réduites activées' : 'Animations rétablies' });
  };

  const resync = async () => {
    try {
      await gameApi.worldSnapshot();
      pushToast({ kind: 'success', title: 'Resynchronisation demandée', body: 'Les données du monde ont été rechargées.' });
      window.location.reload();
    } catch {
      pushToast({ kind: 'error', title: 'Serveur injoignable' });
    }
  };

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="mb-16"><BackButton to="/game" label="Retour au tableau de bord" /></div>
      <SectionTitle>Paramètres</SectionTitle>
      <div className="col">
        <GlassCard>
          <h3>Sécurité — changer le mot de passe</h3>
          <div className="field">
            <label htmlFor="cur-pwd">Mot de passe actuel</label>
            <input id="cur-pwd" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="new-pwd">Nouveau mot de passe (8+ caractères)</label>
            <input id="new-pwd" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="conf-pwd">Confirmation</label>
            <input id="conf-pwd" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={() => void savePassword()}>
            {busy ? 'Enregistrement…' : 'Modifier le mot de passe'}
          </button>
        </GlassCard>

        <GlassCard>
          <h3>Accessibilité & affichage</h3>
          <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={reduceMotion} onChange={(e) => applyReduceMotion(e.target.checked)} />
            <span className="small">Réduire les animations (équivalent prefers-reduced-motion)</span>
          </label>
        </GlassCard>

        <GlassCard>
          <h3>Synchronisation</h3>
          <p className="small muted">Force un rechargement complet de l'état du monde depuis le serveur.</p>
          <button className="btn" onClick={() => void resync()}>Resynchroniser le monde</button>
        </GlassCard>
      </div>
    </div>
  );
}
