/**
 * GEOPOLIS — Centre de notifications v2.
 * - Onglets « Non lues » / « Toutes » : une notification lue DISPARAÎT de la vue
 *   non-lues avec une animation de sortie (puis reste consultable dans « Toutes »).
 * - Clic sur la carte = marquer lu ; boutons Accepter/Refuser pour les propositions.
 * - Temps réel : les nouvelles notifications arrivent en slide.
 */
import { useState } from 'react';
import { worldDate } from 'shared';
import type { GameNotification } from 'shared';
import { useGame } from '../state/GameContext.js';
import { useAuth } from '../state/AuthContext.js';
import { Drawer, Badge, EmptyState } from './ui.js';

const TYPE_LABEL: Record<string, string> = {
  economy: 'Économie',
  politics: 'Politique',
  diplomacy: 'Diplomatie',
  resources: 'Ressources',
  infrastructure: 'Infrastructure',
  event: 'Événement',
  mandate: 'Mandat',
  trade: 'Commerce',
};

const TYPE_TONE: Record<string, 'good' | 'warn' | 'danger' | 'info' | 'violet' | 'pink' | 'neutral'> = {
  economy: 'info',
  politics: 'violet',
  diplomacy: 'pink',
  resources: 'warn',
  infrastructure: 'neutral',
  event: 'warn',
  mandate: 'danger',
  trade: 'good',
};

const TYPE_ICON: Record<string, string> = {
  economy: '📈',
  politics: '🏛️',
  diplomacy: '🤝',
  resources: '🛢️',
  infrastructure: '🏗️',
  event: '⚡',
  mandate: '🗳️',
  trade: '🚢',
};

export function NotificationCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { notifications, markNotificationRead, markAllNotificationsRead, runAction } = useGame();
  const { countryId } = useAuth();
  const [tab, setTab] = useState<'unread' | 'all'>('unread');
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!open) return null;

  const unread = notifications.filter((n) => !n.read);
  const shown = tab === 'unread' ? unread : notifications;

  const readAndDismiss = (n: GameNotification) => {
    if (n.read) return;
    setLeaving((prev) => new Set(prev).add(n.id));
    window.setTimeout(() => {
      void markNotificationRead(n.id);
      setLeaving((prev) => {
        const next = new Set(prev);
        next.delete(n.id);
        return next;
      });
    }, 260);
  };

  const respond = async (n: GameNotification, accept: boolean) => {
    const target = countryId;
    if (!target || !n.action) return;
    setBusyId(n.id);
    try {
      if (n.action.kind === 'respond_proposal') {
        await runAction(target, { type: 'respond_proposal', proposalId: n.action.proposalId, accept });
      } else {
        await runAction(target, { type: 'respond_delivery', deliveryId: n.action.deliveryId, accept });
      }
      readAndDismiss(n);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Drawer
      title={
        <span className="row" style={{ gap: 10 }}>
          🔔 Notifications
          <Badge tone={unread.length > 0 ? 'pink' : 'neutral'}>{unread.length} non lue{unread.length > 1 ? 's' : ''}</Badge>
        </span>
      }
      onClose={onClose}
    >
      <div className="row-between mb-16">
        <div className="tabs">
          <button className={`tab ${tab === 'unread' ? 'active' : ''}`} onClick={() => setTab('unread')}>Non lues</button>
          <button className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>Toutes</button>
        </div>
        <button
          className="btn btn-sm"
          onClick={() => void markAllNotificationsRead()}
          disabled={unread.length === 0}
        >
          Tout lire
        </button>
      </div>

      {shown.length === 0 && (
        <EmptyState
          title={tab === 'unread' ? 'Aucune notification non lue' : 'Aucune notification'}
          hint="Accords, événements, mandat… tout arrivera ici, en temps réel."
          icon="🔔"
        />
      )}

      <div className="col" style={{ gap: 10 }}>
        {shown.map((n) => (
          <div
            key={n.id}
            className={`notif-item ${leaving.has(n.id) ? 'notif-leaving' : ''} ${n.read ? 'read' : ''}`}
            onClick={() => readAndDismiss(n)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') readAndDismiss(n); }}
          >
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <span className="notif-ico" aria-hidden>{TYPE_ICON[n.type] ?? '🔔'}</span>
              <div className="flex1" style={{ minWidth: 0 }}>
                <div className="row-between" style={{ gap: 8 }}>
                  <strong className="small">{n.title}</strong>
                  <span className="tiny muted mono" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(n.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="tiny muted mt-8">
                  {worldDate(n.day)} · <Badge tone={TYPE_TONE[n.type] ?? 'neutral'}>{TYPE_LABEL[n.type] ?? n.type}</Badge>
                  {n.read && <span className="tiny muted"> · lue</span>}
                </div>
                <div className="small mt-8" style={{ color: 'var(--text-1)' }}>{n.body}</div>
                {n.action && !n.read && (
                  <div className="row mt-8" style={{ gap: 8 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn btn-sm btn-good btn3d"
                      disabled={busyId === n.id}
                      onClick={() => void respond(n, true)}
                    >
                      {n.action.kind === 'respond_delivery'
                        ? `✓ Accepter (payer ${n.action.value.toFixed(2)} Md €)`
                        : '✓ Accepter'}
                    </button>
                    <button
                      className="btn btn-sm btn-danger btn3d"
                      disabled={busyId === n.id}
                      onClick={() => void respond(n, false)}
                    >
                      {n.action.kind === 'respond_delivery' ? '✕ Refuser (retour)' : '✕ Refuser'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="tiny muted center mt-16">
        Cliquer sur une notification la marque comme lue (elle disparaît de « Non lues »).
      </p>
    </Drawer>
  );
}
