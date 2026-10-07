/**
 * GEOPOLIS — Constantes partagées : catalogues de ressources, infrastructures,
 * lois, événements, accords. Utilisés par le moteur ET l'interface.
 */
import type {
  AgreementType,
  Country,
  FacilityKey,
  FacilityState,
  InfraKey,
  RegimeType,
  ResourceKey,
  SectorKey,
  SpendingKey,
} from './types.js';

export const SIM_VERSION = '1.12.0';

/** 1 tick réel = 1 jour de jeu. Par défaut : 10 MINUTES réelles = 1 jour de jeu
 *  (progression volontairement lente — le monde est persistant et tourne 24h/24). */
const globalEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const envTick = globalEnv ? globalEnv['TICK_MS'] : undefined;
export const TICK_MS = Number(envTick ?? 600000) || 600000;
/** Rattrapage après arrêt du serveur : 144 ticks max (= 24 h réelles à 10 min/jour).
 *  Au-delà, le monde reprend simplement là où il en est (evite un gel au demarrage). */
export const MAX_CATCHUP_TICKS = 144;

/** Cooldown RÉEL (ms) avant de pouvoir reprendre un pays après en avoir quitté
 *  un (départ volontaire ou expulsion admin) : 4 jours réels — anti-abus. */
export const COUNTRY_JOIN_COOLDOWN_MS = 4 * 24 * 60 * 60 * 1000;

/** Livraisons exceptionnelles : jours de jeu laissés au destinataire pour
 *  accepter/refuser. Passé ce délai, la marchandise retourne à l'expéditeur. */
export const DELIVERY_RESPONSE_DAYS = 3;

/** Nombre maximal de livraisons exceptionnelles en attente par expéditeur. */
export const MAX_OPEN_DELIVERIES_PER_SENDER = 3;

/** Seuil (Md €) d'un gain commercial unique déclenchant la célébration
 *  « gain exceptionnel » chez le joueur humain qui encaisse. */
export const BIG_WIN_THRESHOLD = 10;

export const RESOURCES: {
  key: ResourceKey;
  name: string;
  short: string;
  unit: string;
  basePrice: number;
  color: string;
}[] = [
  { key: 'food', name: 'Alimentation', short: 'ALIM', unit: 'kt', basePrice: 1.0, color: '#7ecf8e' },
  { key: 'energy', name: 'Énergie', short: 'ÉNER', unit: 'TWh', basePrice: 1.4, color: '#f2c14e' },
  { key: 'oil', name: 'Pétrole', short: 'PÉTR', unit: 'kb', basePrice: 1.6, color: '#c98f5a' },
  { key: 'gas', name: 'Gaz', short: 'GAZ', unit: 'Mm³', basePrice: 1.3, color: '#e0a458' },
  { key: 'minerals', name: 'Minerais', short: 'MINE', unit: 'kt', basePrice: 1.1, color: '#9aa7b5' },
  { key: 'materials', name: 'Matières premières', short: 'MAT', unit: 'kt', basePrice: 1.0, color: '#b58bc9' },
  { key: 'industrial', name: 'Biens industriels', short: 'IND', unit: 'kt', basePrice: 2.2, color: '#6fa8dc' },
  { key: 'tech', name: 'Technologie', short: 'TECH', unit: 'ku', basePrice: 4.5, color: '#c56fd8' },
];

export const RESOURCE_KEYS: ResourceKey[] = RESOURCES.map((r) => r.key);
export const RESOURCE_MAP: Record<ResourceKey, (typeof RESOURCES)[number]> = Object.fromEntries(
  RESOURCES.map((r) => [r.key, r]),
) as Record<ResourceKey, (typeof RESOURCES)[number]>;

export const SECTORS: { key: SectorKey; name: string }[] = [
  { key: 'agriculture', name: 'Agriculture' },
  { key: 'industry', name: 'Industrie' },
  { key: 'energy', name: 'Énergie' },
  { key: 'services', name: 'Services' },
  { key: 'tech', name: 'Technologie' },
];

export const SPENDING_SECTORS: {
  key: SpendingKey;
  name: string;
  description: string;
  min: number;
  max: number;
}[] = [
  { key: 'health', name: 'Santé', description: 'Hôpitaux, soins, espérance de vie', min: 0, max: 8 },
  { key: 'education', name: 'Éducation', description: 'Écoles, universités, productivité future', min: 0, max: 8 },
  { key: 'transport', name: 'Transports', description: 'Routes, rail, ports, logistique', min: 0, max: 6 },
  { key: 'energy', name: 'Énergie', description: 'Réseau électrique, centrales', min: 0, max: 6 },
  { key: 'industry', name: 'Industrie', description: 'Capacité industrielle, emploi', min: 0, max: 6 },
  { key: 'agriculture', name: 'Agriculture', description: 'Sécurité alimentaire, subventions', min: 0, max: 5 },
  { key: 'research', name: 'Recherche', description: 'Innovation, technologie', min: 0, max: 5 },
  { key: 'social', name: 'Social', description: 'Aides sociales, paix sociale', min: 0, max: 8 },
];

