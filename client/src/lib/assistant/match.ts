/**
 * GEOPOLIS — Assistant : algorithme de détection de question.
 * Pipeline complet et déterministe :
 *   1. normalisation (casse, accents, ponctuation)
 *   2. détection d'intention (définition, comment, pourquoi, combien, quand, action)
 *   3. tokenisation + mots vides français
 *   4. index inversé (token → entrées) construit une fois par base
 *   5. scoring TF-IDF : recouvrement de tokens pondéré par rareté,
 *      bonus d'expression exacte, bonus de titre, tolérance aux fautes
 *      (Levenshtein ≤ 1 pour les mots longs)
 *   6. classement + seuil de confiance (jamais de réponse inventée :
 *      sous le seuil, on propose les meilleures pistes)
 */
import type { KbEntry } from './kb.js';

export type Intent = 'what' | 'how' | 'why' | 'howmuch' | 'when' | 'action' | 'none';

export interface MatchResult {
  entry: KbEntry;
  score: number;
}

export interface AskResult {
  best: MatchResult | null;
  alternatives: MatchResult[];
  confident: boolean;
  intent: Intent;
}

const STOPWORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'da', 'au', 'aux', 'et', 'ou', 'a', 'à',
  'en', 'dans', 'sur', 'sous', 'par', 'pour', 'avec', 'sans', 'chez', 'vers', 'entre',
  'ce', 'cet', 'cette', 'ces', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses',
  'notre', 'votre', 'leur', 'leurs', 'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils',
  'est', 'sont', 'etre', 'avoir', 'ai', 'as', 'ont', 'fait', 'faire', 'faut', 'peut', 'peux',
  'comme', 'plus', 'moins', 'tres', 'bien', 'mal', 'tout', 'tous', 'toute', 'toutes',
  'que', 'qui', 'quoi', 'quand', 'ou', 'dont', 'quel', 'quelle', 'quels', 'quelles',
  'si', 'non', 'oui', 'ne', 'pas', 'plus', 'jamais', 'toujours', 'encore', 'deja',
  'moi', 'toi', 'lui', 'eux', 'y', 'd', 'l', 'n', 'm', 't', 's', 'j', 'c', 'qu', 'est-ce',
  'cela', 'ca', 'ça', 'the', 'of', 'to', 'is', 'are', 'in', 'my', 'me', 'i',
]);

