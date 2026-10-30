import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-loans-repayment-rules-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { closeDatabase, runMigrations } = await import('../../db/client.js');
const { DomainError } = await import('../../shared/errors.js');
const { importService } = await import('../import/index.js');
const { transactionsService } = await import('../transactions/index.js');
const { loansService } = await import('./loans.service.js');

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

/**
 * Le regole delle restituzioni decise dopo M2.
 *
 * D9: una restituzione si collega solo a un movimento `INCOME`, e un movimento
 * collegato non esce più da `INCOME`.
 * D10: una restituzione non può essere anteriore alla data del prestito.
 */
const csv = (...rows: string[]): string =>
  ['Data contabile,Tipologia,Descrizione,Importo', ...rows].join('\r\n');

importService.importCsv(
  csv(
    '05/01/2040,Bonifico,ORIGINE GENERALE,-900.00',
    '10/02/2040,Accredito,ENTRATA A,100.00',
    '11/02/2040,Accredito,ENTRATA B,100.00',
    '12/02/2040,Accredito,ENTRATA LIBERA,100.00',
    '13/02/2040,Accredito,ACCREDITO ALTRO,100.00',
    '14/02/2040,Accredito,ACCREDITO SPESA,100.00',
    '15/02/2040,Accredito,ACCREDITO TRASFERIMENTO,100.00',
    '16/02/2040,Accredito,ACCREDITO PRELIEVO,100.00',
    '10/03/2040,Bonifico,ORIGINE DATE,-600.00',
  ),
);

