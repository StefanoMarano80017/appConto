import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-merchants-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { categoriesService } = await import('../categories/index.js');
const { merchantsService } = await import('./merchants.service.js');
const { toMerchantSummaryDto } = await import('./merchants.dto.js');

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

function summaryOf(name: string) {
  const summary = merchantsService.listSummaries().find((s) => s.merchant.name === name);
  assert.ok(summary, `merchant "${name}" non trovato`);
  return summary;
}

function merchantIdOf(name: string): string {
  return summaryOf(name).merchant.id;
}

function categoryId(name: string): string {
  const category = categoriesService.listAll().find((c) => c.name === name);
  assert.ok(category, `categoria "${name}" non trovata`);
  return category.id;
}

importService.importCsv(
  csv(
    '02/01/2031,BAR CENTRALE,-2.00',
    '05/01/2031,BAR CENTRALE,-3.50',
    '20/03/2031,BAR CENTRALE,-4.50',
    '10/01/2031,SUPERMERCATO,-120.00',
    '11/01/2031,DATORE DI LAVORO,1800.00',
    '12/01/2031,RIMBORSO MISTO,-30.00',
    '13/01/2031,RIMBORSO MISTO,10.00',
  ),
);

describe('aggregazione dei merchant', () => {
  it('conta le transazioni di ogni merchant', () => {
    assert.equal(summaryOf('BAR CENTRALE').transactionCount, 3);
    assert.equal(summaryOf('SUPERMERCATO').transactionCount, 1);
  });

  it('somma solo le uscite nel totale speso', () => {
    assert.equal(summaryOf('BAR CENTRALE').totalSpent, 10);
    assert.equal(
      summaryOf('RIMBORSO MISTO').totalSpent,
      30,
      "l'entrata di 10 € non riduce il totale speso",
    );
    assert.equal(summaryOf('RIMBORSO MISTO').transactionCount, 2);
  });

  it('un merchant con sole entrate ha totale speso zero', () => {
    const datore = summaryOf('DATORE DI LAVORO');
    assert.equal(datore.totalSpent, 0);
    assert.equal(datore.transactionCount, 1);
  });

  it('riporta la data dell\'ultima transazione', () => {
    assert.equal(summaryOf('BAR CENTRALE').lastTransactionDate, '2031-03-20');
    assert.equal(summaryOf('SUPERMERCATO').lastTransactionDate, '2031-01-10');
  });

  it('ordina i merchant dal più speso al meno speso', () => {
    const spesi = merchantsService.listSummaries().map((s) => s.totalSpent);
    assert.deepEqual(spesi, [...spesi].sort((a, b) => b - a));
    assert.equal(merchantsService.listSummaries()[0]?.merchant.name, 'SUPERMERCATO');
  });

  it('espone categoria e totali nel DTO', () => {
    merchantsService.assignCategory(merchantIdOf('BAR CENTRALE'), categoryId('Alimentari'));
    const dto = toMerchantSummaryDto(summaryOf('BAR CENTRALE'));

    assert.equal(dto.category?.name, 'Alimentari');
    assert.equal(dto.transactionCount, 3);
    assert.equal(dto.totalSpent, 10);
    assert.equal(dto.lastTransactionDate, '2031-03-20');
    assert.equal(dto.label, 'BAR CENTRALE', 'senza displayName si mostra il nome della banca');
  });
});

describe('displayName', () => {
  it('parte da null e non altera il nome originale', () => {
    const merchant = summaryOf('SUPERMERCATO').merchant;
    assert.equal(merchant.displayName, null);

    const rinominato = merchantsService.updateDisplayName(merchant.id, '  Esselunga  ');

    assert.equal(rinominato.merchant.displayName, 'Esselunga', 'gli spazi vengono rimossi');
    assert.equal(rinominato.merchant.name, 'SUPERMERCATO', 'il nome della banca resta invariato');
    assert.equal(toMerchantSummaryDto(summaryOf('SUPERMERCATO')).label, 'Esselunga');
  });

  it('è persistente', () => {
    assert.equal(summaryOf('SUPERMERCATO').merchant.displayName, 'Esselunga');
  });

  it('una stringa vuota ripristina il nome della banca', () => {
    const id = merchantIdOf('SUPERMERCATO');
    merchantsService.updateDisplayName(id, '   ');

    assert.equal(summaryOf('SUPERMERCATO').merchant.displayName, null);
    assert.equal(toMerchantSummaryDto(summaryOf('SUPERMERCATO')).label, 'SUPERMERCATO');
  });

  it('non tocca la categoria', () => {
    const id = merchantIdOf('BAR CENTRALE');
    merchantsService.assignCategory(id, categoryId('Bar e caffè'));
    merchantsService.updateDisplayName(id, 'Bar sotto casa');

    const dopo = summaryOf('BAR CENTRALE');
    assert.equal(dopo.category?.name, 'Bar e caffè');
    assert.equal(dopo.merchant.displayName, 'Bar sotto casa');
  });

  it('rifiuta un merchant inesistente', () => {
    assert.throws(() => merchantsService.updateDisplayName('non-esiste', 'X'), /non trovato/);
  });
});

describe('nuovi import', () => {
  it('non azzerano rinomina e categoria del merchant esistente', () => {
    importService.importCsv(csv('25/04/2031,BAR CENTRALE,-1.00'));

    const dopo = summaryOf('BAR CENTRALE');
    assert.equal(dopo.merchant.displayName, 'Bar sotto casa');
    assert.equal(dopo.category?.name, 'Bar e caffè');
    assert.equal(dopo.transactionCount, 4, 'la nuova transazione è conteggiata');
    assert.equal(dopo.totalSpent, 11);
    assert.equal(dopo.lastTransactionDate, '2031-04-25');
  });
});
