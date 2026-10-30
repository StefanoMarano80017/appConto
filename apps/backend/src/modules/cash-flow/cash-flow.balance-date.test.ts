import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { TransactionType } from '../transactions/index.js';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-cashflow-balance-date-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { closeDatabase, runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { transactionsService, toAmountCents } = await import('../transactions/index.js');
const { settingsService } = await import('../settings/index.js');
const { loansService } = await import('../loans/index.js');
const { cashFlowService } = await import('./cash-flow.service.js');

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
 * La data del saldo noto (D7).
 *
 * Il saldo indicato nelle impostazioni vale a fine giornata di `balanceDate`:
 * i movimenti di quel giorno sono già compresi. Il saldo iniziale di un mese
 * va quindi ricostruito in avanti se il mese segue la data del saldo, e
 * all'indietro se la contiene o la precede.
 *
 * Ogni gruppo di test usa anni diversi, così i movimenti dell'uno non cadono
 * mai negli intervalli osservati dall'altro.
 */

const csv = (...rows: string[]): string =>
  ['Data contabile,Tipologia,Descrizione,Importo', ...rows].join('\r\n');

/** Un importo in euro, confrontato al centesimo. */
const cents = (value: number): number => Math.round(value * 100);

const flow = (month: string) => cashFlowService.getCashFlow(month);

describe('saldo di un mese rispetto alla data del saldo', () => {
  importService.importCsv(
    csv(
      '15/04/2040,Pagamento,SPESA APRILE 2040,-5.00',
      '02/05/2040,Pagamento,SPESA INIZIO MAGGIO 2040,-40.00',
      '20/05/2040,Pagamento,SPESA FINE MAGGIO 2040,-60.00',
      '03/06/2040,Pagamento,SPESA GIUGNO 2040,-10.00',
    ),
  );

  it('ricostruisce all\'indietro i mesi che contengono o precedono la data del saldo', () => {
    settingsService.update({ initialBalance: 1000, balanceDate: '2040-05-10' });

    const aprile = flow('2040-04');
    const maggio = flow('2040-05');
    const giugno = flow('2040-06');

    assert.deepEqual(
      [aprile.openingBalance, aprile.closingBalance],
      [1045, 1040],
      'aprile',
    );
    assert.deepEqual(
      [maggio.openingBalance, maggio.closingBalance],
      [1040, 940],
      'maggio',
    );
    assert.deepEqual(
      [giugno.openingBalance, giugno.closingBalance],
      [940, 930],
      'giugno',
    );
  });
});

describe('confine della data del saldo', () => {
  importService.importCsv(
    csv(
      '10/03/2038,Pagamento,SPESA NEL GIORNO DEL SALDO,-20.00',
      '11/09/2038,Pagamento,SPESA IL GIORNO DOPO IL SALDO,-7.00',
    ),
  );

  it('un movimento nel giorno stesso della data del saldo è già compreso nel saldo', () => {
    settingsService.update({ initialBalance: 500, balanceDate: '2038-03-10' });

    const marzo = flow('2038-03');

    assert.equal(marzo.openingBalance, 520, 'a inizio mese i 20 € non erano ancora usciti');
    assert.equal(marzo.closingBalance, 500, 'dopo il movimento si torna al saldo inserito');
  });

  it('un movimento del giorno dopo la data del saldo non è compreso nel saldo', () => {
    settingsService.update({ initialBalance: 500, balanceDate: '2038-09-10' });

    const settembre = flow('2038-09');

    assert.equal(settembre.openingBalance, 500, 'nulla è accaduto fra inizio mese e il saldo');
    assert.equal(settembre.closingBalance, 493, 'i 7 € escono dopo il saldo inserito');
  });
});

/*
 * Un anno intero di movimenti deterministici di tutti i tipi, compreso un
 * prestito parziale, su cui far variare la data del saldo.
 */

const YEAR = 2045;
const INITIAL_BALANCE = 1234.56;

const pad = (value: number): string => String(value).padStart(2, '0');
const euros = (amountCents: number): string => (amountCents / 100).toFixed(2);

type Row = { day: number; month: number; description: string; amountCents: number; type: TransactionType };

const yearRows: Row[] = [];
for (let month = 1; month <= 12; month += 1) {
  const lastDay = new Date(Date.UTC(YEAR, month, 0)).getUTCDate();
  const tag = `${YEAR}-${pad(month)}`;

  yearRows.push(
    { day: 1, month, description: `STIPENDIO ${tag}`, amountCents: 150_000 + month * 100, type: 'INCOME' },
    { day: 1, month, description: `SUPERMERCATO ${tag}`, amountCents: -1234 * month, type: 'EXPENSE' },
    { day: 15, month, description: `PRELIEVO ${tag}`, amountCents: -5_000, type: 'WITHDRAWAL' },
    { day: 15, month, description: `GIROCONTO ${tag}`, amountCents: -(10_000 + month * 7), type: 'TRANSFER' },
    { day: lastDay, month, description: `RETTIFICA ${tag}`, amountCents: 321 * month, type: 'OTHER' },
    { day: lastDay, month, description: `BOLLETTA ${tag}`, amountCents: -4_567, type: 'EXPENSE' },
  );

  if (month % 3 === 0) {
    yearRows.push({
      day: 10,
      month,
      description: `PRESTITO ${tag}`,
      amountCents: -(20_000 + month * 100),
      type: 'LOAN',
    });
  }
}

importService.importCsv(
  csv(
    ...yearRows.map(
      (row) =>
        `${pad(row.day)}/${pad(row.month)}/${YEAR},Bonifico,${row.description},${euros(row.amountCents)}`,
    ),
  ),
);

const byDescription = new Map(transactionsService.listAll().map((t) => [t.description, t]));
for (const row of yearRows) {
  const transaction = byDescription.get(row.description);
  assert.ok(transaction, `movimento "${row.description}" non trovato`);
  transactionsService.updateType(transaction.id, row.type);
}

// Il prestito di marzo è parziale: solo 120 € dei 203 sono stati prestati.
const partialLoan = byDescription.get(`PRESTITO ${YEAR}-03`);
assert.ok(partialLoan);
loansService.create({
  transactionId: partialLoan.id,
  borrowerName: 'Mamma',
  amount: 120,
  lentAt: `${YEAR}-03-10`,
});

/** Dal mese prima del primo movimento al mese dopo l'ultimo. */
const OBSERVED_MONTHS = [
  `${YEAR - 1}-12`,
  ...Array.from({ length: 12 }, (_, index) => `${YEAR}-${pad(index + 1)}`),
  `${YEAR + 1}-01`,
];

const BALANCE_DATES = [
  `${YEAR - 1}-12-31`, // il giorno prima del primo mese
  `${YEAR}-02-01`,
  `${YEAR}-02-15`,
  `${YEAR}-02-28`,
  `${YEAR}-06-01`,
  `${YEAR}-06-15`,
  `${YEAR}-06-30`,
  `${YEAR + 1}-01-01`, // un giorno dopo l'ultimo movimento
];

describe('invariante di continuità', () => {
  for (const balanceDate of BALANCE_DATES) {
    it(`con il saldo al ${balanceDate} ogni mese parte da dove si è chiuso il precedente`, () => {
      settingsService.update({ initialBalance: INITIAL_BALANCE, balanceDate });

      const flows = OBSERVED_MONTHS.map(flow);

      flows.forEach((current, index) => {
        assert.equal(
          cents(current.closingBalance),
          cents(current.openingBalance) + cents(current.netMovement),
          `${current.month}: saldo finale = saldo iniziale + movimento netto`,
        );

        const next = flows[index + 1];
        if (next !== undefined) {
          assert.equal(
            cents(next.openingBalance),
            cents(current.closingBalance),
            `${next.month} parte dal saldo finale di ${current.month}`,
          );
        }
      });
    });
  }
});

describe('invariante di ancoraggio', () => {
  for (const balanceDate of BALANCE_DATES) {
    it(`a fine giornata del ${balanceDate} il saldo vale esattamente quello inserito`, () => {
      settingsService.update({ initialBalance: INITIAL_BALANCE, balanceDate });

      const month = balanceDate.slice(0, 7);
      const monthStart = `${month}-01`;

      // I movimenti fra inizio mese e fine giornata del saldo, letti
      // direttamente dall'archivio e non dal cash flow.
      const sinceMonthStartCents = transactionsService
        .listAll()
        .filter((t) => t.bookingDate >= monthStart && t.bookingDate <= balanceDate)
        .reduce((sum, t) => sum + toAmountCents(t.amount), 0);

      assert.equal(
        cents(flow(month).openingBalance) + sinceMonthStartCents,
        cents(INITIAL_BALANCE),
      );
    });
  }
});
