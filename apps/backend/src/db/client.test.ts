import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import Database from 'better-sqlite3';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-wal-'));
const databaseFile = path.join(databaseDir, 'wal-test.db');
process.env.DATABASE_FILE = databaseFile;

const { closeDatabase, runMigrations } = await import('./client.js');
const { config } = await import('../config.js');
const { BACKUPS_DIR, DATA_ROOT, LOGS_DIR, TMP_DIR } = await import('../paths.js');
const { importService } = await import('../modules/import/index.js');
const { transactionsService } = await import('../modules/transactions/index.js');

runMigrations();

after(() => {
  try {
    rmSync(databaseDir, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

const walFile = `${databaseFile}-wal`;

/** La dimensione del file, oppure `null` se non esiste. */
const sizeOf = (file: string): number | null => (existsSync(file) ? statSync(file).size : null);

describe('isolamento del test', () => {
  it('usa un database temporaneo, non quello reale', () => {
    assert.equal(config.databaseFile, databaseFile);
    assert.ok(config.databaseFile.startsWith(tmpdir()));
    assert.ok(
      !config.databaseFile.includes(`apps${path.sep}backend${path.sep}data`),
      'il test non deve mai puntare al DATA_ROOT reale',
    );
  });

  it('DATA_ROOT segue il database, quindi log e temporanei restano isolati', () => {
    assert.equal(DATA_ROOT, databaseDir);
    for (const directory of [BACKUPS_DIR, LOGS_DIR, TMP_DIR]) {
      assert.ok(directory.startsWith(databaseDir));
      assert.ok(existsSync(directory), `${directory} deve essere stata creata`);
    }
  });
});

describe('ciclo di vita del WAL', () => {
  it('consolida il WAL alla chiusura e non perde nulla', () => {
    // 1. il database esiste e usa il WAL
    assert.ok(existsSync(databaseFile));
    assert.equal(
      (new Database(databaseFile, { readonly: true }).pragma('journal_mode', {
        simple: true,
      }) as string).toLowerCase(),
      'wal',
    );

    // 2. si scrive abbastanza da far crescere il WAL
    const righe = Array.from(
      { length: 400 },
      (_unused, indice) =>
        `${String((indice % 28) + 1).padStart(2, '0')}/03/2026,MOVIMENTO ${indice},-${indice + 1}.00`,
    );
    importService.importCsv(['Data contabile,Descrizione,Importo', ...righe].join('\r\n'));

    const righeArchiviate = transactionsService.listAll().length;
    assert.equal(righeArchiviate, 400);

    const walPrima = sizeOf(walFile);
    assert.ok(walPrima !== null && walPrima > 0, 'il WAL deve contenere le scritture appena fatte');

    // 3. arresto: checkpoint e chiusura
    const esito = closeDatabase();

    assert.equal(esito.alreadyClosed, false);
    assert.equal(esito.checkpointed, true, 'il checkpoint non deve risultare occupato');
    assert.equal(esito.walPages, 0, 'dopo il troncamento non devono restare pagine nel WAL');

    // 4. il WAL è sparito o è vuoto: il database è un file singolo
    const walDopo = sizeOf(walFile);
    assert.ok(
      walDopo === null || walDopo === 0,
      `il WAL doveva essere assente o vuoto, misurava ${String(walDopo)}`,
    );

    // 5. i dati sono nel file principale, non altrove
    const principale = sizeOf(databaseFile);
    assert.ok(principale !== null && principale > walPrima / 2, 'i dati devono essere stati trasferiti');

    // 6. riaprendo soltanto quel file si ritrova tutto
    const riaperto = new Database(databaseFile, { readonly: true });
    const conteggio = riaperto.prepare('select count(*) as totale from transactions').get() as {
      totale: number;
    };
    const categorie = riaperto.prepare('select count(*) as totale from categories').get() as {
      totale: number;
    };
    riaperto.close();

    assert.equal(conteggio.totale, righeArchiviate, 'nessuna transazione persa dopo la chiusura');
    assert.equal(categorie.totale, 22, 'le migrazioni erano state applicate da APP_ROOT');
  });

  it('chiudere due volte non è un errore', () => {
    const esito = closeDatabase();

    assert.equal(esito.alreadyClosed, true);
    assert.equal(esito.checkpointed, true);
  });
});
