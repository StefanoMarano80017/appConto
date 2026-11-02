import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { sql } from 'drizzle-orm';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-constraints-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'constraints-test.db');

const { atomically, closeDatabase, db, runMigrations, vacuum } = await import('./client.js');

runMigrations();

after(() => {
  closeDatabase();
  try {
    rmSync(databaseDir, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

/**
 * I vincoli che il database garantisce da solo, a prescindere dai servizi.
 *
 * Si scrive con SQL diretto di proposito: un servizio potrebbe validare prima
 * e nascondere un vincolo mancante, mentre qui interessa che sia il database
 * a rifiutare la riga.
 */

const DATA = '2026-01-15';
const ORA = '2026-01-15T10:00:00.000Z';

function inserisciMovimento(id: string, fingerprint: string | null = null): void {
  db.run(sql`INSERT INTO transactions (id, booking_date, description, amount_cents, fingerprint)
    VALUES (${id}, ${DATA}, ${'Movimento di prova'}, ${-1000}, ${fingerprint})`);
}

function inserisciPrestito(id: string, transactionId: string): void {
  db.run(sql`INSERT INTO loans (id, transaction_id, borrower_name, amount_cents, lent_at, created_at)
    VALUES (${id}, ${transactionId}, ${'Mario'}, ${1000}, ${DATA}, ${ORA})`);
}

/** Il codice di errore di better-sqlite3, anche quando Drizzle avvolge l'eccezione. */
function codiceErrore(errore: unknown): string | undefined {
  let corrente: unknown = errore;
  while (typeof corrente === 'object' && corrente !== null) {
    const { code, cause } = corrente as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && code.startsWith('SQLITE_')) {
      return code;
    }
    corrente = cause;
  }

  return undefined;
}

function assertCodice(lavoro: () => void, atteso: string): void {
  assert.throws(lavoro, (errore: unknown) => {
    assert.equal(codiceErrore(errore), atteso);

    return true;
  });
}

const conta = (tabella: string): number =>
  db.get<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM ${tabella}`)).n;

describe('chiavi esterne', () => {
  it('PRAGMA foreign_keys vale 1 sulla connessione dell\'applicazione', () => {
    const riga = db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`);

    assert.equal(riga.foreign_keys, 1);
  });

  it('un prestito con transaction_id inesistente viene rifiutato', () => {
    assertCodice(() => {
      inserisciPrestito('prestito-orfano', 'movimento-inesistente');
    }, 'SQLITE_CONSTRAINT_FOREIGNKEY');
  });

  it('non si elimina un movimento che ha un prestito', () => {
    inserisciMovimento('mov-con-prestito');
    inserisciPrestito('prestito-1', 'mov-con-prestito');

    assertCodice(() => {
      db.run(sql`DELETE FROM transactions WHERE id = ${'mov-con-prestito'}`);
    }, 'SQLITE_CONSTRAINT_FOREIGNKEY');
    assert.equal(conta('transactions WHERE id = \'mov-con-prestito\''), 1);
  });
});

describe('indici unici', () => {
  it('merchants.normalized_name non ammette duplicati', () => {
    db.run(sql`INSERT INTO merchants (id, name, normalized_name) VALUES (${'m1'}, ${'Bar Roma'}, ${'bar roma'})`);

    assertCodice(() => {
      db.run(sql`INSERT INTO merchants (id, name, normalized_name) VALUES (${'m2'}, ${'BAR ROMA'}, ${'bar roma'})`);
    }, 'SQLITE_CONSTRAINT_UNIQUE');
  });

  it('categories.name non ammette duplicati', () => {
    db.run(sql`INSERT INTO categories (id, name) VALUES (${'c1'}, ${'Categoria di prova'})`);

    assertCodice(() => {
      db.run(sql`INSERT INTO categories (id, name) VALUES (${'c2'}, ${'Categoria di prova'})`);
    }, 'SQLITE_CONSTRAINT_UNIQUE');
  });

  it('transactions.fingerprint non ammette duplicati', () => {
    inserisciMovimento('f1', 'impronta-uguale');

    assertCodice(() => {
      inserisciMovimento('f2', 'impronta-uguale');
    }, 'SQLITE_CONSTRAINT_UNIQUE');
  });

  it('transactions.fingerprint ammette più valori NULL', () => {
    inserisciMovimento('n1', null);
    inserisciMovimento('n2', null);

    assert.equal(conta('transactions WHERE id IN (\'n1\', \'n2\')'), 2);
  });
});

describe('atomically annidato', () => {
  it('un errore catturato dentro annulla solo la parte interna', () => {
    atomically(() => {
      inserisciMovimento('esterno-1');
      try {
        atomically(() => {
          inserisciMovimento('interno-1');
          throw new Error('guasto interno');
        });
      } catch {
        // l'errore è gestito qui: la transazione esterna prosegue
      }
      inserisciMovimento('esterno-2');
    });

    assert.equal(conta('transactions WHERE id = \'esterno-1\''), 1);
    assert.equal(conta('transactions WHERE id = \'esterno-2\''), 1);
    assert.equal(conta('transactions WHERE id = \'interno-1\''), 0);
  });

  it('un errore propagato annulla tutto', () => {
    assert.throws(
      () => {
        atomically(() => {
          inserisciMovimento('tutto-1');
          atomically(() => {
            inserisciMovimento('tutto-2');
            throw new Error('guasto propagato');
          });
        });
      },
      /guasto propagato/,
    );

    assert.equal(conta('transactions WHERE id IN (\'tutto-1\', \'tutto-2\')'), 0);
  });

  it('vacuum dentro atomically è un errore e la transazione si annulla', () => {
    assert.throws(
      () => {
        atomically(() => {
          inserisciMovimento('vacuum-1');
          vacuum();
        });
      },
      /durante una transazione/,
    );

    assert.equal(conta('transactions WHERE id = \'vacuum-1\''), 0);
  });
});