function transactionId(description: string): string {
  const transaction = transactionsService.listAll().find((t) => t.description === description);
  assert.ok(transaction, `transazione "${description}" non trovata`);
  return transaction.id;
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

transactionsService.updateType(transactionId('ORIGINE GENERALE'), 'LOAN');
transactionsService.updateType(transactionId('ORIGINE DATE'), 'LOAN');
for (const nome of ['ENTRATA A', 'ENTRATA B', 'ENTRATA LIBERA']) {
  transactionsService.updateType(transactionId(nome), 'INCOME');
}
transactionsService.updateType(transactionId('ACCREDITO ALTRO'), 'OTHER');
transactionsService.updateType(transactionId('ACCREDITO SPESA'), 'EXPENSE');
transactionsService.updateType(transactionId('ACCREDITO TRASFERIMENTO'), 'TRANSFER');
transactionsService.updateType(transactionId('ACCREDITO PRELIEVO'), 'WITHDRAWAL');

const generale = loansService.create({
  transactionId: transactionId('ORIGINE GENERALE'),
  borrowerName: 'Marco',
  description: null,
  amount: 900,
  lentAt: '2040-01-05',
});

describe('D9: la restituzione si collega solo a un movimento INCOME', () => {
  it('rifiuta in creazione un accredito di tipo OTHER, EXPENSE, TRANSFER o WITHDRAWAL', () => {
    for (const nome of [
      'ACCREDITO ALTRO',
      'ACCREDITO SPESA',
      'ACCREDITO TRASFERIMENTO',
      'ACCREDITO PRELIEVO',
    ]) {
      expectError(
        'VALIDATION',
        () =>
          loansService.addRepayment(generale.id, {
            amount: 50,
            repaymentDate: '2040-02-20',
            transactionId: transactionId(nome),
          }),
        /entrata/,
      );
    }

    assert.equal(loansService.getById(generale.id).repaymentCount, 0);
  });

  it('accetta in creazione un accredito INCOME', () => {
    const detail = loansService.addRepayment(generale.id, {
      amount: 50,
      repaymentDate: '2040-02-20',
      transactionId: transactionId('ENTRATA A'),
    });

    assert.equal(detail.repaidAmount, 50);
  });

  it('rifiuta in modifica il collegamento a un accredito non INCOME, e non cambia nulla', () => {
    const repayment = loansService.getById(generale.id).repayments[0];
    assert.ok(repayment);

    for (const nome of ['ACCREDITO ALTRO', 'ACCREDITO SPESA']) {
      expectError(
        'VALIDATION',
        () =>
          loansService.updateRepayment(generale.id, repayment.id, {
            transactionId: transactionId(nome),
          }),
        /entrata/,
      );
    }

    const dopo = loansService.getById(generale.id).repayments[0];
    assert.equal(dopo?.transaction?.id, transactionId('ENTRATA A'));
  });

  it('accetta in modifica il collegamento a un altro INCOME', () => {
    const repayment = loansService.getById(generale.id).repayments[0];
    assert.ok(repayment);

    const detail = loansService.updateRepayment(generale.id, repayment.id, {
      transactionId: transactionId('ENTRATA B'),
    });

    assert.equal(detail.repayments[0]?.transaction?.id, transactionId('ENTRATA B'));
  });
});

describe('D9: un movimento collegato a una restituzione non esce da INCOME', () => {
  const dependents = {
    usagesOf: (ids: readonly string[]) => loansService.transactionUsages(ids),
  };

  it('rifiuta il passaggio a un tipo non INCOME, con il nome del prestito e il tipo invariato', () => {
    const id = transactionId('ENTRATA B');

    for (const type of ['OTHER', 'EXPENSE', 'TRANSFER', 'WITHDRAWAL', 'LOAN'] as const) {
      expectError('CONFLICT', () => transactionsService.updateType(id, type, dependents), /Marco/);
      assert.equal(transactionsService.findById(id)?.type, 'INCOME');
    }
  });

  it('accetta di restare INCOME', () => {
    const id = transactionId('ENTRATA B');

    const updated = transactionsService.updateType(id, 'INCOME', dependents);

    assert.equal(updated.type, 'INCOME');
  });

  it('un movimento non collegato si riclassifica come prima', () => {
    const id = transactionId('ENTRATA LIBERA');

    assert.equal(transactionsService.updateType(id, 'OTHER', dependents).type, 'OTHER');
    assert.equal(transactionsService.updateType(id, 'INCOME', dependents).type, 'INCOME');
  });

  it('il movimento d\'origine di un prestito non è vincolato da questa regola', () => {
    const id = transactionId('ORIGINE GENERALE');

    assert.equal(transactionsService.updateType(id, 'EXPENSE', dependents).type, 'EXPENSE');
    transactionsService.updateType(id, 'LOAN', dependents);
  });

  it('tornato scollegato, il movimento si riclassifica di nuovo', () => {
    const repayment = loansService.getById(generale.id).repayments[0];
    assert.ok(repayment);
    loansService.removeRepayment(generale.id, repayment.id);

    const id = transactionId('ENTRATA B');
    assert.equal(transactionsService.updateType(id, 'OTHER', dependents).type, 'OTHER');
    transactionsService.updateType(id, 'INCOME', dependents);
  });
});

describe('D10: la restituzione non è anteriore al prestito', () => {
  const nuovoPrestito = (borrowerName: string): string =>
    loansService.create({
      transactionId: transactionId('ORIGINE DATE'),
      borrowerName,
      description: null,
      amount: 100,
      lentAt: '2040-03-10',
    }).id;

  it('in creazione rifiuta il giorno prima, accetta lo stesso giorno e il giorno dopo', () => {
    const id = nuovoPrestito('Elena');

    expectError(
      'VALIDATION',
      () => loansService.addRepayment(id, { amount: 10, repaymentDate: '2040-03-09' }),
      /anteriore/,
    );
    assert.equal(loansService.getById(id).repaymentCount, 0);

    loansService.addRepayment(id, { amount: 10, repaymentDate: '2040-03-10' });
    loansService.addRepayment(id, { amount: 10, repaymentDate: '2040-03-11' });
    assert.equal(loansService.getById(id).repaymentCount, 2);
  });

  it('in modifica della data rifiuta il giorno prima, accetta lo stesso giorno e il giorno dopo', () => {
    const id = nuovoPrestito('Franco');
    const detail = loansService.addRepayment(id, { amount: 10, repaymentDate: '2040-03-20' });
    const repaymentId = detail.repayments[0]?.id;
    assert.ok(repaymentId);

    expectError(
      'VALIDATION',
      () => loansService.updateRepayment(id, repaymentId, { repaymentDate: '2040-03-09' }),
      /anteriore/,
    );
    assert.equal(loansService.getById(id).repayments[0]?.repaymentDate, '2040-03-20');

    loansService.updateRepayment(id, repaymentId, { repaymentDate: '2040-03-10' });
    assert.equal(loansService.getById(id).repayments[0]?.repaymentDate, '2040-03-10');
    loansService.updateRepayment(id, repaymentId, { repaymentDate: '2040-03-11' });
    assert.equal(loansService.getById(id).repayments[0]?.repaymentDate, '2040-03-11');
  });

  it('la modifica di un altro campo non rifiuta una restituzione già valida', () => {
    const id = nuovoPrestito('Gina');
    const repaymentId = loansService.addRepayment(id, {
      amount: 10,
      repaymentDate: '2040-03-10',
    }).repayments[0]?.id;
    assert.ok(repaymentId);

    const detail = loansService.updateRepayment(id, repaymentId, { note: 'a mano' });

    assert.equal(detail.repayments[0]?.note, 'a mano');
  });

  it('la data del prestito non si sposta dopo la restituzione più vecchia', () => {
    const id = nuovoPrestito('Irene');
    loansService.addRepayment(id, { amount: 10, repaymentDate: '2040-03-15' });
    loansService.addRepayment(id, { amount: 10, repaymentDate: '2040-03-12' });

    expectError('VALIDATION', () => loansService.update(id, { lentAt: '2040-03-13' }), /anteriore/);
    assert.equal(loansService.getById(id).lentAt, '2040-03-10');

    assert.equal(loansService.update(id, { lentAt: '2040-03-12' }).lentAt, '2040-03-12');
  });

  it('un prestito senza restituzioni si sposta dove si vuole', () => {
    const id = nuovoPrestito('Luca');

    assert.equal(loansService.update(id, { lentAt: '2040-09-01' }).lentAt, '2040-09-01');
  });
});
