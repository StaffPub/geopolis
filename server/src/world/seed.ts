/**
 * GEOPOLIS — Seed déterministe du monde : les 36 nations.
 * Monde alternatif/fictif pour les regroupements, mais VALEURS MACRO RÉELLES
 * (ordres de grandeur 2024-2025 : PIB, croissance, inflation, chômage, solde
 * budgétaire, dette, niveau de vie, investissement, réserves).
 * Pour les unions/fédérations : somme des PIB/populations et moyennes
 * pondérées des ratios des pays membres (ex. Union Ibérique = Espagne+Portugal).
 * Le premier lancement initialise le monde ; les suivants le rechargent.
 */
import type {
  AIPersonality,
  AIStrategy,
  Agreement,
  Country,
  InfraKey,
  JournalEntry,
  MarketResource,
  PolicyState,
  RegimeType,
  Relation,
  ResourceKey,
  ResourceState,
  SectorKey,
  SpendingKey,
  WorldMeta,
} from 'shared';
import { emptyFacilities, INFRA, RESOURCE_KEYS, RESOURCE_MAP, SIM_VERSION } from 'shared';
import { makeRng, round, seedFrom, clamp } from '../util/core.js';

export const WORLD_SEED = 20260101;

export interface CountryDef {
  id: string;
  name: string;
  code: string;
  color: string;
  region: string;
  capital: string;
  pop: number;             // millions
  gdp: number;             // Md € annuels (réel)
  growth: number;          // % annuel (réel)
  inflation: number;       // % annuel (réel)
  unemployment: number;    // % (réel)
  balance: number;         // solde budgétaire Md €/an (réel)
  cash: number;            // réserves/trésorerie Md €
  investment: number;      // formation brute de capital Md €/an (réel)
  productivity: number;    // indice de productivité initial (100 = base)
  debtRatio: number;       // % du PIB (réel)
  living: number;          // niveau de vie 0-100 (type IDH)
  difficulty: number;      // 1..5
  regime: RegimeType;
  endow: Partial<Record<ResourceKey, number>>;
  sectors: Record<SectorKey, number>; // % du PIB
  industryIndex: number;
  techIndex: number;
  infra: number;
  tax: number;
  corp: number;
  tariff: number;
  rate: number;
  spending: Partial<Record<SpendingKey, number>>;
  popularity: number;
  stability: number;
  strategy: AIStrategy;
  president: string;
  personality?: Partial<AIPersonality>;
}

