import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { sql } from 'drizzle-orm';

/**
 * Azzerare l'archivio.
 *
 * La verifica che conta non è «le tabelle sono vuote», ma **«questo archivio è
 * indistinguibile da uno appena creato»**: il test costruisce un secondo
 * database da zero applicandovi le stesse migrazioni, e confronta i conteggi
 * riga per riga. È l'unico modo di provare la promessa fatta all'utente senza
 * riscriverne l'elenco a mano — un elenco che resterebbe indietro alla prima
 * tabella aggiunta.
 *
 * ## Isolamento
 *
 * Radice dati temporanea scelta prima degli import, come sempre in questo
 * progetto: `db/client.js` apre la connessione quando viene valutato.
 */

const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-reset-'));
process.env.DATABASE_FILE = path.join(dataRoot, 'database.sqlite');

const { config } = await import('../../config.js');
const { databaseSchema, db, runMigrations } = await import('../../db/client.js');
const { openSqlite } = await import('../../db/sqlite.js');
const { importService } = await import('../import/index.js');
const { transactionsService } = await import('../transactions/index.js');
const { merchantsService } = await import('../merchants/index.js');
const { categoriesService } = await import('../categories/index.js');
const { settingsService } = await import('../settings/index.js');
const { loansService, DEFAULT_LOAN_QUERY } = await import('../loans/index.js');
const { backupService } = await import('./backup.service.js');
const { resetService, userTables } = await import('./reset.service.js');
const { PENDING_RESTORE_FILE } = await import('./restore-pending.js');
const { ConflictError } = await import('../../shared/errors.js');

runMigrations();

const temporanee = [dataRoot];

after(() => {
  for (const cartella of temporanee) {
    try {
      rmSync(cartella, { recursive: true, force: true });
    } catch {
      // su Windows il file può restare bloccato: è comunque temporaneo
    }
  }
});

/**
 * I conteggi di un archivio appena creato.
 *
 * Un secondo database, vero, con le stesse migrazioni: è il riferimento contro
 * cui si misura «come al primo avvio». Descriverlo a mano significherebbe
 * scrivere due volte la stessa verità.
 */
function contiDiUnArchivioNuovo(): Record<string, number> {
  const cartella = mkdtempSync(path.join(tmpdir(), 'appconto-nuovo-'));
  temporanee.push(cartella);

  const sqlite = openSqlite(path.join(cartella, 'database.sqlite'));
  try {
    const nuovo = drizzle(sqlite);
    migrate(nuovo, { migrationsFolder: config.migrationsFolder });

    const tabelle = nuovo
      .all<{ name: string }>(
        sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
      )
      .map((row) => row.name)
      .filter((name) => !name.startsWith('__'))
      .filter((name) => name !== 'categories');

    const conti: Record<string, number> = {};
    for (const tabella of tabelle) {
      const row = nuovo.get<{ total: number }>(
        sql`select count(*) as total from ${sql.identifier(tabella)}`,
      );
      conti[tabella] = Number(row?.total ?? 0);
    }

    return conti;
  } finally {
    sqlite.close();
  }
}

/** I conteggi dell'archivio in prova, letti dai servizi pubblici. */
function contiAttuali(): Record<string, number> {
  const prestiti = loansService.list(DEFAULT_LOAN_QUERY).items;

  return {
    loan_repayments: prestiti.reduce((totale, prestito) => totale + prestito.repaymentCount, 0),
    loans: prestiti.length,
    merchants: merchantsService.listAllWithCategory().length,
    // Riga unica, con identificativo fisso: c'è sempre, e sempre una sola.
    settings: 1,
    transactions: transactionsService.listAll().length,
  };
}

