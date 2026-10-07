/**
 * GEOPOLIS — Infobulle explicative ⓘ (v17.4, version blindée).
 * Popover rendu via PORTAL dans <body> : position fixed, z-index 1000,
 * fond OPAQUE, flèche vers son icône, placement mesuré (au-dessus par
 * défaut, dessous si pas la place, clamp horizontal), jamais rogné,
 * jamais caché par une carte, un header, une modale ou un drawer.
 *
 * Ouverture : survol, focus clavier, tap/clic.
 * Fermeture : quitte l'icône, re-clic, tap/clic AILLEURS, Escape, scroll,
 * resize, blur. Une seule infobulle ouverte à la fois (registre global).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface PopPos {
  x: number;
  y: number;
  place: 'top' | 'bottom';
}

const POP_WIDTH = 300;

/* Registre global : une seule infobulle ouverte à la fois. */
let closeOthers: (() => void) | null = null;

export function InfoTip({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const pinnedRef = useRef(false);

  const close = useCallback(() => { pinnedRef.current = false; setOpen(false); }, []);

  const place = () => {
    const b = btnRef.current;
    if (!b) return;
    if (closeOthers && closeOthers !== close) closeOthers();
    closeOthers = close;
    const r = b.getBoundingClientRect();
    const W = Math.min(POP_WIDTH, window.innerWidth - 16);
    // Horizontal : bord droit aligné sur l'icône (les ⓘ sont souvent à
    // droite des cartes) ; bascule à gauche près du bord gauche ; clamp.
    let x = r.right - W;
    if (x < 8) x = r.left;
    x = Math.max(8, Math.min(x, window.innerWidth - W - 8));
    // Vertical : au-dessus par défaut ; dessous si pas la place.
    const estH = Math.max(72, Math.ceil(text.length / 46) * 19 + 30);
    const placeV: 'top' | 'bottom' = r.top - estH - 14 > 8 ? 'top' : 'bottom';
    const y = placeV === 'top' ? r.top - 12 : r.bottom + 12;
    setPos({ x, y, place: placeV });
    setOpen(true);
  };

  /* Ajustement fin après rendu : mesure réelle, retournement si débordement. */
  useLayoutEffect(() => {
    if (!open || !pos || !popRef.current || !btnRef.current) return;
    const pr = popRef.current.getBoundingClientRect();
    const br = btnRef.current.getBoundingClientRect();
    let { y, place } = pos;
    if (place === 'top' && pr.top < 8) {
      place = 'bottom';
      y = br.bottom + 12;
    } else if (place === 'bottom' && pr.bottom > window.innerHeight - 8) {
      place = 'top';
      y = br.top - 12;
    }
    if (y !== pos.y || place !== pos.place) setPos({ x: pos.x, y, place });
  }, [open, pos]);

  /* Fermetures : tap/clic ailleurs, scroll, resize, Escape. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const closeNow = () => setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', closeNow, true);
    window.addEventListener('resize', closeNow);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', closeNow, true);
      window.removeEventListener('resize', closeNow);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => () => { if (closeOthers === close) closeOthers = null; }, [close]);

  return (
    <span
      ref={wrapRef}
      className="infotip"
      onMouseEnter={place}
      onMouseLeave={() => { if (!pinnedRef.current) close(); }}
    >
      <button
        ref={btnRef}
        type="button"
        className="infotip-btn"
        aria-label={label ?? `Explication : ${text.slice(0, 60)}`}
        onFocus={place}
        onBlur={close}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // Survol puis clic (desktop) = ÉPINGLER, pas fermer ; re-clic ou
          // clic ailleurs = fermer. Sur tactile : premier tap = ouvrir.
          if (pinnedRef.current) close();
          else { pinnedRef.current = true; place(); }
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2" />
          <path d="M12 16.5v-5.2M12 7.8h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
      {open && pos && createPortal(
        <span
          ref={popRef}
          className={`infotip-pop infotip-fixed arrow-${pos.place}`}
          role="tooltip"
          style={{
            left: pos.x,
            top: pos.y,
            transform: pos.place === 'top' ? 'translateY(-100%)' : undefined,
          }}
        >
          {text}
        </span>,
        document.body,
      )}
    </span>
  );
}
