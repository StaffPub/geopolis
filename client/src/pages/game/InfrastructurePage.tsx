/**
 * GEOPOLIS v16 — Page Infrastructures refondue :
 *  - MENU PAR CATÉGORIES (transports, énergie, société, économie, environnement) :
 *    on clique pour voir les réseaux du domaine (ex. scolaire → Société & savoir).
 *  - Cartes 3D animées : pastille icône flottante, pips de niveau, boosts réels,
 *    chantier en cours avec progression.
 *  - Modale de chantier HYPER ANIMÉE : chaque boost apparaît en cascade avec sa
 *    barre, et l'impact RÉEL sur l'économie est chiffré (valeur actuelle → valeur
 *    au niveau suivant, coûts, entretien, durée).
 *  Les effets affichés miroitent EXACTEMENT les coefficients du moteur
 *  (server/src/simulation/model.ts — infraEffects).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { INFRA } from 'shared';
import type { InfraBoost, InfraDef, InfraKey } from 'shared';
import { useAuth } from '../../state/AuthContext.js';
import { useGame } from '../../state/GameContext.js';
import { Badge, EmptyState, GlassCard, PageHeader, ProgressBar, SectionCard } from '../../components/ui.js';
import { formatMoney } from 'shared';

const ICONS: Record<InfraKey, string> = {
  roads: '🛣️', rail: '🚆', ports: '⚓', logistics: '📦', airports: '✈️',
  powerGrid: '🔌', plants: '🔋',
  housing: '🏠', schools: '🏫', universities: '🎓', hospitals: '🏥', culture: '🎭',
  industrialZones: '🏭', techHubs: '💻', telecom: '📡', research: '🔬', finance: '🏦',
  water: '💧',
};

const CATS: { id: InfraDef['category'] | 'all'; icon: string; label: string; hint: string }[] = [
  { id: 'all', icon: '🗂️', label: 'Tout voir', hint: 'Les 18 réseaux du pays' },
  { id: 'transport', icon: '🛣️', label: 'Transports & logistique', hint: 'Routes, rail, ports, logistique, aéroports' },
  { id: 'energie', icon: '⚡', label: 'Énergie', hint: 'Réseau électrique, centrales' },
  { id: 'societe', icon: '🏛️', label: 'Société & savoir', hint: 'Logements, écoles, universités, hôpitaux, culture' },
  { id: 'economie', icon: '💼', label: 'Économie & science', hint: 'Industrie, tech, télécom, recherche, finance' },
  { id: 'environnement', icon: '🌾', label: 'Environnement', hint: 'Hydraulique & irrigation' },
];

/* ---- Métriques agrégées (miroir exact de model.ts → infraEffects) ---- */
type Metrics = Record<string, number>;
function metricsOf(levels: (k: InfraKey) => number): Metrics {
  return {
    logistics: (1 + (levels('roads') + levels('rail') + levels('logistics')) * 0.012 + levels('ports') * 0.018 + levels('airports') * 0.01) * 100 - 100,
    productivity: (1 + levels('schools') * 0.006 + levels('universities') * 0.008 + levels('roads') * 0.004 + levels('powerGrid') * 0.004 + levels('telecom') * 0.012) * 100 - 100,
    energy: (1 + levels('plants') * 0.014 + levels('powerGrid') * 0.01) * 100 - 100,
    industrial: (1 + levels('industrialZones') * 0.02 + levels('rail') * 0.008 + levels('ports') * 0.006) * 100 - 100,
    tech: (1 + levels('techHubs') * 0.018 + levels('universities') * 0.012 + levels('telecom') * 0.02 + levels('research') * 0.02) * 100 - 100,
    export: (1 + levels('airports') * 0.06 + levels('ports') * 0.01) * 100 - 100,
    food: levels('water') * 3,
    growth: levels('research') * 0.05,
    revenue: levels('finance') * 1.5,
    debtrate: levels('finance') * 0.15,
    pop: levels('culture') * 0.01,
    stab: levels('culture') * 0.008,
    services: levels('hospitals') * 0.6 + levels('housing') * 0.5 + levels('schools') * 0.4 + levels('universities') * 0.3 + levels('culture') * 0.2 + levels('finance') * 0.2,
  };
}
const AFFECTS: Record<InfraKey, { id: keyof Metrics | string; label: string; fmt: (v: number) => string }[]> = {
  roads: [ { id: 'logistics', label: 'Logistique', fmt: (v) => `+${v.toFixed(1)} %` }, { id: 'productivity', label: 'Productivité', fmt: (v) => `+${v.toFixed(1)} %` } ],
  rail: [ { id: 'logistics', label: 'Logistique', fmt: (v) => `+${v.toFixed(1)} %` }, { id: 'industrial', label: 'Industrie', fmt: (v) => `+${v.toFixed(1)} %` } ],
  ports: [ { id: 'logistics', label: 'Logistique', fmt: (v) => `+${v.toFixed(1)} %` }, { id: 'export', label: 'Export', fmt: (v) => `+${v.toFixed(1)} %` } ],
  logistics: [ { id: 'logistics', label: 'Logistique', fmt: (v) => `+${v.toFixed(1)} %` } ],
  airports: [ { id: 'export', label: 'Capacité d’export', fmt: (v) => `+${v.toFixed(1)} %` }, { id: 'logistics', label: 'Logistique', fmt: (v) => `+${v.toFixed(1)} %` } ],
  powerGrid: [ { id: 'energy', label: 'Distribution énergie', fmt: (v) => `+${v.toFixed(1)} %` }, { id: 'productivity', label: 'Productivité', fmt: (v) => `+${v.toFixed(1)} %` } ],
  plants: [ { id: 'energy', label: 'Production énergie', fmt: (v) => `+${v.toFixed(1)} %` } ],
  housing: [ { id: 'services', label: 'Services / niveau de vie', fmt: (v) => `+${v.toFixed(1)} pts` } ],
  schools: [ { id: 'productivity', label: 'Productivité', fmt: (v) => `+${v.toFixed(1)} %` }, { id: 'services', label: 'Services', fmt: (v) => `+${v.toFixed(1)} pts` } ],
  universities: [ { id: 'productivity', label: 'Productivité', fmt: (v) => `+${v.toFixed(1)} %` }, { id: 'tech', label: 'Technologie', fmt: (v) => `+${v.toFixed(1)} %` } ],
  hospitals: [ { id: 'services', label: 'Santé / services', fmt: (v) => `+${v.toFixed(1)} pts` } ],
  culture: [ { id: 'pop', label: 'Popularité', fmt: (v) => `+${v.toFixed(3)}/jour` }, { id: 'stab', label: 'Stabilité', fmt: (v) => `+${v.toFixed(3)}/jour` } ],
  industrialZones: [ { id: 'industrial', label: 'Capacité industrielle', fmt: (v) => `+${v.toFixed(1)} %` } ],
  techHubs: [ { id: 'tech', label: 'Production tech', fmt: (v) => `+${v.toFixed(1)} %` } ],
  telecom: [ { id: 'productivity', label: 'Productivité', fmt: (v) => `+${v.toFixed(1)} %` }, { id: 'tech', label: 'Technologie', fmt: (v) => `+${v.toFixed(1)} %` } ],
  research: [ { id: 'growth', label: 'Croissance potentielle', fmt: (v) => `+${v.toFixed(2)} pt` }, { id: 'tech', label: 'Technologie', fmt: (v) => `+${v.toFixed(1)} %` } ],
  finance: [ { id: 'debtrate', label: 'Taux d’intérêt de la dette', fmt: (v) => `−${v.toFixed(2)} pt` }, { id: 'revenue', label: 'Recettes fiscales', fmt: (v) => `+${v.toFixed(1)} %` } ],
  water: [ { id: 'food', label: 'Production agricole', fmt: (v) => `+${v.toFixed(0)} %` } ],
};

