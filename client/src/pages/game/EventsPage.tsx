/**
 * GEOPOLIS — Page Événements v2 : lisible et simple.
 * Filtres en 1 clic (Mon pays / Diplomatie / Économie / Tous), cartes claires
 * avec durée restante, effets en langage simple et source de l'événement
 * (y compris les événements déclenchés par les actions diplomatiques réelles).
 */
import { useMemo, useState } from 'react';
import { useAuth } from '../../state/AuthContext.js';
import { useGame } from '../../state/GameContext.js';
import { InfoTip } from '../../components/InfoTip.js';
import { Badge, EmptyState, GlassCard, PageHeader, ProgressBar } from '../../components/ui.js';

type Filter = 'all' | 'mine' | 'diplomacy' | 'economy';

const DIPLO_IDS = new Set(['diplomatic_accord', 'trade_tension', 'economic_thaw', 'cooperation_wave', 'tech_partnership']);

function effectChips(m: import('shared').EventModifiers): { text: string; good: boolean }[] {
  const out: { text: string; good: boolean }[] = [];
  if (m.growthDelta) out.push({ text: `Croissance ${m.growthDelta > 0 ? '+' : ''}${m.growthDelta.toFixed(1)} pt`, good: m.growthDelta > 0 });
  if (m.inflationDelta) out.push({ text: `Inflation ${m.inflationDelta > 0 ? '+' : ''}${m.inflationDelta.toFixed(1)} pt`, good: m.inflationDelta < 0 });
  if (m.popularityDelta) out.push({ text: `Popularité ${m.popularityDelta > 0 ? '+' : ''}${(m.popularityDelta * 7).toFixed(1)} %/sem`, good: m.popularityDelta > 0 });
  if (m.stabilityDelta) out.push({ text: `Stabilité ${m.stabilityDelta > 0 ? '+' : ''}${(m.stabilityDelta * 7).toFixed(1)} %/sem`, good: m.stabilityDelta > 0 });
  if (m.unemploymentDelta) out.push({ text: `Chômage ${m.unemploymentDelta > 0 ? '+' : ''}${m.unemploymentDelta.toFixed(1)} pt`, good: m.unemploymentDelta < 0 });
  for (const [k, v] of Object.entries(m.productionMul ?? {})) out.push({ text: `Production ${k} ×${(v as number).toFixed(2)}`, good: (v as number) >= 1 });
  for (const [k, v] of Object.entries(m.priceMul ?? {})) out.push({ text: `Prix ${k} ×${(v as number).toFixed(2)}`, good: (v as number) <= 1 });
  return out;
}

export function EventsPage() {
  const { countries, events, meta } = useGame();
  const { countryId } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const nameOf = useMemo(() => new Map(countries.map((c) => [c.id, c])), [countries]);

  const day = meta?.day ?? 0;

  const list = useMemo(() => {
    let l = [...events].sort((a, b) => a.endsDay - b.endsDay);
    if (filter === 'mine' && countryId) l = l.filter((e) => e.countryIds.includes(countryId));
    if (filter === 'diplomacy') l = l.filter((e) => DIPLO_IDS.has(e.eventId));
    if (filter === 'economy') l = l.filter((e) => !DIPLO_IDS.has(e.eventId));
    return l;
  }, [events, filter, countryId]);

  return (
    <div className="page">
      <PageHeader
        icon="⚡"
        title="Événements du monde"
        subtitle="12 événements conditionnels déclenchés par l'état RÉEL des nations (pénuries, surchauffe, tensions sociales…) — jamais de hasard pur. Chacun applique des modificateurs temporaires visibles sur les cartes des pays touchés, jusqu'à sa date de fin."
        chips={<>
          <Badge tone={events.length > 0 ? 'warn' : 'good'}>{events.length} événement(s) en cours</Badge>
          <Badge tone="info">Déclenchement = causes réelles</Badge>
        </>}
        right={
          <div className="tabs">
            {([['all', `Tous (${events.length})`], ['mine', 'Mon pays'], ['diplomacy', 'Diplomatie'], ['economy', 'Économie']] as const).map(([id, label]) => (
              <button key={id} className={`tab ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
        }
      />

      <p className="tiny muted" style={{ marginTop: -8 }}>
        Les événements naissent de l'état réel des pays (pénuries, crises, booms) et des actions diplomatiques
        (accords signés, mesures économiques, aides). Ils durent quelques jours de monde puis s'éteignent.
      </p>

      {list.length === 0 && (
        <GlassCard>
          <EmptyState
            title="Aucun événement pour ce filtre"
            hint="Le monde est calme… pour l'instant. Les pénuries, crises et signatures d'accords créeront les prochains."
            icon="⚡"
          />
        </GlassCard>
      )}

      <div className="grid grid-2 stagger">
        {list.map((ev) => {
          const total = Math.max(1, ev.endsDay - ev.startedDay);
          const remaining = Math.max(0, ev.endsDay - day);
          const mine = !!countryId && ev.countryIds.includes(countryId);
          const isDiplo = DIPLO_IDS.has(ev.eventId);
          const chips = effectChips(ev.modifiers);
          const names = ev.countryIds.map((id) => nameOf.get(id)?.name ?? id);
          return (
            <GlassCard key={ev.id} className="event-card anim-fade-up" style={mine ? { borderLeft: '3px solid var(--accent-pink)' } : undefined}>
              <div className="row-between">
                <strong>{isDiplo ? '🤝' : '⚡'} {ev.title}</strong>
                <Badge tone={remaining <= 3 ? 'warn' : mine ? 'pink' : 'neutral'}>
                  {remaining <= 3 ? `FIN DANS ${remaining} j` : mine ? 'MON PAYS' : `${remaining} j`}
                </Badge>
              </div>

              <div className="tiny muted mt-8">
                {names.join(' + ')} · depuis le jour {ev.startedDay}
              </div>

              <p className="small mt-8" style={{ marginBottom: 6 }}>{ev.description}</p>

              <div className="tiny" style={{ color: 'var(--accent-cyan)' }}>Cause : {ev.source}</div>

              {chips.length > 0 && (
                <div className="row wrap mt-8" style={{ gap: 6 }}>
                  {chips.slice(0, 5).map((chip, i) => (
                    <Badge key={i} tone={chip.good ? 'good' : 'danger'}>{chip.text}</Badge>
                  ))}
                </div>
              )}

              <div className="mt-8">
                <ProgressBar value={total - remaining} max={total} height={5} tone={remaining <= 3 ? 'warn' : 'default'} />
              </div>
            </GlassCard>
          );
        })}
      </div>

      <GlassCard className="mt-16">
        <div className="row-between">
          <span className="small muted">Comment lire cette page ?</span>
          <InfoTip text="Chaque carte = un événement ACTIF appliqué par le moteur pendant sa durée. « Cause » indique le fait réel qui l'a déclenché (ex. : accord signé entre deux pays, stock énergétique critique…)." />
        </div>
      </GlassCard>
    </div>
  );
}
