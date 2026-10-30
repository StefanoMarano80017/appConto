import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import Database from 'better-sqlite3';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-shutdown-'));
const databaseFile = path.join(databaseDir, 'shutdown-test.db');
process.env.DATABASE_FILE = databaseFile;

const { createApp } = await import('./app.js');
const { config } = await import('./config.js');
const { closeDatabase, runMigrations } = await import('./db/client.js');
const { importService } = await import('./modules/import/index.js');
const { logger } = await import('./shared/logger.js');
const {
  createShutdown,
  installShutdownHandlers,
  installSignalHandlers,
  shutdown,
} = await import('./shutdown.js');

runMigrations();

const server = createApp().listen(0, config.host);
await new Promise<void>((resolve) => server.once('listening', resolve));
const { port } = server.address() as AddressInfo;

after(() => {
  try {
    rmSync(databaseDir, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

// Registrazioni di attività e uscita: la stessa istanza serve a tutti i test
// del modulo, così "una seconda richiesta" riguarda davvero la prima.
const ordine: string[] = [];
let fermatoDiNuovo = false;
let uscito = false;
let risolviUscita: ((code: number) => void) | undefined;
const background = {
  stop: () => {
    ordine.push('scheduler fermato');
    if (uscito) {
      fermatoDiNuovo = true;
    }
  },
};
const exit = (code: number): void => {
  ordine.push('uscita');
  uscito = true;
  risolviUscita?.(code);
};
const richiedi = createShutdown({ server, background, closeDatabase, exit, log: logger });

const walFile = `${databaseFile}-wal`;
const sizeOf = (file: string): number | null => (existsSync(file) ? statSync(file).size : null);

describe('isolamento del test', () => {
  it('il processo usa un database temporaneo', () => {
    assert.equal(config.databaseFile, databaseFile);
    assert.ok(config.databaseFile.startsWith(tmpdir()));
    assert.ok(!config.databaseFile.includes(`apps${path.sep}backend${path.sep}data`));
  });
});

describe('gestori dei segnali', () => {
  /**
   * `SIGHUP` è la chiusura della finestra.
   *
   * Su Windows Node lo sintetizza quando la console viene chiusa, e concede
   * pochi secondi prima che il processo venga terminato comunque. È la
   * sorgente che conta per chi usa la cartella portatile: senza un gestore,
   * chiudere la finestra sarebbe una terminazione brusca, e il WAL resterebbe
   * da consolidare.
   */
  it('vengono registrati per SIGINT, SIGTERM, SIGHUP e SIGBREAK', () => {
    const emitter = new EventEmitter();
    installSignalHandlers(() => {}, emitter);

    for (const segnale of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
      assert.equal(emitter.listenerCount(segnale), 1, `${segnale} deve avere un gestore`);
    }
  });
});

describe('arresto ordinato', () => {
  it('smette di servire, consolida il WAL e non perde dati', async () => {
    // Scritture reali, sufficienti a far crescere il WAL.
    const righe = Array.from(
      { length: 300 },
      (_unused, indice) =>
        `${String((indice % 28) + 1).padStart(2, '0')}/04/2026,MOVIMENTO ${indice},-${indice + 1}.00`,
    );
    importService.importCsv(['Data contabile,Descrizione,Importo', ...righe].join('\r\n'));

    const walPrima = sizeOf(walFile);
    assert.ok(walPrima !== null && walPrima > 0, 'il WAL deve contenere le scritture');

    // Il servizio è attivo prima dell'arresto.
    const prima = await fetch(`http://127.0.0.1:${String(port)}/api/health`);
    assert.equal(prima.status, 200);

    /*
     * Le attività periodiche vengono fermate **prima** di tutto il resto.
     *
     * Uno scheduler di backup ancora attivo potrebbe avviare un `VACUUM INTO`
     * mentre il database si sta chiudendo. L'ordine si osserva registrando
     * quando `stop` viene chiamata rispetto all'uscita.
     */
    // `richiedi` riceve la funzione di uscita: si osserva il codice senza
    // terminare il processo che esegue i test.
    const codice = await new Promise<number>((resolve) => {
      risolviUscita = resolve;
      richiedi('test');
    });

    assert.equal(codice, 0);
    assert.deepEqual(ordine, ['scheduler fermato', 'uscita']);

    // 1. non accetta più richieste
    await assert.rejects(
      fetch(`http://127.0.0.1:${String(port)}/api/health`),
      'la porta non deve più rispondere dopo l’arresto',
    );

    // 2. il WAL è stato consolidato: il database è un file singolo
    const walDopo = sizeOf(walFile);
    assert.ok(
      walDopo === null || walDopo === 0,
      `il WAL doveva essere assente o vuoto, misurava ${String(walDopo)}`,
    );

    // 3. riaprendo solo quel file si ritrova tutto
    const riaperto = new Database(databaseFile, { readonly: true });
    const movimenti = riaperto.prepare('select count(*) as totale from transactions').get() as {
      totale: number;
    };
    riaperto.close();

    assert.equal(movimenti.totale, 300, 'nessun movimento perso dopo l’arresto');
  });

  it('una seconda richiesta di arresto non fa nulla', () => {
    const uscite = ordine.filter((voce) => voce === 'uscita').length;

    richiedi('ripetuto');

    assert.equal(
      ordine.filter((voce) => voce === 'uscita').length,
      uscite,
      'l’arresto deve avvenire una volta sola',
    );
    // Le richieste arrivano da sorgenti indipendenti — un segnale, il
    // launcher, la chiusura della finestra — e possono arrivare insieme.
    assert.equal(fermatoDiNuovo, false, 'niente va fermato due volte');
  });
});

describe('compatibilità legacy', () => {
  it('riutilizza sullo stesso server le dipendenze della prima richiesta', () => {
    const chiamate: string[] = [];
    let callbackClose: (() => void) | undefined;
    const server = {
      close(callback?: () => void) {
        callbackClose = callback;
      },
      closeIdleConnections() {},
      closeAllConnections() {},
    } as unknown as Server;

    shutdown(
      server,
      'prima',
      (code) => chiamate.push(`prima exit ${String(code)}`),
      { stop: () => chiamate.push('primo background') },
    );
    shutdown(
      server,
      'seconda',
      (code) => chiamate.push(`seconda exit ${String(code)}`),
      { stop: () => chiamate.push('secondo background') },
    );

    assert.deepEqual(chiamate, ['primo background']);
    callbackClose?.();
    assert.deepEqual(chiamate, ['primo background', 'prima exit 0']);
  });

  it('mantiene procedure indipendenti per server differenti', () => {
    const chiamate: string[] = [];
    const callbacks: (() => void)[] = [];
    const creaServerFinto = (): Server =>
      ({
        close(callback?: () => void) {
          if (callback !== undefined) callbacks.push(callback);
        },
        closeIdleConnections() {},
        closeAllConnections() {},
      }) as unknown as Server;

    shutdown(
      creaServerFinto(),
      'server A',
      (code) => chiamate.push(`A ${String(code)}`),
      { stop: () => chiamate.push('stop A') },
    );
    shutdown(
      creaServerFinto(),
      'server B',
      (code) => chiamate.push(`B ${String(code)}`),
      { stop: () => chiamate.push('stop B') },
    );

    assert.deepEqual(chiamate, ['stop A', 'stop B']);
    callbacks[1]?.();
    callbacks[0]?.();
    assert.deepEqual(chiamate, ['stop A', 'stop B', 'B 0', 'A 0']);
  });

  it('registra i tre signal handler legacy', () => {
    const segnali = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
    const precedenti = new Map(
      segnali.map((signal) => [signal, new Set(process.listeners(signal))]),
    );

    try {
      installShutdownHandlers({} as Server);
      for (const signal of segnali) {
        const aggiunti = process.listeners(signal).filter((listener) => !precedenti.get(signal)?.has(listener));
        assert.equal(aggiunti.length, 1, `${signal} deve avere un nuovo handler`);
      }
    } finally {
      for (const signal of segnali) {
        for (const listener of process.listeners(signal)) {
          if (!precedenti.get(signal)?.has(listener)) {
            process.removeListener(signal, listener);
          }
        }
      }
    }
  });
});
