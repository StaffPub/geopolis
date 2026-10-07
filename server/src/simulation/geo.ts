/**
 * GEOPOLIS — Distance géographique normalisée entre pays (centroïdes de la
 * carte locale). Sert au fret de la voie directe et aux combinaisons de routes.
 */
import { CENTROID_BY_ID } from './geo-data.js';

export function CENTROID_DISTANCE(a: string, b: string): number {
  const pa = CENTROID_BY_ID.get(a);
  const pb = CENTROID_BY_ID.get(b);
  if (!pa || !pb) return 1;
  const dx = pa[0] - pb[0];
  const dy = pa[1] - pb[1];
  return Math.min(1.4, Math.sqrt(dx * dx + dy * dy) / 500);
}