export const COUNTRY_DEFS: CountryDef[] = [
  { id: 'canada', name: 'Canada', code: 'CAN', color: '#e2725b', region: 'Amérique du Nord', capital: 'Ottawa',
    pop: 40.5, gdp: 2000, growth: 0.8, inflation: 3.0, unemployment: 6.4, balance: -41, cash: 85, investment: 460, debtRatio: 42, living: 78, productivity: 102,
    difficulty: 1, regime: 'Monarchie constitutionnelle',
    endow: { food: 0.85, energy: 0.8, oil: 0.85, gas: 0.7, minerals: 0.8, materials: 0.75 },
    sectors: { agriculture: 7, industry: 22, energy: 8, services: 53, tech: 10 }, industryIndex: 1.0, techIndex: 1.2, infra: 6, tax: 22, corp: 18, tariff: 4, rate: 3.0,
    spending: { health: 4.2, education: 3.4, transport: 2.2, energy: 1.6, industry: 1.2, agriculture: 1.0, research: 1.6, social: 3.6 },
    popularity: 56, stability: 80, strategy: 'ressources', president: 'Élodie Tremblay' },
  { id: 'usa', name: 'États-Unis', code: 'USA', color: '#6fa8dc', region: 'Amérique du Nord', capital: 'Washington',
    pop: 335, gdp: 26500, growth: 2.2, inflation: 3.4, unemployment: 4.2, balance: -1600, cash: 800, investment: 5600, debtRatio: 101, living: 76, productivity: 107,
    difficulty: 2, regime: 'République fédérale',
    endow: { food: 0.9, energy: 0.85, oil: 0.8, gas: 0.9, minerals: 0.7, materials: 0.65 },
    sectors: { agriculture: 5, industry: 20, energy: 6, services: 55, tech: 14 }, industryIndex: 1.25, techIndex: 2.1, infra: 6, tax: 18, corp: 16, tariff: 5, rate: 3.4,
    spending: { health: 4.0, education: 3.2, transport: 2.0, energy: 1.4, industry: 1.4, agriculture: 0.8, research: 2.2, social: 3.4 },
    popularity: 50, stability: 72, strategy: 'innovation', president: 'Marcus Hale',
    personality: { debtTolerance: 0.75, tradeOpenness: 0.65, diplomacy: 0.6 } },
  { id: 'mexique', name: 'Mexique', code: 'MEX', color: '#7ec98e', region: 'Amérique du Nord', capital: 'Mexico',
    pop: 130, gdp: 1830, growth: 1.4, inflation: 3.3, unemployment: 3.0, balance: -66, cash: 60, investment: 400, debtRatio: 52, living: 55, productivity: 110,
    difficulty: 3, regime: 'République fédérale',
    endow: { food: 0.65, energy: 0.6, oil: 0.6, gas: 0.4, minerals: 0.7, materials: 0.6 },
    sectors: { agriculture: 10, industry: 26, energy: 6, services: 50, tech: 8 }, industryIndex: 1.1, techIndex: 0.8, infra: 4, tax: 16, corp: 15, tariff: 8, rate: 5.0,
    spending: { health: 2.8, education: 2.8, transport: 2.2, energy: 1.6, industry: 1.6, agriculture: 1.4, research: 0.8, social: 2.8 },
    popularity: 56, stability: 62, strategy: 'industrielle', president: 'Ximena Robles' },
  { id: 'pays-latins', name: 'Pays latins', code: 'LAT', color: '#d9a5b4', region: 'Amérique latine', capital: 'Lima',
    pop: 150, gdp: 375, growth: 3.7, inflation: 3.5, unemployment: 4.0, balance: -15, cash: 20, investment: 85, debtRatio: 55, living: 55, productivity: 108,
    difficulty: 3, regime: 'République parlementaire',
    endow: { food: 0.6, energy: 0.45, oil: 0.35, gas: 0.3, minerals: 0.85, materials: 0.7 },
    sectors: { agriculture: 12, industry: 20, energy: 5, services: 52, tech: 6 }, industryIndex: 0.85, techIndex: 0.6, infra: 3, tax: 15, corp: 14, tariff: 10, rate: 5.5,
    spending: { health: 2.4, education: 2.4, transport: 2.0, energy: 1.4, industry: 1.2, agriculture: 1.6, research: 0.5, social: 2.6 },
    popularity: 52, stability: 58, strategy: 'ressources', president: 'Mateo Quispe' },
  { id: 'caraibes', name: 'États des Caraïbes', code: 'CAR', color: '#5bc0be', region: 'Caraïbes', capital: 'Port Royale',
    pop: 45, gdp: 395, growth: 0.3, inflation: 4.0, unemployment: 8.0, balance: -15, cash: 12, investment: 75, debtRatio: 47, living: 58, productivity: 102,
    difficulty: 4, regime: 'Fédération',
    endow: { food: 0.4, energy: 0.3, oil: 0.2, gas: 0.25, minerals: 0.25, materials: 0.3 },
    sectors: { agriculture: 9, industry: 12, energy: 4, services: 68, tech: 4 }, industryIndex: 0.55, techIndex: 0.45, infra: 3, tax: 12, corp: 10, tariff: 12, rate: 4.5,
    spending: { health: 2.6, education: 2.4, transport: 2.2, energy: 1.8, industry: 0.8, agriculture: 1.2, research: 0.4, social: 2.4 },
    popularity: 55, stability: 64, strategy: 'commerciale', president: 'Anaïs Belair' },
  { id: 'grande-colombie', name: 'Grande Colombie', code: 'GRC', color: '#f2c14e', region: 'Amérique du Sud', capital: 'Bogotá',
    pop: 110, gdp: 1060, growth: 2.6, inflation: 8.0, unemployment: 7.0, balance: -55, cash: 60, investment: 220, debtRatio: 58, living: 60, productivity: 108,
    difficulty: 3, regime: 'République démocratique',
    endow: { food: 0.7, energy: 0.55, oil: 0.65, gas: 0.45, minerals: 0.6, materials: 0.55 },
    sectors: { agriculture: 12, industry: 18, energy: 7, services: 55, tech: 5 }, industryIndex: 0.8, techIndex: 0.55, infra: 3, tax: 15, corp: 14, tariff: 9, rate: 5.2,
    spending: { health: 2.4, education: 2.4, transport: 2.0, energy: 1.6, industry: 1.2, agriculture: 1.8, research: 0.5, social: 2.6 },
    popularity: 55, stability: 60, strategy: 'ressources', president: 'Camila Restrepo' },
  { id: 'bresil', name: 'Brésil', code: 'BRA', color: '#8ac926', region: 'Amérique du Sud', capital: 'Brasília',
    pop: 215, gdp: 2300, growth: 2.4, inflation: 4.0, unemployment: 6.8, balance: -190, cash: 305, investment: 400, debtRatio: 98, living: 60, productivity: 102,
    difficulty: 2, regime: 'République fédérale',
    endow: { food: 0.95, energy: 0.6, oil: 0.55, gas: 0.35, minerals: 0.85, materials: 0.8 },
    sectors: { agriculture: 13, industry: 21, energy: 6, services: 52, tech: 6 }, industryIndex: 1.05, techIndex: 0.75, infra: 4, tax: 19, corp: 17, tariff: 9, rate: 6.0,
    spending: { health: 3.0, education: 2.8, transport: 2.0, energy: 1.4, industry: 1.4, agriculture: 1.8, research: 0.7, social: 3.4 },
    popularity: 54, stability: 62, strategy: 'agricole', president: 'Rafael Monteiro' },
  { id: 'argentine', name: 'Grande Argentine', code: 'ARG', color: '#74b3e8', region: 'Amérique du Sud', capital: 'Buenos Aires',
    pop: 70, gdp: 1250, growth: 2.8, inflation: 25.0, unemployment: 6.0, balance: -35, cash: 40, investment: 270, debtRatio: 65, living: 67, productivity: 108,
    difficulty: 4, regime: 'République démocratique',
    endow: { food: 0.9, energy: 0.55, oil: 0.5, gas: 0.6, minerals: 0.6, materials: 0.55 },
    sectors: { agriculture: 14, industry: 17, energy: 6, services: 55, tech: 5 }, industryIndex: 0.8, techIndex: 0.6, infra: 3, tax: 18, corp: 16, tariff: 10, rate: 6.5,
    spending: { health: 2.8, education: 2.8, transport: 1.8, energy: 1.4, industry: 1.0, agriculture: 1.8, research: 0.5, social: 3.2 },
    popularity: 48, stability: 55, strategy: 'agricole', president: 'Valentina Ocampo',
    personality: { debtTolerance: 0.35 } },
  { id: 'australie', name: 'Grande Australie', code: 'AUL', color: '#e0a458', region: 'Océanie', capital: 'Canberra',
    pop: 27, gdp: 2000, growth: 1.9, inflation: 3.8, unemployment: 4.5, balance: -55, cash: 70, investment: 480, debtRatio: 55, living: 75, productivity: 102,
    difficulty: 1, regime: 'Monarchie constitutionnelle',
    endow: { food: 0.75, energy: 0.8, oil: 0.5, gas: 0.9, minerals: 0.95, materials: 0.9 },
    sectors: { agriculture: 8, industry: 16, energy: 10, services: 56, tech: 9 }, industryIndex: 0.95, techIndex: 1.0, infra: 6, tax: 20, corp: 17, tariff: 3, rate: 3.2,
    spending: { health: 4.0, education: 3.2, transport: 2.2, energy: 1.6, industry: 1.0, agriculture: 0.9, research: 1.5, social: 3.4 },
    popularity: 58, stability: 82, strategy: 'ressources', president: 'Jack Warrington' },
  { id: 'royaume-uni', name: 'Grande-Bretagne', code: 'GBR', color: '#8e7cc3', region: 'Europe de l’Ouest', capital: 'Londres',
    pop: 68, gdp: 3900, growth: 0.7, inflation: 3.3, unemployment: 5.5, balance: -125, cash: 190, investment: 750, debtRatio: 88, living: 77, productivity: 102,
    difficulty: 2, regime: 'Monarchie constitutionnelle',
    endow: { food: 0.45, energy: 0.6, oil: 0.45, gas: 0.5, minerals: 0.3, materials: 0.3 },
    sectors: { agriculture: 4, industry: 17, energy: 6, services: 63, tech: 11 }, industryIndex: 1.0, techIndex: 1.55, infra: 6, tax: 21, corp: 17, tariff: 4, rate: 3.4,
    spending: { health: 4.4, education: 3.4, transport: 2.0, energy: 1.4, industry: 1.0, agriculture: 0.6, research: 1.8, social: 3.6 },
    popularity: 51, stability: 74, strategy: 'financière', president: 'Charlotte Ashford' },
  { id: 'france', name: 'France', code: 'FRA', color: '#6c8ebf', region: 'Europe de l’Ouest', capital: 'Paris',
    pop: 68.4, gdp: 3900, growth: 0.7, inflation: 1.9, unemployment: 6.4, balance: -160, cash: 300, investment: 990, debtRatio: 100, living: 76, productivity: 101,
    difficulty: 2, regime: 'République démocratique',
    endow: { food: 0.8, energy: 0.5, oil: 0.15, gas: 0.15, minerals: 0.3, materials: 0.35 },
    sectors: { agriculture: 6, industry: 18, energy: 7, services: 58, tech: 10 }, industryIndex: 1.1, techIndex: 1.3, infra: 6, tax: 24, corp: 18, tariff: 4, rate: 3.0,
    spending: { health: 4.6, education: 3.6, transport: 2.2, energy: 1.8, industry: 1.2, agriculture: 1.0, research: 1.8, social: 4.4 },
    popularity: 50, stability: 72, strategy: 'équilibrée', president: 'Lucas Fontaine' },
  { id: 'union-iberique', name: 'Union Ibérique', code: 'IBE', color: '#e8a0bf', region: 'Europe du Sud', capital: 'Madrid-Lisbonne',
    pop: 58.5, gdp: 1780, growth: 2.1, inflation: 2.9, unemployment: 9.0, balance: -42, cash: 115, investment: 300, debtRatio: 96, living: 70, productivity: 104,
    difficulty: 2, regime: 'Monarchie constitutionnelle',
    endow: { food: 0.7, energy: 0.4, oil: 0.1, gas: 0.15, minerals: 0.45, materials: 0.4 },
    sectors: { agriculture: 8, industry: 18, energy: 6, services: 60, tech: 7 }, industryIndex: 0.95, techIndex: 0.85, infra: 5, tax: 19, corp: 16, tariff: 4, rate: 3.1,
    spending: { health: 4.0, education: 3.0, transport: 2.2, energy: 1.4, industry: 1.0, agriculture: 1.2, research: 1.0, social: 3.8 },
    popularity: 55, stability: 70, strategy: 'commerciale', president: 'Sofía Almeida' },
  { id: 'benelux', name: 'Benelux', code: 'BEN', color: '#f4a261', region: 'Europe de l’Ouest', capital: 'Bruxelles',
    pop: 30, gdp: 1650, growth: 1.1, inflation: 2.4, unemployment: 5.7, balance: -60, cash: 250, investment: 340, debtRatio: 78, living: 82, productivity: 103,
    difficulty: 1, regime: 'Fédération',
    endow: { food: 0.55, energy: 0.35, oil: 0.2, gas: 0.3, minerals: 0.15, materials: 0.2 },
    sectors: { agriculture: 5, industry: 18, energy: 5, services: 64, tech: 9 }, industryIndex: 1.05, techIndex: 1.15, infra: 7, tax: 23, corp: 17, tariff: 3, rate: 2.8,
    spending: { health: 4.4, education: 3.6, transport: 2.8, energy: 1.4, industry: 1.0, agriculture: 0.8, research: 1.6, social: 4.0 },
    popularity: 57, stability: 78, strategy: 'commerciale', president: 'Lars Peeters' },
  { id: 'allemagne', name: 'Allemagne', code: 'DEU', color: '#b0b7bf', region: 'Europe de l’Ouest', capital: 'Berlin',
    pop: 84, gdp: 4450, growth: 1.3, inflation: 2.7, unemployment: 3.4, balance: -150, cash: 90, investment: 900, debtRatio: 64, living: 80, productivity: 103,
    difficulty: 2, regime: 'République parlementaire',
    endow: { food: 0.6, energy: 0.45, oil: 0.1, gas: 0.15, minerals: 0.35, materials: 0.35 },
    sectors: { agriculture: 4, industry: 27, energy: 6, services: 53, tech: 10 }, industryIndex: 1.5, techIndex: 1.4, infra: 7, tax: 22, corp: 19, tariff: 3, rate: 2.9,
    spending: { health: 4.4, education: 3.2, transport: 2.4, energy: 1.6, industry: 1.4, agriculture: 0.6, research: 2.0, social: 3.8 },
    popularity: 52, stability: 80, strategy: 'industrielle', president: 'Jonas Keller',
    personality: { debtTolerance: 0.25, taxPreference: 0.5, tradeOpenness: 0.85 } },
  { id: 'confederation-alpine', name: 'Confédération Alpine', code: 'ALP', color: '#a2d2ff', region: 'Europe centrale', capital: 'Berne',
    pop: 14, gdp: 950, growth: 1.2, inflation: 1.5, unemployment: 4.5, balance: 5, cash: 90, investment: 260, debtRatio: 40, living: 84, productivity: 106,
    difficulty: 1, regime: 'Fédération',
    endow: { food: 0.35, energy: 0.5, oil: 0.05, gas: 0.05, minerals: 0.25, materials: 0.2 },
    sectors: { agriculture: 4, industry: 22, energy: 6, services: 56, tech: 12 }, industryIndex: 1.3, techIndex: 1.5, infra: 7, tax: 17, corp: 13, tariff: 2, rate: 2.2,
    spending: { health: 4.6, education: 3.8, transport: 2.6, energy: 1.6, industry: 1.0, agriculture: 0.8, research: 2.4, social: 3.6 },
    popularity: 62, stability: 86, strategy: 'financière', president: 'Elise Brunner' },
  { id: 'italie', name: 'Italie', code: 'ITA', color: '#95d5b2', region: 'Europe du Sud', capital: 'Rome',
    pop: 59, gdp: 2480, growth: 0.9, inflation: 2.9, unemployment: 5.7, balance: -72, cash: 87, investment: 505, debtRatio: 137, living: 69, productivity: 98,
    difficulty: 2, regime: 'République parlementaire',
    endow: { food: 0.6, energy: 0.35, oil: 0.1, gas: 0.2, minerals: 0.25, materials: 0.3 },
    sectors: { agriculture: 6, industry: 24, energy: 5, services: 56, tech: 8 }, industryIndex: 1.25, techIndex: 1.0, infra: 5, tax: 23, corp: 18, tariff: 3, rate: 3.2,
    spending: { health: 4.2, education: 2.8, transport: 2.2, energy: 1.4, industry: 1.2, agriculture: 1.0, research: 1.0, social: 4.0 },
    popularity: 50, stability: 66, strategy: 'industrielle', president: 'Alessandro Ricci',
    personality: { debtTolerance: 0.6 } },
  { id: 'yougoslavie', name: 'Yougoslavie', code: 'YUG', color: '#cdb4db', region: 'Europe du Sud', capital: 'Belgrade',
    pop: 22, gdp: 590, growth: 2.5, inflation: 4.0, unemployment: 7.5, balance: -15, cash: 75, investment: 125, debtRatio: 58, living: 69, productivity: 107,
    difficulty: 4, regime: 'Fédération',
    endow: { food: 0.55, energy: 0.45, oil: 0.15, gas: 0.1, minerals: 0.55, materials: 0.5 },
    sectors: { agriculture: 11, industry: 22, energy: 7, services: 52, tech: 4 }, industryIndex: 0.8, techIndex: 0.5, infra: 3, tax: 15, corp: 12, tariff: 8, rate: 5.0,
    spending: { health: 2.6, education: 2.4, transport: 2.0, energy: 1.8, industry: 1.4, agriculture: 1.4, research: 0.4, social: 2.6 },
    popularity: 52, stability: 56, strategy: 'équilibrée', president: 'Milena Jovanović' },
  { id: 'autriche-hongrie', name: 'Autriche-Hongrie', code: 'AUH', color: '#ffc8dd', region: 'Europe centrale', capital: 'Vienne',
    pop: 30, gdp: 700, growth: 1.0, inflation: 3.4, unemployment: 4.8, balance: -31, cash: 45, investment: 180, debtRatio: 78, living: 72, productivity: 102,
    difficulty: 2, regime: 'Monarchie constitutionnelle',
    endow: { food: 0.65, energy: 0.4, oil: 0.1, gas: 0.15, minerals: 0.4, materials: 0.4 },
    sectors: { agriculture: 7, industry: 25, energy: 6, services: 54, tech: 8 }, industryIndex: 1.15, techIndex: 1.0, infra: 5, tax: 21, corp: 16, tariff: 4, rate: 3.1,
    spending: { health: 4.0, education: 3.2, transport: 2.4, energy: 1.4, industry: 1.2, agriculture: 1.0, research: 1.4, social: 3.6 },
    popularity: 55, stability: 74, strategy: 'industrielle', president: 'Otto von Lindner' },
  { id: 'tchecoslovaquie', name: 'Tchécoslovaquie', code: 'TCH', color: '#bde0fe', region: 'Europe centrale', capital: 'Prague',
    pop: 21, gdp: 490, growth: 1.6, inflation: 2.9, unemployment: 3.8, balance: -16, cash: 220, investment: 115, debtRatio: 50, living: 73, productivity: 104,
    difficulty: 3, regime: 'République parlementaire',
    endow: { food: 0.5, energy: 0.5, oil: 0.05, gas: 0.05, minerals: 0.5, materials: 0.45 },
    sectors: { agriculture: 6, industry: 28, energy: 8, services: 50, tech: 7 }, industryIndex: 1.2, techIndex: 0.9, infra: 5, tax: 19, corp: 15, tariff: 5, rate: 3.6,
    spending: { health: 3.6, education: 2.8, transport: 2.2, energy: 1.8, industry: 1.4, agriculture: 0.8, research: 1.0, social: 3.0 },
    popularity: 55, stability: 70, strategy: 'industrielle', president: 'Petra Novák' },
  { id: 'pologne', name: 'Pologne', code: 'POL', color: '#ffafcc', region: 'Europe centrale', capital: 'Varsovie',
    pop: 42, gdp: 820, growth: 3.0, inflation: 4.0, unemployment: 3.0, balance: -50, cash: 35, investment: 200, debtRatio: 50, living: 68, productivity: 109,
    difficulty: 3, regime: 'République parlementaire',
    endow: { food: 0.65, energy: 0.55, oil: 0.05, gas: 0.05, minerals: 0.55, materials: 0.5 },
    sectors: { agriculture: 8, industry: 26, energy: 8, services: 50, tech: 7 }, industryIndex: 1.15, techIndex: 0.85, infra: 4, tax: 18, corp: 14, tariff: 5, rate: 4.0,
    spending: { health: 3.2, education: 2.8, transport: 2.4, energy: 1.8, industry: 1.6, agriculture: 1.2, research: 0.8, social: 3.0 },
    popularity: 55, stability: 68, strategy: 'industrielle', president: 'Krzysztof Zieliński' },
  { id: 'fed-europe-est', name: 'Fédération de l’Europe de l’Est', code: 'EEF', color: '#9d8189', region: 'Europe de l’Est', capital: 'Kyiv-Bucarest',
    pop: 95, gdp: 850, growth: 1.4, inflation: 7.0, unemployment: 7.0, balance: -100, cash: 100, investment: 170, debtRatio: 65, living: 52, productivity: 108,
    difficulty: 4, regime: 'Fédération',
    endow: { food: 0.85, energy: 0.5, oil: 0.25, gas: 0.2, minerals: 0.5, materials: 0.45 },
    sectors: { agriculture: 11, industry: 24, energy: 7, services: 50, tech: 6 }, industryIndex: 1.0, techIndex: 0.8, infra: 4, tax: 16, corp: 13, tariff: 7, rate: 4.8,
    spending: { health: 2.8, education: 2.6, transport: 2.4, energy: 1.8, industry: 1.6, agriculture: 1.4, research: 0.8, social: 2.6 },
    popularity: 52, stability: 60, strategy: 'équilibrée', president: 'Andrei Shevchenko' },
  { id: 'russie', name: 'Russie', code: 'RUS', color: '#c1121f', region: 'Russie', capital: 'Moscou',
    pop: 145, gdp: 2400, growth: 1.5, inflation: 5.8, unemployment: 5.0, balance: -75, cash: 650, investment: 520, debtRatio: 30, living: 58, productivity: 108,
    difficulty: 3, regime: 'République fédérale',
    endow: { food: 0.7, energy: 0.95, oil: 0.95, gas: 0.98, minerals: 0.9, materials: 0.85 },
    sectors: { agriculture: 7, industry: 24, energy: 14, services: 47, tech: 6 }, industryIndex: 1.1, techIndex: 0.9, infra: 4, tax: 15, corp: 12, tariff: 8, rate: 5.5,
    spending: { health: 2.4, education: 2.4, transport: 2.6, energy: 2.0, industry: 1.8, agriculture: 1.0, research: 1.0, social: 2.6 },
    popularity: 58, stability: 66, strategy: 'ressources', president: 'Viktor Zaïtsev',
    personality: { debtTolerance: 0.2, tradeOpenness: 0.45, diplomacy: 0.35 } },
  { id: 'scandinavie', name: 'Scandinavie', code: 'SCA', color: '#89c2d9', region: 'Europe du Nord', capital: 'Stockholm',
    pop: 28, gdp: 1550, growth: 1.7, inflation: 2.4, unemployment: 4.7, balance: -25, cash: 1000, investment: 330, debtRatio: 38, living: 86, productivity: 107,
    difficulty: 1, regime: 'Fédération',
    endow: { food: 0.45, energy: 0.75, oil: 0.6, gas: 0.4, minerals: 0.7, materials: 0.6 },
    sectors: { agriculture: 4, industry: 20, energy: 8, services: 56, tech: 12 }, industryIndex: 1.15, techIndex: 1.5, infra: 7, tax: 27, corp: 15, tariff: 2, rate: 2.4,
    spending: { health: 5.2, education: 4.2, transport: 2.4, energy: 1.8, industry: 1.0, agriculture: 0.6, research: 2.4, social: 5.0 },
    popularity: 62, stability: 88, strategy: 'sociale', president: 'Astrid Lindqvist' },
  { id: 'grece', name: 'Grèce', code: 'GRE', color: '#4ea8de', region: 'Europe du Sud', capital: 'Athènes',
    pop: 10.5, gdp: 400, growth: 2.0, inflation: 3.7, unemployment: 7.5, balance: -4, cash: 100, investment: 90, debtRatio: 102, living: 65, productivity: 108,
    difficulty: 3, regime: 'République parlementaire',
    endow: { food: 0.55, energy: 0.3, oil: 0.05, gas: 0.1, minerals: 0.35, materials: 0.3 },
    sectors: { agriculture: 9, industry: 13, energy: 5, services: 66, tech: 5 }, industryIndex: 0.65, techIndex: 0.55, infra: 4, tax: 20, corp: 15, tariff: 5, rate: 3.8,
    spending: { health: 3.4, education: 2.4, transport: 2.0, energy: 1.4, industry: 0.6, agriculture: 1.4, research: 0.5, social: 3.4 },
    popularity: 50, stability: 62, strategy: 'commerciale', president: 'Nikos Papas',
    personality: { debtTolerance: 0.55 } },
  { id: 'turquie', name: 'Turquie', code: 'TUR', color: '#e76f51', region: 'Méditerranée orientale', capital: 'Ankara',
    pop: 85, gdp: 1550, growth: 3.5, inflation: 25.0, unemployment: 8.0, balance: -55, cash: 280, investment: 320, debtRatio: 32, living: 64, productivity: 114,
    difficulty: 3, regime: 'République démocratique',
    endow: { food: 0.65, energy: 0.4, oil: 0.1, gas: 0.1, minerals: 0.6, materials: 0.55 },
    sectors: { agriculture: 9, industry: 25, energy: 6, services: 52, tech: 6 }, industryIndex: 1.1, techIndex: 0.75, infra: 4, tax: 17, corp: 14, tariff: 8, rate: 6.0,
    spending: { health: 2.8, education: 2.6, transport: 2.6, energy: 1.6, industry: 1.6, agriculture: 1.4, research: 0.7, social: 2.6 },
    popularity: 54, stability: 60, strategy: 'industrielle', president: 'Emre Yılmaz' },
  { id: 'mesopotamie', name: 'Fédération mésopotamienne', code: 'MES', color: '#b5838d', region: 'Méditerranée orientale', capital: 'Bagdad',
    pop: 90, gdp: 3450, growth: 0.4, inflation: 13.0, unemployment: 8.0, balance: -105, cash: 1000, investment: 710, debtRatio: 48, living: 65, productivity: 103,
    difficulty: 4, regime: 'Fédération',
    endow: { food: 0.35, energy: 0.9, oil: 0.95, gas: 0.8, minerals: 0.4, materials: 0.35 },
    sectors: { agriculture: 6, industry: 18, energy: 18, services: 50, tech: 4 }, industryIndex: 0.85, techIndex: 0.5, infra: 3, tax: 12, corp: 10, tariff: 9, rate: 5.0,
    spending: { health: 2.2, education: 2.2, transport: 2.2, energy: 2.0, industry: 1.4, agriculture: 1.2, research: 0.5, social: 2.4 },
    popularity: 45, stability: 35, strategy: 'ressources', president: 'Layla Haddad' },
  { id: 'indochine', name: 'Indochine', code: 'IDC', color: '#80b918', region: 'Asie du Sud-Est', capital: 'Bangkok-Saigon',
    pop: 210, gdp: 1180, growth: 4.2, inflation: 6.5, unemployment: 4.5, balance: -45, cash: 420, investment: 300, debtRatio: 48, living: 59, productivity: 119,
    difficulty: 3, regime: 'République démocratique',
    endow: { food: 0.9, energy: 0.5, oil: 0.35, gas: 0.3, minerals: 0.55, materials: 0.55 },
    sectors: { agriculture: 14, industry: 24, energy: 6, services: 48, tech: 6 }, industryIndex: 1.2, techIndex: 0.8, infra: 4, tax: 14, corp: 12, tariff: 9, rate: 5.0,
    spending: { health: 2.4, education: 2.8, transport: 2.6, energy: 1.8, industry: 2.0, agriculture: 1.6, research: 0.8, social: 2.2 },
    popularity: 58, stability: 66, strategy: 'industrielle', president: 'Linh Phạm' },
  { id: 'fed-asie-sud', name: 'Fédération d’Asie du Sud', code: 'SAS', color: '#ffb703', region: 'Asie du Sud', capital: 'New Delhi',
    pop: 1900, gdp: 3950, growth: 6.1, inflation: 5.3, unemployment: 6.0, balance: -210, cash: 770, investment: 1050, debtRatio: 72, living: 55, productivity: 132,
    difficulty: 4, regime: 'Fédération',
    endow: { food: 0.7, energy: 0.55, oil: 0.25, gas: 0.2, minerals: 0.65, materials: 0.6 },
    sectors: { agriculture: 16, industry: 22, energy: 6, services: 48, tech: 8 }, industryIndex: 1.1, techIndex: 1.1, infra: 3, tax: 13, corp: 12, tariff: 11, rate: 5.5,
    spending: { health: 2.0, education: 2.6, transport: 2.6, energy: 1.8, industry: 1.8, agriculture: 2.0, research: 0.9, social: 2.2 },
    popularity: 52, stability: 45, strategy: 'agricole', president: 'Arjun Mehta' },
  { id: 'chine', name: 'Chine', code: 'CHN', color: '#ef476f', region: 'Asie de l’Est', capital: 'Pékin',
    pop: 1410, gdp: 17800, growth: 4.4, inflation: 1.2, unemployment: 5.1, balance: -1450, cash: 3100, investment: 5500, debtRatio: 107, living: 67, productivity: 124,
    difficulty: 3, regime: 'République démocratique',
    endow: { food: 0.6, energy: 0.75, oil: 0.4, gas: 0.35, minerals: 0.85, materials: 0.8 },
    sectors: { agriculture: 8, industry: 30, energy: 8, services: 46, tech: 10 }, industryIndex: 1.6, techIndex: 1.6, infra: 6, tax: 16, corp: 13, tariff: 7, rate: 3.4,
    spending: { health: 2.8, education: 3.0, transport: 3.2, energy: 2.2, industry: 2.4, agriculture: 1.2, research: 2.2, social: 2.8 },
    popularity: 60, stability: 74, strategy: 'industrielle', president: 'Wei Zhang',
    personality: { debtTolerance: 0.6, tradeOpenness: 0.7, diplomacy: 0.45, growthFocus: 0.8 } },
  { id: 'japon', name: 'Japon', code: 'JPN', color: '#f78c6b', region: 'Asie de l’Est', capital: 'Tokyo',
    pop: 124, gdp: 3800, growth: 0.6, inflation: 2.2, unemployment: 2.5, balance: -90, cash: 1000, investment: 900, debtRatio: 200, living: 80, productivity: 102,
    difficulty: 2, regime: 'Monarchie constitutionnelle',
    endow: { food: 0.3, energy: 0.25, oil: 0.05, gas: 0.1, minerals: 0.15, materials: 0.15 },
    sectors: { agriculture: 3, industry: 24, energy: 5, services: 54, tech: 14 }, industryIndex: 1.45, techIndex: 2.2, infra: 7, tax: 20, corp: 17, tariff: 3, rate: 1.8,
    spending: { health: 4.2, education: 3.2, transport: 2.4, energy: 2.0, industry: 1.4, agriculture: 0.8, research: 2.4, social: 4.0 },
    popularity: 54, stability: 78, strategy: 'innovation', president: 'Haruto Sato',
    personality: { debtTolerance: 0.7, tradeOpenness: 0.8, stabilityFocus: 0.7 } },
  { id: 'fed-coreenne', name: 'Fédération coréenne', code: 'KOR', color: '#8338ec', region: 'Asie de l’Est', capital: 'Séoul',
    pop: 78, gdp: 1950, growth: 2.0, inflation: 2.5, unemployment: 3.5, balance: -35, cash: 410, investment: 590, debtRatio: 57, living: 74, productivity: 114,
    difficulty: 2, regime: 'République démocratique',
    endow: { food: 0.3, energy: 0.2, oil: 0.03, gas: 0.05, minerals: 0.35, materials: 0.3 },
    sectors: { agriculture: 4, industry: 27, energy: 5, services: 50, tech: 14 }, industryIndex: 1.5, techIndex: 2.3, infra: 7, tax: 19, corp: 15, tariff: 4, rate: 2.6,
    spending: { health: 3.8, education: 3.6, transport: 2.6, energy: 1.8, industry: 1.8, agriculture: 0.8, research: 2.6, social: 3.4 },
    popularity: 52, stability: 55, strategy: 'innovation', president: 'Ji-woo Park' },
  { id: 'compagnies-indes', name: 'Compagnies des Indes', code: 'CDI', color: '#3a86ff', region: 'Asie du Sud-Est', capital: 'Jakarta',
    pop: 700, gdp: 1750, growth: 4.6, inflation: 2.7, unemployment: 3.5, balance: -35, cash: 600, investment: 440, debtRatio: 50, living: 68, productivity: 120,
    difficulty: 3, regime: 'Technocratie',
    endow: { food: 0.7, energy: 0.6, oil: 0.5, gas: 0.6, minerals: 0.75, materials: 0.7 },
    sectors: { agriculture: 11, industry: 22, energy: 8, services: 52, tech: 7 }, industryIndex: 1.05, techIndex: 0.95, infra: 4, tax: 13, corp: 11, tariff: 6, rate: 4.4,
    spending: { health: 2.2, education: 2.4, transport: 2.8, energy: 1.8, industry: 1.6, agriculture: 1.4, research: 0.9, social: 2.2 },
    popularity: 54, stability: 62, strategy: 'commerciale', president: 'Raden Wijaya',
    personality: { tradeOpenness: 0.9, taxPreference: 0.2 } },
  { id: 'afrique-nord', name: 'Afrique du Nord', code: 'AFN', color: '#e9c46a', region: 'Afrique du Nord', capital: 'Le Caire',
    pop: 200, gdp: 1650, growth: 3.5, inflation: 12.0, unemployment: 9.0, balance: -65, cash: 250, investment: 300, debtRatio: 65, living: 57, productivity: 112,
    difficulty: 4, regime: 'Fédération',
    endow: { food: 0.45, energy: 0.8, oil: 0.85, gas: 0.9, minerals: 0.6, materials: 0.5 },
    sectors: { agriculture: 10, industry: 18, energy: 14, services: 52, tech: 4 }, industryIndex: 0.8, techIndex: 0.5, infra: 3, tax: 14, corp: 12, tariff: 10, rate: 5.5,
    spending: { health: 2.2, education: 2.4, transport: 2.2, energy: 2.0, industry: 1.2, agriculture: 1.6, research: 0.4, social: 2.6 },
    popularity: 50, stability: 50, strategy: 'ressources', president: 'Yasmine Benali' },
  { id: 'afrique-est', name: 'Afrique de l’Est', code: 'AFE', color: '#2a9d8f', region: 'Afrique de l’Est', capital: 'Nairobi',
    pop: 300, gdp: 720, growth: 6.0, inflation: 9.0, unemployment: 7.0, balance: -30, cash: 115, investment: 190, debtRatio: 55, living: 47, productivity: 126,
    difficulty: 5, regime: 'Fédération',
    endow: { food: 0.5, energy: 0.45, oil: 0.2, gas: 0.15, minerals: 0.7, materials: 0.6 },
    sectors: { agriculture: 18, industry: 14, energy: 6, services: 56, tech: 4 }, industryIndex: 0.6, techIndex: 0.45, infra: 2, tax: 12, corp: 11, tariff: 12, rate: 6.5,
    spending: { health: 1.8, education: 2.2, transport: 2.4, energy: 1.8, industry: 1.0, agriculture: 2.0, research: 0.3, social: 2.0 },
    popularity: 50, stability: 42, strategy: 'agricole', president: 'Amani Kariuki' },
  { id: 'afrique-subsaharienne', name: 'Afrique subsaharienne', code: 'AFS', color: '#f4a25d', region: 'Afrique de l’Ouest', capital: 'Lagos',
    pop: 800, gdp: 1450, growth: 4.8, inflation: 10.0, unemployment: 6.5, balance: -65, cash: 190, investment: 330, debtRatio: 48, living: 48, productivity: 116,
    difficulty: 5, regime: 'Fédération',
    endow: { food: 0.55, energy: 0.5, oil: 0.45, gas: 0.3, minerals: 0.85, materials: 0.75 },
    sectors: { agriculture: 17, industry: 15, energy: 7, services: 55, tech: 4 }, industryIndex: 0.65, techIndex: 0.45, infra: 2, tax: 11, corp: 10, tariff: 13, rate: 7.0,
    spending: { health: 1.6, education: 2.0, transport: 2.4, energy: 2.0, industry: 1.0, agriculture: 2.0, research: 0.3, social: 1.8 },
    popularity: 50, stability: 48, strategy: 'ressources', president: 'Ousmane Diallo' },
  { id: 'afrique-sud', name: 'Afrique du Sud', code: 'AFA', color: '#606c38', region: 'Afrique australe', capital: 'Pretoria',
    pop: 120, gdp: 780, growth: 3.0, inflation: 8.0, unemployment: 18.0, balance: -35, cash: 95, investment: 180, debtRatio: 65, living: 52, productivity: 110,
    difficulty: 4, regime: 'République démocratique',
    endow: { food: 0.55, energy: 0.6, oil: 0.1, gas: 0.15, minerals: 0.95, materials: 0.85 },
    sectors: { agriculture: 8, industry: 20, energy: 9, services: 55, tech: 6 }, industryIndex: 0.9, techIndex: 0.7, infra: 4, tax: 17, corp: 14, tariff: 8, rate: 6.0,
    spending: { health: 2.8, education: 2.8, transport: 2.2, energy: 2.0, industry: 1.2, agriculture: 1.2, research: 0.5, social: 3.4 },
    popularity: 50, stability: 58, strategy: 'ressources', president: 'Thandiwe Mokoena' },
];

