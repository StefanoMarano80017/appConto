import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-cashflow-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { transactionsService } = await import('../transactions/index.js');
const { summaryService } = await import('../summary/index.js');
const { settingsService } = await import('../settings/index.js');
const { cashFlowService } = await import('./cash-flow.service.js');

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

const round = (value: number): number => Math.round(value * 100) / 100;

function setType(description: string, type: 'LOAN' | 'TRANSFER' | 'OTHER'): void {
  const transaction = transactionsService.listAll().find((t) => t.description === description);
  assert.ok(transaction, `transazione "${description}" non trovata`);
  transactionsService.updateType(transaction.id, type);
}

// Un mese con un movimento per ogni natura possibile.
importService.importCsv(
  csv(
    '02/05/2032,Pagamento,ACQUISTO SUPERMERCATO,-100.00',
    '03/05/2032,Prelievo,PRELIEVO ATM VIA ROMA,-200.00',
    '04/05/2032,Accredito,STIPENDIO MAGGIO,1500.00',
    '05/05/2032,Bonifico,PRESTITO A MARIO,-50.00',
    '06/05/2032,Bonifico,GIROCONTO SU LIBRETTO,-300.00',
  ),
);
setType('PRESTITO A MARIO', 'LOAN');
setType('GIROCONTO SU LIBRETTO', 'TRANSFER');

const summary = summaryService.getMonthlySummary('2032-05');

describe('natura del movimento e riepilogo mensile', () => {
  it('riconosce il prelievo dalla tipologia della banca', () => {
    const prelievo = transactionsService
      .listAll()
      .find((t) => t.description === 'PRELIEVO ATM VIA ROMA');
    assert.equal(prelievo?.type, 'WITHDRAWAL');
  });

  it('riconosce l\'accredito dalla tipologia della banca', () => {
    const stipendio = transactionsService
      .listAll()
      .find((t) => t.description === 'STIPENDIO MAGGIO');
    assert.equal(stipendio?.type, 'INCOME');
  });

  it('un prelievo al bancomat non appare nelle spese', () => {
    assert.equal(summary.expenses, 100, 'solo i 100 € di acquisto');
    assert.ok(
      !summary.amountByCategory.some((c) => c.amount === 200),
      'il prelievo non entra in nessuna categoria',
    );
    assert.equal(summary.uncategorized.amount, 100, 'fra le non classificate c\'è solo l\'acquisto');
  });

  it('un acquisto appare nelle spese', () => {
    const acquisto = transactionsService
      .listAll()
      .find((t) => t.description === 'ACQUISTO SUPERMERCATO');
    assert.equal(acquisto?.type, 'EXPENSE');
    assert.equal(summary.expenses, 100);
  });

  it('un prestito non appare nelle spese', () => {
    assert.equal(summary.expenses, 100, 'i 50 € prestati restano fuori');
  });

  it('un trasferimento non appare nelle spese né nelle categorie', () => {
    assert.equal(summary.expenses, 100);
    assert.equal(
      summary.amountByCategory.length + (summary.uncategorized.amount === 100 ? 0 : 1),
      summary.amountByCategory.length,
    );
  });

  it('un\'entrata compare fra le entrate ma non fra le categorie', () => {
    assert.equal(summary.income, 1500);
    assert.equal(summary.balance, 1400);
    assert.deepEqual(summary.amountByCategory, []);
  });
});

describe('cash flow', () => {
  it('somma tutti i movimenti al saldo di partenza', () => {
    settingsService.update({ initialBalance: 1000, balanceDate: '2032-04-30' });

    const cashFlow = cashFlowService.getCashFlow();

    // -100 -200 +1500 -50 -300 = 850
    assert.equal(cashFlow.openingBalance, 1000);
    assert.equal(cashFlow.netMovement, 850);
    assert.equal(cashFlow.closingBalance, 1850);
    assert.equal(cashFlow.transactionCount, 5);
  });

  it('un\'entrata aumenta la liquidità', () => {
    const prima = cashFlowService.getCashFlow();

    importService.importCsv(csv('10/05/2032,Accredito,RIMBORSO SPESE,200.00'));
    const dopo = cashFlowService.getCashFlow();

    assert.equal(dopo.closingBalance, prima.closingBalance + 200);
    assert.equal(dopo.netWorthChange, prima.netWorthChange + 200, 'aumenta anche il patrimonio');
  });

  it('un trasferimento non altera il patrimonio', () => {
    const prima = cashFlowService.getCashFlow();

    importService.importCsv(csv('11/05/2032,Bonifico,GIROCONTO SECONDO,-400.00'));
    setType('GIROCONTO SECONDO', 'TRANSFER');
    const dopo = cashFlowService.getCashFlow();

    assert.equal(dopo.netWorthChange, prima.netWorthChange, 'il patrimonio resta invariato');
    assert.equal(
      dopo.closingBalance,
      prima.closingBalance - 400,
      'il saldo del conto invece diminuisce: il denaro è altrove',
    );
  });

  it('un prelievo non altera il patrimonio: il contante resta proprio', () => {
    const prima = cashFlowService.getCashFlow();

    importService.importCsv(csv('12/05/2032,Prelievo,PRELIEVO SECONDO,-60.00'));
    const dopo = cashFlowService.getCashFlow();

    assert.equal(dopo.netWorthChange, prima.netWorthChange);
    assert.equal(dopo.closingBalance, prima.closingBalance - 60);
  });

  it('considera solo i movimenti successivi alla data del saldo noto', () => {
    settingsService.update({ initialBalance: 0, balanceDate: '2032-05-05' });

    const cashFlow = cashFlowService.getCashFlow();

    // restano il giroconto del 06/05 e i movimenti successivi
    assert.equal(cashFlow.transactionCount, 4);
    assert.equal(cashFlow.netMovement, -300 + 200 - 400 - 60);
  });

  it('senza data del saldo considera tutto l\'archivio', () => {
    settingsService.update({ initialBalance: 0, balanceDate: null });

    const cashFlow = cashFlowService.getCashFlow();

    assert.equal(cashFlow.transactionCount, 8);
    assert.equal(cashFlow.closingBalance, 850 + 200 - 400 - 60);
  });

  it('dettaglia i movimenti per tipo', () => {
    const byType = new Map(
      cashFlowService.getCashFlow().byType.map((entry) => [entry.type, entry]),
    );

    assert.equal(byType.get('EXPENSE')?.amount, -100);
    assert.equal(byType.get('WITHDRAWAL')?.amount, -260);
    assert.equal(byType.get('INCOME')?.amount, 1700);
    assert.equal(byType.get('LOAN')?.amount, -50);
    assert.equal(byType.get('TRANSFER')?.amount, -700);
  });
});

