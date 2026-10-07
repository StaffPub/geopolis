/**
 * GEOPOLIS — Script admin : réinitialisation du monde depuis le seed.
 * Usage : npm run seed:reset (hors ligne, serveur arrêté).
 */
import { createStorage } from '../storage/index.js';
import { WorldStore } from '../world/world.js';
import { createLogger } from '../logger.js';

const log = createLogger('RESEED');

async function main(): Promise<void> {
  const confirm = process.argv[2];
  if (confirm !== '--confirm') {
    console.log('Cette commande réinitialise TOUT le monde depuis le seed.');
    console.log('Usage : npm run seed:reset -- --confirm');
    process.exit(1);
  }
  const storage = createStorage();
  await WorldStore.seed(storage);
  log.info('Monde réinitialisé depuis le seed déterministe.');
  await storage.close();
  process.exit(0);
}

main().catch((e) => {
  log.error('Échec reseed', String(e));
  process.exit(1);
});
