/**
 * GEOPOLIS — Connexion / Inscription : authentification réelle côté serveur.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../state/AuthContext.js';
import { useGame } from '../state/GameContext.js';

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="page" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 'min(440px, 100%)' }}>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <div className="row center mb-16" style={{ justifyContent: 'center', gap: 10, fontWeight: 900, letterSpacing: '0.14em', color: 'var(--text-0)' }}>
            <span style={{
              width: 30, height: 30, borderRadius: 9,
              background: 'linear-gradient(135deg, #c99b3f, #b06a44)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }} aria-hidden>◈</span>
            GEOPOLIS
          </div>
        </Link>
        <div className="glass glass-card anim-scale-in" style={{ padding: 28 }}>
          <h1 style={{ fontSize: '1.5rem' }}>{title}</h1>
          <p className="small">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const { pushToast } = useGame();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      pushToast({ kind: 'success', title: 'Connexion réussie', body: 'Synchronisation du monde…' });
      navigate('/countries');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de connexion');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Connexion" subtitle="Reprenez la direction de votre nation. Le monde a continué de tourner pendant votre absence.">
      <form onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input id="login-email" className="input" type="email" required autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.com" />
        </div>
        <div className="field">
          <label htmlFor="login-password">Mot de passe</label>
          <input id="login-password" className="input" type="password" required autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        {error && <p style={{ color: 'var(--danger)' }} role="alert">{error}</p>}
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      <p className="small center mt-16">
        Pas encore de compte ? <Link to="/register">Créer un compte</Link>
      </p>
    </AuthShell>
  );
}

export function Register() {
  const { register } = useAuth();
  const { pushToast } = useGame();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }
    setBusy(true);
    try {
      await register(username, email, password);
      pushToast({ kind: 'success', title: 'Compte créé', body: 'Bienvenue, Président. Choisissez votre nation.' });
      navigate('/countries');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de l’inscription');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Créer un compte" subtitle="Rejoignez le monde persistant et prenez la tête d'une des 36 nations.">
      <form onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="reg-username">Pseudo</label>
          <input id="reg-username" className="input" required minLength={3} maxLength={24}
            value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ex. Lucas" autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="reg-email">Email</label>
          <input id="reg-email" className="input" type="email" required autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.com" />
        </div>
        <div className="field">
          <label htmlFor="reg-password">Mot de passe (8 caractères minimum)</label>
          <input id="reg-password" className="input" type="password" required minLength={8} autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        <div className="field">
          <label htmlFor="reg-confirm">Confirmation du mot de passe</label>
          <input id="reg-confirm" className="input" type="password" required minLength={8} autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
        </div>
        {error && <p style={{ color: 'var(--danger)' }} role="alert">{error}</p>}
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
          {busy ? 'Création…' : 'Créer mon compte'}
        </button>
      </form>
      <p className="small center mt-16">
        Déjà inscrit ? <Link to="/login">Se connecter</Link>
      </p>
    </AuthShell>
  );
}
