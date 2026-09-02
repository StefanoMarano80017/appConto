import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { ask } from './control.js';
import { readInstanceLock } from './instance-lock.js';
import { ErroreUtente, run, type LauncherOptions, type LauncherOutcome } from './run.js';

/**
 * Il ciclo di vita, provato con un server finto.
 *
 * Il server finto **non** è una scorciatoia: è ciò che permette di provocare a
 * comando le condizioni che contano e che sul server vero non si possono
 * ottenere — un processo che muore all'avvio, uno che non diventa mai pronto,
 * uno che ignora la richiesta di arresto. Il server vero, avviato dal launcher
 * vero, è provato dal package in `verify:package`.
 *
 * Nessun database viene aperto in questo file: il launcher non ne apre, ed è
 * il punto — il lock deve venire prima.
 */

const temporanee: string[] = [];

function temporanea(nome: string): string {
  const creata = mkdtempSync(path.join(tmpdir(), `appconto-run-${nome}-`));
  temporanee.push(creata);

  return creata;
}

/**
 * Un server che parla il protocollo del launcher.
 *
 *  - `normale`          si mette in ascolto, dice di essere pronto, risponde
 *                       alla salute, e si arresta quando gliene viene chiesto;
 *  - `porta-diversa`    si fa assegnare una porta dal sistema, come se quella
 *                       configurata fosse occupata;
 *  - `esce-subito`      muore prima di essere pronto, scrivendo perché;
 *  - `mai-pronto`       si mette in ascolto ma non risponde alla salute;
 *  - `ignora-arresto`   dice di essere pronto e poi non risponde più a niente.
 */
const SERVER_FINTO = `
import { createServer } from 'node:http';

const modo = process.env.FAKE_MODE ?? 'normale';
const configurata = Number(process.env.MYFINANCE_PORT ?? '0');

if (modo === 'esce-subito') {
  process.stderr.write('il finto server rinuncia: archivio di una versione più recente\\n');
  process.exit(3);
}

const server = createServer((req, res) => {
  if (modo === 'mai-pronto') {
    return;
  }
  if (req.url === '/api/health') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.end('finto');
});

server.listen(modo === 'porta-diversa' ? 0 : configurata, '127.0.0.1', () => {
  const { port } = server.address();
  process.stdout.write('finto server in ascolto su ' + port + '\\n');
  process.send?.({
    type: 'ready',
    host: '127.0.0.1',
    port,
    configuredPort: configurata,
    pid: process.pid,
  });
});

process.on('message', (message) => {
  if (message?.type === 'shutdown' && modo !== 'ignora-arresto') {
    process.stdout.write('finto server: arresto ordinato\\n');
    server.close(() => process.exit(0));
  }
});
`;

interface Scenario {
  readonly options: LauncherOptions;
  readonly dataRoot: string;
  readonly lockFile: string;
  readonly browser: string[];
  readonly righe: { livello: 'info' | 'error'; messaggio: string }[];
}

