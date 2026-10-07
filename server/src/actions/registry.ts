/**
 * GEOPOLIS — Registre des actions métier.
 * Cycle imposé : validate() → estimate() → apply() → (l'appelant) persist() → emit() → log().
 * Les joueurs humains, les IA et les admins passent EXACTEMENT par la même couche :
 * aucune logique critique n'existe côté client.
 */
import type {
  ActionEstimate,
  ActionParams,
  ActionResult,
  AgreementType,
  Country,
  GameNotification,
  InfraKey,
  ResourceKey,
  SpendingKey,
  TradeCorridor,
} from 'shared';
import { BIG_WIN_THRESHOLD, DELIVERY_RESPONSE_DAYS, FACILITY_MAP, INFRA_MAP, LAW_MAP, MAX_OPEN_DELIVERIES_PER_SENDER, REGIME_MAP, REGIME_CHANGE_COOLDOWN_DAYS, REGIME_HONEYMOON_DAYS, SPENDING_SECTORS, RESOURCE_MAP, facilityScale, regimeAlignment } from 'shared';
import { createLogger } from '../logger.js';
import { spawnDiplomaticEvent } from '../simulation/events.js';
import { chooseRoute, routeOptions } from '../simulation/trade.js';
import { PRODUCTION_BOOST_MUL, PRODUCTION_SLOW_MUL, refreshProductionRates } from '../simulation/production.js';
import { uid, clamp, round } from '../util/core.js';
import type { WorldStore } from '../world/world.js';

const log = createLogger('ACTIONS');

/** Valeur monétaire d'une unité de ressource échangée (Md €). Calibrage du moteur. */
export const VALUE_SCALE = 0.000045;

export interface ActionActor {
  kind: 'player' | 'ai' | 'admin';
  name: string;
  userId?: string | null;
}

export interface ActionContext {
  world: WorldStore;
  actor: ActionActor;
  notify?: (userId: string, n: Omit<GameNotification, 'userId' | 'id' | 'ts' | 'read'>) => void | Promise<void>;
  /** Signale un gain commercial unique important (célébration joueur). */
  onBigWin?: (bw: { countryId: string; amount: number; source: string }) => void;
}

