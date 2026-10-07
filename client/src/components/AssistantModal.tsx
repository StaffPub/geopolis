/**
 * GEOPOLIS — Fenêtre d'assistance (bouton ❓ du header).
 * Assistant de jeu complet : base de 2000+ réponses (kb.ts), algorithme de
 * détection de question (match.ts : normalisation, intentions, TF-IDF,
 * index inversé, tolérance aux fautes), réponses typographiées en machine à
 * écrire, suggestions animées, catégories filtrables. 100 % client, aucun
 * appel réseau : disponible instantanément, toujours.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TradeCorridor } from 'shared';
import { useAuth } from '../state/AuthContext.js';
import { useGame } from '../state/GameContext.js';
import { game as gameApi } from '../lib/api.js';
import { buildKb, POPULAR_QUESTIONS, type AssistCategory, type KbEntry } from '../lib/assistant/kb.js';
import { askAssistant, buildIndex, type AskResult } from '../lib/assistant/match.js';

const CATEGORIES: { id: AssistCategory | 'tout'; label: string; icon: string }[] = [
  { id: 'tout', label: 'Tout', icon: '🌐' },
  { id: 'débutant', label: 'Débuter', icon: '🌱' },
  { id: 'économie', label: 'Économie', icon: '📈' },
  { id: 'routes', label: 'Routes', icon: '🧭' },
  { id: 'commerce', label: 'Commerce', icon: '🚢' },
  { id: 'diplomatie', label: 'Diplomatie', icon: '🤝' },
  { id: 'politique', label: 'Politique', icon: '🏛️' },
  { id: 'ressources', label: 'Ressources', icon: '🛢️' },
  { id: 'interface', label: 'Interface', icon: '🖥️' },
  { id: 'erreurs', label: 'Erreurs', icon: '⚠️' },
  { id: 'général', label: 'Général', icon: '📘' },
];

/** Effet machine à écrire : révèle le texte progressivement. */
function useTypewriter(text: string, speed = 9): { shown: string; done: boolean; skip: () => void } {
  const [shown, setShown] = useState('');
  const [done, setDone] = useState(false);
  const raf = useRef<number | null>(null);
  const start = useRef(0);

  useEffect(() => {
    setShown('');
    setDone(false);
    start.current = performance.now();
    const step = (now: number): void => {
      const chars = Math.floor((now - start.current) / (1000 / 60) * speed / 10);
      if (chars >= text.length) {
        setShown(text);
        setDone(true);
        return;
      }
      setShown(text.slice(0, Math.max(1, chars)));
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [text, speed]);

  const skip = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    setShown(text);
    setDone(true);
  }, [text]);

  return { shown, done, skip };
}

