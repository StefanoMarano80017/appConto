import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

/**
 * I vincoli di importo e di capienza dei prestiti.
 *
 * Complementa `loans.service.test.ts`: qui si fissano i casi di confine —
 * origine con segno sbagliato, capienza del movimento di restituzione,
 * arrotondamento al centesimo, criteri di ricerca.
 */

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-loans-validation-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { closeDatabase, runMigrations } = await import('../../db/client.js');
const { DomainError } = await import('../../shared/errors.js');
const { importService } = await import('../import/index.js');
const { transactionsService } = await import('../transactions/index.js');
const { DEFAULT_LOAN_QUERY } = await import('./loan-query.js');
const { loansService } = await import('./loans.service.js');

runMigrations();

after(() => {
  closeDatabase();
  try {
    rmSync(databaseDir, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

const csv = (...rows: string[]): string =>
  ['Data contabile,Tipologia,Descrizione,Importo', ...rows].join('\r\n');

function transactionId(description: string): string {
  const transaction = transactionsService.listAll().find((t) => t.description === description);
  assert.ok(transaction, `transazione "${description}" non trovata`);
  return transaction.id;
}

function setType(description: string, type: 'LOAN' | 'OTHER' | 'EXPENSE' | 'INCOME'): void {
  transactionsService.updateType(transactionId(description), type);
}

/** Il codice di dominio dell'errore: VALIDATION → 400, NOT_FOUND → 404. */
function expectError(
  code: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT',
  fn: () => unknown,
  message?: RegExp,
): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError, `atteso un errore di dominio, ricevuto ${String(error)}`);
    assert.equal(error.code, code, `atteso ${code}, ricevuto ${error.code}: ${error.message}`);
    if (message !== undefined) {
      assert.match(error.message, message);
    }
    return true;
  });
}

importService.importCsv(
  csv(
    '01/04/2034,Accredito,V1 ACCREDITO CLASSIFICATO PRESTITO,250.00',
    '02/04/2034,Bonifico,V1 USCITA PRESTITO,-250.00',
  ),
);

setType('V1 ACCREDITO CLASSIFICATO PRESTITO', 'LOAN');
setType('V1 USCITA PRESTITO', 'LOAN');

describe('origine del prestito', () => {
  it('rifiuta un movimento di tipo prestito con importo positivo', () => {
    expectError(
      'VALIDATION',
      () =>
        loansService.create({
          transactionId: transactionId('V1 ACCREDITO CLASSIFICATO PRESTITO'),
          borrowerName: 'Luca',
          amount: 250,
          lentAt: '2034-04-01',
        }),
      /uscita/,
    );
    assert.equal(loansService.list(DEFAULT_LOAN_QUERY).totals.loanCount, 0);
  });

  it('accetta un movimento di tipo prestito con importo negativo', () => {
    const loan = loansService.create({
      transactionId: transactionId('V1 USCITA PRESTITO'),
      borrowerName: 'Luca',
      amount: 250,
      lentAt: '2034-04-02',
    });

    assert.equal(loan.amount, 250);
  });
});
