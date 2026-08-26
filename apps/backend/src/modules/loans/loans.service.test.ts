import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-loans-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { runMigrations } = await import('../../db/client.js');
const { DomainError } = await import('../../shared/errors.js');
const { importService } = await import('../import/index.js');
const { transactionsService } = await import('../transactions/index.js');
const { DEFAULT_LOAN_QUERY } = await import('./loan-query.js');
const { loansService } = await import('./loans.service.js');

runMigrations();

after(() => {
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

function setType(description: string, type: 'LOAN' | 'OTHER' | 'EXPENSE'): void {
  transactionsService.updateType(transactionId(description), type);
}

/**
 * Il codice di dominio dell'errore, che è ciò che diventa lo status HTTP:
 * VALIDATION → 400, NOT_FOUND → 404, CONFLICT → 409.
 */
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

const list = (query: Partial<typeof DEFAULT_LOAN_QUERY> = {}) =>
  loansService.list({ ...DEFAULT_LOAN_QUERY, ...query });

importService.importCsv(
  csv(
    '01/03/2033,Bonifico,L1 PRESTITO A MAMMA,-80.00',
    '02/03/2033,Bonifico,L1 ASSICURAZIONI DUE AUTO,-1920.00',
    '03/03/2033,Pagamento,L1 SPESA SUPERMERCATO,-45.00',
    '04/03/2033,Bonifico,L1 ANTICIPO PER UN AMICO,-200.00',
    '05/03/2033,Bonifico,L1 PRESTITO DA CANCELLARE,-10.00',
    '20/03/2033,Accredito,L1 RIMBORSO BONIFICO,25.00',
  ),
);

setType('L1 PRESTITO A MAMMA', 'LOAN');
setType('L1 ASSICURAZIONI DUE AUTO', 'LOAN');
setType('L1 ANTICIPO PER UN AMICO', 'LOAN');
setType('L1 PRESTITO DA CANCELLARE', 'LOAN');

describe('creazione di un prestito', () => {
  it('nasce da una transazione di tipo prestito e non ne modifica nulla', () => {
    const origin = transactionId('L1 PRESTITO A MAMMA');

    const loan = loansService.create({
      transactionId: origin,
      borrowerName: 'Mamma',
      description: 'Spesa fatta per lei',
      amount: 80,
      lentAt: '2033-03-01',
    });

    assert.equal(loan.borrowerName, 'Mamma');
    assert.equal(loan.amount, 80);
    assert.equal(loan.repaidAmount, 0);
    assert.equal(loan.remainingAmount, 80, 'appena creato, il credito è tutto da ricevere');
    assert.equal(loan.status, 'OPEN');
    assert.equal(loan.repaymentCount, 0);
    assert.equal(loan.transactionId, origin);

    const transaction = transactionsService.findById(origin);
    assert.equal(transaction?.amount, -80, 'la transazione resta negativa: è denaro uscito');
    assert.equal(transaction?.type, 'LOAN', 'e resta un prestito');
    assert.equal(
      transaction?.description,
      'L1 PRESTITO A MAMMA',
      'la descrizione della banca non viene toccata',
    );
  });

  it('rifiuta una transazione che non è un prestito', () => {
    expectError(
      'VALIDATION',
      () =>
        loansService.create({
          transactionId: transactionId('L1 SPESA SUPERMERCATO'),
          borrowerName: 'Mamma',
          amount: 45,
          lentAt: '2033-03-03',
        }),
      /solo da un movimento di tipo prestito/,
    );
  });

  it('rifiuta una transazione inesistente', () => {
    expectError(
      'NOT_FOUND',
      () =>
        loansService.create({
          transactionId: 'non-esiste',
          borrowerName: 'Mamma',
          amount: 10,
          lentAt: '2033-03-01',
        }),
      /non trovata/,
    );
  });

  it('rifiuta un importo nullo o negativo', () => {
    const origin = transactionId('L1 ANTICIPO PER UN AMICO');

    for (const amount of [0, -50]) {
      expectError(
        'VALIDATION',
        () =>
          loansService.create({
            transactionId: origin,
            borrowerName: 'Luca',
            amount,
            lentAt: '2033-03-04',
          }),
        /maggiore di zero/,
      );
    }
  });

  it('rifiuta un importo superiore a quello del movimento', () => {
    expectError(
      'VALIDATION',
      () =>
        loansService.create({
          transactionId: transactionId('L1 ANTICIPO PER UN AMICO'),
          borrowerName: 'Luca',
          amount: 250,
          lentAt: '2033-03-04',
        }),
      /supera quello del movimento/,
    );
  });

  it('rifiuta i dati malformati', () => {
    const origin = transactionId('L1 ANTICIPO PER UN AMICO');

    expectError('VALIDATION', () =>
      loansService.create({ transactionId: origin, borrowerName: '', amount: 10, lentAt: '2033-03-04' }),
    );
    expectError('VALIDATION', () =>
      loansService.create({
        transactionId: origin,
        borrowerName: 'Luca',
        amount: 10,
        lentAt: '04/03/2033',
      }),
    );
  });
});

describe('una transazione che finanzia più prestiti', () => {
  it('accetta più prestiti finché la somma sta nel movimento', () => {
    const origin = transactionId('L1 ASSICURAZIONI DUE AUTO');

    const anna = loansService.create({
      transactionId: origin,
      borrowerName: 'Anna',
      description: 'Assicurazione Kia Picanto',
      amount: 1100,
      lentAt: '2033-03-02',
    });
    const marco = loansService.create({
      transactionId: origin,
      borrowerName: 'Marco',
      description: 'Assicurazione 600',
      amount: 820,
      lentAt: '2033-03-02',
    });

    assert.equal(anna.remainingAmount, 1100);
    assert.equal(marco.remainingAmount, 820);
    assert.equal(anna.transactionId, marco.transactionId, 'lo stesso movimento d\'origine');
  });

  it('rifiuta il prestito che sfonda la capienza del movimento', () => {
    expectError(
      'VALIDATION',
      () =>
        loansService.create({
          transactionId: transactionId('L1 ASSICURAZIONI DUE AUTO'),
          borrowerName: 'Terzo',
          amount: 50,
          lentAt: '2033-03-02',
        }),
      /sono già attribuiti/,
    );
  });
});

describe('modifica di un prestito', () => {
  it('corregge persona, descrizione, importo e data', () => {
    const created = loansService.create({
      transactionId: transactionId('L1 ANTICIPO PER UN AMICO'),
      borrowerName: 'Sbagliato',
      amount: 100,
      lentAt: '2033-03-04',
    });

    const updated = loansService.update(created.id, {
      borrowerName: 'Luca',
      description: 'Anticipo biglietti',
      amount: 200,
      lentAt: '2033-03-05',
    });

    assert.equal(updated.borrowerName, 'Luca');
    assert.equal(updated.description, 'Anticipo biglietti');
    assert.equal(updated.amount, 200);
    assert.equal(updated.remainingAmount, 200, 'il residuo segue il nuovo importo');
    assert.equal(updated.lentAt, '2033-03-05');
    assert.equal(updated.transactionId, created.transactionId, 'il movimento d\'origine non cambia');

    loansService.remove(created.id);
  });

  it('rifiuta un prestito inesistente', () => {
    expectError('NOT_FOUND', () => loansService.update('non-esiste', { borrowerName: 'Tizio' }));
  });

  it('rifiuta un corpo vuoto', () => {
    const loan = list({ borrower: 'Mamma' }).items[0];
    assert.ok(loan);
    expectError('VALIDATION', () => loansService.update(loan.id, {}));
  });
});

describe('restituzioni', () => {
  /** Un prestito nuovo da 100 €, isolato dagli altri test. */
  function freshLoan(borrowerName: string, amount = 100) {
    return loansService.create({
      transactionId: transactionId('L1 ANTICIPO PER UN AMICO'),
      borrowerName,
      amount,
      lentAt: '2033-03-04',
    });
  }

  function cleanUp(loanId: string): void {
    for (const repayment of loansService.getById(loanId).repayments) {
      loansService.removeRepayment(loanId, repayment.id);
    }
    loansService.remove(loanId);
  }

  it('una restituzione parziale riduce il credito residuo', () => {
    const loan = freshLoan('Parziale');

    const after = loansService.addRepayment(loan.id, {
      amount: 30,
      repaymentDate: '2033-03-10',
    });

    assert.equal(after.repaidAmount, 30);
    assert.equal(after.remainingAmount, 70);
    assert.equal(after.status, 'OPEN');
    assert.equal(after.repaymentCount, 1);

    cleanUp(loan.id);
  });

  it('una restituzione senza transazione è una restituzione in contanti', () => {
    const loan = freshLoan('Contanti');

    const after = loansService.addRepayment(loan.id, {
      amount: 30,
      repaymentDate: '2033-03-10',
      note: 'in contanti',
    });

    const repayment = after.repayments[0];
    assert.equal(repayment?.transaction, null, 'nessun movimento bancario inventato');
    assert.equal(repayment?.note, 'in contanti');
    assert.equal(after.remainingAmount, 70);

    cleanUp(loan.id);
  });

  it('una restituzione può essere collegata ad un movimento in entrata', () => {
    const loan = freshLoan('Bonifico');
    const bankTransactionId = transactionId('L1 RIMBORSO BONIFICO');

    const after = loansService.addRepayment(loan.id, {
      amount: 25,
      repaymentDate: '2033-03-20',
      transactionId: bankTransactionId,
    });

    assert.equal(after.repayments[0]?.transaction?.id, bankTransactionId);
    assert.equal(after.remainingAmount, 75);

    const transaction = transactionsService.findById(bankTransactionId);
    assert.equal(transaction?.type, 'INCOME', 'la transazione resta una normale entrata');
    assert.equal(transaction?.amount, 25, 'e conserva il proprio importo');

    cleanUp(loan.id);
  });

  it('più restituzioni si sommano', () => {
    const loan = freshLoan('Rateale');

    loansService.addRepayment(loan.id, { amount: 20, repaymentDate: '2033-03-10' });
    loansService.addRepayment(loan.id, { amount: 15, repaymentDate: '2033-03-15' });
    const after = loansService.addRepayment(loan.id, { amount: 5, repaymentDate: '2033-03-20' });

    assert.equal(after.repaidAmount, 40);
    assert.equal(after.remainingAmount, 60);
    assert.equal(after.repaymentCount, 3);

    cleanUp(loan.id);
  });

  it('la restituzione esatta del residuo chiude il prestito', () => {
    const loan = freshLoan('Saldato');

    loansService.addRepayment(loan.id, { amount: 60, repaymentDate: '2033-03-10' });
    const after = loansService.addRepayment(loan.id, { amount: 40, repaymentDate: '2033-03-20' });

    assert.equal(after.remainingAmount, 0);
    assert.equal(after.status, 'SETTLED', 'lo stato è una lettura del residuo, non un campo');

    cleanUp(loan.id);
  });

  it('una restituzione superiore al residuo viene rifiutata', () => {
    const loan = freshLoan('Eccesso');
    loansService.addRepayment(loan.id, { amount: 70, repaymentDate: '2033-03-10' });

    expectError(
      'VALIDATION',
      () => loansService.addRepayment(loan.id, { amount: 40, repaymentDate: '2033-03-20' }),
      /supera il credito residuo \(30,00 €\)/,
    );

    assert.equal(loansService.getById(loan.id).remainingAmount, 30, 'il residuo non è stato toccato');

    cleanUp(loan.id);
  });

  it('su un prestito già chiuso nessuna restituzione è possibile', () => {
    const loan = freshLoan('Chiuso');
    loansService.addRepayment(loan.id, { amount: 100, repaymentDate: '2033-03-10' });

    expectError(
      'VALIDATION',
      () => loansService.addRepayment(loan.id, { amount: 1, repaymentDate: '2033-03-20' }),
      /già stato restituito per intero/,
    );

    cleanUp(loan.id);
  });

  it('rifiuta importo nullo o negativo', () => {
    const loan = freshLoan('Importi');

    for (const amount of [0, -10]) {
      expectError(
        'VALIDATION',
        () => loansService.addRepayment(loan.id, { amount, repaymentDate: '2033-03-10' }),
        /maggiore di zero/,
      );
    }

    cleanUp(loan.id);
  });

  it('rifiuta una transazione collegata inesistente', () => {
    const loan = freshLoan('Fantasma');

    expectError(
      'NOT_FOUND',
      () =>
        loansService.addRepayment(loan.id, {
          amount: 10,
          repaymentDate: '2033-03-10',
          transactionId: 'non-esiste',
        }),
      /non trovata/,
    );

    cleanUp(loan.id);
  });

  it('rifiuta il collegamento ad un movimento in uscita', () => {
    const loan = freshLoan('Verso sbagliato');

    expectError(
      'VALIDATION',
      () =>
        loansService.addRepayment(loan.id, {
          amount: 10,
          repaymentDate: '2033-03-10',
          transactionId: transactionId('L1 SPESA SUPERMERCATO'),
        }),
      /denaro rientrato/,
    );

    cleanUp(loan.id);
  });

  it('rifiuta una restituzione su un prestito inesistente', () => {
    expectError('NOT_FOUND', () =>
      loansService.addRepayment('non-esiste', { amount: 10, repaymentDate: '2033-03-10' }),
    );
  });
});

describe('modifica ed eliminazione di una restituzione', () => {
  function loanWithRepayments(borrowerName: string) {
    const loan = loansService.create({
      transactionId: transactionId('L1 ANTICIPO PER UN AMICO'),
      borrowerName,
      amount: 100,
      lentAt: '2033-03-04',
    });
    loansService.addRepayment(loan.id, { amount: 30, repaymentDate: '2033-03-10' });
    loansService.addRepayment(loan.id, { amount: 20, repaymentDate: '2033-03-15' });

    return loansService.getById(loan.id);
  }

  function cleanUp(loanId: string): void {
    for (const repayment of loansService.getById(loanId).repayments) {
      loansService.removeRepayment(loanId, repayment.id);
    }
    loansService.remove(loanId);
  }

  it('modificare l\'importo ricalcola il residuo', () => {
    const loan = loanWithRepayments('Modifica');
    assert.equal(loan.remainingAmount, 50);

    const target = loan.repayments.find((repayment) => repayment.amount === 30);
    assert.ok(target);

    const after = loansService.updateRepayment(loan.id, target.id, { amount: 10 });

    assert.equal(after.repaidAmount, 30, '10 + 20');
    assert.equal(after.remainingAmount, 70);

    cleanUp(loan.id);
  });

  it('modificare data, nota e collegamento non tocca gli importi', () => {
    const loan = loanWithRepayments('Dettagli');
    const target = loan.repayments[0];
    assert.ok(target);

    const after = loansService.updateRepayment(loan.id, target.id, {
      repaymentDate: '2033-03-18',
      note: 'bonifico ricevuto',
      transactionId: transactionId('L1 RIMBORSO BONIFICO'),
    });

    const updated = after.repayments.find((repayment) => repayment.id === target.id);
    assert.equal(updated?.repaymentDate, '2033-03-18');
    assert.equal(updated?.note, 'bonifico ricevuto');
    assert.equal(updated?.transaction?.description, 'L1 RIMBORSO BONIFICO');
    assert.equal(after.remainingAmount, 50, 'il residuo non cambia');

    cleanUp(loan.id);
  });

  it('scollega una restituzione riportandola a contanti', () => {
    const loan = loanWithRepayments('Scollega');
    const target = loan.repayments[0];
    assert.ok(target);

    loansService.updateRepayment(loan.id, target.id, {
      transactionId: transactionId('L1 RIMBORSO BONIFICO'),
    });
    const after = loansService.updateRepayment(loan.id, target.id, { transactionId: null });

    assert.equal(
      after.repayments.find((repayment) => repayment.id === target.id)?.transaction,
      null,
    );

    cleanUp(loan.id);
  });

  it('rifiuta una modifica che porterebbe il totale oltre il prestato', () => {
    const loan = loanWithRepayments('Sfondamento');
    const target = loan.repayments.find((repayment) => repayment.amount === 30);
    assert.ok(target);

    expectError(
      'VALIDATION',
      () => loansService.updateRepayment(loan.id, target.id, { amount: 90 }),
      /supererebbe il prestato/,
    );

    assert.equal(loansService.getById(loan.id).remainingAmount, 50, 'nulla è cambiato');

    cleanUp(loan.id);
  });

  it('eliminare una restituzione riporta il credito a comprenderla', () => {
    const loan = loanWithRepayments('Eliminazione');
    const target = loan.repayments.find((repayment) => repayment.amount === 20);
    assert.ok(target);

    const after = loansService.removeRepayment(loan.id, target.id);

    assert.equal(after.repaidAmount, 30);
    assert.equal(after.remainingAmount, 70);
    assert.equal(after.repaymentCount, 1);

    cleanUp(loan.id);
  });

  it('una restituzione di un altro prestito non è raggiungibile', () => {
    const first = loanWithRepayments('Primo');
    const second = loansService.create({
      transactionId: transactionId('L1 ANTICIPO PER UN AMICO'),
      borrowerName: 'Secondo',
      amount: 10,
      lentAt: '2033-03-04',
    });
    const target = first.repayments[0];
    assert.ok(target);

    expectError('NOT_FOUND', () => loansService.updateRepayment(second.id, target.id, { amount: 5 }));
    expectError('NOT_FOUND', () => loansService.removeRepayment(second.id, target.id));

    loansService.remove(second.id);
    cleanUp(first.id);
  });
});

describe('eliminazione di un prestito', () => {
  it('un prestito senza restituzioni si elimina', () => {
    const loan = loansService.create({
      transactionId: transactionId('L1 PRESTITO DA CANCELLARE'),
      borrowerName: 'Errore',
      amount: 10,
      lentAt: '2033-03-05',
    });

    loansService.remove(loan.id);

    expectError('NOT_FOUND', () => loansService.getById(loan.id));
  });

  it('un prestito con restituzioni non si elimina', () => {
    const loan = loansService.create({
      transactionId: transactionId('L1 PRESTITO DA CANCELLARE'),
      borrowerName: 'Con storico',
      amount: 10,
      lentAt: '2033-03-05',
    });
    loansService.addRepayment(loan.id, { amount: 4, repaymentDate: '2033-03-10' });

    expectError('CONFLICT', () => loansService.remove(loan.id), /eliminale prima/);

    // Eliminata la restituzione, il prestito torna eliminabile.
    const repayment = loansService.getById(loan.id).repayments[0];
    assert.ok(repayment);
    loansService.removeRepayment(loan.id, repayment.id);
    loansService.remove(loan.id);
  });

  it('rifiuta un prestito inesistente', () => {
    expectError('NOT_FOUND', () => loansService.remove('non-esiste'));
  });
});

describe('elenco, filtri e totali', () => {
  it('i totali sono la somma delle righe mostrate', () => {
    const { items, totals } = list();

    assert.equal(
      totals.lent,
      items.reduce((sum, item) => sum + item.amount, 0),
    );
    assert.equal(
      totals.remaining,
      items.reduce((sum, item) => sum + item.remainingAmount, 0),
    );
    assert.equal(totals.loanCount, items.length);
    assert.equal(totals.openCount, items.filter((item) => item.status === 'OPEN').length);
  });

  it('l\'ordinamento predefinito mette davanti il credito più grande', () => {
    const items = list().items;
    const remaining = items.map((item) => item.remainingAmount);

    assert.deepEqual(remaining, [...remaining].sort((a, b) => b - a));
  });

  it('filtra per stato', () => {
    const mamma = list({ borrower: 'Mamma' }).items[0];
    assert.ok(mamma);
    loansService.addRepayment(mamma.id, { amount: 80, repaymentDate: '2033-04-01' });

    const open = list({ status: 'open' }).items;
    const settled = list({ status: 'settled' }).items;

    assert.ok(
      open.every((item) => item.remainingAmount > 0),
      'fra gli aperti nessuno è a zero',
    );
    assert.ok(
      settled.every((item) => item.remainingAmount === 0),
      'fra i chiusi nessuno ha residuo',
    );
    assert.ok(settled.some((item) => item.id === mamma.id));
    assert.equal(open.length + settled.length, list().items.length);

    const repayment = loansService.getById(mamma.id).repayments[0];
    assert.ok(repayment);
    loansService.removeRepayment(mamma.id, repayment.id);
  });

  it('filtra per persona e cerca nel testo', () => {
    assert.deepEqual(
      list({ borrower: 'Anna' }).items.map((item) => item.borrowerName),
      ['Anna'],
    );
    assert.deepEqual(
      list({ borrower: 'anna' }).items.map((item) => item.borrowerName),
      ['Anna'],
      'il nome non distingue maiuscole e minuscole',
    );

    assert.deepEqual(
      list({ search: 'picanto' }).items.map((item) => item.borrowerName),
      ['Anna'],
      'cerca nella descrizione del prestito',
    );
    assert.equal(
      list({ search: 'assicurazioni' }).items.length,
      2,
      'e nella descrizione del movimento d\'origine',
    );
    assert.equal(list({ search: '%' }).items.length, 0, 'i jolly sono cercati alla lettera');
  });

  it('espone le persone come vocabolario del filtro', () => {
    const { borrowers } = list({ borrower: 'Anna' });

    assert.ok(borrowers.includes('Mamma'), 'l\'elenco non dipende dai filtri attivi');
    assert.ok(borrowers.includes('Anna'));
    assert.deepEqual(borrowers, [...borrowers].sort((a, b) => a.localeCompare(b)));
  });

  it('ordina anche per data, importo e persona', () => {
    const byAmount = list({ sortBy: 'amount', sortDirection: 'desc' }).items.map(
      (item) => item.amount,
    );
    assert.deepEqual(byAmount, [...byAmount].sort((a, b) => b - a));

    const byBorrower = list({ sortBy: 'borrower', sortDirection: 'asc' }).items.map(
      (item) => item.borrowerName,
    );
    assert.deepEqual(byBorrower, [...byBorrower].sort((a, b) => a.localeCompare(b)));

    const byDate = list({ sortBy: 'lentAt', sortDirection: 'asc' }).items.map((item) => item.lentAt);
    assert.deepEqual(byDate, [...byDate].sort());
  });
});

describe('legami con i movimenti', () => {
  it('indicizza origini e restituzioni, con navigazione in entrambi i versi', () => {
    const mamma = list({ borrower: 'Mamma' }).items[0];
    assert.ok(mamma);
    const bankTransactionId = transactionId('L1 RIMBORSO BONIFICO');
    loansService.addRepayment(mamma.id, {
      amount: 25,
      repaymentDate: '2033-03-20',
      transactionId: bankTransactionId,
    });

    const { links } = loansService.links();

    const origin = links.find(
      (link) => link.transactionId === mamma.transactionId && link.role === 'ORIGIN',
    );
    assert.equal(origin?.loanId, mamma.id);
    assert.equal(origin?.borrowerName, 'Mamma');

    const repaymentLink = links.find(
      (link) => link.transactionId === bankTransactionId && link.role === 'REPAYMENT',
    );
    assert.equal(repaymentLink?.loanId, mamma.id);
    assert.equal(repaymentLink?.remainingAmount, 55, 'il legame porta con sé il residuo aggiornato');

    const shared = links.filter(
      (link) => link.transactionId === transactionId('L1 ASSICURAZIONI DUE AUTO'),
    );
    assert.equal(shared.length, 2, 'un movimento che finanzia due prestiti compare due volte');

    const repayment = loansService.getById(mamma.id).repayments[0];
    assert.ok(repayment);
    loansService.removeRepayment(mamma.id, repayment.id);
  });

  it('segnala il movimento d\'origine che non è più un prestito', () => {
    const loan = loansService.create({
      transactionId: transactionId('L1 PRESTITO DA CANCELLARE'),
      borrowerName: 'Tipo cambiato',
      amount: 10,
      lentAt: '2033-03-05',
    });

    assert.equal(loansService.getById(loan.id).transactionTypeMismatch, false);

    setType('L1 PRESTITO DA CANCELLARE', 'EXPENSE');
    const after = loansService.getById(loan.id);

    assert.equal(after.transactionTypeMismatch, true);
    assert.equal(after.amount, 10, 'il prestito resta valido: importo e data sono suoi');
    assert.equal(after.remainingAmount, 10);

    setType('L1 PRESTITO DA CANCELLARE', 'LOAN');
    loansService.remove(loan.id);
  });
});
