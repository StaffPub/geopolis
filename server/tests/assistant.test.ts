/**
 * Tests de l'assistant de jeu (logique cliente pure, importée ici car 100 %
 * TypeScript sans DOM) : taille de la base (≥ 2000 réponses), algorithme de
 * détection de question (TF-IDF + index inversé + fuzzy + intentions),
 * robustesse (entrées vides, fautes, charabia), déterminisme et performance.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { MemoryStorage } from '../src/storage/memory.js';
import { WorldStore } from '../src/world/world.js';
import { buildKb, POPULAR_QUESTIONS, type AssistContext, type KbEntry } from '../../client/src/lib/assistant/kb.js';
import { askAssistant, buildIndex, detectIntent, normalizeFr, tokenize, type KbIndex } from '../../client/src/lib/assistant/match.js';

let kb: KbEntry[] = [];
let index: KbIndex;

beforeAll(async () => {
  const storage = new MemoryStorage();
  const world = await WorldStore.seed(storage);
  const ctx: AssistContext = {
    country: world.country('france')!,
    countries: world.allCountries().map((c) => world.publicCountry(c)),
    corridors: [...world.corridors.values()],
    market: world.market,
    meta: world.meta,
  };
  kb = buildKb(ctx);
  index = buildIndex(kb);
});

describe('Base de connaissances', () => {
  it('contient au moins 2000 réponses possibles', () => {
    expect(kb.length, `${kb.length} entrées seulement`).toBeGreaterThanOrEqual(2000);
  });

  it('chaque entrée est valide (id unique, patterns, réponse non vide)', () => {
    const ids = new Set<string>();
    for (const e of kb) {
      expect(e.id.length).toBeGreaterThan(2);
      expect(ids.has(e.id), `id dupliqué : ${e.id}`).toBe(false);
      ids.add(e.id);
      expect(e.patterns.length, `${e.id} sans pattern`).toBeGreaterThan(0);
      expect(e.answer.trim().length, `${e.id} sans réponse`).toBeGreaterThan(15);
      expect(e.title.trim().length).toBeGreaterThan(2);
    }
  });

  it('couvre les 36 nations, les 32 routes, les lois, ressources, événements', () => {
    const text = kb.map((e) => `${e.title} ${e.patterns.join(' ')}`).join(' | ').toLowerCase();
    expect(text).toContain('france');
    expect(text).toContain('canal de suez');
    expect(text).toContain('détroit de malacca');
    expect(text).toContain('couverture santé');
    expect(text).toContain('pétrole');
    expect(text).toContain('pénurie énergétique');
    expect(text).toContain('consigne');
    expect(text).toContain('offre');
    expect(text).toContain('bilatéral');
    expect(kb.filter((e) => e.id.startsWith('cty-')).length).toBeGreaterThanOrEqual(36 * 8);
    expect(kb.filter((e) => e.id.startsWith('cor-')).length).toBeGreaterThanOrEqual(32 * 7);
  });

  it('les questions populaires trouvent toutes une réponse confiante', () => {
    for (const q of POPULAR_QUESTIONS) {
      const r = askAssistant(q, index);
      expect(r.best, `aucune réponse pour « ${q} »`).not.toBeNull();
      expect(r.confident, `pas confiant pour « ${q} » → ${r.best?.entry.title}`).toBe(true);
    }
  });
});

describe('Algorithme de détection de question', () => {
  it('normalisation : accents, casse, ponctuation', () => {
    expect(normalizeFr('Péage ?!')).toBe('peage');
    expect(normalizeFr('SOLDE   Budgétaire—')).toBe('solde budgetaire');
    expect(tokenize('Comment acheter une route ?')).toEqual(['comment', 'acheter', 'route']);
  });

  it('intentions détectées', () => {
    expect(detectIntent("C'est quoi le solde budgétaire ?")).toBe('what');
    expect(detectIntent('Comment acheter une route ?')).toBe('how');
    expect(detectIntent('Pourquoi mon déficit augmente ?')).toBe('why');
    expect(detectIntent('Combien coûte le canal de Suez ?')).toBe('howmuch');
    expect(detectIntent('Quand lancer un chantier ?')).toBe('when');
    expect(detectIntent('Où régler les péages ?')).toBe('action');
    expect(detectIntent('le monde tourne')).toBe('none');
  });

  it('questions clés → bonnes réponses', () => {
    const cases: [string, (e: KbEntry) => boolean][] = [
      ['comment acheter une route commerciale', (e) => e.cat === 'routes' || e.id.startsWith('act-buy_corridor')],
      ["c'est quoi le solde budgétaire", (e) => e.title.toLowerCase().includes('solde budgétaire')],
      ['comment fixer un péage', (e) => e.title.toLowerCase().includes('péage')],
      ['pourquoi mon gouvernement est tombé', (e) => e.cat === 'politique' || e.title.toLowerCase().includes('mandat') || e.title.toLowerCase().includes('popularité')],
      ['que fait le canal de suez', (e) => e.title.toLowerCase().includes('suez')],
      ['comment booster ma production d énergie', (e) => e.cat === 'ressources' || e.title.toLowerCase().includes('production')],
      ['erreur trésorerie insuffisante que faire', (e) => e.cat === 'erreurs'],
      ['comment baisser mon inflation', (e) => e.title.toLowerCase().includes('inflation')],
      ['publier une offre de vente', (e) => e.cat === 'ressources' || e.title.toLowerCase().includes('offre')],
      ['acheter de l énergie à un autre pays', (e) => e.cat === 'ressources' || e.title.toLowerCase().includes('bilatéral') || e.title.toLowerCase().includes('énergie')],
      ['meilleure loi à voter', (e) => e.title.toLowerCase().includes('loi')],
      ['qui possède le détroit de malacca', (e) => e.title.toLowerCase().includes('malacca')],
    ];
    for (const [q, check] of cases) {
      const r = askAssistant(q, index);
      expect(r.best, `aucune réponse pour « ${q} »`).not.toBeNull();
      expect(r.confident, `pas confiant pour « ${q} »`).toBe(true);
      expect(check(r.best!.entry), `« ${q} » → « ${r.best!.entry.title} » (cat ${r.best!.entry.cat})`).toBe(true);
    }
  });

  it('tolérance aux fautes de frappe (fuzzy Levenshtein ≤ 1)', () => {
    const r = askAssistant('comment achetter une routte', index);
    expect(r.best).not.toBeNull();
    expect(r.best!.entry.cat === 'routes' || r.best!.entry.id.startsWith('act-buy_corridor')).toBe(true);
  });

  it('charabia et entrées vides : jamais de crash, jamais de fausse confiance', () => {
    for (const q of ['', '   ', 'xyzzy plugh 42', '?!?!', 'a', 'ùùù ùùù', '12345 67890']) {
      const r = askAssistant(q, index);
      if (r.best) expect(r.confident, `confiance injustifiée pour « ${q} »`).toBe(false);
    }
  });

  it('déterminisme : même question → même meilleure réponse', () => {
    const q = 'comment augmenter ma popularité';
    const r1 = askAssistant(q, index);
    const r2 = askAssistant(q, index);
    expect(r1.best?.entry.id).toBe(r2.best?.entry.id);
    expect(r1.best?.score).toBe(r2.best?.score);
  });

  it('performance : index < 2 s, requête < 80 ms', () => {
    const t0 = performance.now();
    buildIndex(kb);
    expect(performance.now() - t0).toBeLessThan(2000);
    const t1 = performance.now();
    for (let i = 0; i < 20; i++) askAssistant('comment acheter une route et fixer le péage ?', index);
    expect((performance.now() - t1) / 20).toBeLessThan(80);
  });
});
