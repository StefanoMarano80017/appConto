import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import Database from 'better-sqlite3';

/**
 * L'applicazione del ripristino differito.
 *
 * È la parte che scambia i file, quindi è anche quella in cui un'interruzione
 * fa più danno. Qui si prova ciò che accade in ognuno dei modi in cui può
 * essere interrotta, e la proprietà da rispettare è sempre la stessa:
 *
 *     l'applicazione non deve mai ritrovarsi senza archivio.
 *
 * Ogni scenario costruisce i propri file da zero: la procedura riceve i
 * percorsi come parametri, quindi non serve né la connessione attiva né la
 * configurazione reale.
 *
 * ## Isolamento
 *
 * `DATABASE_FILE` viene impostato prima di qualunque import, non perché serva
 * un database — questo file non ne apre nessuno tramite l'applicazione — ma
 * perché il logger scrive sotto `DATA_ROOT`, e senza questa riga scriverebbe
 * nella cartella dati reale.
 */

const radice = mkdtempSync(path.join(tmpdir(), 'appconto-restore-'));
process.env.DATABASE_FILE = path.join(radice, 'log-sink', 'database.sqlite');

// Il tipo si importa staticamente: viene cancellato in compilazione e non
// carica nulla, quindi non anticipa la lettura dei percorsi.
import type { RestoreLocations } from './restore-pending.js';

const { PENDING_RESTORE_FILE, RESTORE_FORMAT, applyPendingRestore, readPendingRestore } =
  await import('./restore-pending.js');
const { sha256OfFile } = await import('./backup.manifest.js');
const { LOGS_DIR } = await import('../../paths.js');

