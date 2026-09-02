import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { NATIVE_BINDING_FILE } from '../paths.js';
import { openSqlite } from './sqlite.js';

/**
 * L'invariante che protegge il package.
 *
 * Nel package `better-sqlite3` è inlinato nel bundle e il suo binario nativo
 * sta in `native/`: va indicato per percorso, e va indicato **ogni volta** che
 * si apre un file. Durante WP-P4 questo era vero solo per la connessione
 * principale, e nel package funzionavano le query mentre falliva ogni backup —
 * perché la verifica di un backup apre un secondo database.
 *
 * Il difetto è stato trovato provando il package. Questo test lo trova prima,
 * leggendo il codice: è un controllo statico, costa millisecondi, e non
 * richiede di confezionare niente.
 */

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Ogni file `.ts` di produzione sotto `src/`, esclusi i test. */
function sorgentiDiProduzione(dir: string): string[] {
  const trovati: string[] = [];

  for (const voce of readdirSync(dir, { withFileTypes: true })) {
    const assoluto = path.join(dir, voce.name);
    if (voce.isDirectory()) {
      trovati.push(...sorgentiDiProduzione(assoluto));
    } else if (voce.name.endsWith('.ts') && !voce.name.endsWith('.test.ts')) {
      trovati.push(assoluto);
    }
  }

  return trovati;
}

describe('un solo punto apre i file SQLite', () => {
  it('nessun `new Database(` nel codice di produzione fuori da db/sqlite.ts', () => {
    const consentito = path.join(srcDir, 'db', 'sqlite.ts');
    const trasgressori: string[] = [];

    for (const file of sorgentiDiProduzione(srcDir)) {
      if (path.resolve(file) === path.resolve(consentito)) {
        continue;
      }

      const righe = readFileSync(file, 'utf8').split('\n');
      righe.forEach((riga, indice) => {
        if (/\bnew Database\s*\(/.test(riga)) {
          trasgressori.push(`${path.relative(srcDir, file)}:${String(indice + 1)}`);
        }
      });
    }

    assert.deepEqual(
      trasgressori,
      [],
      `usa openSqlite() invece di new Database(): nel package il binario nativo va indicato. Punti da correggere: ${trasgressori.join(', ')}`,
    );
  });

  it('db/sqlite.ts è l-unico a importare better-sqlite3 come valore', () => {
    // Un `import type` è innocuo: non carica niente. Un import di valore
    // significa che quel modulo può costruire una connessione.
    const conValore: string[] = [];

    for (const file of sorgentiDiProduzione(srcDir)) {
      const testo = readFileSync(file, 'utf8');
      if (/^import\s+(?!type\s)[^;]*from\s+'better-sqlite3'/m.test(testo)) {
        conValore.push(path.relative(srcDir, file));
      }
    }

    assert.deepEqual(conValore, [path.join('db', 'sqlite.ts')]);
  });
});

describe('apertura di un database', () => {
  it('in sviluppo non impone nessun percorso al binario', () => {
    // I test girano dai sorgenti: `native/` non esiste e la libreria si
    // risolve da sé, come ha sempre fatto.
    assert.equal(NATIVE_BINDING_FILE, null);
  });

  it('apre un database in memoria senza opzioni', () => {
    const sqlite = openSqlite(':memory:');

    try {
      sqlite.exec('create table t (v text)');
      sqlite.prepare('insert into t (v) values (?)').run('ok');

      assert.equal((sqlite.prepare('select count(*) as c from t').get() as { c: number }).c, 1);
    } finally {
      sqlite.close();
    }
  });

  it('rispetta le opzioni che riceve', () => {
    assert.throws(
      () => openSqlite(path.join(srcDir, 'non-esiste.sqlite'), { fileMustExist: true }),
      /unable to open database file|does not exist/i,
    );
  });
});