export interface InfraBoost {
  icon: string;
  label: string;   // effet par niveau, tel que réellement appliqué par le moteur
}

export interface InfraDef {
  key: InfraKey;
  name: string;
  baseCost: number;       // Md € par niveau (multiplié par la taille du pays)
  buildDays: number;
  upkeepPerLevel: number; // Md € / an par niveau (pour un pays de taille moyenne)
  maxLevel: number;
  effect: string;
  category: 'transport' | 'energie' | 'societe' | 'economie' | 'environnement';
  boosts: InfraBoost[];   // effets RÉELS par niveau (appliqués par le moteur)
}

export const INFRA: InfraDef[] = [
  { key: 'roads', name: 'Réseau routier', baseCost: 12, buildDays: 20, upkeepPerLevel: 0.5, maxLevel: 10, category: 'transport',
    effect: '+4 % logistique, −1,5 % congestion par niveau',
    boosts: [ { icon: '🚚', label: 'Logistique +1,2 %/niv (volume commercial)' }, { icon: '🏭', label: 'Productivité +0,4 %/niv' } ] },
  { key: 'rail', name: 'Réseau ferroviaire', baseCost: 18, buildDays: 26, upkeepPerLevel: 0.7, maxLevel: 10, category: 'transport',
    effect: '+6 % efficacité logistique, +3 % commerce intérieur par niveau',
    boosts: [ { icon: '🚆', label: 'Logistique +1,2 %/niv' }, { icon: '🏭', label: 'Capacité industrielle +0,8 %/niv' } ] },
  { key: 'ports', name: 'Ports industriels', baseCost: 15, buildDays: 22, upkeepPerLevel: 0.5, maxLevel: 10, category: 'transport',
    effect: '+8 % capacité d’export/import par niveau',
    boosts: [ { icon: '⚓', label: 'Logistique +1,8 %/niv' }, { icon: '🌍', label: 'Capacité d’export +1 %/niv' }, { icon: '🏭', label: 'Industrie +0,6 %/niv' } ] },
  { key: 'logistics', name: 'Réseaux logistiques', baseCost: 14, buildDays: 20, upkeepPerLevel: 0.5, maxLevel: 10, category: 'transport',
    effect: '+5 % volume commercial par niveau, −2 % pertes',
    boosts: [ { icon: '📦', label: 'Logistique +1,2 %/niv' }, { icon: '🧊', label: 'Pertes de fret réduites' } ] },
  { key: 'airports', name: 'Aéroports internationaux', baseCost: 26, buildDays: 30, upkeepPerLevel: 0.9, maxLevel: 10, category: 'transport',
    effect: '+6 % capacité d’export et tourisme par niveau',
    boosts: [ { icon: '✈️', label: 'Capacité d’export +6 %/niv' }, { icon: '🧳', label: 'Volume commercial +1 %/niv' } ] },
  { key: 'powerGrid', name: 'Réseau électrique', baseCost: 14, buildDays: 20, upkeepPerLevel: 0.6, maxLevel: 10, category: 'energie',
    effect: '+5 % distribution énergétique par niveau',
    boosts: [ { icon: '🔌', label: 'Distribution énergétique +1 %/niv' }, { icon: '🏭', label: 'Productivité +0,4 %/niv' } ] },
  { key: 'plants', name: 'Centrales énergétiques', baseCost: 22, buildDays: 30, upkeepPerLevel: 0.9, maxLevel: 10, category: 'energie',
    effect: '+7 % production d’énergie par niveau',
    boosts: [ { icon: '🔋', label: 'Production d’énergie +1,4 %/niv' }, { icon: '🛡️', label: 'Moins de pénuries énergétiques' } ] },
  { key: 'housing', name: 'Logements', baseCost: 16, buildDays: 24, upkeepPerLevel: 0.3, maxLevel: 10, category: 'societe',
    effect: '+2 niveau de vie par niveau, soutient la démographie',
    boosts: [ { icon: '🏠', label: 'Niveau de vie +2/niv' }, { icon: '👥', label: 'Services +0,5/niv' } ] },
  { key: 'schools', name: 'Écoles', baseCost: 10, buildDays: 18, upkeepPerLevel: 0.5, maxLevel: 10, category: 'societe',
    effect: '+2 % productivité long terme par niveau',
    boosts: [ { icon: '🎓', label: 'Productivité +0,6 %/niv' }, { icon: '👥', label: 'Services +0,4/niv' } ] },
  { key: 'universities', name: 'Universités', baseCost: 20, buildDays: 30, upkeepPerLevel: 0.8, maxLevel: 10, category: 'societe',
    effect: '+4 % capacité technologique par niveau',
    boosts: [ { icon: '🎓', label: 'Productivité +0,8 %/niv' }, { icon: '💻', label: 'Technologie +1,2 %/niv' } ] },
  { key: 'hospitals', name: 'Hôpitaux', baseCost: 18, buildDays: 26, upkeepPerLevel: 0.8, maxLevel: 10, category: 'societe',
    effect: '+2 santé publique, +1 popularité/niveau (plafond)',
    boosts: [ { icon: '🏥', label: 'Santé publique +2/niv' }, { icon: '👥', label: 'Services +0,6/niv' } ] },
  { key: 'culture', name: 'Patrimoine & culture', baseCost: 12, buildDays: 20, upkeepPerLevel: 0.4, maxLevel: 10, category: 'societe',
    effect: '+0,01 popularité et +0,008 stabilité par jour par niveau',
    boosts: [ { icon: '🎭', label: 'Popularité +0,01/jour/niv' }, { icon: '🕊️', label: 'Stabilité +0,008/jour/niv' } ] },
  { key: 'industrialZones', name: 'Zones industrielles', baseCost: 24, buildDays: 28, upkeepPerLevel: 0.7, maxLevel: 10, category: 'economie',
    effect: '+6 % capacité industrielle par niveau',
    boosts: [ { icon: '🏭', label: 'Capacité industrielle +2 %/niv' }, { icon: '💼', label: 'Emploi industriel soutenu' } ] },
  { key: 'techHubs', name: 'Pôles technologiques', baseCost: 26, buildDays: 32, upkeepPerLevel: 0.9, maxLevel: 10, category: 'economie',
    effect: '+5 % production technologique par niveau',
    boosts: [ { icon: '💻', label: 'Production tech +1,8 %/niv' }, { icon: '🚀', label: 'Exports technologiques' } ] },
  { key: 'telecom', name: 'Réseau télécom & fibre', baseCost: 20, buildDays: 26, upkeepPerLevel: 0.7, maxLevel: 10, category: 'economie',
    effect: '+1,2 % productivité et +2 % secteur tech par niveau',
    boosts: [ { icon: '📡', label: 'Productivité +1,2 %/niv' }, { icon: '💻', label: 'Secteur technologique +2 %/niv' } ] },
  { key: 'research', name: 'Centres de recherche', baseCost: 28, buildDays: 34, upkeepPerLevel: 1.0, maxLevel: 10, category: 'economie',
    effect: '+0,05 pt de croissance potentielle et +2 % tech par niveau',
    boosts: [ { icon: '🔬', label: 'Croissance potentielle +0,05 pt/niv' }, { icon: '💻', label: 'Production tech +2 %/niv' } ] },
  { key: 'finance', name: 'Place financière', baseCost: 24, buildDays: 28, upkeepPerLevel: 0.8, maxLevel: 10, category: 'economie',
    effect: '−0,15 pt de taux d’intérêt de la dette et +1,5 % recettes par niveau',
    boosts: [ { icon: '🏦', label: 'Taux d’intérêt de la dette −0,15 pt/niv' }, { icon: '💰', label: 'Recettes fiscales +1,5 %/niv' } ] },
  { key: 'water', name: 'Hydraulique & irrigation', baseCost: 14, buildDays: 22, upkeepPerLevel: 0.5, maxLevel: 10, category: 'environnement',
    effect: '+3 % production agricole et résistance aux sécheresses par niveau',
    boosts: [ { icon: '💧', label: 'Production agricole +3 %/niv' }, { icon: '🛡️', label: 'Pénuries alimentaires atténuées' } ] },
];

