import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-search-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { categoriesService } = await import('../categories/index.js');
const { merchantsService } = await import('../merchants/index.js');
const { transactionsService } = await import('./transactions.service.js');
const { DEFAULT_QUERY, parseTransactionQuery } = await import('./transaction-query.js');

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

importService.importCsv(
  csv(
    '05/01/2035,Pagamento,AMAZON EU SARL,-25.00',
    '10/01/2035,Pagamento,BENZINAIO IP,-60.50',
    '27/01/2035,Accredito,STIPENDIO GENNAIO,1500.00',
    '03/02/2035,Pagamento,ESSELUNGA MILANO,-120.00',
    '08/02/2035,Pagamento,amazon marketplace,-15.00',
    '12/02/2035,Prelievo,PRELIEVO ATM,-200.00',
    '20/02/2035,Pagamento,NEGOZIO SCONOSCIUTO,-42.00',
    '04/03/2035,Pagamento,ESSELUNGA MILANO,-300.00',
    '09/03/2035,Pagamento,AMZN MKTP IT,-9.99',
    '15/03/2035,Pagamento,BENZINAIO IP,-45.00',
    '27/03/2035,Accredito,STIPENDIO MARZO,1500.00',
    '30/03/2035,Pagamento,LIBRERIA FELTRINELLI,-18.50',
  ),
);

classify('AMAZON EU SARL', 'Shopping');
classify('amazon marketplace', 'Shopping');
classify('ESSELUNGA MILANO', 'Alimentari');
classify('BENZINAIO IP', 'Carburante');
classify('LIBRERIA FELTRINELLI', 'Tempo libero');

/** Ricerca con i soli criteri indicati: tutto il resto resta senza vincoli. */
const search = (query: Partial<typeof DEFAULT_QUERY> = {}) =>
  transactionsService.search({ ...DEFAULT_QUERY, ...query });

const descriptions = (query: Partial<typeof DEFAULT_QUERY> = {}): string[] =>
  search(query).transactions.map(({ transaction }) => transaction.description);

describe('ricerca: nessun filtro', () => {
  it('restituisce la prima pagina, dalla transazione più recente', () => {
    const page = search();

    assert.equal(page.total, 12);
    assert.equal(page.page, 1);
    assert.equal(page.pageSize, 25);
    assert.equal(page.totalPages, 1);
    assert.equal(page.transactions[0]?.transaction.bookingDate, '2035-03-30');
  });

  it('compone ogni transazione con merchant e categoria', () => {
    const entry = search({ merchantIds: [merchantIdOf('ESSELUNGA MILANO')] }).transactions[0];

    assert.equal(entry?.merchant?.merchant.name, 'ESSELUNGA MILANO');
    assert.equal(entry?.merchant?.category?.name, 'Alimentari');
  });
});

describe('ricerca: periodo', () => {
  it('gli estremi sono inclusi', () => {
    assert.equal(search({ from: '2035-02-01', to: '2035-02-28' }).total, 4);
    assert.equal(search({ from: '2035-01-05', to: '2035-01-05' }).total, 1);
  });

  it('solo la data iniziale, solo la finale', () => {
    assert.equal(search({ from: '2035-03-01' }).total, 5);
    assert.equal(search({ to: '2035-01-31' }).total, 3);
  });

  it('un periodo senza movimenti non restituisce nulla', () => {
    const page = search({ from: '2035-06-01', to: '2035-06-30' });

    assert.deepEqual(page.transactions, []);
    assert.equal(page.total, 0);
    assert.equal(page.totalPages, 1, 'resta sempre una pagina, vuota');
  });
});

describe('ricerca: tipo', () => {
  it('un solo tipo', () => {
    assert.equal(search({ types: ['INCOME'] }).total, 2);
    assert.equal(search({ types: ['WITHDRAWAL'] }).total, 1);
  });

  it('più tipi insieme', () => {
    assert.equal(search({ types: ['INCOME', 'WITHDRAWAL'] }).total, 3);
  });
});

