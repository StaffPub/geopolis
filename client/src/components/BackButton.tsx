/**
 * GEOPOLIS — Bouton « retour » 3D animé (flèche qui pivote au survol,
 * enfoncement au clic). Utilisé sur Profil, Paramètres, Admin, etc.
 */
import { useNavigate } from 'react-router-dom';

export function BackButton({ to, label = 'Retour' }: { to?: string; label?: string }) {
  const navigate = useNavigate();
  return (
    <button
      className="back3d"
      onClick={() => (to ? navigate(to) : navigate(-1))}
      aria-label={label}
    >
      <span className="back3d-arrow" aria-hidden="true">←</span>
      <span className="back3d-label">{label}</span>
    </button>
  );
}
