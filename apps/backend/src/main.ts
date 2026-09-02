import { createServer } from 'node:http';
import { createApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { config } from './config.js';
import { ListenFailedError, listenWithFallback } from './listen.js';
import { createAutoBackupScheduler } from './modules/maintenance/index.js';
import { SETTINGS_PROBLEM } from './paths.js';
import { logger } from './shared/logger.js';
import { installShutdownHandlers, shutdown } from './shutdown.js';

/**
 * L'avvio del server.
 *
 * Resta eseguibile da solo — `npm start`, i test, uno smoke test — e non
 * conosce il launcher. Ciò che il launcher aggiunge arriva da fuori sotto
 * forma di due sole cose: il permesso di ripiegare su un'altra porta, e un
 * canale IPC su cui chiedere l'arresto. Senza di esse il comportamento è
 * quello di prima.
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

try {
  bootstrap();
} catch (error) {
  // Un avvio che non è sicuro non diventa sicuro proseguendo. Il messaggio è
  // scritto per essere letto da chi usa l'applicazione, non da chi la scrive:
  // dice cosa non si può fare e che l'archivio non è stato modificato.
  logger.error(
    `Avvio interrotto: ${error instanceof Error ? error.message : 'errore sconosciuto'}`,
  );
  process.exit(1);
}

const server = createServer(createApp());

let esito;
try {
  esito = await listenWithFallback(server, {
    host: config.host,
    port: config.port,
    allowFallback: allowPortFallback,
  });
} catch (error) {
  /*
   * Una porta occupata non è un guasto: è una macchina su cui gira già
   * qualcosa.
   *
   * Senza questo messaggio l'errore uscirebbe come traccia di stack, che su
   * una cartella portatile — dove non c'è un terminale a cui rivolgersi — non
   * dice nulla a chi la sta usando. Quando è il launcher ad avviare, questo
   * ramo non si percorre: lì il ripiego è concesso e la porta si trova.
   */
  if (error instanceof ListenFailedError && error.code === 'EADDRINUSE') {
    logger.error(
      `La porta ${String(error.port)} è già occupata da un altro programma. Indica una porta diversa con la variabile MYFINANCE_PORT, oppure scrivila in config/settings.json come {"port": 47318}.`,
    );
  } else {
    logger.error(`Impossibile mettersi in ascolto su ${config.host}:${String(config.port)}`, error);
  }

  process.exit(1);
}

if (esito.fellBack) {
  logger.info(
    `La porta ${String(esito.configuredPort)} era occupata: il server usa la ${String(esito.actualPort)}`,
    { configuredPort: esito.configuredPort, actualPort: esito.actualPort },
  );
}

logger.info(`Backend in ascolto su http://${esito.host}:${String(esito.actualPort)}`, {
  configuredPort: esito.configuredPort,
  actualPort: esito.actualPort,
});

const autoBackup = createAutoBackupScheduler();
autoBackup.start();

installShutdownHandlers(server, autoBackup);

/**
 * Il canale con il launcher.
 *
 * Esiste solo se questo processo è stato avviato con un canale IPC. Serve a
 * due cose che su Windows non si possono ottenere altrimenti:
 *
 *  - **dire quale porta si è aperta**, perché è questo processo a saperlo e il
 *    launcher deve aprirvi il browser;
 *  - **ricevere la richiesta di arresto**, perché `process.kill` su Windows
 *    termina il processo invece di avvisarlo, e un processo terminato non
 *    consolida il WAL.
 */
if (typeof process.send === 'function') {
  process.send({
    type: 'ready',
    host: esito.host,
    port: esito.actualPort,
    configuredPort: esito.configuredPort,
    pid: process.pid,
  });

  process.on('message', (message: unknown) => {
    if (typeof message === 'object' && message !== null && 'type' in message) {
      const { type } = message as { type: unknown };
      if (type === 'shutdown') {
        shutdown(
          server,
          'launcher',
          (code) => {
            process.exit(code);
          },
          autoBackup,
        );
      }
    }
  });
}
