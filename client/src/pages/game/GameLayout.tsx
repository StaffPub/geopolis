/**
 * GEOPOLIS — Layout du jeu v2 : header premium (pays, président, heure du
 * monde, EN DIRECT, notifications, profil), grande navigation latérale 3D
 * organisée en sections, drawer mobile, tutoriel d'onboarding intégré.
 */
import { Suspense, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { worldDate } from 'shared';
import { useAuth } from '../../state/AuthContext.js';
import { useGame } from '../../state/GameContext.js';
import { LiveIndicator } from '../../components/LiveIndicator.js';
import { NotificationCenter } from '../../components/NotificationCenter.js';
import { AssistantModal } from '../../components/AssistantModal.js';
import { OnboardingTour, tourAlreadySeen, useTourState } from '../../components/OnboardingTour.js';
import { Badge } from '../../components/ui.js';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  badge?: 'events' | 'alerts';
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Pilotage',
    items: [
      { to: '/game', label: 'Vue générale', icon: '🏠', end: true, badge: 'alerts' },
      { to: '/game/map', label: 'Carte du monde', icon: '🗺️' },
    ],
  },
  {
    title: 'Gouvernance',
    items: [
      { to: '/game/economy', label: 'Économie', icon: '📈' },
      { to: '/game/resources', label: 'Ressources', icon: '🛢️' },
      { to: '/game/production', label: 'Production', icon: '🏭' },
      { to: '/game/politics', label: 'Politique', icon: '🏛️' },
      { to: '/game/laws', label: 'Lois & Réformes', icon: '📜' },
      { to: '/game/infrastructure', label: 'Infrastructures', icon: '🏗️' },
    ],
  },
  {
    title: 'International',
    items: [
      { to: '/game/trade', label: 'Commerce', icon: '🚢' },
      { to: '/game/diplomacy', label: 'Diplomatie', icon: '🤝' },
    ],
  },
  {
    title: 'Le monde',
    items: [
      { to: '/game/events', label: 'Événements', icon: '⚡', badge: 'events' },
      { to: '/game/history', label: 'Journal & historique', icon: '🗃️' },
      { to: '/game/world', label: 'Vue monde', icon: '🌐' },
      { to: '/game/compare', label: 'Comparateur', icon: '⚖️' },
    ],
  },
];

