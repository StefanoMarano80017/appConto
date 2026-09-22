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

describe('modifica di una categoria', () => {
  it('rinomina e cambia colore', () => {
    const categoria = categoriesService.create({ name: 'Da rinominare', color: '#111111' });

    const aggiornata = categoriesService.update(categoria.id, { name: 'Rinominata', color: '#222222' });

    assert.equal(aggiornata.name, 'Rinominata');
    assert.equal(aggiornata.color, '#222222');
  });

  it('non protesta se il nome resta lo stesso', () => {
    const categoria = categoriesService.create({ name: 'Nome stabile', color: null });

    const aggiornata = categoriesService.update(categoria.id, { name: 'Nome stabile', color: '#333333' });

    assert.equal(aggiornata.name, 'Nome stabile');
    assert.equal(aggiornata.color, '#333333');
  });

  it('rifiuta un nome già usato da un-altra categoria', () => {
    categoriesService.create({ name: 'Prima', color: null });
    const seconda = categoriesService.create({ name: 'Seconda', color: null });

    assert.throws(
      () => categoriesService.update(seconda.id, { name: 'Prima' }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictError);
        return true;
      },
    );
  });

  it('rifiuta un nome vuoto', () => {
    const categoria = categoriesService.create({ name: 'Nome da svuotare', color: null });

    assert.throws(
      () => categoriesService.update(categoria.id, { name: '   ' }),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        return true;
      },
    );
  });

  it('non permette di rinominare «Da classificare»', () => {
    assert.throws(
      () => categoriesService.update(FALLBACK_CATEGORY_ID, { name: 'Nuovo nome' }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictError);
        return true;
      },
    );
  });

  it('permette di cambiare il colore di «Da classificare»', () => {
    const aggiornata = categoriesService.update(FALLBACK_CATEGORY_ID, { color: '#abcdef' });

    assert.equal(aggiornata.color, '#abcdef');
    assert.equal(aggiornata.name, 'Da classificare');
  });

  it('lancia NotFoundError per un id inesistente', () => {
    assert.throws(
      () => categoriesService.update('id-che-non-esiste', { name: 'X' }),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundError);
        return true;
      },
    );
  });
});

describe('eliminazione di una categoria', () => {
  it('elimina una categoria senza merchant assegnati', () => {
    const categoria = categoriesService.create({ name: 'Da eliminare', color: null });

    categoriesService.remove(categoria.id);

    assert.equal(categoriesService.findById(categoria.id), null);
  });

  it('riassegna a «Da classificare» i merchant della categoria eliminata', () => {
    const categoria = categoriesService.create({ name: 'Con merchant da riassegnare', color: null });
    importService.importCsv(
      ['Data contabile,Descrizione,Importo', '02/05/2026,ESERCENTE RIASSEGNATO,-5.00'].join('\r\n'),
    );
    const merchant = merchantsService.listAll().find((m) => m.name === 'ESERCENTE RIASSEGNATO');
    assert.ok(merchant);
    merchantsService.assignCategory(merchant.id, categoria.id);

    categoriesService.remove(categoria.id);

    const aggiornato = merchantsService.listAll().find((m) => m.id === merchant.id);
    assert.equal(aggiornato?.categoryId, FALLBACK_CATEGORY_ID);
    assert.equal(categoriesService.findById(categoria.id), null);
  });

  it('non permette di eliminare «Da classificare»', () => {
    assert.throws(
      () => categoriesService.remove(FALLBACK_CATEGORY_ID),
      (error: unknown) => {
        assert.ok(error instanceof ConflictError);
        return true;
      },
    );
  });

  it('lancia NotFoundError per un id inesistente', () => {
    assert.throws(
      () => categoriesService.remove('id-che-non-esiste'),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundError);
        return true;
      },
    );
  });
});