export const INFRA_MAP: Record<InfraKey, (typeof INFRA)[number]> = Object.fromEntries(
  INFRA.map((i) => [i.key, i]),
) as Record<InfraKey, (typeof INFRA)[number]>;

export const AGREEMENT_TYPES: { type: AgreementType; name: string; description: string }[] = [
  { type: 'free_trade', name: 'Accord de libre-échange', description: 'Réduit les tarifs douaniers bilatéraux de 60 % et augmente fortement les volumes échangés.' },
  { type: 'economic_treaty', name: 'Traité économique', description: 'Coopération économique durable : +relations, +investissement croisé, croissance partagée.' },
  { type: 'tech_cooperation', name: 'Coopération technologique', description: 'Partage de savoir-faire : +productivité technologique pour les deux partenaires.' },
  { type: 'trade_zone', name: 'Zone commerciale', description: 'Zone d’échanges privilégiée : routes commerciales prioritaires et tarifs réduits.' },
  { type: 'aid_pact', name: 'Pacte d’aide', description: 'Aide au développement : renforce la confiance et la stabilité du partenaire.' },
];

export interface LawDef {
  id: string;
  name: string;
  description: string;
  annualCostPctGdp: number; // coût annuel en % du PIB
  minPopularity?: number;
  effects: string[];
  modifiers: {
    productivity?: number;      // multiplicateur additif (ex: +0.03 = +3 %)
    consumption?: number;
    growth?: number;
    popularity?: number;        // delta / jour
    stability?: number;
    inflation?: number;
    unemployment?: number;
    sectorBoost?: Partial<Record<SectorKey, number>>;
    resourceEfficiency?: number;
  };
}