/** Paires de relations spéciales (monde alternatif, diplomatie fictionnelle). */
export const SPECIAL_RELATIONS: Array<[string, string, number]> = [
  ['france', 'allemagne', 80], ['france', 'italie', 74], ['france', 'union-iberique', 70],
  ['france', 'benelux', 78], ['france', 'royaume-uni', 70], ['france', 'confederation-alpine', 72],
  ['france', 'usa', 74], ['france', 'canada', 70], ['france', 'japon', 64], ['france', 'chine', 58],
  ['france', 'russie', 50], ['france', 'afrique-nord', 62], ['france', 'afrique-subsaharienne', 60],
  ['france', 'caraibes', 58], ['france', 'grece', 62],
  ['allemagne', 'benelux', 80], ['allemagne', 'confederation-alpine', 82], ['allemagne', 'autriche-hongrie', 76],
  ['allemagne', 'tchecoslovaquie', 72], ['allemagne', 'pologne', 66], ['allemagne', 'scandinavie', 72],
  ['allemagne', 'italie', 70], ['allemagne', 'usa', 76], ['allemagne', 'chine', 66], ['allemagne', 'japon', 64],
  ['allemagne', 'royaume-uni', 72], ['allemagne', 'russie', 46], ['allemagne', 'turquie', 62],
  ['royaume-uni', 'usa', 84], ['royaume-uni', 'canada', 76], ['royaume-uni', 'australie', 78],
  ['royaume-uni', 'benelux', 74], ['royaume-uni', 'scandinavie', 74], ['royaume-uni', 'union-iberique', 66],
  ['royaume-uni', 'fed-asie-sud', 60], ['royaume-uni', 'chine', 54], ['royaume-uni', 'russie', 38],
  ['usa', 'canada', 86], ['usa', 'mexique', 62], ['usa', 'japon', 74], ['usa', 'fed-coreenne', 76],
  ['usa', 'chine', 44], ['usa', 'bresil', 62], ['usa', 'australie', 74], ['usa', 'russie', 36],
  ['usa', 'argentine', 56], ['usa', 'caraibes', 58], ['usa', 'mesopotamie', 40], ['usa', 'afrique-sud', 58],
  ['chine', 'japon', 48], ['chine', 'fed-coreenne', 55], ['chine', 'indochine', 58],
  ['chine', 'compagnies-indes', 54], ['chine', 'fed-asie-sud', 52], ['chine', 'russie', 60],
  ['chine', 'fed-europe-est', 52], ['chine', 'australie', 50], ['chine', 'afrique-subsaharienne', 56],
  ['japon', 'fed-coreenne', 60], ['japon', 'australie', 70], ['japon', 'indochine', 62],
  ['japon', 'fed-asie-sud', 58], ['japon', 'compagnies-indes', 58], ['japon', 'russie', 42],
  ['fed-coreenne', 'usa', 76], ['bresil', 'argentine', 72], ['bresil', 'grande-colombie', 66],
  ['bresil', 'pays-latins', 64], ['bresil', 'union-iberique', 62], ['bresil', 'mexique', 58],
  ['argentine', 'grande-colombie', 58], ['argentine', 'pays-latins', 66], ['argentine', 'union-iberique', 56],
  ['grande-colombie', 'pays-latins', 68], ['grande-colombie', 'caraibes', 62], ['grande-colombie', 'mexique', 60],
  ['mexique', 'pays-latins', 62], ['mexique', 'caraibes', 58], ['mexique', 'grande-colombie', 60],
  ['caraibes', 'pays-latins', 60], ['canada', 'scandinavie', 66], ['canada', 'australie', 72],
  ['canada', 'fed-coreenne', 60], ['canada', 'japon', 62], ['canada', 'mexique', 58],
  ['canada', 'fed-asie-sud', 58], ['canada', 'chine', 52],
  ['scandinavie', 'benelux', 70], ['scandinavie', 'confederation-alpine', 68], ['scandinavie', 'fed-europe-est', 56],
  ['scandinavie', 'russie', 44], ['scandinavie', 'pologne', 62],
  ['pologne', 'tchecoslovaquie', 68], ['pologne', 'fed-europe-est', 56], ['pologne', 'russie', 38],
  ['pologne', 'autriche-hongrie', 60], ['autriche-hongrie', 'tchecoslovaquie', 72],
  ['autriche-hongrie', 'yougoslavie', 58], ['autriche-hongrie', 'confederation-alpine', 78],
  ['autriche-hongrie', 'russie', 46], ['autriche-hongrie', 'turquie', 52],
  ['yougoslavie', 'grece', 58], ['yougoslavie', 'turquie', 44], ['yougoslavie', 'fed-europe-est', 52],
  ['yougoslavie', 'italie', 58], ['grece', 'turquie', 34], ['grece', 'mesopotamie', 46],
  ['grece', 'afrique-nord', 45], ['grece', 'italie', 66],
  ['turquie', 'mesopotamie', 48], ['turquie', 'russie', 42], ['turquie', 'fed-asie-sud', 50],
  ['turquie', 'afrique-nord', 48], ['turquie', 'grece', 34],
  ['mesopotamie', 'afrique-nord', 56], ['mesopotamie', 'fed-asie-sud', 50], ['mesopotamie', 'russie', 50],
  ['mesopotamie', 'chine', 52], ['afrique-nord', 'afrique-subsaharienne', 60], ['afrique-nord', 'afrique-est', 56],
  ['afrique-nord', 'afrique-sud', 52], ['afrique-nord', 'union-iberique', 52], ['afrique-nord', 'france', 62],
  ['afrique-est', 'afrique-subsaharienne', 62], ['afrique-est', 'afrique-sud', 58], ['afrique-est', 'mesopotamie', 48],
  ['afrique-est', 'fed-asie-sud', 50], ['afrique-subsaharienne', 'afrique-sud', 60],
  ['afrique-subsaharienne', 'bresil', 54], ['afrique-subsaharienne', 'fed-asie-sud', 52],
  ['afrique-sud', 'australie', 56], ['afrique-sud', 'fed-asie-sud', 52], ['afrique-sud', 'chine', 54],
  ['indochine', 'compagnies-indes', 58], ['indochine', 'fed-asie-sud', 52], ['indochine', 'australie', 54],
  ['compagnies-indes', 'australie', 60], ['compagnies-indes', 'fed-asie-sud', 55],
  ['fed-asie-sud', 'australie', 54], ['russie', 'fed-europe-est', 42], ['russie', 'mesopotamie', 50],
  ['russie', 'indochine', 54], ['russie', 'afrique-subsaharienne', 48], ['russie', 'afrique-nord', 46],
  ['italie', 'union-iberique', 66], ['italie', 'confederation-alpine', 70], ['italie', 'afrique-nord', 54],
  ['benelux', 'confederation-alpine', 70], ['benelux', 'fed-europe-est', 58],
  ['union-iberique', 'grande-colombie', 56], ['union-iberique', 'mexique', 52], ['union-iberique', 'argentine', 56],
  ['pays-latins', 'caraibes', 56], ['australie', 'canada', 72], ['australie', 'usa', 74],
];

