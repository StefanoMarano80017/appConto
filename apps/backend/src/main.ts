import { createApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from './db/client.js';
import { transactionsService } from './modules/transactions/index.js';
import { logger } from './shared/logger.js';

runMigrations();

// Il fingerprint non è calcolabile in SQL: le transazioni importate prima
// della sua introduzione vengono completate qui, una sola volta.
const backfilled = transactionsService.backfillFingerprints();
if (backfilled > 0) {
  logger.info(`Fingerprint calcolato per ${backfilled} transazioni preesistenti`);
}

createApp().listen(config.port, () => {
  logger.info(`Backend in ascolto su http://localhost:${config.port}`);
  logger.info(`Database: ${config.databaseFile}`);
});