export const LAWS: LawDef[] = [
  {
    id: 'national_infra_program',
    name: 'Programme national d’infrastructures',
    description: 'Grand plan décennal de modernisation des infrastructures.',
    annualCostPctGdp: 0.4,
    effects: ['+4 % productivité', '+2 % emploi industriel', '+3 % commerce intérieur'],
    modifiers: { productivity: 0.04, unemployment: -0.3, sectorBoost: { industry: 0.03 } },
  },
  {
    id: 'education_reform',
    name: 'Réforme de l’éducation nationale',
    description: 'Investissement massif dans la formation et les universités.',
    annualCostPctGdp: 0.5,
    effects: ['+5 % productivité à terme', '+1 popularité/sem.', '+capacité technologique'],
    modifiers: { productivity: 0.05, popularity: 0.02, sectorBoost: { tech: 0.04 } },
  },
  {
    id: 'health_coverage',
    name: 'Couverture santé universelle',
    description: 'Accès aux soins garanti pour toute la population.',
    annualCostPctGdp: 0.7,
    effects: ['+2 niveau de vie', '+popularité', '−absentéisme'],
    modifiers: { popularity: 0.05, productivity: 0.02 },
  },
  {
    id: 'green_transition',
    name: 'Loi de transition énergétique',
    description: 'Modernisation du mix énergétique et efficacité.',
    annualCostPctGdp: 0.5,
    effects: ['+6 % efficacité énergétique', '−inflation énergie', '+relations coopératives'],
    modifiers: { resourceEfficiency: 0.06, inflation: -0.2, sectorBoost: { energy: 0.03 } },
  },
  {
    id: 'business_deregulation',
    name: 'Loi de simplification des affaires',
    description: 'Allègement réglementaire pour les entreprises.',
    annualCostPctGdp: 0.05,
    effects: ['+3 % investissement', '+0,4 croissance', '−0,5 popularité (protection réduite)'],
    modifiers: { growth: 0.4, consumption: 0.02, popularity: -0.01, sectorBoost: { industry: 0.02, services: 0.02 } },
  },
  {
    id: 'labor_protection',
    name: 'Code du travail renforcé',
    description: 'Protection des travailleurs et dialogue social.',
    annualCostPctGdp: 0.2,
    effects: ['+popularité', '+stabilité', '−1 % compétitivité'],
    modifiers: { popularity: 0.06, stability: 0.05, productivity: -0.01 },
  },
  {
    id: 'innovation_fund',
    name: 'Fonds national d’innovation',
    description: 'Financement de la R&D publique-privée.',
    annualCostPctGdp: 0.45,
    effects: ['+6 % production technologique', '+croissance potentielle'],
    modifiers: { sectorBoost: { tech: 0.06 }, growth: 0.2 },
  },
  {
    id: 'food_sovereignty',
    name: 'Loi de souveraineté alimentaire',
    description: 'Sécurisation de la production agricole nationale.',
    annualCostPctGdp: 0.35,
    effects: ['+8 % production agricole', '+stabilité en cas de pénurie'],
    modifiers: { sectorBoost: { agriculture: 0.08 }, stability: 0.02 },
  },
  {
    id: 'trade_facilitation',
    name: 'Loi de facilitation du commerce',
    description: 'Dédouanement rapide, normes harmonisées.',
    annualCostPctGdp: 0.15,
    effects: ['+8 % volumes commerciaux', '+0,2 croissance'],
    modifiers: { growth: 0.2, sectorBoost: { services: 0.02 } },
  },
  {
    id: 'national_festival',
    name: 'Grand festival national',
    description: 'Une année de célébrations, de jeux et de concerts dans tout le pays : le peuple oublie, le peuple vibre.',
    annualCostPctGdp: 0.25,
    effects: ['+0,45 popularité/semaine', '+stabilité', 'rayonnement culturel'],
    modifiers: { popularity: 0.45, stability: 0.15 },
  },
  {
    id: 'purchasing_power_bonus',
    name: 'Prime de pouvoir d’achat',
    description: 'Chèque universel annuel : la consommation repart, les sourires aussi — mais les prix guettent.',
    annualCostPctGdp: 0.45,
    effects: ['+0,35 popularité/semaine', '+consommation', '+légère inflation'],
    modifiers: { popularity: 0.35, consumption: 0.05, inflation: 0.3 },
  },
  {
    id: 'civic_service',
    name: 'Service civique & cohésion',
    description: 'Six mois de service collectif : emploi, lien social et fierté nationale.',
    annualCostPctGdp: 0.15,
    effects: ['+0,25 popularité/semaine', '+stabilité', '−chômage'],
    modifiers: { popularity: 0.25, stability: 0.3, unemployment: -0.35 },
  },
  {
    id: 'citizens_referendum',
    name: 'Référendum d’initiative citoyenne',
    description: 'Le peuple tranche directement : immense popularité, mais chaque vote est une secousse politique.',
    annualCostPctGdp: 0.05,
    effects: ['+0,40 popularité/semaine', '−stabilité (agitation)'],
    modifiers: { popularity: 0.4, stability: -0.2 },
  },
  {
    id: 'fiscal_discipline',
    name: 'Loi de discipline budgétaire',
    description: 'Plafond de déficit et revue des dépenses.',
    annualCostPctGdp: 0,
    effects: ['−intérêts de la dette', '+confiance des marchés', '−0,8 popularité'],
    modifiers: { popularity: -0.02, stability: 0.03, inflation: -0.15 },
  },
];