/** Riempie l'archivio di dati veri, prestito compreso. */
function riempi(): void {
  importService.importCsv(
    [
      'Data contabile,Descrizione,Importo',
      '01/05/2026,ESSELUNGA MILANO,-42.50',
      '02/05/2026,BAR CENTRALE,-3.20',
      '03/05/2026,STIPENDIO,2500.00',
      '04/05/2026,ANTICIPO A MARCO,-300.00',
    ].join('\r\n'),
  );

  const anticipo = transactionsService
    .listAll()
    .find((transazione) => transazione.description.includes('ANTICIPO'));
  assert.ok(anticipo !== undefined);

  transactionsService.updateType(anticipo.id, 'LOAN');
  const prestito = loansService.create({
    transactionId: anticipo.id,
    borrowerName: 'Marco',
    amount: 300,
    lentAt: '2026-05-04',
  });
  loansService.addRepayment(prestito.id, {
    amount: 100,
    repaymentDate: '2026-05-20',
    transactionId: null,
  });

  settingsService.update({ initialBalance: 1234.56, balanceDate: '2026-01-01' });

  // Crea la categoria solo se non esiste già (possono sopravvivere a reset precedenti)
  if (!categoriesService.listAll().some((c) => c.name === 'Categoria di prova')) {
    categoriesService.create({ name: 'Categoria di prova', color: '#123456' });
  }
}

describe('isolamento del test', () => {
  it('il processo usa un database temporaneo', () => {
    assert.ok(config.databaseFile.startsWith(tmpdir()));
    assert.equal(path.dirname(config.databaseFile), dataRoot);
  });
});

describe('le tabelle da svuotare', () => {
  it('vengono chieste al database, e non comprendono quelle di servizio né le categorie', () => {
    const tabelle = userTables();

    assert.ok(tabelle.includes('transactions'));
    assert.ok(tabelle.includes('merchants'));
    assert.ok(tabelle.includes('loans'));
    assert.ok(tabelle.includes('loan_repayments'));
    assert.ok(tabelle.includes('settings'));
    // Il registro delle migrazioni non è un dato dell'utente: azzerare i dati
    // non è tornare a una versione precedente del programma.
    assert.ok(!tabelle.some((nome) => nome.startsWith('__')));
    // Le categorie sono configurazione stabile gestita a runtime, non dato
    // utente: il reset non le tocca.
    assert.ok(!tabelle.includes('categories'));
  });
});

describe('azzeramento', () => {
  it('riporta l-archivio allo stato di uno appena creato', () => {
    riempi();

    const pieno = contiAttuali();
    assert.ok((pieno.transactions ?? 0) > 0);
    assert.ok((pieno.loans ?? 0) > 0);
    assert.ok((pieno.merchants ?? 0) > 0);
    const schemaPrima = databaseSchema();

    const esito = resetService.run(new Date('2026-09-02T15:00:00'));

    // Il conto di ciò che è stato eliminato è quello che c'era.
    assert.equal(esito.removed.transactions, pieno.transactions);
    assert.equal(esito.removed.loans, pieno.loans);
    assert.equal(esito.removed.merchants, pieno.merchants);

    // E l'archivio è indistinguibile da uno nuovo, tabella per tabella.
    assert.deepEqual(contiAttuali(), contiDiUnArchivioNuovo());

    // Lo schema non è tornato indietro.
    assert.deepEqual(databaseSchema(), schemaPrima);
  });

  it('le categorie, incluse quelle create dall-utente, sopravvivono all-azzeramento', () => {
    const categorie = categoriesService.listAll();

    // La categoria di prova creata da riempi() prima del reset è ancora qui.
    assert.ok(categorie.some((categoria) => categoria.name === 'Categoria di prova'));
    // E le ventiquattro del seed di partenza ci sono ancora tutte.
    assert.ok(categorie.length >= 25);
  });

  it('le impostazioni tornano a saldo di partenza sconosciuto', () => {
    assert.deepEqual(settingsService.get(), { initialBalance: 0, balanceDate: null });
  });

  it('prima di procedere ha creato una copia di sicurezza, che la ritenzione non tocca', () => {
    const backups = backupService.list();
    const preReset = backups.filter((info) => info.kind === 'pre-reset');

    assert.equal(preReset.length, 1);
    assert.equal(preReset[0]?.status, 'completo');
    // La copia contiene ciò che c'era: è da lì che si torna indietro.
    assert.equal(preReset[0]?.rowCounts.transactions, 4);

    // Ed è verificabile fino in fondo, non solo elencabile.
    const verifica = backupService.verify(preReset[0]?.name ?? '');
    assert.equal(verifica.ok, true);
  });

  it('i backup sopravvivono all-azzeramento', () => {
    // Azzerare i dati non è cancellare la rete di sicurezza: sarebbe
    // esattamente il contrario di ciò che serve subito dopo un ripensamento.
    assert.ok(backupService.list().length > 0);
    assert.ok(existsSync(config.backupsDir));
  });

  it('su un archivio già vuoto non fallisce', () => {
    const esito = resetService.run(new Date('2026-09-02T15:01:00'));

    assert.equal(esito.removed.transactions, 0);
    assert.deepEqual(contiAttuali(), contiDiUnArchivioNuovo());
  });

  it('restituisce al disco lo spazio delle righe eliminate', () => {
    // Molti movimenti, per far crescere l'archivio in modo misurabile.
    const righe = Array.from(
      { length: 400 },
      (_unused, indice) =>
        `${String((indice % 28) + 1).padStart(2, '0')}/07/2026,MOVIMENTO ${indice},-${indice + 1}.00`,
    );
    importService.importCsv(['Data contabile,Descrizione,Importo', ...righe].join('\r\n'));

    /*
     * Le pagine, non i byte del file.
     *
     * In modalità WAL le scritture recenti vivono in un file separato: la
     * dimensione di `database.sqlite` non riflette ciò che è stato appena
     * scritto, e misurarla direbbe 4096 byte prima e dopo. Il conteggio delle
     * pagine è invece la dimensione che SQLite attribuisce all'archivio,
     * indipendentemente da dove i byte si trovino in questo istante.
     */
    const pagine = (): number => {
      const row = db.get<{ page_count: number }>(sql`select * from pragma_page_count()`);

      return Number(row?.page_count ?? 0);
    };

    const prima = pagine();
    assert.ok(prima > 10, `l-archivio doveva essere cresciuto: ${String(prima)} pagine`);

    resetService.run(new Date('2026-09-02T15:02:00'));

    const dopo = pagine();

    /*
     * Senza `VACUUM` le pagine resterebbero quelle di prima, marcate come
     * libere: «da zero» sarebbe vero nei dati e falso sul disco.
     */
    assert.ok(dopo < prima, `l-archivio doveva rimpicciolirsi: da ${String(prima)} a ${String(dopo)} pagine`);

    // E non resta spazio libero da recuperare.
    const libere = db.get<{ freelist_count: number }>(sql`select * from pragma_freelist_count()`);
    assert.equal(Number(libere?.freelist_count ?? -1), 0);
  });
});