/** Un package finto ma completo, e una radice dati temporanea. */
function scenario(nome: string, overrides: Partial<LauncherOptions> = {}): Scenario {
  const appRoot = temporanea(`app-${nome}`);
  const backendDir = path.join(appRoot, 'app', 'backend');
  const frontendDir = path.join(appRoot, 'app', 'frontend');
  const migrationsDir = path.join(appRoot, 'app', 'drizzle');

  mkdirSync(path.join(backendDir, 'native'), { recursive: true });
  mkdirSync(frontendDir, { recursive: true });
  mkdirSync(path.join(migrationsDir, 'meta'), { recursive: true });

  // I prerequisiti: contenuto irrilevante, esistenza no.
  writeFileSync(path.join(backendDir, 'native', 'better_sqlite3.node'), '', 'utf8');
  writeFileSync(path.join(frontendDir, 'index.html'), '<app-root></app-root>', 'utf8');
  writeFileSync(path.join(migrationsDir, 'meta', '_journal.json'), '{}', 'utf8');

  const serverFinto = path.join(backendDir, 'server.js');
  writeFileSync(serverFinto, SERVER_FINTO, 'utf8');
  writeFileSync(path.join(backendDir, 'package.json'), '{"type":"module"}', 'utf8');

  const dataRoot = temporanea(`dati-${nome}`);

  const browser: string[] = [];
  const righe: { livello: 'info' | 'error'; messaggio: string }[] = [];

  const options: LauncherOptions = {
    appRoot,
    dataRoot,
    backendDir,
    frontendDir,
    migrationsDir,
    lockFile: path.join(dataRoot, 'instance.lock'),
    logsDir: path.join(dataRoot, 'logs'),
    host: '127.0.0.1',
    configuredPort: 0,
    nodeExe: process.execPath,
    serverEntry: serverFinto,
    env: { ...process.env, FAKE_MODE: 'normale' },
    openBrowser: (url) => {
      browser.push(url);
    },
    log: (messaggio) => {
      righe.push({ livello: 'info', messaggio });
    },
    logError: (messaggio) => {
      righe.push({ livello: 'error', messaggio });
    },
    readyTimeoutMs: 20_000,
    shutdownTimeoutMs: 10_000,
    ...overrides,
  };

  // Dalle opzioni **dopo** il merge, non da quelle predefinite: uno scenario
  // che punta alla radice dati di un altro deve guardare il suo lock, non
  // quello che non verrà mai scritto.
  return { dataRoot: options.dataRoot, lockFile: options.lockFile, browser, righe, options };
}

const attendi = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Attende che il lock dichiari la porta del server, cioè che sia pronto. */
async function attendiPronto(lockFile: string): Promise<{ controlPort: number; token: string; serverPort: number }> {
  const scadenza = Date.now() + 30_000;
  for (;;) {
    const lock = readInstanceLock(lockFile);
    if (lock !== null && lock.serverPort !== null) {
      return { controlPort: lock.controlPort, token: lock.token, serverPort: lock.serverPort };
    }
    if (Date.now() > scadenza) {
      throw new Error('il launcher non ha registrato la porta del server');
    }
    await attendi(50);
  }
}

const messaggi = (s: Scenario): string[] => s.righe.map((riga) => riga.messaggio);
const indiceDi = (s: Scenario, frammento: string): number =>
  messaggi(s).findIndex((messaggio) => messaggio.includes(frammento));

describe('avvio completo', () => {
  it('acquisisce il lock, avvia il server, apre il browser e si ferma quando gliene viene chiesto', async () => {
    const s = scenario('completo');
    const promessa = run(s.options);

    const pronto = await attendiPronto(s.lockFile);

    // Il lock esiste e descrive questa istanza.
    const lock = readInstanceLock(s.lockFile);
    assert.equal(lock?.dataRoot, s.dataRoot);
    assert.equal(lock?.appRoot, s.options.appRoot);
    assert.equal(lock?.pid, process.pid);

    // Il browser è stato aperto sulla porta effettiva del server.
    assert.deepEqual(s.browser, [`http://127.0.0.1:${String(pronto.serverPort)}/`]);

    // §21 — l'ordine: pronto prima del browser.
    assert.ok(indiceDi(s, 'Server avviato') >= 0);
    assert.ok(indiceDi(s, 'Server pronto') > indiceDi(s, 'Server avviato'));
    assert.ok(indiceDi(s, 'Browser aperto') > indiceDi(s, 'Server pronto'));

    // L'arresto passa dal canale di controllo, come `stop.bat`.
    const risposta = await ask(pronto.controlPort, { cmd: 'shutdown', token: pronto.token });
    assert.deepEqual(risposta, { ok: true, accepted: 'shutdown' });

    const esito: LauncherOutcome = await promessa;

    assert.equal(esito.kind, 'concluso');
    assert.equal(esito.kind === 'concluso' ? esito.exitCode : -1, 0);
    // Il lock è stato rilasciato: l'applicazione si può riavviare.
    assert.equal(existsSync(s.lockFile), false);
  });

  it('non apre il browser se non è richiesto, ma parte comunque', async () => {
    const s = scenario('senza-browser', { openBrowser: null });
    const promessa = run(s.options);

    const pronto = await attendiPronto(s.lockFile);
    await ask(pronto.controlPort, { cmd: 'shutdown', token: pronto.token });
    await promessa;

    assert.deepEqual(s.browser, []);
    assert.ok(indiceDi(s, 'Server pronto') >= 0);
  });
});

