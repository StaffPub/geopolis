/**
 * GEOPOLIS — Simulation : commerce international.
 * Appariement offre/demande mondial par ressource, pondéré par les relations
 * diplomatiques, les accords, les tarifs, les sanctions et les infrastructures.
 * Chaque échange déplace réellement des unités, de l'argent et des recettes douanières.
 */
import type { Country, ResourceKey, TradeTransaction } from 'shared';
import { RESOURCE_KEYS, RESOURCE_MAP } from 'shared';
import { clamp, round } from '../util/core.js';
import type { WorldStore } from '../world/world.js';
import { hasAgreement } from './model.js';
import { tradeValue } from './economy.js';
import { REGION_AFFINITY } from '../world/seed.js';

/* ------------------------------------------------------------------ */
/* Routes multi-étapes : TOUT transit passe par au moins un corridor    */
/* achetable et taxable — il n'existe AUCUNE voie directe. Graphe       */
/* régional des corridors, énumération de combinaisons, péages par      */
/* propriétaire, fret selon le nombre d'étapes.                         */
/* ------------------------------------------------------------------ */

export type { RouteOption } from 'shared';
import type { RouteOption } from 'shared';

/** Nombre maximal de corridors chaînés dans une combinaison énumérée. */
const MAX_HOPS = 4;
/** Nombre maximal de combinaisons proposées par paire de pays. */
const MAX_PATHS = 10;

function regionEdges(world: WorldStore): Map<string, { region: string; corridorId: string }[]> {
  const edges = new Map<string, { region: string; corridorId: string }[]>();
  const add = (a: string, b: string, id: string) => {
    if (!edges.has(a)) edges.set(a, []);
    const list = edges.get(a)!;
    if (!list.some((e) => e.corridorId === id)) list.push({ region: b, corridorId: id });
  };
  for (const co of world.corridors.values()) {
    add(co.regions[0], co.regions[1], co.id);
    add(co.regions[1], co.regions[0], co.id);
  }
  return edges;
}

/** Plus court chemin de corridors entre deux régions (filet de sécurité :
 *  garantit qu'aucun échange n'est bloqué, même hors portée du DFS). */
function bfsCorridorPath(
  edges: Map<string, { region: string; corridorId: string }[]>,
  start: string,
  goal: string,
  maxCorridors = 8,
): string[] | null {
  interface Node { region: string; path: string[] }
  const queue: Node[] = [{ region: start, path: [] }];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.region === goal && node.path.length > 0) return node.path;
    if (node.path.length >= maxCorridors) continue;
    if (node.region !== start && node.path.length > 0 && visited.has(node.region)) continue;
    if (node.region !== start) visited.add(node.region);
    for (const e of edges.get(node.region) ?? []) {
      if (node.path.includes(e.corridorId)) continue;
      if (e.region !== goal && visited.has(e.region)) continue;
      queue.push({ region: e.region, path: [...node.path, e.corridorId] });
    }
  }
  return null;
}

/**
 * Toutes les combinaisons de corridors (≤ MAX_HOPS) reliant les régions de
 * from et to. AUCUNE option sans corridor : chaque marchandise transite par
 * au moins une route commerciale achetable et taxable. Même région : voies
 * intérieures (cabotage) et allers-retours via une région voisine.
 */
export function routeOptions(world: WorldStore, from: Country, to: Country, cache?: RouteCache): RouteOption[] {
  const key = `${from.id}|${to.id}`;
  if (cache) {
    const hit = cache.get(key);
    if (hit) return hit;
  }
  const options = buildRouteOptions(world, from, to);
  if (cache) cache.set(key, options);
  return options;
}

export type RouteCache = Map<string, RouteOption[]>;