export function InfrastructurePage() {
  const { countryId } = useAuth();
  const { myCountry, runAction, pushToast, estimateAction } = useGame();
  const [cat, setCat] = useState<InfraDef['category'] | 'all'>('all');
  const [building, setBuilding] = useState<InfraKey | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const c = myCountry && myCountry.id === countryId ? myCountry : null;

  const levels = useMemo(() => {
    const base = c;
    return (k: InfraKey) => base?.infra[k]?.level ?? 0;
  }, [c]);

  /* Identité STABLE : l'estimation serveur du chantier n'est rejouée que si
     le pays ou le chantier visé change (pas à chaque push temps réel).
     ⚠ Hook AVANT tout return conditionnel (règle des hooks React). */
  const estimateForBuilding = useMemo(() => {
    const key = building;
    const id = c?.id ?? '';
    return () => estimateAction(id, { type: 'start_project', infra: key as InfraKey });
  }, [building, c?.id, estimateAction]);

  if (!c) {
    return (
      <div className="page">
        <PageHeader icon="🏗️" title="Infrastructures" subtitle="Construisez routes, ports, centrales, écoles, aéroports, centres de recherche… chaque niveau donne des bonus PERMANENTS réellement appliqués par le moteur économique." />
        <GlassCard>
          <EmptyState title="Aucune nation dirigée" hint="Prenez la tête d'un pays pour bâtir son réseau." icon="🏗️" />
          <div className="row mt-16" style={{ justifyContent: 'center' }}>
            <Link className="btn btn-primary btn-rocket" to="/countries"><span className="rk" aria-hidden>🚀</span>Choisir ma nation</Link>
          </div>
        </GlassCard>
      </div>
    );
  }

  const isPlayer = c.controller.kind === 'player';
  const gdpScale = 0.45 + c.economy.gdp / 6000;
  const costOf = (def: InfraDef, level: number) => def.baseCost * gdpScale * (1 + level * 0.35);
  const totalUpkeep = INFRA.reduce((s, def) => s + (c.infra[def.key]?.level ?? 0) * def.upkeepPerLevel * (0.5 + c.economy.gdp / 6000), 0);
  const avgLevel = Object.values(c.infra).reduce((s, i) => s + i.level, 0) / Math.max(1, Object.values(c.infra).length);

  const visible = cat === 'all' ? INFRA : INFRA.filter((d) => d.category === cat);
  const buildingDef = building ? INFRA.find((d) => d.key === building) ?? null : null;

  return (
    <div className="page">
      <PageHeader
        icon="🏗️"
        title={`Infrastructures — ${c.name}`}
        subtitle="18 réseaux répartis en 5 domaines : choisissez une catégorie dans le menu pour voir ses réseaux (ex. « Société & savoir » pour les écoles). Chaque niveau construit donne des bonus PERMANENTS réellement appliqués par le moteur : logistique, productivité, énergie, export, agriculture, croissance, recettes, dette, popularité…"
        chips={<>
          <Badge tone={c.projects.length > 0 ? 'warn' : 'neutral'}>{c.projects.length}/6 chantiers</Badge>
          <Badge tone="info">Entretien {formatMoney(totalUpkeep)}/an</Badge>
          <Badge tone="good">Niveau moyen {avgLevel.toFixed(1)}/10</Badge>
          <Badge tone="violet">{INFRA.length} réseaux disponibles</Badge>
        </>}
      />

      {/* ---------------- Menu catégories ---------------- */}
      <div className="cat-rail mb-16" role="tablist" aria-label="Catégories d'infrastructures">
        {CATS.map((k) => {
          const count = k.id === 'all' ? INFRA.length : INFRA.filter((d) => d.category === k.id).length;
          return (
            <button
              key={k.id}
              role="tab"
              aria-selected={cat === k.id}
              className={`cat-btn ${cat === k.id ? 'active' : ''}`}
              title={k.hint}
              onClick={() => setCat(k.id)}
            >
              <span aria-hidden>{k.icon}</span> {k.label}
              <span className="cat-count">{count}</span>
            </button>
          );
        })}
      </div>

      {/* ---------------- Chantiers en cours ---------------- */}
      {c.projects.length > 0 && (
        <SectionCard
          icon="🏗️"
          title="Chantiers en cours"
          desc="Ils progressent chaque jour de monde, même déconnecté. L'apport initial (15 %) est débité à la commande, le reste jour par jour ; sans trésorerie, le chantier ralentit de moitié."
          className="mb-16"
        >
          <div className="grid grid-2">
            {c.projects.map((p) => {
              const def = INFRA.find((d) => d.key === p.infra);
              const remainingDays = Math.max(0, Math.ceil((1 - p.progress) * p.buildDays));
              return (
                <div key={p.id} className="infra-card anim-rise">
                  <div className="row-between">
                    <div className="row" style={{ gap: 10 }}>
                      <span className="infra-ico" style={{ width: 40, height: 40, fontSize: '1.1rem' }} aria-hidden>{ICONS[p.infra as InfraKey] ?? '🏗️'}</span>
                      <div>
                        <strong className="small">{def?.name ?? p.infra}</strong>
                        <div className="tiny muted">niveau {p.targetLevel} · {remainingDays} jour(s) restant(s)</div>
                      </div>
                    </div>
                    <Badge tone="warn">{(p.progress * 100).toFixed(0)} %</Badge>
                  </div>
                  <ProgressBar value={p.progress * 100} height={9} tone="warn" />
                  <div className="row-between tiny muted">
                    <span>Investi : {p.invested.toFixed(1)} / {p.cost.toFixed(1)} Md €</span>
                    {isPlayer && <button className="btn btn-sm btn-danger" onClick={() => setCancelId(p.id)}>Annuler</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* ---------------- Catalogue par catégorie ---------------- */}
      {(cat === 'all' ? CATS.slice(1) : CATS.filter((k) => k.id === cat)).map((k) => {
        const defs = visible.filter((d) => d.category === k.id);
        if (defs.length === 0) return null;
        return (
          <div key={k.id} className="mb-16">
            <div className="kpi-group-title">{k.icon} {k.label} — <span style={{ textTransform: 'none', letterSpacing: 0 }}>{k.hint}</span></div>
            <div className="grid grid-3 stagger">
              {defs.map((def) => {
                const level = c.infra[def.key]?.level ?? 0;
                const maxed = level >= def.maxLevel;
                const inProgress = c.projects.some((p) => p.infra === def.key);
                const cost = costOf(def, level);
                return (
                  <div key={def.key} className={`infra-card anim-rise ${maxed ? 'maxed' : ''}`}>
                    <div className="row-between">
                      <div className="row" style={{ gap: 12 }}>
                        <span className="infra-ico" aria-hidden>{ICONS[def.key]}</span>
                        <div>
                          <strong style={{ fontSize: '0.98rem' }}>{def.name}</strong>
                          <div className="tiny muted">niveau {level}/{def.maxLevel}</div>
                        </div>
                      </div>
                      {maxed ? <Badge tone="good">MAX</Badge> : inProgress ? <Badge tone="warn">CHANTIER</Badge> : <Badge tone="info">{formatMoney(cost)}</Badge>}
                    </div>

                    <div className="pip-row" aria-label={`Niveau ${level} sur ${def.maxLevel}`}>
                      {Array.from({ length: def.maxLevel }, (_, i) => (
                        <span key={i} className={`pip ${i < level ? 'on' : ''} ${i < level && level >= def.maxLevel ? 'mint' : ''}`} />
                      ))}
                    </div>

                    <div className="col" style={{ gap: 6 }}>
                      {def.boosts.map((b) => (
                        <div key={b.label} className="boost-mini"><span className="bi" aria-hidden>{b.icon}</span><span>{b.label}</span></div>
                      ))}
                    </div>

                    <div className="row-between tiny muted">
                      <span>Entretien : {def.upkeepPerLevel.toFixed(1)} Md €/an/niv</span>
                      <span>Chantier : {def.buildDays} j</span>
                    </div>

                    {isPlayer && !maxed && (
                      <button
                        className="btn btn-primary btn-sm btn-wiggle btn-block"
                        disabled={inProgress || c.economy.cash < cost * 0.15}
                        title={c.economy.cash < cost * 0.15 ? `Apport initial insuffisant (${formatMoney(cost * 0.15)} requis)` : `Voir les boosts et lancer le chantier ${def.name}`}
                        onClick={() => setBuilding(def.key)}
                      >
                        {inProgress ? 'Chantier en cours…' : `🔍 Voir les boosts & construire`}
                      </button>
                    )}
                    {maxed && <div className="tiny center" style={{ color: 'var(--good)', fontWeight: 800 }}>✓ Réseau complet — effets maximaux actifs</div>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* ---------------- Modale de chantier animée ---------------- */}
      {buildingDef && (
        <BuildShowcase
          def={buildingDef}
          level={c.infra[buildingDef.key]?.level ?? 0}
          cost={costOf(buildingDef, c.infra[buildingDef.key]?.level ?? 0)}
          upkeepYear={buildingDef.upkeepPerLevel * (0.5 + c.economy.gdp / 6000)}
          levels={levels}
          onClose={() => setBuilding(null)}
          onEstimate={estimateForBuilding}
          onConfirm={(done) => {
            void runAction(c.id, { type: 'start_project', infra: buildingDef.key }).then((r) => {
              if (r.ok) {
                pushToast({ kind: 'success', title: `Chantier lancé : ${buildingDef.name}`, body: 'Les boosts seront actifs à la livraison.' });
                setBuilding(null);
                done(true);
              } else {
                // ERREUR SERVEUR : la fenêtre RESTE ouverte, message affiché dedans
                done(false, r.error ?? 'Refus du serveur');
              }
            });
          }}
        />
      )}

      {cancelId && (
        <div className="modal-backdrop" onClick={() => setCancelId(null)}>
          <div className="glass modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Annuler ce chantier ?</h3>
              <button className="modal-close" onClick={() => setCancelId(null)} aria-label="Fermer">✕</button>
            </div>
            <p className="small">L'investissement déjà versé est perdu (chantier interrompu), mais l'entretien futur est évité.</p>
            <div className="row mt-16" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setCancelId(null)}>Continuer le chantier</button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  void runAction(c.id, { type: 'cancel_project', projectId: cancelId }).then(() => setCancelId(null));
                }}
              >
                Annuler le chantier
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modale « boosts animés + impact réel chiffré »                      */
/* ------------------------------------------------------------------ */

const SLIDE_MS = 4500; // diapo suivante automatique toutes les 4,5 s

/** Texte machine à écrire (progressif), respectueux de prefers-reduced-motion. */
function TypeText({ text, speed = 16, delay = 0, className = '' }: { text: string; speed?: number; delay?: number; className?: string }) {
  const [n, setN] = useState(0);
  const reduced = useRef(typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false));
  useEffect(() => {
    if (reduced.current) { setN(text.length); return; }
    setN(0);
    let iv = 0;
    // v19 : intervalle plancher 24 ms et pas de 2 caractères si vitesse
    // rapide → même rendu visuel, 2× moins de re-renders React.
    const step = speed < 24 ? 2 : 1;
    const interval = Math.max(24, speed);
    const t0 = window.setTimeout(() => {
      iv = window.setInterval(() => {
        setN((v) => {
          if (v >= text.length) { window.clearInterval(iv); return v; }
          return Math.min(text.length, v + step);
        });
      }, interval);
    }, delay);
    return () => { window.clearTimeout(t0); window.clearInterval(iv); };
  }, [text, speed, delay]);
  const done = n >= text.length;
  return <span className={className}>{text.slice(0, n)}{!done && <span className="type-caret" aria-hidden />}</span>;
}

/* ------------------------------------------------------------------ */
/* DIAPORAMA de présentation d'un chantier :                           */
/*   intro → 1 diapo par boost → impact réel chiffré → coût → FINAL    */
/* Avance AUTOMATIQUEMENT toutes les ~3,2 s ; textes machine à écrire ; */
/* diapo finale = gros bouton central LANCER + « faire autre chose ».  */
/* ------------------------------------------------------------------ */

function BuildShowcase({
  def, level, cost, upkeepYear, levels, onClose, onConfirm, onEstimate,
}: {
  def: InfraDef;
  level: number;
  cost: number;
  upkeepYear: number;
  levels: (k: InfraKey) => number;
  onClose: () => void;
  onConfirm: (done: (ok: boolean, error?: string) => void) => void;
  onEstimate: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const cur = metricsOf(levels);
  const next = metricsOf((k) => (k === def.key ? level + 1 : levels(k)));
  const affects = AFFECTS[def.key] ?? [];
  const slides = useMemo(() => {
    const list: { kind: 'intro' | 'state' | 'boost' | 'impact' | 'delivery' | 'cost' | 'final'; boost?: InfraBoost }[] = [
      { kind: 'intro' },
      { kind: 'state' },
    ];
    for (const b of def.boosts) list.push({ kind: 'boost', boost: b });
    list.push({ kind: 'impact' }, { kind: 'delivery' }, { kind: 'cost' }, { kind: 'final' });
    return list;
  }, [def]);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<{ ok: boolean; error?: string } | null>(null);
  const slide = slides[Math.min(idx, slides.length - 1)]!;

  /* Vérification serveur dès l'ouverture : le CTA final sera désactivé AVEC
     la raison si le chantier est impossible (trésorerie, cooldown, 6 chantiers…). */
  useEffect(() => {
    let cancelled = false;
    void onEstimate().then((r) => { if (!cancelled) setEstimate(r); });
    return () => { cancelled = true; };
  }, [onEstimate]);

  /* Decorations de page en pause pendant la présentation (perf rendu logiciel). */
  useEffect(() => {
    document.body.classList.add('overlay-open');
    return () => document.body.classList.remove('overlay-open');
  }, []);

  /* Avance automatique (sauf diapo finale) — timers nettoyés à chaque slide. */
  useEffect(() => {
    if (slide.kind === 'final') return;
    const t = window.setTimeout(() => setIdx((i) => Math.min(i + 1, slides.length - 1)), SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [idx, slide.kind, slides.length]);

  const apport = cost * 0.15;
  const perDay = (cost - apport) / Math.max(1, def.buildDays);
  const blocked = estimate !== null && !estimate.ok;

  const confirm = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    onConfirm((ok, err) => {
      if (!ok) { setBusy(false); setError(err ?? 'Refus du serveur'); }
    });
  };

  return (
    <div className="modal-backdrop showcase-backdrop" role="dialog" aria-modal="true" aria-label={`Présentation du chantier ${def.name}`}>
      <div className="glass modal showcase" onClick={(e) => e.stopPropagation()}>
        <div className="showcase-orbs" aria-hidden />
        <div className="showcase-top">
          <div className="showcase-prog" aria-hidden><span key={idx} className="showcase-prog-fill" style={{ animationDuration: `${SLIDE_MS}ms` }} /></div>
          <div className="row" style={{ gap: 6 }} aria-hidden>
            {slides.map((_, i) => (
              <span key={i} className={`showcase-dot ${i === idx ? 'on' : ''} ${i < idx ? 'done' : ''}`} />
            ))}
          </div>
          {slide.kind !== 'final' && (
            <button className="btn btn-sm btn-ghost" onClick={() => setIdx(slides.length - 1)}>Passer ››</button>
          )}
        </div>

        <div key={idx} className="showcase-slide">
          {slide.kind === 'intro' && (
            <div className="center col" style={{ gap: 14, padding: '22px 10px' }}>
              <div className="showcase-ico" aria-hidden>{ICONS[def.key]}</div>
              <h2 className="showcase-title"><TypeText text={`Présentation : ${def.name}`} speed={30} /></h2>
              <p className="small muted" style={{ maxWidth: 470, margin: '0 auto', minHeight: 40 }}>
                <TypeText text={`${def.effect}. Passage au niveau ${level + 1} : installez-vous, on vous montre tout ce que ce chantier va changer.`} delay={600} speed={12} />
              </p>
            </div>
          )}

          {slide.kind === 'state' && (
            <div className="center col" style={{ gap: 12, padding: '18px 10px' }}>
              <h3 className="showcase-sub"><TypeText text="Aujourd'hui, dans votre pays" speed={20} /></h3>
              <div className="pip-row" style={{ width: 'min(430px, 100%)', margin: '0 auto' }} aria-label={`Niveau actuel ${level} sur ${def.maxLevel}`}>
                {Array.from({ length: def.maxLevel }, (_, i) => (
                  <span key={i} className={`pip ${i < level ? 'on' : ''}`} style={{ transitionDelay: `${i * 60}ms` }} />
                ))}
              </div>
              <div className="row wrap center" style={{ gap: 8, justifyContent: 'center' }}>
                <span className="badge badge-info">Niveau {level}/{def.maxLevel}</span>
                <span className="badge badge-neutral">Entretien actuel {(def.upkeepPerLevel * level * (0.5 + 0)).toFixed(1)} Md €/an</span>
                <span className="badge badge-violet">{CATS.find((k) => k.id === def.category)?.label ?? def.category}</span>
              </div>
              <p className="tiny muted" style={{ margin: 0, maxWidth: 440 }}>
                <TypeText text="Chaque niveau déjà construit applique ses bonus en continu. Voici ce que le niveau suivant ajoutera." delay={500} speed={12} />
              </p>
            </div>
          )}

          {slide.kind === 'boost' && slide.boost && (
            <div className="center col" style={{ gap: 14, padding: '22px 10px' }}>
              <div className="showcase-ico mini" aria-hidden>{slide.boost.icon}</div>
              <h3 className="showcase-sub"><TypeText text="Vous allez obtenir :" speed={22} /></h3>
              <div className="showcase-boost"><TypeText text={slide.boost.label} speed={20} delay={400} /></div>
              <div className="showcase-bar" aria-hidden />
              <p className="tiny muted" style={{ margin: 0 }}>Bonus PERMANENT, appliqué par le moteur dès la livraison du chantier.</p>
            </div>
          )}

          {slide.kind === 'impact' && (
            <div className="col" style={{ gap: 8, padding: '14px 6px' }}>
              <h3 className="showcase-sub">📊 Impact réel sur votre économie</h3>
              {affects.map((a, i) => (
                <div key={String(a.id)} className="impact-line" style={{ animationDelay: `${250 + i * 450}ms` }}>
                  <span>{a.label}</span>
                  <span><span className="muted">{a.fmt(cur[String(a.id)] ?? 0)}</span> → <b>{a.fmt(next[String(a.id)] ?? 0)}</b></span>
                </div>
              ))}
              <div className="impact-line cost" style={{ animationDelay: `${250 + affects.length * 450}ms` }}>
                <span>Entretien annuel ajouté</span>
                <b>+{upkeepYear.toFixed(2)} Md €/an</b>
              </div>
            </div>
          )}

          {slide.kind === 'delivery' && (
            <div className="center col" style={{ gap: 12, padding: '18px 10px' }}>
              <div className="showcase-ico mini" aria-hidden>🏗️</div>
              <h3 className="showcase-sub"><TypeText text="Le chantier, jour après jour" speed={20} /></h3>
              <div className="showcase-days" aria-hidden>
                {Array.from({ length: Math.min(12, def.buildDays) }, (_, i) => (
                  <span key={i} className="day-cell" style={{ animationDelay: `${300 + i * 140}ms` }} />
                ))}
              </div>
              <p className="small muted" style={{ maxWidth: 440, margin: '0 auto', minHeight: 36 }}>
                <TypeText text={`${def.buildDays} jours de monde : la progression avance même déconnecté. À la livraison : notification, effets immédiats, et le niveau s'allume sur votre carte.`} delay={400} speed={12} />
              </p>
            </div>
          )}

          {slide.kind === 'cost' && (
            <div className="col" style={{ gap: 8, padding: '14px 6px' }}>
              <h3 className="showcase-sub">💰 Coût & déroulé du chantier</h3>
              <div className="impact-line cost" style={{ animationDelay: '250ms' }}><span>Coût total</span><b>{formatMoney(cost)}</b></div>
              <div className="impact-line cost" style={{ animationDelay: '700ms' }}><span>Apport immédiat (15 %)</span><b>{formatMoney(apport)}</b></div>
              <div className="impact-line cost" style={{ animationDelay: '1150ms' }}><span>Puis chaque jour de chantier</span><b>{perDay.toFixed(2)} Md €</b></div>
              <div className="impact-line" style={{ animationDelay: '1600ms' }}><span>Durée</span><b>{def.buildDays} jours de monde</b></div>
              <p className="tiny muted" style={{ animationDelay: '2000ms', margin: '4px 0 0' }}>Effets actifs dès la livraison · chantier annulable (investissement perdu).</p>
            </div>
          )}

          {slide.kind === 'final' && (
            <div className="center col" style={{ gap: 14, padding: '24px 10px' }}>
              <div className="showcase-confetti" aria-hidden>
                {Array.from({ length: 14 }, (_, i) => (
                  <span key={i} style={{ left: `${(i * 7.3 + 4) % 96}%`, animationDelay: `${i * 180}ms` }} />
                ))}
              </div>
              <div className="showcase-ico" aria-hidden>{ICONS[def.key]}</div>
              <h2 className="showcase-title">Alors, on construit ?</h2>
              <p className="small muted" style={{ maxWidth: 460, margin: '0 auto' }}>
                {def.name} niveau {level + 1} : {def.boosts.map((b) => b.label).join(' · ')}.
              </p>
              {error && (
                <div className="showcase-error" role="alert">⚠️ {error}</div>
              )}
              {blocked && !error && estimate?.error && (
                <div className="showcase-error" role="alert">⚠️ {estimate.error}</div>
              )}
              <div className="showcase-actions">
                <button
                  className="btn btn-primary btn-rocket showcase-cta"
                  disabled={busy || blocked}
                  title={blocked ? (estimate?.error ?? 'Chantier impossible actuellement') : `Lancer le chantier ${def.name}`}
                  onClick={confirm}
                >
                  <span className="rk" aria-hidden>🚀</span>{busy ? 'Lancement…' : 'LANCER LE CHANTIER'}
                </button>
                <button className="btn btn-ghost showcase-alt" onClick={onClose}>Faire autre chose</button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