/** Normalisation : minuscules, sans accents, apostrophes séparées, sans ponctuation. */
export function normalizeFr(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’ʼ]/g, ' ')
    .replace(/[^a-z0-9 -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  return normalizeFr(text)
    .split(' ')
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** Détection d'intention depuis la formulation de la question. */
export function detectIntent(raw: string): Intent {
  const t = normalizeFr(raw);
  if (/(^|\s)(combien|prix|cout|quel pourcentage|quelle est la valeur)/.test(t)) return 'howmuch';
  if (/(^|\s)(comment|de quelle maniere|par quel moyen|quelle etape)/.test(t)) return 'how';
  if (/(^|\s)(pourquoi|pour quelle raison|quelle cause|d ou vient)/.test(t)) return 'why';
  if (/(^|\s)(quand|a quel moment|quel jour|delai)/.test(t)) return 'when';
  if (/(^|\s)(ou|dans quelle page|quel onglet|quel bouton|quel ecran)/.test(t)) return 'action';
  if (/(^|\s)(c est quoi|qu est ce que|definition|que signifie|ca veut dire|explique|explication|decrire)/.test(t)) return 'what';
  if (/(^|\s)(faire|augmenter|baisser|reduire|monter|acheter|vendre|construire|signer|changer|corriger|regler|ameliorer)/.test(t)) return 'action';
  return 'none';
}

/** Distance de Levenshtein bornée à 1 (rapide, pour la tolérance aux fautes). */
function withinOneEdit(a: string, b: string): boolean {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edited = false;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (edited) return false;
    edited = true;
    if (la === lb) { i++; j++; }
    else if (la > lb) { i++; }
    else { j++; }
  }
  return true;
}

export interface KbIndex {
  entries: KbEntry[];
  /** token → indices d'entrées (patterns + titre) */
  inverted: Map<string, number[]>;
  /** idf pré-calculé par token */
  idf: Map<string, number>;
  /** patterns normalisés par entrée (pour bonus d'expression) */
  normPatterns: string[][];
  normTitles: string[];
}

/** Construit l'index inversé d'une base (une fois, mémoïsé côté UI). */
export function buildIndex(entries: KbEntry[]): KbIndex {
  const inverted = new Map<string, number[]>();
  const normPatterns: string[][] = [];
  const normTitles: string[] = [];
  entries.forEach((e, idx) => {
    const pats = e.patterns.map((p) => normalizeFr(p));
    normPatterns.push(pats);
    normTitles.push(normalizeFr(e.title));
    const tokens = new Set<string>();
    for (const p of pats) for (const t of tokenize(p)) tokens.add(t);
    for (const t of tokenize(e.title)) tokens.add(t);
    for (const t of tokens) {
      const list = inverted.get(t);
      if (list) list.push(idx);
      else inverted.set(t, [idx]);
    }
  });
  const N = entries.length;
  const idf = new Map<string, number>();
  for (const [t, list] of inverted) {
    idf.set(t, Math.log(1 + N / Math.max(1, list.length)));
  }
  return { entries, inverted, idf, normPatterns, normTitles };
}

/** Recherche : retourne la meilleure réponse + alternatives, avec confiance. */
export function askAssistant(question: string, index: KbIndex, maxResults = 6): AskResult {
  const intent = detectIntent(question);
  const raw = normalizeFr(question);
  const qTokens = tokenize(question);
  const empty: AskResult = { best: null, alternatives: [], confident: false, intent };
  if (qTokens.length === 0) return empty;

  const scores = new Map<number, number>();
  const addScore = (idx: number, s: number): void => {
    scores.set(idx, (scores.get(idx) ?? 0) + s);
  };

  // 1) Recouvrement de tokens via l'index inversé (pondéré idf)
  for (const qt of qTokens) {
    const postings = index.inverted.get(qt);
    if (postings && postings.length > 0) {
      const w = index.idf.get(qt) ?? 1;
      for (const idx of postings) addScore(idx, w);
      continue;
    }
    // 2) Tolérance aux fautes : Levenshtein ≤ 1 (mots de 6+ caractères)
    if (qt.length >= 6) {
      for (const [vt, vpost] of index.inverted) {
        if (vt.length >= 5 && withinOneEdit(qt, vt)) {
          const w = (index.idf.get(vt) ?? 1) * 0.65;
          for (const idx of vpost) addScore(idx, w);
          break; // premier équivalent suffit
        }
      }
    }
  }

  // 3) Bonus d'expression (sous-chaîne) sur patterns et titres
  if (raw.length >= 6) {
    for (const idx of scores.keys()) {
      const pats = index.normPatterns[idx]!;
      for (const p of pats) {
        if (p.length >= 6 && raw.includes(p)) { addScore(idx, 6 + p.length * 0.35); break; }
        if (raw.length >= 10 && p.includes(raw)) { addScore(idx, 5); break; }
      }
      const title = index.normTitles[idx]!;
      if (title.length >= 6 && raw.includes(title)) addScore(idx, 4);
    }
  }

  // 4) Bonus d'intention : la forme de la question oriente la facette
  if (intent !== 'none') {
    const intentHints: Record<Exclude<Intent, 'none'>, string[]> = {
      what: ['qu est ce', 'c est quoi', 'definition', 'vue d ensemble', 'role'],
      how: ['comment', 'mecanisme', 'augmenter', 'baisser'],
      why: ['pourquoi', 'erreur', 'cause', 'declenchement', 'limites'],
      howmuch: ['combien', 'cout', 'prix', 'chiffre', 'seuil', 'duree'],
      when: ['quand', 'moment', 'priorite'],
      action: ['comment faire', 'page', 'bouton', 'action'],
    };
    const hints = intentHints[intent];
    for (const idx of scores.keys()) {
      const title = index.normTitles[idx]!;
      if (hints.some((h) => title.includes(h))) addScore(idx, 2.2);
    }
  }

  // 5) Classement
  const ranked: MatchResult[] = [...scores.entries()]
    .map(([idx, score]) => ({ entry: index.entries[idx]!, score: round2(score) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  if (ranked.length === 0) return empty;
  const best = ranked[0]!;
  // Seuil de confiance : au moins 2 tokens rares OU une expression exacte
  const threshold = qTokens.length === 1 ? 3.2 : 4.6;
  return {
    best,
    alternatives: ranked.slice(1).filter((r) => r.score >= best.score * 0.45),
    confident: best.score >= threshold,
    intent,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
