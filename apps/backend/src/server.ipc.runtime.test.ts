import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import type { AddressInfo, Server } from 'node:net';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

/**
 * Il protocollo IPC fra server e launcher, provato sul processo reale.
 *
 * Il launcher non usa segnali: su Windows `process.kill` termina il processo
 * senza avvisarlo, e un processo terminato non consolida il WAL. Parla invece
 * su un canale IPC — il server annuncia la porta con `ready`, il launcher
 * chiede l'arresto con `shutdown`. È l'unico percorso che funziona uguale su
 * ogni piattaforma, ed è quello che questo file fissa, spawnando `main.ts`
 * esattamente come fa `launcher/run.ts` (stesso `stdio`, stesso ripiego).
 *
 * Caratterizzazione: descrive il comportamento di oggi prima di rifattorizzare
 * `main.ts`. Il solo caso che oggi non regge — la disconnessione del launcher —
 * è marcato `todo` e si attiva quando il server impara a gestirla.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..', '..');
const mainEntry = path.join(here, 'main.ts');

// Percorso assoluto del transpilatore, come in `runtime.test.ts`: il cwd del
// figlio è una cartella arbitraria e `--import tsx` non lo troverebbe.
//
// Qui però non si passa dal `cli.mjs` di tsx: quello avvia a sua volta un
// processo node, e il `pid` annunciato dal server non sarebbe più quello del
// figlio diretto — né lo sarebbe il processo da fermare con `kill()`. Caricando
// tsx con `--import` il figlio È il server, come per il launcher.
const tsxLoader = pathToFileURL(path.join(appRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;

const temporanee: string[] = [];
const figli: ChildProcess[] = [];
const occupanti: Server[] = [];

function cartellaTemporanea(prefisso: string): string {
  const creata = mkdtempSync(path.join(tmpdir(), prefisso));
  temporanee.push(creata);

  return creata;
}

// Qualunque cosa sia successa nei test, niente deve restare vivo: né un
// figlio rimasto in attesa, né una porta tenuta occupata.
after(async () => {
  for (const figlio of figli) {
    if (figlio.exitCode === null && figlio.signalCode === null) {
      figlio.kill();
    }
  }
  await Promise.all(
    occupanti.map(
      (occupante) =>
        new Promise<void>((resolve) => {
          occupante.close(() => {
            resolve();
          });
        }),
    ),
  );
  for (const cartella of temporanee) {
    try {
      rmSync(cartella, { recursive: true, force: true });
    } catch {
      // su Windows il file può restare bloccato: è comunque una cartella temporanea
    }
  }
});

/** Occupa una porta scelta dal sistema e la tiene finché dura il file. */
function occupaPorta(): Promise<number> {
  return new Promise((resolve, reject) => {
    const occupante = createServer();
    occupanti.push(occupante);
    occupante.on('error', reject);
    occupante.listen(0, '127.0.0.1', () => {
      resolve((occupante.address() as AddressInfo).port);
    });
  });
}

interface ReadyMessage {
  readonly type: string;
  readonly host: string;
  readonly port: number;
  readonly configuredPort: number;
  readonly pid: number;
}

interface Figlio {
  readonly child: ChildProcess;
  readonly output: () => string;
}

/** Avvia `main.ts` come lo avvia il launcher: con il canale IPC. */
function avvia(dataRoot: string, port: number, ripiego: boolean): Figlio {
  // Ambiente costruito, non ereditato: `DATABASE_FILE` o `PORT` lasciati dal
  // processo di test cambierebbero silenziosamente il bersaglio.
  const env = { ...process.env };
  delete env.DATABASE_FILE;
  delete env.PORT;
  delete env.MYFINANCE_PORT_FALLBACK;
  env.MYFINANCE_DATA = dataRoot;
  env.MYFINANCE_PORT = String(port);
  if (ripiego) {
    env.MYFINANCE_PORT_FALLBACK = '1';
  }

  let output = '';
  const child = spawn(process.execPath, ['--import', tsxLoader, mainEntry], {
    cwd: cartellaTemporanea('appconto-ipc-cwd-'),
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  figli.push(child);
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (blocco: string) => {
    output += blocco;
  });
  child.stderr?.on('data', (blocco: string) => {
    output += blocco;
  });

  return { child, output: () => output };
}

/** Il primo messaggio `ready`, oppure un rifiuto se il processo esce prima. */
function pronto(child: ChildProcess): Promise<ReadyMessage> {
  return new Promise((resolve, reject) => {
    child.on('message', (message: unknown) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: unknown }).type === 'ready'
      ) {
        resolve(message as ReadyMessage);
      }
    });
    child.once('exit', (codice) => {
      reject(new Error(`il processo è uscito (${String(codice)}) prima di annunciarsi`));
    });
  });
}

