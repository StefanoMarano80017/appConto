import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-test-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { runMigrations } = await import('../../db/client.js');
const { importService } = await import('./import.service.js');
const { detectDuplicates } = await import('./duplicate-detector.js');
const { fingerprintAll, transactionsService } = await import('../transactions/index.js');

runMigrations();

after(() => {
  try {
    rmSync(databaseDir, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

const csv = (...rows: string[]): string =>
  ['Data contabile,Descrizione,Importo', ...rows].join('\r\n');

const archived = (prefix: string): number =>
  transactionsService.listAll().filter((t) => t.description.startsWith(prefix)).length;

describe('import idempotente', () => {
  it('importando due volte lo stesso file non crea duplicati', () => {
    const file = csv('01/03/2026,S1 SUPERMERCATO,-10.00', '02/03/2026,S1 BENZINA,-40.50');

    const first = importService.importCsv(file);
    assert.deepEqual(
      { rowsRead: first.rowsRead, imported: first.imported, duplicates: first.duplicates },
      { rowsRead: 2, imported: 2, duplicates: 0 },
    );
    assert.equal(first.merchantsCreated, 2);

    const second = importService.importCsv(file);
    assert.deepEqual(
      { rowsRead: second.rowsRead, imported: second.imported, duplicates: second.duplicates },
      { rowsRead: 2, imported: 0, duplicates: 2 },
    );
    assert.equal(second.merchantsCreated, 0, 'nessun merchant nuovo alla reimportazione');

    assert.equal(archived('S1 '), 2);
  });

  it('di due file con transazioni in comune importa solo le nuove', () => {
    const luglio = csv('01/07/2026,S2 AFFITTO,-500.00', '15/07/2026,S2 FARMACIA,-23.40');
    const agosto = csv('15/07/2026,S2 FARMACIA,-23.40', '03/08/2026,S2 LIBRERIA,-18.90');

    importService.importCsv(luglio);
    const secondo = importService.importCsv(agosto);

    assert.equal(secondo.rowsRead, 2);
    assert.equal(secondo.imported, 1);
    assert.equal(secondo.duplicates, 1);
    assert.equal(archived('S2 '), 3);
  });

  it('conserva i movimenti realmente identici dello stesso file, senza duplicarli alla reimportazione', () => {
    // Caso reale: due pagamenti identici lo stesso giorno.
    const file = csv(
      '05/07/2026,S3 CAFFE,-3.50',
      '05/07/2026,S3 CAFFE,-3.50',
      '05/07/2026,S3 EDICOLA,-2.00',
    );

    const first = importService.importCsv(file);
    assert.equal(first.imported, 3, 'entrambi i pagamenti da 3,50 € vengono conservati');
    assert.equal(first.duplicates, 0);

    const second = importService.importCsv(file);
    assert.equal(second.imported, 0);
    assert.equal(second.duplicates, 3);

    assert.equal(archived('S3 '), 3);
  });

  it('conta come nuovo un terzo movimento identico che compare in un file successivo', () => {
    const due = csv('06/07/2026,S4 CAFFE,-3.50', '06/07/2026,S4 CAFFE,-3.50');
    const tre = csv(
      '06/07/2026,S4 CAFFE,-3.50',
      '06/07/2026,S4 CAFFE,-3.50',
      '06/07/2026,S4 CAFFE,-3.50',
    );

    importService.importCsv(due);
    const secondo = importService.importCsv(tre);

    assert.equal(secondo.imported, 1);
    assert.equal(secondo.duplicates, 2);
    assert.equal(archived('S4 '), 3);
  });

  it('le righe scartate non impediscono l\'import delle altre e non contano come duplicati', () => {
    const file = csv(
      '10/09/2026,S5 VALIDA,-5.00',
      '32/13/2026,S5 DATA ASSURDA,-1.00',
      '11/09/2026,S5 IMPORTO ROTTO,abc',
    );

    const result = importService.importCsv(file);

    assert.equal(result.rowsRead, 3);
    assert.equal(result.imported, 1);
    assert.equal(result.failed, 2);
    assert.equal(result.duplicates, 0);
    assert.equal(result.errors.length, 2);
  });
});

describe('duplicate detection', () => {
  it('riconosce come già presenti solo le transazioni archiviate', () => {
    importService.importCsv(csv('01/10/2026,S6 GIA PRESENTE,-7.00'));

    const batch = fingerprintAll([
      { bookingDate: '2026-10-01', description: 'S6 GIA PRESENTE', amount: -7, type: 'EXPENSE' },
      { bookingDate: '2026-10-02', description: 'S6 NUOVA', amount: -8, type: 'EXPENSE' },
    ]);

    const { toImport, duplicates } = detectDuplicates(batch);

    assert.equal(duplicates, 1);
    assert.deepEqual(
      toImport.map((t) => t.description),
      ['S6 NUOVA'],
    );
  });

  it('non segnala duplicati su un archivio che non contiene quelle transazioni', () => {
    const batch = fingerprintAll([
      { bookingDate: '2026-11-01', description: 'S7 SCONOSCIUTA', amount: -1, type: 'EXPENSE' },
    ]);

    assert.equal(detectDuplicates(batch).duplicates, 0);
  });
});

describe('vincolo del database', () => {
  it('rifiuta due transazioni con lo stesso fingerprint', () => {
    importService.importCsv(csv('01/12/2026,S8 VINCOLO,-9.00'));

    const archiviata = transactionsService
      .listAll()
      .find((t) => t.description === 'S8 VINCOLO');
    assert.ok(archiviata?.fingerprint && archiviata.merchantId);

    assert.throws(
      () =>
        transactionsService.saveAll([
          {
            bookingDate: archiviata.bookingDate,
            description: archiviata.description,
            amount: archiviata.amount,
            type: archiviata.type,
            fingerprint: archiviata.fingerprint as string,
            merchantId: archiviata.merchantId as string,
          },
        ]),
      /UNIQUE constraint failed/,
    );
  });
});

describe('backfill dei fingerprint', () => {
  it('non tocca nulla quando tutte le transazioni hanno già un fingerprint', () => {
    assert.equal(transactionsService.backfillFingerprints(), 0);
  });
});
