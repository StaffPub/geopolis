/**
 * GEOPOLIS — Composants UI de base : cartes glass, badges, deltas animés,
 * barres de progression, modales, drawers, états vides.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

/* ------------------------------- GlassCard ------------------------------- */

export function GlassCard({
  children,
  className = '',
  interactive = false,
  onClick,
  style,
  dataTour,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
  dataTour?: string;
}) {
  return (
    <div
      className={`glass glass-card ${interactive ? 'interactive' : ''} ${onClick ? 'interactive' : ''} ${className}`}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer', ...style } : style}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      data-tour={dataTour}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      {children}
    </div>
  );
}

/* ------------------------------- AnimatedNumber ------------------------------- */

export function AnimatedNumber({
  value,
  format,
  duration = 550,
  className = '',
  easing = 'ease',
}: {
  value: number;
  format?: (v: number) => string;
  duration?: number;
  className?: string;
  /** 'linear' : glisse continûment entre deux valeurs serveur (compteurs live) */
  easing?: 'ease' | 'linear';
}) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  const reduced = useRef(
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (reduced.current || !Number.isFinite(value)) {
      setDisplay(value);
      prev.current = value;
      return;
    }
    const from = prev.current;
    const to = value;
    prev.current = value;
    if (from === to) return;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = easing === 'linear' ? t : 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, easing]);

  const fmt = format ?? ((v: number) => v.toFixed(1));
  return <span className={`mono ${className}`}>{Number.isFinite(display) ? fmt(display) : '—'}</span>;
}

/* ------------------------------- Delta ------------------------------- */

export function Delta({ value, suffix = ' %', digits = 1 }: { value: number; suffix?: string; digits?: number }) {
  if (!Number.isFinite(value)) return <span className="delta-flat">—</span>;
  const cls = value > 0.01 ? 'delta-up' : value < -0.01 ? 'delta-down' : 'delta-flat';
  const arrow = value > 0.01 ? '▲' : value < -0.01 ? '▼' : '•';
  return (
    <span className={`${cls} tiny`}>
      {arrow} {value >= 0 ? '+' : ''}{value.toFixed(digits)}{suffix}
    </span>
  );
}

/* ------------------------------- Badge ------------------------------- */

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'good' | 'warn' | 'danger' | 'info' | 'violet' | 'pink' | 'neutral';
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/* ------------------------------- StatCard ------------------------------- */

export function StatCard({
  label,
  value,
  format,
  delta,
  deltaSuffix,
  icon,
  tone,
  glide = false,
  perDay,
  perDayFormat,
}: {
  label: string;
  value: number;
  format?: (v: number) => string;
  delta?: number;
  deltaSuffix?: string;
  icon?: ReactNode;
  tone?: string;
  /** glide : le chiffre glisse en continu vers la prochaine valeur serveur (aucun saut visible) */
  glide?: boolean;
  /** perDay : gain/perte par jour de monde, affiché sous la valeur */
  perDay?: number;
  perDayFormat?: (v: number) => string;
}) {
  return (
    <GlassCard className="card3d anim-fade-up" style={tone ? { borderLeft: `3px solid ${tone}` } : undefined}>
      <div className="row-between mb-8">
        <span className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
          {label}
        </span>
        {icon}
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
        <AnimatedNumber value={value} format={format} duration={glide ? 55000 : 550} easing={glide ? 'linear' : 'ease'} />
      </div>
      <div className="row" style={{ gap: 10 }}>
        {delta !== undefined && <Delta value={delta} suffix={deltaSuffix} />}
        {perDay !== undefined && Number.isFinite(perDay) && (
          <span className="tiny mono" style={{ color: perDay >= 0 ? 'var(--good)' : 'var(--danger)' }}>
            {perDay >= 0 ? '+' : ''}{(perDayFormat ?? ((v: number) => v.toFixed(1)))(perDay)} /jour
          </span>
        )}
      </div>
    </GlassCard>
  );
}

/* ------------------------------- ProgressBar ------------------------------- */

