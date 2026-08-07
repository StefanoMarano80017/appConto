import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-summary-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { categoriesService } = await import('../categories/index.js');
const { merchantsService } = await import('../merchants/index.js');
const { summaryService } = await import('./summary.service.js');

runMigrations();

after(() => {
  try {
    rmSync(databaseDir, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

const csv = (...rows: string[]): string =>
  ['Data contabile,Descrizione,Importo', ...rows].join('\r\n');

function categoryId(name: string): string {
  const category = categoriesService.listAll().find((c) => c.name === name);
  assert.ok(category, `categoria "${name}" non trovata`);
  return category.id;
}

function classify(merchantName: string, categoryName: string): void {
  const merchant = merchantsService.listAll().find((m) => m.name === merchantName);
  assert.ok(merchant, `merchant "${merchantName}" non trovato`);
  merchantsService.assignCategory(merchant.id, categoryId(categoryName));
}

describe('summaryService', () => {
  it('restituisce tutto a zero per un mese senza transazioni', () => {
    const summary = summaryService.getMonthlySummary('2030-01');

    assert.deepEqual(summary, {
      month: '2030-01',
      income: 0,
      expenses: 0,
      balance: 0,
      transactionCount: 0,
      merchantCount: 0,
      amountByCategory: [],
      uncategorized: { amount: 0, transactionCount: 0 },
    });
  });

  it('con sole entrate: uscite a zero, saldo positivo, nessuna categoria', () => {
    importService.importCsv(
      csv('05/02/2030,M1 STIPENDIO,1500.00', '20/02/2030,M1 RIMBORSO,120.50'),
    );
    classify('M1 STIPENDIO', 'Altro');

    const summary = summaryService.getMonthlySummary('2030-02');

    assert.equal(summary.income, 1620.5);
    assert.equal(summary.expenses, 0);
    assert.equal(summary.balance, 1620.5);
    assert.equal(summary.transactionCount, 2);
    assert.deepEqual(summary.amountByCategory, [], 'le entrate non compaiono fra le categorie');
    assert.equal(summary.uncategorized.amount, 0);
  });

  it('con sole uscite: entrate a zero, saldo negativo', () => {
    importService.importCsv(csv('03/03/2030,M2 SPESA,-40.30', '04/03/2030,M2 BENZINA,-59.70'));

    const summary = summaryService.getMonthlySummary('2030-03');

    assert.equal(summary.income, 0);
    assert.equal(summary.expenses, 100);
    assert.equal(summary.balance, -100);
    assert.equal(summary.transactionCount, 2);
  });

  it('ordina le categorie per importo decrescente e riporta solo quelle del mese', () => {
    importService.importCsv(
      csv(
        '02/04/2030,M3 SUPERMERCATO,-10.00',
        '09/04/2030,M3 SUPERMERCATO,-15.00',
        '10/04/2030,M3 DISTRIBUTORE,-80.00',
        '11/04/2030,M3 FARMACIA,-45.00',
      ),
    );
    classify('M3 SUPERMERCATO', 'Alimentari');
    classify('M3 DISTRIBUTORE', 'Carburante');
    classify('M3 FARMACIA', 'Salute');

    const summary = summaryService.getMonthlySummary('2030-04');

    assert.deepEqual(
      summary.amountByCategory.map((c) => [c.name, c.amount, c.transactionCount]),
      [
        ['Carburante', 80, 1],
        ['Salute', 45, 1],
        ['Alimentari', 25, 2],
      ],
    );
    assert.ok(
      summary.amountByCategory.every((c) => c.id && c.color !== undefined),
      'ogni categoria espone id e colore',
    );
    assert.equal(summary.expenses, 150);
  });

  it('conta i merchant distinti, non le transazioni', () => {
    importService.importCsv(
      csv(
        '02/05/2030,M4 BAR,-2.00',
        '03/05/2030,M4 BAR,-2.50',
        '04/05/2030,M4 BAR,-3.00',
        '05/05/2030,M4 EDICOLA,-1.50',
      ),
    );

    const summary = summaryService.getMonthlySummary('2030-05');

    assert.equal(summary.transactionCount, 4);
    assert.equal(summary.merchantCount, 2);
  });

  it('separa le uscite senza categoria da quelle classificate', () => {
    importService.importCsv(
      csv('02/06/2030,M5 CLASSIFICATO,-30.00', '03/06/2030,M5 IGNOTO,-70.00'),
    );
    classify('M5 CLASSIFICATO', 'Casa');

    const summary = summaryService.getMonthlySummary('2030-06');

    assert.deepEqual(
      summary.amountByCategory.map((c) => [c.name, c.amount]),
      [['Casa', 30]],
    );
    assert.deepEqual(summary.uncategorized, { amount: 70, transactionCount: 1 });
    assert.equal(
      summary.amountByCategory[0]!.amount + summary.uncategorized.amount,
      summary.expenses,
      'categorie e non classificate coprono tutte le uscite',
    );
  });

  it('considera solo le transazioni del mese richiesto', () => {
    importService.importCsv(
      csv('31/07/2030,M6 LUGLIO,-10.00', '01/08/2030,M6 AGOSTO,-20.00'),
    );

    assert.equal(summaryService.getMonthlySummary('2030-07').expenses, 10);
    assert.equal(summaryService.getMonthlySummary('2030-08').expenses, 20);
  });

  it('somma senza errori di virgola mobile', () => {
    importService.importCsv(
      csv('02/09/2030,M7 UNO,-0.10', '03/09/2030,M7 DUE,-0.20', '04/09/2030,M7 TRE,10.00'),
    );

    const summary = summaryService.getMonthlySummary('2030-09');

    assert.equal(summary.expenses, 0.3);
    assert.equal(summary.balance, 9.7);
  });

  it('rifiuta un mese in formato non valido', () => {
    for (const month of ['2030', '2030-13', '30-01', '2030-1', 'gennaio', '']) {
      assert.throws(
        () => summaryService.getMonthlySummary(month),
        /formato YYYY-MM/,
        `"${month}" doveva essere rifiutato`,
      );
    }
  });
});
