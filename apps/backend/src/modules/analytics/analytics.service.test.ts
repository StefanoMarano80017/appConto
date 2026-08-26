import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-analytics-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { categoriesService } = await import('../categories/index.js');
const { merchantsService } = await import('../merchants/index.js');
const { transactionsService } = await import('../transactions/index.js');
const { analyticsService, automaticGranularity, startOfWeek } = await import(
  './analytics.service.js'
);
const { ALL_TRANSACTIONS, parseAnalyticsQuery } = await import('./analytics.query.js');

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

function setType(description: string, type: 'LOAN' | 'TRANSFER'): void {
  const transaction = transactionsService.listAll().find((t) => t.description === description);
  assert.ok(transaction, `transazione "${description}" non trovata`);
  transactionsService.updateType(transaction.id, type);
}

importService.importCsv(
  csv(
    // gennaio: due spese e uno stipendio
    '05/01/2034,Pagamento,ESSELUNGA,-100.00',
    '10/01/2034,Pagamento,BENZINAIO,-50.00',
    '27/01/2034,Accredito,STIPENDIO,2000.00',
    // febbraio: spese, un prelievo e una spesa non classificata
    '03/02/2034,Pagamento,ESSELUNGA,-200.00',
    '08/02/2034,Pagamento,CARREFOUR,-150.00',
    '12/02/2034,Prelievo,PRELIEVO ATM,-300.00',
    '20/02/2034,Pagamento,NON CLASSIFICATO,-40.00',
    // marzo: una spesa, un prestito, un giroconto e uno stipendio
    '04/03/2034,Pagamento,ESSELUNGA,-80.00',
    '09/03/2034,Pagamento,PRESTITO A MARIO,-500.00',
    '15/03/2034,Pagamento,GIROCONTO,-1000.00',
    '27/03/2034,Accredito,STIPENDIO,2000.00',
  ),
);

setType('PRESTITO A MARIO', 'LOAN');
setType('GIROCONTO', 'TRANSFER');
classify('ESSELUNGA', 'Alimentari');
classify('CARREFOUR', 'Alimentari');
classify('BENZINAIO', 'Carburante');

/** Analisi con i soli criteri indicati: tutto il resto resta senza vincoli. */
const analyze = (query: Partial<typeof ALL_TRANSACTIONS> = {}) =>
  analyticsService.getAnalytics({ ...ALL_TRANSACTIONS, ...query });

const primoTrimestre = { from: '2034-01-01', to: '2034-03-31' };

