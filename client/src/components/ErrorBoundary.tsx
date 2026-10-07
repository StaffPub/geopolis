/**
 * GEOPOLIS — Error Boundary : aucun écran blanc, message clair + retry.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log structuré côté client (visible console) — jamais de catch silencieux
    console.error('[GEOPOLIS][UI] Erreur capturée :', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="page">
          <div className="glass glass-card anim-scale-in" style={{ maxWidth: 560, margin: '80px auto', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }} aria-hidden>⚠️</div>
            <h2>Une erreur est survenue</h2>
            <p className="small">
              L'interface a rencontré un problème inattendu. Le monde continue de tourner côté serveur —
              vos données sont en sécurité.
            </p>
            <p className="tiny muted mono" style={{ wordBreak: 'break-word' }}>{this.state.error.message}</p>
            <div className="row mt-16" style={{ justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
                Réessayer
              </button>
              <button className="btn" onClick={() => window.location.reload()}>
                Recharger la page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
