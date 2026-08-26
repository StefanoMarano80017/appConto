import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-loans-partial-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { transactionsService } = await import('../transactions/index.js');
const { categoriesService } = await import('../categories/index.js');
const { merchantsService } = await import('../merchants/index.js');
const { summaryService } = await import('../summary/index.js');
const { cashFlowService } = await import('../cash-flow/index.js');
const { analyticsService, ALL_TRANSACTIONS } = await import('../analytics/index.js');
const { dashboardService } = await import('../dashboard/index.js');
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

/**
 * Il prestito parziale.
 *
 * Un pagamento unico di 1.920 € in cui 1.030 € sono stati anticipati per
 * un'altra persona e 890 € sono spesa propria. Il tipo del movimento è uno
 * solo, ma il movimento è due cose insieme: la liquidità deve vedere l'intero
 * 1.920, le uscite e il patrimonio i soli 890.
 */

const MONTH = '2035-04';

importService.importCsv(
  ['Data contabile,Tipologia,Descrizione,Importo', '10/04/2035,Bonifico,ASSICURAZIONI DUE AUTO,-1920.00'].join(
    '\r\n',
  ),
);

const origin = transactionsService.listAll().find((t) => t.description === 'ASSICURAZIONI DUE AUTO');
assert.ok(origin, 'movimento di prova non trovato');
transactionsService.updateType(origin.id, 'LOAN');

// Il merchant riceve una categoria: così si vede dove finiscono gli 890 €.
const merchant = merchantsService.listAll().find((m) => m.name === 'ASSICURAZIONI DUE AUTO');
assert.ok(merchant);
const casa = categoriesService.listAll().find((c) => c.name === 'Casa');
assert.ok(casa);
merchantsService.assignCategory(merchant.id, casa.id);

const noFilters = { month: MONTH, type: null, categoryId: null, merchantId: null };

/** Tutte le proiezioni finanziarie, lette nello stesso istante. */
function measure() {
  const summary = summaryService.getMonthlySummary(MONTH);
  const flow = cashFlowService.getCashFlow(MONTH);
  const analytics = analyticsService.getAnalytics({
    ...ALL_TRANSACTIONS,
    from: `${MONTH}-01`,
    to: `${MONTH}-30`,
  });
  const dashboard = dashboardService.getDashboard(MONTH, noFilters);

  return {
    expenses: summary.expenses,
    categoryAmount: summary.amountByCategory.find((c) => c.name === 'Casa')?.amount ?? 0,
    cashExpenses: flow.expenses,
    netMovement: flow.netMovement,
    closingBalance: flow.closingBalance,
    netWorthChange: flow.netWorthChange,
    analyticsExpenses: analytics.overview.expenses,
    analyticsLoans: analytics.overview.loans,
    analyticsCategory: analytics.byCategory.find((c) => c.name === 'Casa')?.amount ?? 0,
    analyticsMerchant: analytics.byMerchant[0]?.amount ?? 0,
    analyticsLent: analytics.loans.lent,
    timelineExpenses: analytics.timeline.buckets.reduce((sum, b) => sum + b.expenses, 0),
    timelineLoans: analytics.timeline.buckets.reduce((sum, b) => sum + b.loans, 0),
    overview: analytics.overview,
    dashboardCategory: dashboard.categories.find((c) => c.name === 'Casa')?.amount ?? 0,
    dashboardTopMerchant: dashboard.topMerchants[0]?.amount ?? 0,
    dashboardSummaryExpenses: dashboard.summary.expenses,
  };
}

const loanId = (): string => {
  const loan = loansService.list(DEFAULT_LOAN_QUERY).items[0];
  assert.ok(loan);
  return loan.id;
};

describe('prima che il prestito sia registrato', () => {
  const state = measure();

  it('il movimento esce dal conto per intero', () => {
    assert.equal(state.netMovement, -1920);
    assert.equal(state.closingBalance, -1920);
  });

  it('ma non è spesa: non si sa ancora quanto è stato prestato', () => {
    assert.equal(state.expenses, 0);
    assert.equal(state.cashExpenses, 0);
    assert.equal(state.analyticsExpenses, 0);
    assert.equal(state.categoryAmount, 0, 'nessuna categoria lo riceve');
  });

  it('e non riduce il patrimonio: è tutto credito', () => {
    assert.equal(state.netWorthChange, 0);
    assert.equal(state.analyticsLoans, -1920);
    assert.equal(state.analyticsLent, 1920);
  });
});