export function AssistantModal({ onClose }: { onClose: () => void }) {
  const { countryId } = useAuth();
  const { myCountry, countries, market, meta } = useGame();
  const [corridors, setCorridors] = useState<TradeCorridor[]>([]);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<AskResult | null>(null);
  const [selected, setSelected] = useState<KbEntry | null>(null);
  const [category, setCategory] = useState<AssistCategory | 'tout'>('tout');
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  /* Corridors (pour les entrées routes) — chargés une fois à l'ouverture */
  useEffect(() => {
    let cancelled = false;
    gameApi.corridors().then((r) => { if (!cancelled) setCorridors(r.corridors); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  /* Base de connaissances + index (mémoïsés : recalculés si le pays change) */
  const kb = useMemo(
    () => buildKb({
      country: myCountry && myCountry.id === countryId ? myCountry : null,
      countries,
      corridors,
      market,
      meta,
    }),
    [myCountry, countryId, countries, corridors, market, meta],
  );
  const index = useMemo(() => buildIndex(kb), [kb]);

  /* Recherche débouncée */
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 220);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debounced.trim()) { setResult(null); return; }
    setResult(askAssistant(debounced, index));
  }, [debounced, index]);

  /* ESC pour fermer */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    inputRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ask = (q: string): void => {
    setQuery(q);
    setDebounced(q);
    const r = askAssistant(q, index);
    setResult(r);
    if (r.confident && r.best) setSelected(r.best.entry);
    else setSelected(null);
  };

  const { shown, done, skip } = useTypewriter(selected?.answer ?? '');

  /* Liste exploratoire (par catégorie) quand aucune recherche */
  const browse = useMemo(() => {
    const pool = category === 'tout' ? kb : kb.filter((e) => e.cat === category);
    // Titres uniques (une entrée par titre) pour une liste lisible
    const seen = new Set<string>();
    const titles: KbEntry[] = [];
    for (const e of pool) {
      if (seen.has(e.title)) continue;
      seen.add(e.title);
      titles.push(e);
      if (titles.length >= 60) break;
    }
    return titles;
  }, [kb, category]);

  const searchResults = result && query.trim() && !selected ? result.alternatives : [];

  return (
    <div className="assist-backdrop" role="dialog" aria-modal="true" aria-label="Assistant de jeu" onClick={onClose}>
      <div className="assist-panel anim-scale-in" onClick={(e) => e.stopPropagation()}>
        {/* -------- Header -------- */}
        <div className="assist-header">
          <div className="assist-orb" aria-hidden>
            <span>❓</span>
          </div>
          <div className="flex1">
            <h2 style={{ margin: 0 }}>Assistant GEOPOLIS</h2>
            <div className="tiny muted">
              {kb.length.toLocaleString('fr-FR')} réponses · posez n'importe quelle question sur le jeu
            </div>
          </div>
          <button className="btn btn-sm" onClick={onClose} aria-label="Fermer l'assistant">✕</button>
        </div>

        {/* -------- Recherche -------- */}
        <div className="assist-search">
          <span className="assist-search-ico" aria-hidden>🔎</span>
          <input
            ref={inputRef}
            className="input assist-input"
            placeholder="Ex. : comment acheter une route ? pourquoi mon déficit augmente ?"
            value={query}
            maxLength={140}
            onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && result?.best) setSelected(result.best.entry);
            }}
          />
          {query && (
            <button className="btn btn-sm" onClick={() => { setQuery(''); setSelected(null); inputRef.current?.focus(); }} aria-label="Effacer">
              ✕
            </button>
          )}
        </div>

        {/* -------- Catégories -------- */}
        <div className="assist-cats">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`assist-cat ${category === c.id ? 'active' : ''}`}
              onClick={() => { setCategory(c.id); setSelected(null); }}
            >
              <span aria-hidden>{c.icon}</span> {c.label}
            </button>
          ))}
        </div>

        {/* -------- Corps -------- */}
        <div className="assist-body">
          {selected ? (
            <div className="assist-answer anim-fade-up">
              <button className="btn btn-sm mb-8" onClick={() => setSelected(null)}>← Autres réponses</button>
              <div className="row-between wrap" style={{ gap: 8 }}>
                <h3 style={{ margin: 0 }}>
                  {selected.cat === 'routes' ? '🧭 ' : selected.cat === 'économie' ? '📈 ' : selected.cat === 'diplomatie' ? '🤝 ' : selected.cat === 'politique' ? '🏛️ ' : selected.cat === 'ressources' ? '🛢️ ' : selected.cat === 'erreurs' ? '⚠️ ' : selected.cat === 'commerce' ? '🚢 ' : selected.cat === 'débutant' ? '🌱 ' : selected.cat === 'interface' ? '🖥️ ' : '📘 '}
                  {selected.title}
                </h3>
                <span className="badge badge-neutral">{selected.cat}</span>
              </div>
              <div className="assist-answer-text" onClick={() => { if (!done) skip(); }}>
                {shown.split('\n').map((line, i) => <p key={i} style={{ margin: '8px 0' }}>{line}</p>)}
                {!done && <span className="assist-caret" aria-hidden />}
              </div>
              {done && (
                <div className="row wrap mt-8" style={{ gap: 8 }}>
                  {POPULAR_QUESTIONS.filter((q) => q.toLowerCase() !== selected.title.toLowerCase()).slice(0, 4).map((q) => (
                    <button key={q} className="assist-chip" onClick={() => ask(q)}>{q}</button>
                  ))}
                </div>
              )}
            </div>
          ) : query.trim() && result ? (
            <div className="anim-fade-in">
              {result.best && result.confident ? (
                <button className="assist-result best anim-slide-right" onClick={() => setSelected(result.best!.entry)}>
                  <span className="assist-result-ico" aria-hidden>🎯</span>
                  <span className="flex1">
                    <strong>{result.best.entry.title}</strong>
                    <span className="tiny muted"> Meilleure réponse — cliquez pour l'afficher</span>
                  </span>
                  <span className="tiny mono muted">{Math.round(result.best.score)}</span>
                </button>
              ) : (
                <div className="small muted mb-8">
                  Je ne suis pas certain d'avoir compris. Voici mes meilleures pistes — ou reformulez avec les mots du jeu (péage, solde, mandat, route…) :
                </div>
              )}
              {(result.best && !result.confident ? [result.best, ...searchResults] : searchResults).slice(0, 6).map((r, i) => (
                <button
                  key={r.entry.id}
                  className="assist-result anim-slide-right"
                  style={{ animationDelay: `${i * 45}ms` }}
                  onClick={() => setSelected(r.entry)}
                >
                  <span className="assist-result-ico" aria-hidden>💡</span>
                  <span className="flex1"><strong>{r.entry.title}</strong></span>
                  <span className="tiny mono muted">{Math.round(r.score)}</span>
                </button>
              ))}
              {!result.best && (
                <div className="small muted">
                  Aucune piste trouvée. Essayez : « solde budgétaire », « acheter une route », « popularité basse », « booster ma production »…
                </div>
              )}
            </div>
          ) : (
            <div className="anim-fade-in">
              <div className="tiny muted mb-8" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                Questions fréquentes
              </div>
              <div className="row wrap mb-16" style={{ gap: 8 }}>
                {POPULAR_QUESTIONS.map((q, i) => (
                  <button key={q} className="assist-chip anim-fade-up" style={{ animationDelay: `${i * 35}ms` }} onClick={() => ask(q)}>
                    {q}
                  </button>
                ))}
              </div>
              <div className="tiny muted mb-8" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                Explorer {category === 'tout' ? '' : `· ${category}`}
              </div>
              <div className="assist-browse">
                {browse.map((e, i) => (
                  <button
                    key={e.id}
                    className="assist-browse-item anim-fade-up"
                    style={{ animationDelay: `${Math.min(i, 20) * 18}ms` }}
                    onClick={() => setSelected(e)}
                  >
                    <span className="tiny muted">{e.cat}</span>
                    <span>{e.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="assist-footer tiny muted">
          Astuce : l'assistant connaît vos chiffres réels — demandez « mon solde », « mes routes », « le canal de Suez »…
        </div>
      </div>
    </div>
  );
}