describe('cash flow di un mese', () => {
  it('riporta nel saldo iniziale i movimenti precedenti al mese', () => {
    settingsService.update({ initialBalance: 2000, balanceDate: '2032-04-30' });

    const maggio = cashFlowService.getCashFlow('2032-05');

    // tutti i movimenti di prova sono di maggio: nulla da riportare
    assert.equal(maggio.openingBalance, 2000);
    assert.equal(maggio.month, '2032-05');
    assert.equal(maggio.closingBalance, round(2000 + maggio.netMovement));

    const giugno = cashFlowService.getCashFlow('2032-06');

    assert.equal(
      giugno.openingBalance,
      maggio.closingBalance,
      'il mese successivo parte dal saldo con cui si è chiuso il precedente',
    );
  });

  it('espone entrate e uscite del periodo separate dai movimenti neutri', () => {
    const maggio = cashFlowService.getCashFlow('2032-05');

    assert.equal(maggio.income, 1700, 'stipendio + rimborso');
    assert.equal(maggio.expenses, 100, 'solo l\'acquisto: prelievi e giroconti esclusi');
    assert.notEqual(maggio.netMovement, round(maggio.income - maggio.expenses));
  });

  it('mostra i prelievi separatamente nel dettaglio per tipo', () => {
    const byType = new Map(
      cashFlowService.getCashFlow('2032-05').byType.map((entry) => [entry.type, entry]),
    );

    assert.deepEqual(byType.get('WITHDRAWAL'), {
      type: 'WITHDRAWAL',
      amount: -260,
      transactionCount: 2,
    });
    assert.equal(byType.get('EXPENSE')?.amount, -100);
  });

  it('un mese senza movimenti mostra il saldo riportato e nessun dettaglio', () => {
    const vuoto = cashFlowService.getCashFlow('2032-09');

    assert.equal(vuoto.transactionCount, 0);
    assert.equal(vuoto.netMovement, 0);
    assert.equal(vuoto.income, 0);
    assert.equal(vuoto.expenses, 0);
    assert.equal(vuoto.netWorthChange, 0);
    assert.deepEqual(vuoto.byType, []);
    assert.equal(
      vuoto.closingBalance,
      vuoto.openingBalance,
      'senza movimenti il saldo disponibile non cambia',
    );
    assert.equal(vuoto.openingBalance, cashFlowService.getCashFlow('2032-06').closingBalance);
  });

  it('rifiuta un mese in formato non valido', () => {
    assert.throws(() => cashFlowService.getCashFlow('2032-13'), /formato YYYY-MM/);
    assert.throws(() => cashFlowService.getCashFlow('maggio'), /formato YYYY-MM/);
  });
});

describe('impostazioni', () => {
  it('aggiorna un campo alla volta', () => {
    settingsService.update({ initialBalance: 250.55, balanceDate: '2032-01-31' });
    settingsService.update({ initialBalance: 300 });

    assert.deepEqual(settingsService.get(), {
      initialBalance: 300,
      balanceDate: '2032-01-31',
    });
  });

  it('rifiuta valori non validi', () => {
    assert.throws(() => settingsService.update({ initialBalance: 'molti' }), /non valide/);
    assert.throws(() => settingsService.update({ balanceDate: '31/01/2032' }), /non valide/);
  });
});

describe('correzione manuale del tipo', () => {
  it('cambia solo il tipo e rifiuta transazioni inesistenti', () => {
    const transaction = transactionsService
      .listAll()
      .find((t) => t.description === 'ACQUISTO SUPERMERCATO');
    assert.ok(transaction);

    const aggiornata = transactionsService.updateType(transaction.id, 'OTHER');

    assert.equal(aggiornata.type, 'OTHER');
    assert.equal(aggiornata.amount, transaction.amount);
    assert.equal(aggiornata.description, transaction.description);
    assert.equal(aggiornata.fingerprint, transaction.fingerprint, 'l\'identità non cambia');

    assert.throws(() => transactionsService.updateType('non-esiste', 'EXPENSE'), /non trovata/);

    transactionsService.updateType(transaction.id, 'EXPENSE');
  });
});