describe('ricerca: categoria e classificazione', () => {
  it('una categoria', () => {
    assert.deepEqual(descriptions({ categoryIds: [categoryId('Alimentari')] }), [
      'ESSELUNGA MILANO',
      'ESSELUNGA MILANO',
    ]);
  });

  it('più categorie', () => {
    assert.equal(
      search({ categoryIds: [categoryId('Alimentari'), categoryId('Carburante')] }).total,
      4,
    );
  });

  it('"da classificare" significa categoria assente, non una categoria fittizia', () => {
    const page = search({ classification: 'unclassified' });

    assert.deepEqual(
      page.transactions.map(({ transaction }) => transaction.description).sort(),
      [
        'AMZN MKTP IT',
        'NEGOZIO SCONOSCIUTO',
        'PRELIEVO ATM',
        'STIPENDIO GENNAIO',
        'STIPENDIO MARZO',
      ].sort(),
    );
    assert.ok(
      page.transactions.every(({ merchant }) => merchant?.category == null),
      'nessuna transazione classificata',
    );
  });

  it('"classificati" è il complemento', () => {
    assert.equal(search({ classification: 'classified' }).total, 7);
    assert.equal(
      search({ classification: 'classified' }).total + search({ classification: 'unclassified' }).total,
      search().total,
    );
  });

  it('categoria e classificazione insieme si intersecano', () => {
    assert.equal(
      search({ categoryIds: [categoryId('Alimentari')], classification: 'classified' }).total,
      2,
    );
    assert.equal(
      search({ categoryIds: [categoryId('Alimentari')], classification: 'unclassified' }).total,
      0,
      'una categoria scelta e "da classificare" non possono valere insieme',
    );
  });
});

describe('ricerca: merchant', () => {
  it('un merchant', () => {
    assert.equal(search({ merchantIds: [merchantIdOf('BENZINAIO IP')] }).total, 2);
  });

  it('più merchant', () => {
    assert.equal(
      search({
        merchantIds: [merchantIdOf('BENZINAIO IP'), merchantIdOf('AMAZON EU SARL')],
      }).total,
      3,
    );
  });
});

describe('ricerca: importo', () => {
  it('minimo e massimo lavorano sul valore assoluto', () => {
    assert.equal(search({ minAmountCents: 100000 }).total, 2, 'i due stipendi da 1500');
    assert.deepEqual(descriptions({ minAmountCents: 25000, maxAmountCents: 35000 }), [
      'ESSELUNGA MILANO',
    ]);
  });

  it('un intervallo che non contiene nulla', () => {
    assert.equal(search({ minAmountCents: 500000 }).total, 0);
  });

  it('il massimo comprende gli importi esatti', () => {
    assert.equal(search({ maxAmountCents: 999 }).total, 1, 'AMZN MKTP IT da 9,99');
  });
});

describe('ricerca testuale', () => {
  it('non distingue maiuscole e minuscole', () => {
    assert.equal(search({ search: 'amazon' }).total, search({ search: 'AMAZON' }).total);
    assert.equal(search({ search: 'AmAzOn' }).total, 2);
  });

  it('cerca nella descrizione della banca', () => {
    assert.deepEqual(descriptions({ search: 'feltrinelli' }), ['LIBRERIA FELTRINELLI']);
  });

  it('cerca anche nel nome del merchant scelto dall\'utente', () => {
    const amzn = merchantIdOf('AMZN MKTP IT');
    merchantsService.updateDisplayName(amzn, 'Amazon Marketplace IT');

    try {
      const trovate = descriptions({ search: 'amazon' });

      assert.equal(trovate.length, 3, 'ora anche AMZN risponde a "amazon"');
      assert.ok(trovate.includes('AMZN MKTP IT'));
    } finally {
      merchantsService.updateDisplayName(amzn, null);
    }

    assert.equal(search({ search: 'amazon' }).total, 2, 'tolto il nome, torna com\'era');
  });

  it('i caratteri jolly vengono cercati alla lettera', () => {
    // Dati propri in un periodo che nessun altro test usa, tolti a fine test.
    importService.importCsv(
      csv(
        '05/01/2036,Pagamento,SCONTO 100%,-10.00',
        '06/01/2036,Pagamento,IMPORTO 1000,-20.00',
        '07/01/2036,Pagamento,COD_A1,-30.00',
      ),
    );
    const periodo = { from: '2036-01-01', to: '2036-01-31' } as const;

    try {
      assert.deepEqual(descriptions({ ...periodo, search: '100%' }), ['SCONTO 100%']);
      assert.deepEqual(descriptions({ ...periodo, search: '_' }), ['COD_A1']);
      assert.deepEqual(descriptions({ ...periodo, search: '1000' }), ['IMPORTO 1000']);
    } finally {
      const daEliminare = search(periodo).transactions.map(({ transaction }) => transaction.id);
      transactionsService.remove(daEliminare, { usagesOf: () => [] });
    }

    assert.equal(search().total, 12, 'tolti i dati del test, il resto è com\'era');
  });

  it('si combina con gli altri criteri', () => {
    assert.equal(search({ search: 'amazon', categoryIds: [categoryId('Shopping')] }).total, 2);
    assert.equal(search({ search: 'amazon', types: ['INCOME'] }).total, 0);
  });
});

