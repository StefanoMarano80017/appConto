import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-unclassified-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { sql } = await import('drizzle-orm');
const { closeDatabase, databaseSchema, db, runMigrations } = await import('../../db/client.js');
const { config } = await import('../../config.js');
const { importService } = await import('../import/index.js');
const { DEFAULT_MERCHANT_QUERY, merchantsService } = await import('../merchants/index.js');
const { merchantsRepository } = await import('../merchants/merchants.repository.js');
const { transactionsService } = await import('../transactions/index.js');
const { DEFAULT_QUERY } = await import('../transactions/transaction-query.js');
const { categoriesService, FALLBACK_CATEGORY_ID } = await import('./categories.service.js');

after(() => {
  closeDatabase();
  try {
    rmSync(databaseDir, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

interface VoceJournal {
  readonly idx: number;
  readonly version: string;
  readonly when: number;
  readonly tag: string;
  readonly breakpoints: boolean;
}

const migrazioniReali = config.migrationsFolder;

function journalReale(): VoceJournal[] {
  const letto = JSON.parse(
    readFileSync(path.join(migrazioniReali, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: VoceJournal[] };

  return letto.entries;
}

/**
 * Una copia delle migrazioni reali fino a `0008` compresa: lo schema di un
 * archivio scritto prima che "Da classificare" avesse una sola rappresentazione.
 */
function migrazioniFinoA0008(): string {
  const cartella = path.join(databaseDir, 'migrazioni-0008');
  mkdirSync(path.join(cartella, 'meta'), { recursive: true });

  const voci = journalReale().filter((voce) => voce.idx <= 8);
  for (const voce of voci) {
    copyFileSync(path.join(migrazioniReali, `${voce.tag}.sql`), path.join(cartella, `${voce.tag}.sql`));
  }
  writeFileSync(
    path.join(cartella, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'sqlite', entries: voci }),
    'utf8',
  );

  return cartella;
}

const csv = (...rows: string[]): string => ['Data contabile,Descrizione,Importo', ...rows].join('\r\n');

function merchantIdOf(name: string): string {
  const merchant = merchantsService.listAll().find((m) => m.name === name);
  assert.ok(merchant, `merchant "${name}" non trovato`);
  return merchant.id;
}

function categoryIdOf(merchantId: string): string | null | undefined {
  return merchantsService.listAll().find((m) => m.id === merchantId)?.categoryId;
}

const unclassifiedCount = (): number => merchantsService.search(DEFAULT_MERCHANT_QUERY).counts.unclassified;

// Un archivio alla versione 0008 con un merchant sulla riga reale di
// "Da classificare", come lo lasciava la vecchia eliminazione di una categoria.
runMigrations(migrazioniFinoA0008());
importService.importCsv(csv('03/06/2026,ESERCENTE SUL RIPIEGO,-12.00'));
const merchantSulRipiego = merchantIdOf('ESERCENTE SUL RIPIEGO');
merchantsRepository.updateCategory(merchantSulRipiego, FALLBACK_CATEGORY_ID);

const primaDellaMigrazione = categoryIdOf(merchantSulRipiego);
const versionePrima = databaseSchema();

runMigrations();
const dopoLaPrimaEsecuzione = categoryIdOf(merchantSulRipiego);
const versioneDopoLaPrima = databaseSchema();

runMigrations();
const dopoLaSecondaEsecuzione = categoryIdOf(merchantSulRipiego);
const versioneDopoLaSeconda = databaseSchema();

describe('migrazione 0009: "Da classificare" diventa soltanto null', () => {
  it('riporta a null un merchant che stava sulla riga reale', () => {
    assert.equal(primaDellaMigrazione, FALLBACK_CATEGORY_ID);
    assert.equal(versioneDopoLaPrima.appliedCount, versionePrima.appliedCount + 1);
    assert.equal(dopoLaPrimaEsecuzione, null);
  });

  it('una seconda esecuzione non cambia niente', () => {
    assert.deepEqual(versioneDopoLaSeconda, versioneDopoLaPrima);
    assert.equal(dopoLaSecondaEsecuzione, null);
  });

  it('lo stesso SQL, rieseguito, non tocca nessuna riga', () => {
    const voce = journalReale().find((v) => v.tag.startsWith('0009_'));
    assert.ok(voce, 'la migrazione 0009 deve esistere');
    const testo = readFileSync(path.join(migrazioniReali, `${voce.tag}.sql`), 'utf8');

    let modificate = 0;
    for (const istruzione of testo.split('--> statement-breakpoint')) {
      if (istruzione.replace(/--.*$/gm, '').trim() !== '') {
        modificate += db.run(sql.raw(istruzione)).changes;
      }
    }

    assert.equal(modificate, 0);
    assert.equal(categoryIdOf(merchantSulRipiego), null);
  });

  it('la riga "Da classificare" resta, come etichetta', () => {
    assert.equal(categoriesService.findById(FALLBACK_CATEGORY_ID)?.name, 'Da classificare');
  });
});

describe('eliminazione di una categoria con due merchant', () => {
  it('li riporta entrambi a null, nei conteggi e nel filtro delle transazioni', () => {
    importService.importCsv(
      csv('10/06/2026,ESERCENTE PRIMO,-20.00', '11/06/2026,ESERCENTE SECONDO,-30.00'),
    );
    const primo = merchantIdOf('ESERCENTE PRIMO');
    const secondo = merchantIdOf('ESERCENTE SECONDO');
    const categoria = categoriesService.create({ name: 'Categoria con due merchant', color: null });
    merchantsService.assignCategory(primo, categoria.id);
    merchantsService.assignCategory(secondo, categoria.id);
    const nonClassificatiPrima = unclassifiedCount();

    categoriesService.remove(categoria.id);

    assert.equal(categoryIdOf(primo), null);
    assert.equal(categoryIdOf(secondo), null);
    assert.equal(unclassifiedCount(), nonClassificatiPrima + 2);

    const filtrate = transactionsService.search({
      ...DEFAULT_QUERY,
      merchantIds: [primo, secondo],
      classification: 'unclassified',
    });
    assert.equal(filtrate.total, 2);
  });
});

describe('assegnazione esplicita di "Da classificare"', () => {
  it('assignCategory con FALLBACK_CATEGORY_ID salva null', () => {
    importService.importCsv(csv('15/06/2026,ESERCENTE ASSEGNATO,-8.00'));
    const merchant = merchantIdOf('ESERCENTE ASSEGNATO');
    const categoria = categoriesService.create({ name: 'Categoria di partenza', color: null });
    merchantsService.assignCategory(merchant, categoria.id);

    const risultato = merchantsService.assignCategory(merchant, FALLBACK_CATEGORY_ID);

    assert.equal(risultato.merchant.categoryId, null);
    assert.equal(risultato.category, null);
    assert.equal(categoryIdOf(merchant), null);
  });
});

describe('conteggio della riga "Da classificare" (D3.b)', () => {
  it('merchantCount è il numero di merchant con categoria null', () => {
    const attesi = merchantsService.listAll().filter((m) => m.categoryId === null).length;
    assert.ok(attesi >= 4, 'il file ha già creato almeno quattro merchant non classificati');
    assert.equal(attesi, unclassifiedCount());

    const riga = categoriesService.listAllWithUsage().find((c) => c.id === FALLBACK_CATEGORY_ID);
    assert.ok(riga);
    assert.equal(riga.merchantCount, attesi);
  });

  it('usage della riga "Da classificare" dà lo stesso numero', () => {
    const attesi = merchantsService.listAll().filter((m) => m.categoryId === null).length;

    assert.equal(categoriesService.usage(FALLBACK_CATEGORY_ID), attesi);
  });

  it('le altre categorie contano solo i propri merchant', () => {
    const categoria = categoriesService.create({ name: 'Categoria con un merchant', color: null });
    merchantsService.assignCategory(merchantIdOf('ESERCENTE PRIMO'), categoria.id);

    const riga = categoriesService.listAllWithUsage().find((c) => c.id === categoria.id);
    assert.equal(riga?.merchantCount, 1);
  });
});
