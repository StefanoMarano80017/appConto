import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-backfill-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { closeDatabase, db, runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { fingerprintAll } = await import('./transaction-fingerprint.js');
const { transactions } = await import('./transactions.schema.js');
const { transactionsService } = await import('./transactions.service.js');

runMigrations();

after(() => {
  // Chiusa la connessione, su Windows il file non resta bloccato.
  closeDatabase();
  try {
    rmSync(databaseDir, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

describe('backfill dei fingerprint su righe senza fingerprint', () => {
  it('assegna fingerprint distinti e uguali a quelli dell\'import, e il re-import non duplica', () => {
    // Tre righe nate prima dell'introduzione del fingerprint, due identiche nello stesso giorno.
    db.insert(transactions)
      .values([
        {
          id: 'bf-1',
          bookingDate: '2030-03-05',
          description: 'BF CAFFE',
          amountCents: -350,
          fingerprint: null,
          type: 'EXPENSE',
        },
        {
          id: 'bf-2',
          bookingDate: '2030-03-05',
          description: 'BF CAFFE',
          amountCents: -350,
          fingerprint: null,
          type: 'EXPENSE',
        },
        {
          id: 'bf-3',
          bookingDate: '2030-03-06',
          description: 'BF EDICOLA',
          amountCents: -200,
          fingerprint: null,
          type: 'EXPENSE',
        },
      ])
      .run();

    assert.equal(transactionsService.backfillFingerprints(), 3);

    const archiviate = transactionsService.listAll().filter((t) => t.description.startsWith('BF '));
    assert.equal(archiviate.length, 3);
    const assegnati = archiviate.map((t) => t.fingerprint);
    assert.ok(assegnati.every((f) => typeof f === 'string' && f.length > 0));
    assert.equal(new Set(assegnati).size, 3, 'i fingerprint sono tutti distinti');

    // Quelli che produrrebbe un import delle stesse righe, per la stessa funzione.
    const attesi = fingerprintAll([
      { bookingDate: '2030-03-05', description: 'BF CAFFE', amount: -3.5, type: 'EXPENSE' },
      { bookingDate: '2030-03-05', description: 'BF CAFFE', amount: -3.5, type: 'EXPENSE' },
      { bookingDate: '2030-03-06', description: 'BF EDICOLA', amount: -2, type: 'EXPENSE' },
    ]).map((t) => t.fingerprint);
    assert.deepEqual([...assegnati].sort(), [...attesi].sort());

    // Un import reale delle stesse righe riconosce tutto come già presente.
    const file = [
      'Data contabile,Descrizione,Importo',
      '05/03/2030,BF CAFFE,-3.50',
      '05/03/2030,BF CAFFE,-3.50',
      '06/03/2030,BF EDICOLA,-2.00',
    ].join('\r\n');
    const reimport = importService.importCsv(file);

    assert.equal(reimport.imported, 0);
    assert.equal(reimport.duplicates, 3);
    assert.equal(
      transactionsService.listAll().filter((t) => t.description.startsWith('BF ')).length,
      3,
    );
  });

  it('una seconda chiamata non trova più nulla da assegnare', () => {
    assert.equal(transactionsService.backfillFingerprints(), 0);
  });
});
