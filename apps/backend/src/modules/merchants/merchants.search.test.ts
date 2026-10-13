import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { MerchantQuery } from './merchant-query.js';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-merchants-search-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { categoriesService } = await import('../categories/index.js');
const { transactionsService } = await import('../transactions/index.js');
const { merchantsService } = await import('./merchants.service.js');
const { merchantLabel } = await import('./merchant.model.js');
const { DEFAULT_MERCHANT_QUERY } = await import('./merchant-query.js');

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

function merchantIdOf(name: string): string {
  const summary = merchantsService.listSummaries().find((s) => s.merchant.name === name);
  assert.ok(summary, `merchant "${name}" non trovato`);
  return summary.merchant.id;
}

function categoryId(name: string): string {
  const category = categoriesService.listAll().find((c) => c.name === name);
  assert.ok(category, `categoria "${name}" non trovata`);
  return category.id;
}

// ALFA e BETA hanno 3 transazioni ciascuna (pareggio); GAMMA ne ha 1 ma la più cara;
// DELTA (poi "Caffè Roma") ne ha 2; STIPENDIO ha solo entrate; VUOTO resta senza transazioni.
importService.importCsv(
  csv(
    '02/01/2031,ALFA,-2.00',
    '05/01/2031,ALFA,-3.00',
    '06/01/2031,ALFA,-4.00',
    '03/01/2031,BETA,-10.00',
    '04/01/2031,BETA,-10.00',
    '07/02/2031,BETA,-10.00',
    '10/01/2031,GAMMA,-500.00',
    '11/01/2031,DELTA,-20.00',
    '12/03/2031,DELTA,-25.00',
    '13/01/2031,STIPENDIO,1800.00',
    '14/01/2031,VUOTO,-1.00',
  ),
);
const vuotoId = merchantIdOf('VUOTO');
transactionsService.remove(
  transactionsService
    .listAll()
    .filter((t) => t.merchantId === vuotoId)
    .map((t) => t.id),
  { usagesOf: () => [] },
);
merchantsService.updateDisplayName(merchantIdOf('DELTA'), 'Caffè Roma');
merchantsService.assignCategory(merchantIdOf('DELTA'), categoryId('Alimentari'));

function labels(query: Partial<MerchantQuery>): string[] {
  return merchantsService
    .search({ ...DEFAULT_MERCHANT_QUERY, ...query })
    .summaries.map((s) => merchantLabel(s.merchant));
}

describe('ricerca dei merchant', () => {
  it('di default ordina per numero di transazioni decrescente', () => {
    assert.deepEqual(labels({}).slice(0, 4), ['ALFA', 'BETA', 'Caffè Roma', 'GAMMA']);
  });

  it('a parità di valore ordina per nome crescente', () => {
    // il pareggio si scioglie per nome crescente anche con direzione decrescente
    assert.deepEqual(labels({ sortDirection: 'desc' }).slice(0, 2), ['ALFA', 'BETA']);
    assert.deepEqual(labels({ sortDirection: 'asc' }).slice(-2), ['ALFA', 'BETA']);
  });

  it('ordina per nome senza distinguere maiuscole', () => {
    assert.deepEqual(labels({ sortBy: 'name', sortDirection: 'asc' }), [
      'ALFA',
      'BETA',
      'Caffè Roma',
      'GAMMA',
      'STIPENDIO',
      'VUOTO',
    ]);
    assert.deepEqual(labels({ sortBy: 'name', sortDirection: 'desc' }), [
      'VUOTO',
      'STIPENDIO',
      'GAMMA',
      'Caffè Roma',
      'BETA',
      'ALFA',
    ]);
  });

  it('per categoria i merchant senza categoria restano in fondo in entrambe le direzioni', () => {
    assert.equal(labels({ sortBy: 'category', sortDirection: 'asc' })[0], 'Caffè Roma');
    assert.equal(labels({ sortBy: 'category', sortDirection: 'desc' })[0], 'Caffè Roma');
    assert.deepEqual(labels({ sortBy: 'category', sortDirection: 'asc' }).slice(1), [
      'ALFA',
      'BETA',
      'GAMMA',
      'STIPENDIO',
      'VUOTO',
    ]);
  });

  it('per ultima transazione i null restano in fondo in entrambe le direzioni', () => {
    assert.equal(labels({ sortBy: 'lastTransactionDate', sortDirection: 'asc' }).at(-1), 'VUOTO');
    assert.equal(labels({ sortBy: 'lastTransactionDate', sortDirection: 'desc' }).at(-1), 'VUOTO');
    assert.equal(labels({ sortBy: 'lastTransactionDate', sortDirection: 'desc' })[0], 'Caffè Roma');
    assert.equal(labels({ sortBy: 'lastTransactionDate', sortDirection: 'asc' })[0], 'ALFA');
  });

  it('ordina per totale speso', () => {
    assert.deepEqual(labels({ sortBy: 'totalSpent', sortDirection: 'desc' }).slice(0, 3), [
      'GAMMA',
      'Caffè Roma',
      'BETA',
    ]);
  });

  it('filtra classificati e da classificare', () => {
    assert.deepEqual(labels({ classification: 'classified' }), ['Caffè Roma']);
    assert.equal(labels({ classification: 'unclassified' }).includes('Caffè Roma'), false);
    assert.equal(labels({ classification: 'unclassified' }).length, 5);
  });

  it('cerca nel nome scelto e in quello della banca, senza distinguere maiuscole', () => {
    assert.deepEqual(labels({ search: 'CAFFÈ' }), ['Caffè Roma']);
    assert.deepEqual(labels({ search: 'delta' }), ['Caffè Roma']);
  });

  it("i conteggi riguardano tutto l'archivio e ignorano ricerca e filtro", () => {
    const tutti = merchantsService.search(DEFAULT_MERCHANT_QUERY).counts;
    const filtrati = merchantsService.search({
      ...DEFAULT_MERCHANT_QUERY,
      search: 'alfa',
      classification: 'unclassified',
    }).counts;
    assert.deepEqual(filtrati, tutti);
    assert.deepEqual(tutti, { all: 6, classified: 1, unclassified: 5 });
  });

  it('pagina: total e totalPages contano i risultati filtrati', () => {
    const pagina = merchantsService.search({
      ...DEFAULT_MERCHANT_QUERY,
      classification: 'unclassified',
    });
    assert.equal(pagina.total, 5);
    assert.equal(pagina.totalPages, Math.max(Math.ceil(5 / 25), 1));
  });

  it("una pagina oltre l'ultima restituisce nessuna riga e la paginazione reale", () => {
    const pagina = merchantsService.search({ ...DEFAULT_MERCHANT_QUERY, page: 99 });
    assert.deepEqual(pagina.summaries, []);
    assert.equal(pagina.page, 99);
    assert.equal(pagina.total, 6);
    assert.equal(pagina.totalPages, 1);
  });

  it('nessun risultato: totalPages vale 1', () => {
    const pagina = merchantsService.search({ ...DEFAULT_MERCHANT_QUERY, search: 'zzzz' });
    assert.equal(pagina.total, 0);
    assert.equal(pagina.totalPages, 1);
  });
});