after(() => {
  try {
    rmSync(radice, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

/** Le migrazioni che l'applicazione finta conosce. */
const ISTANTI_APP = [1_000, 2_000, 3_000];

function cartellaMigrazioni(istanti: readonly number[]): string {
  const cartella = path.join(radice, `migrazioni-${istanti.join('-')}`);
  mkdirSync(path.join(cartella, 'meta'), { recursive: true });
  writeFileSync(
    path.join(cartella, 'meta', '_journal.json'),
    JSON.stringify({
      entries: istanti.map((when, idx) => ({ idx, when, tag: `000${String(idx)}_x` })),
    }),
    'utf8',
  );

  return cartella;
}

const migrazioniApp = cartellaMigrazioni(ISTANTI_APP);

/**
 * Un database riconoscibile.
 *
 * `etichetta` è l'unico contenuto che conta: dopo lo scambio dice quale dei
 * due file è diventato l'archivio, che è precisamente ciò che va verificato.
 */
function creaDatabase(file: string, etichetta: string, istanti: readonly number[] = ISTANTI_APP): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.exec(
    'create table __drizzle_migrations (id SERIAL primary key, hash text not null, created_at numeric)',
  );
  for (const when of istanti) {
    sqlite
      .prepare('insert into __drizzle_migrations (hash, created_at) values (?, ?)')
      .run(`hash-${String(when)}`, when);
  }
  sqlite.exec('create table marca (nome text not null)');
  sqlite.prepare('insert into marca (nome) values (?)').run(etichetta);
  sqlite.close();
}

/** Quale archivio è quello attivo. */
function etichettaDi(file: string): string {
  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return (sqlite.prepare('select nome from marca').get() as { nome: string }).nome;
  } finally {
    sqlite.close();
  }
}

interface Scenario {
  readonly locations: RestoreLocations;
  readonly marker: string;
  readonly candidate: string;
}

let contatore = 0;

/** Una radice dati appena creata, con archivio, candidato e marcatore a scelta. */
function scenario(options: {
  archivio?: string | null;
  candidato?: string | null;
  candidatoIstanti?: readonly number[];
  stato?: 'staged' | 'applying';
  marcatore?: string | null;
  impronta?: 'corretta' | 'sbagliata';
  replacedFile?: string | null;
  conSidecar?: boolean;
}): Scenario {
  contatore += 1;
  const dataRoot = path.join(radice, `caso-${String(contatore)}`);
  const tmpDir = path.join(dataRoot, 'tmp');
  const databaseFile = path.join(dataRoot, 'database.sqlite');
  mkdirSync(tmpDir, { recursive: true });

  if (options.archivio !== null) {
    creaDatabase(databaseFile, options.archivio ?? 'ARCHIVIO-CORRENTE');
    if (options.conSidecar === true) {
      // Residui di una chiusura non ordinata: devono sparire con lo scambio.
      writeFileSync(`${databaseFile}-wal`, 'residuo wal', 'utf8');
      writeFileSync(`${databaseFile}-shm`, 'residuo shm', 'utf8');
    }
  }

  const candidate = path.join(tmpDir, 'restore-candidate.sqlite');
  if (options.candidato !== null) {
    creaDatabase(
      candidate,
      options.candidato ?? 'DAL-BACKUP',
      options.candidatoIstanti ?? ISTANTI_APP,
    );
  }

  const marker = path.join(dataRoot, PENDING_RESTORE_FILE);
  if (options.marcatore === undefined) {
    const impronta =
      options.impronta === 'sbagliata'
        ? '0'.repeat(64)
        : existsSync(candidate)
          ? sha256OfFile(candidate)
          : '0'.repeat(64);

    writeFileSync(
      marker,
      JSON.stringify({
        format: RESTORE_FORMAT,
        state: options.stato ?? 'staged',
        stagedAt: '2026-09-01T10:00:00.000Z',
        backupName: 'manual-20260901-100000.sqlite',
        candidateFile: 'restore-candidate.sqlite',
        databaseSha256: impronta,
        preRestoreBackup: 'pre-restore-20260901-100100.sqlite',
        replacedFile: options.replacedFile ?? null,
      }),
      'utf8',
    );
  } else if (options.marcatore !== null) {
    writeFileSync(marker, options.marcatore, 'utf8');
  }

  return {
    locations: { dataRoot, databaseFile, tmpDir, migrationsFolder: migrazioniApp },
    marker,
    candidate,
  };
}

const quarantena = (dataRoot: string): string =>
  path.join(dataRoot, 'restore-pending.invalid.json');

describe('isolamento del test', () => {
  it('anche i log finiscono in una cartella temporanea', () => {
    assert.ok(LOGS_DIR.startsWith(tmpdir()), `${LOGS_DIR} non è temporanea`);
    assert.ok(LOGS_DIR.startsWith(radice));
  });
});

describe('nessun ripristino in attesa', () => {
  it('non fa niente e non crea niente', () => {
    const caso = scenario({ marcatore: null, candidato: null });

    assert.deepEqual(applyPendingRestore(caso.locations), { kind: 'nessuno' });
    assert.equal(etichettaDi(caso.locations.databaseFile), 'ARCHIVIO-CORRENTE');
    assert.ok(!existsSync(caso.marker));
  });
});

describe('ripristino preparato e valido', () => {
  it("sostituisce l'archivio e mette da parte quello precedente", () => {
    const caso = scenario({ conSidecar: true });

    const esito = applyPendingRestore(caso.locations, new Date(2026, 8, 1, 15, 0, 0));

    assert.equal(esito.kind, 'applicato');
    assert.equal(etichettaDi(caso.locations.databaseFile), 'DAL-BACKUP');

    // L'archivio precedente non è stato distrutto: è in `tmp/`, con il suo WAL.
    const messiDaParte = readdirSync(caso.locations.tmpDir)
      .filter((nome) => nome.startsWith('replaced-'))
      .sort();
    assert.deepEqual(messiDaParte, [
      'replaced-20260901-150000.sqlite',
      'replaced-20260901-150000.sqlite-wal',
    ]);
    assert.equal(
      etichettaDi(path.join(caso.locations.tmpDir, 'replaced-20260901-150000.sqlite')),
      'ARCHIVIO-CORRENTE',
    );

    // Il candidato è stato consumato e il marcatore rimosso.
    assert.ok(!existsSync(caso.candidate));
    assert.ok(!existsSync(caso.marker));

    // Nessun residuo accanto al nome `database.sqlite`: un `-wal` rimasto lì
    // verrebbe attribuito all'archivio nuovo, a cui non appartiene.
    assert.ok(!existsSync(`${caso.locations.databaseFile}-wal`), 'nessun -wal accanto al nuovo archivio');
    assert.ok(!existsSync(`${caso.locations.databaseFile}-shm`), 'nessun -shm accanto al nuovo archivio');

    // Il `-wal` non è stato distrutto: ha seguito il database che accompagna.
    // Dopo un arresto brusco contiene scritture confermate, e la copia di
    // sicurezza sarebbe incompleta senza di lui.
    const walMessoDaParte = path.join(
      caso.locations.tmpDir,
      'replaced-20260901-150000.sqlite-wal',
    );
    assert.ok(existsSync(walMessoDaParte), 'il -wal deve seguire il database');
    assert.equal(readFileSync(walMessoDaParte, 'utf8'), 'residuo wal');
  });

  it('funziona anche se un archivio non esisteva ancora', () => {
    const caso = scenario({ archivio: null });

    const esito = applyPendingRestore(caso.locations);

    assert.equal(esito.kind, 'applicato');
    assert.equal(etichettaDi(caso.locations.databaseFile), 'DAL-BACKUP');
    assert.deepEqual(
      readdirSync(caso.locations.tmpDir).filter((nome) => nome.startsWith('replaced-')),
      [],
      'non c-era niente da mettere da parte',
    );
  });
});

describe("ripristino rifiutato: l'archivio corrente non si tocca", () => {
  const rifiuti: { nome: string; costruisci: () => Scenario }[] = [
    {
      nome: "l'impronta del candidato non corrisponde",
      costruisci: () => scenario({ impronta: 'sbagliata' }),
    },
    {
      nome: 'il candidato è troncato',
      costruisci: () => {
        const caso = scenario({});
        truncateSync(caso.candidate, 2_000);

        return caso;
      },
    },
    {
      nome: 'il candidato non è un database',
      costruisci: () => {
        const caso = scenario({});
        writeFileSync(caso.candidate, 'questo non è un database', 'utf8');

        return caso;
      },
    },
    {
      nome: 'il candidato appartiene a una versione più recente',
      costruisci: () => scenario({ candidatoIstanti: [...ISTANTI_APP, 9_000] }),
    },
    {
      nome: 'il candidato non è più presente',
      costruisci: () => scenario({ candidato: null }),
    },
    {
      nome: 'il marcatore non è JSON',
      costruisci: () => scenario({ marcatore: '{ interrotto a metà' }),
    },
    {
      nome: 'il marcatore ha un formato sconosciuto',
      costruisci: () =>
        scenario({ marcatore: JSON.stringify({ format: 'altro/9', state: 'staged' }) }),
    },
    {
      nome: 'il marcatore è incompleto',
      costruisci: () =>
        scenario({ marcatore: JSON.stringify({ format: RESTORE_FORMAT, state: 'staged' }) }),
    },
    {
      nome: 'lo stato del marcatore non è riconosciuto',
      costruisci: () =>
        scenario({
          marcatore: JSON.stringify({
            format: RESTORE_FORMAT,
            state: 'inventato',
            backupName: 'x',
            candidateFile: 'restore-candidate.sqlite',
            databaseSha256: 'y',
          }),
        }),
    },
  ];

  for (const { nome, costruisci } of rifiuti) {
    it(`${nome}: rifiutato, archivio invariato`, () => {
      const caso = costruisci();

      const esito = applyPendingRestore(caso.locations);

      assert.equal(esito.kind, 'rifiutato', `esito inatteso: ${esito.kind}`);
      assert.equal(
        etichettaDi(caso.locations.databaseFile),
        'ARCHIVIO-CORRENTE',
        "l'archivio corrente deve essere ancora quello di prima",
      );

      // Il marcatore non resta al suo posto: altrimenti ogni avvio
      // successivo ritenterebbe lo stesso ripristino impossibile.
      assert.ok(!existsSync(caso.marker), 'il marcatore va messo in quarantena');
      assert.ok(existsSync(quarantena(caso.locations.dataRoot)), 'la traccia però resta');
    });
  }

  it('un secondo avvio dopo un rifiuto parte normalmente', () => {
    const caso = scenario({ impronta: 'sbagliata' });

    assert.equal(applyPendingRestore(caso.locations).kind, 'rifiutato');
    assert.deepEqual(applyPendingRestore(caso.locations), { kind: 'nessuno' });
    assert.equal(etichettaDi(caso.locations.databaseFile), 'ARCHIVIO-CORRENTE');
  });
});

describe('applicazione interrotta a metà', () => {
  it('con il candidato ancora presente, riprende e completa', () => {
    // Interruzione dopo la scrittura dello stato "applying" e prima dello
    // spostamento: sul disco c'è tutto, la procedura riparte da capo.
    const caso = scenario({ stato: 'applying' });

    const esito = applyPendingRestore(caso.locations);

    assert.equal(esito.kind, 'applicato');
    assert.equal(etichettaDi(caso.locations.databaseFile), 'DAL-BACKUP');
    assert.ok(!existsSync(caso.marker));
  });

  it('con il candidato consumato e l-archivio al suo posto, era già finita', () => {
    // Interruzione **dopo** il punto di commit: il ripristino è avvenuto, resta
    // solo il marcatore da rimuovere.
    const caso = scenario({ stato: 'applying', archivio: 'DAL-BACKUP', candidato: null });

    const esito = applyPendingRestore(caso.locations);

    assert.equal(esito.kind, 'gia-applicato');
    assert.equal(etichettaDi(caso.locations.databaseFile), 'DAL-BACKUP');
    assert.ok(!existsSync(caso.marker), 'il marcatore va rimosso, non messo in quarantena');
    assert.ok(!existsSync(quarantena(caso.locations.dataRoot)));
  });

  it('senza candidato né archivio, rimette al suo posto quello precedente', () => {
    // Il caso peggiore: interruzione fra lo spostamento e il rename. Senza
    // recupero, SQLite creerebbe un archivio vuoto e l'utente vedrebbe un
    // conto azzerato con i propri dati in `tmp/`.
    const caso = scenario({
      stato: 'applying',
      archivio: null,
      candidato: null,
      replacedFile: 'replaced-20260901-150000.sqlite',
    });
    creaDatabase(
      path.join(caso.locations.tmpDir, 'replaced-20260901-150000.sqlite'),
      'ARCHIVIO-PRECEDENTE',
    );

    const esito = applyPendingRestore(caso.locations);

    assert.equal(esito.kind, 'recuperato');
    assert.ok(existsSync(caso.locations.databaseFile), "l'archivio deve esistere");
    assert.equal(etichettaDi(caso.locations.databaseFile), 'ARCHIVIO-PRECEDENTE');
    assert.ok(existsSync(quarantena(caso.locations.dataRoot)));
  });

  it('senza candidato, senza archivio e senza copia, lo dichiara invece di inventare', () => {
    const caso = scenario({ stato: 'applying', archivio: null, candidato: null });

    const esito = applyPendingRestore(caso.locations);

    assert.equal(esito.kind, 'rifiutato');
    assert.ok(!existsSync(caso.locations.databaseFile));
    assert.ok(existsSync(quarantena(caso.locations.dataRoot)));
  });
});

describe('copie del vecchio archivio', () => {
  it('non se ne accumulano più di due', () => {
    const caso = scenario({});
    for (const giorno of [1, 2, 3, 4]) {
      creaDatabase(
        path.join(caso.locations.tmpDir, `replaced-2026080${String(giorno)}-120000.sqlite`),
        `VECCHIO-${String(giorno)}`,
      );
    }

    applyPendingRestore(caso.locations, new Date(2026, 8, 1, 15, 0, 0));

    const rimaste = readdirSync(caso.locations.tmpDir)
      .filter((nome) => nome.startsWith('replaced-') && nome.endsWith('.sqlite'))
      .sort();

    assert.equal(rimaste.length, 2, `rimaste: ${rimaste.join(', ')}`);
    // Le più recenti: quella appena creata e la precedente.
    assert.deepEqual(rimaste, ['replaced-20260804-120000.sqlite', 'replaced-20260901-150000.sqlite']);
  });
});

describe('lettura del marcatore', () => {
  it('distingue "non c-è" da "c-è e non si può usare"', () => {
    const assente = scenario({ marcatore: null, candidato: null });
    assert.equal(readPendingRestore(assente.locations.dataRoot), null);

    const rotto = scenario({ marcatore: 'non json' });
    const letto = readPendingRestore(rotto.locations.dataRoot);
    assert.ok(letto !== null);
    assert.equal(letto.ok, false);
  });
});
