import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-loans-cashflow-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { transactionsService } = await import('../transactions/index.js');
const { cashFlowService } = await import('../cash-flow/index.js');
const { summaryService } = await import('../summary/index.js');
const { loansService } = await import('./loans.service.js');

runMigrations();

after(() => {
  try {
    rmSync(databaseDir, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

const MONTH = '2034-06';

/**
 * Un mese con un solo prestito e due accrediti: il minimo per distinguere
 * «cosa è successo al conto» da «quanto devo ancora ricevere».
 */
const file = [
  'Data contabile,Tipologia,Descrizione,Importo',
  '10/06/2034,Bonifico,PRESTITO A MAMMA,-80.00',
  '20/06/2034,Accredito,RIMBORSO MAMMA UNO,20.00',
  '30/06/2034,Accredito,RIMBORSO MAMMA DUE,30.00',
].join('\r\n');

importService.importCsv(file);

function transactionId(description: string): string {
  const transaction = transactionsService.listAll().find((t) => t.description === description);
  assert.ok(transaction, `transazione "${description}" non trovata`);
  return transaction.id;
}

const originId = transactionId('PRESTITO A MAMMA');
transactionsService.updateType(originId, 'LOAN');

const cashFlow = () => cashFlowService.getCashFlow(MONTH);

/**
 * Lo stato del conto, ridotto a ciò che deve restare immutato quando si
 * registra una restituzione in contanti.
 */
const accountState = () => {
  const flow = cashFlow();

  return {
    netMovement: flow.netMovement,
    closingBalance: flow.closingBalance,
    income: flow.income,
    expenses: flow.expenses,
    netWorthChange: flow.netWorthChange,
    transactionCount: flow.transactionCount,
    byType: flow.byType,
  };
};

describe('il prestito muove la liquidità ma non è una spesa', () => {
  it('gli 80 € prestati escono dal conto', () => {
    const flow = cashFlow();

    assert.equal(flow.netMovement, -30, '-80 prestati, +20 e +30 rientrati');
    assert.equal(flow.closingBalance, -30);
    assert.equal(
      flow.byType.find((entry) => entry.type === 'LOAN')?.amount,
      -80,
      'il prestito compare nel cash flow con il proprio segno',
    );
  });

  it('ma non entrano fra le uscite né in una categoria', () => {
    const summary = summaryService.getMonthlySummary(MONTH);

    assert.equal(summary.expenses, 0, 'nessuna spesa reale nel mese');
    assert.equal(summary.income, 50, 'i due accrediti sono entrate normali');
    assert.deepEqual(summary.amountByCategory, []);
  });

  it('e non riducono il patrimonio: sono diventati un credito', () => {
    assert.equal(cashFlow().netWorthChange, 50, 'solo i 50 € di accredito');
  });
});

describe('lo scenario completo: prestare, ricevere indietro, chiudere', () => {
  it('il credito nasce pari all\'importo prestato', () => {
    const loan = loansService.create({
      transactionId: originId,
      borrowerName: 'Mamma',
      description: 'Acquisto fatto per lei',
      amount: 80,
      lentAt: '2034-06-10',
    });

    assert.equal(loan.remainingAmount, 80);
    assert.equal(loan.status, 'OPEN');
  });

  const loanId = () => {
    const loan = loansService.list({
      status: 'all',
      borrower: 'Mamma',
      search: null,
      sortBy: 'remainingAmount',
      sortDirection: 'desc',
    }).items[0];
    assert.ok(loan);
    return loan.id;
  };

  it('una restituzione in contanti riduce il credito e non tocca il conto', () => {
    const before = accountState();

    const after = loansService.addRepayment(loanId(), {
      amount: 30,
      repaymentDate: '2034-06-15',
      note: 'contanti',
    });

    assert.equal(after.remainingAmount, 50, '80 - 30');
    assert.equal(after.repayments[0]?.transaction, null, 'nessun movimento bancario è stato creato');

    assert.deepEqual(
      accountState(),
      before,
      'il cash flow bancario non cambia: nessun movimento è avvenuto sul conto',
    );
    assert.equal(
      transactionsService.listAll().length,
      3,
      'e non è comparsa nessuna transazione nuova',
    );
  });

  it('una restituzione bancaria da 20 € porta il credito a 30 €', () => {
    const after = loansService.addRepayment(loanId(), {
      amount: 20,
      repaymentDate: '2034-06-20',
      transactionId: transactionId('RIMBORSO MAMMA UNO'),
    });

    assert.equal(after.repaidAmount, 50, '30 in contanti + 20 con bonifico');
    assert.equal(after.remainingAmount, 30);
    assert.equal(after.status, 'OPEN');
  });

  it('i due concetti restano distinti e non si confondono', () => {
    const flow = cashFlow();
    const loan = loansService.getById(loanId());

    // Cash Flow = cosa è successo al conto.
    assert.equal(flow.netMovement, -30, '-80 + 20 + 30');
    assert.equal(flow.income, 50, 'i due accrediti sono contati normalmente');

    // Loan = quanto denaro devo ancora ricevere.
    assert.equal(loan.amount, 80, 'prestato');
    assert.equal(loan.repaidAmount, 50, 'restituito');
    assert.equal(loan.remainingAmount, 30, 'residuo');

    // Le due domande hanno risposte diverse, e la seconda non è ricavabile
    // dalla prima: il conto sa di aver visto uscire 80 €, non sa quanti ne
    // restano da ricevere.
    assert.equal(
      flow.byType.find((entry) => entry.type === 'LOAN')?.amount,
      -80,
      'per il conto il prestito vale gli 80 € usciti, oggi come allora',
    );
    assert.equal(loan.remainingAmount, 30, 'per il credito ne restano 30');
  });

  it('la transazione collegata resta una normale entrata', () => {
    const transaction = transactionsService.findById(transactionId('RIMBORSO MAMMA UNO'));

    assert.equal(transaction?.type, 'INCOME', 'il collegamento aggiunge semantica, non cambia il tipo');
    assert.equal(transaction?.amount, 20);
  });

  it('l\'ultima restituzione chiude il prestito', () => {
    const after = loansService.addRepayment(loanId(), {
      amount: 30,
      repaymentDate: '2034-06-30',
      transactionId: transactionId('RIMBORSO MAMMA DUE'),
    });

    assert.equal(after.repaidAmount, 80);
    assert.equal(after.remainingAmount, 0);
    assert.equal(after.status, 'SETTLED');
    assert.equal(after.repaymentCount, 3);
  });

  it('il denaro non viene contato due volte', () => {
    const flow = cashFlow();
    const totals = loansService.list({
      status: 'all',
      borrower: null,
      search: null,
      sortBy: 'remainingAmount',
      sortDirection: 'desc',
    }).totals;

    assert.equal(flow.netMovement, -30, 'il conto ha visto passare -80 +20 +30, una volta sola');
    assert.equal(flow.transactionCount, 3, 'tre movimenti, non sei');
    assert.equal(totals.remaining, 0, 'e non resta credito da ricevere');
  });
});

describe('idempotenza dell\'import', () => {
  it('reimportare lo stesso file non duplica nulla', () => {
    const fingerprintsBefore = transactionsService
      .listAll()
      .map((transaction) => transaction.fingerprint)
      .sort();
    const loansBefore = loansService.list({
      status: 'all',
      borrower: null,
      search: null,
      sortBy: 'remainingAmount',
      sortDirection: 'desc',
    });

    const result = importService.importCsv(file);

    assert.equal(result.imported, 0);
    assert.equal(result.duplicates, 3, 'le tre righe erano già in archivio');

    assert.deepEqual(
      transactionsService
        .listAll()
        .map((transaction) => transaction.fingerprint)
        .sort(),
      fingerprintsBefore,
      'il fingerprint delle transazioni resta invariato',
    );

    const loansAfter = loansService.list({
      status: 'all',
      borrower: null,
      search: null,
      sortBy: 'remainingAmount',
      sortDirection: 'desc',
    });

    assert.equal(loansAfter.items.length, loansBefore.items.length, 'nessun secondo prestito');
    assert.deepEqual(loansAfter.items, loansBefore.items, 'e nessuna restituzione in più');
  });

  it('l\'import non crea prestiti da sé', () => {
    // Un file con una sola riga, che diventerà un movimento di tipo prestito.
    importService.importCsv(
      [
        'Data contabile,Tipologia,Descrizione,Importo',
        '05/07/2034,Bonifico,ANTICIPO A UN COLLEGA,-40.00',
      ].join('\r\n'),
    );

    const nuova = transactionId('ANTICIPO A UN COLLEGA');
    transactionsService.updateType(nuova, 'LOAN');

    const loans = loansService.list({
      status: 'all',
      borrower: null,
      search: null,
      sortBy: 'remainingAmount',
      sortDirection: 'desc',
    });

    assert.ok(
      !loans.items.some((loan) => loan.transactionId === nuova),
      'una transazione LOAN non produce un prestito: chi ha ricevuto il denaro lo sa solo l\'utente',
    );
  });
});