export const LAW_MAP: Record<string, LawDef> = Object.fromEntries(LAWS.map((l) => [l.id, l]));

export interface EventDef {
  id: string;
  title: string;
  description: string;
  minDays: number;
  maxDays: number;
  /** conditions évaluées par le moteur (code) */
  condition: string;
  weight: number;
  modifiers: import('./types.js').EventModifiers;
}

export const EVENT_CATALOG: EventDef[] = [
  {
    id: 'energy_shortage',
    title: 'Pénurie énergétique',
    description: 'Les stocks d’énergie passent sous le seuil critique. Les prix flambent et l’industrie ralentit.',
    minDays: 8, maxDays: 18,
    condition: 'energyStockRatio<0.3',
    weight: 10,
    modifiers: { priceMul: { energy: 1.35, oil: 1.2 }, productionMul: { industry: 0.94 }, popularityDelta: -0.12, inflationDelta: 0.6 },
  },
  {
    id: 'food_shortage',
    title: 'Tensions alimentaires',
    description: 'Les stocks alimentaires fondent. Le mécontentement gagne la population.',
    minDays: 8, maxDays: 16,
    condition: 'foodStockRatio<0.3',
    weight: 10,
    modifiers: { priceMul: { food: 1.3 }, popularityDelta: -0.18, stabilityDelta: -0.15 },
  },
  {
    id: 'demand_surge',
    title: 'Hausse de la demande intérieure',
    description: 'La consommation repart fortement, tirée par la confiance des ménages.',
    minDays: 10, maxDays: 20,
    condition: 'popularity>62&&living>58',
    weight: 5,
    modifiers: { consumptionMul: { food: 1.05, industrial: 1.08, energy: 1.04 }, growthDelta: 0.35 },
  },
  {
    id: 'industrial_slowdown',
    title: 'Ralentissement industriel',
    description: 'Carnets de commandes en baisse : la production industrielle fléchit.',
    minDays: 8, maxDays: 16,
    condition: 'growth<0.6',
    weight: 6,
    modifiers: { productionMul: { industry: 0.93 }, unemploymentDelta: 0.4, growthDelta: -0.3 },
  },
  {
    id: 'tech_boom',
    title: 'Boom technologique',
    description: 'Une vague d’innovations dope la productivité et attire les capitaux.',
    minDays: 12, maxDays: 24,
    condition: 'techSector>12&&researchSpend>2',
    weight: 4,
    modifiers: { productionMul: { tech: 1.12 }, growthDelta: 0.45, popularityDelta: 0.06 },
  },
  {
    id: 'budget_crisis',
    title: 'Crise budgétaire',
    description: 'Le déficit inquiète les marchés : les taux d’intérêt de la dette augmentent.',
    minDays: 10, maxDays: 20,
    condition: 'debtRatio>95&&balance<-3',
    weight: 8,
    modifiers: { popularityDelta: -0.1, stabilityDelta: -0.12, inflationDelta: 0.5, growthDelta: -0.4 },
  },
  {
    id: 'strong_growth',
    title: 'Forte croissance',
    description: 'L’économie accélère nettement, l’emploi progresse.',
    minDays: 12, maxDays: 24,
    condition: 'growth>3.2&&balance>-2',
    weight: 4,
    modifiers: { growthDelta: 0.5, popularityDelta: 0.08 },
  },
  {
    id: 'logistics_problem',
    title: 'Problème logistique majeur',
    description: 'Saturation des axes logistiques : les échanges ralentissent.',
    minDays: 6, maxDays: 14,
    condition: 'logisticsLevel<3&&tradeVolume>0',
    weight: 5,
    modifiers: { productionMul: { industry: 0.97 }, priceMul: { materials: 1.1, industrial: 1.08 } },
  },
  {
    id: 'unemployment_wave',
    title: 'Vague de chômage',
    description: 'Les suppressions d’emplois se multiplient, la grogne sociale monte.',
    minDays: 10, maxDays: 20,
    condition: 'unemployment>11',
    weight: 8,
    modifiers: { popularityDelta: -0.15, stabilityDelta: -0.1, consumptionMul: { industrial: 0.95, food: 0.98 } },
  },
  {
    id: 'productivity_gain',
    title: 'Gains de productivité',
    description: 'Modernisation des outils de production : la productivité progresse.',
    minDays: 10, maxDays: 20,
    condition: 'educationSpend>3&&infraAvg>4',
    weight: 4,
    modifiers: { productionMul: { industry: 1.05, tech: 1.06 }, growthDelta: 0.25 },
  },
  {
    id: 'supply_disruption',
    title: 'Rupture d’approvisionnement',
    description: 'Un partenaire clé réduit ses livraisons : tensions sur les matières premières.',
    minDays: 6, maxDays: 14,
    condition: 'importDependency>0.35',
    weight: 6,
    modifiers: { priceMul: { materials: 1.18, minerals: 1.15 }, productionMul: { industry: 0.96 }, inflationDelta: 0.4 },
  },
  {
    id: 'trade_opportunity',
    title: 'Opportunité commerciale',
    description: 'Un nouveau débouché à l’exportation se présente.',
    minDays: 8, maxDays: 16,
    condition: 'relationsAvg>60&&tradeOpenness>0',
    weight: 5,
    modifiers: { productionMul: { industry: 1.04 }, growthDelta: 0.3, popularityDelta: 0.04 },
  },
];