describe('ordinamento', () => {
  it('per data, nei due versi', () => {
    assert.equal(search({ sortBy: 'bookingDate', sortDirection: 'asc' }).transactions[0]?.transaction.bookingDate, '2035-01-05');
    assert.equal(search({ sortBy: 'bookingDate', sortDirection: 'desc' }).transactions[0]?.transaction.bookingDate, '2035-03-30');
  });

  it('per importo, nei due versi', () => {
    assert.equal(search({ sortBy: 'amount', sortDirection: 'asc' }).transactions[0]?.transaction.amount, -300);
    assert.equal(search({ sortBy: 'amount', sortDirection: 'desc' }).transactions[0]?.transaction.amount, 1500);
  });

  it('per merchant, usando il nome mostrato', () => {
    const primo = search({ sortBy: 'merchant', sortDirection: 'asc' }).transactions[0];

    assert.equal(primo?.merchant?.merchant.name, 'AMAZON EU SARL');
  });

  it('per categoria', () => {
    const primo = search({
      sortBy: 'category',
      sortDirection: 'asc',
      classification: 'classified',
    }).transactions[0];

    assert.equal(primo?.merchant?.category?.name, 'Alimentari');
  });

  it('per tipo', () => {
    const primo = search({ sortBy: 'type', sortDirection: 'asc' }).transactions[0];

    assert.equal(primo?.transaction.type, 'EXPENSE');
  });

  it('un campo non ordinabile viene rifiutato', () => {
    assert.throws(() => parseTransactionQuery({ sortBy: 'description' }), /non consentito/);
    assert.throws(() => parseTransactionQuery({ sortDirection: 'su' }), /asc/);
  });
});

describe('paginazione', () => {
  const perPagina = { pageSize: 5 as const };

  it('prima pagina', () => {
    const page = search({ ...perPagina, page: 1 });

    assert.equal(page.transactions.length, 5);
    assert.equal(page.page, 1);
    assert.equal(page.total, 12);
    assert.equal(page.totalPages, 3);
  });

  it('pagina centrale e ultima pagina non si sovrappongono', () => {
    const prima = descriptions({ ...perPagina, page: 1 });
    const seconda = descriptions({ ...perPagina, page: 2 });
    const terza = descriptions({ ...perPagina, page: 3 });

    assert.equal(terza.length, 2, 'le ultime due transazioni');
    assert.equal(new Set([...prima, ...seconda, ...terza]).size <= 12, true);
    assert.deepEqual(
      [...prima, ...seconda, ...terza],
      descriptions({ pageSize: 25 }),
      'le tre pagine ricompongono esattamente l\'elenco completo',
    );
  });

  it('una pagina oltre l\'ultima riporta all\'ultima invece di restare vuota', () => {
    const page = search({ ...perPagina, page: 99 });

    assert.equal(page.page, 3);
    assert.equal(page.transactions.length, 2);
  });

  it('il conteggio non dipende dalla pagina', () => {
    assert.equal(search({ ...perPagina, page: 2 }).total, 12);
  });

  it('cambiare la dimensione cambia il numero di pagine', () => {
    assert.equal(search({ pageSize: 25 }).totalPages, 1);
    assert.equal(search({ pageSize: 5 }).totalPages, 3);
  });

  it('un insieme vuoto resta paginato in modo coerente', () => {
    const page = search({ search: 'inesistente', pageSize: 5, page: 3 });

    assert.deepEqual(page.transactions, []);
    assert.equal(page.total, 0);
    assert.equal(page.totalPages, 1);
    assert.equal(page.page, 1);
  });
});

describe('combinazione di criteri', () => {
  it('periodo, tipo, categoria, merchant e importo insieme', () => {
    const page = search({
      from: '2035-03-01',
      to: '2035-03-31',
      types: ['EXPENSE'],
      categoryIds: [categoryId('Alimentari')],
      merchantIds: [merchantIdOf('ESSELUNGA MILANO')],
      minAmountCents: 10000,
    });

    assert.equal(page.total, 1);
    assert.equal(page.transactions[0]?.transaction.amount, -300);
  });

  it('criteri incompatibili non restituiscono nulla', () => {
    assert.equal(
      search({
        categoryIds: [categoryId('Alimentari')],
        merchantIds: [merchantIdOf('BENZINAIO IP')],
      }).total,
      0,
    );
  });
});

