import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  MigrationJournalError,
  compareSchema,
  readAppSchema,
  readDatabaseSchema,
  type SchemaVersion,
} from './schema-version.js';

/**
 * Il confronto fra le versioni dello schema.
 *
 * Questo file non apre il database reale e non ne ha bisogno: la parte che
 * decide se un archivio si può aprire è una funzione da due numeri a un
 * verdetto, e le migrazioni finte vivono in cartelle temporanee.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const realMigrations = path.resolve(here, '..', '..', 'drizzle');

const temporanee: string[] = [];

function cartellaTemporanea(): string {
  const creata = mkdtempSync(path.join(tmpdir(), 'appconto-schema-'));
  temporanee.push(creata);

  return creata;
}

after(() => {
  for (const cartella of temporanee) {
    rmSync(cartella, { recursive: true, force: true });
  }
});

/** Un journal con le voci indicate, negli istanti indicati. */
function journal(cartella: string, istanti: readonly number[]): string {
  mkdirSync(path.join(cartella, 'meta'), { recursive: true });
  writeFileSync(
    path.join(cartella, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: istanti.map((when, idx) => ({ idx, version: '6', when, tag: `000${String(idx)}_x`, breakpoints: true })),
    }),
    'utf8',
  );

  return cartella;
}

const versione = (appliedCount: number, latestMillis: number): SchemaVersion => ({
  appliedCount,
  latestMillis,
});

describe('confronto fra le versioni dello schema', () => {
  it('un database senza migrazioni registrate è nuovo', () => {
    assert.equal(compareSchema(versione(0, 0), versione(9, 5_000)), 'nuovo');
  });

  it('istanti uguali significano che non c-è nulla da fare', () => {
    // Il migratore applica solo le migrazioni con `when` strettamente
    // maggiore: uguale vuol dire allineato, non "riapplica l-ultima".
    assert.equal(compareSchema(versione(9, 5_000), versione(9, 5_000)), 'allineato');
  });

  it('un database indietro va migrato', () => {
    assert.equal(compareSchema(versione(8, 4_000), versione(9, 5_000)), 'da-migrare');
  });

  it('un database avanti va rifiutato', () => {
    assert.equal(compareSchema(versione(10, 6_000), versione(9, 5_000)), 'database-piu-recente');
  });

  it('un solo millisecondo in avanti basta a farlo rifiutare', () => {
    // La soglia deve essere esattamente quella del migratore: se qui fosse
    // più permissiva, un archivio più recente verrebbe aperto e riempito di
    // righe incomplete.
    assert.equal(compareSchema(versione(9, 5_001), versione(9, 5_000)), 'database-piu-recente');
  });

  it('il conteggio non conta: conta l-istante', () => {
    // Due archivi con lo stesso numero di migrazioni ma storie diverse: è
    // l-istante a stabilire chi è più avanti, come per il migratore.
    assert.equal(compareSchema(versione(9, 4_000), versione(9, 5_000)), 'da-migrare');
  });
});

describe('versione portata dall-applicazione', () => {
  it('legge il journal reale del progetto', () => {
    const app = readAppSchema(realMigrations);

    assert.ok(app.appliedCount > 0, 'il progetto ha delle migrazioni');
    assert.ok(app.latestMillis > 0, 'la più recente ha un istante');
  });

  it('l-istante è il massimo, non l-ultimo elencato', () => {
    const cartella = journal(cartellaTemporanea(), [3_000, 9_000, 5_000]);

    assert.deepEqual(readAppSchema(cartella), { appliedCount: 3, latestMillis: 9_000 });
  });

  it('un journal assente ferma tutto invece di far indovinare', () => {
    assert.throws(() => readAppSchema(cartellaTemporanea()), MigrationJournalError);
  });

  it('un journal illeggibile ferma tutto', () => {
    const cartella = cartellaTemporanea();
    mkdirSync(path.join(cartella, 'meta'), { recursive: true });
    writeFileSync(path.join(cartella, 'meta', '_journal.json'), '{ questo non è json', 'utf8');

    assert.throws(() => readAppSchema(cartella), MigrationJournalError);
  });

  it('una voce senza istante ferma tutto', () => {
    const cartella = cartellaTemporanea();
    mkdirSync(path.join(cartella, 'meta'), { recursive: true });
    writeFileSync(
      path.join(cartella, 'meta', '_journal.json'),
      JSON.stringify({ entries: [{ idx: 0, tag: 'x' }] }),
      'utf8',
    );

    assert.throws(() => readAppSchema(cartella), MigrationJournalError);
  });
});

describe('versione registrata in un database', () => {
  it('un file appena creato vale zero', () => {
    const file = path.join(cartellaTemporanea(), 'vuoto.sqlite');
    const sqlite = new Database(file);

    try {
      assert.deepEqual(readDatabaseSchema(sqlite), { appliedCount: 0, latestMillis: 0 });
    } finally {
      sqlite.close();
    }
  });

  it('legge conteggio e istante dalla tabella di Drizzle', () => {
    const file = path.join(cartellaTemporanea(), 'migrato.sqlite');
    const sqlite = new Database(file);

    try {
      sqlite.exec(
        'create table __drizzle_migrations (id SERIAL primary key, hash text not null, created_at numeric)',
      );
      for (const when of [1_000, 2_000, 7_000]) {
        sqlite
          .prepare('insert into __drizzle_migrations (hash, created_at) values (?, ?)')
          .run(`hash-${String(when)}`, when);
      }

      assert.deepEqual(readDatabaseSchema(sqlite), { appliedCount: 3, latestMillis: 7_000 });
    } finally {
      sqlite.close();
    }
  });
});