export const REGIONS = [
  'Amérique du Nord',
  'Amérique latine',
  'Caraïbes',
  'Amérique du Sud',
  'Océanie',
  'Europe de l’Ouest',
  'Europe centrale',
  'Europe du Nord',
  'Europe du Sud',
  'Europe de l’Est',
  'Russie',
  'Méditerranée orientale',
  'Asie du Sud-Est',
  'Asie du Sud',
  'Asie de l’Est',
  'Afrique du Nord',
  'Afrique de l’Est',
  'Afrique de l’Ouest',
  'Afrique australe',
] as const;

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/* ------------------------------------------------------------------ */
/* Bâtiments de production (onglet Production)                          */
/* Achetés avec la trésorerie, livrés après construction, ils ajoutent   */
/* une production quotidienne réelle et coûtent un entretien journalier. */
/* Le rendement est mis à l'échelle du pays (main-d'œuvre : population). */
/* ------------------------------------------------------------------ */

export interface FacilityDef {
  key: FacilityKey;
  name: string;
  icon: string;
  resource: ResourceKey;
  tier: 1 | 2;
  /** Md € à l'achat (par unité). */
  cost: number;
  /** Md € d'entretien PAR JOUR et par unité. */
  upkeepPerDay: number;
  /** Unités produites PAR JOUR et par unité (avant échelle du pays). */
  outputPerDay: number;
  /** Jours de jeu avant livraison. */
  buildDays: number;
  /** Plafond par pays. */
  maxOwned: number;
  description: string;
}

