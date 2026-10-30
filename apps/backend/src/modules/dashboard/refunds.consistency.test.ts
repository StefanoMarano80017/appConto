import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-refunds-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { closeDatabase, runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { categoriesService } = await import('../categories/index.js');
const { merchantsService } = await import('../merchants/index.js');
const { transactionsService } = await import('../transactions/index.js');
const { summaryService } = await import('../summary/index.js');
const { analyticsService, parseAnalyticsQuery } = await import('../analytics/index.js');
const { dashboardService } = await import('./dashboard.service.js');

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
 * Rimborsi coerenti fra le viste (D1, opzione B).
 *
 * Un rimborso è un movimento di tipo spesa con importo positivo. I totali
 * delle uscite restano netti, anche negativi (D1.b); nelle distribuzioni
 * restano solo le voci con netto positivo e le percentuali si calcolano
 * sulla loro somma, anche per i merchant di analytics (D1.c).
 */

const csv = (...rows: string[]): string =>
  ['Data contabile,Tipologia,Descrizione,Importo', ...rows].join('\r\n');

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

/** Un accredito ricevuto da un negozio è un rimborso: una spesa con importo positivo. */
function markAsRefund(bookingDate: string, description: string): void {
  const transaction = transactionsService
    .listAll()
    .find((t) => t.bookingDate === bookingDate && t.description === description);
  assert.ok(transaction, `transazione "${description}" del ${bookingDate} non trovata`);
  transactionsService.updateType(transaction.id, 'EXPENSE');
}

importService.importCsv(
  csv(
    // gennaio: soli rimborsi, uscite nette −30
    '10/01/2040,Accredito,CONAD,30.00',
    // febbraio: 100, dopo un mese negativo
    '10/02/2040,Pagamento,ESSELUNGA,-100.00',
    // marzo: nessun movimento
    // aprile: 100, dopo un mese a zero
    '10/04/2040,Pagamento,ESSELUNGA,-100.00',
    // maggio e giugno: da 50 a 100
    '10/05/2040,Pagamento,ESSELUNGA,-50.00',
    '10/06/2040,Pagamento,ESSELUNGA,-100.00',
    // luglio: spese con rimborsi (Alimentari −100 e +30, Shopping solo +20)
    '05/07/2040,Pagamento,ESSELUNGA,-100.00',
    '12/07/2040,Accredito,CONAD,30.00',
    '20/07/2040,Accredito,ZARA,20.00',
    // agosto: sole spese
    '05/08/2040,Pagamento,ESSELUNGA,-60.00',
    '12/08/2040,Pagamento,ZARA,-30.00',
    '20/08/2040,Pagamento,NEGOZIO IGNOTO,-10.00',
    // settembre: sette categorie con spesa positiva, 1000 in tutto
    '01/09/2040,Pagamento,ESSELUNGA,-300.00',
    '02/09/2040,Pagamento,ZARA,-200.00',
    '03/09/2040,Pagamento,BENZINAIO,-150.00',
    '04/09/2040,Pagamento,IKEA,-120.00',
    '05/09/2040,Pagamento,PIZZERIA,-90.00',
    '06/09/2040,Pagamento,FARMACIA CENTRALE,-80.00',
    '07/09/2040,Pagamento,HOTEL,-60.00',
  ),
);
markAsRefund('2040-01-10', 'CONAD');
markAsRefund('2040-07-12', 'CONAD');
markAsRefund('2040-07-20', 'ZARA');
classify('ESSELUNGA', 'Alimentari');
classify('CONAD', 'Alimentari');
classify('ZARA', 'Shopping');
classify('BENZINAIO', 'Carburante');
classify('IKEA', 'Casa');
classify('PIZZERIA', 'Ristoranti');
classify('FARMACIA CENTRALE', 'Farmacia');
classify('HOTEL', 'Viaggi');

const TODAY = '2041-01-10';

const LAST_DAY: Record<string, string> = {
  '2040-01': '31',
  '2040-07': '31',
  '2040-08': '31',
};

/** Le tre viste dello stesso mese. */
function views(month: string) {
  return {
    summary: summaryService.getMonthlySummary(month),
    analytics: analyticsService.getAnalytics(
      parseAnalyticsQuery({ from: `${month}-01`, to: `${month}-${LAST_DAY[month]}` }),
    ),
    dashboard: dashboardService.getDashboard(month, TODAY),
  };
}

describe('spese con rimborsi: Alimentari −100 e +30, Shopping solo +20', () => {
  const { summary, analytics, dashboard } = views('2040-07');

  it('le uscite restano nette in tutte le viste', () => {
    assert.equal(summary.expenses, 50);
    assert.equal(analytics.overview.expenses, 50);
    assert.equal(dashboard.summary.expenses, 50);
  });

  it('summary: fra le categorie solo Alimentari, al netto del rimborso', () => {
    assert.deepEqual(
      summary.amountByCategory.map((c) => [c.name, c.amount, c.transactionCount]),
      [['Alimentari', 70, 2]],
    );
  });

  it('analytics: Alimentari è il 100% delle categorie, Shopping non compare', () => {
    assert.deepEqual(
      analytics.byCategory.map((c) => [c.name, c.amount, c.percentage]),
      [['Alimentari', 70, 100]],
    );
  });

  it('analytics: fra i merchant restano solo quelli con spesa netta positiva (D1.c)', () => {
    // CONAD e ZARA hanno solo rimborsi; la base è la somma delle voci positive.
    assert.deepEqual(
      analytics.byMerchant.map((m) => [m.name, m.amount, m.percentage]),
      [['ESSELUNGA', 100, 100]],
    );
  });

  it('dashboard: Alimentari è il 100% delle prime categorie', () => {
    assert.deepEqual(
      dashboard.topCategories.map((c) => [c.name, c.amount, c.percentage]),
      [['Alimentari', 70, 100]],
    );
  });
});

describe('dashboard con più di cinque categorie', () => {
  it('le prime cinque hanno la quota sulla somma di tutte e sette: insieme fanno meno di 100', () => {
    const { topCategories } = dashboardService.getDashboard('2040-09', TODAY);

    // Base: 300 + 200 + 150 + 120 + 90 + 80 + 60 = 1000. Farmacia (80) e Viaggi (60) restano fuori.
    assert.deepEqual(
      topCategories.map((c) => [c.name, c.amount, c.percentage]),
      [
        ['Alimentari', 300, 30],
        ['Shopping', 200, 20],
        ['Carburante', 150, 15],
        ['Casa', 120, 12],
        ['Ristoranti', 90, 9],
      ],
    );
    const somma = topCategories.reduce((totale, c) => totale + (c.percentage ?? 0), 0);
    assert.equal(somma, 86);
  });
});

describe('variazione rispetto al mese precedente', () => {
  const casi = [
    { mese: '2040-02', precedente: -30, attuale: 100, atteso: null },
    { mese: '2040-04', precedente: 0, attuale: 100, atteso: null },
    { mese: '2040-06', precedente: 50, attuale: 100, atteso: 100 },
  ];

  for (const { mese, precedente, attuale, atteso } of casi) {
    it(`da ${precedente} a ${attuale}: ${atteso === null ? 'non calcolabile' : `${atteso}%`}`, () => {
      const { summary, comparison } = dashboardService.getDashboard(mese, TODAY);

      assert.equal(summary.expenses, attuale);
      assert.equal(comparison.previousExpenses, precedente, 'le uscite precedenti restano nette');
      assert.equal(comparison.percentChange, atteso);
    });
  }
});

describe('invarianti fra le viste', () => {
  const scenari = [
    { nome: 'sole spese', mese: '2040-08', uscite: 100 },
    { nome: 'spese con rimborsi', mese: '2040-07', uscite: 50 },
    { nome: 'soli rimborsi', mese: '2040-01', uscite: -30 },
  ];

  for (const { nome, mese, uscite } of scenari) {
    describe(nome, () => {
      const { summary, analytics, dashboard } = views(mese);
      const distribuzioni = {
        'summary.amountByCategory': summary.amountByCategory,
        'analytics.byCategory': analytics.byCategory,
        'analytics.byMerchant': analytics.byMerchant,
        'dashboard.topCategories': dashboard.topCategories,
      };

      it('le tre viste riportano le stesse uscite nette', () => {
        assert.equal(summary.expenses, uscite);
        assert.equal(analytics.overview.expenses, summary.expenses);
        assert.equal(dashboard.summary.expenses, summary.expenses);
      });

      it('le percentuali di ogni distribuzione sommano a 100, oppure la distribuzione è vuota', () => {
        const conPercentuale = {
          'analytics.byCategory': analytics.byCategory,
          'analytics.byMerchant': analytics.byMerchant,
          'dashboard.topCategories': dashboard.topCategories,
        };

        for (const [vista, voci] of Object.entries(conPercentuale)) {
          if (voci.length === 0) {
            continue;
          }
          const somma = voci.reduce((totale, voce) => totale + (voce.percentage ?? 0), 0);
          // 0,1 di arrotondamento delle quote, più un margine per la virgola mobile (99.89999999999999).
          assert.ok(
            Math.abs(somma - 100) <= 0.1 + 1e-9,
            `${vista}: le percentuali sommano a ${somma}`,
          );
        }
      });

      it('nessuna voce di distribuzione ha importo nullo o negativo', () => {
        for (const [vista, voci] of Object.entries(distribuzioni)) {
          const nonPositive = voci.filter((voce) => voce.amount <= 0).map((voce) => voce.name);
          assert.deepEqual(nonPositive, [], `${vista}: voci con importo ≤ 0`);
        }
      });
    });
  }

  it('soli rimborsi: tutte le distribuzioni sono vuote', () => {
    const { summary, analytics, dashboard } = views('2040-01');

    assert.deepEqual(summary.amountByCategory, []);
    assert.deepEqual(analytics.byCategory, []);
    assert.deepEqual(analytics.byMerchant, []);
    assert.deepEqual(dashboard.topCategories, []);
  });
});
