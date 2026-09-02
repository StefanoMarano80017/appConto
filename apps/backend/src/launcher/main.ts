import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { SETTINGS_PROBLEM } from '../paths.js';
import { logger } from '../shared/logger.js';
import { openInBrowser, shouldOpenBrowser } from './browser.js';
import { EXIT, finestraTemporanea, presentaErrore } from './presentation.js';
import { serverEntry } from './prerequisites.js';
import { run, type LauncherOutcome } from './run.js';
import { arrestaIstanza, presentaArresto } from './stop.js';

/**
 * Il punto d'ingresso della cartella portatile.
 *
 * `start.bat` avvia questo file con il `node.exe` incluso. Da qui in avanti
 * nessuna decisione dipende dalla directory da cui l'utente ha lanciato lo
 * script: il launcher si trova accanto al programma che deve avviare, e lo
 * deduce dalla posizione di sé stesso.
 *
 * Il file **non** sta in una cartella propria, e non è un dettaglio: il bundle
 * finisce accanto a `server.js`, dentro `app/backend/`. È così che `paths.ts`
 * risolve le due radici allo stesso modo per entrambi — riconosce `app/backend`
 * guardando i segmenti finali del percorso del proprio modulo — e non esistono
 * due deduzioni di `APP_ROOT` che possano divergere.
 *
 * Qui non c'è logica: si compongono le parti reali e si traduce l'esito in un
 * messaggio e in un codice di uscita. Tutto ciò che si può sbagliare sta nei
 * moduli accanto, dove si può verificare.
 */

/** Dove sta questo file: nel package `app/backend/`, nel repository `dist/`. */
const backendDir = path.dirname(fileURLToPath(import.meta.url));

/** Trattiene la finestra il tempo di leggere. */
function attendiUnTasto(): void {
  console.error('\nPremi un tasto per chiudere questa finestra.');

  try {
    // `pause` di `cmd` e non una lettura da `stdin`: su Windows la lettura
    // sincrona da una console non è affidabile, mentre `pause` è fatto
    // esattamente per questo. L'output è soppresso perché il messaggio
    // l'abbiamo già scritto noi, nella lingua dell'applicazione.
    execFileSync(process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe', ['/c', 'pause'], {
      stdio: ['inherit', 'ignore', 'ignore'],
    });
  } catch {
    // Nessuna console: non c'era niente da trattenere.
  }
}

if (SETTINGS_PROBLEM !== null) {
  logger.error(`Configurazione ignorata, si usano i valori predefiniti: ${SETTINGS_PROBLEM}`);
}

/**
 * `--stop` non avvia niente: chiede all'istanza in esecuzione di fermarsi.
 *
 * È lo stesso punto d'ingresso perché è la stessa applicazione, e perché il
 * percorso per trovare l'istanza — il lock dentro `DATA_ROOT` — dipende dalla
 * stessa risoluzione dei percorsi. Un secondo programma la dedurrebbe una
 * seconda volta.
 */
if (process.argv.slice(2).includes('--stop')) {
  const outcome = await arrestaIstanza({ lockFile: config.instanceLockFile });
  const presentazione = presentaArresto(outcome);

  logger.info('Arresto richiesto da --stop', { esito: outcome.kind });
  console.log('');
  console.log(presentazione.testo);
  console.log('');

  process.exit(presentazione.code);
}

let uscita: number = EXIT.ok;

try {
  const esito: LauncherOutcome = await run({
    appRoot: config.appRoot,
    dataRoot: config.dataRoot,
    backendDir,
    frontendDir: config.frontendDir,
    migrationsDir: config.migrationsFolder,
    lockFile: config.instanceLockFile,
    logsDir: config.logsDir,
    host: config.host,
    configuredPort: config.port,
    // Il runtime che sta eseguendo questo file: nel package è
    // `runtime\node.exe`. Mai `node` risolto dal `PATH` — sulla macchina di
    // chi usa la cartella portatile non c'è.
    nodeExe: process.execPath,
    serverEntry: serverEntry(backendDir),
    env: process.env,
    openBrowser: shouldOpenBrowser(process.env) ? openInBrowser : null,
    log: (message, details) => {
      logger.info(message, details);
    },
    logError: (message, details) => {
      logger.error(message, details);
    },
    readyTimeoutMs: 90_000,
    shutdownTimeoutMs: 20_000,
  });

  switch (esito.kind) {
    case 'concluso':
      uscita = esito.exitCode;
      break;

    case 'gia-in-esecuzione':
      console.log('');
      console.log('MyFinance è già in esecuzione per questo archivio.');
      if (esito.running.serverPort === null) {
        console.log("L'istanza attiva sta ancora partendo: attendi qualche istante.");
      } else {
        console.log(
          `L'applicazione è aperta su http://${config.host}:${String(esito.running.serverPort)}/`,
        );
      }
      console.log('');
      // Non è un errore: l'utente voleva l'applicazione, e l'applicazione c'è.
      uscita = EXIT.ok;
      break;

    case 'avvio-fallito':
      logger.error('Avvio non completato', { exitCode: esito.exitCode });
      console.error('');
      console.error('MyFinance non è riuscita a partire.');
      console.error('');
      console.error(esito.detail);
      console.error('');
      console.error(`Il registro completo è in:\n  ${config.logsDir}`);
      console.error('');
      uscita = esito.exitCode;
      break;
  }
} catch (error) {
  const presentazione = presentaErrore(error, config.logsDir);

  logger.error('Avvio interrotto', error);
  console.error('');
  console.error(presentazione.testo);
  console.error('');

  uscita = presentazione.code;
}

if (uscita !== EXIT.ok && finestraTemporanea(process.env, process.stdin.isTTY === true)) {
  attendiUnTasto();
}

process.exit(uscita);