const STRATEGY_PERSONALITY: Record<AIStrategy, Partial<AIPersonality>> = {
  industrielle: { debtTolerance: 0.45, taxPreference: 0.5, tradeOpenness: 0.7, diplomacy: 0.5, growthFocus: 0.7, stabilityFocus: 0.5, sectorFocus: { industry: 1.4, energy: 1.1 } },
  commerciale: { debtTolerance: 0.4, taxPreference: 0.3, tradeOpenness: 0.95, diplomacy: 0.8, growthFocus: 0.6, stabilityFocus: 0.5, sectorFocus: { services: 1.3, industry: 1.0 } },
  ressources: { debtTolerance: 0.35, taxPreference: 0.4, tradeOpenness: 0.75, diplomacy: 0.45, growthFocus: 0.6, stabilityFocus: 0.55, sectorFocus: { energy: 1.4, agriculture: 1.0 } },
  innovation: { debtTolerance: 0.55, taxPreference: 0.45, tradeOpenness: 0.8, diplomacy: 0.65, growthFocus: 0.8, stabilityFocus: 0.5, sectorFocus: { tech: 1.6, industry: 1.0 } },
  agricole: { debtTolerance: 0.4, taxPreference: 0.35, tradeOpenness: 0.65, diplomacy: 0.55, growthFocus: 0.5, stabilityFocus: 0.6, sectorFocus: { agriculture: 1.5 } },
  équilibrée: { debtTolerance: 0.45, taxPreference: 0.5, tradeOpenness: 0.7, diplomacy: 0.65, growthFocus: 0.6, stabilityFocus: 0.6 },
  sociale: { debtTolerance: 0.5, taxPreference: 0.75, tradeOpenness: 0.7, diplomacy: 0.75, growthFocus: 0.45, stabilityFocus: 0.8, sectorFocus: { services: 1.2 } },
  financière: { debtTolerance: 0.2, taxPreference: 0.25, tradeOpenness: 0.9, diplomacy: 0.7, growthFocus: 0.65, stabilityFocus: 0.7, sectorFocus: { services: 1.3, tech: 1.1 } },
};