export interface ActionDef<P extends ActionParams = ActionParams> {
  type: P['type'];
  label: string;
  category: 'fiscalité' | 'budget' | 'infrastructure' | 'législation' | 'diplomatie' | 'commerce' | 'monétaire' | 'politique';
  cooldownDays: number;
  validate(world: WorldStore, c: Country, params: P, ctx: ActionContext): string | null;
  estimate(world: WorldStore, c: Country, params: P): ActionEstimate[];
  apply(world: WorldStore, c: Country, params: P, ctx: ActionContext): ActionResult;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function cooldownKey(params: ActionParams): string {
  const target =
    'targetId' in params ? `:${params.targetId}` :
    'facility' in params ? `:${params.facility}` :
    'infra' in params ? `:${params.infra}` :
    'sector' in params ? `:${params.sector}` :
    'lawId' in params ? `:${params.lawId}` :
    'resource' in params ? `:${params.resource}` :
    'proposalId' in params ? `:${params.proposalId}` : '';
  return `${params.type}${target}`;
}

function checkCooldown(c: Country, params: ActionParams, day: number): string | null {
  const key = cooldownKey(params);
  const until = c.actionCooldowns[key];
  if (until !== undefined && until > day) {
    return `Action en cooldown : disponible au jour ${until} (actuellement jour ${day})`;
  }
  return null;
}

function setCooldown(c: Country, params: ActionParams, day: number, days: number): void {
  if (days > 0) c.actionCooldowns[cooldownKey(params)] = day + days;
}

function eff(positive: boolean, label: string, value: string): ActionEstimate {
  return { positive, label, value };
}

export function infraCost(c: Country, key: InfraKey): number {
  const def = INFRA_MAP[key];
  const level = c.infra[key]?.level ?? 0;
  return round(def.baseCost * (0.45 + c.economy.gdp / 6000) * (1 + level * 0.35), 2);
}

export function lawAnnualCost(c: Country, lawId: string): number {
  const def = LAW_MAP[lawId];
  if (!def) return 0;
  return round((c.economy.gdp * def.annualCostPctGdp) / 100, 2);
}

export function findProposal(world: WorldStore, c: Country, proposalId: string): { otherId: string; type: AgreementType } | null {
  for (const [otherId, rel] of Object.entries(c.relations)) {
    const ag = rel.agreements.find((a) => a.id === proposalId && a.status === 'proposed' && a.toId === c.id);
    if (ag) return { otherId, type: ag.type };
  }
  void world;
  return null;
}

/* ------------------------------------------------------------------ */
/* Définitions des actions                                             */
/* ------------------------------------------------------------------ */

type P<T extends ActionParams['type']> = Extract<ActionParams, { type: T }>;

const setTax: ActionDef<P<'set_tax'>> = {
  type: 'set_tax',
  label: 'Modifier la fiscalité générale',
  category: 'fiscalité',
  cooldownDays: 3,
  validate: (_w, _c, p) => {
    if (!Number.isFinite(p.value) || p.value < 0 || p.value > 60) return 'Taux invalide (0 à 60 %)';
    return null;
  },
  estimate: (w, c, p) => {
    const delta = p.value - c.policy.taxRate;
    const revenue = (c.economy.gdp * delta * 0.55) / 100;
    const pop = -delta * 0.42;
    const cons = -delta * 0.55;
    void w;
    return [
      eff(revenue >= 0, 'Recettes fiscales annuelles', `${revenue >= 0 ? '+' : ''}${revenue.toFixed(1)} Md €`),
      eff(pop >= 0, 'Popularité (immédiat)', `${pop >= 0 ? '+' : ''}${pop.toFixed(1)} %`),
      eff(cons >= 0, 'Consommation', `${cons >= 0 ? '+' : ''}${cons.toFixed(1)} %`),
      eff(delta <= 0, 'Croissance à court terme', `${delta > 0 ? '-' : '+'}${Math.abs(delta * 0.05).toFixed(2)} %`),
    ];
  },
  apply: (w, c, p, ctx) => {
    const delta = p.value - c.policy.taxRate;
    c.policy.taxRate = round(clamp(p.value, 0, 60), 1);
    c.economy.revenue = round(c.economy.revenue + (c.economy.gdp * delta * 0.55) / 100, 2);
    c.economy.balance = round(c.economy.revenue - c.economy.spending, 2);
    c.popularity = clamp(c.popularity - delta * 0.42, 0, 100);
    c.economy.consumptionIndex = clamp(c.economy.consumptionIndex - delta * 0.55, 20, 200);
    w.addJournal({
      day: w.meta.day, type: 'politics', countryIds: [c.id], actor: ctx.actor.name,
      text: `${c.name} ${delta > 0 ? 'augmente' : 'réduit'} sa fiscalité de ${Math.abs(delta).toFixed(1)} point(s) à ${c.policy.taxRate} %.`,
    });
    return { ok: true, message: `Fiscalité fixée à ${c.policy.taxRate} %` };
  },
};

const setCorporateTax: ActionDef<P<'set_corporate_tax'>> = {
  type: 'set_corporate_tax',
  label: 'Modifier l’impôt sur les sociétés',
  category: 'fiscalité',
  cooldownDays: 3,
  validate: (_w, _c, p) => (Number.isFinite(p.value) && p.value >= 0 && p.value <= 60 ? null : 'Taux invalide (0 à 60 %)'),
  estimate: (_w, c, p) => {
    const delta = p.value - c.policy.corporateTax;
    const revenue = (c.economy.gdp * delta * 0.25) / 100;
    return [
      eff(revenue >= 0, 'Recettes annuelles', `${revenue >= 0 ? '+' : ''}${revenue.toFixed(1)} Md €`),
      eff(delta <= 0, 'Investissement privé', `${delta <= 0 ? '+' : '-'}${Math.abs(delta * 0.4).toFixed(1)} %`),
      eff(delta <= 0, 'Popularité entreprises', `${delta <= 0 ? '+' : '-'}${Math.abs(delta * 0.1).toFixed(1)} %`),
    ];
  },
  apply: (w, c, p, ctx) => {
    const delta = p.value - c.policy.corporateTax;
    c.policy.corporateTax = round(clamp(p.value, 0, 60), 1);
    c.economy.revenue = round(c.economy.revenue + (c.economy.gdp * delta * 0.25) / 100, 2);
    c.economy.balance = round(c.economy.revenue - c.economy.spending, 2);
    c.economy.investment = round(c.economy.investment * (1 - delta * 0.004), 1);
    w.addJournal({
      day: w.meta.day, type: 'politics', countryIds: [c.id], actor: ctx.actor.name,
      text: `${c.name} fixe l’impôt sur les sociétés à ${c.policy.corporateTax} %.`,
    });
    return { ok: true, message: `Impôt sur les sociétés : ${c.policy.corporateTax} %` };
  },
};

const setTariff: ActionDef<P<'set_tariff'>> = {
  type: 'set_tariff',
  label: 'Modifier les tarifs douaniers',
  category: 'commerce',
  cooldownDays: 2,
  validate: (_w, c, p) => {
    if (!Number.isFinite(p.value) || p.value < 0 || p.value > 60) return 'Tarif invalide (0 à 60 %)';
    if (p.partnerId && !c.relations[p.partnerId]) return 'Partenaire inconnu';
    return null;
  },
  estimate: (_w, c, p) => {
    const current = p.partnerId ? (c.tariffOverrides[p.partnerId] ?? c.policy.tariff) : c.policy.tariff;
    const delta = p.value - current;
    return [
      eff(delta >= 0, 'Recettes douanières', delta >= 0 ? 'hausse probable' : 'baisse probable'),
      eff(delta <= 0, 'Volumes importés', `${delta <= 0 ? '+' : '-'}${Math.min(40, Math.abs(delta) * 1.8).toFixed(0)} %`),
      eff(delta <= 0, 'Prix intérieurs', `${delta >= 0 ? '+' : '-'}${Math.min(12, Math.abs(delta) * 0.25).toFixed(1)} %`),
      p.partnerId ? eff(delta <= 0, `Relations avec le partenaire`, delta > 0 ? 'dégradation possible' : 'stable') : eff(true, 'Portée', 'tous les partenaires'),
    ];
  },
  apply: (w, c, p, ctx) => {
    const value = round(clamp(p.value, 0, 60), 1);
    if (p.partnerId) {
      c.tariffOverrides[p.partnerId] = value;
      const other = w.country(p.partnerId);
      const rel = c.relations[p.partnerId];
      if (rel && value > c.policy.tariff + 5) {
        rel.score = clamp(rel.score - 2, 0, 100);
        if (other) {
          const orel = other.relations[c.id];
          if (orel) orel.score = clamp(orel.score - 2, 0, 100);
          w.markDirty(other.id);
        }
      }
    } else {
      c.policy.tariff = value;
    }
    w.addJournal({
      day: w.meta.day, type: 'trade', countryIds: p.partnerId ? [c.id, p.partnerId] : [c.id], actor: ctx.actor.name,
      text: `${c.name} fixe ${p.partnerId ? `son tarif envers ${w.country(p.partnerId)?.name ?? p.partnerId}` : 'son tarif douanier général'} à ${value} %.`,
    });
    return { ok: true, message: `Tarif douanier : ${value} %` };
  },
};

const setInterestRate: ActionDef<P<'set_interest_rate'>> = {
  type: 'set_interest_rate',
  label: 'Politique monétaire — taux directeur',
  category: 'monétaire',
  cooldownDays: 4,
  validate: (_w, _c, p) => (Number.isFinite(p.value) && p.value >= 0 && p.value <= 25 ? null : 'Taux invalide (0 à 25 %)'),
  estimate: (_w, c, p) => {
    const delta = p.value - c.policy.interestRate;
    return [
      eff(delta <= 0, 'Inflation', `${delta <= 0 ? '+' : '-'}${Math.abs(delta * 0.25).toFixed(2)} pt à terme`),
      eff(delta <= 0, 'Croissance', `${delta <= 0 ? '+' : '-'}${Math.abs(delta * 0.18).toFixed(2)} pt à terme`),
      eff(delta >= 0, 'Coût de la dette', delta >= 0 ? 'hausse' : 'baisse'),
      eff(true, 'Taux actuel', `${c.policy.interestRate.toFixed(1)} % → ${p.value.toFixed(1)} %`),
    ];
  },
  apply: (w, c, p, ctx) => {
    c.policy.interestRate = round(clamp(p.value, 0, 25), 2);
    w.addJournal({
      day: w.meta.day, type: 'economy', countryIds: [c.id], actor: ctx.actor.name,
      text: `La banque centrale de ${c.name} fixe le taux directeur à ${c.policy.interestRate} %.`,
    });
    return { ok: true, message: `Taux directeur : ${c.policy.interestRate} %` };
  },
};

const setSpending: ActionDef<P<'set_spending'>> = {
  type: 'set_spending',
  label: 'Ajuster une ligne budgétaire',
  category: 'budget',
  cooldownDays: 2,
  validate: (_w, _c, p) => {
    const def = SPENDING_SECTORS.find((s) => s.key === p.sector);
    if (!def) return 'Secteur budgétaire inconnu';
    if (!Number.isFinite(p.value) || p.value < def.min || p.value > def.max) {
      return `Valeur invalide pour ${def.name} (${def.min} à ${def.max} % du PIB)`;
    }
    return null;
  },
  estimate: (_w, c, p) => {
    const delta = p.value - c.policy.spending[p.sector];
    const cost = (c.economy.gdp * delta) / 100;
    const def = SPENDING_SECTORS.find((s) => s.key === p.sector)!;
    return [
      eff(cost <= 0, `Dépense « ${def.name} » annuelle`, `${cost >= 0 ? '+' : ''}${cost.toFixed(1)} Md €`),
      eff(delta >= 0, 'Popularité / services', delta >= 0 ? `+${Math.min(3, delta * 0.5).toFixed(1)} % progressif` : `-${Math.min(3, -delta * 0.6).toFixed(1)} % progressif`),
      eff(delta <= 0, 'Solde budgétaire', `${-cost >= 0 ? '+' : ''}${(-cost).toFixed(1)} Md €`),
    ];
  },
  apply: (w, c, p, ctx) => {
    const sector = p.sector as SpendingKey;
    const old = c.policy.spending[sector];
    c.policy.spending[sector] = round(p.value, 2);
    const deltaGdp = (c.economy.gdp * (p.value - old)) / 100;
    c.economy.spending = round(c.economy.spending + deltaGdp, 2);
    c.economy.balance = round(c.economy.revenue - c.economy.spending, 2);
    const def = SPENDING_SECTORS.find((s) => s.key === sector)!;
    w.addJournal({
      day: w.meta.day, type: 'politics', countryIds: [c.id], actor: ctx.actor.name,
      text: `${c.name} ${p.value >= old ? 'augmente' : 'réduit'} le budget « ${def.name} » : ${old.toFixed(1)} % → ${p.value.toFixed(1)} % du PIB.`,
    });
    return { ok: true, message: `Budget ${def.name} : ${p.value.toFixed(1)} % du PIB` };
  },
};

const startProject: ActionDef<P<'start_project'>> = {
  type: 'start_project',
  label: 'Lancer un chantier d’infrastructure',
  category: 'infrastructure',
  cooldownDays: 1,
  validate: (w, c, p) => {
    const def = INFRA_MAP[p.infra];
    if (!def) return 'Infrastructure inconnue';
    if ((c.infra[p.infra]?.level ?? 0) >= def.maxLevel) return `${def.name} est déjà au niveau maximum`;
    if (c.projects.some((pr) => pr.infra === p.infra)) return `Un chantier ${def.name} est déjà en cours`;
    if (c.projects.length >= 6) return 'Trop de chantiers simultanés (max 6)';
    const cost = infraCost(c, p.infra);
    const upfront = cost * 0.15;
    if (c.economy.cash < upfront) return `Trésorerie insuffisante : apport initial de ${upfront.toFixed(1)} Md € requis`;
    void w;
    return null;
  },
  estimate: (_w, c, p) => {
    const def = INFRA_MAP[p.infra];
    const cost = infraCost(c, p.infra);
    const level = (c.infra[p.infra]?.level ?? 0) + 1;
    return [
      eff(false, 'Coût total', `${cost.toFixed(1)} Md € (apport initial ${(cost * 0.15).toFixed(1)} Md €)`),
      eff(false, 'Durée', `${def.buildDays} jours de jeu`),
      eff(true, `Niveau ${def.name}`, `${level - 1} → ${level}`),
      eff(true, 'Effet', def.effect),
      eff(false, 'Entretien annuel', `+${(def.upkeepPerLevel * (0.5 + c.economy.gdp / 6000)).toFixed(2)} Md €/an`),
    ];
  },
  apply: (w, c, p, ctx) => {
    const def = INFRA_MAP[p.infra];
    const cost = infraCost(c, p.infra);
    const upfront = round(cost * 0.15, 2);
    c.economy.cash = round(c.economy.cash - upfront, 2);
    c.projects.push({
      id: uid('prj'),
      infra: p.infra,
      targetLevel: (c.infra[p.infra]?.level ?? 0) + 1,
      startedDay: w.meta.day,
      buildDays: def.buildDays,
      progress: upfront / cost,
      cost,
      invested: upfront,
    });
    w.addJournal({
      day: w.meta.day, type: 'infrastructure', countryIds: [c.id], actor: ctx.actor.name,
      text: `${c.name} lance la construction : ${def.name} (niveau ${c.infra[p.infra]?.level ?? 0} → ${(c.infra[p.infra]?.level ?? 0) + 1}) pour ${cost.toFixed(1)} Md €.`,
    });
    return {
      ok: true,
      message: `✓ Chantier « ${def.name} » lancé`,
      effects: [
        eff(false, 'Trésorerie', `-${upfront.toFixed(1)} Md €`),
        eff(true, 'Progression', `${def.buildDays} jours`),
        eff(true, 'À terme', def.effect),
      ],
    };
  },
};

const cancelProject: ActionDef<P<'cancel_project'>> = {
  type: 'cancel_project',
  label: 'Annuler un chantier',
  category: 'infrastructure',
  cooldownDays: 0,
  validate: (_w, c, p) => (c.projects.some((pr) => pr.id === p.projectId) ? null : 'Chantier introuvable'),
  estimate: (_w, c, p) => {
    const pr = c.projects.find((x) => x.id === p.projectId);
    const refund = pr ? round((pr.cost - pr.invested) * 0.0, 1) : 0;
    return [eff(true, 'Remboursement', `${refund.toFixed(1)} Md € (engagement annulé)`), eff(false, 'Chantier', pr ? INFRA_MAP[pr.infra].name : '—')];
  },
  apply: (w, c, p, ctx) => {
    const idx = c.projects.findIndex((pr) => pr.id === p.projectId);
    if (idx < 0) return { ok: false, error: 'Chantier introuvable' };
    const [pr] = c.projects.splice(idx, 1);
    w.addJournal({
      day: w.meta.day, type: 'infrastructure', countryIds: [c.id], actor: ctx.actor.name,
      text: `${c.name} annule le chantier ${INFRA_MAP[pr!.infra].name}.`,
    });
    return { ok: true, message: 'Chantier annulé' };
  },
};

const enactLaw: ActionDef<P<'enact_law'>> = {
  type: 'enact_law',
  label: 'Promulguer une loi',
  category: 'législation',
  cooldownDays: 4,
  validate: (_w, c, p) => {
    const def = LAW_MAP[p.lawId];
    if (!def) return 'Loi inconnue';
    if (c.laws.some((l) => l.lawId === p.lawId)) return 'Cette loi est déjà en vigueur';
    if (def.minPopularity !== undefined && c.popularity < def.minPopularity) return `Popularité insuffisante (${def.minPopularity} % requis)`;
    if (c.laws.length >= 6) return 'Maximum de 6 lois simultanées atteint';
    return null;
  },
  estimate: (_w, c, p) => {
    const def = LAW_MAP[p.lawId]!;
    const cost = lawAnnualCost(c, p.lawId);
    return [
      eff(cost <= 0, 'Coût annuel', cost > 0 ? `${cost.toFixed(1)} Md €` : 'gratuit'),
      ...def.effects.slice(0, 3).map((e) => eff(true, 'Effet', e)),
    ];
  },
  apply: (w, c, p, ctx) => {
    const def = LAW_MAP[p.lawId]!;
    const cost = lawAnnualCost(c, p.lawId);
    c.laws.push({ id: uid('law'), lawId: p.lawId, enactedDay: w.meta.day });
    c.economy.spending = round(c.economy.spending + cost, 2);
    c.economy.balance = round(c.economy.revenue - c.economy.spending, 2);
    if (def.modifiers.popularity) c.popularity = clamp(c.popularity + def.modifiers.popularity * 6, 0, 100);
    w.addJournal({
      day: w.meta.day, type: 'politics', countryIds: [c.id], actor: ctx.actor.name,
      text: `${c.name} promulgue la loi « ${def.name} »${cost > 0 ? ` (${cost.toFixed(1)} Md €/an)` : ''}.`,
    });
    return { ok: true, message: `✓ Loi « ${def.name} » promulguée` };
  },
};

const repealLaw: ActionDef<P<'repeal_law'>> = {
  type: 'repeal_law',
  label: 'Abroger une loi',
  category: 'législation',
  cooldownDays: 6,
  validate: (_w, c, p) => (c.laws.some((l) => l.lawId === p.lawId) ? null : 'Cette loi n’est pas en vigueur'),
  estimate: (_w, c, p) => {
    const def = LAW_MAP[p.lawId];
    const cost = lawAnnualCost(c, p.lawId);
    return [
      eff(cost >= 0, 'Économie annuelle', `${cost.toFixed(1)} Md €`),
      eff(false, 'Perte des effets', def ? def.effects[0] ?? '—' : '—'),
      eff(false, 'Popularité', '-1 à -2 % (réforme annulée)'),
    ];
  },
  apply: (w, c, p, ctx) => {
    const idx = c.laws.findIndex((l) => l.lawId === p.lawId);
    if (idx < 0) return { ok: false, error: 'Loi introuvable' };
    const cost = lawAnnualCost(c, p.lawId);
    c.laws.splice(idx, 1);
    c.economy.spending = round(Math.max(0, c.economy.spending - cost), 2);
    c.economy.balance = round(c.economy.revenue - c.economy.spending, 2);
    c.popularity = clamp(c.popularity - 1.5, 0, 100);
    const def = LAW_MAP[p.lawId];
    w.addJournal({
      day: w.meta.day, type: 'politics', countryIds: [c.id], actor: ctx.actor.name,
      text: `${c.name} abroge la loi « ${def?.name ?? p.lawId} ».`,
    });
    return { ok: true, message: `Loi « ${def?.name ?? p.lawId} » abrogée` };
  },
};

const MIN_RELATION_FOR_AGREEMENT: Record<AgreementType, number> = {
  free_trade: 42,
  economic_treaty: 48,
  tech_cooperation: 52,
  trade_zone: 45,
  aid_pact: 38,
};

const proposeAgreement: ActionDef<P<'propose_agreement'>> = {
  type: 'propose_agreement',
  label: 'Proposer un accord diplomatique',
  category: 'diplomatie',
  cooldownDays: 3,
  validate: (w, c, p) => {
    if (p.targetId === c.id) return 'Impossible de proposer un accord à soi-même';
    const target = w.country(p.targetId);
    const rel = c.relations[p.targetId];
    if (!target || !rel) return 'Pays cible inconnu';
    if (rel.sanctionByUs || rel.sanctionByThem) return 'Une mesure économique bloque toute proposition : levez-la d’abord';
    if (rel.agreements.some((a) => a.type === p.agreementType && (a.status === 'proposed' || a.status === 'active'))) {
      return 'Un accord de ce type est déjà proposé ou actif avec ce pays';
    }
    const min = MIN_RELATION_FOR_AGREEMENT[p.agreementType];
    if (rel.score < min) return `Relations insuffisantes (${rel.score.toFixed(0)}/${min} requis) — améliorez-les d'abord`;
    return null;
  },
  estimate: (_w, c, p) => {
    const rel = c.relations[p.targetId]!;
    return [
      eff(true, 'Si accepté', `+relations (≈ +${(4 + rel.trust / 25).toFixed(0)}) et nouveaux flux économiques`),
      eff(rel.trust > 55, 'Probabilité d’acceptation', rel.trust > 70 ? 'forte' : rel.trust > 50 ? 'moyenne' : 'faible'),
      eff(false, 'Coût', 'aucun coût direct (initiative diplomatique)'),
    ];
  },
  apply: (w, c, p, ctx) => {
    const target = w.country(p.targetId)!;
    const rel = c.relations[p.targetId]!;
    const trel = target.relations[c.id]!;
    const ag = {
      id: uid('ag'),
      type: p.agreementType,
      status: 'proposed' as const,
      fromId: c.id,
      toId: target.id,
      createdDay: w.meta.day,
      expiresDay: null,
    };
    rel.agreements.push(ag);
    trel.agreements.push({ ...ag });
    rel.lastContactDay = w.meta.day;
    trel.lastContactDay = w.meta.day;
    w.markDirty(target.id);
    // Notification au joueur humain qui contrôle la cible, le cas échéant
    if (target.controller.kind === 'player' && target.controller.userId && ctx.notify) {
      void ctx.notify(target.controller.userId, {
        type: 'diplomacy',
        title: 'Nouvelle proposition diplomatique',
        body: `${c.name} propose : ${agreementLabel(p.agreementType)}.`,
        day: w.meta.day,
        action: { kind: 'respond_proposal', proposalId: ag.id, countryId: c.id, fromCountry: c.name, agreementType: p.agreementType },
      });
    }
    w.addJournal({
      day: w.meta.day, type: 'diplomacy', countryIds: [c.id, target.id], actor: ctx.actor.name,
      text: `${c.name} propose ${agreementLabel(p.agreementType).toLowerCase()} à ${target.name}.`,
    });
    return { ok: true, message: `Proposition envoyée à ${target.name}` };
  },
};

export function agreementLabel(type: AgreementType): string {
  switch (type) {
    case 'free_trade': return 'Accord de libre-échange';
    case 'economic_treaty': return 'Traité économique';
    case 'tech_cooperation': return 'Coopération technologique';
    case 'trade_zone': return 'Zone commerciale';
    case 'aid_pact': return 'Pacte d’aide';
  }
}

const respondProposal: ActionDef<P<'respond_proposal'>> = {
  type: 'respond_proposal',
  label: 'Répondre à une proposition',
  category: 'diplomatie',
  cooldownDays: 0,
  validate: (w, c, p) => {
    const found = findProposal(w, c, p.proposalId);
    if (!found) return 'Proposition introuvable ou déjà traitée';
    return null;
  },
  estimate: (w, c, p) => {
    const found = findProposal(w, c, p.proposalId);
    return [
      eff(p.accept, 'Si acceptation', found ? `${agreementLabel(found.type)} actif immédiatement` : '—'),
      eff(!p.accept, 'Si refus', '-4 relations avec l’initiateur'),
    ];
  },
  apply: (w, c, p, ctx) => {
    let otherId: string | null = null;
    for (const [oid, rel] of Object.entries(c.relations)) {
      const ag = rel.agreements.find((a) => a.id === p.proposalId && a.status === 'proposed' && a.toId === c.id);
      if (ag) {
        ag.status = p.accept ? 'active' : 'rejected';
        otherId = oid;
        break;
      }
    }
    if (!otherId) return { ok: false, error: 'Proposition introuvable ou déjà traitée' };
    const other = w.country(otherId)!;
    const orel = other.relations[c.id]!;
    const rel = c.relations[otherId]!;
    const oag = orel.agreements.find((a) => a.id === p.proposalId);
    if (oag) oag.status = p.accept ? 'active' : 'rejected';
    const agType = oag?.type ?? rel.agreements.find((a) => a.id === p.proposalId)?.type ?? 'economic_treaty';
    if (p.accept) {
      // L'opinion désapprouve un accord avec un partenaire impopulaire/instable
      const partnerRep = (other.popularity + other.stability) / 2;
      if (partnerRep < 45) {
        const penalty = round((45 - partnerRep) * 0.18, 2);
        c.popularity = clamp(c.popularity - penalty, 0, 100);
        w.addJournal({
          day: w.meta.day, type: 'politics', countryIds: [c.id], actor: 'Opinion publique',
          text: `L’opinion de ${c.name} désapprouve l’accord avec ${other.name} (popularité du partenaire : ${other.popularity.toFixed(0)} %) : -${penalty} % de popularité.`,
        });
      }
      const boost = agType === 'free_trade' ? 8 : agType === 'aid_pact' ? 7 : 5;
      rel.score = clamp(rel.score + boost, 0, 100);
      orel.score = clamp(orel.score + boost, 0, 100);
      rel.trust = clamp(rel.trust + 4, 0, 100);
      orel.trust = clamp(orel.trust + 4, 0, 100);
      if (agType === 'tech_cooperation') {
        c.economy.productivity = round(c.economy.productivity * 1.01, 1);
        other.economy.productivity = round(other.economy.productivity * 1.01, 1);
      }
    } else {
      rel.score = clamp(rel.score - 4, 0, 100);
      orel.score = clamp(orel.score - 4, 0, 100);
    }
    w.markDirty(other.id);
    rel.lastContactDay = w.meta.day;
    orel.lastContactDay = w.meta.day;
    if (other.controller.kind === 'player' && other.controller.userId && ctx.notify) {
      void ctx.notify(other.controller.userId, {
        type: 'diplomacy',
        title: p.accept ? 'Accord signé' : 'Proposition refusée',
        body: `${c.name} a ${p.accept ? 'accepté' : 'refusé'} : ${agreementLabel(agType)}.`,
        day: w.meta.day,
      });
    }
    w.addJournal({
      day: w.meta.day, type: 'diplomacy', countryIds: [c.id, other.id], actor: ctx.actor.name,
      text: p.accept
        ? `${c.name} signe ${agreementLabel(agType).toLowerCase()} avec ${other.name}.`
        : `${c.name} refuse ${agreementLabel(agType).toLowerCase()} de ${other.name}.`,
    });
    if (p.accept) {
      spawnDiplomaticEvent(w, [c.id, other.id], agType === 'tech_cooperation' ? 'tech' : 'accord',
        `${agreementLabel(agType)} entre ${c.name} et ${other.name}`);
    }
    return { ok: true, message: p.accept ? `✓ ${agreementLabel(agType)} signé` : 'Proposition refusée' };
  },
};

const improveRelations: ActionDef<P<'improve_relations'>> = {
  type: 'improve_relations',
  label: 'Initiative diplomatique',
  category: 'diplomatie',
  cooldownDays: 3,
  validate: (w, c, p) => {
    if (p.targetId === c.id) return 'Cible invalide';
    if (!w.country(p.targetId) || !c.relations[p.targetId]) return 'Pays cible inconnu';
    const cost = round(0.4 + c.economy.gdp * 0.0004, 2);
    if (c.economy.cash < cost) return `Trésorerie insuffisante (${cost.toFixed(1)} Md €)`;
    return null;
  },
  estimate: (_w, c, p) => {
    const rel = c.relations[p.targetId]!;
    const cost = round(0.4 + c.economy.gdp * 0.0004, 2);
    return [
      eff(false, 'Coût', `${cost.toFixed(1)} Md €`),
      eff(true, 'Relations', `+4 à +6 (actuel ${rel.score.toFixed(0)})`),
      eff(true, 'Confiance', '+3'),
    ];
  },
  apply: (w, c, p, ctx) => {
    const target = w.country(p.targetId)!;
    const rel = c.relations[p.targetId]!;
    const trel = target.relations[c.id]!;
    const cost = round(0.4 + c.economy.gdp * 0.0004, 2);
    c.economy.cash = round(c.economy.cash - cost, 2);
    const gain = 4 + Math.round(trel.trust / 50);
    rel.score = clamp(rel.score + gain, 0, 100);
    trel.score = clamp(trel.score + gain, 0, 100);
    rel.trust = clamp(rel.trust + 3, 0, 100);
    trel.trust = clamp(trel.trust + 3, 0, 100);
    rel.lastContactDay = w.meta.day;
    trel.lastContactDay = w.meta.day;
    w.markDirty(target.id);
    if (target.controller.kind === 'player' && target.controller.userId && ctx.notify) {
      void ctx.notify(target.controller.userId, {
        type: 'diplomacy',
        title: 'Geste diplomatique',
        body: `${c.name} améliore ses relations avec vous (+${gain}).`,
        day: w.meta.day,
      });
    }
    w.addJournal({
      day: w.meta.day, type: 'diplomacy', countryIds: [c.id, target.id], actor: ctx.actor.name,
      text: `${c.name} mène une initiative diplomatique envers ${target.name} (relations +${gain}).`,
    });
    return { ok: true, message: `Relations avec ${target.name} : +${gain}` };
  },
};

const sendAid: ActionDef<P<'send_aid'>> = {
  type: 'send_aid',
  label: 'Envoyer une aide économique',
  category: 'diplomatie',
  cooldownDays: 5,
  validate: (w, c, p) => {
    if (p.targetId === c.id) return 'Cible invalide';
    const target = w.country(p.targetId);
    if (!target || !c.relations[p.targetId]) return 'Pays cible inconnu';
    if (!Number.isFinite(p.amount) || p.amount < 0.5) return 'Montant minimal : 0,5 Md €';
    const max = Math.max(1, c.economy.gdp * 0.02);
    if (p.amount > max) return `Montant maximal : ${max.toFixed(1)} Md € (2 % du PIB)`;
    if (c.economy.cash < p.amount) return 'Trésorerie insuffisante';
    return null;
  },
  estimate: (_w, c, p) => {
    const target = c.relations[p.targetId];
    const gain = clamp(Math.round(4 + p.amount * 1.5), 1, 15);
    return [
      eff(false, 'Coût', `${p.amount.toFixed(1)} Md €`),
      eff(true, 'Relations', `+${gain} (actuel ${target ? target.score.toFixed(0) : '?'})`),
      eff(true, 'Confiance du partenaire', `+${Math.min(8, Math.round(gain / 2))}`),
      eff(true, 'Stabilité du partenaire', '+1'),
    ];
  },
  apply: (w, c, p, ctx) => {
    const target = w.country(p.targetId)!;
    const rel = c.relations[p.targetId]!;
    const trel = target.relations[c.id]!;
    c.economy.cash = round(c.economy.cash - p.amount, 2);
    target.economy.cash = round(target.economy.cash + p.amount, 2);
    const gain = clamp(Math.round(4 + p.amount * 1.5), 1, 15);
    rel.score = clamp(rel.score + gain, 0, 100);
    trel.score = clamp(trel.score + gain, 0, 100);
    rel.trust = clamp(rel.trust + Math.min(8, Math.round(gain / 2)), 0, 100);
    trel.trust = clamp(trel.trust + Math.min(8, Math.round(gain / 2)), 0, 100);
    target.stability = clamp(target.stability + 1, 0, 100);
    w.markDirty(target.id);
    w.addTransaction({
      day: w.meta.day, fromId: c.id, toId: target.id, resource: 'industrial',
      units: 0, value: round(p.amount, 2), kind: 'aid', note: 'Aide économique bilatérale',
    });
    if (target.controller.kind === 'player' && target.controller.userId && ctx.notify) {
      void ctx.notify(target.controller.userId, {
        type: 'diplomacy',
        title: 'Aide économique reçue',
        body: `${c.name} vous envoie ${p.amount.toFixed(1)} Md € d’aide.`,
        day: w.meta.day,
      });
    }
    w.addJournal({
      day: w.meta.day, type: 'diplomacy', countryIds: [c.id, target.id], actor: ctx.actor.name,
      text: `${c.name} envoie une aide de ${p.amount.toFixed(1)} Md € à ${target.name}.`,
    });
    spawnDiplomaticEvent(w, [target.id], 'aid', `Aide de ${p.amount.toFixed(1)} Md € reçue de ${c.name}`);
    return { ok: true, message: `✓ Aide de ${p.amount.toFixed(1)} Md € envoyée à ${target.name}` };
  },
};

const imposeSanction: ActionDef<P<'impose_sanction'>> = {
  type: 'impose_sanction',
  label: 'Imposer une mesure économique',
  category: 'diplomatie',
  cooldownDays: 10,
  validate: (w, c, p) => {
    if (p.targetId === c.id) return 'Cible invalide';
    if (!w.country(p.targetId) || !c.relations[p.targetId]) return 'Pays cible inconnu';
    if (c.relations[p.targetId]!.sanctionByUs) return 'Mesure déjà en vigueur';
    return null;
  },
  estimate: (_w, c, p) => {
    const rel = c.relations[p.targetId]!;
    return [
      eff(false, 'Relations', `-16 (actuel ${rel.score.toFixed(0)})`),
      eff(false, 'Commerce bilatéral', 'suspendu tant que la mesure est en vigueur'),
      eff(false, 'Exportateurs nationaux', 'perte de débouchés (croissance −0,05 pt)'),
    ];
  },
  apply: (w, c, p, ctx) => {
    const target = w.country(p.targetId)!;
    const rel = c.relations[p.targetId]!;
    const trel = target.relations[c.id]!;
    rel.sanctionByUs = true;
    trel.sanctionByThem = true;
    rel.score = clamp(rel.score - 16, 0, 100);
    trel.score = clamp(trel.score - 16, 0, 100);
    rel.trust = clamp(rel.trust - 10, 0, 100);
    trel.trust = clamp(trel.trust - 10, 0, 100);
    w.markDirty(target.id);
    if (target.controller.kind === 'player' && target.controller.userId && ctx.notify) {
      void ctx.notify(target.controller.userId, {
        type: 'diplomacy',
        title: 'Mesure économique imposée',
        body: `${c.name} suspend ses échanges économiques avec vous.`,
        day: w.meta.day,
      });
    }
    w.addJournal({
      day: w.meta.day, type: 'diplomacy', countryIds: [c.id, target.id], actor: ctx.actor.name,
      text: `${c.name} impose une mesure économique à ${target.name} : échanges bilatéraux suspendus.`,
    });
    spawnDiplomaticEvent(w, [c.id, target.id], 'sanction', `Mesure économique de ${c.name} envers ${target.name}`);
    return { ok: true, message: `Mesure économique imposée à ${target.name}` };
  },
};

const liftSanction: ActionDef<P<'lift_sanction'>> = {
  type: 'lift_sanction',
  label: 'Lever une mesure économique',
  category: 'diplomatie',
  cooldownDays: 2,
  validate: (_w, c, p) => {
    if (!c.relations[p.targetId]) return 'Pays cible inconnu';
    if (!c.relations[p.targetId]!.sanctionByUs) return 'Aucune mesure en vigueur';
    return null;
  },
  estimate: (_w, _c, _p) => [eff(true, 'Relations', '+6'), eff(true, 'Commerce bilatéral', 'rétabli')],
  apply: (w, c, p, ctx) => {
    const target = w.country(p.targetId)!;
    const rel = c.relations[p.targetId]!;
    const trel = target.relations[c.id]!;
    rel.sanctionByUs = false;
    trel.sanctionByThem = false;
    rel.score = clamp(rel.score + 6, 0, 100);
    trel.score = clamp(trel.score + 6, 0, 100);
    w.markDirty(target.id);
    if (target.controller.kind === 'player' && target.controller.userId && ctx.notify) {
      void ctx.notify(target.controller.userId, {
        type: 'diplomacy',
        title: 'Mesure économique levée',
        body: `${c.name} rétablit ses échanges économiques avec vous.`,
        day: w.meta.day,
      });
    }
    w.addJournal({
      day: w.meta.day, type: 'diplomacy', countryIds: [c.id, target.id], actor: ctx.actor.name,
      text: `${c.name} lève sa mesure économique envers ${target.name}.`,
    });
    spawnDiplomaticEvent(w, [c.id, target.id], 'thaw', `Levée de la mesure économique entre ${c.name} et ${target.name}`);
    return { ok: true, message: `Mesure levée envers ${target.name}` };
  },
};

const buyResource: ActionDef<P<'buy_resource'>> = {
  type: 'buy_resource',
  label: 'Acheter sur le marché mondial',
  category: 'commerce',
  cooldownDays: 1,
  validate: (w, c, p) => {
    if (!RESOURCE_MAP[p.resource]) return 'Ressource inconnue';
    if (!Number.isFinite(p.units) || p.units <= 0) return 'Quantité invalide';
    const r = c.resources[p.resource];
    if (r.stock + p.units > r.capacity) return `Capacité de stockage insuffisante (max ${Math.max(0, Math.floor(r.capacity - r.stock))} unités)`;
    const value = round(p.units * w.market[p.resource].price * VALUE_SCALE * 1000, 2);
    if (c.economy.cash < value) return `Trésorerie insuffisante : ${value.toFixed(1)} Md € requis`;
    return null;
  },
  estimate: (w, c, p) => {
    const value = round(p.units * w.market[p.resource].price * VALUE_SCALE * 1000, 2);
    return [
      eff(false, 'Coût', `${value.toFixed(2)} Md €`),
      eff(true, `Stock ${RESOURCE_MAP[p.resource].name}`, `+${Math.round(p.units)} unités`),
      eff(false, 'Prix mondial', 'légère pression haussière'),
    ];
  },
  apply: (w, c, p, ctx) => {
    const m = w.market[p.resource];
    const value = round(p.units * m.price * VALUE_SCALE * 1000, 2);
    c.economy.cash = round(c.economy.cash - value, 2);
    const r = c.resources[p.resource];
    r.stock = round(Math.min(r.capacity, r.stock + p.units), 1);
    m.price = round(m.price * (1 + Math.min(0.02, p.units / 20000)), 3);
    w.markMarketDirty();
    w.addTransaction({
      day: w.meta.day, fromId: 'market', toId: c.id, resource: p.resource,
      units: round(p.units, 1), value, kind: 'deal', note: 'Achat sur le marché mondial',
    });
    w.addJournal({
      day: w.meta.day, type: 'trade', countryIds: [c.id], actor: ctx.actor.name,
      text: `${c.name} achète ${Math.round(p.units)} unités de ${RESOURCE_MAP[p.resource].name.toLowerCase()} (${value.toFixed(2)} Md €).`,
    });
    return { ok: true, message: `✓ Achat effectué : −${value.toFixed(2)} Md €` };
  },
};

/* ------------------------------------------------------------------ */
/* Routes commerciales (corridors) & expéditions manuelles             */
/* ------------------------------------------------------------------ */

export function corridorValidFor(
  corridor: TradeCorridor,
  from: Country,
  to: Country,
): boolean {
  const [ra, rb] = corridor.regions;
  const regionsOk = (from.region === ra && to.region === rb) || (from.region === rb && to.region === ra);
  const hubsOk = corridor.hubs.includes(from.id) && corridor.hubs.includes(to.id);
  return regionsOk || hubsOk;
}

export interface ShipmentLeg {
  corridorId: string;
  name: string;
  ownerId: string | null;
  tollRate: number;   // % effectivement payé sur cette étape (0 si libre ou à vous)
  toll: number;       // Md € versés au propriétaire
}

export interface ShipmentQuote {
  value: number;        // Md € payés par l'importateur
  tollRate: number;     // % total prélevé par les propriétaires de routes
  toll: number;         // Md € au total pour les propriétaires
  legs: ShipmentLeg[];  // étapes de la route empruntée
  freight: number;      // fret logistique (sunk), comme pour le commerce automatique
  routeLabel: string;   // nom de la route / combinaison empruntée
  ok: boolean;          // false si aucune route commerciale utilisable
}

/** Devis d'expédition : corridorId = 'auto' (meilleure combinaison serveur)
 *  ou l'identifiant d'un corridor précis reliant vos deux régions.
 *  Il n'existe plus de voie directe : toute marchandise emprunte une route. */
export function quoteShipment(
  world: WorldStore,
  from: Country,
  to: Country,
  resource: ResourceKey,
  units: number,
  corridorId: string,
): ShipmentQuote {
  const price = (from.resources[resource].price + to.resources[resource].price) / 2;
  const value = round(units * price * VALUE_SCALE * 1000, 3);
  const legs: ShipmentLeg[] = [];
  const pushLeg = (cid: string): void => {
    const co = world.corridor(cid);
    if (!co) return;
    const paysToll = co.owner !== null && co.owner !== from.id;
    const tollRate = paysToll ? co.toll : 0;
    legs.push({ corridorId: co.id, name: co.name, ownerId: co.owner, tollRate, toll: round((value * tollRate) / 100, 3) });
  };
  let routeLabel = '';
  if (corridorId === 'auto') {
    const route = chooseRoute(world, from, to);
    if (!route) return { value, tollRate: 0, toll: 0, legs, freight: 0, routeLabel: '', ok: false };
    routeLabel = route.label;
    for (const cid of route.corridors) pushLeg(cid);
  } else {
    const co = world.corridor(corridorId);
    if (!co) return { value, tollRate: 0, toll: 0, legs, freight: 0, routeLabel: '', ok: false };
    routeLabel = co.name;
    pushLeg(corridorId);
  }
  if (legs.length === 0) return { value, tollRate: 0, toll: 0, legs, freight: 0, routeLabel, ok: false };
  const tollRate = round(legs.reduce((s, l) => s + l.tollRate, 0), 2);
  const toll = round(legs.reduce((s, l) => s + l.toll, 0), 3);
  const freight = round(value * (0.015 + 0.008 * legs.length), 3);
  return { value, tollRate, toll, legs, freight, routeLabel, ok: true };
}

const buyCorridor: ActionDef<Extract<ActionParams, { type: 'buy_corridor' }>> = {
  type: 'buy_corridor',
  label: 'Acheter une route commerciale',
  category: 'commerce',
  cooldownDays: 5,
  validate: (w, c, p) => {
    const co = w.corridor(p.corridorId);
    if (!co) return 'Route inconnue';
    if (co.owner) return `Cette route appartient déjà à ${w.country(co.owner)?.name ?? 'un autre pays'}`;
    if (c.economy.cash < co.purchaseCost) return `Trésorerie insuffisante : ${co.purchaseCost} Md € requis`;
    return null;
  },
  estimate: (w, _c, p) => {
    const co = w.corridor(p.corridorId);
    if (!co) return [];
    return [
      { positive: false, label: 'Coût immédiat (trésorerie)', value: `-${co.purchaseCost} Md €` },
      { positive: true, label: 'Péages perçus', value: 'tout transit tiers → trésorerie' },
      { positive: true, label: 'Vos transits', value: 'péage 0 % sur votre route' },
      { positive: false, label: 'Entretien', value: `${co.upkeep} Md €/an` },
    ];
  },
  apply: (w, c, p, ctx) => {
    const co = w.corridor(p.corridorId)!;
    c.economy.cash = round(c.economy.cash - co.purchaseCost, 2);
    co.owner = c.id;
    co.toll = 4; // péage initial modéré
    w.markCorridorsDirty();
    w.addJournal({
      day: w.meta.day, type: 'trade', countryIds: [c.id], actor: ctx.actor.name,
      text: `${c.name} acquiert la route « ${co.name} » pour ${co.purchaseCost} Md € et y fixe un péage de ${co.toll} %.`,
    });
    return {
      ok: true,
      message: `✓ Route « ${co.name} » achetée`,
      effects: [
        { positive: false, label: 'Trésorerie', value: `-${co.purchaseCost} Md €` },
        { positive: true, label: 'Péages perçus', value: 'sur tout transit tiers' },
        { positive: false, label: 'Entretien', value: `${co.upkeep} Md €/an` },
      ],
    };
  },
};

const abandonCorridor: ActionDef<Extract<ActionParams, { type: 'abandon_corridor' }>> = {
  type: 'abandon_corridor',
  label: 'Abandonner une route',
  category: 'commerce',
  cooldownDays: 10,
  validate: (w, c, p) => {
    const co = w.corridor(p.corridorId);
    if (!co) return 'Route inconnue';
    if (co.owner !== c.id) return 'Vous ne possédez pas cette route';
    return null;
  },
  estimate: () => [
    { positive: true, label: 'Entretien', value: 'supprimé' },
    { positive: false, label: 'Péages', value: 'perdus' },
    { positive: false, label: 'Investissement', value: 'non remboursé' },
  ],
  apply: (w, c, p, ctx) => {
    const co = w.corridor(p.corridorId)!;
    co.owner = null;
    co.toll = 0;
    w.markCorridorsDirty();
    w.addJournal({
      day: w.meta.day, type: 'trade', countryIds: [c.id], actor: ctx.actor.name,
      text: `${c.name} abandonne la route « ${co.name} » : elle redevient une voie libre.`,
    });
    return { ok: true, message: `Route « ${co.name} » abandonnée` };
  },
};

const setToll: ActionDef<Extract<ActionParams, { type: 'set_toll' }>> = {
  type: 'set_toll',
  label: 'Fixer le péage d’une route',
  category: 'commerce',
  cooldownDays: 2,
  validate: (w, c, p) => {
    const co = w.corridor(p.corridorId);
    if (!co) return 'Route inconnue';
    if (co.owner !== c.id) return 'Vous ne possédez pas cette route';
    if (!Number.isFinite(p.value) || p.value < 0 || p.value > 15) return 'Péage invalide (0 à 15 %)';
    return null;
  },
  estimate: (_w, _c, p) => [
    { positive: p.value > 0, label: 'Recettes par transit', value: `${p.value.toFixed(1)} % de la valeur` },
    { positive: p.value <= 6, label: 'Attractivité de la route', value: p.value > 8 ? 'les partenaires éviteront cette voie' : 'correcte' },
  ],
  apply: (w, c, p, ctx) => {
    const co = w.corridor(p.corridorId)!;
    co.toll = round(clamp(p.value, 0, 15), 1);
    w.markCorridorsDirty();
    w.addJournal({
      day: w.meta.day, type: 'trade', countryIds: [c.id], actor: ctx.actor.name,
      text: `${c.name} fixe le péage de « ${co.name} » à ${co.toll} %.`,
    });
    return { ok: true, message: `Péage « ${co.name} » : ${co.toll} %` };
  },
};

/* ------------------------------------------------------------------ */
/* Expédition exceptionnelle en DEUX TEMPS :                           */
/*   1. ship_goods : la marchandise quitte les entrepôts de             */
/*      l'expéditeur (réservée) et une livraison en attente est créée. */
/*   2. respond_delivery : le DESTINATAIRE accepte (il est débité de    */
/*      la valeur et reçoit les ressources) ou refuse (retour).        */
/* Sans réponse avant l'expiration, la marchandise retourne seule.     */
/* L'argent ne bouge qu'à l'acceptation : aucune création monétaire.   */
/* ------------------------------------------------------------------ */

/** Rend la marchandise réservée à l'expéditeur (refus ou expiration). */
export function returnDeliveryUnits(
  w: WorldStore,
  d: import('shared').PendingDelivery,
  reason: 'refused' | 'expired',
  ctx?: { actorName?: string; notify?: ActionContext['notify'] },
): void {
  const from = w.country(d.fromId);
  const to = w.country(d.toId);
  if (from) {
    const r = from.resources[d.resource];
    r.stock = round(Math.min(r.capacity, r.stock + d.units), 2);
    w.markDirty(from.id);
  }
  w.removeDelivery(d.id);
  if (reason === 'refused' && from && to) {
    // Léger froid diplomatique : une livraison refusée ne fait jamais plaisir.
    const rel = from.relations[to.id];
    const trel = to.relations[from.id];
    if (rel) rel.score = clamp(rel.score - 1, 0, 100);
    if (trel) trel.score = clamp(trel.score - 1, 0, 100);
  }
  w.addJournal({
    day: w.meta.day, type: 'trade', countryIds: [d.fromId, d.toId],
    actor: reason === 'expired' ? 'Système' : (ctx?.actorName ?? to?.controller.presidentName ?? 'Système'),
    text: reason === 'expired'
      ? `${to?.name ?? d.toId} n'a pas répondu à temps à la livraison de ${Math.round(d.units)} unités de ${RESOURCE_MAP[d.resource].name.toLowerCase()} de ${from?.name ?? d.fromId} : la marchandise retourne à l'expéditeur.`
      : `${to?.name ?? d.toId} REFUSE la livraison de ${Math.round(d.units)} unités de ${RESOURCE_MAP[d.resource].name.toLowerCase()} proposée par ${from?.name ?? d.fromId} : la marchandise retourne à l'expéditeur.`,
  });
  if (from && from.controller.kind === 'player' && from.controller.userId && ctx?.notify) {
    void ctx.notify(from.controller.userId, {
      type: 'trade',
      title: reason === 'expired' ? 'Livraison retournée (sans réponse)' : 'Livraison refusée',
      body: `${to?.name ?? d.toId} ${reason === 'expired' ? "n'a pas accepté" : 'a refusé'} votre livraison de ${Math.round(d.units)} unités de ${RESOURCE_MAP[d.resource].name}. La marchandise est revenue dans vos entrepôts.`,
      day: w.meta.day,
    });
  }
}

/** Expiration quotidienne des livraisons en attente (appelé par le moteur). */
export function expirePendingDeliveries(w: WorldStore, notify?: ActionContext['notify']): number {
  const expired = w.expiredDeliveries(w.meta.day);
  for (const d of expired) returnDeliveryUnits(w, d, 'expired', { notify });
  return expired.length;
}

const shipGoods: ActionDef<Extract<ActionParams, { type: 'ship_goods' }>> = {
  type: 'ship_goods',
  label: 'Expédier des marchandises',
  category: 'commerce',
  cooldownDays: 0,
  validate: (w, c, p) => {
    const to = w.country(p.toId);
    if (!to || to.id === c.id) return 'Destinataire invalide';
    const rel = c.relations[p.toId];
    if (!rel) return 'Relations inexistantes';
    if (rel.sanctionByUs || rel.sanctionByThem) return 'Mesure économique active : échanges suspendus';
    if (rel.score < 30 && !rel.agreements.some((a) => a.status === 'active')) return 'Relations insuffisantes (30) ou aucun accord actif';
    const r = c.resources[p.resource];
    if (!r) return 'Ressource inconnue';
    if (!Number.isFinite(p.units) || p.units <= 0) return 'Quantité invalide';
    if (p.units > r.stock * 0.5) return `Stock insuffisant (max ${Math.floor(r.stock * 0.5)} unités)`;
    if (w.openDeliveriesBySender(c.id) >= MAX_OPEN_DELIVERIES_PER_SENDER) {
      return `Trop de livraisons en attente d'acceptation (${MAX_OPEN_DELIVERIES_PER_SENDER} max) : attendez la réponse de vos destinataires`;
    }
    if (p.corridorId === 'direct') {
      return 'Les voies directes n\'existent plus : toute marchandise passe par une Route commerciale (achetable et taxable)';
    }
    if (p.corridorId === 'auto') {
      if (!chooseRoute(w, c, to)) return 'Aucune route commerciale disponible vers ce destinataire';
    } else {
      const co = w.corridor(p.corridorId);
      if (!co) return 'Route inconnue';
      if (!corridorValidFor(co, c, to)) return `La route « ${co.name} » ne relie pas vos deux régions`;
    }
    const toRoom = to.resources[p.resource].capacity - to.resources[p.resource].stock;
    if (p.units > toRoom) return `Le destinataire n'a pas assez d'entrepôts (${Math.floor(toRoom)} unités max)`;
    return null;
  },
  estimate: (w, c, p) => {
    const to = w.country(p.toId);
    if (!to) return [];
    const q = quoteShipment(w, c, to, p.resource, p.units, p.corridorId);
    if (!q.ok) return [{ positive: false, label: 'Route', value: 'aucune route commerciale utilisable' }];
    return [
      { positive: true, label: 'Valeur payée par le destinataire À L’ACCEPTATION', value: `${q.value.toFixed(2)} Md €` },
      q.toll > 0
        ? { positive: false, label: `Péages (${q.tollRate.toFixed(1)} %) vers les propriétaires de routes`, value: `-${q.toll.toFixed(2)} Md €` }
        : { positive: true, label: 'Péage', value: '0 % (routes libres ou à vous)' },
      { positive: false, label: `Fret logistique (${q.legs.length} route${q.legs.length > 1 ? 's' : ''})`, value: `-${q.freight.toFixed(2)} Md €` },
      { positive: true, label: 'Recette nette si acceptée', value: `${(q.value - q.toll - q.freight).toFixed(2)} Md €` },
      { positive: true, label: 'Route empruntée', value: q.routeLabel },
      { positive: false, label: 'Stock immobilisé', value: `${Math.round(p.units)} unités réservées dès l'expédition` },
      { positive: true, label: 'Acceptation', value: `${to.name} doit accepter (${DELIVERY_RESPONSE_DAYS} jours) — sinon retour automatique` },
    ];
  },
  apply: (w, c, p, ctx) => {
    const to = w.country(p.toId)!;
    const q = quoteShipment(w, c, to, p.resource, p.units, p.corridorId);
    if (!q.ok) return { ok: false, error: 'Aucune route commerciale utilisable pour cette expédition' };
    // La marchandise quitte IMMÉDIATEMENT les entrepôts de l'expéditeur (réservée).
    c.resources[p.resource].stock = round(Math.max(0, c.resources[p.resource].stock - p.units), 2);
    const delivery: import('shared').PendingDelivery = {
      id: uid('dlv'),
      createdDay: w.meta.day,
      expiresDay: w.meta.day + DELIVERY_RESPONSE_DAYS,
      fromId: c.id,
      toId: to.id,
      resource: p.resource,
      units: round(p.units, 1),
      value: q.value,
      toll: q.toll,
      freight: q.freight,
      routeLabel: q.routeLabel,
      corridors: q.legs.map((l) => l.corridorId),
      legs: q.legs.map((l) => ({ corridorId: l.corridorId, ownerId: l.ownerId, toll: l.toll })),
      status: 'pending',
    };
    w.addDelivery(delivery);
    w.markDirty(to.id);
    w.addJournal({
      day: w.meta.day, type: 'trade', countryIds: [c.id, to.id], actor: ctx.actor.name,
      text: `${c.name} expédie ${Math.round(p.units)} unités de ${RESOURCE_MAP[p.resource].name.toLowerCase()} à ${to.name} via « ${q.routeLabel} » (${q.value.toFixed(2)} Md €) — en attente d'acceptation du destinataire (réponse avant le jour ${delivery.expiresDay}).`,
    });
    if (to.controller.kind === 'player' && to.controller.userId && ctx.notify) {
      void ctx.notify(to.controller.userId, {
        type: 'trade', title: 'Livraison en attente de votre acceptation',
        body: `${c.name} vous propose ${Math.round(p.units)} unités de ${RESOURCE_MAP[p.resource].name} pour ${q.value.toFixed(2)} Md € (route « ${q.routeLabel} »). Acceptez : la valeur est débitée de votre trésorerie et les ressources rejoignent vos entrepôts. Refusez ou laissez passer le jour ${delivery.expiresDay} : la marchandise repartira.`,
        day: w.meta.day,
        action: {
          kind: 'respond_delivery', deliveryId: delivery.id, countryId: to.id, fromCountry: c.name,
          resource: p.resource, units: delivery.units, value: q.value, expiresDay: delivery.expiresDay,
        },
      });
    }
    return {
      ok: true,
      message: `✓ Expédition en route vers ${to.name} — en attente d'acceptation (retour automatique au jour ${delivery.expiresDay})`,
      effects: [
        { positive: false, label: 'Stock réservé', value: `-${Math.round(p.units)} unités` },
        { positive: true, label: 'Recette nette si acceptée', value: `+${(q.value - q.toll - q.freight).toFixed(2)} Md €` },
        { positive: false, label: 'Décision du destinataire', value: `avant le jour ${delivery.expiresDay}` },
      ],
    };
  },
};

const respondDelivery: ActionDef<Extract<ActionParams, { type: 'respond_delivery' }>> = {
  type: 'respond_delivery',
  label: 'Répondre à une livraison exceptionnelle',
  category: 'commerce',
  cooldownDays: 0,
  validate: (w, c, p) => {
    const d = w.delivery(p.deliveryId);
    if (!d) return 'Livraison introuvable (déjà traitée ou expirée)';
    if (d.toId !== c.id) return 'Cette livraison ne vous est pas destinée';
    if (w.meta.day > d.expiresDay) return 'Livraison expirée : la marchandise est retournée à l\'expéditeur';
    if (p.accept) {
      if (c.economy.cash < d.value) {
        return `Trésorerie insuffisante pour payer cette livraison (${d.value.toFixed(2)} Md € requis) — refusez-la`;
      }
      const room = c.resources[d.resource].capacity - c.resources[d.resource].stock;
      if (d.units > room) {
        return `Entrepôts insuffisants pour recevoir ${Math.round(d.units)} unités (place restante : ${Math.floor(room)}) — refusez la livraison`;
      }
      const rel = c.relations[d.fromId];
      if (rel && (rel.sanctionByUs || rel.sanctionByThem)) {
        return 'Mesure économique active avec l\'expéditeur : refusez cette livraison';
      }
    }
    return null;
  },
  estimate: (w, c, p) => {
    const d = w.delivery(p.deliveryId);
    if (!d) return [];
    const from = w.country(d.fromId);
    void c;
    if (!p.accept) {
      return [
        eff(true, 'Marchandise', 'retournée à l\'expéditeur — rien à payer'),
        eff(false, 'Relations', '−1 avec l\'expéditeur'),
      ];
    }
    return [
      eff(false, 'Paiement (trésorerie)', `-${d.value.toFixed(2)} Md €`),
      eff(true, `Stock ${RESOURCE_MAP[d.resource].name}`, `+${Math.round(d.units)} unités`),
      eff(true, 'Expéditeur', `${from?.name ?? d.fromId} encaisse ${(d.value - d.toll - d.freight).toFixed(2)} Md € nets`),
      eff(d.toll === 0, 'Péages de la route', `${d.toll.toFixed(2)} Md € (déjà inclus dans le flux)`),
    ];
  },
  apply: (w, c, p, ctx) => {
    const d = w.delivery(p.deliveryId)!;
    const from = w.country(d.fromId)!;
    if (!p.accept) {
      returnDeliveryUnits(w, d, 'refused', { actorName: ctx.actor.name, notify: ctx.notify });
      w.markDirty(c.id);
      return {
        ok: true,
        message: `✕ Livraison de ${from.name} refusée — la marchandise retourne à l'expéditeur`,
        effects: [
          eff(true, 'Trésorerie', 'aucun débit'),
          eff(false, 'Relations', `−1 avec ${from.name}`),
        ],
      };
    }
    // ACCEPTATION : le destinataire est débité de la valeur et reçoit les
    // ressources ; l'expéditeur encaisse (valeur − péages − fret) ; les péages
    // tombent directement dans la trésorerie des propriétaires de routes.
    c.economy.cash = round(c.economy.cash - d.value, 3);
    from.economy.cash = round(from.economy.cash + d.value - d.toll - d.freight, 3);
    c.resources[d.resource].stock = round(Math.min(c.resources[d.resource].capacity, c.resources[d.resource].stock + d.units), 2);
    for (const leg of d.legs) {
      const co = w.corridor(leg.corridorId);
      if (!co) continue;
      co.traffic = round(co.traffic + d.value, 2);
      if (leg.toll > 0 && leg.ownerId && leg.ownerId !== from.id) {
        const owner = w.country(leg.ownerId);
        if (owner) {
          owner.economy.cash = round(owner.economy.cash + leg.toll, 3); // → trésorerie du propriétaire
          w.markDirty(owner.id);
        }
      }
    }
    w.markCorridorsDirty();
    w.removeDelivery(d.id);
    // Trace + carte
    w.addTransaction({
      day: w.meta.day, fromId: from.id, toId: c.id, resource: d.resource,
      units: d.units, value: d.value, kind: 'export',
      note: `Expédition acceptée via « ${d.routeLabel} »`,
    });
    const routeId = `${from.id}->${c.id}:${d.resource}`;
    const existing = w.routes.get(routeId);
    w.upsertRoute({
      id: routeId, fromId: from.id, toId: c.id, resource: d.resource,
      volume: existing ? round(existing.volume * 0.5 + (d.units / 5) * 0.5, 2) : round(d.units / 5, 2),
      value: existing ? round(existing.value * 0.5 + (d.value / 5) * 0.5, 4) : round(d.value / 5, 4),
      updatedDay: w.meta.day,
      corridors: d.corridors,
    });
    const rel = from.relations[c.id]!;
    const trel = c.relations[from.id]!;
    rel.tradeVolume = round(rel.tradeVolume * 0.8 + d.value, 3);
    trel.tradeVolume = rel.tradeVolume;
    rel.score = clamp(rel.score + 0.4, 0, 100);
    trel.score = rel.score;
    rel.lastContactDay = w.meta.day;
    trel.lastContactDay = w.meta.day;
    w.markDirty(from.id);
    w.addJournal({
      day: w.meta.day, type: 'trade', countryIds: [from.id, c.id], actor: ctx.actor.name,
      text: `${c.name} ACCEPTE la livraison de ${from.name} : ${Math.round(d.units)} unités de ${RESOURCE_MAP[d.resource].name.toLowerCase()} contre ${d.value.toFixed(2)} Md € (route « ${d.routeLabel} »).`,
    });
    if (from.controller.kind === 'player' && from.controller.userId && ctx.notify) {
      void ctx.notify(from.controller.userId, {
        type: 'trade', title: 'Livraison acceptée',
        body: `${c.name} a accepté votre livraison de ${Math.round(d.units)} unités de ${RESOURCE_MAP[d.resource].name} : +${(d.value - d.toll - d.freight).toFixed(2)} Md € nets dans votre trésorerie.`,
        day: w.meta.day,
      });
    }
    const netSender = d.value - d.toll - d.freight;
    return {
      ok: true,
      message: `✓ Livraison acceptée : +${Math.round(d.units)} unités, -${d.value.toFixed(2)} Md €`,
      effects: [
        eff(false, 'Trésorerie', `-${d.value.toFixed(2)} Md €`),
        eff(true, `Stock ${RESOURCE_MAP[d.resource].name}`, `+${Math.round(d.units)} unités`),
        eff(true, 'Relations', `+0,4 avec ${from.name}`),
      ],
      bigWin: netSender >= BIG_WIN_THRESHOLD ? { countryId: from.id, amount: netSender, source: `Livraison acceptée par ${c.name}` } : undefined,
    };
  },
};

const breakAgreement: ActionDef<Extract<ActionParams, { type: 'break_agreement' }>> = {
  type: 'break_agreement',
  label: 'Rompre un accord',
  category: 'diplomatie',
  cooldownDays: 8,
  validate: (w, c, p) => {
    let found = false;
    for (const rel of Object.values(c.relations)) {
      if (rel.agreements.some((a) => a.id === p.agreementId && a.status === 'active')) { found = true; break; }
    }
    if (!found) return 'Accord actif introuvable';
    void w;
    return null;
  },
  estimate: () => [
    { positive: false, label: 'Relations', value: '-10 avec le partenaire' },
    { positive: false, label: 'Confiance', value: '-8' },
    { positive: true, label: 'Liberté d’action', value: 'retrouvée (fin des bonus/malus de l’accord)' },
    { positive: false, label: 'Commerce bilatéral', value: 'réduit (fin des bonus de l’accord)' },
  ],
  apply: (w, c, p, ctx) => {
    let otherId: string | null = null;
    let type = '';
    for (const [oid, rel] of Object.entries(c.relations)) {
      const ag = rel.agreements.find((a) => a.id === p.agreementId && a.status === 'active');
      if (ag) { ag.status = 'rejected'; otherId = oid; type = ag.type; break; }
    }
    if (!otherId) return { ok: false, error: 'Accord introuvable' };
    const other = w.country(otherId)!;
    const orel = other.relations[c.id]!;
    const rel = c.relations[otherId]!;
    const oag = orel.agreements.find((a) => a.id === p.agreementId);
    if (oag) oag.status = 'rejected';
    rel.score = clamp(rel.score - 10, 0, 100);
    orel.score = clamp(orel.score - 10, 0, 100);
    rel.trust = clamp(rel.trust - 8, 0, 100);
    orel.trust = clamp(orel.trust - 8, 0, 100);
    w.markDirty(other.id);
    const label = agreementLabel(type as import('shared').AgreementType);
    w.addJournal({
      day: w.meta.day, type: 'diplomacy', countryIds: [c.id, other.id], actor: ctx.actor.name,
      text: `${c.name} ROMPT ${label.toLowerCase()} avec ${other.name} : choc diplomatique.`,
    });
    if (other.controller.kind === 'player' && other.controller.userId && ctx.notify) {
      void ctx.notify(other.controller.userId, {
        type: 'diplomacy', title: 'Accord rompu',
        body: `${c.name} a dénoncé ${label.toLowerCase()} qui vous liait. Relations -10.`,
        day: w.meta.day,
      });
    }
    return { ok: true, message: `${label} rompu avec ${other.name}` };
  },
};

const setRoute: ActionDef<Extract<ActionParams, { type: 'set_route' }>> = {
  type: 'set_route',
  label: 'Choisir une route commerciale',
  category: 'commerce',
  cooldownDays: 1,
  validate: (w, c, p) => {
    const to = w.country(p.partnerId);
    if (!to || to.id === c.id) return 'Partenaire invalide';
    if (p.pathId !== 'auto') {
      const opts = routeOptions(w, c, to);
      if (!opts.some((o) => o.id === p.pathId)) return 'Combinaison de route invalide pour ce partenaire';
    }
    return null;
  },
  estimate: (w, c, p) => {
    const to = w.country(p.partnerId)!;
    const opts = routeOptions(w, c, to);
    const chosen = p.pathId === 'auto' ? opts[0]! : opts.find((o) => o.id === p.pathId);
    if (!chosen) return [];
    return [
      { positive: chosen.tollRate === 0, label: 'Péages à payer', value: `${chosen.tollRate.toFixed(1)} % de la valeur` },
      { positive: chosen.freightRate < 5, label: 'Fret logistique', value: `${chosen.freightRate.toFixed(1)} %` },
      { positive: true, label: 'Coût total du transit', value: `${chosen.costRate.toFixed(1)} %` },
      { positive: false, label: 'Étapes', value: `${chosen.corridors.length} route(s) commerciale(s)` },
    ];
  },
  apply: (w, c, p, ctx) => {
    const to = w.country(p.partnerId)!;
    c.routePrefs[p.partnerId] = p.pathId;
    const opts = routeOptions(w, c, to);
    const chosen = p.pathId === 'auto' ? opts[0]! : opts.find((o) => o.id === p.pathId);
    w.addJournal({
      day: w.meta.day, type: 'trade', countryIds: [c.id, to.id], actor: ctx.actor.name,
      text: `${c.name} routera ses échanges avec ${to.name} via ${p.pathId === 'auto' ? 'la meilleure route automatique' : `« ${chosen?.label ?? p.pathId} »`}.`,
    });
    return { ok: true, message: `Route vers ${to.name} : ${chosen?.label ?? 'auto'}` };
  },
};


/* ------------------------------------------------------------------ */
/* Ressources : consignes de production, achats bilatéraux, offres      */
/* ------------------------------------------------------------------ */

/** Rendement quotidien (Md €/j) des consignes : boost subventionné, ralenti économe. */
const MAX_BOOSTS = 3;
const BILATERAL_PREMIUM = 1.06;

const setProduction: ActionDef<Extract<ActionParams, { type: 'set_production' }>> = {
  type: 'set_production',
  label: 'Consigne de production',
  category: 'commerce',
  cooldownDays: 2,
  validate: (w, c, p) => {
    if (!RESOURCE_MAP[p.resource]) return 'Ressource inconnue';
    if (!['boost', 'normal', 'slow'].includes(p.mode)) return 'Consigne invalide (boost, normal ou slow)';
    const current = c.productionDirectives?.[p.resource];
    if (p.mode === 'boost' && current !== 'boost') {
      const boosts = Object.values(c.productionDirectives ?? {}).filter((v) => v === 'boost').length;
      if (boosts >= MAX_BOOSTS) return `Maximum ${MAX_BOOSTS} productions boostées simultanément (capacités industrielles)`;
      if (c.economy.cash < c.economy.gdp * 0.002) return 'Trésorerie trop faible pour subventionner un boost de production';
    }
    void w;
    return null;
  },
  estimate: (w, c, p) => {
    const r = c.resources[p.resource];
    const name = RESOURCE_MAP[p.resource].name;
    // Production de BASE (sans la consigne actuelle) pour un delta exact :
    // passer de ralenti à boost affiche bien +30 %, pas +15 %.
    const cur = c.productionDirectives?.[p.resource];
    const curMul = cur === 'boost' ? PRODUCTION_BOOST_MUL : cur === 'slow' ? PRODUCTION_SLOW_MUL : 1;
    const base = r.production / curMul;
    if (p.mode === 'boost') {
      const extra = base * (PRODUCTION_BOOST_MUL - curMul);
      const cost = c.economy.gdp * 0.00012;
      return [
        eff(true, `Production ${name}`, `${base.toFixed(1)} → ${(base * PRODUCTION_BOOST_MUL).toFixed(1)} u/j (≈ +${extra.toFixed(1)})`),
        eff(false, 'Subvention quotidienne', `-${cost.toFixed(3)} Md €/jour (trésorerie)`),
        eff(true, 'Stocks', 'se remplissent plus vite — utile en pénurie'),
      ];
    }
    if (p.mode === 'slow') {
      const less = base * (curMul - PRODUCTION_SLOW_MUL);
      const saving = c.economy.gdp * 0.00006;
      return [
        eff(false, `Production ${name}`, `${base.toFixed(1)} → ${(base * PRODUCTION_SLOW_MUL).toFixed(1)} u/j (≈ -${less.toFixed(1)})`),
        eff(true, 'Économie quotidienne', `+${saving.toFixed(3)} Md €/jour (trésorerie)`),
        eff(true, 'Usage', 'pertinent en surstock : moins produire en attendant des prix meilleurs'),
      ];
    }
    return [
      eff(true, `Production ${name}`, `retour au rythme normal : ${base.toFixed(1)} u/j`),
      eff(true, 'Coût', 'aucune subvention, aucune économie'),
    ];
    void w;
  },
  apply: (w, c, p, ctx) => {
    const name = RESOURCE_MAP[p.resource].name;
    if (p.mode === 'normal') delete c.productionDirectives[p.resource];
    else c.productionDirectives[p.resource] = p.mode;
    // Synchronisation IMMÉDIATE : les taux production/consommation affichés
    // (onglets Ressources ET Production) reflètent la consigne sans attendre
    // le prochain tick — le push country_update suit derrière.
    refreshProductionRates(c);
    w.markDirty(c.id);
    const label = p.mode === 'boost' ? 'en régime BOOSTÉ (+15 %)' : p.mode === 'slow' ? 'au RALENTI (-12 %)' : 'au rythme normal';
    w.addJournal({
      day: w.meta.day, type: 'trade', countryIds: [c.id], actor: ctx.actor.name,
      text: `${c.name} place sa production de ${name.toLowerCase()} ${label}.`,
    });
    return {
      ok: true,
      message: `✓ ${name} : ${label}`,
      effects: p.mode === 'boost'
        ? [eff(true, 'Production', '+15 %'), eff(false, 'Subvention', '0,012 % du PIB/jour')]
        : p.mode === 'slow'
          ? [eff(false, 'Production', '-12 %'), eff(true, 'Économie', '0,006 % du PIB/jour')]
          : [eff(true, 'Production', 'normale')],
    };
  },
};

const buyFromCountry: ActionDef<Extract<ActionParams, { type: 'buy_from_country' }>> = {
  type: 'buy_from_country',
  label: 'Acheter des ressources à un pays',
  category: 'commerce',
  cooldownDays: 0,
  validate: (w, c, p) => {
    const seller = w.country(p.sellerId);
    if (!seller || seller.id === c.id) return 'Vendeur invalide';
    if (seller.controller.kind === 'player') return 'Ce pays est dirigé par un joueur : achetez plutôt ses offres de vente (onglet Ressources)';
    if (!RESOURCE_MAP[p.resource]) return 'Ressource inconnue';
    if (!Number.isFinite(p.units) || p.units <= 0) return 'Quantité invalide';
    const rel = c.relations[seller.id];
    if (!rel) return 'Relations inexistantes';
    if (rel.sanctionByUs || rel.sanctionByThem || seller.relations[c.id]?.sanctionByUs || seller.relations[c.id]?.sanctionByThem) {
      return 'Mesure économique active : échanges impossibles';
    }
    if (rel.score < 30 && !rel.agreements.some((a) => a.status === 'active')) return 'Relations insuffisantes (30) pour un achat bilatéral';
    const sr = seller.resources[p.resource];
    const available = Math.max(0, Math.min(sr.stock - sr.capacity * 0.35, sr.stock * 0.4));
    if (p.units > available) return `${seller.name} ne peut pas vendre plus de ${Math.floor(available)} unités (marge de sécurité)`;
    const br = c.resources[p.resource];
    if (p.units > br.capacity - br.stock) return `Vos entrepôts sont pleins (max ${Math.floor(br.capacity - br.stock)} unités)`;
    const cost = round(p.units * sr.price * BILATERAL_PREMIUM * VALUE_SCALE * 1000, 2);
    if (c.economy.cash < cost) return `Trésorerie insuffisante : ${cost.toFixed(1)} Md € requis`;
    return null;
  },
  estimate: (w, c, p) => {
    const seller = w.country(p.sellerId);
    if (!seller) return [];
    const sr = seller.resources[p.resource];
    const cost = round(p.units * sr.price * BILATERAL_PREMIUM * VALUE_SCALE * 1000, 2);
    const world = w.market[p.resource]?.price ?? sr.price;
    return [
      eff(false, 'Coût total', `${cost.toFixed(2)} Md € (trésorerie)`),
      eff(true, `Stock ${RESOURCE_MAP[p.resource].name}`, `+${Math.round(p.units)} unités`),
      eff(false, 'Prime bilatérale', `prix du vendeur +${Math.round((BILATERAL_PREMIUM - 1) * 100)} % (${sr.price.toFixed(2)} vs mondial ${world.toFixed(2)})`),
      eff(true, 'Relations', `+0,2 avec ${seller.name} (contact commercial)`),
      eff(true, 'Vendeur', `${seller.name} encaisse ${cost.toFixed(2)} Md €`),
    ];
  },
  apply: (w, c, p, ctx) => {
    const seller = w.country(p.sellerId)!;
    const sr = seller.resources[p.resource];
    const br = c.resources[p.resource];
    const cost = round(p.units * sr.price * BILATERAL_PREMIUM * VALUE_SCALE * 1000, 2);
    c.economy.cash = round(c.economy.cash - cost, 2);
    seller.economy.cash = round(seller.economy.cash + cost, 2); // → trésorerie du vendeur, automatique
    sr.stock = round(Math.max(0, sr.stock - p.units), 1);
    br.stock = round(Math.min(br.capacity, br.stock + p.units), 1);
    const rel = c.relations[seller.id]!;
    const srel = seller.relations[c.id]!;
    rel.tradeVolume = round(rel.tradeVolume * 0.85 + cost, 3);
    srel.tradeVolume = rel.tradeVolume;
    rel.score = clamp(rel.score + 0.2, 0, 100);
    srel.score = rel.score;
    rel.lastContactDay = w.meta.day;
    srel.lastContactDay = w.meta.day;
    w.markDirty(seller.id);
    w.addTransaction({
      day: w.meta.day, fromId: seller.id, toId: c.id, resource: p.resource,
      units: round(p.units, 1), value: cost, kind: 'deal',
      note: `Achat bilatéral à ${seller.name} (prime ${Math.round((BILATERAL_PREMIUM - 1) * 100)} %)`,
    });
    w.addJournal({
      day: w.meta.day, type: 'trade', countryIds: [c.id, seller.id], actor: ctx.actor.name,
      text: `${c.name} achète ${Math.round(p.units)} unités de ${RESOURCE_MAP[p.resource].name.toLowerCase()} à ${seller.name} pour ${cost.toFixed(2)} Md €.`,
    });
    return {
      ok: true,
      message: `✓ Achat à ${seller.name} : +${Math.round(p.units)} u, -${cost.toFixed(2)} Md €`,
      effects: [
        eff(true, 'Stock livré', `+${Math.round(p.units)} unités`),
        eff(false, 'Trésorerie', `-${cost.toFixed(2)} Md €`),
        eff(true, 'Relations', '+0,2'),
      ],
      bigWin: cost >= BIG_WIN_THRESHOLD ? { countryId: seller.id, amount: cost, source: `Achat bilatéral de ${c.name}` } : undefined,
    };
  },
};

const createOffer: ActionDef<Extract<ActionParams, { type: 'create_offer' }>> = {
  type: 'create_offer',
  label: 'Publier une offre de vente',
  category: 'commerce',
  cooldownDays: 0,
  validate: (w, c, p) => {
    if (!RESOURCE_MAP[p.resource]) return 'Ressource inconnue';
    if (!Number.isFinite(p.units) || p.units <= 0) return 'Quantité invalide';
    if (!Number.isFinite(p.unitPrice) || p.unitPrice <= 0) return 'Prix unitaire invalide';
    const base = RESOURCE_MAP[p.resource].basePrice;
    if (p.unitPrice < base * 0.35 || p.unitPrice > base * 5) {
      return `Prix unitaire hors marché : entre ${(base * 0.35).toFixed(2)} et ${(base * 5).toFixed(2)} Md €/unité`;
    }
    const r = c.resources[p.resource];
    if (p.units > r.stock * 0.4) return `Réserve insuffisante : une offre immobilise au max 40 % du stock (${Math.floor(r.stock * 0.4)} unités)`;
    const mine = w.offers.filter((o) => o.sellerId === c.id && o.status === 'open').length;
    if (mine >= 4) return 'Maximum 4 offres ouvertes simultanément';
    return null;
  },
  estimate: (w, c, p) => {
    const world = w.market[p.resource]?.price ?? RESOURCE_MAP[p.resource].basePrice;
    const value = round(p.units * p.unitPrice * VALUE_SCALE * 1000, 2);
    const ratio = world > 0 ? p.unitPrice / world : 1;
    return [
      eff(true, 'Lot mis en vente', `${Math.round(p.units)} unités de ${RESOURCE_MAP[p.resource].name}`),
      eff(true, 'Recette si vendu', `${value.toFixed(2)} Md € → trésorerie`),
      eff(ratio <= 1.02, 'Prix vs marché mondial', `${p.unitPrice.toFixed(2)} (${ratio <= 0.95 ? 'attractif' : ratio <= 1.05 ? 'aligné' : 'au-dessus'}) — mondial ${world.toFixed(2)}`),
      eff(false, 'Expiration', '14 jours de jeu si invendu'),
      eff(true, 'Acheteurs', 'les IA achètent automatiquement si votre prix est compétitif'),
    ];
  },
  apply: (w, c, p, ctx) => {
    const offer: import('shared').TradeOffer = {
      id: uid('off'),
      sellerId: c.id,
      resource: p.resource,
      units: round(p.units, 1),
      unitPrice: round(p.unitPrice, 3),
      createdDay: w.meta.day,
      expiresDay: w.meta.day + 14,
      status: 'open',
    };
    w.addOffer(offer);
    // Annonce publique au journal mondial (joueurs ET IA) : le marché
    // inter-états est visible de tous, comme demandé.
    w.addJournal({
      day: w.meta.day, type: 'trade', countryIds: [c.id], actor: ctx.actor.name,
      text: `📢 ANNONCE — ${c.name} met en vente ${Math.round(p.units)} unités de ${RESOURCE_MAP[p.resource].name.toLowerCase()} à ${p.unitPrice.toFixed(2)} Md €/unité sur le marché inter-états.`,
    });
    return {
      ok: true,
      message: `✓ Offre publiée (expire au jour ${offer.expiresDay})`,
      effects: [eff(true, 'Offre', `${Math.round(p.units)} u à ${p.unitPrice.toFixed(2)} Md €/u`)],
    };
  },
};

const cancelOffer: ActionDef<Extract<ActionParams, { type: 'cancel_offer' }>> = {
  type: 'cancel_offer',
  label: 'Retirer une offre de vente',
  category: 'commerce',
  cooldownDays: 0,
  validate: (w, c, p) => {
    const o = w.offer(p.offerId);
    if (!o || o.status !== 'open') return 'Offre introuvable ou déjà close';
    if (o.sellerId !== c.id) return 'Cette offre appartient à un autre pays';
    return null;
  },
  estimate: () => [eff(true, 'Offre', 'retirée du marché inter-états')],
  apply: (w, c, p, ctx) => {
    const o = w.offer(p.offerId)!;
    w.closeOffer(o.id, 'cancelled');
    w.addJournal({
      day: w.meta.day, type: 'trade', countryIds: [c.id], actor: ctx.actor.name,
      text: `${c.name} retire son offre de ${Math.round(o.units)} unités de ${RESOURCE_MAP[o.resource].name.toLowerCase()}.`,
    });
    return { ok: true, message: '✓ Offre retirée' };
  },
};

const buyOffer: ActionDef<Extract<ActionParams, { type: 'buy_offer' }>> = {
  type: 'buy_offer',
  label: 'Acheter une offre de vente',
  category: 'commerce',
  cooldownDays: 0,
  validate: (w, c, p) => {
    const o = w.offer(p.offerId);
    if (!o || o.status !== 'open') return 'Offre introuvable ou déjà close';
    if (w.meta.day > o.expiresDay) return 'Offre expirée';
    if (o.sellerId === c.id) return 'Vous ne pouvez pas acheter votre propre offre';
    const seller = w.country(o.sellerId);
    if (!seller) return 'Vendeur introuvable';
    const rel = c.relations[o.sellerId];
    if (rel && (rel.sanctionByUs || rel.sanctionByThem)) return 'Mesure économique active : achat impossible';
    if (rel && rel.score < 30 && !rel.agreements.some((a) => a.status === 'active')) return 'Relations insuffisantes (30) avec le vendeur';
    const sr = seller.resources[o.resource];
    if (sr.stock < o.units) return `Le vendeur n'a plus le stock (${sr.stock.toFixed(0)}/${o.units} unités) — offre caduque`;
    const br = c.resources[o.resource];
    if (o.units > br.capacity - br.stock) return `Vos entrepôts sont pleins (max ${Math.floor(br.capacity - br.stock)} unités)`;
    const cost = round(o.units * o.unitPrice * VALUE_SCALE * 1000, 2);
    if (c.economy.cash < cost) return `Trésorerie insuffisante : ${cost.toFixed(2)} Md € requis`;
    return null;
  },
  estimate: (w, c, p) => {
    const o = w.offer(p.offerId);
    if (!o) return [];
    const seller = w.country(o.sellerId);
    const cost = round(o.units * o.unitPrice * VALUE_SCALE * 1000, 2);
    return [
      eff(false, 'Coût total', `${cost.toFixed(2)} Md € (trésorerie)`),
      eff(true, 'Lot reçu', `${Math.round(o.units)} unités de ${RESOURCE_MAP[o.resource].name}`),
      eff(true, 'Vendeur', `${seller?.name ?? o.sellerId} encaisse automatiquement`),
    ];
  },
  apply: (w, c, p, ctx) => {
    const o = w.offer(p.offerId)!;
    const seller = w.country(o.sellerId)!;
    const cost = round(o.units * o.unitPrice * VALUE_SCALE * 1000, 2);
    c.economy.cash = round(c.economy.cash - cost, 2);
    seller.economy.cash = round(seller.economy.cash + cost, 2); // → trésorerie du vendeur
    seller.resources[o.resource].stock = round(Math.max(0, seller.resources[o.resource].stock - o.units), 1);
    c.resources[o.resource].stock = round(Math.min(c.resources[o.resource].capacity, c.resources[o.resource].stock + o.units), 1);
    const rel = c.relations[o.sellerId];
    const srel = seller.relations[c.id];
    if (rel) { rel.tradeVolume = round(rel.tradeVolume * 0.85 + cost, 3); rel.score = clamp(rel.score + 0.2, 0, 100); }
    if (srel) { srel.tradeVolume = rel?.tradeVolume ?? srel.tradeVolume; srel.score = rel?.score ?? srel.score; }
    w.closeOffer(o.id, 'sold', c.id);
    w.markDirty(seller.id);
    w.addTransaction({
      day: w.meta.day, fromId: seller.id, toId: c.id, resource: o.resource,
      units: round(o.units, 1), value: cost, kind: 'deal',
      note: `Offre d'achat à ${seller.name}`,
    });
    if (ctx.actor.kind !== 'ai' || seller.controller.kind === 'player') {
      w.addJournal({
        day: w.meta.day, type: 'trade', countryIds: [c.id, seller.id], actor: ctx.actor.name,
        text: `${c.name} achète le lot de ${Math.round(o.units)} unités de ${RESOURCE_MAP[o.resource].name.toLowerCase()} mis en vente par ${seller.name} (${cost.toFixed(2)} Md €).`,
      });
    }
    if (seller.controller.kind === 'player' && seller.controller.userId && ctx.notify) {
      void ctx.notify(seller.controller.userId, {
        type: 'trade', title: 'Offre vendue !',
        body: `${c.name} a acheté votre lot de ${Math.round(o.units)} unités de ${RESOURCE_MAP[o.resource].name} : +${cost.toFixed(2)} Md € dans votre trésorerie.`,
        day: w.meta.day,
      });
    }
    return {
      ok: true,
      message: `✓ Lot acheté à ${seller.name} : -${cost.toFixed(2)} Md €`,
      effects: [
        eff(true, 'Stock reçu', `+${Math.round(o.units)} unités`),
        eff(false, 'Trésorerie', `-${cost.toFixed(2)} Md €`),
      ],
      bigWin: cost >= BIG_WIN_THRESHOLD ? { countryId: seller.id, amount: cost, source: `Offre achetée par ${c.name}` } : undefined,
    };
  },
};


const buildFacility: ActionDef<Extract<ActionParams, { type: 'build_facility' }>> = {
  type: 'build_facility',
  label: 'Construire un bâtiment de production',
  category: 'commerce',
  cooldownDays: 1,
  validate: (w, c, p) => {
    const def = FACILITY_MAP[p.facility];
    if (!def) return 'Bâtiment inconnu';
    if (!Number.isInteger(p.count) || p.count < 1 || p.count > 5) return 'Quantité invalide (1 à 5 par commande)';
    const st = c.facilities?.[p.facility] ?? { owned: 0, queue: [] };
    const queued = st.queue.reduce((s, q) => s + q.count, 0);
    if (st.owned + queued + p.count > def.maxOwned) {
      return `Plafond atteint pour « ${def.name} » : ${def.maxOwned} maximum (possédés ${st.owned}, en construction ${queued})`;
    }
    const cost = round(def.cost * p.count, 2);
    if (c.economy.cash < cost) return `Trésorerie insuffisante : ${cost.toFixed(1)} Md € requis`;
    void w;
    return null;
  },
  estimate: (w, c, p) => {
    const def = FACILITY_MAP[p.facility];
    if (!def) return [];
    const scale = facilityScale(c.population);
    const out = def.outputPerDay * p.count * scale;
    const up = def.upkeepPerDay * p.count;
    return [
      eff(false, 'Coût immédiat (trésorerie)', `-${(def.cost * p.count).toFixed(1)} Md €`),
      eff(true, `Production ${RESOURCE_MAP[def.resource].name}`, `+${out.toFixed(1)} unités/jour dès la livraison (jour ${w.meta.day + def.buildDays})`),
      eff(false, 'Entretien', `${up.toFixed(3)} Md €/jour`),
      eff(true, 'Rendement à l\'export', `≈ ${(out * (w.market[def.resource]?.price ?? RESOURCE_MAP[def.resource].basePrice) * 0.045).toFixed(2)} Md €/jour si tout est exporté`),
    ];
  },
  apply: (w, c, p, ctx) => {
    const def = FACILITY_MAP[p.facility];
    const cost = round(def.cost * p.count, 2);
    c.economy.cash = round(c.economy.cash - cost, 2);
    if (!c.facilities) c.facilities = {} as Country['facilities'];
    if (!c.facilities[p.facility]) c.facilities[p.facility] = { owned: 0, queue: [] };
    c.facilities[p.facility].queue.push({ count: p.count, readyDay: w.meta.day + def.buildDays });
    w.markDirty(c.id);
    w.addJournal({
      day: w.meta.day, type: 'infrastructure', countryIds: [c.id], actor: ctx.actor.name,
      text: `${c.name} lance la construction de ${p.count > 1 ? `${p.count} × ` : ''}« ${def.name} » (${cost.toFixed(1)} Md €, livraison au jour ${w.meta.day + def.buildDays}).`,
    });
    return {
      ok: true,
      message: `✓ ${def.name} en construction (livraison J${w.meta.day + def.buildDays})`,
      effects: [
        eff(false, 'Trésorerie', `-${cost.toFixed(1)} Md €`),
        eff(true, 'Production', `+${(def.outputPerDay * p.count * facilityScale(c.population)).toFixed(1)} ${RESOURCE_MAP[def.resource].unit}/jour`),
        eff(false, 'Entretien', `${(def.upkeepPerDay * p.count).toFixed(3)} Md €/jour`),
      ],
    };
  },
};


const changeRegime: ActionDef<Extract<ActionParams, { type: 'change_regime' }>> = {
  type: 'change_regime',
  label: 'Changer de régime politique',
  category: 'politique',
  cooldownDays: REGIME_CHANGE_COOLDOWN_DAYS,
  validate: (w, c, p) => {
    const def = REGIME_MAP[p.regime];
    if (!def) return 'Régime inconnu';
    if (p.regime === c.regime) return 'Ce régime est déjà en place';
    if (c.stability < 25) return 'Stabilité trop faible (< 25) : une transition tournerait à la crise';
    void w;
    return null;
  },
  estimate: (w, c, p) => {
    const def = REGIME_MAP[p.regime];
    if (!def) return [];
    const alignNew = regimeAlignment(c, p.regime);
    const alignOld = regimeAlignment(c, c.regime);
    const quality = alignNew - alignOld;
    const popNow = Math.round(clamp(quality * 10, -8, 12));
    const stabCost = Math.round(5 + Math.max(0, -quality) * 6);
    return [
      eff(alignNew >= 0.5, 'Volonté du peuple', `alignement ${Math.round(alignNew * 100)} % (actuel ${Math.round(alignOld * 100)} %)`),
      eff(popNow >= 0, 'Popularité immédiate', `${popNow >= 0 ? '+' : ''}${popNow} points`),
      eff(false, 'Stabilité immédiate', `-${stabCost} points (transition)`),
      eff(def.effects.growthDelta >= 0, 'Croissance permanente', `${def.effects.growthDelta >= 0 ? '+' : ''}${def.effects.growthDelta.toFixed(2)} pt`, ),
      eff(def.effects.revenueMul >= 1, 'Recettes fiscales', `×${def.effects.revenueMul.toFixed(2)}`),
      eff(def.effects.popularityDaily >= 0, 'Opinion quotidienne', `${def.effects.popularityDaily >= 0 ? '+' : ''}${def.effects.popularityDaily.toFixed(3)}/j`),
      eff(quality > 0.05, 'Lune de miel (30 j)', quality > 0.05 ? `+${(quality * 0.12).toFixed(2)} pop/j et +${(quality * 0.9).toFixed(2)} croissance` : quality < -0.05 ? `gueule de bois : ${(quality * 0.12).toFixed(2)} pop/j, ${(quality * 0.9).toFixed(2)} croissance` : 'neutre'),
    ];
  },
  apply: (w, c, p, ctx) => {
    const def = REGIME_MAP[p.regime];
    const day = w.meta.day;
    const alignNew = regimeAlignment(c, p.regime);
    const alignOld = regimeAlignment(c, c.regime);
    const quality = alignNew - alignOld;
    const popNow = round(clamp(quality * 10, -8, 12), 1);
    const stabCost = round(5 + Math.max(0, -quality) * 6, 1);
    const ancien = c.regime;
    c.regime = p.regime;
    c.regimeSinceDay = day;
    c.popularity = round(clamp(c.popularity + popNow, 0, 100), 2);
    c.stability = round(clamp(c.stability - stabCost, 0, 100), 2);
    c.regimeHoneymoon = Math.abs(quality) > 0.05
      ? {
          untilDay: day + REGIME_HONEYMOON_DAYS,
          popularityDaily: round(quality * 0.12, 3),
          growthDelta: round(quality * 0.9, 2),
        }
      : null;
    w.markDirty(c.id);
    w.addJournal({
      day, type: 'politics', countryIds: [c.id], actor: ctx.actor.name,
      text: `🏛️ ${c.name} change de régime : ${ancien} → ${p.regime}. Alignement avec le peuple : ${Math.round(alignNew * 100)} % (${quality >= 0 ? 'lune de miel' : 'transition contestée'}).`,
    });
    if (c.controller.kind === 'player' && c.controller.userId && ctx.notify) {
      void ctx.notify(c.controller.userId, {
        type: 'mandate', title: 'Nouveau régime proclamé',
        body: `${p.regime} : alignement ${Math.round(alignNew * 100)} % avec les revendications du peuple. ${quality > 0.05 ? 'Lune de miel : boosts de popularité et croissance pendant 30 jours.' : quality < -0.05 ? 'Le peuple conteste : malus temporaires pendant 30 jours.' : 'Transition neutre.'}`,
        day,
      });
    }
    return {
      ok: true,
      message: `✓ ${p.regime} proclamé`,
      effects: [
        eff(popNow >= 0, 'Popularité', `${popNow >= 0 ? '+' : ''}${popNow} pts`),
        eff(false, 'Stabilité', `-${stabCost} pts`),
        eff(true, 'Effets permanents', `${def.effects.growthDelta >= 0 ? '+' : ''}${def.effects.growthDelta} croissance, recettes ×${def.effects.revenueMul}`),
      ],
    };
  },
};

/* ------------------------------------------------------------------ */
/* Registre + exécution                                                */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY = new Map<string, ActionDef<any>>();
for (const def of [
  setTax, setCorporateTax, setTariff, setInterestRate, setSpending,
  startProject, cancelProject, enactLaw, repealLaw,
  proposeAgreement, respondProposal, improveRelations, sendAid,
  imposeSanction, liftSanction, buyResource,
  buyCorridor, abandonCorridor, setToll, shipGoods, respondDelivery, breakAgreement, setRoute,
  setProduction, buyFromCountry, createOffer, cancelOffer, buyOffer, buildFacility, changeRegime,
] as ActionDef[]) {
  REGISTRY.set(def.type, def);
}

export function getActionDef(type: string): ActionDef | undefined {
  return REGISTRY.get(type);
}

export function allActionTypes(): string[] {
  return [...REGISTRY.keys()];
}

export interface ExecutionResult extends ActionResult {
  version?: number;
}

/** Point d'entrée unique : validate → estimate → apply → journal → dirty. */
export function executeAction(
  world: WorldStore,
  countryId: string,
  params: ActionParams,
  ctx: ActionContext,
): ExecutionResult {
  const c = world.country(countryId);
  if (!c) return { ok: false, error: 'Pays introuvable' };
  const def = REGISTRY.get(params.type) as ActionDef | undefined;
  if (!def) return { ok: false, error: `Action inconnue : ${params.type}` };

  const cd = checkCooldown(c, params, world.meta.day);
  if (cd) return { ok: false, error: cd };

  const validationError = def.validate(world, c, params, ctx);
  if (validationError) {
    log.debug(`Action rejetée (${params.type}) pour ${countryId} : ${validationError}`);
    return { ok: false, error: validationError };
  }

  const before = def.estimate(world, c, params);
  const result = def.apply(world, c, params, ctx);
  if (result.ok) {
    setCooldown(c, params, world.meta.day, def.cooldownDays);
    world.touch(c.id);
    result.effects = result.effects ?? before;
    if (result.bigWin && ctx.onBigWin) ctx.onBigWin(result.bigWin);
    log.info(
      `[${ctx.actor.kind.toUpperCase()}] ${c.name} → ${params.type}` +
        (ctx.actor.kind === 'ai' ? '' : ` par ${ctx.actor.name}`),
    );
  }
  return { ...result, version: world.version };
}

/** Estimation sans application (aperçu avant confirmation, côté serveur). */
export function estimateAction(
  world: WorldStore,
  countryId: string,
  params: ActionParams,
): { ok: boolean; error?: string; effects?: ActionEstimate[] } {
  const c = world.country(countryId);
  if (!c) return { ok: false, error: 'Pays introuvable' };
  const def = REGISTRY.get(params.type) as ActionDef | undefined;
  if (!def) return { ok: false, error: `Action inconnue : ${params.type}` };
  const cd = checkCooldown(c, params, world.meta.day);
  if (cd) return { ok: false, error: cd };
  const validationError = def.validate(world, c, params, { world, actor: { kind: 'player', name: 'preview' } });
  if (validationError) return { ok: false, error: validationError };
  return { ok: true, effects: def.estimate(world, c, params) };
}
