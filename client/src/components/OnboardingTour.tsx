/**
 * GEOPOLIS — Tutoriel v3 : guide compagnon non-bloquant.
 * - Dock fixe en bas à droite (jamais d'overlay plein écran : le site reste utilisable).
 * - Surligne l'élément réel concerné par l'étape (nav, hero, panneaux).
 * - Progrès persisté (localStorage) : reprend où tu en étais, ne se rouvre pas tout seul une fois terminé.
 * - Navigue avec l'utilisateur (bouton Explorer) sans jamais disparaître par accident.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const TOUR_KEY = 'gp-tour-v3';

interface TourState {
  seen: boolean;
  step: number;
}

function readState(): TourState {
  try {
    const raw = localStorage.getItem(TOUR_KEY);
    if (raw) return { seen: false, step: 0, ...JSON.parse(raw) };
  } catch { /* stockage indisponible */ }
  return { seen: false, step: 0 };
}

function writeState(st: TourState): void {
  try {
    localStorage.setItem(TOUR_KEY, JSON.stringify(st));
  } catch { /* ignore */ }
}

export function tourAlreadySeen(): boolean {
  return readState().seen;
}

interface Step {
  icon: string;
  title: string;
  body: string;
  tips: string[];
  route?: string;
  target?: string;
  cta?: string;
}

const STEPS: Step[] = [
  {
    icon: '🌍',
    title: 'Bienvenue, Président',
    body: 'GEOPOLIS : un monde unique et persistant de 36 nations. Le temps passe même hors connexion — tes décisions, elles, restent.',
    tips: [
      '● EN DIRECT = joueurs connectés + dirigeants IA actifs',
      '1 tick réel = 1 jour de monde',
      'Aucune guerre : tout se joue à l’économique et au diplomatique',
    ],
  },
  {
    icon: '',
    title: 'Ta nation, ton mandat',
    body: 'Cette bannière est ton tableau de commande : popularité, risque politique, stabilité. La popularité sous 35 % trop longtemps = chute du gouvernement.',
    tips: [
      'Le anneau de popularité se remplit en direct',
      'Risque FAIBLE / MODÉRÉ / ÉLEVÉ / CRITIQUE = ton alerte vitale',
    ],
    route: '/game',
    target: '[data-tour="hero"]',
    cta: 'Voir ma nation',
  },
  {
    icon: '📣',
    title: 'Le peuple te parle',
    body: 'Ce panneau liste les revendications calculées depuis l’état RÉEL de ton pays : emploi, prix, soins, logements, stocks… Plus la barre est rouge, plus c’est urgent.',
    tips: [
      'Traiter une revendication = popularité qui remonte',
      'Les ignorer = risque politique qui monte',
    ],
    route: '/game',
    target: '[data-tour="demands"]',
    cta: 'Voir les revendications',
  },
  {
    icon: '🗺️',
    title: 'La carte du monde',
    body: 'Clique sur une nation pour tout savoir dessus. Les traits lumineux animés sont les vraies routes commerciales du moteur.',
    tips: [
      'Molette = zoom, glisser = déplacement',
      'Modes : économie, ressources, commerce, diplomatie…',
    ],
    route: '/game/map',
    target: '[data-tour="/game/map"]',
    cta: 'Explorer la carte',
  },
  {
    icon: '📈',
    title: 'L’économie',
    body: 'PIB, inflation, chômage, stocks, prix mondiaux : tout est mesuré par le moteur. Une pénurie d’énergie casse ta production — surveille les barres rouges.',
    tips: [
      'Les graphiques = tes 160 derniers jours de monde',
      'Achète/vends sur le marché mondial pour équilibrer',
    ],
    route: '/game/economy',
    target: '[data-tour="/game/economy"]',
    cta: 'Ouvrir l’économie',
  },
  {
    icon: '🏛️',
    title: 'La politique',
    body: 'Curseurs de fiscalité, budget par secteur, taux directeur. Chaque réglage affiche ses effets estimés AVANT confirmation — pas de surprise.',
    tips: [
      'Bouge un curseur → « Appliquer » → confirme',
      'Trop d’impôts tue la popularité',
    ],
    route: '/game/politics',
    target: '[data-tour="/game/politics"]',
    cta: 'Gouverner',
  },
  {
    icon: '📜',
    title: 'Lois & réformes',
    body: 'Adopte des lois durables : bonus réels, coût annuel, impact popularité affiché. Le peuple peut se mécontenter — à toi de doser.',
    tips: [
      '6 lois maximum simultanées',
      'Une loi impopulaire pendant une crise = danger',
    ],
    route: '/game/laws',
    target: '[data-tour="/game/laws"]',
    cta: 'Voir les lois',
  },
  {
    icon: '🤝',
    title: 'La diplomatie',
    body: 'Propose accords, aides, coopérations. Les IA et les joueurs répondent en temps réel via tes notifications.',
    tips: [
      'Un accord exige un niveau de relations minimal',
      'Mesure économique = suspension des échanges (jamais de guerre)',
    ],
    route: '/game/diplomacy',
    target: '[data-tour="/game/diplomacy"]',
    cta: 'Négocier',
  },
  {
    icon: '🏗️',
    title: 'Investir pour demain',
    body: 'Chaque chantier coûte un apport (15 %) puis paie chaque jour de construction. À la livraison : bonus durables de productivité, commerce ou services.',
    tips: [
      'Les chantiers avancent même déconnecté',
      'L’entretien annuel s’ajoute au budget',
    ],
    route: '/game/infrastructure',
    target: '[data-tour="/game/infrastructure"]',
    cta: 'Investir',
  },
  {
    icon: '🎮',
    title: 'À toi de jouer',
    body: 'Tu connais l’essentiel. Le monde t’attend : chaque jour compte, chaque décision laisse une trace dans ton journal.',
    tips: [
      '🎓 Tutoriel relançable via menu 👤 ou pied de nav',
      'Bonne chance, Président',
    ],
  },
];

