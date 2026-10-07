/**
 * GEOPOLIS — Application Express : API + statiques client + SPA fallback.
 * Séparation claire : CLIENT → API → SERVICES → MOTEUR → STOCKAGE.
 */
import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import { config } from './config.js';
import { createLogger } from './logger.js';
import { makeAuthMiddleware } from './auth/auth.js';
import { createApiRouter, type ApiDeps } from './api/routes.js';
import type { Repositories } from './storage/index.js';

const log = createLogger('APP');

export function createApp(deps: ApiDeps, repos: Repositories): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // derrière le proxy Render

  // Compression gzip/brotli : réduit fortement le temps de transfert (JS/CSS/JSON)
  app.use(compression());

  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  // En-têtes de sécurité raisonnables
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  const { authenticate } = makeAuthMiddleware(repos);
  app.use('/api', authenticate);
  app.use('/api', createApiRouter(deps));

  // Statiques client (build Vite) — cache long pour les assets hashés, no-cache pour index.html
  const clientDist = config.clientDist;
  if (fs.existsSync(clientDist)) {
    app.use(
      '/assets',
      express.static(path.join(clientDist, 'assets'), {
        maxAge: '365d',
        immutable: true,
      }),
    );
    app.use(express.static(clientDist, { maxAge: '5m', index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
    log.info(`Statiques client servis depuis ${clientDist} (gzip + cache immutable)`);
  } else {
    log.warn(`Build client absent (${clientDist}) — API seule. Lancez npm run build -w client.`);
    app.get('/', (_req, res) => {
      res.type('html').send(
        '<h1>GEOPOLIS — API active</h1><p>Le build client est absent. Exécutez <code>npm run build</code>.</p>',
      );
    });
  }

  // 404 API + gestion d'erreurs : aucun écran blanc côté serveur
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Route API introuvable' });
  });
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error('Erreur HTTP non gérée', err.stack ?? String(err));
    if (!res.headersSent) res.status(500).json({ error: 'Erreur interne du serveur' });
  });

  return app;
}
