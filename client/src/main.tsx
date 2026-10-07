import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import { AuthProvider } from './state/AuthContext.js';
import { GameProvider } from './state/GameContext.js';
import { Toasts } from './components/Toasts.js';
import './styles/global.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Racine React introuvable');

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <GameProvider>
          <App />
          <Toasts />
        </GameProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
