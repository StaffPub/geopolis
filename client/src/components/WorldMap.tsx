/**
 * GEOPOLIS — Carte mondiale 2D interactive (SVG local, aucune API externe).
 * v3 : zoom molette natif non-passif (fix), drag fiable (état, pas ref),
 * tooltip throttlé par requestAnimationFrame (fix perf), flux commerciaux
 * animés (dash + particules) pilotés par les VRAIES routes du moteur,
 * mise en valeur des flux du pays survolé/sélectionné, 7 modes d'affichage.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicCountry, ResourceKey, TradeCorridor, TradeRoute } from 'shared';
import { RESOURCE_KEYS, RESOURCE_MAP } from 'shared';
import { CENTROID_BY_ID, MAP_HEIGHT, MAP_WIDTH, REGION_SHAPES, polygonToPath } from '../data/worldMap';
import { game as gameApi } from '../lib/api';
import { Badge } from './ui.js';

export type MapMode = 'default' | 'economy' | 'resources' | 'trade' | 'diplomacy' | 'population' | 'infrastructure';

export const MAP_MODES: { id: MapMode; label: string; hint: string }[] = [
  { id: 'default', label: 'Nations', hint: 'Couleurs officielles des 36 entités' },
  { id: 'economy', label: 'Économie', hint: 'Intensité = PIB' },
  { id: 'resources', label: 'Ressources', hint: 'Niveau des stocks de la ressource choisie' },
  { id: 'trade', label: 'Commerce', hint: 'Volume échangé avec la nation de référence' },
  { id: 'diplomacy', label: 'Diplomatie', hint: 'Qualité des relations avec la nation de référence' },
  { id: 'population', label: 'Population', hint: 'Intensité = population' },
  { id: 'infrastructure', label: 'Infrastructures', hint: 'Niveau moyen des infrastructures' },
];

interface MapMetrics {
  perCountry: Record<string, {
    stocks: Record<string, number>;
    infraAvg: number;
    tradeByPartner: Record<string, number>;
    relations: Record<string, number>;
  }>;
}

interface Props {
  countries: PublicCountry[];
  flows: TradeRoute[];
  selectedId: string | null;
  referenceId: string | null;
  mode: MapMode;
  onModeChange: (m: MapMode) => void;
  onSelect: (id: string | null) => void;
  height?: string;
  showLegend?: boolean;
  hideToolbar?: boolean;
}

const PATHS = REGION_SHAPES.map((shape) => ({
  id: shape.id,
  paths: shape.polygons.map(polygonToPath),
}));

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): string {
  const k = Math.min(1, Math.max(0, t));
  const c = a.map((v, i) => Math.round(v + (b[i]! - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const RED: [number, number, number] = [220, 70, 84];
const AMBER: [number, number, number] = [224, 160, 70];
const GREEN: [number, number, number] = [56, 189, 138];
const DEEP: [number, number, number] = [28, 34, 66];
const VIOLET: [number, number, number] = [139, 92, 246];
const CYAN: [number, number, number] = [34, 211, 238];

export function WorldMap({
  countries, flows, selectedId, referenceId, mode, onModeChange, onSelect,
  height = '62vh', showLegend = true, hideToolbar = false,
}: Props) {
  const [metrics, setMetrics] = useState<MapMetrics | null>(null);
  const [corridors, setCorridors] = useState<TradeCorridor[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const setHover = useCallback((id: string | null) => {
    hoveredRef.current = id;
    setHovered(id);
  }, []);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [resource, setResource] = useState<ResourceKey>('energy');
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef(0);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const reducedMotion = useRef(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  const byId = useMemo(() => new Map(countries.map((c) => [c.id, c])), [countries]);

  /* Métriques de carte (stocks, infra, relations, volumes) */
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const m = await gameApi.mapMetrics();
        if (!cancelled) setMetrics({ perCountry: m.perCountry });
      } catch {
        /* resync suivante */
      }
    };
    const loadCorridors = async () => {
      try {
        const c = await gameApi.corridors();
        if (!cancelled) setCorridors(c.corridors);
      } catch { /* resync suivante */ }
    };
    const refreshAll = () => { void load(); void loadCorridors(); };
    void load();
    void loadCorridors();
    window.addEventListener('gp-trade-changed', refreshAll);
    const t = window.setInterval(refreshAll, 45_000);
    return () => {
      cancelled = true;
      window.removeEventListener('gp-trade-changed', refreshAll);
      window.clearInterval(t);
    };
  }, []);


  /* Tooltip throttlé (rAF) : plus de re-render à chaque pixel de souris */
  const scheduleTooltip = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setTooltip(mouseRef.current ? { ...mouseRef.current } : null);
    });
  }, []);
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  /* Couleur par pays selon le mode */
  const fillFor = useCallback((id: string): string => {
    const c = byId.get(id);
    if (!c) return '#232842';
    const m = metrics?.perCountry[id];
    switch (mode) {
      case 'default': return c.color;
      case 'economy': return lerpColor(DEEP, VIOLET, Math.log10(Math.max(1, c.gdp)) / 4.65);
      case 'population': return lerpColor(DEEP, CYAN, Math.log10(Math.max(1, c.population * 1e6)) / 9.4);
      case 'resources': {
        const ratio = m?.stocks[resource] ?? 0.5;
        return ratio < 0.3 ? lerpColor(RED, AMBER, ratio / 0.3) : lerpColor(AMBER, GREEN, (ratio - 0.3) / 0.5);
      }
      case 'infrastructure': return lerpColor(DEEP, GREEN, (m?.infraAvg ?? 3) / 8);
      case 'diplomacy': {
        if (!referenceId || referenceId === id) return c.color;
        const score = (m?.relations[referenceId] ?? 50) / 100;
        return score >= 0.5 ? lerpColor(AMBER, GREEN, (score - 0.5) * 2) : lerpColor(RED, AMBER, score * 2);
      }
      case 'trade': {
        if (!referenceId) return c.color;
        const vol = m?.tradeByPartner[referenceId] ?? 0;
        if (vol < 0.02) return 'rgb(22, 27, 52)';
        return lerpColor(DEEP, CYAN, Math.min(1, vol / 2));
      }
    }
  }, [byId, metrics, mode, referenceId, resource]);

  const clampView = useCallback((v: { x: number; y: number; scale: number }) => {
    const minX = MAP_WIDTH - MAP_WIDTH * v.scale;
    const minY = MAP_HEIGHT - MAP_HEIGHT * v.scale;
    return {
      scale: v.scale,
      x: Math.min(0, Math.max(minX, v.x)),
      y: Math.min(0, Math.max(minY, v.y)),
    };
  }, []);

  /* Zoom molette : listener NATIF non-passif (React rend wheel passif → bug de scroll) */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * MAP_WIDTH;
      const py = ((e.clientY - rect.top) / rect.height) * MAP_HEIGHT;
      setView((v) => {
        const scale = Math.min(9, Math.max(1, v.scale * (e.deltaY < 0 ? 1.16 : 0.86)));
        const wx = (px - v.x) / v.scale;
        const wy = (py - v.y) / v.scale;
        return clampView({ scale, x: px - wx * scale, y: py - wy * scale });
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [clampView]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: view.x, origY: view.y, moved: false };
    setDragging(true);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }, [view.x, view.y]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (svg) {
      const rect = svg.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      scheduleTooltip();
    }
    const drag = dragRef.current;
    if (!drag || !svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - drag.startX) / rect.width) * MAP_WIDTH;
    const dy = ((e.clientY - drag.startY) / rect.height) * MAP_HEIGHT;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) {
      setView((v) => clampView({ ...v, x: drag.origX + dx, y: drag.origY + dy }));
    }
  }, [clampView, scheduleTooltip]);

  /* Sélection fiable : décidée au pointerup (click natif = capricieux avec
     le pointer-capture selon les navigateurs). Un vrai drag ne sélectionne pas.
     Garde anti-double-exécution : le pointerleave parasite qui suit la
     libération du capture ne doit PAS re-déclencher la sélection. */
  const onPointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!drag || drag.moved) return;
    const target = hoveredRef.current;
    if (!target) return;
    onSelect(selectedId === target ? null : target);
  }, [selectedId, onSelect]);

  const onPointerLeaveMap = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
    setHover(null);
    mouseRef.current = null;
    setTooltip(null);
  }, [setHover]);

  const zoomBy = useCallback((factor: number) => {
    setView((v) => {
      const scale = Math.min(9, Math.max(1, v.scale * factor));
      const cx = MAP_WIDTH / 2;
      const cy = MAP_HEIGHT / 2;
      const wx = (cx - v.x) / v.scale;
      const wy = (cy - v.y) / v.scale;
      return clampView({ scale, x: cx - wx * scale, y: cy - wy * scale });
    });
  }, [clampView]);

  const resetView = useCallback(() => setView({ x: 0, y: 0, scale: 1 }), []);

  /* Flux : données réelles ; mise en valeur du pays survolé/sélectionné */
  const focusId = hovered ?? selectedId;
  const visibleFlows = useMemo(() => {
    const base = mode === 'trade' && referenceId ? flows.filter((f) => f.fromId === referenceId || f.toId === referenceId) : flows;
    const list = (base.length > 0 ? base : flows).slice(0, 30);
    return list
      .map((f) => ({ ...f, focused: focusId === null || f.fromId === focusId || f.toId === focusId }))
      .sort((a, b) => Number(a.focused) - Number(b.focused));
  }, [flows, mode, referenceId, focusId]);

  /* Corridors effectivement empruntés par les flux du pays de référence */
  const usedCorridors = useMemo(() => {
    const set = new Set<string>();
    for (const f of flows) {
      if (referenceId && f.fromId !== referenceId && f.toId !== referenceId) continue;
      for (const cid of f.corridors ?? []) set.add(cid);
    }
    return set;
  }, [flows, referenceId]);

  const flowPaths = useMemo(() => {
    return visibleFlows
      .map((f) => {
        const a = CENTROID_BY_ID.get(f.fromId);
        const b = CENTROID_BY_ID.get(f.toId);
        if (!a || !b) return null;
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const cx = mx - (dy / dist) * dist * 0.18;
        const cy = my + (dx / dist) * dist * 0.18;
        const value = Math.max(0.01, f.value);
        return {
          id: f.id,
          d: `M ${a[0].toFixed(1)} ${a[1].toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`,
          width: Math.min(2.8, 0.5 + Math.log10(1 + value * 40) * 0.8),
          opacity: Math.min(0.8, 0.2 + Math.log10(1 + value * 40) * 0.22),
          particles: reducedMotion.current ? 0 : Math.min(3, 1 + Math.floor(value * 2)),
          color: RESOURCE_MAP[f.resource]?.color ?? '#5b8cff',
          focused: f.focused,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [visibleFlows]);

  const hoveredCountry = hovered ? byId.get(hovered) : null;
  const showLabels = view.scale >= 2.2;

  const legend = useMemo(() => {
    switch (mode) {
      case 'economy': return { label: 'PIB', low: 'faible', high: 'élevé', colors: ['#1c2242', '#8b5cf6'] };
      case 'population': return { label: 'Population', low: 'faible', high: 'élevée', colors: ['#1c2242', '#3ec9a7'] };
      case 'resources': return { label: `Stock ${RESOURCE_MAP[resource].name}`, low: 'critique', high: 'abondant', colors: ['#dc4654', '#38bd8a'] };
      case 'infrastructure': return { label: 'Niveau infrastructure', low: 'faible', high: 'élevé', colors: ['#1c2242', '#38bd8a'] };
      case 'diplomacy': return { label: referenceId ? `Relations avec ${byId.get(referenceId)?.name ?? ''}` : 'Relations (sélectionne une nation)', low: 'tendues', high: 'excellentes', colors: ['#dc4654', '#38bd8a'] };
      case 'trade': return { label: referenceId ? `Commerce avec ${byId.get(referenceId)?.name ?? ''}` : 'Volume commercial', low: 'faible', high: 'élevé', colors: ['#1c2242', '#3ec9a7'] };
      default: return null;
    }
  }, [mode, resource, referenceId, byId]);

  const modeHint = MAP_MODES.find((m) => m.id === mode)?.hint ?? '';

  return (
    <div className="glass anim-fade-in map-shell">
      {!hideToolbar && (
        <div className="row wrap" style={{ padding: '10px 14px', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="tabs" role="tablist" aria-label="Modes de la carte">
            {MAP_MODES.map((m) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={mode === m.id}
                title={m.hint}
                className={`tab ${mode === m.id ? 'active' : ''}`}
                onClick={() => onModeChange(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          {mode === 'resources' && (
            <select
              className="input"
              style={{ width: 'auto', padding: '6px 10px', minHeight: 34, fontSize: '0.82rem' }}
              value={resource}
              onChange={(e) => setResource(e.target.value as ResourceKey)}
              aria-label="Ressource affichée"
            >
              {RESOURCE_KEYS.map((k) => (
                <option key={k} value={k}>{RESOURCE_MAP[k].name}</option>
              ))}
            </select>
          )}
          <span className="tiny muted hide-sm">{modeHint}</span>
          <div className="flex1" />
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={() => zoomBy(1.4)} aria-label="Zoomer">＋</button>
            <button className="btn btn-sm" onClick={() => zoomBy(1 / 1.4)} aria-label="Dézoomer">－</button>
            <button className="btn btn-sm" onClick={resetView} aria-label="Recentrer la carte">⟲</button>
          </div>
        </div>
      )}

      <div className="map-stage" style={{ position: 'relative', height, touchAction: 'none' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          style={{ width: '100%', height: '100%', display: 'block', cursor: dragging ? 'grabbing' : 'grab' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeaveMap}
          role="img"
          aria-label="Carte du monde GEOPOLIS : 36 nations interactives, flux commerciaux animés"
        >
          <defs>
            <radialGradient id="ocean" cx="50%" cy="40%" r="80%">
              <stop offset="0%" stopColor="#0e1b1e" />
              <stop offset="55%" stopColor="#0a1416" />
              <stop offset="100%" stopColor="#070d0f" />
            </radialGradient>
            <radialGradient id="oceanGlow" cx="50%" cy="45%" r="60%">
              <stop offset="0%" stopColor="rgba(201,155,63,0.10)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            <filter id="landShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="1.6" stdDeviation="2.4" floodColor="#000" floodOpacity="0.5" />
            </filter>
            <filter id="glowSel" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#ocean)" />
          <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#oceanGlow)" className={reducedMotion.current ? undefined : 'ocean-pulse'} />

          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {/* Graticule */}
            <g stroke="rgba(139,144,171,0.08)" strokeWidth={0.4} aria-hidden="true">
              {Array.from({ length: 11 }, (_, i) => (
                <line key={`h${i}`} x1={0} x2={MAP_WIDTH} y1={(i * MAP_HEIGHT) / 10} y2={(i * MAP_HEIGHT) / 10} />
              ))}
              {Array.from({ length: 17 }, (_, i) => (
                <line key={`v${i}`} y1={0} y2={MAP_HEIGHT} x1={(i * MAP_WIDTH) / 16} x2={(i * MAP_WIDTH) / 16} />
              ))}
            </g>

            {/* Pays */}
            <g filter="url(#landShadow)">
              {PATHS.map((shape) => {
                const c = byId.get(shape.id);
                const fill = fillFor(shape.id);
                const isSel = selectedId === shape.id;
                const isHov = hovered === shape.id;
                return (
                  <g key={shape.id}>
                    {shape.paths.map((d, i) => (
                      <path
                        key={i}
                        d={d}
                        fill={fill}
                        fillOpacity={isSel ? 0.98 : isHov ? 0.92 : 0.84}
                        stroke={isSel ? '#f0d492' : isHov ? 'rgba(240, 212, 146, 0.8)' : 'rgba(242, 237, 226, 0.22)'}
                        strokeWidth={(isSel ? 1.6 : isHov ? 1.1 : 0.55) / view.scale}
                        className="country-path"
                        style={{ filter: isSel ? 'url(#glowSel)' : undefined }}
                        onPointerEnter={() => setHover(shape.id)}
                        aria-label={c ? `${c.name} — ${c.controllerKind === 'player' ? `président ${c.presidentName}` : 'gouvernement IA'}` : shape.id}
                      />
                    ))}
                    {isSel && CENTROID_BY_ID.get(shape.id) && (
                      <circle
                        className="sel-pulse"
                        cx={CENTROID_BY_ID.get(shape.id)![0]}
                        cy={CENTROID_BY_ID.get(shape.id)![1]}
                        r={7}
                        fill="none"
                        stroke="#f0d492"
                        strokeWidth={1.4 / view.scale}
                        aria-hidden="true"
                      />
                    )}
                  </g>
                );
              })}
            </g>

            {/* Routes commerciales stratégiques (corridors) */}
            <g pointerEvents="none">
              {corridors.map((co) => {
                const a = CENTROID_BY_ID.get(co.hubs[0]);
                const b = CENTROID_BY_ID.get(co.hubs[1]);
                if (!a || !b) return null;
                const mx = (a[0] + b[0]) / 2;
                const my = (a[1] + b[1]) / 2;
                const dx = b[0] - a[0];
                const dy = b[1] - a[1];
                const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                const cx = mx - (dy / dist) * dist * 0.22;
                const cy = my + (dx / dist) * dist * 0.22;
                const owner = co.owner ? byId.get(co.owner) : null;
                const color = owner?.color ?? 'rgba(139,144,171,0.6)';
                const used = usedCorridors.has(co.id);
                return (
                  <g key={co.id} opacity={used ? 1 : owner ? 0.8 : 0.35}>
                    <path
                      d={`M ${a[0].toFixed(1)} ${a[1].toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`}
                      fill="none"
                      stroke={color}
                      strokeWidth={(owner ? 1.6 + Math.min(2.2, co.traffic / 25) : 1) + (used ? 1.2 : 0)}
                      strokeDasharray={owner ? undefined : '2 5'}
                      strokeLinecap="round"
                      className={owner && !reducedMotion.current ? 'flow-dash' : undefined}
                    >
                      <title>{`${co.name} — ${owner ? `${owner.name} · péage ${co.toll} %` : 'voie libre'} · trafic ${co.traffic.toFixed(0)} Md €`}</title>
                    </path>
                    {owner && (
                      <circle cx={cx} cy={cy} r={2.6} fill={color} stroke="#0b0e1a" strokeWidth={0.8}>
                        <title>{`${co.name} : ${owner.name} · péage ${co.toll} %`}</title>
                      </circle>
                    )}
                  </g>
                );
              })}
            </g>

            {/* Flux commerciaux : dash animé + particules (données moteur) */}
            <g pointerEvents="none">
              {flowPaths.map((f) => (
                <g key={f.id} opacity={f.focused ? 1 : 0.28} style={{ transition: 'opacity 300ms ease' }}>
                  <path
                    d={f.d}
                    fill="none"
                    stroke={f.color}
                    strokeWidth={f.width}
                    strokeOpacity={f.opacity * 0.55}
                    strokeLinecap="round"
                  />
                  <path
                    d={f.d}
                    fill="none"
                    stroke={f.color}
                    strokeWidth={Math.max(0.6, f.width * 0.5)}
                    strokeOpacity={f.opacity}
                    strokeLinecap="round"
                    className={reducedMotion.current ? undefined : 'flow-dash'}
                  />
                  {f.focused && Array.from({ length: f.particles }).map((_, i) => (
                    <circle key={i} r={Math.min(2.4, 1 + f.width * 0.5)} fill={f.color} opacity={0.95}>
                      <animateMotion dur={`${5 + i * 2.2}s`} repeatCount="indefinite" path={f.d} begin={`${i * 1.4}s`} />
                    </circle>
                  ))}
                </g>
              ))}
            </g>

            {/* Labels */}
            <g pointerEvents="none" fontFamily="Inter, sans-serif">
              {countries.map((c) => {
                const important = c.id === selectedId || c.id === hovered || showLabels;
                if (!important) return null;
                const pos = CENTROID_BY_ID.get(c.id);
                if (!pos) return null;
                const fs = (c.id === selectedId || c.id === hovered ? 11 : 8.5) / Math.sqrt(view.scale);
                return (
                  <text
                    key={`lbl-${c.id}`}
                    x={pos[0]}
                    y={pos[1]}
                    textAnchor="middle"
                    fontSize={fs}
                    fontWeight={c.id === selectedId ? 800 : 700}
                    fill="#f4f5fb"
                    stroke="rgba(6,8,18,0.85)"
                    strokeWidth={2.2 / Math.sqrt(view.scale)}
                    paintOrder="stroke"
                    style={{ letterSpacing: '0.04em' }}
                  >
                    {view.scale >= 3.4 ? c.name : c.code}
                  </text>
                );
              })}
            </g>
          </g>
        </svg>

        {/* Tooltip hover */}
        {hoveredCountry && tooltip && !dragging && (
          <div
            className="glass map-tooltip"
            style={{
              left: Math.min(tooltip.x + 16, (svgRef.current?.clientWidth ?? 600) - 250),
              top: Math.max(8, tooltip.y - 10),
            }}
          >
            <div className="row" style={{ gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: hoveredCountry.color, display: 'inline-block' }} aria-hidden />
              <strong>{hoveredCountry.name}</strong>
              <Badge tone={hoveredCountry.controllerKind === 'player' ? 'violet' : 'info'}>
                {hoveredCountry.controllerKind === 'player' ? 'JOUEUR' : 'IA'}
              </Badge>
            </div>
            <div className="tiny muted mt-8">Président : {hoveredCountry.presidentName}</div>
            <div className="tiny mono mt-8">
              PIB {(hoveredCountry.gdp / 1000).toFixed(2)} T € · Croissance {hoveredCountry.growth >= 0 ? '+' : ''}{hoveredCountry.growth.toFixed(1)} %
            </div>
            <div className="tiny mono">
              Pop. {hoveredCountry.population >= 1000 ? `${(hoveredCountry.population / 1000).toFixed(2)} Md` : `${hoveredCountry.population.toFixed(1)} M`} · Popularité {hoveredCountry.popularity.toFixed(0)} %
            </div>
            <div className="tiny muted mt-8">Clic pour le panneau détaillé</div>
          </div>
        )}

        {showLegend && legend && (
          <div className="glass map-legend" aria-label={`Légende : ${legend.label}`}>
            <div className="tiny" style={{ fontWeight: 700, marginBottom: 6 }}>{legend.label}</div>
            <div style={{ height: 8, borderRadius: 4, background: `linear-gradient(90deg, ${legend.colors[0]}, ${legend.colors[1]})` }} />
            <div className="row-between tiny muted" style={{ marginTop: 4 }}>
              <span>{legend.low}</span><span>{legend.high}</span>
            </div>
          </div>
        )}

        <div className="tiny muted map-flowcount">
          {visibleFlows.length} flux commerciaux animés · données moteur
        </div>
      </div>
    </div>
  );
}
