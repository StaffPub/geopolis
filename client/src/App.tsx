/**
 * GEOPOLIS — Routeur applicatif avec découpage de code (lazy loading).
 * Chaque page est un chunk séparé : la page d'accueil charge en premier,
 * les pages lourdes (carte, graphiques) ne se téléchargent qu'à la demande.
 */
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './state/AuthContext.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { Spinner, TiltFX } from './components/ui.js';
import { Landing } from './pages/Landing.js';
import { Login, Register } from './pages/Auth.js';

const ChooseCountry = lazy(() => import('./pages/ChooseCountry.js').then((m) => ({ default: m.ChooseCountry })));
const GameLayout = lazy(() => import('./pages/game/GameLayout.js').then((m) => ({ default: m.GameLayout })));
const Dashboard = lazy(() => import('./pages/game/Dashboard.js').then((m) => ({ default: m.Dashboard })));
const MapPage = lazy(() => import('./pages/game/MapPage.js').then((m) => ({ default: m.MapPage })));
const EconomyPage = lazy(() => import('./pages/game/EconomyPage.js').then((m) => ({ default: m.EconomyPage })));
const PoliticsPage = lazy(() => import('./pages/game/PoliticsPage.js').then((m) => ({ default: m.PoliticsPage })));
const LawsPage = lazy(() => import('./pages/game/LawsPage.js').then((m) => ({ default: m.LawsPage })));
const DiplomacyPage = lazy(() => import('./pages/game/DiplomacyPage.js').then((m) => ({ default: m.DiplomacyPage })));
const TradePage = lazy(() => import('./pages/game/TradePage.js').then((m) => ({ default: m.TradePage })));
const InfrastructurePage = lazy(() => import('./pages/game/InfrastructurePage.js').then((m) => ({ default: m.InfrastructurePage })));
const EventsPage = lazy(() => import('./pages/game/EventsPage.js').then((m) => ({ default: m.EventsPage })));
const HistoryPage = lazy(() => import('./pages/game/HistoryPage.js').then((m) => ({ default: m.HistoryPage })));
const WorldViewPage = lazy(() => import('./pages/game/WorldViewPage.js').then((m) => ({ default: m.WorldViewPage })));
const ComparePage = lazy(() => import('./pages/game/ComparePage.js').then((m) => ({ default: m.ComparePage })));
const ResourcesPage = lazy(() => import('./pages/game/ResourcesPage.js').then((m) => ({ default: m.ResourcesPage })));
const ProductionPage = lazy(() => import('./pages/game/ProductionPage.js').then((m) => ({ default: m.ProductionPage })));
const Profile = lazy(() => import('./pages/Account.js').then((m) => ({ default: m.Profile })));
const Settings = lazy(() => import('./pages/Account.js').then((m) => ({ default: m.Settings })));
const AdminLayout = lazy(() => import('./pages/admin/AdminPages.js').then((m) => ({ default: m.AdminLayout })));
const AdminDashboard = lazy(() => import('./pages/admin/AdminPages.js').then((m) => ({ default: m.AdminDashboard })));
const AdminUsers = lazy(() => import('./pages/admin/AdminPages.js').then((m) => ({ default: m.AdminUsers })));
const AdminCountries = lazy(() => import('./pages/admin/AdminPages.js').then((m) => ({ default: m.AdminCountries })));
const AdminSimulation = lazy(() => import('./pages/admin/AdminPages.js').then((m) => ({ default: m.AdminSimulation })));

function PageFallback() {
  return (
    <div className="page" style={{ minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="loading-3d" aria-hidden>
        <span /><span /><span />
      </div>
      <span className="muted small" style={{ marginLeft: 14 }}>Chargement de la page…</span>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="page" style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spinner label="Synchronisation du monde…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="page" style={{ textAlign: 'center', paddingTop: '18vh' }}>
      <h1 style={{ fontSize: '3rem' }}>404</h1>
      <p>Cette page n'existe pas dans ce monde — mais les 36 nations, si.</p>
      <a className="btn btn-primary mt-16" href="/">Retour à l'accueil</a>
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <TiltFX />
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/countries" element={<RequireAuth><ChooseCountry /></RequireAuth>} />

          <Route path="/game" element={<RequireAuth><GameLayout /></RequireAuth>}>
            <Route index element={<Dashboard />} />
            <Route path="map" element={<MapPage />} />
            <Route path="economy" element={<EconomyPage />} />
            <Route path="politics" element={<PoliticsPage />} />
          <Route path="laws" element={<LawsPage />} />
            <Route path="diplomacy" element={<DiplomacyPage />} />
            <Route path="trade" element={<TradePage />} />
            <Route path="infrastructure" element={<InfrastructurePage />} />
            <Route path="events" element={<EventsPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="world" element={<WorldViewPage />} />
            <Route path="compare" element={<ComparePage />} />
            <Route path="resources" element={<ResourcesPage />} />
            <Route path="production" element={<ProductionPage />} />
          </Route>

          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />

          <Route path="/admin" element={<RequireAuth><AdminLayout /></RequireAuth>}>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="countries" element={<AdminCountries />} />
            <Route path="simulation" element={<AdminSimulation />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