describe('interpretazione dei criteri', () => {
  it('senza parametri vale la query predefinita', () => {
    assert.deepEqual(parseTransactionQuery({}), DEFAULT_QUERY);
  });

  it('accetta elenchi separati da virgole, ignorando vuoti e duplicati', () => {
    assert.deepEqual(parseTransactionQuery({ types: 'EXPENSE,INCOME,EXPENSE' }).types, [
      'EXPENSE',
      'INCOME',
    ]);
    assert.deepEqual(parseTransactionQuery({ merchantIds: ['a', 'b,,a'] }).merchantIds, ['a', 'b']);
  });

  it('converte gli importi da euro a centesimi', () => {
    assert.equal(parseTransactionQuery({ minAmount: '12.34' }).minAmountCents, 1234);
    assert.equal(parseTransactionQuery({ maxAmount: '99,50' }).maxAmountCents, 9950);
  });

  it('una ricerca vuota equivale a nessuna ricerca', () => {
    assert.equal(parseTransactionQuery({ search: '   ' }).search, null);
  });

  it('rifiuta i parametri malformati', () => {
    assert.throws(() => parseTransactionQuery({ from: '31/12/2035' }), /YYYY-MM-DD/);
    assert.throws(() => parseTransactionQuery({ from: '2035-12-31', to: '2035-01-01' }), /Intervallo non valido/);
    assert.throws(() => parseTransactionQuery({ types: 'SPESA' }), /non riconosciuto/);
    assert.throws(() => parseTransactionQuery({ classification: 'boh' }), /non riconosciuto/);
    assert.throws(() => parseTransactionQuery({ page: '0' }), /intero positivo/);
    assert.throws(() => parseTransactionQuery({ pageSize: '7' }), /25, 50, 100/);
    assert.throws(() => parseTransactionQuery({ minAmount: '-5' }), /non negativo/);
    assert.throws(() => parseTransactionQuery({ minAmount: '50', maxAmount: '10' }), /il minimo supera/);
  });
});

describe('ricerca e ordinamento con le lettere accentate', () => {
  // SQLite porta in minuscolo solo l'ASCII: «CAFFÈ» resterebbe «cafFÈ».
  // Dati propri in un periodo che nessun altro test usa, tolti a fine test.
  const periodo = { from: '2037-01-01', to: '2037-01-31' } as const;
  // «CAFFÈ B» e «caffè a»: il lower() di SQLite li ordinerebbe al contrario (F maiuscola prima di f).
  const DA_ORDINARE = ['ZETA', 'alfa', 'Cassa', 'CAFFÈ B', 'caffè a'];

  function conDatiProvvisori(verifica: () => void): void {
    importService.importCsv(
      csv(
        '05/01/2037,Pagamento,ZETA,-10.00',
        '06/01/2037,Pagamento,alfa,-20.00',
        '07/01/2037,Pagamento,Cassa,-30.00',
        '08/01/2037,Pagamento,CAFFÈ ROMA,-40.00',
        '09/01/2037,Pagamento,CAFFÈ B,-50.00',
        '10/01/2037,Pagamento,caffè a,-60.00',
      ),
    );

    try {
      verifica();
    } finally {
      const daEliminare = search(periodo).transactions.map(({ transaction }) => transaction.id);
      transactionsService.remove(daEliminare, { usagesOf: () => [] });
    }

    assert.equal(search().total, 12, 'tolti i dati del test, il resto è com\'era');
  }

  it('cercare in minuscolo trova il testo scritto in maiuscolo', () => {
    conDatiProvvisori(() => {
      const attese = ['CAFFÈ B', 'CAFFÈ ROMA', 'caffè a'];

      assert.deepEqual(descriptions({ ...periodo, search: 'caffè' }).sort(), attese);
      assert.deepEqual(descriptions({ ...periodo, search: 'CAFFÈ' }).sort(), attese);
      assert.deepEqual(descriptions({ ...periodo, search: 'caffè ro' }), ['CAFFÈ ROMA']);
    });
  });

  it('ordinando per merchant le minuscole non vengono dopo le maiuscole', () => {
    conDatiProvvisori(() => {
      const merchantIds = DA_ORDINARE.map(merchantIdOf);
      const nomi = search({ ...periodo, merchantIds, sortBy: 'merchant', sortDirection: 'asc' })
        .transactions.map(({ merchant }) => merchant?.merchant.name);

      assert.deepEqual(nomi, ['alfa', 'caffè a', 'CAFFÈ B', 'Cassa', 'ZETA']);
    });
  });

  it('ordinando per categoria le minuscole non vengono dopo le maiuscole', () => {
    conDatiProvvisori(() => {
      for (const nome of DA_ORDINARE) {
        const categoria = categoriesService.create({ name: `${nome} cat`, color: null });
        merchantsService.assignCategory(merchantIdOf(nome), categoria.id);
      }
      const nomi = search({ ...periodo, classification: 'classified', sortBy: 'category', sortDirection: 'asc' })
        .transactions.map(({ merchant }) => merchant?.category?.name);

      assert.deepEqual(nomi, ['alfa cat', 'caffè a cat', 'CAFFÈ B cat', 'Cassa cat', 'ZETA cat']);
    });
  });
});

