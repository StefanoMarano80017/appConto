import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-dashboard-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { categoriesService } = await import('../categories/index.js');
const { merchantsService } = await import('../merchants/index.js');
const { transactionsService } = await import('../transactions/index.js');
const { dashboardService } = await import('./dashboard.service.js');

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

function categoryId(name: string): string {
  const category = categoriesService.listAll().find((c) => c.name === name);
  assert.ok(category, `categoria "${name}" non trovata`);
  return category.id;
}

function merchantIdOf(name: string): string {
  const merchant = merchantsService.listAll().find((m) => m.name === name);
  assert.ok(merchant, `merchant "${name}" non trovato`);
  return merchant.id;
}

function classify(merchantName: string, categoryName: string): void {
  merchantsService.assignCategory(merchantIdOf(merchantName), categoryId(categoryName));
}

function setType(description: string, type: 'WITHDRAWAL' | 'TRANSFER' | 'EXPENSE' | 'LOAN'): void {
  const transaction = transactionsService.listAll().find((t) => t.description === description);
  assert.ok(transaction, `transazione "${description}" non trovata`);
  transactionsService.updateType(transaction.id, type);
}

// Mesi precedenti: non devono comparire fra gli ultimi movimenti.
importService.importCsv(
  csv('10/05/2032,Accredito,RIMBORSO,30.00', '10/06/2032,Bonifico,BONIFICO AMICO,-500.00'),
);
setType('RIMBORSO', 'EXPENSE');
setType('BONIFICO AMICO', 'LOAN');

// Mese precedente a quello osservato: serve al confronto.
importService.importCsv(
  csv(
    '05/02/2033,Pagamento,ESSELUNGA,-100.00',
    '10/02/2033,Pagamento,BENZINAIO,-50.00',
    '15/02/2033,Pagamento,CINEMA,-20.00',
  ),
);

// Mese osservato.
importService.importCsv(
  csv(
    '05/03/2033,Pagamento,ESSELUNGA,-60.00',
    '20/03/2033,Pagamento,ESSELUNGA,-40.00',
    '08/03/2033,Pagamento,BENZINAIO,-80.00',
    '01/03/2033,Accredito,STIPENDIO,2000.00',
    '12/03/2033,Prelievo,PRELIEVO BANCOMAT,-200.00',
    '15/03/2033,Pagamento,NEGOZIO NUOVO,-10.00',
  ),
);
setType('PRELIEVO BANCOMAT', 'WITHDRAWAL');
classify('ESSELUNGA', 'Alimentari');
classify('BENZINAIO', 'Carburante');
classify('CINEMA', 'Intrattenimento');

describe('mese mostrato', () => {
  it('senza mese usa il mese dell\'ultimo movimento', () =>
    assert.equal(dashboardService.getDashboard(undefined, '2033-04-10').month, '2033-03'));
  it('un mese futuro è riportato al mese di oggi', () =>
    assert.equal(dashboardService.getDashboard('2034-01', '2033-04-10').month, '2033-04'));
  it('rifiuta un mese in formato non valido', () =>
    assert.throws(() => dashboardService.getDashboard('2033-13', '2033-04-10'), /formato YYYY-MM/));
});

describe('indicatori e confronto', () => {
  it('indicatori del mese: prelievi a parte, non nelle uscite', () => {
    const { summary } = dashboardService.getDashboard('2033-03', '2033-04-10');
    assert.deepEqual(summary, { income: 2000, expenses: 190, balance: 1810, withdrawals: 200 });
  });
  it('mese chiuso: confronto sul mese precedente intero', () => {
    const { comparison } = dashboardService.getDashboard('2033-03', '2033-04-10');
    assert.equal(comparison.previousExpenses, 170);
    assert.equal(comparison.partial, false);
    assert.equal(comparison.percentChange, 11.8);
  });
  it('mese in corso: confronto a parità di giorni', () => {
    const { comparison } = dashboardService.getDashboard('2033-03', '2033-03-10');
    // correnti fino al 10/03: 60 + 80 = 140; precedenti 01–10/02: 100 + 50 = 150
    assert.equal(comparison.partial, true);
    assert.equal(comparison.previousTo, '2033-02-10');
    assert.equal(comparison.previousExpenses, 150);
    assert.equal(comparison.percentChange, -6.7);
  });
  it('prime categorie con percentuale e variazione', () => {
    const { topCategories } = dashboardService.getDashboard('2033-03', '2033-04-10');
    assert.deepEqual(topCategories.map((c) => [c.name, c.amount, c.percentage, c.difference]), [
      ['Alimentari', 100, 52.6, 0],
      ['Carburante', 80, 42.1, 30],
      ['Senza categoria', 10, 5.3, 10],
    ]);
    // Intrattenimento (spesa 0 a marzo) non compare: `topCategories` elenca solo le categorie con spesa nel mese.
  });
  it('mese dominato da rimborsi: nessuna percentuale', () => {
    const { topCategories } = dashboardService.getDashboard('2032-05', '2033-04-10');
    assert.ok(topCategories.every((c) => c.percentage === null));
  });
});

describe('archivio e attenzione', () => {
  it('ultimi movimenti dell\'archivio, indipendenti dal mese', () => {
    const { recentTransactions } = dashboardService.getDashboard('2033-02', '2033-04-10');
    assert.equal(recentTransactions.length, 5);
    assert.equal(recentTransactions[0]?.bookingDate, '2033-03-20');
    assert.equal(recentTransactions[0]?.label, 'ESSELUNGA');
  });
  it('ultimo movimento e merchant da classificare', () => {
    const view = dashboardService.getDashboard('2033-03', '2033-04-10');
    assert.equal(view.lastTransactionDate, '2033-03-20');
    // STIPENDIO, PRELIEVO BANCOMAT, NEGOZIO NUOVO, RIMBORSO, BONIFICO AMICO
    assert.equal(view.attention.unclassifiedMerchants, 5);
  });
  it('un movimento prestito senza prestito registrato è contato come non collegato', () =>
    assert.deepEqual(dashboardService.getDashboard('2033-03', '2033-04-10').loans, {
      remaining: 0,
      openCount: 0,
      unlinkedTransactions: 1,
    }));
});
