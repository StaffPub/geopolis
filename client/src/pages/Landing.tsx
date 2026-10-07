/**
 * GEOPOLIS — Landing page v3 : hero 3D animé, compteurs réels, ticker de flux
 * commerciaux vivants, carte aperçu, sections pédagogiques. Aucune donnée
 * fictive : tout vient du moteur (world snapshot temps réel).
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, worldDate } from 'shared';
import { useGame } from '../state/GameContext.js';
import { useAuth } from '../state/AuthContext.js';
import { LiveIndicator } from '../components/LiveIndicator.js';
import { AnimatedNumber, Badge, GlassCard } from '../components/ui.js';
import { WorldMap } from '../components/WorldMap.js';
import { Sparkline } from '../components/Charts.js';

export function Landing() {
  const { meta, actors, countries, flows, activeTradeCount, activeEventCount, market } = useGame();
  const { user } = useAuth();

  const stats = useMemo(() => {
    const totalGdp = countries.reduce((s, c) => s + c.gdp, 0);
    const totalPop = countries.reduce((s, c) => s + c.population, 0);
    const players = countries.filter((c) => c.controllerKind === 'player').length;
    return { totalGdp, totalPop, players };
  }, [countries]);

  const ticker = flows.slice(0, 8);
  const oil = market?.oil;

  return (
    <div className="landing">
      {/* Fond animé */}
      <div className="landing-bg" aria-hidden>
        <span className="blob blob-1" />
        <span className="blob blob-2" />
        <span className="blob blob-3" />
        <div className="landing-grid" />
      </div>

      {/* Nav */}
      <header className="landing-nav">
        <div className="row" style={{ gap: 10, fontWeight: 900, letterSpacing: '0.14em' }}>
          <span className="logo-3d-sm" aria-hidden>◈</span>
          GEOPOLIS
        </div>
        <div className="row" style={{ gap: 10 }}>
          <LiveIndicator />
          {user ? (
            <Link className="btn btn-primary btn-sm btn3d" to={user.countryId ? '/game' : '/countries'}>
              {user.countryId ? 'Reprendre le pouvoir' : 'Choisir ma nation'}
            </Link>
          ) : (
            <>
              <Link className="btn btn-sm btn3d" to="/login">Connexion</Link>
              <Link className="btn btn-primary btn-sm btn3d" to="/register">Créer un compte</Link>
            </>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="landing-hero">
        <div className="hero-copy anim-fade-up">
          <Badge tone="violet">MONDE PERSISTANT · TEMPS RÉEL · SANS TOUR PAR TOUR</Badge>
          <h1 className="hero-title">
            UN MONDE.
            <br />
            <span className="hero-gradient">36 NATIONS.</span>
            <br />
            UNE ÉCONOMIE VIVANTE.
          </h1>
          <p className="hero-sub">
            Gouverne ta nation, négocie avec les autres dirigeants et construis une économie
            durable dans un monde qui tourne même quand tu dors.
          </p>
          <div className="row mt-16 wrap">
            {user ? (
              <Link className="btn btn-primary btn-lg btn3d" to={user.countryId ? '/game' : '/countries'}>
                {user.countryId ? '→ Tableau de bord' : '→ Choisir ma nation'}
              </Link>
            ) : (
              <>
                <Link className="btn btn-primary btn-lg btn3d" to="/register">Prendre la tête d'une nation</Link>
                <Link className="btn btn-lg btn3d" to="/login">J'ai déjà un compte</Link>
              </>
            )}
          </div>

          {/* Bandeau monde vivant */}
          <div className="glass live-band mt-24">
            <span className="row" style={{ gap: 6 }}><span className="live-dot" aria-hidden /> <strong>LE MONDE TOURNE ACTUELLEMENT</strong></span>
            <span className="tiny muted mono">{countries.length || 36} nations</span>
            <span className="tiny muted mono">{actors.total} acteurs actifs</span>
            <span className="tiny muted mono">{actors.humansOnline} joueur(s)</span>
            <span className="tiny muted mono">{actors.ai} dirigeants IA</span>
            <span className="tiny muted mono">{activeTradeCount} échanges actifs</span>
            <span className="tiny muted mono">{activeEventCount} événements</span>
            {meta && <span className="tiny muted mono">{worldDate(meta.day)}</span>}
          </div>
        </div>

        {/* Colonne 3D données live */}
        <div className="hero-cards stagger">
          <div className="card3d">
            <GlassCard className="hero-card">
              <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>PIB mondial</div>
              <div className="hero-num"><AnimatedNumber value={stats.totalGdp} format={(v) => formatMoney(v)} /></div>
              <div className="tiny muted">agrégat temps réel des 36 nations</div>
            </GlassCard>
          </div>
          <div className="card3d">
            <GlassCard className="hero-card">
              <div className="row-between">
                <div>
                  <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Pétrole (marché mondial)</div>
                  <div className="hero-num">
                    {oil ? <AnimatedNumber value={oil.price} format={(v) => `${v.toFixed(2)} €`} /> : '—'}
                  </div>
                  <div className="tiny">
                    {oil && (
                      <span className={oil.change24h >= 0 ? 'delta-up' : 'delta-down'}>
                        {oil.change24h >= 0 ? '▲ +' : '▼ '}{oil.change24h.toFixed(2)} % (24 j)
                      </span>
                    )}
                  </div>
                </div>
                {oil && <Sparkline data={oil.series.slice(-40)} color={oil.change24h >= 0 ? '#3ec9a7' : '#e0705a'} width={110} height={44} />}
              </div>
            </GlassCard>
          </div>
          <div className="card3d">
            <GlassCard className="hero-card hero-ticker">
              <div className="tiny muted mb-8" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                Flux commerciaux en direct
              </div>
              <div className="ticker-mask">
                <div className="ticker-col">
                  {[...ticker, ...ticker].map((f, i) => {
                    const from = countries.find((c) => c.id === f.fromId);
                    const to = countries.find((c) => c.id === f.toId);
                    return (
                      <div key={`${f.id}-${i}`} className="ticker-item">
                        <span style={{ color: from?.color }}>●</span> {from?.name ?? f.fromId} → {to?.name ?? f.toId}
                        <span className="tiny muted mono"> · {(f.value * 1000).toFixed(0)} M €/j</span>
                      </div>
                    );
                  })}
                  {ticker.length === 0 && <div className="tiny muted">Le moteur calcule les premières routes…</div>}
                </div>
              </div>
            </GlassCard>
          </div>
        </div>
      </section>

      {/* Comment ça marche */}
      <section className="landing-section">
        <h2 className="center">Comment ça marche ?</h2>
        <p className="center small muted" style={{ maxWidth: 620, margin: '0 auto 26px' }}>
          Un seul monde partagé. Chaque décision passe par le serveur, qui calcule les conséquences
          sur ton économie, ton peuple et tes voisins.
        </p>
        <div className="grid grid-4 stagger">
          {[
            { icon: '🏛️', t: 'Gouverne', d: 'Fiscalité, budget, lois, chantiers : chaque choix a des effets réels et durables, estimés avant confirmation.' },
            { icon: '📣', t: 'Écoute ton peuple', d: 'Revendications calculées en direct (emploi, prix, soins…). Ignore-les et ta popularité s’effondre.' },
            { icon: '🤝', t: 'Négocie', d: 'Accords, aides, coopérations… et mesures économiques en cas de tension. Jamais de guerre : que de l’économie.' },
            { icon: '🌙', t: 'Vis ta vie', d: 'Déconnecte : les IA gouvernent, le commerce continue, ton pays évolue. Retrouve-le tel que tu l’as laissé… en mieux ou en pire.' },
          ].map((f) => (
            <div key={f.t} className="card3d">
              <GlassCard className="feature-card">
                <div className="feature-ico" aria-hidden>{f.icon}</div>
                <h3>{f.t}</h3>
                <p className="small muted">{f.d}</p>
              </GlassCard>
            </div>
          ))}
        </div>
      </section>

      {/* Carte aperçu */}
      <section className="landing-section">
        <div className="row-between mb-16 wrap">
          <h2 style={{ margin: 0 }}>La carte du monde</h2>
          <span className="tiny muted">Clique sur un pays pour l'inspecter · flux animés = vraies routes commerciales</span>
        </div>
        <WorldMap
          countries={countries}
          flows={flows}
          selectedId={null}
          referenceId={null}
          mode="default"
          onModeChange={() => undefined}
          onSelect={() => undefined}
          height="48vh"
          hideToolbar
        />
      </section>

      {/* Bande chiffres */}
      <section className="landing-section">
        <div className="glass stats-band stagger">
          <div className="stat-cell">
            <div className="hero-num"><AnimatedNumber value={countries.length || 36} format={(v) => v.toFixed(0)} /></div>
            <div className="tiny muted">nations jouables</div>
          </div>
          <div className="stat-cell">
            <div className="hero-num"><AnimatedNumber value={stats.players} format={(v) => v.toFixed(0)} /></div>
            <div className="tiny muted">dirigées par des joueurs</div>
          </div>
          <div className="stat-cell">
            <div className="hero-num"><AnimatedNumber value={36 - stats.players} format={(v) => v.toFixed(0)} /></div>
            <div className="tiny muted">gouvernements IA actifs</div>
          </div>
          <div className="stat-cell">
            <div className="hero-num"><AnimatedNumber value={activeTradeCount} format={(v) => v.toFixed(0)} /></div>
            <div className="tiny muted">routes commerciales</div>
          </div>
          <div className="stat-cell">
            <div className="hero-num"><AnimatedNumber value={stats.totalPop / 1000} format={(v) => `${v.toFixed(2)} Md`} /></div>
            <div className="tiny muted">d'habitants simulés</div>
          </div>
        </div>
      </section>

      <footer className="landing-foot tiny muted">
        GEOPOLIS — simulateur géopolitique persistant · monde unique · serveur autoritaire · sans guerre ni tour par tour
      </footer>
    </div>
  );
}
