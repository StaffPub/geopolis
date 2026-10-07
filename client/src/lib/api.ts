/**
 * GEOPOLIS — Client HTTP. Toutes les actions passent par l'API serveur ;
 * le client ne calcule jamais d'état critique.
 */
import type { ActionParams, ActionResult, GameNotification, PublicUser, WorldSummary } from 'shared';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Erreur ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
};

export interface MeResponse {
  user: PublicUser;
  countryId: string | null;
  notifications: GameNotification[];
  worldVersion: number;
}

export const auth = {
  register: (username: string, email: string, password: string) =>
    api.post<{ user: PublicUser }>('/api/auth/register', { username, email, password }),
  login: (email: string, password: string) =>
    api.post<{ user: PublicUser }>('/api/auth/login', { email, password }),
  logout: () => api.post<{ ok: boolean }>('/api/auth/logout'),
  me: () => api.get<MeResponse>('/api/me'),
  changePassword: (current: string, next: string) =>
    api.patch<{ ok: boolean }>('/api/me/password', { current, next }),
};

let requestCounter = 0;
function nextRequestId(): string {
  requestCounter += 1;
  return `cli-${Date.now()}-${requestCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export const game = {
  worldSnapshot: () => api.get<WorldSummary>('/api/world/snapshot'),
  countries: () => api.get<{ countries: WorldSummary['countries']; day: number }>('/api/countries'),
  country: (id: string) =>
    api.get<{ country: import('shared').Country; relationsSummary: import('shared').RelationSummary[]; worldVersion: number }>(`/api/countries/${id}`),
  countryHistory: (id: string, limit = 80) =>
    api.get<{ history: import('shared').JournalEntry[]; series: import('shared').SeriesPoint[] }>(
      `/api/countries/${id}/history?limit=${limit}`,
    ),
  journal: (params: { limit?: number; type?: string; country?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.type) qs.set('type', params.type);
    if (params.country) qs.set('country', params.country);
    if (params.q) qs.set('q', params.q);
    return api.get<{ entries: import('shared').JournalEntry[]; worldVersion: number }>(`/api/world/journal?${qs.toString()}`);
  },
  market: () => api.get<{ market: WorldSummary['market']; day: number }>('/api/world/market'),
  events: () => api.get<{ events: (import('shared').ActiveEvent & { countryName: string })[]; day: number }>('/api/world/events'),
  transactions: (country?: string, limit = 40) =>
    api.get<{ transactions: import('shared').TradeTransaction[] }>(
      `/api/world/transactions?limit=${limit}${country ? `&country=${country}` : ''}`,
    ),
  routes: (country?: string) =>
    api.get<{ routes: import('shared').TradeRoute[] }>(`/api/world/routes${country ? `?country=${country}` : ''}`),
  mapMetrics: () =>
    api.get<{
      perCountry: Record<string, {
        stocks: Record<string, number>;
        infraAvg: number;
        tradeByPartner: Record<string, number>;
        relations: Record<string, number>;
        production: Record<string, number>;
      }>;
      day: number;
      version: number;
    }>('/api/world/map-metrics'),
  corridors: () =>
    api.get<{ corridors: import('shared').TradeCorridor[]; day: number }>('/api/world/corridors'),
  offers: () =>
    api.get<{ offers: import('shared').TradeOffer[]; day: number; revision: number }>('/api/world/offers'),
  deliveries: (country?: string) =>
    api.get<{ deliveries: import('shared').PendingDelivery[]; day: number; revision: number }>(
      `/api/world/deliveries${country ? `?country=${country}` : ''}`,
    ),
  sellers: (resource: string, me?: string) =>
    api.get<{
      sellers: {
        id: string; name: string; code: string; color: string; region: string;
        playerOwned: boolean; available: number; price: number; rel: number;
        sanction: boolean; eligible: boolean;
      }[];
      worldPrice: number;
      day: number;
    }>(`/api/world/resource-sellers?resource=${resource}${me ? `&me=${me}` : ''}`),
  routeOptions: (from: string, to: string) =>
    api.get<{ options: import('shared').RouteOption[]; selected: string }>(
      `/api/world/route-options?from=${from}&to=${to}`,
    ),
  presence: () => api.get<{ presence: import('shared').PresenceEntry[]; actors: WorldSummary['actors'] }>('/api/world/presence'),
  claim: (id: string) => api.post<{ ok: boolean; countryId: string }>(`/api/countries/${id}/claim`),
  release: (id: string) => api.post<{ ok: boolean }>(`/api/countries/${id}/release`),
  action: (countryId: string, params: ActionParams) =>
    api.post<ActionResult & { version?: number }>(`/api/countries/${countryId}/actions`, {
      params,
      requestId: nextRequestId(),
    }),
  estimate: (countryId: string, params: ActionParams) =>
    api.post<{ ok: boolean; error?: string; effects?: import('shared').ActionEstimate[] }>(
      `/api/countries/${countryId}/actions/estimate`,
      { params },
    ),
  notifications: () => api.get<{ notifications: GameNotification[] }>('/api/notifications'),
  markRead: (id: string) => api.post<{ ok: boolean }>(`/api/notifications/${id}/read`),
  markAllRead: () => api.post<{ ok: boolean }>('/api/notifications/read-all'),
};

export const admin = {
  overview: () => api.get<Record<string, unknown>>('/api/admin/overview'),
  users: (q = '') => api.get<{ users: PublicUser[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`),
  suspend: (id: string) => api.post<{ ok: boolean }>(`/api/admin/users/${id}/suspend`),
  reactivate: (id: string) => api.post<{ ok: boolean }>(`/api/admin/users/${id}/reactivate`),
  deleteUser: (id: string) => api.post<{ ok: boolean }>(`/api/admin/users/${id}/delete`),
  countries: () => api.get<{ countries: Record<string, unknown>[] }>('/api/admin/countries'),
  forceAi: (id: string) => api.post<{ ok: boolean }>(`/api/admin/countries/${id}/force-ai`),
  expel: (id: string) => api.post<{ ok: boolean; cooldownUntil: number | null }>(`/api/admin/countries/${id}/expel`),
  grant: (id: string, payload: { cash?: number; debt?: number; popularity?: number; stability?: number; resources?: Record<string, number> }) =>
    api.post<{ ok: boolean; applied: string[]; corrections: string[] }>(`/api/admin/countries/${id}/grant`, payload),
  clearCooldown: (uid: string) => api.post<{ ok: boolean; user: PublicUser }>(`/api/admin/users/${uid}/clear-cooldown`),
  setPresident: (id: string, name: string) => api.post<{ ok: boolean }>(`/api/admin/countries/${id}/president`, { name }),
  editVariables: (id: string, vars: Record<string, number>) =>
    api.patch<{ ok: boolean; corrections: string[] }>(`/api/admin/countries/${id}/variables`, vars),
  simulation: () =>
    api.get<{
      engine: import('shared').EngineStatus;
      meta: import('shared').WorldMeta;
      actors: WorldSummary['actors'];
      wsClients: number;
      validation: string[] | 'OK';
      aiDecisions: import('shared').AiDecisionLog[];
      recentAudit: import('shared').AuditLog[];
    }>('/api/admin/simulation'),
  forceTick: (n: number) => api.post<{ ok: boolean; tick: unknown }>('/api/admin/simulation/tick', { n }),
  resync: () => api.post<{ ok: boolean }>('/api/admin/simulation/resync'),
  integrityCheck: () => api.post<{ ok: boolean; problems: string[]; integrityIssues: number }>('/api/admin/integrity/check'),
  integrityRepair: () => api.post<{ ok: boolean; fixed: number }>('/api/admin/integrity/repair'),
  reseed: (confirmText: string) => api.post<{ ok: boolean }>('/api/admin/world/reseed', { confirm: confirmText }),
  audit: (limit = 100) => api.get<{ logs: import('shared').AuditLog[] }>(`/api/admin/audit?limit=${limit}`),
  aiDecisions: (limit = 100) => api.get<{ decisions: import('shared').AiDecisionLog[] }>(`/api/admin/ai-decisions?limit=${limit}`),
};
