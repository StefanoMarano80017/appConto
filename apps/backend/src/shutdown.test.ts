import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
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
const { runMigrations } = await import('./db/client.js');
const { importService } = await import('./modules/import/index.js');
const { installShutdownHandlers, shutdown } = await import('./shutdown.js');

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
  it('vengono registrati per SIGINT, SIGTERM e SIGHUP', () => {
    const prima = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map((segnale) => ({
      segnale,
      conteggio: process.listenerCount(segnale),
    }));

    installShutdownHandlers(server);

    for (const { segnale, conteggio } of prima) {
      assert.ok(
        process.listenerCount(segnale) > conteggio,
        `${segnale} deve avere un gestore`,
      );
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
    const ordine: string[] = [];
    const background = {
      stop: () => {
        ordine.push('scheduler fermato');
      },
    };

    // `shutdown` riceve la funzione di uscita: si osserva il codice senza
    // terminare il processo che esegue i test.
    const codice = await new Promise<number>((resolve) => {
      shutdown(
        server,
        'test',
        (code) => {
          ordine.push('uscita');
          resolve(code);
        },
        background,
      );
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
    let chiamato = false;
    let fermatoDiNuovo = false;

    shutdown(
      server,
      'ripetuto',
      () => {
        chiamato = true;
      },
      {
        stop: () => {
          fermatoDiNuovo = true;
        },
      },
    );

    assert.equal(chiamato, false, 'l’arresto deve avvenire una volta sola');
    // Le richieste arrivano da sorgenti indipendenti — un segnale, il
    // launcher, la chiusura della finestra — e possono arrivare insieme.
    assert.equal(fermatoDiNuovo, false, 'niente va fermato due volte');
  });
});