export function GameLayout() {
  const { user, countryId, logout } = useAuth();
  const { myCountry, meta, notifications, status, events, journal } = useGame();
  const [notifOpen, setNotifOpen] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const tour = useTourState();
  const navigate = useNavigate();

  const country = myCountry && myCountry.id === countryId ? myCountry : null;
  const unread = notifications.filter((n) => !n.read).length;
  const alertCount = country?.alerts.filter((a) => a.severity === 'warning' || a.severity === 'critical').length ?? 0;

  /* Tutoriel automatique : première visite avec une nation.
     "Vu" est persisté (localStorage) via tour.close() → ne réapparaît plus. */
  const tourStart = tour.start;
  useEffect(() => {
    if (countryId && !tourAlreadySeen()) {
      const t = window.setTimeout(() => tourStart(), 900);
      return () => window.clearTimeout(t);
    }
  }, [countryId, tourStart]);

  const badgeValue = useMemo(
    () => ({ events: events.length, alerts: alertCount }),
    [events.length, alertCount],
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* ---------------- Header ---------------- */}
      <header
        className="glass"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 110,
          borderRadius: 0,
          borderLeft: 'none',
          borderRight: 'none',
          borderTop: 'none',
          padding: '10px clamp(12px, 3vw, 28px)',
        }}
      >
        <div className="row-between wrap" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 12 }}>
            <button
              className="btn btn-sm sidenav-burger"
              onClick={() => setNavOpen(true)}
              aria-label="Ouvrir la navigation"
            >
              ☰
            </button>
            <NavLink to={countryId ? '/game' : '/game/world'} style={{ textDecoration: 'none' }}>
              <div className="row" style={{ gap: 10 }}>
                <div
                  className="logo-3d"
                  aria-hidden
                  style={{
                    background: country
                      ? `linear-gradient(135deg, ${country.color}, rgba(91,140,255,0.9))`
                      : 'linear-gradient(135deg, #5b8cff, #ff7a6b)',
                  }}
                >
                  {country ? country.code : 'GP'}
                </div>
                <div>
                  <div style={{ fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.15, fontSize: '1.02rem' }}>
                    {country ? country.name : 'GEOPOLIS'}
                  </div>
                  <div className="tiny muted">
                    {country ? (
                      <>
                        Président · <strong style={{ color: 'var(--text-1)' }}>{country.controller.presidentName}</strong>{' '}
                        <Badge tone={country.controller.kind === 'player' && country.controller.userId === user?.id ? 'violet' : country.controller.kind === 'player' ? 'pink' : 'info'}>
                          {country.controller.kind === 'player' && country.controller.userId === user?.id ? 'VOUS' : country.controller.kind === 'player' ? 'JOUEUR' : 'IA'}
                        </Badge>
                      </>
                    ) : (
                      <>Observateur · <NavLink to="/countries" style={{ fontWeight: 600 }}>choisir une nation</NavLink></>
                    )}
                  </div>
                </div>
              </div>
            </NavLink>
          </div>

          <div className="row wrap" style={{ gap: 10 }}>
            {status === 'reconnecting' && (
              <span className="tiny" style={{ color: 'var(--warn)' }}>Connexion interrompue. Reconnexion…</span>
            )}
            {status === 'polling' && (
              <span className="tiny" style={{ color: 'var(--warn)' }}>Mode secours HTTP — resynchronisation…</span>
            )}
            {meta && (
              <span className="tiny muted mono" title="Heure du monde (1 tick = 1 jour)">
                🕰️ {worldDate(meta.day)}
              </span>
            )}
            <LiveIndicator />
            <button
              className="btn btn-sm assist-btn"
              onClick={() => setAssistOpen(true)}
              aria-label="Ouvrir la fenêtre d'assistance (toutes vos questions sur le jeu)"
              title="Assistance — posez toutes vos questions sur le jeu"
            >
              ❓<span className="hide-mobile" style={{ marginLeft: 6, fontWeight: 700 }}>Aide</span>
            </button>
            <button className="btn btn-sm" onClick={() => setNotifOpen(true)} aria-label={`Notifications (${unread} non lues)`} style={{ position: 'relative' }}>
              🔔
              {unread > 0 && (
                <span className="notif-count anim-scale-in">{unread > 9 ? '9+' : unread}</span>
              )}
            </button>
            <div style={{ position: 'relative' }}>
              <button className="btn btn-sm" onClick={() => setProfileOpen((v) => !v)} aria-label="Menu profil">
                👤 <span className="hide-mobile">{user?.username}</span>
              </button>
              {profileOpen && (
                <div className="glass anim-scale-in menu-pop">
                  <button className="menu-item" onClick={() => { setProfileOpen(false); tour.start(); }}>🎓 Tutoriel</button>
                  <NavLink className="menu-item" to="/profile" onClick={() => setProfileOpen(false)}>👤 Profil</NavLink>
                  <NavLink className="menu-item" to="/settings" onClick={() => setProfileOpen(false)}>⚙️ Paramètres</NavLink>
                  <NavLink className="menu-item" to="/countries" onClick={() => setProfileOpen(false)}>🌍 Changer de nation</NavLink>
                  {user?.role === 'admin' && (
                    <NavLink className="menu-item" style={{ color: 'var(--accent-pink)' }} to="/admin" onClick={() => setProfileOpen(false)}>🛡️ Administration</NavLink>
                  )}
                  <button
                    className="menu-item"
                    style={{ color: 'var(--danger)' }}
                    onClick={() => { void logout().then(() => navigate('/')); }}
                  >
                    🚪 Déconnexion
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ---------------- Barre journal défilante (toutes pages) ---------------- */}
      <div className="newsbar" role="marquee" aria-label="Actualités du monde en direct">
        <span className="newsbar-label"><span className="live-dot" aria-hidden /> ACTU</span>
        <div className="newsbar-mask">
          <div className="newsbar-track">
            {[...journal, ...journal].map((j, i) => {
              const mine = !!countryId && j.countryIds.includes(countryId);
              return (
                <span key={`${j.id}-${i}`} className={`news-item ${mine ? 'news-mine' : ''}`}>
                  <span className="news-dot" aria-hidden />
                  <b>J{j.day}</b> {mine ? '▸ ' : ''}{j.text}
                </span>
              );
            })}
            {journal.length === 0 && <span className="news-item">Le monde s'éveille… premières dépêches imminentes.</span>}
          </div>
        </div>
      </div>

      {/* ---------------- Corps : nav + contenu ---------------- */}
      <div style={{ display: 'flex', flex: 1, gap: 0 }}>
        {navOpen && <div className="drawer-backdrop" style={{ zIndex: 115 }} onClick={() => setNavOpen(false)} />}

        <nav className={`sidenav ${navOpen ? 'open' : ''}`} aria-label="Navigation principale">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="sidenav-section">{section.title}</div>
              <div className="col" style={{ gap: 4 }}>
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    data-tour={item.to}
                    onClick={() => setNavOpen(false)}
                    className={({ isActive }) => `sidenav-item ${isActive ? 'active' : ''}`}
                  >
                    <span className="nav-ico" aria-hidden>{item.icon}</span>
                    <span>{item.label}</span>
                    {item.badge === 'events' && badgeValue.events > 0 && (
                      <span className="nav-badge">{badgeValue.events}</span>
                    )}
                    {item.badge === 'alerts' && badgeValue.alerts > 0 && (
                      <span className="nav-badge" style={{ background: 'rgba(251,191,36,0.15)', color: '#fcd34d', borderColor: 'rgba(251,191,36,0.4)' }}>
                        {badgeValue.alerts}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}

          <div className="sidenav-foot">
            <button className="btn btn-sm btn-block btn-ghost" onClick={() => { setNavOpen(false); tour.start(); }}>
              🎓 Revoir le tutoriel
            </button>
            <div className="tiny muted center mt-8">
              {meta ? `Monde v${meta.version} · jour ${meta.day}` : 'Synchronisation…'}
            </div>
          </div>
        </nav>

        <main style={{ flex: 1, minWidth: 0 }} onClick={() => profileOpen && setProfileOpen(false)}>
          {/* Suspense LOCAL : un onglet lazy qui charge ne démonte PAS le layout
              (ni le tutoriel, ni la nav) — corrige la disparition du tuto. */}
          <Suspense
            fallback={
              <div className="page" style={{ minHeight: '40vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="loading-3d" aria-hidden><span /><span /><span /></div>
                <span className="muted small" style={{ marginLeft: 14 }}>Chargement de l'onglet…</span>
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>

      <NotificationCenter open={notifOpen} onClose={() => setNotifOpen(false)} />
      {assistOpen && <AssistantModal onClose={() => setAssistOpen(false)} />}
      <OnboardingTour open={tour.open} onClose={tour.close} />

      <style>{`
        .logo-3d {
          width: 42px; height: 42px; border-radius: 13px;
          display: flex; align-items: center; justify-content: center;
          font-weight: 900; font-size: 0.95rem; color: #fff;
          box-shadow: 0 4px 0 rgba(0,0,0,0.35), 0 10px 26px rgba(91,140,255,0.45), inset 0 1px 0 rgba(255,255,255,0.35);
          transform-style: preserve-3d;
          transition: transform 220ms cubic-bezier(0.22,1,0.36,1);
          text-shadow: 0 2px 6px rgba(0,0,0,0.4);
        }
        a:hover .logo-3d { transform: rotate(-6deg) scale(1.06) translateZ(8px); }
        .notif-count {
          position: absolute; top: -6px; right: -6px;
          background: linear-gradient(135deg, #ff7a6b, #b28cff);
          color: #fff; border-radius: 999px;
          font-size: 0.64rem; font-weight: 800;
          min-width: 18px; height: 18px; padding: 0 5px;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 2px 0 rgba(0,0,0,0.3), 0 4px 12px rgba(255,122,107,0.5);
        }
        .menu-pop {
          position: absolute; right: 0; top: 112%;
          min-width: 220px; padding: 8px; z-index: 130;
          display: flex; flex-direction: column; gap: 2px;
          box-shadow: 0 20px 50px rgba(3,6,18,0.6);
        }
        .menu-item {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px; border-radius: 10px;
          background: none; border: none; cursor: pointer;
          color: var(--text-1); font: 600 0.88rem var(--font);
          text-decoration: none; text-align: left;
          transition: all 160ms ease;
        }
        .menu-item:hover { background: rgba(255,255,255,0.06); color: var(--text-0); transform: translateX(3px); }
        @media (max-width: 640px) { .hide-mobile { display: none; } }
      `}</style>
    </div>
  );
}
