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
const { closeDatabase, runMigrations } = await import('../../db/client.js');
const { DomainError } = await import('../../shared/errors.js');
const { importService } = await import('../import/index.js');
const { toAmountCents, transactionsService } = await import('../transactions/index.js');
const { DEFAULT_LOAN_QUERY } = await import('./loan-query.js');
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
  ),
);

setType('V1 ACCREDITO CLASSIFICATO PRESTITO', 'LOAN');
setType('V1 USCITA PRESTITO', 'LOAN');
setType('V2 USCITA PER DUE PRESTITI', 'LOAN');

/**
 * L'invariante della capienza: per ogni movimento, la somma delle restituzioni
 * collegate non supera il suo importo. È una query sullo stato, non sul
 * risultato dell'ultima chiamata.
 */
function assertRepaymentsFitTransactions(): void {
  const repaid = new Map<string, number>();
  for (const loan of loansService.list(DEFAULT_LOAN_QUERY).items) {
    for (const repayment of loansService.getById(loan.id).repayments) {
      if (repayment.transaction !== null) {
        const id = repayment.transaction.id;
        repaid.set(id, (repaid.get(id) ?? 0) + toAmountCents(repayment.amount));
      }
    }
  }

  for (const [id, total] of repaid) {
    const transaction = transactionsService.listAll().find((t) => t.id === id);
    assert.ok(transaction, `transazione "${id}" non trovata`);
    assert.ok(
      total <= toAmountCents(transaction.amount),
      `restituzioni per ${String(total)} centesimi su un movimento da ${String(toAmountCents(transaction.amount))}`,
    );
  }
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
    expectError('VALIDATION', () => repayment(loanB, 1), /0,00 €/);
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
      /0,00 €/,
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
      /5,00 €/,
    );
    assert.equal(
      loansService.getById(loanA).repayments.find((r) => r.id === repaymentA)?.transaction?.id,
      credit(),
    );
    assertRepaymentsFitTransactions();
  });
});

describe('importo di un movimento collegato a una restituzione', () => {
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
      assertRepaymentsFitTransactions();
    }
  });
});