/**
 * Il codice di uscita, oppure un rifiuto a scadenza.
 *
 * Alla scadenza il figlio viene ucciso: un processo rimasto in attesa
 * terrebbe aperto il file di test, e con esso l'intera suite. Si attende
 * `close` e non `exit` perché solo allora l'output è stato letto per intero.
 * Il rifiuto è già gestito qui: se il test fallisce prima di attenderlo non
 * resta una promessa respinta senza ascoltatori.
 */
function uscita(child: ChildProcess, ms = 30_000): Promise<number | null> {
  const attesa = new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`il processo non è uscito entro ${String(ms)} ms`));
    }, ms);
    child.once('close', (codice) => {
      clearTimeout(timer);
      resolve(codice);
    });
  });
  attesa.catch(() => undefined);

  return attesa;
}

const sizeOf = (file: string): number | null => (existsSync(file) ? statSync(file).size : null);

describe('server avviato con canale IPC', () => {
  it('annuncia la porta effettiva, ripiegando se la configurata è occupata', async () => {
    const occupata = await occupaPorta();
    const { child } = avvia(cartellaTemporanea('appconto-ipc-data-'), occupata, true);
    const attesaUscita = uscita(child);

    const ready = await pronto(child);

    assert.equal(ready.type, 'ready');
    assert.equal(ready.host, '127.0.0.1');
    assert.equal(ready.configuredPort, occupata);
    assert.notEqual(ready.port, occupata, 'la porta occupata non può essere quella effettiva');
    assert.equal(ready.pid, child.pid);

    const salute = await fetch(`http://127.0.0.1:${String(ready.port)}/api/health`);
    assert.equal(salute.status, 200);

    child.send({ type: 'shutdown' });
    assert.equal(await attesaUscita, 0);
  });

  it("l'arresto chiesto via IPC consolida il WAL, anche se chiesto due volte", async () => {
    const dataRoot = cartellaTemporanea('appconto-ipc-data-');
    const databaseFile = path.join(dataRoot, 'database.sqlite');
    const { child, output } = avvia(dataRoot, 0, true);
    const attesaUscita = uscita(child);

    const ready = await pronto(child);

    const scrittura = await fetch(`http://127.0.0.1:${String(ready.port)}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initialBalance: 4321.99, balanceDate: '2026-05-01' }),
    });
    assert.equal(scrittura.status, 200);

    const walPrima = sizeOf(`${databaseFile}-wal`);
    assert.ok(walPrima !== null && walPrima > 0, 'il WAL contiene la scrittura appena fatta');

    // Il launcher può chiedere l'arresto più volte (segnale e canale di
    // controllo insieme): la seconda richiesta non deve avere effetto.
    child.send({ type: 'shutdown' });
    child.send({ type: 'shutdown' });

    assert.equal(await attesaUscita, 0, 'un arresto ordinato esce con zero');

    const walDopo = sizeOf(`${databaseFile}-wal`);
    assert.ok(walDopo === null || walDopo === 0, 'il WAL va consolidato alla chiusura');

    const richieste = output().split('Arresto richiesto (launcher)').length - 1;
    assert.equal(richieste, 1, "l'arresto va eseguito una volta sola");

    const riaperto = new Database(databaseFile, { readonly: true });
    const riga = riaperto.prepare('select initial_balance_cents as c from settings').get() as {
      c: number;
    };
    riaperto.close();

    assert.equal(riga.c, 432199, 'nessun dato perso');
  });

  // Oggi fallisce per scadenza: se il launcher muore o chiude il canale, il
  // server resta orfano invece di fermarsi.
  it(
    'se il launcher si disconnette il server si arresta in ordine',
    { todo: 'attivato nel Task 4' },
    async () => {
      const { child, output } = avvia(cartellaTemporanea('appconto-ipc-data-'), 0, true);
      const attesaUscita = uscita(child, 10_000);

      await pronto(child);
      child.disconnect();

      assert.equal(await attesaUscita, 0);
      assert.match(output(), /Arresto richiesto \(launcher disconnesso\)/);
      assert.match(output(), /Arresto completato/);
    },
  );

  it('porta occupata senza ripiego: uscita 1 e messaggio per l’utente', async () => {
    const occupata = await occupaPorta();
    const { child, output } = avvia(cartellaTemporanea('appconto-ipc-data-'), occupata, false);
    const attesaUscita = uscita(child);

    // Nessun `ready`: il processo deve uscire prima di annunciarsi.
    await assert.rejects(pronto(child), /prima di annunciarsi/);

    assert.equal(await attesaUscita, 1);
    assert.match(output(), /è già occupata da un altro programma/);
    assert.match(output(), /MYFINANCE_PORT/);
  });
});
