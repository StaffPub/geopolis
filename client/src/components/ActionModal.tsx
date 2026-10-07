/**
 * GEOPOLIS — Modale de confirmation d'action : affiche les EFFETS ESTIMÉS
 * calculés par le SERVEUR avant confirmation, puis le résultat réel.
 */
import { useEffect, useState } from 'react';
import type { ActionEstimate, ActionParams, ActionResult } from 'shared';
import { useGame } from '../state/GameContext.js';
import { Modal, Spinner } from './ui.js';

interface Props {
  countryId: string;
  params: ActionParams | null;
  title: string;
  description?: string;
  onClose: () => void;
}

export function ActionModal({ countryId, params, title, description, onClose }: Props) {
  const { estimateAction, runAction } = useGame();
  const [estimates, setEstimates] = useState<ActionEstimate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  useEffect(() => {
    if (!params) return;
    let cancelled = false;
    setEstimates(null);
    setError(null);
    void estimateAction(countryId, params).then((res) => {
      if (cancelled) return;
      if (res.ok) setEstimates(res.effects ?? []);
      else setError(res.error ?? 'Action impossible');
    });
    return () => {
      cancelled = true;
    };
  }, [countryId, params, estimateAction]);

  const confirm = async () => {
    if (!params || busy) return;
    setBusy(true);
    try {
      const res = await runAction(countryId, params);
      setResult(res);
      if (res.ok) {
        window.setTimeout(onClose, 1400);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={result?.ok ? '✓ Action appliquée' : title}
      onClose={onClose}
      footer={
        result ? (
          <button className="btn" onClick={onClose}>Fermer</button>
        ) : (
          <>
            <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
            <button className="btn btn-primary" onClick={() => void confirm()} disabled={busy || !!error || !estimates}>
              {busy ? 'Application…' : 'Confirmer'}
            </button>
          </>
        )
      }
    >
      {description && <p className="small">{description}</p>}

      {result && result.ok && (
        <div className="anim-scale-in">
          <p style={{ color: 'var(--good)', fontWeight: 700 }}>{result.message}</p>
          {result.effects && result.effects.length > 0 && (
            <div className="col mt-8">
              {result.effects.map((e, i) => (
                <div key={i} className="row-between small">
                  <span className="muted">{e.label}</span>
                  <span style={{ color: e.positive ? 'var(--good)' : 'var(--danger)', fontWeight: 600 }}>{e.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {result && !result.ok && (
        <p style={{ color: 'var(--danger)' }}>{result.error}</p>
      )}

      {!result && error && (
        <p style={{ color: 'var(--danger)' }}>{error}</p>
      )}

      {!result && !error && !estimates && <Spinner label="Calcul des effets par le serveur…" />}

      {!result && !error && estimates && (
        <div className="anim-fade-up">
          <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 8 }}>
            Effets estimés (serveur)
          </div>
          <div className="col">
            {estimates.length === 0 && <span className="small muted">Aucun effet chiffré — action validée par le serveur.</span>}
            {estimates.map((e, i) => (
              <div key={i} className="row-between small" style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span className="muted">{e.label}</span>
                <span style={{ color: e.positive ? 'var(--good)' : 'var(--danger)', fontWeight: 600, textAlign: 'right' }}>{e.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