describe('registrato il prestito parziale', () => {
  loansService.create({
    transactionId: origin.id,
    borrowerName: 'Mamma',
    description: 'Assicurazione della sua auto',
    amount: 1030,
    lentAt: `${MONTH}-10`,
  });

  const state = measure();

  it('gli 890 € non prestati sono spesa reale', () => {
    assert.equal(state.expenses, 890, 'uscite del mese');
    assert.equal(state.cashExpenses, 890, 'uscite del cash flow');
    assert.equal(state.analyticsExpenses, 890, 'uscite di analytics');
    assert.equal(state.dashboardSummaryExpenses, 890, 'uscite della dashboard');
  });

  it('e finiscono nella categoria del movimento', () => {
    assert.equal(state.categoryAmount, 890, 'riepilogo');
    assert.equal(state.analyticsCategory, 890, 'analytics');
    assert.equal(state.dashboardCategory, 890, 'drill down della dashboard');
    assert.equal(state.analyticsMerchant, 890, 'distribuzione per merchant');
    assert.equal(state.dashboardTopMerchant, 890, 'top merchant');
  });

  it('il patrimonio scende degli 890 realmente spesi, non dei 1.920 usciti', () => {
    assert.equal(state.netWorthChange, -890);
  });

  it('prestato resta 1.030: la parte propria non è un credito', () => {
    assert.equal(state.analyticsLoans, -1030);
    assert.equal(state.analyticsLent, 1030);
    assert.equal(loansService.list(DEFAULT_LOAN_QUERY).totals.lent, 1030);
  });

  it('la liquidità non cambia: dal conto sono usciti 1.920 € comunque', () => {
    assert.equal(state.netMovement, -1920);
    assert.equal(state.closingBalance, -1920);
  });

  it('le voci del totale ricompongono il movimento, senza contarlo due volte', () => {
    const { income, expenses, withdrawals, loans, transfers, other, netMovement } = state.overview;

    assert.equal(income - expenses + withdrawals + loans + transfers + other, netMovement);
  });

  it('anche l\'andamento nel tempo segue la ripartizione', () => {
    assert.equal(state.timelineExpenses, 890);
    assert.equal(state.timelineLoans, -1030);
  });
});

describe('la restituzione non cambia la spesa', () => {
  it('incassare il credito non trasforma gli 890 € in qualcos\'altro', () => {
    const before = measure();

    loansService.addRepayment(loanId(), { amount: 1030, repaymentDate: `${MONTH}-20` });

    const after = measure();

    assert.equal(loansService.list(DEFAULT_LOAN_QUERY).items[0]?.status, 'SETTLED');
    assert.equal(after.expenses, before.expenses, 'la spesa propria è già avvenuta');
    assert.equal(after.netWorthChange, before.netWorthChange);
    assert.equal(after.netMovement, before.netMovement, 'e in contanti il conto non si muove');
  });
});

describe('un secondo prestito sullo stesso movimento', () => {
  it('assorbe la quota residua e azzera la spesa propria', () => {
    loansService.create({
      transactionId: origin.id,
      borrowerName: 'Marco',
      amount: 890,
      lentAt: `${MONTH}-10`,
    });

    const state = measure();

    assert.equal(state.expenses, 0, 'niente è rimasto a carico proprio');
    assert.equal(state.categoryAmount, 0);
    assert.equal(state.netWorthChange, 0);
    assert.equal(state.analyticsLoans, -1920, 'tutto il movimento è credito');
    assert.equal(state.netMovement, -1920, 'la liquidità non si è mai mossa da qui');
  });
});

describe('eliminando i prestiti si torna al punto di partenza', () => {
  it('senza prestiti il movimento è di nuovo tutto credito', () => {
    for (const loan of loansService.list(DEFAULT_LOAN_QUERY).items) {
      for (const repayment of loansService.getById(loan.id).repayments) {
        loansService.removeRepayment(loan.id, repayment.id);
      }
      loansService.remove(loan.id);
    }

    const state = measure();

    assert.equal(state.expenses, 0);
    assert.equal(state.netWorthChange, 0);
    assert.equal(state.analyticsLoans, -1920);
    assert.equal(state.netMovement, -1920);
  });
});

describe('correggere il tipo del movimento non fa contare due volte', () => {
  it('diventato una spesa, i 1.920 € sono spesa per intero', () => {
    loansService.create({
      transactionId: origin.id,
      borrowerName: 'Mamma',
      amount: 1030,
      lentAt: `${MONTH}-10`,
    });
    assert.equal(measure().expenses, 890, 'con il prestito, 890');

    transactionsService.updateType(origin.id, 'EXPENSE');
    const state = measure();

    assert.equal(state.expenses, 1920, 'il tipo ha la precedenza sul prestito');
    assert.equal(state.categoryAmount, 1920);
    assert.equal(state.netWorthChange, -1920);
    assert.equal(
      loansService.getById(loanId()).transactionTypeMismatch,
      true,
      'e il prestito segnala che il movimento non è più un prestito',
    );

    transactionsService.updateType(origin.id, 'LOAN');
    loansService.remove(loanId());
  });
});