export const FACILITIES: FacilityDef[] = [
  /* ---- Alimentation ---- */
  { key: 'farm', name: 'Ferme communale', icon: '🌾', resource: 'food', tier: 1, cost: 10, upkeepPerDay: 0.014, outputPerDay: 2.2, buildDays: 3, maxOwned: 30, description: 'Exploitation familiale mécanisée : le socle alimentaire de toute nation.' },
  { key: 'agriplex', name: 'Complexe agro-industriel', icon: '🏞️', resource: 'food', tier: 2, cost: 30, upkeepPerDay: 0.04, outputPerDay: 6.5, buildDays: 8, maxOwned: 15, description: 'Serres géantes, irrigation et silos : la sécurité alimentaire à grande échelle.' },
  /* ---- Énergie ---- */
  { key: 'solar', name: 'Parc solaire', icon: '☀️', resource: 'energy', tier: 1, cost: 11, upkeepPerDay: 0.015, outputPerDay: 1.8, buildDays: 3, maxOwned: 30, description: 'Photovoltaïque au sol : rapide à déployer, entretien léger.' },
  { key: 'nuclear', name: 'Centrale nucléaire', icon: '⚛️', resource: 'energy', tier: 2, cost: 36, upkeepPerDay: 0.05, outputPerDay: 6.0, buildDays: 10, maxOwned: 12, description: 'Le gigawatt fiable : cher et long, mais massif et stable.' },
  /* ---- Pétrole ---- */
  { key: 'well', name: 'Puits de forage', icon: '🛢️', resource: 'oil', tier: 1, cost: 10, upkeepPerDay: 0.015, outputPerDay: 1.0, buildDays: 4, maxOwned: 25, description: "Forage terrestre : l'or noir à petite dose." },
  { key: 'offshore', name: 'Plateforme offshore', icon: '🌊', resource: 'oil', tier: 2, cost: 30, upkeepPerDay: 0.04, outputPerDay: 3.4, buildDays: 9, maxOwned: 10, description: 'Extraction en mer : rendements élevés, ingénierie de pointe.' },
  /* ---- Gaz ---- */
  { key: 'gasfield', name: 'Champ gazier', icon: '🔥', resource: 'gas', tier: 1, cost: 9, upkeepPerDay: 0.013, outputPerDay: 1.1, buildDays: 4, maxOwned: 25, description: 'Gisement conventionnel raccordé au réseau.' },
  { key: 'lng', name: 'Terminal méthanier', icon: '🚢', resource: 'gas', tier: 2, cost: 26, upkeepPerDay: 0.035, outputPerDay: 3.2, buildDays: 8, maxOwned: 10, description: "liquéfaction, stockage et export : le gaz devenu marchandise mondiale." },
  /* ---- Minerais ---- */
  { key: 'quarry', name: 'Carrière', icon: '⛏️', resource: 'minerals', tier: 1, cost: 7, upkeepPerDay: 0.011, outputPerDay: 1.3, buildDays: 3, maxOwned: 25, description: 'Extraction à ciel ouvert : simple, robuste, essentielle.' },
  { key: 'deepmine', name: 'Mine profonde', icon: '🕳️', resource: 'minerals', tier: 2, cost: 24, upkeepPerDay: 0.032, outputPerDay: 4.0, buildDays: 8, maxOwned: 12, description: 'Galeries et chevalements : les métaux rares des grandes industries.' },
  /* ---- Matières premières ---- */
  { key: 'sawmill', name: 'Scierie', icon: '🪵', resource: 'materials', tier: 1, cost: 7, upkeepPerDay: 0.011, outputPerDay: 1.3, buildDays: 3, maxOwned: 25, description: 'Première transformation du bois et des fibres.' },
  { key: 'foundry', name: 'Fonderie intégrée', icon: '🏗️', resource: 'materials', tier: 2, cost: 24, upkeepPerDay: 0.032, outputPerDay: 4.0, buildDays: 8, maxOwned: 12, description: 'Coulée continue et alliages : la matière de toutes les usines.' },
  /* ---- Biens industriels ---- */
  { key: 'workshop', name: 'Atelier mécanisé', icon: '🔧', resource: 'industrial', tier: 1, cost: 12, upkeepPerDay: 0.018, outputPerDay: 0.9, buildDays: 5, maxOwned: 25, description: 'PME mécanisées : pièces, outils, petites séries.' },
  { key: 'gigafactory', name: 'Usine intégrée', icon: '🏭', resource: 'industrial', tier: 2, cost: 38, upkeepPerDay: 0.05, outputPerDay: 3.2, buildDays: 10, maxOwned: 10, description: 'Chaînes automatisées de bout en bout : le volume avant tout.' },
  /* ---- Technologie ---- */
  { key: 'lab', name: 'Laboratoire appliqué', icon: '🔬', resource: 'tech', tier: 1, cost: 16, upkeepPerDay: 0.024, outputPerDay: 0.35, buildDays: 5, maxOwned: 20, description: 'Recherche appliquée et prototypage : la tech à pas comptés.' },
  { key: 'campus', name: "Campus d'innovation", icon: '🧠', resource: 'tech', tier: 2, cost: 48, upkeepPerDay: 0.06, outputPerDay: 0.95, buildDays: 12, maxOwned: 8, description: "Le saint graal technologique : la ressource la plus chère du monde (4,5 Md €/unité)." },
];

export const FACILITY_MAP: Record<FacilityKey, FacilityDef> = Object.fromEntries(
  FACILITIES.map((f) => [f.key, f]),
) as Record<FacilityKey, FacilityDef>;

/** Échelle de rendement d'un bâtiment selon la main-d'œuvre du pays (population en Mhab). */
export function facilityScale(population: number): number {
  return clamp(0.6 + population / 120, 0.6, 3);
}

/** Production quotidienne réelle (unités/jour) d'un lot de bâtiments pour un pays. */
export function facilityOutput(def: FacilityDef, owned: number, population: number): number {
  return def.outputPerDay * owned * facilityScale(population);
}

/** État initial des bâtiments de production d'un pays (tous à zéro). */
export function emptyFacilities(): Record<FacilityKey, FacilityState> {
  return Object.fromEntries(
    FACILITIES.map((f) => [f.key, { owned: 0, queue: [] as { count: number; readyDay: number }[] }]),
  ) as unknown as Record<FacilityKey, FacilityState>;
}

/* ------------------------------------------------------------------ */
/* Régimes politiques : effets permanents + affinités avec les         */
/* revendications du peuple. Changer de régime vers ce que le peuple   */
/* réclame donne un boost (lune de miel) ; contre sa volonté, un malus. */
/* ------------------------------------------------------------------ */

export type DemandId =
  | 'jobs' | 'prices' | 'tax' | 'health' | 'education' | 'housing'
  | 'social' | 'food' | 'energy' | 'change' | 'calm';

/** Sévérités des revendications du peuple (0..1), dérivées de l'état RÉEL.
 *  Mêmes formules côté client (affichage) et serveur (alignement). */