function buildRouteOptions(world: WorldStore, from: Country, to: Country): RouteOption[] {
  const edges = regionEdges(world);
  const start = from.region;
  const goal = to.region;
  const paths: string[][] = [];
  const seen = new Set<string>();
  const pushPath = (p: string[]): void => {
    if (p.length === 0) return;
    const key = p.join('+');
    if (seen.has(key)) return;
    seen.add(key);
    paths.push([...p]);
  };

  // DFS : combinaisons simples. Quand start === goal, le départ n'est pas
  // marqué visité → les allers-retours A→B→A (2 corridors) sont énumérés,
  // en plus des voies intérieures (corridors intra-régionaux).
  const dfs = (region: string, path: string[], visitedRegions: Set<string>): void => {
    if (paths.length >= MAX_PATHS) return;
    if (region === goal && path.length > 0) {
      pushPath(path);
      return;
    }
    if (path.length >= MAX_HOPS) return;
    for (const e of edges.get(region) ?? []) {
      if (visitedRegions.has(e.region) || path.includes(e.corridorId)) continue;
      visitedRegions.add(e.region);
      path.push(e.corridorId);
      dfs(e.region, path, visitedRegions);
      path.pop();
      visitedRegions.delete(e.region);
      if (paths.length >= MAX_PATHS) return;
    }
  };
  dfs(start, [], start === goal ? new Set<string>() : new Set<string>([start]));

  // Corridors reliant directement les deux pays (hubs) quelle que soit la région
  for (const co of world.corridors.values()) {
    if (co.hubs.includes(from.id) && co.hubs.includes(to.id)) pushPath([co.id]);
  }

  // Filet de sécurité : si aucune combinaison trouvée (graphe incomplètement
  // maillé), on prend le plus court chemin réel — jamais de voie directe.
  if (paths.length === 0) {
    const p = bfsCorridorPath(edges, start, goal);
    if (p) pushPath(p);
  }

  const options: RouteOption[] = [];
  for (const path of paths) {
    let toll = 0;
    let hops = 0;
    const names: string[] = [];
    for (const cid of path) {
      const co = world.corridor(cid);
      if (!co) continue;
      hops++;
      names.push(co.name);
      if (co.owner && co.owner !== from.id) toll += co.toll;
    }
    if (hops === 0) continue;
    const freight = 0.015 + 0.008 * hops; // fret logistique selon la distance
    const tollRate = round(toll, 2);
    const freightRate = round(freight * 100, 2);
    options.push({
      id: path.join('+'),
      label: names.join(' → '),
      corridors: path,
      tollRate,
      freightRate,
      costRate: round(tollRate + freightRate, 2),
    });
  }
  return options.sort((x, y) => x.costRate - y.costRate);
}

/** Route effectivement utilisée : préférence du président sinon moins chère.
 *  Retourne null uniquement si le monde n'a AUCUN corridor (impossible en
 *  pratique : le catalogue couvre toutes les régions). */
export function chooseRoute(world: WorldStore, from: Country, to: Country, cache?: RouteCache): RouteOption | null {
  const options = routeOptions(world, from, to, cache);
  const pref = from.routePrefs?.[to.id];
  if (pref && pref !== 'direct') {
    const found = options.find((o) => o.id === pref);
    if (found) return found;
  }
  return options[0] ?? null;
}

export interface CountryTradeTick {
  tariffRevenue: number;   // Md € / jour
  exportValue: number;     // Md € / jour
  importValue: number;     // Md € / jour
  netExportShare: number;  // (exp − imp) annualisé / PIB
}

export interface TradeTickResult {
  perCountry: Map<string, CountryTradeTick>;
  bigTransactions: TradeTransaction[];
  routeCount: number;
}

const AGREEMENT_VOLUME_MUL: Record<string, number> = {
  free_trade: 1.5,
  trade_zone: 1.35,
  economic_treaty: 1.15,
  aid_pact: 1.05,
  tech_cooperation: 1.05,
};

function distanceFactor(a: Country, b: Country): number {
  if (a.region === b.region) return 1.25;
  if ((REGION_AFFINITY[a.region] ?? []).includes(b.region)) return 1.05;
  return 0.8;
}

function agreementMul(a: Country, bId: string): number {
  const rel = a.relations[bId];
  if (!rel) return 1;
  let mul = 1;
  for (const ag of rel.agreements) {
    if (ag.status === 'active') mul *= AGREEMENT_VOLUME_MUL[ag.type] ?? 1;
  }
  return Math.min(2.2, mul);
}

function effectiveTariff(importer: Country, exporterId: string): number {
  const base = importer.tariffOverrides[exporterId] ?? importer.policy.tariff;
  let discount = 0;
  if (hasAgreement(importer, exporterId, 'free_trade')) discount = 0.6;
  else if (hasAgreement(importer, exporterId, 'trade_zone')) discount = 0.4;
  else if (hasAgreement(importer, exporterId, 'economic_treaty')) discount = 0.2;
  return clamp(base * (1 - discount), 0, 60);
}

