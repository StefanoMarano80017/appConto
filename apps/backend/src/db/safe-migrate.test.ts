import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MigrationFailedError,
  PreMigrationBackupError,
  SchemaTooNewError,
  safeMigrate,
  type MigrationPort,
} from './safe-migrate.js';
import type { SchemaVersion } from './schema-version.js';

/**
 * La sequenza di avvio sicuro.
 *
 * Le tre condizioni che deve garantire — non aprire un archivio più recente,
 * non migrare senza backup, non dichiarare riuscita una migrazione fallita —
 * sono difficilissime da provocare su un database vero: servirebbero una
 * versione futura dell'applicazione, un disco pieno e una migrazione rotta.
 * Con le dipendenze come parametri diventano tre righe, e ogni ramo si può
 * verificare compreso l'ordine in cui i passi avvengono.
 *
 * La controparte su un database reale, con una migrazione volutamente
 * fallimentare, sta in `bootstrap.test.ts`.
 */

const versione = (appliedCount: number, latestMillis: number): SchemaVersion => ({
  appliedCount,
  latestMillis,
});

/** Un porto finto che registra cosa è stato chiamato, e in che ordine. */
function porto(options: {
  database: SchemaVersion;
  app: SchemaVersion;
  backupFallisce?: boolean;
  migrazioneFallisce?: boolean;
  dopoLaMigrazione?: SchemaVersion;
}): { port: MigrationPort; chiamate: string[] } {
  const chiamate: string[] = [];
  let migrato = false;

  return {
    chiamate,
    port: {
      databaseSchema: () =>
        migrato ? (options.dopoLaMigrazione ?? options.app) : options.database,
      appSchema: () => options.app,
      createBackup: () => {
        chiamate.push('backup');
        if (options.backupFallisce === true) {
          throw new Error('disco pieno');
        }

        return 'pre-migration-20260901-143012.sqlite';
      },
      migrate: () => {
        chiamate.push('migrate');
        if (options.migrazioneFallisce === true) {
          throw new Error('near "CREAT": syntax error');
        }
        migrato = true;
      },
    },
  };
}

describe('archivio più recente dell-applicazione', () => {
  it('viene rifiutato, e nulla viene toccato', () => {
    const { port, chiamate } = porto({ database: versione(11, 6_000), app: versione(10, 5_000) });

    assert.throws(() => safeMigrate(port), SchemaTooNewError);
    assert.deepEqual(chiamate, [], 'nessuna migrazione e nessun backup');
  });

  it('il messaggio spiega le tre cose che servono a chi legge', () => {
    const { port } = porto({ database: versione(11, 6_000), app: versione(10, 5_000) });

    try {
      safeMigrate(port);
      assert.fail('doveva rifiutare');
    } catch (error) {
      assert.ok(error instanceof SchemaTooNewError);
      // 1. l-archivio appartiene a una versione più recente
      assert.match(error.message, /versione più recente/);
      // 2. questa versione non può aprirlo in sicurezza
      assert.match(error.message, /si ferma/);
      // 3. l-archivio non è stato modificato
      assert.match(error.message, /NON è stato modificato/);
      // e non parla di Drizzle, journal o millisecondi
      assert.ok(!/journal|drizzle|millis/i.test(error.message));
    }
  });
});

describe('archivio allineato', () => {
  it('non migra e non crea backup: è il caso normale di ogni avvio', () => {
    const { port, chiamate } = porto({ database: versione(10, 5_000), app: versione(10, 5_000) });

    assert.deepEqual(safeMigrate(port), { kind: 'allineato', schema: versione(10, 5_000) });
    assert.deepEqual(chiamate, []);
  });
});

describe('archivio nuovo', () => {
  it('crea lo schema senza backup: non c-è nulla da perdere', () => {
    const { port, chiamate } = porto({
      database: versione(0, 0),
      app: versione(10, 5_000),
      dopoLaMigrazione: versione(10, 5_000),
    });

    assert.deepEqual(safeMigrate(port), { kind: 'inizializzato', schema: versione(10, 5_000) });
    assert.deepEqual(chiamate, ['migrate'], 'nessun backup di un database vuoto');
  });
});

describe('archivio da migrare', () => {
  it('il backup viene prima della migrazione', () => {
    const { port, chiamate } = porto({
      database: versione(9, 4_000),
      app: versione(10, 5_000),
      dopoLaMigrazione: versione(10, 5_000),
    });

    const esito = safeMigrate(port);

    assert.deepEqual(chiamate, ['backup', 'migrate'], "l-ordine è la garanzia");
    assert.deepEqual(esito, {
      kind: 'migrato',
      from: versione(9, 4_000),
      to: versione(10, 5_000),
      backupName: 'pre-migration-20260901-143012.sqlite',
    });
  });

  it('se il backup non riesce, la migrazione non parte', () => {
    const { port, chiamate } = porto({
      database: versione(9, 4_000),
      app: versione(10, 5_000),
      backupFallisce: true,
    });

    assert.throws(() => safeMigrate(port), PreMigrationBackupError);
    assert.deepEqual(chiamate, ['backup'], 'la migrazione non deve essere stata tentata');
  });

  it('il messaggio del backup mancato dice che l-archivio non è stato modificato', () => {
    const { port } = porto({
      database: versione(9, 4_000),
      app: versione(10, 5_000),
      backupFallisce: true,
    });

    try {
      safeMigrate(port);
      assert.fail('doveva fermarsi');
    } catch (error) {
      assert.ok(error instanceof PreMigrationBackupError);
      assert.match(error.message, /non è stata eseguita/);
      assert.match(error.message, /non è stato modificato/);
      assert.match(error.message, /disco pieno/, 'la causa tecnica resta leggibile');
    }
  });

  it('se la migrazione fallisce, l-errore porta il nome del backup da cui ripartire', () => {
    const { port, chiamate } = porto({
      database: versione(9, 4_000),
      app: versione(10, 5_000),
      migrazioneFallisce: true,
    });

    try {
      safeMigrate(port);
      assert.fail('doveva fallire');
    } catch (error) {
      assert.ok(error instanceof MigrationFailedError);
      assert.equal(error.backupName, 'pre-migration-20260901-143012.sqlite');
      assert.match(error.message, /pre-migration-20260901-143012\.sqlite/);
      assert.match(error.message, /syntax error/);
    }

    assert.deepEqual(chiamate, ['backup', 'migrate'], 'il backup esisteva già');
  });
});
