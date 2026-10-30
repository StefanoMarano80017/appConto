import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-loans-repayment-income-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { closeDatabase, runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { DEFAULT_QUERY, transactionsService } = await import('../transactions/index.js');
const { cashFlowService } = await import('../cash-flow/index.js');
const { summaryService } = await import('../summary/index.js');
const { analyticsService } = await import('../analytics/index.js');
const { ALL_TRANSACTIONS } = await import('../analytics/analytics.query.js');
const { dashboardService } = await import('../dashboard/index.js');
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
 * Restituzioni collegate ad un accredito (D2, opzione B).
 *
 * L'accredito collegato resta `INCOME`, ma la quota che restituisce un credito
 * non entra né nelle entrate né nel patrimonio: il prestito non li aveva
 * ridotti quando era nato. La liquidità invece si muove davvero, e resta
 * com'è: saldo, movimento netto e ripartizione per tipo non cambiano.
 *
 * Ogni scenario usa un anno diverso e gli scenari si susseguono nel tempo:
 * il saldo iniziale del primo mese è zero, e i movimenti di uno scenario non
 * cadono nei mesi osservati dagli altri.
 */
const csv = (...rows: string[]): string =>
  ['Data contabile,Tipologia,Descrizione,Importo', ...rows].join('\r\n');

importService.importCsv(
  csv(
    // Mappa D2: prestito di 80, restituzione di 50 su un accredito, 10 in contanti.
    '05/03/2041,Bonifico,PRESTITO MAPPA,-80.00',
    '20/03/2041,Accredito,RESTITUZIONE MAPPA,50.00',
    // Un accredito di 70 di cui solo 50 restituiscono un credito.
    '03/02/2042,Bonifico,PRESTITO PARZIALE,-50.00',
    '15/02/2042,Accredito,ACCREDITO MISTO,70.00',
    // Prestito in un mese, restituzione nel mese dopo.
    '10/01/2043,Bonifico,PRESTITO GENNAIO,-40.00',
    '12/02/2043,Accredito,RESTITUZIONE FEBBRAIO,40.00',
    // Restituzione arrivata in banca ma non collegata.
    '08/01/2044,Bonifico,PRESTITO NON COLLEGATO,-30.00',
    '22/01/2044,Accredito,RESTITUZIONE NON COLLEGATA,30.00',
    // Accredito collegato il cui tipo viene poi corretto.
    '04/01/2045,Bonifico,PRESTITO RICLASSIFICATO,-60.00',
    '18/01/2045,Accredito,ACCREDITO RICLASSIFICATO,60.00',
  ),
);

/** Tutti i mesi in cui avviene qualcosa: le invarianti di liquidità li guardano tutti. */
const MONTHS = ['2041-03', '2042-02', '2043-01', '2043-02', '2044-01', '2045-01'];

/** Data di oggi per la dashboard: dopo ogni scenario, così nessun mese viene ristretto. */
const TODAY = '2046-01-01';

function transactionId(description: string): string {
  const transaction = transactionsService.listAll().find((t) => t.description === description);
  assert.ok(transaction, `transazione "${description}" non trovata`);
  return transaction.id;
}

/** Il tipo viene fissato a mano: lo scenario non dipende dalle regole di classificazione. */
function classify(loanDescription: string, incomeDescription: string): void {
  transactionsService.updateType(transactionId(loanDescription), 'LOAN');
  transactionsService.updateType(transactionId(incomeDescription), 'INCOME');
}

classify('PRESTITO MAPPA', 'RESTITUZIONE MAPPA');
classify('PRESTITO PARZIALE', 'ACCREDITO MISTO');
classify('PRESTITO GENNAIO', 'RESTITUZIONE FEBBRAIO');
classify('PRESTITO NON COLLEGATO', 'RESTITUZIONE NON COLLEGATA');
classify('PRESTITO RICLASSIFICATO', 'ACCREDITO RICLASSIFICATO');

function lend(description: string, amount: number, lentAt: string): string {
  return loansService.create({
    transactionId: transactionId(description),
    borrowerName: `Debitore ${description}`,
    description: null,
    amount,
    lentAt,
  }).id;
}

function repaymentId(loanId: string, transactionIdOrNull: string | null): string {
  const repayment = loansService
    .getById(loanId)
    .repayments.find((r) => (r.transaction?.id ?? null) === transactionIdOrNull);
  assert.ok(repayment, 'restituzione non trovata');
  return repayment.id;
}

const cashFlow = (month: string) => cashFlowService.getCashFlow(month);
const summary = (month: string) => summaryService.getMonthlySummary(month);
const dashboard = (month: string) => dashboardService.getDashboard(month, TODAY);
const analytics = (from: string, to: string) =>
  analyticsService.getAnalytics({ ...ALL_TRANSACTIONS, from, to });

/** Un importo in euro, confrontato al centesimo. */
const cents = (value: number): number => Math.round(value * 100);

/** Ciò che è liquidità e non deve mai cambiare collegando o scollegando. */
const liquidity = () =>
  MONTHS.map((month) => {
    const flow = cashFlow(month);
    return {
      month,
      openingBalance: flow.openingBalance,
      netMovement: flow.netMovement,
      closingBalance: flow.closingBalance,
    };
  });

/** Le entrate del mese secondo ciascuna vista. */
const incomeByView = (month: string, from: string, to: string) => ({
  cashFlow: cashFlow(month).income,
  summary: summary(month).income,
  analytics: analytics(from, to).overview.income,
  dashboard: dashboard(month).summary.income,
});

const sumByType = (month: string): number =>
  cashFlow(month).byType.reduce((sum, entry) => sum + cents(entry.amount), 0);

describe('mappa D2: prestito di 80, 50 collegati ad un accredito, 10 in contanti', () => {
  const MONTH = '2041-03';
  const FROM = '2041-03-01';
  const TO = '2041-03-31';
  let loanId = '';
  let before: ReturnType<typeof snapshot>;
  const incomeId = transactionId('RESTITUZIONE MAPPA');

  /** I valori di ogni vista per il mese della mappa. */
  const snapshot = () => {
    const flow = cashFlow(MONTH);
    const monthSummary = summary(MONTH);
    const overview = analytics(FROM, TO);
    const board = dashboard(MONTH);
    const loan = loansService.getById(loanId);

    return {
      flow,
      summary: monthSummary,
      analytics: overview,
      dashboard: board,
      loan,
      liquidity: liquidity(),
    };
  };

  it('prima del collegamento l\'accredito è un\'entrata', () => {
    loanId = lend('PRESTITO MAPPA', 80, '2041-03-05');
    loansService.addRepayment(loanId, { amount: 10, repaymentDate: '2041-03-25', note: 'contanti' });

    before = snapshot();

    assert.equal(before.flow.income, 50);
    assert.equal(before.flow.netWorthChange, 50);
    assert.equal(before.summary.income, 50);
    assert.equal(before.analytics.overview.income, 50);
    assert.equal(before.dashboard.summary.income, 50);
  });

  it('collegato, esce dalle entrate e dal patrimonio di ogni vista', () => {
    loansService.addRepayment(loanId, {
      amount: 50,
      repaymentDate: '2041-03-20',
      transactionId: incomeId,
    });

    const now = snapshot();

    // cash-flow
    assert.equal(now.flow.income, 0, 'income');
    assert.equal(now.flow.netWorthChange, 0, 'netWorthChange');
    assert.equal(now.flow.netMovement, -30, 'netMovement: liquidità invariata');
    assert.equal(now.flow.openingBalance, 0);
    assert.equal(now.flow.closingBalance, -30, 'closingBalance: liquidità invariata');
    assert.equal(now.flow.expenses, 0, 'expenses');
    assert.deepEqual(
      now.flow.byType.map(({ type, amount }) => ({ type, amount })),
      [
        { type: 'LOAN', amount: -80 },
        { type: 'INCOME', amount: 50 },
      ],
      'byType resta la ripartizione della liquidità',
    );

    // summary
    assert.equal(now.summary.income, 0, 'summary.income');
    assert.equal(now.summary.balance, 0, 'summary.balance');

    // analytics
    assert.equal(now.analytics.overview.income, 0, 'overview.income');
    assert.equal(now.analytics.overview.balance, 0, 'overview.balance');
    assert.equal(now.analytics.overview.netMovement, -30, 'overview.netMovement');
    assert.equal(
      now.analytics.timeline.buckets.reduce((sum, bucket) => sum + cents(bucket.income), 0),
      0,
      'la serie delle entrate nella timeline',
    );
    assert.equal(now.analytics.loans.lent, 80, 'loans.lent');

    // dashboard
    assert.equal(now.dashboard.summary.income, 0, 'dashboard.summary.income');
    assert.equal(now.dashboard.summary.balance, 0, 'dashboard.summary.balance');
    // Il blocco prestiti segue il credito, come prima di D2: 80 - 10 - 50.
    assert.equal(now.dashboard.loans.remaining, 20, 'dashboard: credito residuo');
    assert.equal(now.dashboard.loans.openCount, 1);

    // pagina prestiti
    assert.equal(now.loan.remainingAmount, 20, 'residuo: 20 da ricevere');
    assert.equal(now.loan.repaidAmount, 60, 'rientrati: 50 + 10');

    // lista transazioni
    assert.equal(transactionsService.findById(incomeId)?.type, 'INCOME', 'il tipo non cambia');
    assert.ok(
      transactionsService
        .search({ ...DEFAULT_QUERY, types: ['INCOME'], pageSize: 100 })
        .transactions.some(({ transaction }) => transaction.id === incomeId),
      'il filtro INCOME lo trova ancora',
    );
  });

  it('invarianti: la liquidità non cambia, l\'entrata cala esattamente della quota collegata', () => {
    const now = snapshot();

    assert.deepEqual(now.liquidity, before.liquidity, 'nessun mese cambia saldo o movimento netto');
    assert.deepEqual(now.flow.byType, before.flow.byType, 'né la ripartizione per tipo');
    assert.equal(cents(now.flow.income) + cents(50), cents(before.flow.income));
    assert.equal(cents(now.summary.income) + cents(50), cents(before.summary.income));
    assert.equal(
      cents(now.analytics.overview.income) + cents(50),
      cents(before.analytics.overview.income),
    );
    assert.equal(sumByType(MONTH), cents(now.flow.netMovement), 'Σ byType = netMovement');
  });
});

describe('accredito di 70 con 50 collegati', () => {
  const MONTH = '2042-02';
  const FROM = '2042-02-01';
  const TO = '2042-02-28';
  const incomeId = transactionId('ACCREDITO MISTO');
  let loanId = '';

  it('entra fra le entrate per i soli 20 non collegati', () => {
    loanId = lend('PRESTITO PARZIALE', 50, '2042-02-03');
    const before = liquidity();

    loansService.addRepayment(loanId, {
      amount: 50,
      repaymentDate: '2042-02-15',
      transactionId: incomeId,
    });

    assert.deepEqual(incomeByView(MONTH, FROM, TO), {
      cashFlow: 20,
      summary: 20,
      analytics: 20,
      dashboard: 20,
    });
    assert.equal(cashFlow(MONTH).netWorthChange, 20, '+70 di cui 50 rientro del credito');
    assert.deepEqual(liquidity(), before, 'collegare non cambia la liquidità');
    assert.equal(sumByType(MONTH), cents(cashFlow(MONTH).netMovement), 'Σ byType = netMovement');
  });

  it('scollegata la restituzione, l\'entrata torna per intero', () => {
    const before = liquidity();

    loansService.updateRepayment(loanId, repaymentId(loanId, incomeId), { transactionId: null });

    assert.deepEqual(incomeByView(MONTH, FROM, TO), {
      cashFlow: 70,
      summary: 70,
      analytics: 70,
      dashboard: 70,
    });
    assert.equal(cashFlow(MONTH).netWorthChange, 70);
    assert.deepEqual(liquidity(), before, 'scollegare non cambia la liquidità');
  });
});

describe('restituzione collegata ad un accredito di un mese diverso dal prestito', () => {
  const incomeId = transactionId('RESTITUZIONE FEBBRAIO');

  it('l\'esclusione avviene nel mese dell\'accredito', () => {
    const loanId = lend('PRESTITO GENNAIO', 40, '2043-01-10');
    const january = cashFlow('2043-01');
    const february = cashFlow('2043-02');

    loansService.addRepayment(loanId, {
      amount: 40,
      repaymentDate: '2043-02-12',
      transactionId: incomeId,
    });

    assert.deepEqual(cashFlow('2043-01'), january, 'il mese del prestito non cambia');
    assert.equal(february.income, 40);
    assert.equal(cashFlow('2043-02').income, 0, 'il mese dell\'accredito perde la quota collegata');
    assert.equal(cashFlow('2043-02').netWorthChange, 0);
    assert.equal(cashFlow('2043-02').netMovement, 40, 'la liquidità entra comunque');
    assert.equal(summary('2043-02').income, 0);
  });

  it('prestare X e riceverne X collegati non muove entrate né patrimonio sull\'intero periodo', () => {
    const months = ['2043-01', '2043-02'].map(cashFlow);

    assert.equal(
      months.reduce((sum, flow) => sum + cents(flow.netWorthChange), 0),
      0,
      'netWorthChange complessivo',
    );
    assert.equal(
      months.reduce((sum, flow) => sum + cents(flow.income), 0),
      0,
      'income complessivo',
    );
    assert.equal(analytics('2043-01-01', '2043-02-28').overview.income, 0, 'analytics sul periodo');
    assert.equal(sumByType('2043-01'), cents(months[0]?.netMovement ?? NaN));
    assert.equal(sumByType('2043-02'), cents(months[1]?.netMovement ?? NaN));
  });
});

describe('restituzione arrivata in banca ma non collegata', () => {
  it('l\'accredito resta un\'entrata: collegarlo è compito di chi usa l\'app', () => {
    const loanId = lend('PRESTITO NON COLLEGATO', 30, '2044-01-08');
    loansService.addRepayment(loanId, { amount: 30, repaymentDate: '2044-01-22' });

    assert.deepEqual(incomeByView('2044-01', '2044-01-01', '2044-01-31'), {
      cashFlow: 30,
      summary: 30,
      analytics: 30,
      dashboard: 30,
    });
    assert.equal(cashFlow('2044-01').netWorthChange, 30);
  });
});

describe('accredito collegato il cui tipo viene corretto', () => {
  const MONTH = '2045-01';
  const incomeId = transactionId('ACCREDITO RICLASSIFICATO');

  it('finché è un\'entrata la quota collegata è esclusa', () => {
    const loanId = lend('PRESTITO RICLASSIFICATO', 60, '2045-01-04');
    loansService.addRepayment(loanId, {
      amount: 60,
      repaymentDate: '2045-01-18',
      transactionId: incomeId,
    });

    assert.equal(cashFlow(MONTH).income, 0);
    assert.equal(cashFlow(MONTH).netWorthChange, 0);
  });

  it('corretto in OTHER viene rifiutato (D9), e nulla cambia', () => {
    // D9: un accredito collegato a una restituzione resta un'entrata; prima
    // questo test lo riclassificava in OTHER e verificava che tornasse nel
    // patrimonio per intero.
    const before = liquidity();
    assert.throws(
      () =>
        transactionsService.updateType(incomeId, 'OTHER', {
          usagesOf: (ids) => loansService.transactionUsages(ids),
        }),
      /Deve restare un'entrata/,
    );

    assert.equal(transactionsService.findById(incomeId)?.type, 'INCOME');
    assert.equal(cashFlow(MONTH).income, 0);
    assert.equal(cashFlow(MONTH).netWorthChange, 0);
    assert.deepEqual(liquidity(), before, 'il tipo non cambia la liquidità');
  });

  it('riportato a INCOME, l\'esclusione resta', () => {
    transactionsService.updateType(incomeId, 'INCOME');

    assert.equal(cashFlow(MONTH).income, 0);
    assert.equal(cashFlow(MONTH).netWorthChange, 0);
    assert.equal(summary(MONTH).income, 0);
  });
});
