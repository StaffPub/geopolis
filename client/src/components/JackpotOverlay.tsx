/**
 * GEOPOLIS — Célébration « GAIN EXCEPTIONNEL » (v20, version spectacle).
 * Déclenchée en temps réel quand un joueur humain encaisse ≥ 10 Md € d'un
 * coup (offre achetée, achat bilatéral, livraison acceptée…).
 *
 *  - DURÉE 15 s, INRATABLE (aucun bouton), puis SORTIE ANIMÉE (~900 ms) :
 *    la carte s'envole en pivotant, le fond se dissout — jamais de coupe sèche
 *    (et même si les animations CSS sont gelées, le timer JS démonte l'overlay).
 *  - Compteur qui grimpe jusqu'au montant gagné pendant 12,5 s.
 *  - Double nappe de rayons contrarotatifs, flash d'ouverture, anneaux
 *    d'onde, halo pulsé, cartes 3D flottantes.
 *  - PLUIE + FONTAINES en vagues : pièces « € » or en rotation 3D continue,
 *    billets vert-de-gris ondulants (chute + balancement séparés), étincelles.
 *  - Son optionnel du joueur : /sounds/bigwin.mp3 (13 s) ; silencieux si absent.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatedNumber } from './ui.js';

export interface BigWinEvent {
  id: number;
  amount: number;
  source: string;
}

const DURATION_MS = 15000;
const LEAVE_MS = 900;
const COUNT_MS = 12500;
const SOUND_URL = '/sounds/bigwin.mp3';

interface Piece {
  left: number;
  delay: number;
  dur: number;
  size: number;
  kind: 'coin' | 'bill' | 'spark';
  drift: number;
  fountain: boolean;
  wave: number;
  fx: number;
  fy: number;
  spin: number;
}

export function JackpotOverlay({ event, onDone }: { event: BigWinEvent; onDone: (id: number) => void }) {
  const [leaving, setLeaving] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /* 46 pièces/billets/étincelles : pluie continue + 3 vagues de fontaine. */
  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: 46 }, (_, i) => {
        const fountain = i >= 20 && i < 38;
        const kind: Piece['kind'] = i >= 38 ? 'spark' : i % 3 === 0 ? 'bill' : 'coin';
        const wave = fountain ? Math.floor((i - 20) / 6) : 0; // 3 vagues de 6
        const angle = ((i - 20) / 6 - wave * 3 + 1) * 0.55 - Math.PI / 2 + (Math.random() - 0.5) * 0.3;
        const dist = 300 + Math.random() * 340;
        return {
          left: fountain ? 50 : (i * 2.17 + Math.random() * 2.5) % 96,
          delay: fountain ? wave * 1500 + Math.random() * 500 : Math.random() * 6000,
          dur: fountain ? 2400 + Math.random() * 1200 : 3400 + Math.random() * 3000,
          size: kind === 'spark' ? 8 + Math.round(Math.random() * 9) : 24 + Math.round(Math.random() * 30),
          kind,
          drift: Math.random() > 0.5 ? 1 : -1,
          fountain,
          wave,
          fx: fountain ? Math.cos(angle + Math.PI / 2) * dist * 0.85 : 0,
          fy: fountain ? -Math.abs(Math.sin(angle)) * dist - 220 : 0,
          spin: 1.6 + Math.random() * 1.8,
        };
      }),
    [],
  );

  useEffect(() => {
    document.body.classList.add('overlay-open');
    /* Son optionnel fourni par le joueur (13 s) : silencieux si absent/bloqué. */
    const audio = new Audio(SOUND_URL);
    audio.volume = 0.9;
    audioRef.current = audio;
    void audio.play().catch(() => { /* pas de fichier ou autoplay bloqué : mode silencieux */ });
    const tLeave = window.setTimeout(() => setLeaving(true), DURATION_MS - LEAVE_MS);
    const tDone = window.setTimeout(() => onDone(event.id), DURATION_MS);
    return () => {
      window.clearTimeout(tLeave);
      window.clearTimeout(tDone);
      audio.pause();
      audioRef.current = null;
      document.body.classList.remove('overlay-open');
    };
  }, [event.id, onDone]);

  return (
    <div
      className={`jackpot-backdrop ${leaving ? 'leaving' : ''}`}
      role="alertdialog"
      aria-modal="true"
      aria-label={`Gain exceptionnel : ${event.amount.toFixed(1)} milliards d'euros`}
    >
      <div className="jackpot-rays" aria-hidden />
      <div className="jackpot-rays jp-rays2" aria-hidden />
      {!leaving && <div className="jackpot-flash" aria-hidden />}
      <div className="jp-ring" aria-hidden />
      <div className="jp-ring jp-ring2" aria-hidden />
      <div className="jackpot-pieces" aria-hidden>
        {pieces.map((p, i) =>
          p.kind === 'spark' ? (
            <span
              key={i}
              className="jp-spark"
              style={{ left: `${p.left}%`, top: `${(i * 13.7) % 88}%`, animationDelay: `${p.delay}ms` }}
            />
          ) : (
            <span
              key={i}
              className={`jp-fall ${p.fountain ? 'jp-fount' : ''}`}
              style={{
                left: `${p.left}%`,
                animationDelay: `${p.delay}ms`,
                animationDuration: `${p.dur}ms`,
                ['--drift' as string]: `${p.drift * 70}px`,
                ['--fx' as string]: `${p.fx}px`,
                ['--fy' as string]: `${p.fy}px`,
              }}
            >
              <span
                className={p.kind === 'coin' ? 'jp-coin' : 'jp-bill'}
                style={{
                  width: p.kind === 'bill' ? p.size * 1.7 : p.size,
                  height: p.size,
                  animationDuration: `${p.spin}s, ${1.1 + (i % 5) * 0.22}s`,
                }}
              />
            </span>
          ),
        )}
      </div>

      <div className="jackpot-card">
        <div className="jackpot-glow" aria-hidden />
        <div className="jackpot-kicker">💰 GAIN EXCEPTIONNEL</div>
        <div className="jackpot-amount">
          +<AnimatedNumber value={event.amount} format={(v) => v.toFixed(1)} duration={COUNT_MS} easing="linear" />
          <span className="jackpot-unit">Md €</span>
        </div>
        <div className="jackpot-source">{event.source}</div>
        <div className="jackpot-bar" aria-hidden>
          <span style={{ animationDuration: `${DURATION_MS - LEAVE_MS}ms` }} />
        </div>
        <div className="jackpot-hint tiny">Encaissé directement dans votre trésorerie</div>
      </div>
    </div>
  );
}