export function ProgressBar({
  value,
  max = 100,
  tone = 'default',
  height = 8,
  label,
}: {
  value: number;
  max?: number;
  tone?: 'default' | 'good' | 'warn' | 'danger' | 'pink';
  height?: number;
  label?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div>
      {label && (
        <div className="row-between tiny mb-8">
          <span className="muted">{label}</span>
          <span className="mono">{pct.toFixed(0)} %</span>
        </div>
      )}
      <div className="bar" style={{ height }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`bar-fill ${tone !== 'default' ? tone : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ------------------------------- Modal ------------------------------- */

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="glass modal" style={wide ? { width: 'min(860px, 100%)' } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        {children}
        {footer && <div className="row mt-16" style={{ justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------- Drawer ------------------------------- */

export function Drawer({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      {/* Fermeture au POINTERDOWN : immune au click résiduel qui suit la
          sélection d'un pays sur la carte (click-through). */}
      <div className="drawer-backdrop" onPointerDown={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Panneau'}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        {children}
      </aside>
    </>
  );
}

/* ------------------------------- Divers ------------------------------- */

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="row" style={{ gap: 12, padding: 16 }}>
      <div className="spinner" aria-hidden />
      <span className="muted small">{label ?? 'Chargement…'}</span>
    </div>
  );
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="center anim-fade-in" style={{ padding: '34px 16px', color: 'var(--text-2)' }}>
      <div style={{ fontSize: '1.8rem', marginBottom: 8, opacity: 0.7 }}>{icon ?? '◇'}</div>
      <div style={{ fontWeight: 700, color: 'var(--text-1)' }}>{title}</div>
      {hint && <div className="small mt-8">{hint}</div>}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="row-between mb-16" style={{ flexWrap: 'wrap', gap: 8 }}>
      <h2 className="page-hero anim-fade-up" style={{ margin: 0 }}>{children}</h2>
      {right}
    </div>
  );
}

/** En-tête de page v15 : pastille icône flottante, titre rond, sous-titre
 *  pédagogique et chips de données live. Remplace SectionTitle sur les onglets. */
export function PageHeader({
  icon,
  title,
  subtitle,
  chips,
  right,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  chips?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="shell-head anim-rise mb-16" style={{ display: 'flex' }}>
      <div className="shell-icon" aria-hidden>{icon}</div>
      <div className="flex1" style={{ minWidth: 0 }}>
        <div className="row-between wrap" style={{ gap: 10 }}>
          <h1 className="shell-title">{title}</h1>
          {right}
        </div>
        {subtitle && <p className="shell-sub">{subtitle}</p>}
        {chips && <div className="chip-row">{chips}</div>}
      </div>
    </div>
  );
}

/** Carte de section v15 : en-tête icône + titre + description, contenu dessous. */
export function SectionCard({
  icon,
  title,
  desc,
  right,
  children,
  className = '',
}: {
  icon: string;
  title: string;
  desc?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`section-card glass glass-card anim-rise ${className}`}>
      <header className="section-head">
        <span className="section-ico" aria-hidden>{icon}</span>
        <div className="flex1" style={{ minWidth: 0 }}>
          <h3 className="section-title">{title}</h3>
          {desc && <p className="section-desc">{desc}</p>}
        </div>
        {right}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}

export function KeyValue({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div className="row-between" style={{ padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span className="small muted">{k}</span>
      <span className="small mono" style={{ fontWeight: 600, color: tone ?? 'var(--text-0)' }}>{v}</span>
    </div>
  );
}

/** Ré-export pratique pour les pages (infobulle animée). */
export { InfoTip as InfoTipCard } from './InfoTip.js';

/* ------------------------------- TiltFX ------------------------------- */
/** Effet 3D global (façon Apple) : incline légèrement les cartes sous le
 *  pointeur via un seul listener délégué (perf), variables CSS --rx/--ry.
 *  Désactivé sur écrans tactiles et si prefers-reduced-motion. */
export function TiltFX(): null {
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    if (reduced || coarse) return;
    const SEL = '.glass-card, .corridor-card, .route-opt, .law-card, .regime-card, .prod-card, .action-tile';
    const apply = (el: HTMLElement, rx: string, ry: string): void => {
      el.style.setProperty('--rx', rx);
      el.style.setProperty('--ry', ry);
    };
    const onMove = (e: PointerEvent): void => {
      const t = (e.target as HTMLElement | null)?.closest?.(SEL) as HTMLElement | null;
      if (!t) return;
      const r = t.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return;
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      apply(t, `${(-py * 4.5).toFixed(2)}deg`, `${(px * 5.5).toFixed(2)}deg`);
    };
    const onOut = (e: PointerEvent): void => {
      const t = (e.target as HTMLElement | null)?.closest?.(SEL) as HTMLElement | null;
      if (t) apply(t, '0deg', '0deg');
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerout', onOut, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerout', onOut);
    };
  }, []);
  return null;
}
