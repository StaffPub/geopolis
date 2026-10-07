/**
 * GEOPOLIS — Indicateur "EN DIRECT" : permanent, animé, honnête
 * (acteurs humains connectés + dirigeants IA actifs, jamais confondus).
 */
import { useEffect, useRef, useState } from 'react';
import { useGame } from '../state/GameContext.js';
import type { ConnectionStatus } from '../lib/realtime';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'CONNEXION…',
  live: 'EN DIRECT',
  reconnecting: 'RECONNEXION…',
  polling: 'MODE SECOURS',
};

export function LiveIndicator({ compact = false }: { compact?: boolean }) {
  const { status, actors, meta } = useGame();
  const [bump, setBump] = useState(false);
  const prevTotal = useRef(actors.total);

  useEffect(() => {
    if (prevTotal.current !== actors.total) {
      prevTotal.current = actors.total;
      setBump(true);
      const t = window.setTimeout(() => setBump(false), 320);
      return () => window.clearTimeout(t);
    }
  }, [actors.total]);

  const live = status === 'live';

  return (
    <div
      className={`live-indicator ${live ? '' : 'offline'}`}
      tabIndex={0}
      role="status"
      aria-label={`${STATUS_LABEL[status]} — ${actors.total} acteurs actifs : ${actors.humansOnline} joueur(s) humain(s) connecté(s) et ${actors.ai} dirigeant(s) IA en activité`}
    >
      <span className="live-dot" aria-hidden />
      <span>{STATUS_LABEL[status]}</span>
      {!compact && (
        <>
          <span style={{ opacity: 0.55 }}>•</span>
          <span className={`live-count ${bump ? 'bump' : ''}`}>
            {actors.total} acteur{actors.total > 1 ? 's' : ''} actif{actors.total > 1 ? 's' : ''}
          </span>
        </>
      )}
      <div className="live-tooltip">
        <strong style={{ color: 'var(--text-0)' }}>Le monde tourne actuellement.</strong>
        <br />
        {actors.humansOnline} joueur{actors.humansOnline > 1 ? 's' : ''} humain{actors.humansOnline > 1 ? 's' : ''} connecté{actors.humansOnline > 1 ? 's' : ''} · {actors.ai} dirigeant{actors.ai > 1 ? 's' : ''} IA en activité
        <br />
        <span className="tiny">
          Les dirigeants IA gouvernent leur pays en continu (décisions réelles, pas des bots « connectés » comme des humains).
          {meta ? ` Jour de monde : ${meta.day} · version ${meta.version}.` : ''}
        </span>
        {status === 'reconnecting' && <div className="tiny mt-8" style={{ color: 'var(--warn)' }}>Connexion interrompue. Tentative de reconnexion…</div>}
        {status === 'polling' && <div className="tiny mt-8" style={{ color: 'var(--warn)' }}>WebSocket indisponible : synchronisation HTTP de secours active.</div>}
      </div>
    </div>
  );
}