export function OnboardingTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const initial = useMemo(() => readState().step, []);
  const [i, setI] = useState(initial);
  const [tipsOpen, setTipsOpen] = useState(false);
  const step = STEPS[Math.min(i, STEPS.length - 1)]!;

  /* Reprise de l'étape SAUVEGARDÉE à chaque ouverture (ex. après « Recommencer ») */
  useEffect(() => {
    if (open) setI(readState().step);
  }, [open]);

  /* Persistance du progrès */
  useEffect(() => {
    if (open) writeState({ seen: readState().seen, step: i });
  }, [i, open]);

  /* Surlignage de la cible réelle */
  useEffect(() => {
    if (!open) return;
    const el = step.target ? document.querySelector(step.target) : null;
    if (el) {
      el.classList.add('tour-target');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    return () => {
      if (el) el.classList.remove('tour-target');
    };
  }, [open, step]);

  useEffect(() => setTipsOpen(false), [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!open) return null;

  function next() {
    setI((v) => Math.min(STEPS.length - 1, v + 1));
  }
  function finish() {
    writeState({ seen: true, step: 0 });
    onClose();
  }
  function explore() {
    if (step.route) navigate(step.route);
    next();
  }

  return (
    <div className="tour-dock" role="dialog" aria-label="Tutoriel GEOPOLIS">
      <div className="tour-head">
        <span className="badge badge-violet">TUTORIEL</span>
        <span className="tiny muted">{i + 1} / {STEPS.length}</span>
        <div className="tour-progress" aria-hidden>
          {STEPS.map((_, k) => (
            <button
              key={k}
              className={`tour-dot ${k === i ? 'active' : k < i ? 'done' : ''}`}
              onClick={() => setI(k)}
              aria-label={`Étape ${k + 1}`}
            />
          ))}
        </div>
        <button className="modal-close" onClick={finish} aria-label="Fermer le tutoriel">✕</button>
      </div>

      <div className="tour-body">
        <div className="tour-icon" aria-hidden>{step.icon}</div>
        <div className="flex1">
          <h3 style={{ margin: 0 }}>{step.title}</h3>
          <p className="small" style={{ margin: '6px 0 0' }}>{step.body}</p>
          {tipsOpen && (
            <ul className="tour-tips anim-fade-in">
              {step.tips.map((t, k) => (
                <li key={k}>{t}</li>
              ))}
            </ul>
          )}
          <button className="tour-tips-btn" onClick={() => setTipsOpen((v) => !v)}>
            {tipsOpen ? '− Masquer les astuces' : '＋ Astuces'}
          </button>
        </div>
      </div>

      <div className="tour-controls">
        <button className="btn btn-sm" disabled={i === 0} onClick={() => setI(i - 1)}>←</button>
        {step.route ? (
          <button className="btn btn-sm btn-primary btn3d" onClick={explore}>{step.cta ?? 'Explorer'} →</button>
        ) : i < STEPS.length - 1 ? (
          <button className="btn btn-sm btn-primary btn3d" onClick={next}>Suivant →</button>
        ) : (
          <button className="btn btn-sm btn-good btn3d" onClick={finish}>🎮 Terminer</button>
        )}
        <button className="tour-skip" onClick={finish}>Passer</button>
      </div>
    </div>
  );
}

export function useTourState(): { open: boolean; start: () => void; close: () => void } {
  const [open, setOpen] = useState(false);
  const start = useCallback(() => {
    writeState({ seen: readState().seen, step: 0 });
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return useMemo(() => ({ open, start, close }), [open, start, close]);
}
