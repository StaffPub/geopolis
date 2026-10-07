/**
 * GEOPOLIS — Authentification : mots de passe hashés (bcrypt), sessions
 * serveur sécurisées (token opaque, hashé avec SESSION_SECRET avant stockage),
 * rôles vérifiés CÔTÉ SERVEUR sur chaque route sensible.
 */
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, RequestHandler } from 'express';
import type { PublicUser, User } from 'shared';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import type { Repositories } from '../storage/index.js';
import type { Session } from 'shared';

const log = createLogger('AUTH');

export const SESSION_COOKIE = 'gp_session';

export interface AuthenticatedRequest extends Request {
  user?: User;
  session?: Session;
  token?: string;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Le rôle admin est déterminé CÔTÉ SERVEUR par ADMIN_EMAIL — jamais par le client. */
export function resolveRole(email: string): 'admin' | 'user' {
  const normalized = normalizeEmail(email);
  if (config.adminEmail && normalized === config.adminEmail) return 'admin';
  return 'user';
}

export function isAdminUser(user: User | undefined | null): boolean {
  if (!user || user.suspended) return false;
  if (!config.adminEmail) return false;
  return normalizeEmail(user.email) === config.adminEmail;
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: isAdminUser(u) ? 'admin' : u.role,
    countryId: u.countryId,
    suspended: u.suspended,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    countryCooldownUntil: u.countryCooldownUntil ?? null,
  };
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.production,
    path: '/',
    maxAge: config.sessionTtlMs,
  };
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (cookies && cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];
  return null;
}

export function makeAuthMiddleware(repos: Repositories): {
  authenticate: RequestHandler;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
} {
  const secret = config.sessionSecret || 'geopolis-dev-secret';

  const authenticate: RequestHandler = (req, _res, next) => {
    const r = req as AuthenticatedRequest;
    const token = extractToken(req);
    if (!token) return next();
    r.token = token;
    void (async () => {
      try {
        const session = await repos.getSession(token, secret);
        if (session) {
          const user = await repos.getUser(session.userId);
          if (user && !user.suspended) {
            r.user = user;
            r.session = session;
            // Le rôle admin est rafraîchi depuis ADMIN_EMAIL à chaque requête
            const role = resolveRole(user.email);
            if (role !== user.role) {
              user.role = role;
              await repos.updateUser(user);
            }
          }
        }
      } catch (e) {
        log.warn('Échec authentification session', String(e));
      }
      next();
    })();
  };

  const requireAuth: RequestHandler = (req, res, next) => {
    const r = req as AuthenticatedRequest;
    if (!r.user) {
      res.status(401).json({ error: 'Authentification requise' });
      return;
    }
    next();
  };

  const requireAdmin: RequestHandler = (req, res, next) => {
    const r = req as AuthenticatedRequest;
    if (!r.user) {
      res.status(401).json({ error: 'Authentification requise' });
      return;
    }
    if (!isAdminUser(r.user)) {
      log.warn(`Accès admin refusé pour ${r.user.email}`);
      res.status(403).json({ error: 'Droits administrateur requis' });
      return;
    }
    next();
  };

  return { authenticate, requireAuth, requireAdmin };
}

export function sessionSecret(): string {
  return config.sessionSecret || 'geopolis-dev-secret';
}

export type { NextFunction };
