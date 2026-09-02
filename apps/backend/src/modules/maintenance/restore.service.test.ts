import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';

/**
 * La preparazione di un ripristino.
 *
 * L'invariante che ogni test di questo file verifica è una sola: **finché non
 * si riavvia, l'archivio attuale non cambia**. Vale quando il ripristino viene
 * preparato con successo e vale, a maggior ragione, in tutti i modi in cui può
 * essere rifiutato.
 *
 * ## Isolamento
 *
 * Radice dati temporanea scelta prima degli import: database, backup, log e
 * temporanei di questo file stanno tutti sotto `os.tmpdir()`.
 */

const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-staging-'));
const databaseFile = path.join(dataRoot, 'database.sqlite');
process.env.DATABASE_FILE = databaseFile;

const { closeDatabase, runMigrations } = await import('../../db/client.js');
const { config } = await import('../../config.js');
const { backupService } = await import('./backup.service.js');
const { restoreService } = await import('./restore.service.js');
const { sha256OfFile } = await import('./backup.manifest.js');
const { CANDIDATE_FILE, PENDING_RESTORE_FILE } = await import('./restore-pending.js');
const { ConflictError, ValidationError } = await import('../../shared/errors.js');
const { importService } = await import('../import/index.js');
const { transactionsService } = await import('../transactions/index.js');

runMigrations();
importService.importCsv(
  [
    'Data contabile,Descrizione,Importo',
    ...Array.from(
      { length: 40 },
      (_unused, indice) =>
        `${String((indice % 28) + 1).padStart(2, '0')}/03/2026,ATTUALE ${String(indice)},-${String(indice + 1)}.00`,
    ),
  ].join('\r\n'),
);