const REGION_AFFINITY: Record<string, string[]> = {
  'Amérique du Nord': ['Amérique latine', 'Caraïbes', 'Amérique du Sud', 'Europe de l’Ouest'],
  'Amérique latine': ['Amérique du Nord', 'Caraïbes', 'Amérique du Sud'],
  'Caraïbes': ['Amérique du Nord', 'Amérique latine', 'Amérique du Sud'],
  'Amérique du Sud': ['Amérique latine', 'Caraïbes', 'Amérique du Nord', 'Europe du Sud'],
  'Océanie': ['Asie de l’Est', 'Asie du Sud-Est', 'Europe de l’Ouest'],
  'Europe de l’Ouest': ['Europe centrale', 'Europe du Sud', 'Europe du Nord', 'Amérique du Nord'],
  'Europe centrale': ['Europe de l’Ouest', 'Europe du Sud', 'Europe de l’Est', 'Europe du Nord'],
  'Europe du Nord': ['Europe de l’Ouest', 'Europe centrale', 'Russie'],
  'Europe du Sud': ['Europe de l’Ouest', 'Europe centrale', 'Méditerranée orientale', 'Afrique du Nord'],
  'Europe de l’Est': ['Europe centrale', 'Russie', 'Europe du Nord'],
  'Russie': ['Europe de l’Est', 'Europe du Nord', 'Asie de l’Est', 'Méditerranée orientale'],
  'Méditerranée orientale': ['Europe du Sud', 'Afrique du Nord', 'Asie du Sud', 'Russie'],
  'Asie du Sud-Est': ['Asie de l’Est', 'Asie du Sud', 'Océanie'],
  'Asie du Sud': ['Asie du Sud-Est', 'Asie de l’Est', 'Méditerranée orientale', 'Afrique de l’Est'],
  'Asie de l’Est': ['Asie du Sud-Est', 'Asie du Sud', 'Russie', 'Amérique du Nord'],
  'Afrique du Nord': ['Afrique de l’Ouest', 'Afrique de l’Est', 'Europe du Sud', 'Méditerranée orientale'],
  'Afrique de l’Est': ['Afrique du Nord', 'Afrique de l’Ouest', 'Afrique australe', 'Méditerranée orientale'],
  'Afrique de l’Ouest': ['Afrique du Nord', 'Afrique de l’Est', 'Afrique australe', 'Amérique du Sud'],
  'Afrique australe': ['Afrique de l’Ouest', 'Afrique de l’Est', 'Océanie'],
};
export { REGION_AFFINITY };