export function demandSeverities(c: Country): Partial<Record<DemandId, number>> {
  const e = c.economy;
  const ratio = (k: ResourceKey): number => {
    const r = c.resources[k];
    return r.capacity > 0 ? r.stock / r.capacity : 1;
  };
  const raw: Partial<Record<DemandId, number>> = {
    jobs: (e.unemployment - 6) / 12,
    prices: (e.inflation - 3) / 12,
    tax: (c.policy.taxRate - 22) / 25,
    health: (3.8 - c.policy.spending.health) / 3,
    education: (3.4 - c.policy.spending.education) / 3,
    housing: (5 - (c.infra.housing?.level ?? 0)) / 6,
    social: (3.4 - c.policy.spending.social) / 3,
    food: (0.45 - ratio('food')) / 0.4,
    energy: (0.45 - ratio('energy')) / 0.4,
    change: (45 - c.popularity) / 30,
    calm: (50 - c.stability) / 35,
  };
  const out: Partial<Record<DemandId, number>> = {};
  for (const k of Object.keys(raw) as DemandId[]) {
    const v = raw[k] ?? 0;
    if (v > 0.12) out[k] = clamp(v, 0, 1);
  }
  return out;
}

export interface RegimeDef {
  id: RegimeType;
  icon: string;
  tagline: string;
  motto: string;
  /** Revendications que ce régime sait écouter (alignement avec le peuple). */
  affinities: DemandId[];
  /** Effets PERMANENTS tant que le régime est en place. */
  effects: {
    popularityDaily: number;   // dérive quotidienne d'opinion
    stabilityDaily: number;    // dérive quotidienne de stabilité
    growthDelta: number;       // points de croissance cible
    revenueMul: number;        // multiplicateur des recettes fiscales
  };
}

export const REGIMES: RegimeDef[] = [
  {
    id: 'République démocratique', icon: '🗳️',
    tagline: 'Le peuple tranche, chaque voix compte',
    motto: 'La souveraineté réside dans les urnes.',
    affinities: ['change', 'tax', 'education'],
    effects: { popularityDaily: 0.02, stabilityDaily: -0.008, growthDelta: 0.1, revenueMul: 1.0 },
  },
  {
    id: 'République parlementaire', icon: '🏛️',
    tagline: 'Le débat fait loi, les compromis durent',
    motto: 'Gouverner, c\'est écouter longtemps.',
    affinities: ['education', 'jobs', 'calm'],
    effects: { popularityDaily: 0, stabilityDaily: 0.02, growthDelta: 0.15, revenueMul: 1.02 },
  },
  {
    id: 'République fédérale', icon: '🤝',
    tagline: 'Des régions fortes, un pacte commun',
    motto: 'L\'unité dans la diversité.',
    affinities: ['jobs', 'housing', 'social'],
    effects: { popularityDaily: -0.004, stabilityDaily: 0.012, growthDelta: 0.2, revenueMul: 1.04 },
  },
  {
    id: 'Fédération', icon: '🌐',
    tagline: 'Grand espace économique intégré',
    motto: 'Le poids fait la paix.',
    affinities: ['food', 'energy', 'jobs'],
    effects: { popularityDaily: 0, stabilityDaily: -0.014, growthDelta: 0.12, revenueMul: 1.06 },
  },
  {
    id: 'Monarchie constitutionnelle', icon: '👑',
    tagline: 'La Couronne incarne, le Parlement gouverne',
    motto: 'La tradition est une force qui rassure.',
    affinities: ['calm', 'housing', 'social'],
    effects: { popularityDaily: 0.012, stabilityDaily: 0.04, growthDelta: -0.05, revenueMul: 0.99 },
  },
  {
    id: 'Technocratie', icon: '⚙️',
    tagline: 'Les dossiers aux experts, les résultats au peuple',
    motto: 'Chiffrer d\'abord, décider ensuite.',
    affinities: ['prices', 'energy', 'education'],
    effects: { popularityDaily: -0.028, stabilityDaily: -0.008, growthDelta: 0.3, revenueMul: 1.08 },
  },
];

export const REGIME_MAP: Record<RegimeType, RegimeDef> = Object.fromEntries(
  REGIMES.map((r) => [r.id, r]),
) as Record<RegimeType, RegimeDef>;

/** Alignement (0..1) d'un régime avec les revendications ACTUELLES du peuple.
 *  0,5 = neutre (peuple sans demande forte). */
export function regimeAlignment(c: Country, regime: RegimeType): number {
  const sev = demandSeverities(c);
  const entries = Object.entries(sev) as [DemandId, number][];
  if (entries.length === 0) return 0.5;
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return 0.5;
  const aff = REGIME_MAP[regime]?.affinities ?? [];
  const matched = entries.reduce((s, [k, v]) => s + (aff.includes(k) ? v : 0), 0);
  return clamp(matched / total, 0, 1);
}

/** Cooldown (jours de jeu) entre deux changements de régime. */
export const REGIME_CHANGE_COOLDOWN_DAYS = 90;
/** Durée de la lune de miel / gueule de bois post-changement. */
export const REGIME_HONEYMOON_DAYS = 30;
