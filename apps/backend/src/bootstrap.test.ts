import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/**
 * L'avvio sicuro, su un database vero.
 *
 * `safe-migrate.test.ts` verifica i rami della decisione con dipendenze finte.
 * Qui si verifica la stessa sequenza con un database reale, migrazioni reali e
 * una migrazione volutamente rotta: cioè che il backup obbligatorio sia
 * davvero un backup — apribile da solo, con i dati dentro — e che una
 * migrazione fallita non lasci lo schema a metà.
 *
 * Le migrazioni reali non vengono modificate: le fixture sono copie in una
 * cartella temporanea, a cui si aggiunge la voce rotta.
 *
 * ## Isolamento
 *
 * Radice dati temporanea scelta prima degli import. Le migrazioni reali si
 * leggono, non si scrivono.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const migrazioniReali = path.resolve(here, '..', 'drizzle');

const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-bootstrap-'));
const databaseFile = path.join(dataRoot, 'database.sqlite');
process.env.DATABASE_FILE = databaseFile;

const fixtures = mkdtempSync(path.join(tmpdir(), 'appconto-fixture-'));

const { bootstrap } = await import('./bootstrap.js');
const { config } = await import('./config.js');
const { databaseSchema, closeDatabase } = await import('./db/client.js');
const { MigrationFailedError, SchemaTooNewError } = await import('./db/safe-migrate.js');
const { readAppSchema } = await import('./db/schema-version.js');
const { backupService } = await import('./modules/maintenance/index.js');
const { importService } = await import('./modules/import/index.js');

after(() => {
  closeDatabase();
  for (const cartella of [dataRoot, fixtures]) {
    try {
      rmSync(cartella, { recursive: true, force: true });
    } catch {
      // su Windows il file può restare bloccato: sono cartelle temporanee
    }
  }
});

interface VoceJournal {
  readonly idx: number;
  readonly version: string;
  readonly when: number;
  readonly tag: string;
  readonly breakpoints: boolean;
}

function journalReale(): VoceJournal[] {
  const letto = JSON.parse(
    readFileSync(path.join(migrazioniReali, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: VoceJournal[] };

  return letto.entries;
}

/**
 * Una copia delle migrazioni reali, più quelle indicate.
 *
 * Copia e non riferimento: una fixture che modificasse `apps/backend/drizzle`
 * romperebbe l'applicazione vera, e questo test esiste proprio per non
 * rompere niente.
 */
function fixtureMigrazioni(
  nome: string,
  aggiunte: readonly { tag: string; sql: string; when: number }[],
  voci: readonly VoceJournal[] = journalReale(),
): string {
  const cartella = path.join(fixtures, nome);
  mkdirSync(path.join(cartella, 'meta'), { recursive: true });

  for (const voce of voci) {
    copyFileSync(
      path.join(migrazioniReali, `${voce.tag}.sql`),
      path.join(cartella, `${voce.tag}.sql`),
    );
  }

  const complete = [...voci];
  for (const aggiunta of aggiunte) {
    writeFileSync(path.join(cartella, `${aggiunta.tag}.sql`), aggiunta.sql, 'utf8');
    complete.push({
      idx: complete.length,
      version: '6',
      when: aggiunta.when,
      tag: aggiunta.tag,
      breakpoints: true,
    });
  }

  writeFileSync(
    path.join(cartella, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'sqlite', entries: complete }),
    'utf8',
  );

  return cartella;
}

