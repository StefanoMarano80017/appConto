import { createApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { config } from './config.js';
import { closeDatabase } from './db/client.js';
import { connectLauncher } from './launcher-ipc.js';
import { listenWithFallback } from './listen.js';
import { createAutoBackupScheduler } from './modules/maintenance/index.js';
import { SETTINGS_PROBLEM } from './paths.js';
import { startServer, StartupFailedError, type StartedServer } from './server.js';
import { logger } from './shared/logger.js';
import { closeAndReport, createShutdown, installSignalHandlers } from './shutdown.js';

/**
 * L'avvio del server.
 *
 * Resta eseguibile da solo — `npm start`, i test, uno smoke test — e non
 * conosce il launcher. Ciò che il launcher aggiunge arriva da fuori sotto
 * forma di due sole cose: il permesso di ripiegare su un'altra porta, e un
 * canale IPC su cui chiedere l'arresto. Senza di esse il comportamento è
 * quello di prima.
 *
 * Qui si collegano i pezzi reali; la logica sta in `server.ts`,
 * `shutdown.ts` e `launcher-ipc.ts`.
 */

if (SETTINGS_PROBLEM !== null) {
  logger.error(`Configurazione ignorata, si usano i valori predefiniti: ${SETTINGS_PROBLEM}`);
}

/**
 * Se una porta occupata deve portare a un ripiego o a un errore.
 *
 * Non è una configurazione dell'utente: è un'istruzione del processo che ha
 * avviato questo, e per questo si legge qui e non in `config.ts`. Il launcher
 * la impone perché ha un browser da aprire sulla porta giusta; `npm start`
 * non la impone perché in sviluppo una porta diversa da quella chiesta
 * significa non accorgersi di avere due server accesi.
 */
const allowPortFallback = process.env.MYFINANCE_PORT_FALLBACK === '1';

// I percorsi effettivi vanno registrati all'avvio: sono la prima cosa da
// guardare quando l'applicazione non trova i dati che l'utente si aspetta.
logger.info('Avvio', {
  layout: config.layout,
  appRoot: config.appRoot,
  dataRoot: config.dataRoot,
  database: config.databaseFile,
  migrations: config.migrationsFolder,
  frontend: config.frontendDir,
  sqlite: config.nativeBindingFile ?? 'risolto da node_modules',
  configuredPort: config.port,
  portFallback: allowPortFallback,
  cwd: process.cwd(),
});

let started: StartedServer;
try {
  started = await startServer(
    { host: config.host, port: config.port, allowFallback: allowPortFallback },
    {
      bootstrap: () => {
        bootstrap();
      },
      createApp: () => createApp(),
      listen: listenWithFallback,
      createScheduler: createAutoBackupScheduler,
      log: logger,
    },
  );
} catch (error) {
  if (error instanceof StartupFailedError) {
    // `startServer` ha già spiegato cosa è andato storto. Se il bootstrap non
    // è riuscito il database non è stato aperto in modo sicuro: non si chiude.
    if (error.phase !== 'bootstrap') closeAndReport(closeDatabase, logger);
  } else {
    logger.error(
      `Avvio interrotto: ${error instanceof Error ? error.message : 'errore sconosciuto'}`,
    );
    closeAndReport(closeDatabase, logger);
  }
  // `process.exit` e non `exitCode`: il canale IPC e il timer di sicurezza
  // tengono vivo il ciclo di eventi, e il processo non terminerebbe da solo.
  process.exit(1);
}

const richiedi = createShutdown({
  server: started.server,
  background: started.background,
  closeDatabase,
  // Stessa ragione dell'uscita sopra: il ciclo di eventi non si svuota da solo.
  exit: (code) => {
    process.exit(code);
  },
  log: logger,
});
installSignalHandlers(richiedi);
connectLauncher(process, started.listen, richiedi);
