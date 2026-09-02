import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CATEGORY_SEED, CATEGORY_SEED_MIGRATION } from './categories.seed.js';
import type { Category } from './category.model.js';

/**
 * Il seed e la migrazione dicono la stessa cosa.
 *
 * `CATEGORY_SEED` è un duplicato del contenuto di una migrazione, e i duplicati
 * divergono. Questo test legge il file SQL e pretende che i due elenchi
 * coincidano: se qualcuno aggiunge una categoria a uno solo dei due, un
 * archivio azzerato non tornerebbe allo stato del primo avvio — e la differenza
 * si scoprirebbe soltanto usando l'applicazione.
 *
 * Non si legge il database: si leggono i due testi. Il confronto è fra ciò che
 * è scritto, non fra ciò che è stato applicato.
 */

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'drizzle',
);

/**
 * Le righe `('id', 'nome', '#colore')` del file di migrazione.
 *
 * Un'espressione regolare e non un interprete SQL: la forma di quel file è
 * fissa — l'ha scritta drizzle-kit, e la parte del seed è stata scritta a mano
 * una volta — e un interprete completo sarebbe più codice di quello che prova.
 */
function categorieNellaMigrazione(sql: string): Category[] {
  const valori = /\(\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g;
  const trovate: Category[] = [];

  for (const riga of sql.matchAll(valori)) {
    const [, id, name, color] = riga;
    if (id !== undefined && name !== undefined && color !== undefined) {
      trovate.push({ id, name, color });
    }
  }

  return trovate;
}

describe('il seed delle categorie e la migrazione', () => {
  const sql = readFileSync(path.join(migrationsDir, CATEGORY_SEED_MIGRATION), 'utf8');
  const dallaMigrazione = categorieNellaMigrazione(sql);

  it('la migrazione contiene delle categorie da confrontare', () => {
    // Se l'espressione regolare smettesse di riconoscere il formato, il
    // confronto passerebbe confrontando due elenchi vuoti.
    assert.ok(dallaMigrazione.length > 0, 'nessuna categoria estratta dal file di migrazione');
    assert.equal(dallaMigrazione.length, 22);
  });

  it('contengono gli stessi identificativi, nomi e colori, nello stesso ordine', () => {
    assert.deepEqual([...CATEGORY_SEED], dallaMigrazione);
  });

  it('gli identificativi sono univoci', () => {
    const identificativi = new Set(CATEGORY_SEED.map((categoria) => categoria.id));

    assert.equal(identificativi.size, CATEGORY_SEED.length);
  });

  it('i nomi sono univoci', () => {
    // Il vincolo esiste anche nel database: un seed con due nomi uguali
    // fallirebbe all'inserimento, e lo farebbe durante un azzeramento.
    const nomi = new Set(CATEGORY_SEED.map((categoria) => categoria.name));

    assert.equal(nomi.size, CATEGORY_SEED.length);
  });

  it('«Da classificare» esiste, perché l-import la usa come ripiego', () => {
    assert.ok(CATEGORY_SEED.some((categoria) => categoria.name === 'Da classificare'));
  });
});
