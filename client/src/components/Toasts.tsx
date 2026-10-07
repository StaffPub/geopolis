/**
 * GEOPOLIS — Toasts : confirmation visuelle de chaque action importante.
 */
import { useGame } from '../state/GameContext.js';

export function Toasts() {
  const { toasts, dismissToast } = useGame();
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)} role="status">
          <div className="row" style={{ gap: 8 }}>
            <span aria-hidden>{t.kind === 'success' ? '✓' : t.kind === 'error' ? '✕' : 'ℹ'}</span>
            <div>
              <div style={{ fontWeight: 700 }}>{t.title}</div>
              {t.body && <div className="tiny muted mt-8" style={{ color: 'var(--text-2)' }}>{t.body}</div>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