/** Débit journalier de référence par million d'habitants (unités/jour/Mhab). */
export const DEMAND_PER_CAP: Record<ResourceKey, number> = {
  food: 0.62, energy: 0.30, oil: 0.10, gas: 0.08,
  minerals: 0.05, materials: 0.10, industrial: 0.12, tech: 0.03,
};

function personalityFor(def: CountryDef): AIPersonality {
  const base = STRATEGY_PERSONALITY[def.strategy];
  const rng = makeRng(seedFrom(`ai-${def.id}`));
  return {
    strategy: def.strategy,
    debtTolerance: clamp((base.debtTolerance ?? 0.45) + (rng() - 0.5) * 0.15, 0.05, 0.95),
    taxPreference: clamp((base.taxPreference ?? 0.5) + (rng() - 0.5) * 0.15, 0.05, 0.95),
    tradeOpenness: clamp((base.tradeOpenness ?? 0.7) + (rng() - 0.5) * 0.15, 0.1, 1),
    diplomacy: clamp((base.diplomacy ?? 0.55) + (rng() - 0.5) * 0.2, 0.05, 1),
    growthFocus: clamp((base.growthFocus ?? 0.6) + (rng() - 0.5) * 0.2, 0.1, 1),
    stabilityFocus: clamp((base.stabilityFocus ?? 0.55) + (rng() - 0.5) * 0.2, 0.1, 1),
    sectorFocus: { ...(base.sectorFocus ?? {}) },
    ...(def.personality ?? {}),
  };
}

function buildResources(def: CountryDef, rng: () => number): Record<ResourceKey, ResourceState> {
  const out = {} as Record<ResourceKey, ResourceState>;
  for (const key of RESOURCE_KEYS) {
    const endow = def.endow[key] ?? 0.3;
    let prodPerCap: number;
    switch (key) {
      case 'food': prodPerCap = DEMAND_PER_CAP.food * (0.42 + endow * 1.15); break;
      case 'energy': prodPerCap = DEMAND_PER_CAP.energy * (0.45 + endow * 1.05) * (1 + (def.sectors.energy - 6) * 0.02); break;
      case 'oil': prodPerCap = DEMAND_PER_CAP.oil * (0.35 + endow * 1.3); break;
      case 'gas': prodPerCap = DEMAND_PER_CAP.gas * (0.35 + endow * 1.3); break;
      case 'minerals': prodPerCap = DEMAND_PER_CAP.minerals * (0.35 + endow * 1.35); break;
      case 'materials': prodPerCap = DEMAND_PER_CAP.materials * (0.35 + endow * 1.3); break;
      case 'industrial': prodPerCap = DEMAND_PER_CAP.industrial * (0.55 + def.industryIndex * 0.55); break;
      case 'tech': prodPerCap = DEMAND_PER_CAP.tech * (0.4 + def.techIndex * 0.75); break;
    }
    const consumption = round(def.pop * DEMAND_PER_CAP[key] * (0.9 + rng() * 0.2), 2);
    const production = round(def.pop * prodPerCap * (0.9 + rng() * 0.2), 2);
    const capacity = round(Math.max(consumption * 45, 10), 1);
    const price = round(RESOURCE_MAP[key].basePrice * (0.92 + rng() * 0.16), 3);
    out[key] = { stock: round(capacity * (0.5 + rng() * 0.25), 1), capacity, production, consumption, price };
  }
  return out;
}

function buildInfra(def: CountryDef, rng: () => number): Record<InfraKey, { level: number }> {
  const out = {} as Record<InfraKey, { level: number }>;
  for (const i of INFRA) {
    const level = clamp(Math.round(def.infra + (rng() - 0.5) * 2.2), 1, i.maxLevel - 1);
    out[i.key] = { level };
  }
  return out;
}

