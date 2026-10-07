/**
 * GEOPOLIS — Point d'entrée serveur.
 * Ordre de démarrage :
 *   1. config → 2. stockage → 3. chargement du monde (seed si absent)
 *   4. reprise après crash (catch-up des ticks manqués) → 5. hub WebSocket
 *   6. moteur de simulation (lock leader) → 7. HTTP.
 * Un redémarrage ne détruit JAMAIS le monde.
 */
import http from 'node:http';
import { config, validateConfig } from './config.js';
import { createLogger } from './logger.js';
import { createStorage } from './storage/index.js';
import { WorldStore } from './world/world.js';
import { RealtimeHub } from './realtime/hub.js';
import { WorldSimulationEngine } from './simulation/engine.js';
import { createApp } from './app.js';

const log = createLogger('BOOT');

async function main(): Promise<void> {
  const problems = validateConfig();
  for (const p of problems) log.warn(p);

  /* 1-2. Stockage */
  const storage = createStorage();
  const storageOk = await storage.health();
  if (!storageOk) {
    log.error('Stockage indisponible au démarrage — abandon (le monde ne doit jamais tourner sans persistance)');
    process.exit(1);
  }
  log.info(`Stockage opérationnel : ${storage.kind}`);

  /* 3. Monde */
  const world = await WorldStore.load(storage);
  const repos = world.repos;

  /* 5. HTTP + hub WebSocket (avant le moteur : les hooks en dépendent) */
  const server = http.createServer();
  const hub = new RealtimeHub(server, { world, repos });

  /* 6. Moteur de simulation */
  const engine = new WorldSimulationEngine(
    world,
    storage,
    {
      onTickCompleted: (_w, info) => hub.onTick(info),
      notifyUser: (userId, n) => hub.notifyUser(userId, n),
      onMandateLost: async (loss) => {
        if (!loss.userId) return;
        const user = await repos.getUser(loss.userId);
        if (user && user.countryId === loss.countryId) {
          user.countryId = null;
          await repos.updateUser(user);
        }
        await hub.notifyUser(loss.userId, {
          type: 'mandate',
          title: 'Votre gouvernement est tombé',
          body: `${loss.countryName} : ${loss.reason}. Un dirigeant IA assure la succession. Vous pouvez choisir une autre nation.`,
          day: world.meta.day,
        });
        hub.refreshPresence();
      },
      onAiDecisions: async (decisions) => {
        // Bufferisées : écrites en une fois au prochain cycle de persistance
        world.addAiDecisions(decisions);
      },
      onBigWin: (userId, amount, source) => {
        hub.sendBigWin(userId, amount, source);
      },
    },
    { tickMs: config.tickMs, instanceId: config.instanceId, enabled: config.simulationEnabled },
  );

  /* 4. Reprise après crash : rattraper le temps écoulé */
  const isLeader = await engine.tryLeadership();
  if (isLeader) {
    const missed = await engine.catchUp();
    if (missed > 0) log.info(`${missed} tick(s) rattrapé(s) après redémarrage`);
  } else {
    log.info('Une autre instance détient le lock moteur : catch-up ignoré ici');
  }

  /* 7. Application */
  const app = createApp({ world, repos, hub, engine }, repos);
  server.on('request', app);

  server.listen(config.port, () => {
    log.info(`GEOPOLIS prêt sur le port ${config.port} (${config.env}) — monde v${world.version}, jour ${world.meta.day}`);
  });

  void engine.start();

  /* Arrêt propre : sauvegarde du monde avant extinction */
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Signal ${signal} : arrêt propre…`);
    try {
      await engine.stop();
      await world.save();
      await hub.close();
      server.close();
      await storage.close();
      log.info('Monde sauvegardé. Au revoir.');
      process.exit(0);
    } catch (e) {
      log.error('Erreur pendant l’arrêt', String(e));
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', reason instanceof Error ? reason.stack : String(reason));
  });
  process.on('uncaughtException', (err) => {
    log.error('uncaughtException', err.stack ?? String(err));
    void world.save().catch(() => undefined);
  });
}

main().catch((e) => {
  log.error('Échec du démarrage', e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
