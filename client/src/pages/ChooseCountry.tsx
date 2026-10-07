/**
 * GEOPOLIS — CHOISISSEZ VOTRE NATION : les 36 pays avec leur état réel,
 * statut LIBRE / DIRIGÉ PAR UN JOUEUR, difficulté, stratégie IA actuelle.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney, formatPopulation } from 'shared';
import { useAuth } from '../state/AuthContext.js';
import { useGame } from '../state/GameContext.js';
import { ApiError, game } from '../lib/api';
import { Badge, GlassCard, Modal, ProgressBar, Spinner } from '../components/ui.js';

const STRATEGY_LABEL: Record<string, string> = {
  industrielle: 'Industrie',
  commerciale: 'Commerce',
  ressources: 'Ressources',
  innovation: 'Innovation',
  agricole: 'Agriculture',
  équilibrée: 'Équilibrée',
  sociale: 'Social',
  financière: 'Finance',
};

export function ChooseCountry() {
  const { user, countryId, setCountryId, refresh } = useAuth();
  const { countries, pushToast, meta } = useGame();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('all');
  const [pending, setPending] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /* Compte à rebours du cooldown de retour (rafraîchi chaque minute). */
  const [, setCooldownTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setCooldownTick((v) => v + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const cooldownUntil = user?.countryCooldownUntil ?? 0;
  const cooldownLeft = cooldownUntil - Date.now();
  const onCooldown = cooldownLeft > 0;
  const cooldownLabel = onCooldown
    ? (() => {
        const totalH = Math.ceil(cooldownLeft / 3600_000);
        const d = Math.floor(totalH / 24);
        const h = totalH % 24;
        return d > 0 ? `${d} jour${d > 1 ? 's' : ''} et ${h} h` : `${h} h`;
      })()
    : '';

  const regions = useMemo(() => [...new Set(countries.map((c) => c.region))].sort(), [countries]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return countries.filter(
      (c) =>
        (regionFilter === 'all' || c.region === regionFilter) &&
        (q === '' || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)),
    );
  }, [countries, filter, regionFilter]);

  const claim = async (id: string) => {
    setPending(id);
    try {
      await game.claim(id);
      setCountryId(id);
      await refresh();
      pushToast({ kind: 'success', title: 'Vous êtes au pouvoir', body: `Le peuple vous attend. Bonne chance, Président.` });
      navigate('/game');
    } catch (e) {
      pushToast({ kind: 'error', title: 'Impossible de prendre ce pays', body: e instanceof ApiError ? e.message : 'Erreur' });
    } finally {
      setPending(null);
      setConfirmId(null);
    }
  };

  const release = async () => {
    if (!countryId) return;
    setPending('release');
    try {
      await game.release(countryId);
      setCountryId(null);
      await refresh();
      pushToast({ kind: 'info', title: 'Pays libéré', body: 'Le gouvernement IA a repris la main. Cooldown de 4 jours réels avant de pouvoir reprendre un pays.' });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Erreur', body: e instanceof ApiError ? e.message : 'Erreur' });
    } finally {
      setPending(null);
    }
  };

  if (countries.length === 0) return <div className="page"><Spinner label="Chargement du monde…" /></div>;

  const myCountry = countryId ? countries.find((c) => c.id === countryId) : null;

  return (
    <div className="page">
      <div className="page-title-row">
        <div>
          <h1>CHOISISSEZ VOTRE NATION</h1>
          <p className="small muted">
            {countries.filter((c) => c.controllerKind === 'ai').length} nations libres · {countries.filter((c) => c.controllerKind === 'player').length} dirigée(s) par des joueurs
            {meta ? ` · monde au jour ${meta.day}` : ''}
          </p>
        </div>
        {myCountry && (
          <div className="row">
            <Badge tone="violet">Vous dirigez : {myCountry.name}</Badge>
            <button className="btn btn-sm" onClick={() => navigate('/game')}>Tableau de bord</button>
            <button className="btn btn-sm btn-danger" disabled={pending === 'release'} onClick={() => void release()}>
              {pending === 'release' ? 'Libération…' : 'Quitter le pays'}
            </button>
          </div>
        )}
      </div>

      {onCooldown && !countryId && (
        <GlassCard className="mb-16 anim-fade-up" style={{ borderLeft: '3px solid var(--danger)' }}>
          <div className="row" style={{ gap: 10 }}>
            <span aria-hidden style={{ fontSize: '1.3rem' }}>⏳</span>
            <p className="small" style={{ margin: 0 }}>
              <strong>Cooldown de retour actif.</strong> Vous avez quitté (ou perdu) un pays récemment :
              un nouveau mandat sera possible dans <strong style={{ color: 'var(--danger)' }}>{cooldownLabel}</strong>.
              Cette règle (4 jours réels) empêche de sauter d'un pays à l'autre pour transférer de la valeur.
              En attendant, vous pouvez explorer le monde en observateur.
            </p>
          </div>
        </GlassCard>
      )}

      <div className="row wrap mb-16" style={{ gap: 10 }}>
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="Rechercher une nation…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Rechercher une nation"
        />
        <select className="input" style={{ maxWidth: 240 }} value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} aria-label="Filtrer par région">
          <option value="all">Toutes les régions</option>
          {regions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-3 stagger">
        {filtered.map((c) => {
          const taken = c.controllerKind === 'player';
          const mine = c.id === countryId;
          return (
            <GlassCard key={c.id} className="anim-fade-up" style={{ borderLeft: `3px solid ${c.color}` }}>
              <div className="row-between">
                <div className="row" style={{ gap: 10 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 4, background: c.color, display: 'inline-block' }} aria-hidden />
                  <strong style={{ fontSize: '1.05rem' }}>{c.name}</strong>
                  <span className="tiny muted">{c.code}</span>
                </div>
                {mine ? (
                  <Badge tone="violet">VOTRE PAYS</Badge>
                ) : taken ? (
                  <Badge tone="danger">DIRIGÉ PAR UN JOUEUR</Badge>
                ) : (
                  <Badge tone="good">LIBRE</Badge>
                )}
              </div>
              <div className="tiny muted mt-8">{c.region}</div>

              <div className="grid grid-2 mt-8" style={{ gap: 8 }}>
                <div>
                  <div className="tiny muted">Population</div>
                  <div className="small mono" style={{ fontWeight: 700 }}>{formatPopulation(c.population)}</div>
                </div>
                <div>
                  <div className="tiny muted">PIB</div>
                  <div className="small mono" style={{ fontWeight: 700 }}>{formatMoney(c.gdp)}</div>
                </div>
                <div>
                  <div className="tiny muted">Croissance</div>
                  <div className="small mono" style={{ fontWeight: 700, color: c.growth >= 0 ? 'var(--good)' : 'var(--danger)' }}>
                    {c.growth >= 0 ? '+' : ''}{c.growth.toFixed(1)} %
                  </div>
                </div>
                <div>
                  <div className="tiny muted">Popularité du gouvernement</div>
                  <div className="small mono" style={{ fontWeight: 700 }}>{c.popularity.toFixed(0)} %</div>
                </div>
              </div>

              <div className="mt-8">
                <ProgressBar
                  label={`Difficulté ${c.difficulty}/5`}
                  value={c.difficulty}
                  max={5}
                  tone={c.difficulty <= 2 ? 'good' : c.difficulty <= 3 ? 'warn' : 'danger'}
                  height={6}
                />
              </div>

              <div className="tiny muted mt-8">
                Président actuel : <strong style={{ color: 'var(--text-1)' }}>{c.presidentName}</strong>{' '}
                {taken ? '(joueur)' : '(dirigeant IA)'}
              </div>
              <div className="tiny muted mt-8">
                Stratégie : <Badge tone="info">{STRATEGY_LABEL[c.strategy] ?? c.strategy}</Badge>
              </div>

              {!mine && !taken && (
                <button
                  className="btn btn-primary btn-block mt-8"
                  disabled={pending !== null || !!countryId || onCooldown}
                  onClick={() => setConfirmId(c.id)}
                  title={countryId ? 'Libérez d’abord votre pays actuel' : onCooldown ? `Cooldown de retour : encore ${cooldownLabel}` : `Prendre la tête de ${c.name}`}
                >
                  {countryId ? 'Libérez d’abord votre pays' : onCooldown ? `Cooldown : ${cooldownLabel}` : 'Prendre le pouvoir'}
                </button>
              )}
              {mine && (
                <button className="btn btn-block mt-8" onClick={() => navigate('/game')}>Ouvrir le tableau de bord</button>
              )}
            </GlassCard>
          );
        })}
      </div>

      {confirmId && (
        <Modal
          title={`Prendre la tête de ${countries.find((c) => c.id === confirmId)?.name} ?`}
          onClose={() => setConfirmId(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmId(null)}>Annuler</button>
              <button className="btn btn-primary btn-rocket" disabled={pending !== null} onClick={() => void claim(confirmId)}>
                <span className="rk" aria-hidden>🚀</span>{pending ? 'Investiture…' : 'Accepter le mandat'}
              </button>
            </>
          }
        >
          <p className="small">
            Vous succéderez au gouvernement IA. Vous serez responsable de la fiscalité, du budget, des
            infrastructures, des lois et de la diplomatie de cette nation.
          </p>
          <p className="small" style={{ color: 'var(--warn)' }}>
            ⚠ Si votre popularité reste sous 35 % trop longtemps, votre gouvernement tombera et un dirigeant IA
            reprendra la main. L'État, lui, continuera d'exister.
          </p>
        </Modal>
      )}

      <div className="center mt-24">
        <button className="btn" onClick={() => navigate(user?.countryId ? '/game' : '/game/world')}>
          Continuer en mode observateur (Vue monde)
        </button>
      </div>
    </div>
  );
}