after(() => {
  closeDatabase();
  try {
    rmSync(dataRoot, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

const marker = path.join(dataRoot, PENDING_RESTORE_FILE);
const candidate = path.join(config.tmpDir, CANDIDATE_FILE);

/** Lo stato dell'archivio attivo, per confrontarlo prima e dopo. */
function archivio(): { transazioni: number; impronta: string } {
  return {
    transazioni: transactionsService.listAll().length,
    impronta: sha256OfFile(databaseFile),
  };
}

const manifestDi = (nome: string): string =>
  path.join(config.backupsDir, nome.replace('.sqlite', '.json'));

/** Riscrive l'impronta nel manifest perché corrisponda al file modificato. */
function riallineaImpronta(nome: string): void {
  const file = manifestDi(nome);
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  manifest.databaseSha256 = sha256OfFile(path.join(config.backupsDir, nome));
  writeFileSync(file, JSON.stringify(manifest), 'utf8');
}

let secondi = 0;

/** Un backup valido, con un istante diverso ad ogni chiamata. */
function backupValido(): string {
  secondi += 1;

  return backupService.create('manual', new Date(2026, 8, 1, 9, 0, secondi)).name;
}

describe('isolamento del test', () => {
  it('database, backup e temporanei stanno in una cartella temporanea', () => {
    assert.equal(config.databaseFile, databaseFile);
    assert.ok(config.databaseFile.startsWith(tmpdir()));
    for (const cartella of [config.backupsDir, config.tmpDir, config.logsDir]) {
      assert.ok(cartella.startsWith(dataRoot));
    }
  });
});

describe('preparazione riuscita', () => {
  beforeEach(() => {
    rmSync(marker, { force: true });
    rmSync(candidate, { force: true });
  });

  it("mette tutto in ordine senza toccare l'archivio attivo", () => {
    const nome = backupValido();
    const prima = archivio();

    const staged = restoreService.stage(nome, new Date(2026, 8, 1, 16, 0, 0));

    // L'archivio attivo è esattamente quello di prima, byte per byte.
    assert.deepEqual(archivio(), prima, "l'archivio non deve cambiare adesso");

    assert.equal(staged.backupName, nome);
    assert.equal(staged.preRestoreBackup, 'pre-restore-20260901-160000.sqlite');
    assert.equal(staged.rowCounts.transactions, prima.transazioni);

    // Il backup dell'archivio corrente esiste e regge la verifica da solo.
    const preRestore = backupService.verify(staged.preRestoreBackup);
    assert.ok(preRestore.ok);
    assert.equal(preRestore.rowCounts.transactions, prima.transazioni);

    // Il candidato è pronto in `tmp/`, sullo stesso volume dell'archivio:
    // il rename finale, al riavvio, sarà atomico.
    assert.ok(existsSync(candidate));
    assert.equal(path.parse(candidate).root, path.parse(databaseFile).root);

    // Il marcatore descrive il candidato, con percorsi relativi.
    const pending = JSON.parse(readFileSync(marker, 'utf8')) as Record<string, unknown>;
    assert.equal(pending.state, 'staged');
    assert.equal(pending.candidateFile, CANDIDATE_FILE);
    assert.equal(pending.databaseSha256, sha256OfFile(candidate));
    assert.ok(!JSON.stringify(pending).includes(dataRoot), 'nessun percorso assoluto');
  });

  it('il backup resta al suo posto: il candidato è una copia', () => {
    const nome = backupValido();
    restoreService.stage(nome, new Date(2026, 8, 1, 16, 1, 0));

    assert.ok(existsSync(path.join(config.backupsDir, nome)), 'il backup non va consumato');
    assert.ok(existsSync(candidate));
  });

  it('preparare di nuovo sostituisce la richiesta precedente', () => {
    const primo = backupValido();
    const secondo = backupValido();

    restoreService.stage(primo, new Date(2026, 8, 1, 16, 2, 0));
    const staged = restoreService.stage(secondo, new Date(2026, 8, 1, 16, 3, 0));

    assert.equal(staged.backupName, secondo);
    assert.equal(restoreService.pending()?.backupName, secondo);
  });

  it('si può annullare, e annullare non distrugge il backup pre-restore', () => {
    const nome = backupValido();
    const staged = restoreService.stage(nome, new Date(2026, 8, 1, 16, 4, 0));

    assert.equal(restoreService.cancel(), true);

    assert.ok(!existsSync(marker));
    assert.ok(!existsSync(candidate));
    assert.equal(restoreService.pending(), null);
    assert.ok(
      existsSync(path.join(config.backupsDir, staged.preRestoreBackup)),
      'una copia in più dell-archivio corrente non si butta',
    );
  });

  it('annullare senza niente in attesa non è un errore', () => {
    assert.equal(restoreService.cancel(), false);
  });

  it("un ripristino in corso di applicazione non si può ne' sostituire ne' annullare", () => {
    const nome = backupValido();
    restoreService.stage(nome, new Date(2026, 8, 1, 16, 5, 0));

    // Lo stato che resta se un avvio viene interrotto durante lo scambio.
    const pending = JSON.parse(readFileSync(marker, 'utf8')) as Record<string, unknown>;
    pending.state = 'applying';
    writeFileSync(marker, JSON.stringify(pending), 'utf8');

    assert.throws(() => restoreService.stage(nome), ConflictError);
    assert.throws(() => restoreService.cancel(), ConflictError);
  });
});

describe("preparazione rifiutata: l'archivio attivo resta intatto", () => {
  beforeEach(() => {
    rmSync(marker, { force: true });
    rmSync(candidate, { force: true });
  });

  /** Verifica il rifiuto e che nulla sia cambiato. */
  function rifiuta(azione: () => void, atteso: RegExp): void {
    const prima = archivio();

    assert.throws(azione, (error: unknown) => {
      assert.ok(error instanceof ValidationError, 'deve essere un errore di richiesta');
      assert.match(error.message, atteso);

      return true;
    });

    assert.deepEqual(archivio(), prima, "l'archivio non deve essere stato toccato");
    assert.ok(!existsSync(marker), 'nessun ripristino deve risultare in attesa');
    assert.ok(!existsSync(candidate), 'nessun candidato deve restare in tmp/');
  }

  it('un backup che non esiste', () => {
    rifiuta(() => restoreService.stage('manual-19990101-000000.sqlite'), /non esiste/);
  });

  it('un nome che tenta di uscire dalla cartella', () => {
    for (const nome of [
      '../database.sqlite',
      '../../data/database.sqlite',
      '/etc/passwd',
      'C:\\Windows\\System32\\config\\SAM',
      '%2e%2e%2fdatabase.sqlite',
    ]) {
      rifiuta(() => restoreService.stage(nome), /non è il nome di un backup/);
    }
  });

  it('un backup troncato', () => {
    const nome = backupValido();
    truncateSync(path.join(config.backupsDir, nome), 2_500);

    rifiuta(() => restoreService.stage(nome), /non è integro|impronta/);
  });

  it("un backup con un'impronta che non corrisponde", () => {
    const nome = backupValido();
    const file = manifestDi(nome);
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    manifest.databaseSha256 = '0'.repeat(64);
    writeFileSync(file, JSON.stringify(manifest), 'utf8');

    rifiuta(() => restoreService.stage(nome), /impronta non corrisponde/);
  });

  it('un backup corrotto internamente', () => {
    const nome = backupValido();
    const file = path.join(config.backupsDir, nome);
    const byte = readFileSync(file);
    byte.fill(0x5a, Math.floor(byte.length / 3), Math.floor((byte.length * 2) / 3));
    writeFileSync(file, byte);
    riallineaImpronta(nome);

    rifiuta(() => restoreService.stage(nome), /non è integro/);
  });

  it('un backup senza manifest', () => {
    const nome = backupValido();
    rmSync(manifestDi(nome));

    rifiuta(() => restoreService.stage(nome), /non ha un manifest/);
  });

  it('un backup con un formato che questa versione non conosce', () => {
    const nome = backupValido();
    const file = manifestDi(nome);
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    manifest.format = 'appconto-backup/99';
    writeFileSync(file, JSON.stringify(manifest), 'utf8');

    rifiuta(() => restoreService.stage(nome), /formato di backup non supportato/);
  });

  it('un backup creato da una versione più recente dell-applicazione', () => {
    const nome = backupValido();
    const file = path.join(config.backupsDir, nome);

    // Si aggiunge al backup una migrazione che questa applicazione non
    // conosce, e si riallinea l'impronta: il file è integro e verificabile, ma
    // appartiene a un futuro che questa versione non sa gestire.
    const sqlite = new Database(file);
    sqlite
      .prepare('insert into __drizzle_migrations (hash, created_at) values (?, ?)')
      .run('migrazione-futura', 9_999_999_999_999);
    sqlite.close();
    rmSync(`${file}-wal`, { force: true });
    rmSync(`${file}-shm`, { force: true });
    riallineaImpronta(nome);

    rifiuta(() => restoreService.stage(nome), /versione più recente/);
  });
});
