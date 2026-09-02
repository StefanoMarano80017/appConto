import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import Database from 'better-sqlite3';

/**
 * Creazione e verifica dei backup su un database vero.
 *
 * ## Isolamento
 *
 * La radice dati è una cartella temporanea scelta **prima** di importare i
 * moduli che aprono la connessione: `DATABASE_FILE` porta con sé anche
 * `DATA_ROOT`, quindi database, backup, log e temporanei di questo file
 * vivono tutti sotto `os.tmpdir()`. Il primo gruppo di test lo dimostra
 * invece di darlo per scontato, e nessun test successivo scrive fuori da lì.
 */

const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-backup-'));
const databaseFile = path.join(dataRoot, 'database.sqlite');
process.env.DATABASE_FILE = databaseFile;

const { closeDatabase, runMigrations, atomically } = await import('../../db/client.js');
const { config } = await import('../../config.js');
const { BACKUP_FORMAT, inspectDatabase, sha256OfFile } = await import('./backup.manifest.js');
const { BackupFailedError, backupService } = await import('./backup.service.js');
const { importService } = await import('../import/index.js');
const { transactionsService } = await import('../transactions/index.js');

runMigrations();

after(() => {
  closeDatabase();
  try {
    rmSync(dataRoot, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

/** Un CSV con il numero di righe indicato, tutte diverse fra loro. */
function csv(righe: number, prefisso = 'MOVIMENTO'): string {
  const intestazione = 'Data contabile,Descrizione,Importo';
  const corpo = Array.from({ length: righe }, (_unused, indice) => {
    const giorno = String((indice % 28) + 1).padStart(2, '0');
    const mese = String((indice % 12) + 1).padStart(2, '0');

    return `${giorno}/${mese}/2026,${prefisso} ${String(indice)},-${String(indice + 1)}.00`;
  });

  return [intestazione, ...corpo].join('\r\n');
}

const contenutoDi = (cartella: string): string[] => readdirSync(cartella).sort();

/** Le righe di una tabella, leggendo il file dall'esterno. */
function righeDi(file: string, tabella: string): number {
  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return (sqlite.prepare(`select count(*) as c from "${tabella}"`).get() as { c: number }).c;
  } finally {
    sqlite.close();
  }
}

describe('isolamento del test', () => {
  it('database, backup, temporanei e log stanno tutti in una cartella temporanea', () => {
    assert.equal(config.databaseFile, databaseFile);
    assert.ok(config.databaseFile.startsWith(tmpdir()));

    for (const cartella of [config.dataRoot, config.backupsDir, config.tmpDir, config.logsDir]) {
      assert.ok(cartella.startsWith(dataRoot), `${cartella} deve stare sotto la radice temporanea`);
    }

    assert.ok(
      !config.databaseFile.includes(`${path.sep}Desktop${path.sep}`),
      'il test non deve puntare alla radice dati reale',
    );
  });

  it('backup e temporanei sono sullo stesso volume: il rename finale è atomico', () => {
    assert.equal(path.parse(config.backupsDir).root, path.parse(config.tmpDir).root);
  });
});

describe('creazione di un backup', () => {
  it("produce la coppia database piu manifest, e nient'altro", () => {
    importService.importCsv(csv(30));
    const righePrima = transactionsService.listAll().length;

    const info = backupService.create('manual', new Date(2026, 8, 1, 10, 0, 0));

    assert.equal(info.name, 'manual-20260901-100000.sqlite');
    assert.equal(info.status, 'completo');
    assert.deepEqual(contenutoDi(config.backupsDir), [
      'manual-20260901-100000.json',
      'manual-20260901-100000.sqlite',
    ]);

    // Nessun residuo di lavoro: `.partial` non arriva mai in `backups/`.
    assert.deepEqual(
      readdirSync(config.tmpDir).filter((nome) => nome.endsWith('.partial')),
      [],
    );

    assert.equal(info.rowCounts.transactions, righePrima);
  });

  it('il manifest dichiara tutto ciò che serve a verificarlo', () => {
    const info = backupService.create('manual', new Date(2026, 8, 1, 10, 1, 0));
    const manifest = JSON.parse(
      readFileSync(path.join(config.backupsDir, 'manual-20260901-100100.json'), 'utf8'),
    ) as Record<string, unknown>;

    assert.equal(manifest.format, BACKUP_FORMAT);
    assert.equal(manifest.kind, 'manual');
    assert.equal(manifest.databaseFile, info.name);
    assert.equal(manifest.createdAt, new Date(2026, 8, 1, 10, 1, 0).toISOString());
    assert.equal(
      manifest.databaseSha256,
      sha256OfFile(path.join(config.backupsDir, info.name)),
      "l'impronta nel manifest è quella del file archiviato",
    );
    assert.equal(manifest.databaseBytes, statSync(path.join(config.backupsDir, info.name)).size);
    assert.ok(typeof manifest.appVersion === 'string');

    const schema = manifest.schemaVersion as { appliedCount: number };
    assert.ok(schema.appliedCount > 0, 'la versione dello schema viaggia con il backup');

    // Nessun percorso assoluto finisce nel manifest: la cartella dei dati deve
    // poter essere spostata senza invalidare i backup che contiene.
    assert.ok(!JSON.stringify(manifest).includes(dataRoot));
  });

  it('il backup si riapre da solo e contiene lo stesso archivio', () => {
    const info = backupService.create('manual', new Date(2026, 8, 1, 10, 2, 0));
    const file = path.join(config.backupsDir, info.name);

    // Un solo file: `VACUUM INTO` non produce WAL, quindi non c'è niente da
    // portarsi dietro.
    assert.ok(!existsSync(`${file}-wal`));
    assert.ok(!existsSync(`${file}-shm`));

    assert.equal(righeDi(file, 'transactions'), transactionsService.listAll().length);
    assert.equal(righeDi(file, 'categories'), 22, 'anche le migrazioni sono nel backup');

    const inspection = inspectDatabase(file);
    assert.ok(inspection.ok);
  });

  it('due backup nello stesso secondo non si sovrascrivono', () => {
    const istante = new Date(2026, 8, 1, 11, 0, 0);
    const primo = backupService.create('manual', istante);
    const secondo = backupService.create('manual', istante);

    assert.equal(primo.name, 'manual-20260901-110000.sqlite');
    assert.equal(secondo.name, 'manual-20260901-110001.sqlite');
    assert.ok(existsSync(path.join(config.backupsDir, primo.name)));
  });

  it('un residuo di un tentativo precedente non blocca il backup successivo', () => {
    const residuo = path.join(config.tmpDir, 'manual-20260901-120000.sqlite.partial');
    writeFileSync(residuo, 'spazzatura di un tentativo interrotto', 'utf8');

    const info = backupService.create('manual', new Date(2026, 8, 1, 12, 0, 0));

    assert.equal(info.status, 'completo');
    assert.ok(!existsSync(residuo), 'il residuo va rimosso, non aggirato');
  });

  it('uno snapshot non si prende nel mezzo di una transazione', () => {
    const prima = contenutoDi(config.backupsDir);

    // `VACUUM INTO` non è ammesso dentro una transazione, e il rifiuto deve
    // essere un messaggio chiaro invece dell'errore grezzo di SQLite. È anche
    // l'unico modo realistico di far fallire un backup, quindi è qui che si
    // verifica il percorso di annullamento.
    assert.throws(
      () => {
        atomically(() => backupService.create('manual', new Date(2026, 8, 1, 13, 0, 0)));
      },
      (error: unknown) => {
        assert.ok(error instanceof BackupFailedError, 'deve essere un BackupFailedError');
        assert.match(error.message, /durante una transazione/);

        return true;
      },
    );

    // Un backup fallito non lascia niente: né in `backups/`, né in `tmp/`.
    assert.deepEqual(contenutoDi(config.backupsDir), prima);
    assert.deepEqual(
      readdirSync(config.tmpDir).filter((nome) => nome.endsWith('.partial')),
      [],
    );
  });
});

describe('verifica di un backup', () => {
  const istante = new Date(2026, 8, 2, 9, 0, 0);

  it('un backup appena creato supera la verifica', () => {
    const info = backupService.create('manual', istante);
    const check = backupService.verify(info.name);

    assert.ok(check.ok);
    assert.equal(check.manifest.databaseFile, info.name);
    assert.equal(check.rowCounts.transactions, transactionsService.listAll().length);
  });

  it('un backup senza manifest non è un formato verificabile', () => {
    const info = backupService.create('manual', new Date(2026, 8, 2, 9, 1, 0));
    rmSync(path.join(config.backupsDir, info.name.replace('.sqlite', '.json')));

    const check = backupService.verify(info.name);

    assert.ok(!check.ok);
    assert.match(check.problem, /non ha un manifest/);
  });

  it("un'impronta che non corrisponde fa rifiutare il backup", () => {
    const info = backupService.create('manual', new Date(2026, 8, 2, 9, 2, 0));
    const manifestFile = path.join(config.backupsDir, info.name.replace('.sqlite', '.json'));
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;

    manifest.databaseSha256 = `0${String(manifest.databaseSha256).slice(1)}`;
    writeFileSync(manifestFile, JSON.stringify(manifest), 'utf8');

    const check = backupService.verify(info.name);

    assert.ok(!check.ok);
    assert.match(check.problem, /impronta non corrisponde/);
  });

  it('un file corrotto viene rifiutato da integrity_check', () => {
    const info = backupService.create('manual', new Date(2026, 8, 2, 9, 3, 0));
    const file = path.join(config.backupsDir, info.name);
    const manifestFile = path.join(config.backupsDir, info.name.replace('.sqlite', '.json'));

    // Si guasta il contenuto lasciando invariata la dimensione, e si aggiorna
    // il manifest all'impronta nuova: così è l'integrità a dover accorgersene,
    // non il confronto delle impronte. Il terzo centrale del file è fatto di
    // pagine dell'albero, quindi il danno non può passare inosservato.
    const byte = readFileSync(file);
    byte.fill(0x5a, Math.floor(byte.length / 3), Math.floor((byte.length * 2) / 3));
    writeFileSync(file, byte);

    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
    manifest.databaseSha256 = sha256OfFile(file);
    writeFileSync(manifestFile, JSON.stringify(manifest), 'utf8');

    const check = backupService.verify(info.name);

    assert.ok(!check.ok);
    assert.match(check.problem, /non è integro/);
  });

  it('un file troncato viene rifiutato', () => {
    const info = backupService.create('manual', new Date(2026, 8, 2, 9, 4, 0));
    const file = path.join(config.backupsDir, info.name);

    truncateSync(file, 3_000);

    const check = backupService.verify(info.name);
    assert.ok(!check.ok);
  });

  it('un manifest illeggibile viene rifiutato', () => {
    const info = backupService.create('manual', new Date(2026, 8, 2, 9, 5, 0));
    writeFileSync(
      path.join(config.backupsDir, info.name.replace('.sqlite', '.json')),
      '{ non è json',
      'utf8',
    );

    const check = backupService.verify(info.name);
    assert.ok(!check.ok);
    assert.match(check.problem, /non valido/);
  });

  it('un nome che non è un nome di backup non viene nemmeno cercato', () => {
    for (const nome of ['../database.sqlite', '/etc/passwd', 'database.sqlite', '']) {
      const check = backupService.verify(nome);
      assert.ok(!check.ok);
      assert.match(check.problem, /non è il nome di un backup/);
    }
  });

  it('un backup che non esiste è un backup che non esiste', () => {
    const check = backupService.verify('manual-19990101-000000.sqlite');
    assert.ok(!check.ok);
    assert.match(check.problem, /non esiste/);
  });
});

describe('elenco dei backup', () => {
  it('dal più recente al più vecchio, con lo stato di ciascuno', () => {
    for (const nome of readdirSync(config.backupsDir)) {
      rmSync(path.join(config.backupsDir, nome), { force: true });
    }

    backupService.create('manual', new Date(2026, 8, 3, 8, 0, 0));
    const senzaManifest = backupService.create('manual', new Date(2026, 8, 3, 9, 0, 0));
    rmSync(path.join(config.backupsDir, senzaManifest.name.replace('.sqlite', '.json')));

    const elenco = backupService.list();

    assert.equal(elenco.length, 2);
    assert.equal(elenco[0]?.name, 'manual-20260903-090000.sqlite');
    assert.equal(elenco[0]?.status, 'senza-manifest');
    assert.equal(elenco[1]?.name, 'manual-20260903-080000.sqlite');
    assert.equal(elenco[1]?.status, 'completo');
    assert.equal(elenco[1]?.localTime, '2026-09-03 08:00:00');
  });

  it('un file estraneo nella cartella non compare e non viene toccato', () => {
    const estraneo = path.join(config.backupsDir, 'appunti.txt');
    const partialFuoriPosto = path.join(config.backupsDir, 'manual-20260903-100000.sqlite.partial');
    writeFileSync(estraneo, 'nota personale', 'utf8');
    writeFileSync(partialFuoriPosto, 'un backup mai completato', 'utf8');

    const nomi = backupService.list().map((info) => info.name);

    assert.ok(!nomi.includes('appunti.txt'));
    assert.ok(!nomi.some((nome) => nome.endsWith('.partial')));

    backupService.prune();

    assert.ok(existsSync(estraneo), 'un file non riconosciuto non si cancella');
    assert.ok(existsSync(partialFuoriPosto), 'un .partial non è un backup: non lo si elimina');

    rmSync(estraneo);
    rmSync(partialFuoriPosto);
  });
});

describe('ritenzione applicata al disco', () => {
  it('dei backup pre-migrazione restano gli ultimi cinque, con i loro manifest', () => {
    for (const nome of readdirSync(config.backupsDir)) {
      rmSync(path.join(config.backupsDir, nome), { force: true });
    }

    for (let giorno = 1; giorno <= 8; giorno += 1) {
      backupService.create('pre-migration', new Date(2026, 7, giorno, 7, 0, 0));
    }

    const rimasti = backupService.list();

    assert.equal(rimasti.length, 5);
    assert.deepEqual(
      rimasti.map((info) => info.name),
      [
        'pre-migration-20260808-070000.sqlite',
        'pre-migration-20260807-070000.sqlite',
        'pre-migration-20260806-070000.sqlite',
        'pre-migration-20260805-070000.sqlite',
        'pre-migration-20260804-070000.sqlite',
      ],
    );

    // I manifest seguono i database: nessun orfano resta indietro.
    assert.equal(readdirSync(config.backupsDir).length, 10);
    for (const info of rimasti) {
      assert.ok(existsSync(path.join(config.backupsDir, info.name.replace('.sqlite', '.json'))));
    }
  });

  it('un manifest senza il suo database viene rimosso come residuo', () => {
    const orfano = path.join(config.backupsDir, 'manual-20260701-070000.json');
    writeFileSync(orfano, '{}', 'utf8');

    backupService.prune();

    assert.ok(!existsSync(orfano));
  });
});

describe('backup durante un import di grandi dimensioni', () => {
  it('dopo un import di 5.000 righe il backup le contiene tutte', () => {
    const prima = transactionsService.listAll().length;
    const esito = importService.importCsv(csv(5_000, 'GROSSO'));
    assert.equal(esito.imported, 5_000);

    const info = backupService.create('manual', new Date(2026, 8, 4, 8, 0, 0));
    const file = path.join(config.backupsDir, info.name);

    const inspection = inspectDatabase(file);
    assert.ok(inspection.ok, 'integrity_check deve rispondere ok');
    assert.equal(righeDi(file, 'transactions'), prima + 5_000);
    assert.equal(info.rowCounts.transactions, prima + 5_000);
  });

  it("uno snapshot preso mentre l'import è in corso è coerente, non a metà", () => {
    const prima = transactionsService.listAll().length;
    const snapshot = path.join(config.tmpDir, 'durante-import.sqlite');
    rmSync(snapshot, { force: true });

    let visteDalLettore = -1;

    // L'import gira dentro una transazione ancora aperta: 5.000 righe scritte
    // e non confermate. Nello stesso momento un secondo lettore — una
    // connessione indipendente, come sarebbe un altro processo — prende lo
    // snapshot. In WAL il lettore vede lo stato confermato, quindi lo snapshot
    // non può contenere un import a metà.
    assert.throws(() => {
      atomically(() => {
        const esito = importService.importCsv(csv(5_000, 'INTERROTTO'));
        assert.equal(esito.imported, 5_000);

        const lettore = new Database(databaseFile, { readonly: true });
        lettore.prepare('VACUUM INTO ?').run(snapshot);
        visteDalLettore = (
          lettore.prepare('select count(*) as c from transactions').get() as { c: number }
        ).c;
        lettore.close();

        throw new Error('interruzione simulata');
      });
    }, /interruzione simulata/);

    assert.equal(visteDalLettore, prima, "il lettore non vede l'import non confermato");

    const inspection = inspectDatabase(snapshot);
    assert.ok(inspection.ok, 'lo snapshot è internamente consistente');
    assert.equal(righeDi(snapshot, 'transactions'), prima);

    // E l'archivio, annullata la transazione, è tornato come prima.
    assert.equal(transactionsService.listAll().length, prima);
  });
});

describe('nessuna scrittura fuori dalla radice dati', () => {
  it('tutto ciò che questo file ha creato sta sotto la cartella temporanea', () => {
    // Chiusura dell'isolamento: si ripercorre ciò che esiste e si verifica che
    // nessun percorso esca. Vale come prova che i test precedenti — compresi
    // quelli che cancellano file — non hanno mai lavorato altrove.
    const visti: string[] = [];

    const cammina = (cartella: string): void => {
      for (const nome of readdirSync(cartella, { withFileTypes: true })) {
        const completo = path.join(cartella, nome.name);
        visti.push(completo);
        if (nome.isDirectory()) {
          cammina(completo);
        }
      }
    };

    cammina(dataRoot);

    assert.ok(visti.length > 0);
    for (const percorso of visti) {
      assert.ok(percorso.startsWith(dataRoot + path.sep), `${percorso} è fuori dalla radice dati`);
      assert.ok(percorso.startsWith(tmpdir()), `${percorso} non è in una cartella temporanea`);
    }
  });
});