function baseRelationScore(defA: CountryDef, defB: CountryDef, rng: () => number): number {
  let score = 48 + rng() * 10;
  if (defA.region === defB.region) score += 10;
  else if ((REGION_AFFINITY[defA.region] ?? []).includes(defB.region)) score += 5;
  return clamp(Math.round(score), 25, 82);
}

export interface SeedResult {
  countries: Country[];
  meta: WorldMeta;
  market: Record<ResourceKey, MarketResource>;
}

export function buildSeedWorld(now = Date.now()): SeedResult {
  const rng = makeRng(WORLD_SEED);
  const byId = new Map(COUNTRY_DEFS.map((d) => [d.id, d]));
  const countries: Country[] = [];

  for (const def of COUNTRY_DEFS) {
    const crng = makeRng(seedFrom(`country-${def.id}`));
    const debt = round(def.gdp * (def.debtRatio / 100), 1);
    const policy: PolicyState = {
      taxRate: def.tax,
      corporateTax: def.corp,
      tariff: def.tariff,
      interestRate: def.rate,
      spending: {
        health: def.spending.health ?? 3,
        education: def.spending.education ?? 2.8,
        transport: def.spending.transport ?? 2.2,
        energy: def.spending.energy ?? 1.6,
        industry: def.spending.industry ?? 1.2,
        agriculture: def.spending.agriculture ?? 1.2,
        research: def.spending.research ?? 1.0,
        social: def.spending.social ?? 3,
      },
    };
    const sectors = {} as Country['sectors'];
    (Object.keys(def.sectors) as SectorKey[]).forEach((k) => {
      sectors[k] = {
        output: round((def.gdp * def.sectors[k]) / 100, 1),
        capacity: round(85 + crng() * 25, 1),
        employment: round(def.sectors[k] * 1.1, 1),
      };
    });
    const consumptionIndex = round(clamp(60 + def.living * 0.45 + crng() * 6, 50, 130), 1);
    // Recettes cohérentes avec la fiscalité ; dépenses déduites du solde réel
    const taxBase = def.gdp * (0.85 + consumptionIndex / 600);
    const revenue = round((taxBase * (def.tax * 0.55 + def.corp * 0.25)) / 100, 1);
    const spending = round(revenue - def.balance, 1);
    const country: Country = {
      id: def.id,
      name: def.name,
      code: def.code,
      color: def.color,
      region: def.region,
      capital: def.capital,
      difficulty: def.difficulty,
      createdAt: now,
      updatedAt: now,
      population: def.pop,
      controller: { kind: 'ai', userId: null, presidentName: def.president, since: now, sinceDay: 0 },
      regime: def.regime,
      economy: {
        gdp: def.gdp,
        growth: def.growth,
        growthPotential: def.growth,
        inflation: def.inflation,
        unemployment: def.unemployment,
        productivity: def.productivity,
        consumptionIndex,
        investment: def.investment,
        standardOfLiving: def.living,
        cash: def.cash,
        debt,
        revenue,
        spending,
        balance: def.balance,
        interestPaid: round(debt * (def.rate / 100) * 0.8, 1),
      },
      policy,
      sectors,
      resources: buildResources(def, crng),
      endowment: { ...def.endow },
      infra: buildInfra(def, crng),
      projects: [],
      laws: [],
      relations: {},
      popularity: def.popularity,
      stability: def.stability,
      mandate: { lowPopularityTicks: 0, risk: 'faible', warningsSent: 0, popularityTrend: 0 },
      tariffOverrides: {},
      actionCooldowns: {},
      routePrefs: {},
      productionDirectives: {},
      facilities: emptyFacilities(),
      regimeSinceDay: 0,
      regimeHoneymoon: null,
      ai: {
        personality: personalityFor(def),
        lastDecisionTick: 0,
        nextDecisionTick: 1 + Math.floor(crng() * 6),
        lastActionDay: 0,
        recentProblems: [],
        learned: {},
        lastMoves: [],
        memory: null,
      },
      series: [],
      history: [],
      alerts: [],
      activeEvents: [],
      transactions: [],
    };
    countries.push(country);
  }

  // Relations : matrice symétrique
  for (let i = 0; i < countries.length; i++) {
    for (let j = i + 1; j < countries.length; j++) {
      const a = countries[i]!;
      const b = countries[j]!;
      let score = baseRelationScore(byId.get(a.id)!, byId.get(b.id)!, rng);
      const special = SPECIAL_RELATIONS.find(
        ([x, y]) => (x === a.id && y === b.id) || (x === b.id && y === a.id),
      );
      if (special) score = special[2];
      const trust = clamp(score + Math.round((rng() - 0.5) * 12), 10, 95);
      const mk = (): Relation => ({
        score,
        trust,
        sanctionByUs: false,
        sanctionByThem: false,
        agreements: [],
        tradeVolume: 0,
        lastContactDay: 0,
      });
      a.relations[b.id] = mk();
      b.relations[a.id] = mk();
    }
  }
  // Quelques accords préexistants pour un monde vivant dès le départ
  const preAgreements: Array<[string, string, Agreement['type']]> = [
    ['france', 'allemagne', 'free_trade'], ['france', 'benelux', 'free_trade'],
    ['allemagne', 'benelux', 'free_trade'], ['allemagne', 'confederation-alpine', 'economic_treaty'],
    ['allemagne', 'autriche-hongrie', 'free_trade'], ['italie', 'france', 'economic_treaty'],
    ['union-iberique', 'france', 'free_trade'], ['usa', 'canada', 'free_trade'],
    ['usa', 'mexique', 'free_trade'], ['japon', 'fed-coreenne', 'tech_cooperation'],
    ['chine', 'indochine', 'trade_zone'], ['bresil', 'argentine', 'free_trade'],
    ['scandinavie', 'benelux', 'economic_treaty'], ['australie', 'japon', 'free_trade'],
    ['royaume-uni', 'usa', 'economic_treaty'], ['turquie', 'autriche-hongrie', 'trade_zone'],
  ];
  for (const [aId, bId, type] of preAgreements) {
    const a = countries.find((c) => c.id === aId);
    const b = countries.find((c) => c.id === bId);
    if (!a || !b) continue;
    const ag: Agreement = { id: `ag_seed_${aId}_${bId}_${type}`, type, status: 'active', fromId: aId, toId: bId, createdDay: -30, expiresDay: null };
    a.relations[bId]?.agreements.push(ag);
    b.relations[aId]?.agreements.push({ ...ag });
    if (a.relations[bId]) a.relations[bId]!.score = clamp(a.relations[bId]!.score + 4, 0, 100);
    if (b.relations[aId]) b.relations[aId]!.score = clamp(b.relations[aId]!.score + 4, 0, 100);
  }

  const market = {} as Record<ResourceKey, MarketResource>;
  for (const key of RESOURCE_KEYS) {
    const prices = countries.map((c) => c.resources[key].price);
    const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
    market[key] = {
      key,
      price: round(avg, 3),
      prevPrice: round(avg, 3),
      change24h: 0,
      series: new Array(24).fill(round(avg, 3)),
    };
  }

  const meta: WorldMeta = {
    version: 1,
    tick: 0,
    day: 0,
    startedAt: now,
    lastTickAt: now,
    lastTickDurationMs: 0,
    simVersion: SIM_VERSION,
    seededAt: now,
    leaderId: null,
    integrityIssues: 0,
    lastError: null,
    lastErrorAt: null,
  };

  const openingEntry: JournalEntry = {
    id: 'jrn_seed',
    day: 0,
    ts: now,
    type: 'event',
    countryIds: [],
    actor: 'Système',
    text: 'Le monde GEOPOLIS est initialisé : 36 nations, données macroéconomiques réelles, une économie vivante.',
  };
  for (const c of countries) {
    c.history.push({ ...openingEntry, countryIds: [c.id] });
  }

  return { countries, meta, market };
}

/* ------------------------------------------------------------------ */
/* Routes commerciales stratégiques (corridors) — catalogue initial    */
/* ------------------------------------------------------------------ */
import type { TradeCorridor } from 'shared';