describe('la porta', () => {
  it('quando il server ne apre un-altra, il browser segue quella vera', async () => {
    const s = scenario('porta', {
      configuredPort: 3000,
      env: { ...process.env, FAKE_MODE: 'porta-diversa' },
    });
    const promessa = run(s.options);

    const pronto = await attendiPronto(s.lockFile);

    assert.notEqual(pronto.serverPort, 3000);
    assert.deepEqual(s.browser, [`http://127.0.0.1:${String(pronto.serverPort)}/`]);
    // Le due porte vengono registrate entrambe: è ciò che permette di capire
    // perché l'indirizzo non è quello configurato.
    assert.ok(indiceDi(s, 'La porta 3000 era occupata') >= 0);

    await ask(pronto.controlPort, { cmd: 'shutdown', token: pronto.token });
    await promessa;
  });
});

describe('seconda istanza', () => {
  it('non avvia un secondo server e apre il browser su quello attivo', async () => {
    const primo = scenario('prima');
    const promessa = run(primo.options);
    const pronto = await attendiPronto(primo.lockFile);

    // Un secondo launcher, altra copia del package, stessa radice dati.
    const secondo = scenario('seconda', {
      dataRoot: primo.dataRoot,
      lockFile: primo.lockFile,
    });
    const esito = await run(secondo.options);

    assert.equal(esito.kind, 'gia-in-esecuzione');
    if (esito.kind === 'gia-in-esecuzione') {
      assert.equal(esito.running.serverPort, pronto.serverPort);
      assert.equal(esito.running.pid, process.pid);
    }
    // Al secondo viene mostrata l'applicazione già attiva.
    assert.deepEqual(secondo.browser, [`http://127.0.0.1:${String(pronto.serverPort)}/`]);
    // E il lock resta del primo.
    assert.equal(readInstanceLock(primo.lockFile)?.serverPort, pronto.serverPort);

    await ask(pronto.controlPort, { cmd: 'shutdown', token: pronto.token });
    await promessa;
  });

  it('dopo l-arresto del primo, un nuovo avvio riesce', async () => {
    const primo = scenario('ciclo');
    const p1 = run(primo.options);
    const pronto1 = await attendiPronto(primo.lockFile);
    await ask(pronto1.controlPort, { cmd: 'shutdown', token: pronto1.token });
    await p1;

    const secondo = scenario('ciclo2', {
      dataRoot: primo.dataRoot,
      lockFile: primo.lockFile,
    });
    const p2 = run(secondo.options);
    const pronto2 = await attendiPronto(secondo.lockFile);

    assert.ok(pronto2.serverPort > 0);
    await ask(pronto2.controlPort, { cmd: 'shutdown', token: pronto2.token });
    await p2;
  });
});

