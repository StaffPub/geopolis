/**
 * GEOPOLIS — Page Carte mondiale : carte interactive + panneau pays.
 */
import { useState } from 'react';
import { useAuth } from '../../state/AuthContext.js';
import { useGame } from '../../state/GameContext.js';
import { WorldMap, type MapMode } from '../../components/WorldMap.js';
import { CountryPanel } from '../../components/CountryPanel.js';
import { Badge, PageHeader } from '../../components/ui.js';

export function MapPage() {
  const { countryId } = useAuth();
  const { countries, flows } = useGame();
  const [mode, setMode] = useState<MapMode>('default');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="page">
      <PageHeader
        icon="🗺️"
        title="Carte mondiale"
        subtitle="Les 36 nations, leurs flux commerciaux ANIMÉS (données réelles du moteur) et les 32 routes stratégiques avec leurs propriétaires. Cliquez sur un pays pour son panneau détaillé, molette pour zoomer, glissez pour vous déplacer. Changez de mode pour colorer la carte par économie, stocks, commerce, diplomatie, population ou infrastructures."
        chips={<>
          <Badge tone="good">{flows.length} flux commerciaux animés</Badge>
          <Badge tone="info">32 routes stratégiques achetables</Badge>
          <Badge tone="neutral">7 modes d'affichage</Badge>
        </>}
      />
      <WorldMap
        countries={countries}
        flows={flows}
        selectedId={selectedId}
        referenceId={countryId ?? selectedId}
        mode={mode}
        onModeChange={setMode}
        onSelect={setSelectedId}
        height="66vh"
      />
      <CountryPanel countryId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