export const CORRIDOR_DEFS: Omit<TradeCorridor, 'owner' | 'toll' | 'traffic'>[] = [
  { id: 'canal_panama', name: 'Canal de Panama', description: 'Trait d’union Pacifique ↔ Atlantique entre les deux Amériques.', purchaseCost: 180, upkeep: 6, hubs: ['mexique', 'grande-colombie'], regions: ['Amérique du Nord', 'Amérique du Sud'] },
  { id: 'canal_suez', name: 'Canal de Suez', description: 'Porte entre l’Afrique du Nord et la Mésopotamie / l’Orient.', purchaseCost: 200, upkeep: 7, hubs: ['afrique-nord', 'mesopotamie'], regions: ['Afrique du Nord', 'Méditerranée orientale'] },
  { id: 'detroit_malacca', name: 'Détroit de Malacca', description: 'Artère vitale du commerce d’Asie du Sud-Est.', purchaseCost: 220, upkeep: 7, hubs: ['fed-asie-sud', 'compagnies-indes'], regions: ['Asie du Sud', 'Asie du Sud-Est'] },
  { id: 'atlantique_nord', name: 'Route transatlantique Nord', description: 'Liaison Europe de l’Ouest ↔ Amérique du Nord.', purchaseCost: 140, upkeep: 5, hubs: ['france', 'usa'], regions: ['Europe de l’Ouest', 'Amérique du Nord'] },
  { id: 'mer_baltique', name: 'Voie baltique', description: 'Couloir maritime Europe du Nord ↔ Europe centrale/orientale.', purchaseCost: 90, upkeep: 3, hubs: ['scandinavie', 'pologne'], regions: ['Europe du Nord', 'Europe centrale'] },
  { id: 'ocean_indien', name: 'Route de l’océan Indien', description: 'Afrique de l’Est ↔ Asie du Sud, voie des matières premières.', purchaseCost: 120, upkeep: 4, hubs: ['afrique-est', 'fed-asie-sud'], regions: ['Afrique de l’Est', 'Asie du Sud'] },
  { id: 'pacifique', name: 'Voie du Pacifique', description: 'Asie de l’Est ↔ Amérique du Nord, flux industriels majeurs.', purchaseCost: 190, upkeep: 6, hubs: ['japon', 'usa'], regions: ['Asie de l’Est', 'Amérique du Nord'] },
  { id: 'mediterranee', name: 'Voie méditerranéenne', description: 'Europe du Sud ↔ Afrique du Nord, cabotage dense.', purchaseCost: 100, upkeep: 3, hubs: ['italie', 'afrique-nord'], regions: ['Europe du Sud', 'Afrique du Nord'] },
  { id: 'route_soie', name: 'Route de la soie moderne', description: 'Corridor continental Asie de l’Est ↔ Europe de l’Est.', purchaseCost: 240, upkeep: 8, hubs: ['chine', 'russie'], regions: ['Asie de l’Est', 'Europe de l’Est'] },
  { id: 'cap_horn', name: 'Route du cap Horn', description: 'Amérique du Sud ↔ Océanie, voie australe des minerais.', purchaseCost: 110, upkeep: 4, hubs: ['argentine', 'australie'], regions: ['Amérique du Sud', 'Océanie'] },
  { id: 'manche_mer_nord', name: 'Manche & mer du Nord', description: 'Cabotage européen de l’Ouest : le cœur commercial du continent.', purchaseCost: 70, upkeep: 2, hubs: ['france', 'allemagne'], regions: ['Europe de l’Ouest', 'Europe de l’Ouest'] },
  { id: 'mer_de_chine', name: 'Mer de Chine orientale', description: 'Voie industrielle d’Asie de l’Est : Chine, Japon, Corée.', purchaseCost: 95, upkeep: 3, hubs: ['chine', 'japon'], regions: ['Asie de l’Est', 'Asie de l’Est'] },
  /* ---- Réseau étendu : TOUTES les régions reliées, aucune voie directe ---- */
  { id: 'steppe_eurasienne', name: 'Route de la steppe eurasiatique', description: 'Corridor continental Russie ↔ Europe de l’Est : céréales, énergie, minerais.', purchaseCost: 130, upkeep: 4, hubs: ['russie', 'fed-europe-est'], regions: ['Russie', 'Europe de l’Est'] },
  { id: 'siberie', name: 'Route sibérienne', description: 'Liaison Russie ↔ Asie de l’Est par le nord : énergie et matières premières.', purchaseCost: 150, upkeep: 5, hubs: ['russie', 'chine'], regions: ['Russie', 'Asie de l’Est'] },
  { id: 'andes', name: 'Route des Andes', description: 'Cordillère traversée : Amérique latine ↔ Amérique du Sud, métaux et denrées.', purchaseCost: 95, upkeep: 3, hubs: ['pays-latins', 'grande-colombie'], regions: ['Amérique latine', 'Amérique du Sud'] },
  { id: 'antilles', name: 'Route des Antilles', description: 'Mer des Caraïbes septentrionale : Antilles ↔ Amérique du Nord, canal de transit.', purchaseCost: 80, upkeep: 3, hubs: ['caraibes', 'mexique'], regions: ['Caraïbes', 'Amérique du Nord'] },
  { id: 'caraibes_latine', name: 'Mer des Caraïbes', description: 'Voie antillaise vers le continent latin : sucre, fruits, conteneurs.', purchaseCost: 85, upkeep: 3, hubs: ['caraibes', 'pays-latins'], regions: ['Caraïbes', 'Amérique latine'] },
  { id: 'transsaharienne', name: 'Route transsaharienne', description: 'Golfe de Guinée ↔ Afrique du Nord : la diagonale du désert modernisée.', purchaseCost: 90, upkeep: 3, hubs: ['afrique-subsaharienne', 'afrique-nord'], regions: ['Afrique de l’Ouest', 'Afrique du Nord'] },
  { id: 'atlantique_sud', name: 'Route de l’Atlantique Sud', description: 'Traversée Afrique de l’Ouest ↔ Amérique du Sud : minerais, pétrole, denrées.', purchaseCost: 130, upkeep: 4, hubs: ['afrique-subsaharienne', 'bresil'], regions: ['Afrique de l’Ouest', 'Amérique du Sud'] },
  { id: 'route_du_cap', name: 'Route du Cap', description: 'Cabotage atlantique Afrique de l’Ouest ↔ Afrique australe.', purchaseCost: 95, upkeep: 3, hubs: ['afrique-subsaharienne', 'afrique-sud'], regions: ['Afrique de l’Ouest', 'Afrique australe'] },
  { id: 'cap_bonne_esperance', name: 'Route du cap de Bonne-Espérance', description: 'Afrique australe ↔ Afrique de l’Est : la voie des deux océans.', purchaseCost: 100, upkeep: 3, hubs: ['afrique-sud', 'afrique-est'], regions: ['Afrique australe', 'Afrique de l’Est'] },
  { id: 'mer_arabie', name: 'Route de la mer d’Arabie', description: 'Mésopotamie ↔ Asie du Sud : hydrocarbures contre produits manufacturés.', purchaseCost: 140, upkeep: 5, hubs: ['mesopotamie', 'fed-asie-sud'], regions: ['Méditerranée orientale', 'Asie du Sud'] },
  { id: 'ionienne', name: 'Mer Ionienne & Méditerranée orientale', description: 'Europe du Sud ↔ détroits turcs : cabotage méditerranéen oriental.', purchaseCost: 85, upkeep: 3, hubs: ['grece', 'turquie'], regions: ['Europe du Sud', 'Méditerranée orientale'] },
  { id: 'arc_atlantique', name: 'Arc atlantique européen', description: 'Europe de l’Ouest ↔ Europe du Sud : la façade atlantique du continent.', purchaseCost: 75, upkeep: 2, hubs: ['france', 'union-iberique'], regions: ['Europe de l’Ouest', 'Europe du Sud'] },
  { id: 'danube', name: 'Corridor du Danube', description: 'Europe centrale ↔ Europe de l’Est : le grand fleuve commercial.', purchaseCost: 80, upkeep: 3, hubs: ['autriche-hongrie', 'fed-europe-est'], regions: ['Europe centrale', 'Europe de l’Est'] },
  { id: 'arafura', name: 'Route de la mer d’Arafura', description: 'Asie du Sud-Est ↔ Océanie : épices, minerais, gaz austral.', purchaseCost: 105, upkeep: 4, hubs: ['compagnies-indes', 'australie'], regions: ['Asie du Sud-Est', 'Océanie'] },
  /* ---- Voies intérieures (cabotage intra-régional) ---- */
  { id: 'grands_lacs', name: 'Grands Lacs & artère continentale', description: 'Voie intérieure d’Amérique du Nord : fleuve, lacs et rail transcontinental.', purchaseCost: 85, upkeep: 3, hubs: ['canada', 'usa'], regions: ['Amérique du Nord', 'Amérique du Nord'] },
  { id: 'amazonie', name: 'Route amazonienne & du Río de la Plata', description: 'Voie intérieure d’Amérique du Sud : fleuves amazoniens et platéens.', purchaseCost: 80, upkeep: 3, hubs: ['bresil', 'argentine'], regions: ['Amérique du Sud', 'Amérique du Sud'] },
  { id: 'adriatique', name: 'Mer Adriatique & Ionienne', description: 'Cabotage d’Europe du Sud : péninsules italienne et balkanique.', purchaseCost: 70, upkeep: 2, hubs: ['italie', 'grece'], regions: ['Europe du Sud', 'Europe du Sud'] },
  { id: 'mitteleuropa', name: 'Route de Mitteleuropa', description: 'Voie intérieure d’Europe centrale : Alpes, plaines et fleuves.', purchaseCost: 75, upkeep: 2, hubs: ['autriche-hongrie', 'pologne'], regions: ['Europe centrale', 'Europe centrale'] },
  { id: 'detroits_turcs', name: 'Détroits turcs (Bosphore)', description: 'Verrou de la mer Noire : tout transit passe sous les ponts d’Istanbul.', purchaseCost: 110, upkeep: 4, hubs: ['turquie', 'mesopotamie'], regions: ['Méditerranée orientale', 'Méditerranée orientale'] },
  { id: 'mer_chine_meridionale', name: 'Mer de Chine méridionale', description: 'Voie intérieure d’Asie du Sud-Est : l’usine maritime du monde.', purchaseCost: 120, upkeep: 4, hubs: ['indochine', 'compagnies-indes'], regions: ['Asie du Sud-Est', 'Asie du Sud-Est'] },
];

export function buildCorridors(): TradeCorridor[] {
  return CORRIDOR_DEFS.map((d) => ({ ...d, owner: null, toll: 0, traffic: 0 }));
}