describe('quando NON si azzera', () => {
  it('con un ripristino in attesa si rifiuta, e non tocca niente', () => {
    riempi();
    const prima = contiAttuali();
    const backupPrima = backupService.list().length;

    // Il segnale di un ripristino preparato: al prossimo avvio il database
    // verrebbe sostituito, annullando l'azzeramento senza dirlo a nessuno.
    const marker = path.join(dataRoot, PENDING_RESTORE_FILE);
    writeFileSync(marker, JSON.stringify({ qualcosa: 'di preparato' }), 'utf8');

    try {
      assert.throws(
        () => resetService.run(),
        (error: unknown) => {
          assert.ok(error instanceof ConflictError);
          assert.match(error.message, /ripristino in attesa/);

          return true;
        },
      );

      assert.deepEqual(contiAttuali(), prima, 'l-archivio non doveva essere toccato');
      assert.equal(
        backupService.list().length,
        backupPrima,
        'non doveva nemmeno creare la copia di sicurezza',
      );
    } finally {
      rmSync(marker, { force: true });
    }
  });

  it('dopo aver annullato il ripristino, si azzera', () => {
    const esito = resetService.run(new Date('2026-09-02T15:03:00'));

    assert.ok((esito.removed.transactions ?? 0) > 0);
    assert.deepEqual(contiAttuali(), contiDiUnArchivioNuovo());
  });
});

describe('i nomi dei backup di azzeramento', () => {
  it('sono riconosciuti dalla convenzione', () => {
    // Il tipo è nuovo: se il riconoscitore dei nomi non lo includesse, i file
    // esisterebbero e il sistema non li vedrebbe — invisibili nell'elenco, mai
    // eliminati, rifiutati dal ripristino.
    const nomi = readdirSync(config.backupsDir).filter((nome) => nome.startsWith('pre-reset-'));

    assert.ok(nomi.length > 0);
    for (const info of backupService.list().filter((voce) => voce.kind === 'pre-reset')) {
      assert.equal(info.status, 'completo');
    }
    assert.equal(
      backupService.list().filter((voce) => voce.kind === 'pre-reset').length,
      nomi.filter((nome) => nome.endsWith('.sqlite')).length,
    );
  });
});