describe('ricerca senza distinguere gli accenti', () => {
  // La ricerca ignora maiuscole e accenti, da entrambi i lati: è `fold_search`.
  // Dati propri in un periodo che nessun altro test usa, tolti a fine test.
  const periodo = { from: '2038-01-01', to: '2038-01-31' } as const;

  function conDatiProvvisori(verifica: () => void): void {
    importService.importCsv(
      csv(
        '05/01/2038,Pagamento,CAFFÈ ROMA,-10.00',
        '06/01/2038,Pagamento,caffe bar,-20.00',
        '07/01/2038,Pagamento,PERCHÉ NO,-30.00',
        '08/01/2038,Pagamento,SCONTO 100%,-40.00',
        '09/01/2038,Pagamento,COD_A1,-50.00',
        '10/01/2038,Pagamento,IMPORTO 1000,-60.00',
      ),
    );

    try {
      verifica();
    } finally {
      const daEliminare = search(periodo).transactions.map(({ transaction }) => transaction.id);
      transactionsService.remove(daEliminare, { usagesOf: () => [] });
    }

    assert.equal(search().total, 12, 'tolti i dati del test, il resto è com\'era');
  }

  it('il termine senza accento trova il testo accentato', () => {
    conDatiProvvisori(() => {
      assert.deepEqual(descriptions({ ...periodo, search: 'caffe roma' }), ['CAFFÈ ROMA']);
      assert.deepEqual(descriptions({ ...periodo, search: 'perche' }), ['PERCHÉ NO']);
    });
  });

  it('il termine accentato trova il testo senza accento, in qualunque combinazione di maiuscole', () => {
    conDatiProvvisori(() => {
      const attese = ['CAFFÈ ROMA', 'caffe bar'];

      assert.deepEqual(descriptions({ ...periodo, search: 'caffe' }).sort(), attese);
      assert.deepEqual(descriptions({ ...periodo, search: 'caffè' }).sort(), attese);
      assert.deepEqual(descriptions({ ...periodo, search: 'CAFFÈ' }).sort(), attese);
      assert.deepEqual(descriptions({ ...periodo, search: 'PERCHE' }), ['PERCHÉ NO']);
    });
  });

  it('vale anche per il nome del merchant scelto dall\'utente', () => {
    conDatiProvvisori(() => {
      merchantsService.updateDisplayName(merchantIdOf('SCONTO 100%'), 'Perché Sì');

      assert.deepEqual(descriptions({ ...periodo, search: 'perche si' }), ['SCONTO 100%']);
    });
  });

  it('i caratteri jolly restano letterali anche dopo la normalizzazione', () => {
    conDatiProvvisori(() => {
      assert.deepEqual(descriptions({ ...periodo, search: '100%' }), ['SCONTO 100%']);
      assert.deepEqual(descriptions({ ...periodo, search: '_' }), ['COD_A1']);
      assert.deepEqual(descriptions({ ...periodo, search: '1000' }), ['IMPORTO 1000']);
      assert.deepEqual(descriptions({ ...periodo, search: 'caffè%' }), [], '% non è un jolly');
    });
  });

  it('l\'ordinamento non cambia: resta su lower_unicode, gli accenti contano', () => {
    conDatiProvvisori(() => {
      const nomi = search({ ...periodo, search: 'caff', sortBy: 'merchant', sortDirection: 'asc' })
        .transactions.map(({ merchant }) => merchant?.merchant.name);

      assert.deepEqual(nomi, ['caffe bar', 'CAFFÈ ROMA']);
    });
  });
});