describe('periodo', () => {
  it('senza limiti considera tutto l\'archivio', () => {
    const analytics = analyze();

    assert.equal(analytics.counts.transactions, 11);
    assert.deepEqual(analytics.period, {
      from: null,
      to: null,
      firstTransactionDate: '2034-01-05',
      lastTransactionDate: '2034-03-27',
    });
  });

  it('un periodo senza movimenti resta coerente in ogni sezione', () => {
    const analytics = analyze({ from: '2034-04-01', to: '2034-04-30' });

    assert.equal(analytics.counts.transactions, 0);
    assert.equal(analytics.overview.expenses, 0);
    assert.equal(analytics.overview.netMovement, 0);
    assert.deepEqual(analytics.byCategory, []);
    assert.deepEqual(analytics.byMerchant, []);
    assert.deepEqual(analytics.timeline.buckets, []);
    assert.equal(analytics.loans.lent, 0);
    assert.equal(analytics.period.firstTransactionDate, null);
  });

  it('un solo giorno seleziona il solo movimento di quel giorno', () => {
    const analytics = analyze({ from: '2034-02-12', to: '2034-02-12' });

    assert.equal(analytics.counts.transactions, 1);
    assert.equal(analytics.overview.withdrawals, -300, 'il solo prelievo del 12 febbraio');
    assert.equal(analytics.timeline.granularity, 'day');
    assert.deepEqual(
      analytics.timeline.buckets.map((b) => b.period),
      ['2034-02-12'],
    );
  });

  it('un mese resta a passo giornaliero, con anche i giorni vuoti', () => {
    const analytics = analyze({ from: '2034-02-01', to: '2034-02-28' });

    assert.equal(analytics.counts.transactions, 4);
    assert.equal(analytics.overview.expenses, 390, '200+150+40, senza il prelievo');
    assert.equal(analytics.timeline.granularity, 'day');

    const periods = analytics.timeline.buckets.map((b) => b.period);
    assert.equal(periods[0], '2034-02-03', 'dal primo movimento');
    assert.equal(periods.at(-1), '2034-02-20', "all'ultimo");
    assert.equal(periods.length, 18);
    assert.ok(periods.includes('2034-02-05'), 'i giorni vuoti interni restano');
    assert.equal(
      analytics.timeline.buckets.find((b) => b.period === '2034-02-05')?.expenses,
      0,
    );
  });

  it('non inventa intervalli che l\'archivio non copre', () => {
    // Il 2034 è chiesto per intero, ma i movimenti finiscono a marzo.
    const analytics = analyze({ from: '2034-01-01', to: '2034-12-31', granularity: 'month' });

    assert.deepEqual(
      analytics.timeline.buckets.map((b) => b.period),
      ['2034-01', '2034-02', '2034-03'],
      'nessuna coda di mesi a zero',
    );
  });

  it('più mesi passano al passo settimanale', () => {
    const analytics = analyze(primoTrimestre);

    assert.equal(analytics.timeline.granularity, 'week');
  });

  it('il passo automatico segue l\'ampiezza di ciò che viene mostrato', () => {
    assert.equal(automaticGranularity('2034-03-01', '2034-03-20'), 'day');
    assert.equal(automaticGranularity('2034-01-01', '2034-02-01'), 'day', 'fino a un mese');
    assert.equal(automaticGranularity('2034-01-01', '2034-02-15'), 'week', 'oltre il mese');
    assert.equal(automaticGranularity('2034-01-01', '2034-06-30'), 'week', 'fino a sei mesi');
    assert.equal(automaticGranularity('2034-01-01', '2034-12-31'), 'month', 'oltre');
  });

  it('gli estremi sono inclusi', () => {
    assert.equal(analyze({ from: '2034-01-05', to: '2034-01-05' }).counts.transactions, 1);
    assert.equal(analyze({ from: '2034-01-06', to: '2034-01-09' }).counts.transactions, 0);
  });

  it('rifiuta un intervallo rovesciato', () => {
    assert.throws(
      () => parseAnalyticsQuery({ from: '2034-03-31', to: '2034-01-01' }),
      /Intervallo non valido/,
    );
  });
});

describe('filtro per tipo', () => {
  it('solo le spese', () => {
    const analytics = analyze({ types: ['EXPENSE'] });

    assert.equal(analytics.counts.transactions, 6);
    assert.equal(analytics.overview.expenses, 620, '100+50+200+150+40+80');
    assert.equal(analytics.overview.income, 0);
    assert.equal(analytics.overview.withdrawals, 0);
  });

  it('solo le entrate', () => {
    const analytics = analyze({ types: ['INCOME'] });

    assert.equal(analytics.overview.income, 4000);
    assert.equal(analytics.overview.expenses, 0);
    assert.deepEqual(analytics.byCategory, [], 'un\'entrata non è una spesa da distribuire');
  });

  it('spese ed entrate insieme', () => {
    const analytics = analyze({ types: ['EXPENSE', 'INCOME'] });

    assert.equal(analytics.counts.transactions, 8);
    assert.equal(analytics.overview.balance, 3380, '4000 - 620');
    assert.equal(analytics.overview.netMovement, 3380);
  });

  it('un prelievo non è una spesa', () => {
    const analytics = analyze({ types: ['WITHDRAWAL'] });

    assert.equal(analytics.overview.expenses, 0);
    assert.equal(analytics.overview.withdrawals, -300, 'conserva il segno: il denaro è uscito');
    assert.deepEqual(analytics.byCategory, []);
  });

  it('un prestito non è una spesa', () => {
    const analytics = analyze({ types: ['LOAN'] });

    assert.equal(analytics.overview.expenses, 0);
    assert.equal(analytics.overview.loans, -500);
    assert.deepEqual(analytics.byCategory, []);
  });

  it('un trasferimento non è una spesa', () => {
    const analytics = analyze({ types: ['TRANSFER'] });

    assert.equal(analytics.overview.expenses, 0);
    assert.equal(analytics.overview.transfers, -1000);
    assert.deepEqual(analytics.byCategory, []);
  });
});