function stockRatioOf(c: Country, key: ResourceKey): number {
  const r = c.resources[key];
  return r.capacity > 0 ? clamp(r.stock / r.capacity, 0, 1) : 0;
}

export function processTrade(world: WorldStore, rng: () => number): TradeTickResult {
  const day = world.meta.day;
  const countries = world.allCountries();
  const perCountry = new Map<string, CountryTradeTick>();
  for (const c of countries) {
    perCountry.set(c.id, { tariffRevenue: 0, exportValue: 0, importValue: 0, netExportShare: 0 });
  }
  const bigTransactions: TradeTransaction[] = [];
  const touchedRoutes = new Set<string>();
  // Cache des combinaisons de routes : les mêmes paires reviennent pour chaque
  // ressource, le DFS n'est donc joué qu'une fois par paire et par tick.
  const routeCache: RouteCache = new Map();

  for (const key of RESOURCE_KEYS) {
    // Offres : surplus + stocks confortables
    const offers: { c: Country; amount: number }[] = [];
    const needs: { c: Country; amount: number }[] = [];
    for (const c of countries) {
      const r = c.resources[key];
      const ratio = stockRatioOf(c, key);
      const surplus = r.production - r.consumption;
      if (surplus > 0.05 && ratio > 0.32) {
        offers.push({ c, amount: Math.min(surplus * (ratio > 0.55 ? 0.6 : 0.3), r.stock * 0.2) });
      }
      const deficit = r.consumption - r.production;
      const room = Math.max(0, r.capacity - r.stock);
      const need = Math.max(deficit, 0) * 1.15 + Math.max(0, 0.45 - ratio) * r.capacity * 0.04;
      if (need > 0.05 && room > 0.1) {
        needs.push({ c, amount: Math.min(need, room * 0.25, r.consumption * 0.8) });
      }
    }
    if (offers.length === 0 || needs.length === 0) continue;
    needs.sort((a, b) => b.amount - a.amount);

    for (const imp of needs) {
      if (imp.amount <= 0.02) continue;
      const iC = imp.c;
      // Classement des exportateurs : relations + accords + proximité
      const ranked = offers
        .filter((o) => o.c.id !== iC.id && o.amount > 0.02)
        .map((o) => {
          const rel = o.c.relations[iC.id];
          const score = rel ? rel.score : 50;
          return { o, affinity: score * (1 + agreementMul(iC, o.c.id) - 1) * distanceFactor(o.c, iC) + rng() * 4 };
        })
        .sort((a, b) => b.affinity - a.affinity);

      for (const { o } of ranked) {
        if (imp.amount <= 0.02 || o.amount <= 0.02) continue;
        const eC = o.c;
        const rel = iC.relations[eC.id];
        const erel = eC.relations[iC.id];
        if (!rel || !erel) continue;
        if (rel.sanctionByUs || rel.sanctionByThem || erel.sanctionByUs || erel.sanctionByThem) continue;
        const hasDeal = rel.agreements.some((a) => a.status === 'active');
        if (rel.score < 30 && !hasDeal) continue;

        // v19 : aéroports = bonus logistique MODÉRÉ (0.1/niveau) + plafond doux :
        // sans cela, les aéroports seedés gonflaient tous les flux → pénuries
        // mondialisées et prix plafond en ~40 jours (régression v16).
        const infraCap = Math.min(5.5,
          1.5 +
          (iC.infra.ports?.level ?? 0) * 0.35 + (iC.infra.logistics?.level ?? 0) * 0.22 + (iC.infra.airports?.level ?? 0) * 0.1 +
          (eC.infra.ports?.level ?? 0) * 0.35 + (eC.infra.logistics?.level ?? 0) * 0.22 + (eC.infra.airports?.level ?? 0) * 0.1);
        const tariff = effectiveTariff(iC, eC.id);
        const tariffFactor = 1 - Math.min(0.55, tariff * 0.012);
        const cap = infraCap * agreementMul(iC, eC.id) * distanceFactor(eC, iC) * tariffFactor *
          (0.5 + Math.sqrt(iC.population * eC.population) / 60);

        const volume = round(Math.min(imp.amount, o.amount, cap), 2);
        if (volume < 0.02) continue;

        const price = (eC.resources[key].price + iC.resources[key].price) / 2;
        const value = tradeValue(volume, price);
        const tariffRevenue = round(value * (tariff / 100), 3);

        // Route multi-étapes : TOUT transit passe par au moins un corridor
        // achetable. Péages versés en direct à la trésorerie des propriétaires,
        // trafic cumulé sur chaque route traversée (libre ou possédée).
        const route = chooseRoute(world, eC, iC, routeCache);
        if (!route || route.corridors.length === 0) continue; // aucune route : échange impossible
        // Garde-fou économique : au-delà de 55 % de la valeur perdue en transit
        // (péages cumulés + fret), plus personne n'expédie — le flux s'arrête et
        // les propriétaires gourmands voient leur trafic s'effondrer.
        if (route.costRate > 55) continue;
        let tolls = 0;
        for (const cid of route.corridors) {
          const co = world.corridor(cid);
          if (!co) continue;
          co.traffic = round(co.traffic + value, 2);
          if (!co.owner || co.owner === eC.id) continue;
          const owner = world.country(co.owner);
          const share = round((value * co.toll) / 100, 3);
          if (owner && share > 0) {
            owner.economy.cash = round(owner.economy.cash + share, 3); // → trésorerie du propriétaire
            world.markDirty(co.owner);
          }
          tolls += share;
        }
        world.markCorridorsDirty();
        const freight = round((value * route.freightRate) / 100, 3);

        // Transferts réels
        eC.resources[key].stock = round(Math.max(0, eC.resources[key].stock - volume), 2);
        iC.resources[key].stock = round(Math.min(iC.resources[key].capacity, iC.resources[key].stock + volume), 2);
        eC.economy.cash = round(eC.economy.cash + value - tolls - freight, 3);
        iC.economy.cash = round(Math.max(0, iC.economy.cash - value - tariffRevenue), 3);

        const ti = perCountry.get(iC.id)!;
        const te = perCountry.get(eC.id)!;
        ti.importValue += value;
        ti.tariffRevenue += tariffRevenue;
        te.exportValue += value;

        rel.tradeVolume = round(rel.tradeVolume * 0.85 + value, 3);
        erel.tradeVolume = round(erel.tradeVolume * 0.85 + value, 3);
        rel.score = clamp(rel.score + 0.012 * (hasDeal ? 2 : 1), 0, 100);
        erel.score = clamp(erel.score + 0.012 * (hasDeal ? 2 : 1), 0, 100);
        rel.lastContactDay = day;
        erel.lastContactDay = day;

        o.amount -= volume;
        imp.amount -= volume;

        // Route commerciale (pour la carte & la page commerce)
        const routeId = `${eC.id}->${iC.id}:${key}`;
        if (value >= 0.008) {
          touchedRoutes.add(routeId);
          const existing = world.routes.get(routeId);
          world.upsertRoute({
            id: routeId,
            fromId: eC.id,
            toId: iC.id,
            resource: key,
            volume: existing ? round((existing.volume * 0.6 + volume * 0.4), 2) : volume,
            value: existing ? round(existing.value * 0.6 + value * 0.4, 4) : round(value, 4),
            updatedDay: day,
            corridors: route.corridors,
          });
        }

        // Registre des échanges : uniquement les transactions significatives
        if (value >= 0.05 && bigTransactions.length < 10) {
          bigTransactions.push({
            id: `trx_${day}_${eC.id}_${iC.id}_${key}`,
            day,
            ts: Date.now(),
            fromId: eC.id,
            toId: iC.id,
            resource: key,
            units: volume,
            value,
            kind: 'export',
            note: `${RESOURCE_MAP[key].name} — échange commercial`,
          });
        }
      }
    }
  }

  // Nettoyage des routes obsolètes (plus échangées depuis 3 jours)
  for (const [id, route] of world.routes) {
    if (!touchedRoutes.has(id) && day - route.updatedDay > 3) world.removeRoute(id);
  }

  // Soldes commerciaux annualisés → effet croissance
  for (const c of countries) {
    const t = perCountry.get(c.id)!;
    t.netExportShare = clamp(((t.exportValue - t.importValue) * 365) / Math.max(1, c.economy.gdp), -0.02, 0.02);
    t.tariffRevenue = round(t.tariffRevenue, 3);
    t.exportValue = round(t.exportValue, 3);
    t.importValue = round(t.importValue, 3);
    world.markDirty(c.id);
  }

  return { perCountry, bigTransactions, routeCount: world.routes.size };
}
