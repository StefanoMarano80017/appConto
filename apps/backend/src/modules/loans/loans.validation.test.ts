import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
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

const { createApp } = await import('../../app.js');
const { config } = await import('../../config.js');
const { closeDatabase, db, runMigrations } = await import('../../db/client.js');
const { sql } = await import('drizzle-orm');
const { DomainError } = await import('../../shared/errors.js');
const { importService } = await import('../import/index.js');
const { toAmountCents, transactionsService } = await import('../transactions/index.js');
const { DEFAULT_LOAN_QUERY, parseLoanQuery } = await import('./loan-query.js');
const { loansService } = await import('./loans.service.js');

runMigrations();

const frontendDir = mkdtempSync(path.join(tmpdir(), 'appconto-loans-validation-fe-'));
const server = createApp(frontendDir).listen(0, config.host);
await new Promise<void>((resolve) => {
  server.once('listening', resolve);
});
const { port } = server.address() as AddressInfo;
const base = `http://${config.host}:${String(port)}`;

after(() => {
  server.close();
  closeDatabase();
  for (const cartella of [databaseDir, frontendDir]) {
    try {
      rmSync(cartella, { recursive: true, force: true });
    } catch {
      // su Windows il file può restare bloccato: sono cartelle temporanee
    }
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
    '01/05/2034,Bonifico,V2 USCITA PER DUE PRESTITI,-180.00',
    '10/05/2034,Accredito,V2 BONIFICO RESTITUZIONI,100.00',
    '01/06/2034,Bonifico,V3 USCITA PER PIU PRESTITI,-300.00',
    '02/06/2034,Bonifico,V3 USCITA PER IMPORTI AL CENTESIMO,-10.00',
  ),
);

setType('V1 ACCREDITO CLASSIFICATO PRESTITO', 'LOAN');
setType('V1 USCITA PRESTITO', 'LOAN');
setType('V2 USCITA PER DUE PRESTITI', 'LOAN');
setType('V3 USCITA PER PIU PRESTITI', 'LOAN');
setType('V3 USCITA PER IMPORTI AL CENTESIMO', 'LOAN');

/**
 * L'invariante della capienza: per ogni movimento, la somma delle restituzioni
 * collegate non supera il suo importo. È una query sullo stato, non sul
 * risultato dell'ultima chiamata.
 */
function assertRepaymentsFitTransactions(): void {
  const violations = db.all<{ transaction_id: string; repaid: number; capacity: number }>(sql`
    select r.transaction_id as transaction_id,
           sum(r.amount_cents) as repaid,
           t.amount_cents as capacity
    from loan_repayments r
    join transactions t on t.id = r.transaction_id
    where r.transaction_id is not null
    group by r.transaction_id
    having sum(r.amount_cents) > t.amount_cents
  `);

  assert.deepEqual(violations, [], 'restituzioni collegate oltre l\'importo del movimento');
}

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

describe('capienza del movimento di restituzione', () => {
  after(assertRepaymentsFitTransactions);
  const origin = () => transactionId('V2 USCITA PER DUE PRESTITI');
  const credit = () => transactionId('V2 BONIFICO RESTITUZIONI');
  const repayment = (loanId: string, amount: number, linked = true) =>
    loansService.addRepayment(loanId, {
      amount,
      repaymentDate: '2034-05-10',
      transactionId: linked ? credit() : null,
    });

  let loanA = '';
  let loanB = '';
  let repaymentA = '';
  let repaymentB = '';

  it('un solo accredito può ripagare due prestiti, finché basta a coprirli', () => {
    loanA = loansService.create({
      transactionId: origin(),
      borrowerName: 'Anna',
      amount: 90,
      lentAt: '2034-05-01',
    }).id;
    loanB = loansService.create({
      transactionId: origin(),
      borrowerName: 'Bruno',
      amount: 90,
      lentAt: '2034-05-01',
    }).id;

    repaymentA = repayment(loanA, 60).repayments[0]?.id ?? '';
    repaymentB = repayment(loanB, 40).repayments[0]?.id ?? '';

    assert.ok(repaymentA !== '' && repaymentB !== '');
    assertRepaymentsFitTransactions();
  });

  it('rifiuta una restituzione che supera il residuo del movimento e dice quanto resta', () => {
    expectError('VALIDATION', () => repayment(loanB, 1), /restano 0,00 €/);
    assert.equal(loansService.getById(loanB).repaidAmount, 40);
    assertRepaymentsFitTransactions();
  });

  it('la capienza non riguarda le restituzioni in contanti', () => {
    const detail = repayment(loanB, 1, false);

    assert.equal(detail.repaidAmount, 41);
    const cash = detail.repayments.find((r) => r.transaction === null);
    assert.ok(cash);
    loansService.removeRepayment(loanB, cash.id);
    assert.equal(loansService.getById(loanB).repaidAmount, 40);
  });

  it('rifiuta una modifica che porta il movimento oltre la capienza', () => {
    expectError(
      'VALIDATION',
      () => loansService.updateRepayment(loanA, repaymentA, { amount: 61 }),
      /già 40,00 € collegati.*restano 60,00 €/,
    );
    assert.equal(loansService.getById(loanA).repaidAmount, 60);
    assertRepaymentsFitTransactions();
  });

  it("accetta una modifica che non cambia l'importo: la restituzione stessa va esclusa dalla somma", () => {
    const detail = loansService.updateRepayment(loanA, repaymentA, { note: 'Saldo parziale' });

    assert.equal(detail.repaidAmount, 60);
    assertRepaymentsFitTransactions();
  });

  it("accetta una modifica che riduce l'importo e libera capienza per le altre", () => {
    loansService.updateRepayment(loanA, repaymentA, { amount: 50 });
    loansService.updateRepayment(loanB, repaymentB, { amount: 50 });

    assert.equal(loansService.getById(loanA).repaidAmount, 50);
    assert.equal(loansService.getById(loanB).repaidAmount, 50);
    assertRepaymentsFitTransactions();
    expectError('VALIDATION', () => repayment(loanA, 1));
  });

  it('rifiuta di spostare una restituzione su un accredito che non la contiene', () => {
    importService.importCsv(csv('11/05/2034,Accredito,V2 ACCREDITO PICCOLO,5.00'));
    const piccolo = transactionId('V2 ACCREDITO PICCOLO');

    expectError(
      'VALIDATION',
      () => loansService.updateRepayment(loanA, repaymentA, { transactionId: piccolo }),
      /restano 5,00 €/,
    );
    assert.equal(
      loansService.getById(loanA).repayments.find((r) => r.id === repaymentA)?.transaction?.id,
      credit(),
    );
    assertRepaymentsFitTransactions();
  });
});

describe('importo di un movimento collegato a una restituzione', () => {
  after(assertRepaymentsFitTransactions);
  const credit = () => transactionId('V2 BONIFICO RESTITUZIONI');

  it('PATCH /api/transactions/:id con un importo non esiste: 404 e importo invariato', async () => {
    const risposta = await fetch(`${base}/api/transactions/${credit()}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 500 }),
    });

    assert.equal(risposta.status, 404);
    assert.equal(transactionsService.findById(credit())?.amount, 100);
  });

  it("cambiare il tipo di un accredito collegato non ne tocca l'importo né l'invariante", () => {
    for (const type of ['OTHER', 'EXPENSE', 'INCOME'] as const) {
      const updated = transactionsService.updateType(credit(), type);

      assert.equal(updated.amount, 100);
      assert.equal(transactionsService.findById(credit())?.amount, 100);
      const links = loansService.links().links.filter((l) => l.transactionId === credit());
      assert.equal(links.filter((l) => l.role === 'REPAYMENT').length, 2);
      assertRepaymentsFitTransactions();
    }
  });
});

describe('modifica di un prestito con restituzioni e prestiti fratelli', () => {
  after(assertRepaymentsFitTransactions);
  const origin = () => transactionId('V3 USCITA PER PIU PRESTITI');
  let loan = '';
  let sibling = '';

  it('prepara un prestito da 100 con 40 già restituiti e un fratello da 150', () => {
    loan = loansService.create({
      transactionId: origin(),
      borrowerName: 'Carla',
      amount: 100,
      lentAt: '2034-06-10',
    }).id;
    sibling = loansService.create({
      transactionId: origin(),
      borrowerName: 'Dario',
      amount: 150,
      lentAt: '2034-06-10',
    }).id;
    loansService.addRepayment(loan, { amount: 40, repaymentDate: '2034-06-20' });

    assert.equal(loansService.getById(loan).remainingAmount, 60);
    assert.ok(sibling);
  });

  it('rifiuta un importo sotto il già restituito', () => {
    expectError('VALIDATION', () => loansService.update(loan, { amount: 39.99 }), /non può valere meno/);
    assert.equal(loansService.getById(loan).amount, 100);
  });

  it('rifiuta un importo oltre la capienza del movimento, contando i prestiti fratelli', () => {
    // 300 di movimento, 150 già attribuiti al fratello: restano 150.
    expectError('VALIDATION', () => loansService.update(loan, { amount: 150.01 }), /restano 150,00 €/);
    assert.equal(loansService.getById(loan).amount, 100);
  });

  it('accetta un importo che riempie esattamente la capienza residua', () => {
    assert.equal(loansService.update(loan, { amount: 150 }).amount, 150);
    loansService.update(loan, { amount: 100 });
  });

  it('accetta un importo pari al già restituito: residuo zero e prestito chiuso', () => {
    const detail = loansService.update(loan, { amount: 40 });

    assert.equal(detail.amount, 40);
    assert.equal(detail.remainingAmount, 0);
    assert.equal(detail.status, 'SETTLED');
  });
});

describe('restituzione anteriore alla data del prestito', () => {
  // Comportamento attuale, fissato così com'è: nessun controllo sulle date.
  // Se un giorno diventasse una regola di dominio, questo test va riscritto.
  it('viene accettata: oggi nessuna regola confronta le due date', () => {
    const loan = loansService.create({
      transactionId: transactionId('V3 USCITA PER IMPORTI AL CENTESIMO'),
      borrowerName: 'Elena',
      amount: 5,
      lentAt: '2034-06-10',
    });

    const detail = loansService.addRepayment(loan.id, {
      amount: 2,
      repaymentDate: '2034-06-01',
    });

    assert.equal(detail.repaidAmount, 2);
    assert.equal(detail.repayments[0]?.repaymentDate, '2034-06-01');
  });
});

describe('arrotondamento al centesimo', () => {
  after(assertRepaymentsFitTransactions);
  const origin = () => transactionId('V3 USCITA PER IMPORTI AL CENTESIMO');

  it('rifiuta 0,004 €: arrotondato vale zero centesimi', () => {
    expectError(
      'VALIDATION',
      () =>
        loansService.create({
          transactionId: origin(),
          borrowerName: 'Franco',
          amount: 0.004,
          lentAt: '2034-06-10',
        }),
      /maggiore di zero/,
    );
  });

  it('accetta 0,005 €: a metà si arrotonda lontano da zero, quindi 1 centesimo', () => {
    const detail = loansService.create({
      transactionId: origin(),
      borrowerName: 'Franco',
      amount: 0.005,
      lentAt: '2034-06-10',
    });

    assert.equal(detail.amount, 0.01);
    assert.equal(toAmountCents(0.005), 1);
  });

  it('vale anche per le restituzioni', () => {
    const loanId = loansService.list({ ...DEFAULT_LOAN_QUERY, borrower: 'Franco' }).items[0]?.id;
    assert.ok(loanId);

    expectError(
      'VALIDATION',
      () => loansService.addRepayment(loanId, { amount: 0.004, repaymentDate: '2034-06-11' }),
      /maggiore di zero/,
    );
    assert.equal(
      loansService.addRepayment(loanId, { amount: 0.005, repaymentDate: '2034-06-11' }).repaidAmount,
      0.01,
    );
  });
});

describe('parseLoanQuery', () => {
  it('senza parametri restituisce i valori predefiniti', () => {
    assert.deepEqual(parseLoanQuery({}), DEFAULT_LOAN_QUERY);
  });

  it('riconosce i valori validi e ignora gli spazi', () => {
    assert.deepEqual(
      parseLoanQuery({
        status: 'open',
        borrower: ' Mamma ',
        search: 'assicurazione',
        sortBy: 'lentAt',
        sortDirection: 'asc',
      }),
      {
        status: 'open',
        borrower: 'Mamma',
        search: 'assicurazione',
        sortBy: 'lentAt',
        sortDirection: 'asc',
      },
    );
  });

  it('tratta come assenti i parametri vuoti e usa il primo di un elenco', () => {
    assert.deepEqual(parseLoanQuery({ status: ['settled', 'open'], borrower: '  ', search: '' }), {
      ...DEFAULT_LOAN_QUERY,
      status: 'settled',
    });
  });

  it('rifiuta uno stato, un ordinamento o una direzione non riconosciuti', () => {
    expectError('VALIDATION', () => parseLoanQuery({ status: 'chiusi' }), /Stato "chiusi"/);
    expectError('VALIDATION', () => parseLoanQuery({ sortBy: 'createdAt' }), /Ordinamento "createdAt"/);
    expectError('VALIDATION', () => parseLoanQuery({ sortDirection: 'ASC' }), /asc/);
  });
});
