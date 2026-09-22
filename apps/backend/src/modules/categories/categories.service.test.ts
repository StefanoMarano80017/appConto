import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-categories-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { merchantsService } = await import('../merchants/index.js');
const { categoriesService, FALLBACK_CATEGORY_ID } = await import('./categories.service.js');
const { ConflictError, NotFoundError, ValidationError } = await import('../../shared/errors.js');

runMigrations();

after(() => {
  try {
    rmSync(databaseDir, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

describe('creazione di una categoria', () => {
  it('crea una categoria con un id nuovo', () => {
    const categoria = categoriesService.create({ name: 'Categoria di prova', color: '#123456' });

    assert.ok(categoria.id.length > 0);
    assert.equal(categoria.name, 'Categoria di prova');
    assert.equal(categoria.color, '#123456');
  });

  it('accetta un colore nullo', () => {
    const categoria = categoriesService.create({ name: 'Senza colore', color: null });

    assert.equal(categoria.color, null);
  });

  it('rifiuta un nome già esistente', () => {
    categoriesService.create({ name: 'Doppione', color: null });

    assert.throws(
      () => categoriesService.create({ name: 'Doppione', color: null }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictError);
        return true;
      },
    );
  });

  it('rifiuta un nome vuoto o fatto di soli spazi', () => {
    for (const name of ['', '   ']) {
      assert.throws(
        () => categoriesService.create({ name, color: null }),
        (error: unknown) => {
          assert.ok(error instanceof ValidationError);
          return true;
        },
      );
    }
  });
});

importService.importCsv(
  ['Data contabile,Descrizione,Importo', '01/05/2026,ESERCENTE DI PROVA,-10.00'].join('\r\n'),
);

describe('categorie con il numero di merchant assegnati', () => {
  it('conta zero merchant per una categoria appena creata', () => {
    const categoria = categoriesService.create({ name: 'Categoria vuota', color: null });

    const trovata = categoriesService.listAllWithUsage().find((c) => c.id === categoria.id);
    assert.ok(trovata);
    assert.equal(trovata.merchantCount, 0);
  });

  it('conta i merchant assegnati', () => {
    const categoria = categoriesService.create({ name: 'Categoria con merchant', color: null });
    const merchant = merchantsService.listAll().find((m) => m.name === 'ESERCENTE DI PROVA');
    assert.ok(merchant);
    merchantsService.assignCategory(merchant.id, categoria.id);

    const trovata = categoriesService.listAllWithUsage().find((c) => c.id === categoria.id);
    assert.ok(trovata);
    assert.equal(trovata.merchantCount, 1);
  });
});

describe('utilizzo di una categoria', () => {
  it('restituisce zero per una categoria non assegnata a nessun merchant', () => {
    const categoria = categoriesService.create({ name: 'Categoria isolata', color: null });

    assert.equal(categoriesService.usage(categoria.id), 0);
  });

  it('lancia NotFoundError per un id inesistente', () => {
    assert.throws(
      () => categoriesService.usage('id-che-non-esiste'),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundError);
        return true;
      },
    );
  });
});