/** Le tabelle presenti nel file indicato. */
function tabelleDi(file: string): string[] {
  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return (
      sqlite
        .prepare(
          `select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
        )
        .all() as { name: string }[]
    ).map((riga) => riga.name);
  } finally {
    sqlite.close();
  }
}

function righeDi(file: string, tabella: string): number {
  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return (sqlite.prepare(`select count(*) as c from "${tabella}"`).get() as { c: number }).c;
  } finally {
    sqlite.close();
  }
}

const backupPreMigrazione = (): string[] =>
  backupService
    .list()
    .filter((info) => info.kind === 'pre-migration')
    .map((info) => info.name);

describe('isolamento del test', () => {
  it('lavora su una radice dati temporanea, con migrazioni copiate', () => {
    assert.equal(config.databaseFile, databaseFile);
    assert.ok(config.databaseFile.startsWith(tmpdir()));
    assert.ok(fixtures.startsWith(tmpdir()));
    assert.ok(!config.databaseFile.includes(`${path.sep}Desktop${path.sep}`));
  });
});

describe('primo avvio su un archivio nuovo', () => {
  it('crea lo schema e non crea un backup di un database vuoto', () => {
    const esito = bootstrap(migrazioniReali);

    assert.equal(esito.kind, 'inizializzato');
    assert.deepEqual(databaseSchema(), readAppSchema(migrazioniReali));
    assert.deepEqual(backupPreMigrazione(), [], 'niente da proteggere in un archivio vuoto');
    assert.equal(righeDi(databaseFile, 'categories'), 22, 'il seed è stato applicato');
  });
});

describe('avvio su un archivio già aggiornato', () => {
  it('non migra e non crea backup: è il caso di tutti i giorni', () => {
    const esito = bootstrap(migrazioniReali);

    assert.equal(esito.kind, 'allineato');
    assert.deepEqual(backupPreMigrazione(), []);
  });
});

describe('migrazione che fallisce', () => {
  it('il backup esiste, la migrazione no, lo schema è quello di prima', () => {
    // Un archivio con dei dati dentro: un backup di un database vuoto non
    // dimostrerebbe niente.
    importService.importCsv(
      [
        'Data contabile,Descrizione,Importo',
        ...Array.from(
          { length: 25 },
          (_unused, indice) =>
            `${String((indice % 28) + 1).padStart(2, '0')}/04/2026,PRIMA DELLA MIGRAZIONE ${String(indice)},-${String(indice + 1)}.00`,
        ),
      ].join('\r\n'),
    );

    const schemaPrima = databaseSchema();
    const tabellePrima = tabelleDi(databaseFile);
    const righePrima = righeDi(databaseFile, 'transactions');
    assert.equal(righePrima, 25);

    const rotte = fixtureMigrazioni('con-migrazione-rotta', [
      {
        tag: '9999_rotta',
        // Volutamente non valido: la tabella `transactions` esiste già, e la
        // sintassi è comunque sbagliata.
        sql: 'CREAT TABEL non_esiste (id text);',
        when: schemaPrima.latestMillis + 1_000,
      },
    ]);

    let errore: unknown;
    try {
      bootstrap(rotte);
      assert.fail('la migrazione rotta doveva far fallire l-avvio');
    } catch (caught) {
      errore = caught;
    }

    // 1. l'errore dice che la migrazione non è riuscita, e da dove ripartire
    assert.ok(errore instanceof MigrationFailedError);
    assert.match(errore.message, /non riuscito/);

    // 2. il backup pre-migrazione esiste
    const backup = backupPreMigrazione();
    assert.equal(backup.length, 1, `backup trovati: ${backup.join(', ')}`);
    assert.equal(errore.backupName, backup[0]);

    // 3. ed è valido: manifest, integrità e impronta
    const check = backupService.verify(errore.backupName);
    assert.ok(check.ok, check.ok ? '' : check.problem);
    assert.equal(check.rowCounts.transactions, righePrima);

    // 4. si apre da solo, senza l'applicazione
    const file = path.join(config.backupsDir, errore.backupName);
    assert.equal(righeDi(file, 'transactions'), righePrima);
    assert.deepEqual(tabelleDi(file), tabellePrima);

    // 5. lo schema del database attivo non è cambiato di una virgola
    assert.deepEqual(databaseSchema(), schemaPrima, 'la migrazione non risulta applicata');
    assert.deepEqual(tabelleDi(databaseFile), tabellePrima, 'nessuna tabella a metà');
    assert.equal(righeDi(databaseFile, 'transactions'), righePrima, 'nessun dato perso');
  });

  it("dopo il fallimento l'applicazione riparte con le migrazioni buone", () => {
    // Il fallimento non ha lasciato residui: con le migrazioni corrette
    // l'avvio torna a essere quello normale.
    const esito = bootstrap(migrazioniReali);

    assert.equal(esito.kind, 'allineato');
    assert.equal(righeDi(databaseFile, 'transactions'), 25);
  });
});

describe('archivio più recente dell-applicazione', () => {
  it("l'avvio si rifiuta, e non tocca niente", () => {
    const schemaPrima = databaseSchema();
    const righePrima = righeDi(databaseFile, 'transactions');
    const backupPrima = backupPreMigrazione();

    // Un'applicazione che conosce una migrazione in meno di quelle registrate
    // nell'archivio: è esattamente ciò che accade installando una versione
    // vecchia sopra una cartella dati recente.
    const voci = journalReale();
    const indietro = fixtureMigrazioni('versione-vecchia', [], voci.slice(0, -1));

    assert.throws(() => bootstrap(indietro), SchemaTooNewError);

    assert.deepEqual(databaseSchema(), schemaPrima);
    assert.equal(righeDi(databaseFile, 'transactions'), righePrima);
    assert.deepEqual(backupPreMigrazione(), backupPrima, 'nemmeno un backup: non si è fatto nulla');
  });

  it("non tenta di adattare l'archivio togliendo tabelle o colonne", () => {
    const tabellePrima = tabelleDi(databaseFile);
    const voci = journalReale();

    // Anche saltando indietro di più versioni il comportamento è lo stesso:
    // rifiuto, non adattamento.
    assert.throws(
      () => bootstrap(fixtureMigrazioni('molto-vecchia', [], voci.slice(0, 3))),
      SchemaTooNewError,
    );

    assert.deepEqual(tabelleDi(databaseFile), tabellePrima);
  });
});

describe('le migrazioni reali non sono state toccate', () => {
  it('la cartella del progetto è quella di prima', () => {
    const voci = journalReale();
    const file = readdirSync(migrazioniReali).filter((nome) => nome.endsWith('.sql'));

    assert.equal(file.length, voci.length, 'nessuna migrazione aggiunta o rimossa');
    for (const voce of voci) {
      assert.ok(file.includes(`${voce.tag}.sql`), `manca ${voce.tag}.sql`);
    }
    assert.ok(!readdirSync(migrazioniReali).includes('9999_rotta.sql'), 'la fixture era una copia');
  });
});