describe('filtro per categoria', () => {
  it('una sola categoria', () => {
    const analytics = analyze({ categoryIds: [categoryId('Alimentari')] });

    assert.equal(analytics.counts.transactions, 4);
    assert.equal(analytics.overview.expenses, 530, '100+200+150+80');
    assert.deepEqual(
      analytics.byCategory.map((c) => [c.name, c.amount, c.percentage]),
      [['Alimentari', 530, 100]],
    );
  });

  it('più categorie insieme', () => {
    const analytics = analyze({
      categoryIds: [categoryId('Alimentari'), categoryId('Carburante')],
    });

    assert.equal(analytics.overview.expenses, 580);
    assert.deepEqual(
      analytics.byCategory.map((c) => c.name),
      ['Alimentari', 'Carburante'],
    );
  });

  it('i movimenti non classificati restano visibili', () => {
    const analytics = analyze({ classification: 'unclassified' });

    assert.equal(analytics.overview.expenses, 40);
    assert.deepEqual(
      analytics.byCategory.map((c) => [c.categoryId, c.name, c.amount]),
      [[null, 'Senza categoria', 40]],
    );
    assert.equal(analytics.counts.categories, 0);
  });

  it('i soli movimenti classificati', () => {
    const analytics = analyze({ classification: 'classified' });

    assert.equal(analytics.counts.transactions, 5);
    assert.equal(analytics.overview.expenses, 580);
    assert.ok(
      analytics.byCategory.every((c) => c.categoryId !== null),
      'nessuna voce senza categoria',
    );
  });
});

describe('filtro per merchant', () => {
  it('un solo merchant', () => {
    const analytics = analyze({ merchantIds: [merchantIdOf('ESSELUNGA')] });

    assert.equal(analytics.counts.transactions, 3);
    assert.equal(analytics.overview.expenses, 380, '100+200+80');
    assert.equal(analytics.counts.merchants, 1);
  });

  it('più merchant insieme', () => {
    const analytics = analyze({
      merchantIds: [merchantIdOf('ESSELUNGA'), merchantIdOf('BENZINAIO')],
    });

    assert.equal(analytics.counts.transactions, 4);
    assert.equal(analytics.overview.expenses, 430);
  });

  it('mostra il nome scelto dall\'utente, non quello della banca', () => {
    const esselunga = merchantIdOf('ESSELUNGA');
    merchantsService.updateDisplayName(esselunga, 'Supermercato');

    try {
      assert.equal(analyze().byMerchant[0]?.name, 'Supermercato');
    } finally {
      merchantsService.updateDisplayName(esselunga, null);
    }

    assert.equal(analyze().byMerchant[0]?.name, 'ESSELUNGA');
  });
});

describe('aggregazioni', () => {
  it('somma entrate, uscite e movimento netto', () => {
    const { overview } = analyze(primoTrimestre);

    assert.deepEqual(overview, {
      income: 4000,
      expenses: 620,
      balance: 3380,
      withdrawals: -300,
      loans: -500,
      transfers: -1000,
      other: 0,
      netMovement: 1580,
    });
  });

  it('conta transazioni, merchant e categorie presenti', () => {
    assert.deepEqual(analyze(primoTrimestre).counts, {
      transactions: 11,
      merchants: 8,
      categories: 2,
    });
  });

  it('ordina le categorie per importo e ne calcola la quota', () => {
    const byCategory = analyze(primoTrimestre).byCategory;

    assert.deepEqual(
      byCategory.map((c) => [c.name, c.amount, c.transactionCount, c.percentage]),
      [
        ['Alimentari', 530, 4, 85.5],
        ['Carburante', 50, 1, 8.1],
        ['Senza categoria', 40, 1, 6.5],
      ],
    );
    assert.equal(
      byCategory.reduce((somma, c) => somma + c.amount, 0),
      620,
      'la distribuzione copre tutte le spese',
    );
  });

  it('ordina i merchant per totale speso', () => {
    assert.deepEqual(
      analyze(primoTrimestre).byMerchant.map((m) => [m.name, m.category, m.amount]),
      [
        ['ESSELUNGA', 'Alimentari', 380],
        ['CARREFOUR', 'Alimentari', 150],
        ['BENZINAIO', 'Carburante', 50],
        ['NON CLASSIFICATO', null, 40],
      ],
    );
  });

  it('distribuisce i movimenti nel tempo', () => {
    const buckets = analyze({ ...primoTrimestre, granularity: 'month' }).timeline.buckets;

    assert.deepEqual(
      buckets.map((b) => [b.period, b.income, b.expenses, b.netMovement]),
      [
        ['2034-01', 2000, 150, 1850],
        ['2034-02', 0, 390, -690],
        ['2034-03', 2000, 80, 420],
      ],
    );
    assert.equal(buckets[1]?.withdrawals, -300);
    assert.equal(buckets[2]?.loans, -500);
    assert.equal(buckets[2]?.transfers, -1000);
    assert.equal(
      buckets.reduce((somma, b) => somma + b.netMovement, 0),
      analyze(primoTrimestre).overview.netMovement,
    );
  });

  it('resta una dashboard: non restituisce l\'elenco dei movimenti', () => {
    assert.ok(
      !Object.hasOwn(analyze(primoTrimestre), 'transactions'),
      'le transazioni si esplorano da /transactions',
    );
  });
});

