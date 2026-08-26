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
const { dashboardService, previousMonth } = await import('./dashboard.service.js');
const { NO_FILTERS } = await import('./dashboard-filters.js');

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

function setType(description: string, type: 'WITHDRAWAL' | 'TRANSFER'): void {
  const transaction = transactionsService.listAll().find((t) => t.description === description);
  assert.ok(transaction, `transazione "${description}" non trovata`);
  transactionsService.updateType(transaction.id, type);
}

// Mese precedente: serve al confronto.
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
    '02/03/2033,Pagamento,ESSELUNGA,-180.00',
    '09/03/2033,Pagamento,ESSELUNGA,-120.00',
    '10/03/2033,Pagamento,CARREFOUR,-200.00',
    '11/03/2033,Pagamento,BENZINAIO,-60.00',
    '12/03/2033,Prelievo,PRELIEVO ATM,-300.00',
    '13/03/2033,Accredito,STIPENDIO,2000.00',
    '14/03/2033,Pagamento,NON CLASSIFICATO,-40.00',
  ),
);
setType('PRELIEVO ATM', 'WITHDRAWAL');
classify('ESSELUNGA', 'Alimentari');
classify('CARREFOUR', 'Alimentari');
classify('BENZINAIO', 'Carburante');
classify('CINEMA', 'Tempo libero');

const marzo = () => dashboardService.getDashboard('2033-03', NO_FILTERS);

describe('mese precedente', () => {
  it('calcola il mese precedente, anche a cavallo d\'anno', () => {
    assert.equal(previousMonth('2033-03'), '2033-02');
    assert.equal(previousMonth('2033-01'), '2032-12');
    assert.equal(previousMonth('2033-10'), '2033-09');
  });
});

describe('filtro mese', () => {
  it('considera solo le transazioni del mese richiesto', () => {
    const dashboard = marzo();

    assert.equal(dashboard.month, '2033-03');
    assert.equal(dashboard.transactions.length, 7);
    assert.ok(
      dashboard.transactions.every((t) => t.bookingDate.startsWith('2033-03')),
      'nessuna transazione di altri mesi',
    );
    assert.equal(dashboard.summary.expenses, 600, '180+120+200+60+40, senza prelievo e stipendio');
    assert.equal(dashboard.summary.income, 2000);
  });

  it('un mese senza movimenti resta coerente', () => {
    const vuoto = dashboardService.getDashboard('2033-09', NO_FILTERS);

    assert.deepEqual(vuoto.transactions, []);
    assert.deepEqual(vuoto.categories, []);
    assert.deepEqual(vuoto.topMerchants, []);
    assert.equal(vuoto.summary.expenses, 0);
    assert.equal(vuoto.comparison.currentExpenses, 0);
  });
});

describe('drill down categoria / merchant / transazioni', () => {
  it('costruisce la gerarchia ordinata per importo', () => {
    const categories = marzo().categories;

    assert.deepEqual(
      categories.map((c) => [c.name, c.amount, c.transactionCount]),
      [
        ['Alimentari', 500, 3],
        ['Carburante', 60, 1],
        ['Senza categoria', 40, 1],
      ],
    );

    const alimentari = categories[0];
    assert.deepEqual(
      alimentari?.merchants.map((m) => [m.label, m.amount, m.transactionCount]),
      [
        ['ESSELUNGA', 300, 2],
        ['CARREFOUR', 200, 1],
      ],
    );
  });

  it('il terzo livello contiene le singole transazioni, dalla più recente', () => {
    const esselunga = marzo().categories[0]?.merchants[0];

    assert.deepEqual(
      esselunga?.transactions.map((t) => [t.bookingDate, t.amount]),
      [
        ['2033-03-09', 120],
        ['2033-03-02', 180],
      ],
    );
  });

  it('la somma dei merchant coincide con il totale della categoria', () => {
    for (const category of marzo().categories) {
      const somma = category.merchants.reduce((s, m) => s + m.amount, 0);
      assert.equal(somma, category.amount, `categoria ${category.name}`);
    }
  });

  it('esclude i movimenti che non sono spese', () => {
    const categories = marzo().categories;
    const totale = categories.reduce((s, c) => s + c.amount, 0);

    assert.equal(totale, 600, 'prelievo e stipendio non compaiono nella gerarchia');
  });
});

describe('top merchant', () => {
  it('ordina per totale speso decrescente, considerando solo le spese', () => {
    assert.deepEqual(
      marzo().topMerchants.map((m) => [m.label, m.amount, m.transactionCount]),
      [
        ['ESSELUNGA', 300, 2],
        ['CARREFOUR', 200, 1],
        ['BENZINAIO', 60, 1],
        ['NON CLASSIFICATO', 40, 1],
      ],
    );
  });

  it('non include prelievi né entrate', () => {
    const labels = marzo().topMerchants.map((m) => m.label);

    assert.ok(!labels.includes('PRELIEVO ATM'));
    assert.ok(!labels.includes('STIPENDIO'));
  });

  it('riporta la categoria del merchant', () => {
    assert.equal(marzo().topMerchants[0]?.categoryName, 'Alimentari');
    assert.equal(
      marzo().topMerchants.find((m) => m.label === 'NON CLASSIFICATO')?.categoryName,
      null,
    );
  });
});

