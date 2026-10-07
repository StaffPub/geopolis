/**
 * GEOPOLIS — Helpers de formatage (partagés client/serveur, sans dépendances).
 */

export function formatMoney(billions: number, currency = '€'): string {
  if (!isFinite(billions)) return `— ${currency}`;
  const abs = Math.abs(billions);
  if (abs >= 1000) return `${(billions / 1000).toFixed(2)} T ${currency}`;
  if (abs >= 1) return `${billions.toFixed(1)} Md ${currency}`;
  return `${(billions * 1000).toFixed(0)} M ${currency}`;
}

export function formatPopulation(millions: number): string {
  if (!isFinite(millions)) return '—';
  if (millions >= 1000) return `${(millions / 1000).toFixed(2)} Md`;
  return `${millions.toFixed(1)} M`;
}

export function formatPercent(v: number, digits = 1): string {
  if (!isFinite(v)) return '—';
  return `${v >= 0 ? '' : ''}${v.toFixed(digits)} %`;
}

export function formatSigned(v: number, digits = 1, suffix = ''): string {
  if (!isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}${suffix}`;
}

export function formatCompact(v: number): string {
  if (!isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)} G`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)} M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)} k`;
  return v.toFixed(abs < 10 ? 1 : 0);
}

export function relationLabel(score: number): { label: string; tone: 'good' | 'neutral' | 'bad' | 'tense' } {
  if (score >= 80) return { label: 'Excellentes', tone: 'good' };
  if (score >= 65) return { label: 'Très bonnes', tone: 'good' };
  if (score >= 52) return { label: 'Bonnes', tone: 'neutral' };
  if (score >= 42) return { label: 'Neutres', tone: 'neutral' };
  if (score >= 30) return { label: 'Tendues', tone: 'tense' };
  return { label: 'Très tendues', tone: 'bad' };
}

export function riskTone(risk: string): 'good' | 'warn' | 'danger' {
  switch (risk) {
    case 'faible': return 'good';
    case 'modéré': return 'warn';
    default: return 'danger';
  }
}

/** Jour de simulation → date fictive lisible (An 1, mois, jour). */
export function worldDate(day: number): string {
  const MONTHS = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ];
  const d = Math.max(0, Math.floor(day));
  const year = Math.floor(d / 360) + 1;
  const rem = d % 360;
  const month = Math.floor(rem / 30);
  const md = (rem % 30) + 1;
  return `${md} ${MONTHS[month]} · An ${year}`;
}

export function formatDuration(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}