describe('andamento a passo settimanale', () => {
  const settimanale = () => analyze({ ...primoTrimestre, granularity: 'week' });

  it('la settimana comincia il lunedì', () => {
    // Il 27 marzo 2034 è un lunedì; il 2 marzo un giovedì.
    assert.equal(startOfWeek('2034-03-27'), '2034-03-27');
    assert.equal(startOfWeek('2034-03-02'), '2034-02-27');
    assert.equal(startOfWeek('2034-03-04'), '2034-02-27', 'anche il sabato');
    assert.equal(startOfWeek('2034-03-05'), '2034-02-27', 'e la domenica');
    assert.equal(startOfWeek('2034-03-06'), '2034-03-06');
  });

  it('gli intervalli sono lunedì consecutivi, a sette giorni di distanza', () => {
    const periods = settimanale().timeline.buckets.map((b) => b.period);

    assert.equal(periods[0], startOfWeek('2034-01-05'), 'la settimana del primo movimento');
    assert.equal(periods.at(-1), startOfWeek('2034-03-27'), "e quella dell'ultimo");
    for (let i = 1; i < periods.length; i += 1) {
      const giorni =
        (new Date(`${periods[i]}T00:00:00Z`).getTime() -
          new Date(`${periods[i - 1]}T00:00:00Z`).getTime()) /
        86_400_000;
      assert.equal(giorni, 7, `fra ${periods[i - 1]} e ${periods[i]}`);
    }
  });

  it('ogni movimento cade in una sola settimana e nulla si perde', () => {
    const buckets = settimanale().timeline.buckets;

    assert.equal(
      buckets.reduce((somma, b) => somma + b.expenses, 0),
      620,
      'le spese della settimana sommano a quelle del periodo',
    );
    assert.equal(
      buckets.reduce((somma, b) => somma + b.income, 0),
      4000,
    );
    assert.equal(
      Math.round(buckets.reduce((somma, b) => somma + b.netMovement, 0) * 100) / 100,
      settimanale().overview.netMovement,
    );
  });

  it('mette nella stessa settimana i movimenti vicini', () => {
    // 2 e 4 marzo 2034 cadono nella settimana del 27 febbraio.
    const settimana = settimanale().timeline.buckets.find((b) => b.period === '2034-02-27');

    assert.ok(settimana, 'la settimana del 27 febbraio esiste');
    assert.equal(settimana.expenses, 80, 'la spesa del 4 marzo');
  });

  it('segnala gli intervalli coperti solo in parte', () => {
    const buckets = settimanale().timeline.buckets;

    assert.equal(buckets[0]?.partial, true, 'la prima settimana comincia prima del primo movimento');
    assert.equal(buckets.at(-1)?.partial, true, "l'ultima finisce dopo l'ultimo");
    assert.ok(
      buckets.slice(1, -1).some((b) => !b.partial),
      'le settimane interne sono complete',
    );
  });

  it('a passo giornaliero nessun intervallo è parziale', () => {
    const buckets = analyze({ from: '2034-02-01', to: '2034-02-28' }).timeline.buckets;

    assert.ok(buckets.every((b) => !b.partial));
  });

  it('il passo richiesto vince su quello automatico', () => {
    assert.equal(analyze({ ...primoTrimestre, granularity: 'day' }).timeline.granularity, 'day');
    assert.equal(analyze({ ...primoTrimestre, granularity: 'month' }).timeline.granularity, 'month');
    assert.equal(analyze({ ...primoTrimestre, granularity: null }).timeline.granularity, 'week');
  });

  it('il passo non cambia quali movimenti entrano nel conto', () => {
    for (const granularity of ['day', 'week', 'month'] as const) {
      const analytics = analyze({ ...primoTrimestre, granularity });

      assert.equal(analytics.overview.expenses, 620, granularity);
      assert.equal(analytics.counts.transactions, 11, granularity);
    }
  });

  it('rifiuta un passo che non esiste', () => {
    assert.throws(() => parseAnalyticsQuery({ granularity: 'quindicinale' }), /non riconosciuto/);
    assert.equal(parseAnalyticsQuery({ granularity: 'week' }).granularity, 'week');
    assert.equal(parseAnalyticsQuery({ granularity: 'auto' }).granularity, null);
    assert.equal(parseAnalyticsQuery({}).granularity, null);
  });

  it('con i filtri attivi la spezzata racconta lo stesso insieme', () => {
    const alimentari = analyze({
      ...primoTrimestre,
      granularity: 'week',
      categoryIds: [categoryId('Alimentari')],
    });

    assert.equal(
      alimentari.timeline.buckets.reduce((somma, b) => somma + b.expenses, 0),
      alimentari.overview.expenses,
    );
    assert.equal(alimentari.overview.expenses, 530);
    assert.equal(
      alimentari.timeline.buckets.reduce((somma, b) => somma + b.income, 0),
      0,
      'una categoria di spesa non porta entrate',
    );
  });
});

