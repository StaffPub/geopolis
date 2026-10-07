/**
 * GEOPOLIS — Page Historique : journal mondial filtrable + historique des
 * décisions du président (comprendre pourquoi l'économie évolue).
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../state/AuthContext.js';
import { useGame } from '../../state/GameContext.js';
import { game as gameApi } from '../../lib/api';
import type { JournalEntry, JournalType } from 'shared';
import { Badge, EmptyState, GlassCard, PageHeader, Spinner } from '../../components/ui.js';

const TYPE_LABELS: Record<string, string> = {
  economy: 'Économie',
  politics: 'Politique',
  diplomacy: 'Diplomatie',
  trade: 'Commerce',
  infrastructure: 'Infra',
  event: 'Événement',
  population: 'Population',
  mandate: 'Mandat',
  ai: 'IA',
  admin: 'Admin',
};

const TYPE_TONES: Record<string, 'good' | 'warn' | 'danger' | 'info' | 'violet' | 'pink' | 'neutral'> = {
  economy: 'info', politics: 'violet', diplomacy: 'pink', trade: 'good',
  infrastructure: 'neutral', event: 'warn', population: 'neutral', mandate: 'danger', ai: 'info', admin: 'danger',
};

export function HistoryPage() {
  const { countryId } = useAuth();
  const { myCountry, countries } = useGame();
  const [scope, setScope] = useState<'world' | 'country'>('country');
  const [type, setType] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<string>('all');
  const [worldEntries, setWorldEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const c = myCountry && myCountry.id === countryId ? myCountry : null;
  const nameOf = useMemo(() => new Map(countries.map((x) => [x.id, x])), [countries]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    gameApi
      .journal({
        limit: 160,
        type: type !== 'all' ? type : undefined,
        country: scope === 'country' && c ? c.id : undefined,
        q: search || undefined,
      })
      .then((r) => !cancelled && setWorldEntries(r.entries))
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [type, search, scope, c?.id, c]);

  const entries = useMemo(() => {
    let list = scope === 'country' && c ? [...c.history].reverse().concat(worldEntries.filter((e) => !c.history.some((h) => h.id === e.id))) : worldEntries;
    if (scope === 'country' && c) list = list.filter((e) => e.countryIds.includes(c.id));
    if (type !== 'all') list = list.filter((e) => e.type === (type as JournalType));
    if (period !== 'all' && c) {
      const day = Math.max(0, ...(c.series.map((s) => s.day), [0]));
      const span = period === '7' ? 7 : period === '30' ? 30 : 90;
      list = list.filter((e) => e.day >= day - span);
    }
    if (search) list = list.filter((e) => e.text.toLowerCase().includes(search.toLowerCase()));
    // dédoublonne par id
    const seen = new Set<string>();
    return list.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).slice(0, 160);
  }, [scope, c, worldEntries, type, period, search]);

  return (
    <div className="page">
      <PageHeader
        icon="🗃️"
        title="Historique & journal"
        subtitle="Chaque décision, transaction, chantier, accord et crise laisse une trace horodatée (jour de monde + heure réelle). Filtrez par pays, type ou période, recherchez un mot-clé : c'est la mémoire complète du monde."
        chips={<>
          <Badge tone="info">{scope === 'country' ? 'Focus : votre pays' : 'Journal mondial'}</Badge>
        </>}
        right={
          <div className="row wrap" style={{ gap: 8 }}>
            <div className="tabs">
              {c && <button className={`tab ${scope === 'country' ? 'active' : ''}`} onClick={() => setScope('country')}>Mon pays</button>}
              <button className={`tab ${scope === 'world' ? 'active' : ''}`} onClick={() => setScope('world')}>Journal mondial</button>
            </div>
            <select className="input" style={{ width: 'auto', padding: '6px 10px', minHeight: 34 }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Filtrer par type">
              <option value="all">Tous les types</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select className="input" style={{ width: 'auto', padding: '6px 10px', minHeight: 34 }} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Filtrer par période">
              <option value="all">Toute période</option>
              <option value="7">7 derniers jours</option>
              <option value="30">30 derniers jours</option>
              <option value="90">90 derniers jours</option>
            </select>
            <input className="input" style={{ width: 200, padding: '6px 10px', minHeight: 34 }} placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher dans le journal" />
          </div>
        }
      />

      <GlassCard>
        {loading && <Spinner label="Chargement du journal…" />}
        {!loading && entries.length === 0 && <EmptyState title="Aucune entrée pour ces filtres" hint="Le monde continue d'écrire son histoire…" icon="📜" />}
        <div className="col">
          {!loading && entries.map((e) => (
            <div key={e.id} className="row-between small anim-fade-in" style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', gap: 12 }}>
              <span className="tiny muted mono" style={{ whiteSpace: 'nowrap', minWidth: 92 }}>
                J{e.day} · {new Date(e.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <Badge tone={TYPE_TONES[e.type] ?? 'neutral'}>{TYPE_LABELS[e.type] ?? e.type}</Badge>
              <span style={{ flex: 1 }}>{e.text}</span>
              {scope === 'world' && (
                <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>
                  {e.countryIds.map((id) => nameOf.get(id)?.code ?? id).join(' · ')}
                </span>
              )}
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
