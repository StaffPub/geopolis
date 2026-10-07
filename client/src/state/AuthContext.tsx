/**
 * GEOPOLIS — Contexte d'authentification client.
 * L'état utilisateur vient exclusivement du serveur (/api/me).
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PublicUser } from 'shared';
import { auth, type MeResponse } from '../lib/api';

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  countryId: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setCountryId: (id: string | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);

/** Drapeau local « j'ai une session » : évite l'appel /api/me (et son 401
 *  dans la console) à chaque chargement quand on est déconnecté. */
const SESSION_FLAG = 'gp-has-session';
function hasSessionFlag(): boolean {
  try { return localStorage.getItem(SESSION_FLAG) === '1'; } catch { return true; }
}
function setSessionFlag(v: boolean): void {
  try {
    if (v) localStorage.setItem(SESSION_FLAG, '1');
    else localStorage.removeItem(SESSION_FLAG);
  } catch { /* ignore */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [countryId, setCountryIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(hasSessionFlag());

  const refresh = useCallback(async () => {
    if (!hasSessionFlag()) {
      setUser(null);
      setCountryIdState(null);
      setLoading(false);
      return;
    }
    try {
      const me = await auth.me();
      setUser(me.user);
      setCountryIdState(me.countryId);
    } catch {
      setSessionFlag(false);
      setUser(null);
      setCountryIdState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await auth.login(email, password);
    setSessionFlag(true);
    setUser(res.user);
    const me: MeResponse = await auth.me();
    setCountryIdState(me.countryId);
  }, []);

  const register = useCallback(async (username: string, email: string, password: string) => {
    const res = await auth.register(username, email, password);
    setSessionFlag(true);
    setUser(res.user);
    const me = await auth.me();
    setCountryIdState(me.countryId);
  }, []);

  const logout = useCallback(async () => {
    await auth.logout();
    setSessionFlag(false);
    setUser(null);
    setCountryIdState(null);
  }, []);

  const setCountryId = useCallback((id: string | null) => {
    setCountryIdState(id);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, countryId, login, register, logout, refresh, setCountryId }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return ctx;
}