describe('prestiti', () => {
  it('riporta quanto è stato prestato nel periodo', () => {
    const { loans } = analyze(primoTrimestre);

    assert.equal(loans.lent, 500);
    assert.equal(loans.transactionCount, 1);
    assert.deepEqual(
      loans.entries.map((entry) => [entry.bookingDate, entry.merchant, entry.amount]),
      [['2034-03-09', 'PRESTITO A MARIO', -500]],
    );
  });

  it('il prestito non entra nelle spese né nelle categorie', () => {
    const analytics = analyze(primoTrimestre);

    assert.equal(analytics.overview.expenses, 620);
    assert.ok(!analytics.byMerchant.some((m) => m.name === 'PRESTITO A MARIO'));
  });
});

describe('combinazione di criteri', () => {
  it('periodo, tipo, categoria e merchant insieme restano coerenti', () => {
    const analytics = analyze({
      from: '2034-02-01',
      to: '2034-03-31',
      types: ['EXPENSE'],
      categoryIds: [categoryId('Alimentari')],
      merchantIds: [merchantIdOf('ESSELUNGA')],
    });

    assert.equal(analytics.counts.transactions, 2, 'febbraio 200 e marzo 80');
    assert.equal(analytics.overview.expenses, 280);
    assert.deepEqual(
      analytics.byCategory.map((c) => [c.name, c.amount, c.percentage]),
      [['Alimentari', 280, 100]],
    );
    assert.deepEqual(
      analytics.byMerchant.map((m) => [m.name, m.amount]),
      [['ESSELUNGA', 280]],
    );
    assert.equal(
      analytics.timeline.buckets.reduce((somma, b) => somma + b.expenses, 0),
      280,
      'anche la timeline racconta lo stesso insieme',
    );
  });

  it('criteri incompatibili producono un risultato vuoto ma coerente', () => {
    const analytics = analyze({
      categoryIds: [categoryId('Alimentari')],
      merchantIds: [merchantIdOf('BENZINAIO')],
    });

    assert.equal(analytics.counts.transactions, 0);
    assert.deepEqual(analytics.byCategory, []);
    assert.equal(analytics.overview.expenses, 0);
  });
});

describe('interpretazione dei criteri', () => {
  it('accetta elenchi separati da virgole e parametri ripetuti', () => {
    assert.deepEqual(parseAnalyticsQuery({ types: 'EXPENSE,INCOME' }).types, [
      'EXPENSE',
      'INCOME',
    ]);
    assert.deepEqual(parseAnalyticsQuery({ categoryIds: ['a', 'b,c'] }).categoryIds, [
      'a',
      'b',
      'c',
    ]);
  });

  it('ignora i valori vuoti e i duplicati', () => {
    assert.deepEqual(parseAnalyticsQuery({ merchantIds: 'a,,  ,a,b' }).merchantIds, ['a', 'b']);
    assert.deepEqual(parseAnalyticsQuery({}), ALL_TRANSACTIONS);
  });

  it('rifiuta date, tipi e stati non riconosciuti', () => {
    assert.throws(() => parseAnalyticsQuery({ from: '01/01/2034' }), /formato YYYY-MM-DD/);
    assert.throws(() => parseAnalyticsQuery({ types: 'SPESA' }), /non riconosciuto/);
    assert.throws(() => parseAnalyticsQuery({ classification: 'forse' }), /non riconosciuto/);
  });
});