describe('confronto con il mese precedente', () => {
  it('confronta le spese totali', () => {
    const comparison = marzo().comparison;

    assert.equal(comparison.previousMonth, '2033-02');
    assert.equal(comparison.currentExpenses, 600);
    assert.equal(comparison.previousExpenses, 170, '100+50+20');
    assert.equal(comparison.difference, 430);
    assert.equal(comparison.percentChange, 252.9);
  });

  it('confronta le categorie, comprese quelle presenti in un solo mese', () => {
    const byCategory = new Map(marzo().comparison.byCategory.map((c) => [c.name, c]));

    assert.deepEqual(
      { ...byCategory.get('Alimentari') },
      { id: byCategory.get('Alimentari')?.id, name: 'Alimentari', color: byCategory.get('Alimentari')?.color, current: 500, previous: 100, difference: 400 },
    );
    assert.equal(byCategory.get('Carburante')?.difference, 10);
    assert.deepEqual(
      [byCategory.get('Tempo libero')?.current, byCategory.get('Tempo libero')?.previous],
      [0, 20],
      'una categoria sparita dal mese corrente resta nel confronto',
    );
  });

  it('ordina per variazione più marcata', () => {
    const differenze = marzo().comparison.byCategory.map((c) => Math.abs(c.difference));

    assert.deepEqual(differenze, [...differenze].sort((a, b) => b - a));
  });

  it('non calcola la percentuale quando il mese precedente non ha spese', () => {
    // Aprile non ha un marzo... ha marzo, ma maggio non ha aprile.
    assert.equal(dashboardService.getDashboard('2033-05', NO_FILTERS).comparison.percentChange, null);
  });
});

describe('filtro categoria', () => {
  it('restringe tutte le sezioni alla categoria scelta', () => {
    const dashboard = dashboardService.getDashboard('2033-03', {
      ...NO_FILTERS,
      categoryId: categoryId('Alimentari'),
    });

    assert.equal(dashboard.summary.expenses, 500);
    assert.equal(dashboard.transactions.length, 3);
    assert.deepEqual(
      dashboard.categories.map((c) => c.name),
      ['Alimentari'],
    );
    assert.deepEqual(
      dashboard.topMerchants.map((m) => m.label),
      ['ESSELUNGA', 'CARREFOUR'],
    );
    assert.equal(dashboard.comparison.previousExpenses, 100, 'anche il confronto è filtrato');
  });

  it('la liquidità resta sul mese intero: filtrarla non avrebbe significato', () => {
    const filtrata = dashboardService.getDashboard('2033-03', {
      ...NO_FILTERS,
      categoryId: categoryId('Alimentari'),
    });

    assert.deepEqual(filtrata.cashFlow, marzo().cashFlow);
  });
});

describe('filtro merchant', () => {
  it('restringe le sezioni al singolo merchant', () => {
    const dashboard = dashboardService.getDashboard('2033-03', {
      ...NO_FILTERS,
      merchantId: merchantIdOf('ESSELUNGA'),
    });

    assert.equal(dashboard.summary.expenses, 300);
    assert.equal(dashboard.transactions.length, 2);
    assert.deepEqual(
      dashboard.topMerchants.map((m) => [m.label, m.amount]),
      [['ESSELUNGA', 300]],
    );
    assert.equal(dashboard.categories[0]?.merchants.length, 1);
  });
});

describe('filtro tipo', () => {
  it('mostra solo i movimenti del tipo scelto', () => {
    const prelievi = dashboardService.getDashboard('2033-03', {
      ...NO_FILTERS,
      type: 'WITHDRAWAL',
    });

    assert.equal(prelievi.transactions.length, 1);
    assert.equal(prelievi.transactions[0]?.description, 'PRELIEVO ATM');
    assert.equal(prelievi.summary.expenses, 0, 'un prelievo non è una spesa');
    assert.deepEqual(prelievi.categories, [], 'e non compare nella gerarchia delle spese');
  });

  it('combina più filtri', () => {
    const dashboard = dashboardService.getDashboard('2033-03', {
      type: 'EXPENSE',
      categoryId: categoryId('Alimentari'),
      merchantId: merchantIdOf('CARREFOUR'),
    });

    assert.equal(dashboard.transactions.length, 1);
    assert.equal(dashboard.summary.expenses, 200);
  });

  it('filtri incompatibili producono un risultato vuoto ma coerente', () => {
    const dashboard = dashboardService.getDashboard('2033-03', {
      ...NO_FILTERS,
      categoryId: categoryId('Alimentari'),
      merchantId: merchantIdOf('BENZINAIO'),
    });

    assert.deepEqual(dashboard.transactions, []);
    assert.deepEqual(dashboard.categories, []);
    assert.equal(dashboard.summary.expenses, 0);
  });
});

describe('coerenza fra le sezioni', () => {
  it('le transazioni restituite sono esattamente quelle aggregate', () => {
    const dashboard = marzo();
    const speseInTabella = dashboard.transactions
      .filter((t) => t.type === 'EXPENSE')
      .reduce((s, t) => s - t.amount, 0);

    assert.equal(Math.round(speseInTabella * 100) / 100, dashboard.summary.expenses);
    assert.equal(
      dashboard.categories.reduce((s, c) => s + c.amount, 0),
      dashboard.summary.expenses,
    );
    assert.equal(dashboard.comparison.currentExpenses, dashboard.summary.expenses);
  });

  it('rifiuta un mese in formato non valido', () => {
    assert.throws(() => dashboardService.getDashboard('2033-13', NO_FILTERS), /formato YYYY-MM/);
  });
});