describe('avvio non riuscito', () => {
  it('un server che muore subito propaga il suo codice e racconta perché', async () => {
    const s = scenario('morto', { env: { ...process.env, FAKE_MODE: 'esce-subito' } });

    const esito = await run(s.options);

    assert.equal(esito.kind, 'avvio-fallito');
    if (esito.kind === 'avvio-fallito') {
      assert.equal(esito.exitCode, 3, 'il codice di uscita del server va propagato');
      assert.match(esito.detail, /versione più recente/);
    }
    // Nessun browser aperto su un'applicazione che non c'è.
    assert.deepEqual(s.browser, []);
    // E il lock è stato rilasciato: un avvio fallito non deve bloccare il
    // successivo.
    assert.equal(existsSync(s.lockFile), false);
  });

  it('un server che non risponde alla salute non porta all-apertura del browser', async () => {
    const s = scenario('sordo', {
      env: { ...process.env, FAKE_MODE: 'mai-pronto' },
      readyTimeoutMs: 1_500,
      shutdownTimeoutMs: 1_500,
    });

    const esito = await run(s.options);

    assert.equal(esito.kind, 'avvio-fallito');
    if (esito.kind === 'avvio-fallito') {
      assert.match(esito.detail, /non ha risposto/);
    }
    assert.deepEqual(s.browser, [], 'il processo era vivo, ma l-applicazione non rispondeva');
    assert.equal(existsSync(s.lockFile), false);
  });

  it('una copia incompleta è un errore dell-utente, e il lock non viene nemmeno preso', async () => {
    const s = scenario('incompleta');
    rmSync(path.join(s.options.backendDir, 'native', 'better_sqlite3.node'), { force: true });

    await assert.rejects(
      () => run(s.options),
      (error: unknown) => {
        assert.ok(error instanceof ErroreUtente);
        assert.match(error.message, /non è completa/);
        assert.match(error.message, /better_sqlite3\.node/);
        assert.match(error.message, /non vengono toccati/);

        return true;
      },
    );

    assert.equal(existsSync(s.lockFile), false);
  });
});

describe('arresto non rispettato', () => {
  it('un server che ignora la richiesta viene terminato, e lo dice', async () => {
    const s = scenario('testardo', {
      env: { ...process.env, FAKE_MODE: 'ignora-arresto' },
      shutdownTimeoutMs: 700,
    });
    const promessa = run(s.options);
    const pronto = await attendiPronto(s.lockFile);

    await ask(pronto.controlPort, { cmd: 'shutdown', token: pronto.token });
    const esito = await promessa;

    assert.equal(esito.kind, 'concluso');
    // La terminazione forzata è registrata come errore: significa che il WAL
    // non è stato consolidato, e chi legge il registro deve saperlo.
    const errori = s.righe.filter((riga) => riga.livello === 'error').map((riga) => riga.messaggio);
    assert.equal(errori.length, 1);
    assert.match(errori[0] ?? '', /terminazione forzata/);
    assert.match(errori[0] ?? '', /WAL/);
    // Il lock è comunque rilasciato.
    assert.equal(existsSync(s.lockFile), false);
  });

  it('due richieste di arresto non producono due terminazioni', async () => {
    const s = scenario('due-volte');
    const promessa = run(s.options);
    const pronto = await attendiPronto(s.lockFile);

    const prima = await ask(pronto.controlPort, { cmd: 'shutdown', token: pronto.token });
    const seconda = await ask(pronto.controlPort, { cmd: 'shutdown', token: pronto.token });

    // Entrambe accettate — il canale non mente — ma l'arresto avviene una
    // volta sola, e il processo esce con zero.
    assert.deepEqual(prima, { ok: true, accepted: 'shutdown' });
    assert.deepEqual(seconda, { ok: true, accepted: 'shutdown' });

    const esito = await promessa;
    assert.equal(esito.kind === 'concluso' ? esito.exitCode : -1, 0);
    assert.deepEqual(
      s.righe.filter((riga) => riga.livello === 'error'),
      [],
    );
  });
});

describe('igiene del processo', () => {
  it('non lascia gestori di segnali appesi', async () => {
    const prima = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'].map((nome) =>
      process.listenerCount(nome as NodeJS.Signals),
    );

    const s = scenario('igiene');
    const promessa = run(s.options);
    const pronto = await attendiPronto(s.lockFile);
    await ask(pronto.controlPort, { cmd: 'shutdown', token: pronto.token });
    await promessa;

    const dopo = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'].map((nome) =>
      process.listenerCount(nome as NodeJS.Signals),
    );

    // Un gestore rimasto attivo farebbe reagire il launcher a un segnale
    // riguardante un'istanza che non esiste più.
    assert.deepEqual(dopo, prima);
  });
});

after(() => {
  for (const cartella of temporanee) {
    try {
      rmSync(cartella, { recursive: true, force: true });
    } catch {
      // Su Windows un file può restare bloccato: è comunque temporaneo.
    }
  }
});
