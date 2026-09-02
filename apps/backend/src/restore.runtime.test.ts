import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/**
 * Ripristino e rifiuto dell'avvio, a livello di processo.
 *
 * Due cose non si possono provare dentro un processo solo, e sono proprio le
 * due che contano:
 *
 *  1. che un ripristino preparato venga **applicato al riavvio**, cioè quando
 *     nessuna connessione al database esiste;
 *  2. che un archivio più recente dell'applicazione faccia **terminare**
 *     l'avvio, con un messaggio leggibile e senza toccare i dati.
 *
 * ## Isolamento
 *
 * Ogni avvio riceve una `MYFINANCE_DATA` temporanea e una porta assegnata dal
 * sistema. Il test legge dal log del processo figlio quali percorsi ha
 * effettivamente usato: è la prova, e non l'assunzione, che la cartella dati
 * reale non è stata aperta.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..', '..');
const mainEntry = path.join(here, 'main.ts');

/** Il transpilatore va indicato con un percorso assoluto: il cwd del figlio è altrove. */
const tsxCli = path.join(appRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

/** Le radici dati che nessun processo di questo file deve toccare. */
const radiciReali = [
  path.join(appRoot, 'data'),
  path.join(appRoot, 'apps', 'backend', 'data'),
];

const temporanee: string[] = [];

function cartellaTemporanea(prefisso: string): string {
  const creata = mkdtempSync(path.join(tmpdir(), prefisso));
  temporanee.push(creata);

  return creata;
}

after(() => {
  for (const cartella of temporanee) {
    try {
      rmSync(cartella, { recursive: true, force: true });
    } catch {
      // su Windows il file può restare bloccato: sono cartelle temporanee
    }
  }
});

function portaLibera(): Promise<number> {
  return new Promise((resolve, reject) => {
    const sonda = createServer();
    sonda.on('error', reject);
    sonda.listen(0, '127.0.0.1', () => {
      const { port } = sonda.address() as AddressInfo;
      sonda.close(() => {
        resolve(port);
      });
    });
  });
}

/** L'ambiente del figlio viene costruito, non ereditato. */
async function ambiente(dataRoot: string): Promise<{ env: NodeJS.ProcessEnv; port: number }> {
  const port = await portaLibera();
  const env = { ...process.env };
  delete env.DATABASE_FILE;
  delete env.PORT;
  env.MYFINANCE_DATA = dataRoot;
  env.MYFINANCE_PORT = String(port);

  return { env, port };
}

interface Processo {
  readonly child: ChildProcess;
  readonly port: number;
  readonly output: () => string;
}

const attendi = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function raccogli(child: ChildProcess): () => string {
  let output = '';
  for (const flusso of [child.stdout, child.stderr]) {
    flusso?.setEncoding('utf8');
    flusso?.on('data', (blocco: string) => {
      output += blocco;
    });
  }

  return () => output;
}

/** Avvia il backend e attende che risponda. */
async function avvia(dataRoot: string): Promise<Processo> {
  const { env, port } = await ambiente(dataRoot);
  const child = spawn(process.execPath, [tsxCli, mainEntry], {
    cwd: cartellaTemporanea('appconto-rr-cwd-'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = raccogli(child);

  const scadenza = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`il processo è terminato durante l'avvio:\n${output()}`);
    }

    try {
      if ((await fetch(`http://127.0.0.1:${String(port)}/api/health`)).ok) {
        break;
      }
    } catch {
      // non ancora in ascolto
    }

    if (Date.now() > scadenza) {
      throw new Error(`avvio non completato entro il tempo previsto:\n${output()}`);
    }
    await attendi(200);
  }

  return { child, port, output };
}

/** Avvia il backend aspettandosi che rinunci, e restituisce codice e output. */
async function avviaAspettandosiUnRifiuto(
  dataRoot: string,
): Promise<{ code: number | null; output: string }> {
  const { env } = await ambiente(dataRoot);
  const child = spawn(process.execPath, [tsxCli, mainEntry], {
    cwd: cartellaTemporanea('appconto-rr-cwd-'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = raccogli(child);

  const code = await new Promise<number | null>((resolve, reject) => {
    const scadenza = setTimeout(() => {
      child.kill();
      reject(new Error(`il processo non è terminato:\n${output()}`));
    }, 60_000);
    scadenza.unref();

    child.once('exit', (codice) => {
      clearTimeout(scadenza);
      resolve(codice);
    });
  });

  return { code, output: output() };
}

async function termina(processo: Processo): Promise<void> {
  if (processo.child.exitCode !== null) {
    return;
  }

  const uscita = new Promise<void>((resolve) => {
    processo.child.once('exit', () => {
      resolve();
    });
  });
  processo.child.kill('SIGINT');
  await uscita;
}

/**
 * Apre il database in scrittura, attendendo che il processo precedente lo
 * lasci davvero.
 *
 * `child.kill()` su Windows non consegna un segnale: termina il processo. Il
 * WAL resta quindi da recuperare, e il recupero — che tronca quel file — può
 * incontrare l'handle del processo che sta morendo e fallire con
 * `SQLITE_IOERR_TRUNCATE`. Non è un difetto dell'applicazione: è la
 * conseguenza di una terminazione brusca, ed è ciò che questo test provoca
 * deliberatamente. Si riprova, invece di assumere che l'uscita di un processo
 * implichi il rilascio immediato dei suoi file — che su Windows non è vero.
 */
async function apriPerScrivere(file: string, tentativi = 25): Promise<Database.Database> {
  for (let numero = 1; ; numero += 1) {
    let aperto: Database.Database | undefined;
    try {
      aperto = new Database(file);
      // L'errore non arriva all'apertura ma al primo accesso, che è il momento
      // in cui SQLite recupera il WAL.
      aperto.pragma('journal_mode');
      aperto.prepare(`select count(*) as c from __drizzle_migrations`).get();

      return aperto;
    } catch (error) {
      aperto?.close();
      if (numero >= tentativi) {
        throw error;
      }
      await new Promise((risolvi) => setTimeout(risolvi, 200));
    }
  }
}

const CSV_INTESTAZIONE = 'Data contabile,Descrizione,Importo';

async function importa(port: number, righe: readonly string[]): Promise<void> {
  const risposta = await fetch(`http://127.0.0.1:${String(port)}/api/import/csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: [CSV_INTESTAZIONE, ...righe].join('\r\n'),
  });
  assert.equal(risposta.status, 200);
}

async function quanteTransazioni(port: number): Promise<number> {
  const risposta = await fetch(`http://127.0.0.1:${String(port)}/api/transactions`);
  const pagina = (await risposta.json()) as { pagination: { total: number } };

  return pagina.pagination.total;
}

/** I percorsi che un processo figlio ha registrato all'avvio. */
function avvioRegistrato(dataRoot: string): { dataRoot: string; database: string } {
  const logsDir = path.join(dataRoot, 'logs');
  const file = readdirSync(logsDir).find((nome) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(nome));
  assert.ok(file !== undefined, `nessun file di log in ${logsDir}`);

  const contenuto = readFileSync(path.join(logsDir, file), 'utf8');
  const riga = contenuto.split('\n').find((testo) => testo.includes('[info] Avvio '));
  assert.ok(riga !== undefined, 'il log deve contenere la riga di avvio');

  return JSON.parse(riga.slice(riga.indexOf('{'))) as { dataRoot: string; database: string };
}

function righeDi(file: string, tabella: string): number {
  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return (sqlite.prepare(`select count(*) as c from "${tabella}"`).get() as { c: number }).c;
  } finally {
    sqlite.close();
  }
}

describe('ripristino applicato al riavvio', () => {
  it("il ripristino avviene all'avvio successivo, non durante la richiesta", async () => {
    const dataRoot = cartellaTemporanea('appconto-rr-data-');
    const databaseFile = path.join(dataRoot, 'database.sqlite');

    // ── Prima esecuzione ────────────────────────────────────────────────────
    const primo = await avvia(dataRoot);
    let backup: string;

    try {
      // Isolamento verificato dal processo stesso, prima di scrivere qualcosa.
      const registrato = avvioRegistrato(dataRoot);
      assert.equal(registrato.dataRoot, dataRoot);
      assert.equal(registrato.database, databaseFile);
      for (const reale of radiciReali) {
        assert.ok(!registrato.database.startsWith(reale), `${reale} non va toccata`);
      }

      await importa(primo.port, [
        '01/05/2026,PRIMA DEL BACKUP A,-10.00',
        '02/05/2026,PRIMA DEL BACKUP B,-20.00',
        '03/05/2026,PRIMA DEL BACKUP C,-30.00',
      ]);
      assert.equal(await quanteTransazioni(primo.port), 3);

      const creato = await fetch(`http://127.0.0.1:${String(primo.port)}/api/backups`, {
        method: 'POST',
      });
      assert.equal(creato.status, 201);
      backup = ((await creato.json()) as { name: string }).name;

      // Dopo il backup si aggiunge altro: è ciò che il ripristino deve togliere.
      await importa(primo.port, [
        '04/05/2026,DOPO IL BACKUP D,-40.00',
        '05/05/2026,DOPO IL BACKUP E,-50.00',
      ]);
      assert.equal(await quanteTransazioni(primo.port), 5);

      const preparato = await fetch(`http://127.0.0.1:${String(primo.port)}/api/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: backup }),
      });
      assert.equal(preparato.status, 202, await preparato.text());

      // Il punto centrale: la richiesta è stata accettata e l'archivio attivo
      // è ancora quello di prima. Nessuna sostituzione a database aperto.
      assert.equal(await quanteTransazioni(primo.port), 5, 'niente è stato ripristinato adesso');
      assert.ok(existsSync(path.join(dataRoot, 'restore-pending.json')));
    } finally {
      await termina(primo);
    }

    // ── Seconda esecuzione ──────────────────────────────────────────────────
    const secondo = await avvia(dataRoot);

    try {
      assert.equal(
        await quanteTransazioni(secondo.port),
        3,
        "il ripristino è avvenuto all'avvio",
      );

      // Le righe aggiunte dopo il backup non ci sono più.
      const pagina = (await (
        await fetch(`http://127.0.0.1:${String(secondo.port)}/api/transactions?pageSize=25`)
      ).json()) as { items: { description: string }[] };
      const descrizioni = pagina.items.map((riga) => riga.description);
      assert.ok(descrizioni.some((testo) => testo.includes('PRIMA DEL BACKUP')));
      assert.ok(!descrizioni.some((testo) => testo.includes('DOPO IL BACKUP')));

      // Lo stato in attesa è stato consumato.
      assert.ok(!existsSync(path.join(dataRoot, 'restore-pending.json')));
      const stato = await (
        await fetch(`http://127.0.0.1:${String(secondo.port)}/api/restore`)
      ).json();
      assert.equal(stato, null);

      // L'archivio sostituito non è stato distrutto: è in `tmp/`.
      const messiDaParte = readdirSync(path.join(dataRoot, 'tmp')).filter(
        (nome) => nome.startsWith('replaced-') && nome.endsWith('.sqlite'),
      );
      assert.equal(messiDaParte.length, 1, `trovati: ${messiDaParte.join(', ')}`);

      // E il backup pre-restore contiene le cinque righe di prima: se il
      // ripristino fosse stato un errore, si torna indietro da lì.
      const elenco = (await (
        await fetch(`http://127.0.0.1:${String(secondo.port)}/api/backups`)
      ).json()) as { backups: { name: string; kind: string; rowCounts: Record<string, number> }[] };
      const preRestore = elenco.backups.find((info) => info.kind === 'pre-restore');
      assert.ok(preRestore !== undefined, 'il backup pre-restore deve esistere');
      assert.equal(preRestore.rowCounts.transactions, 5);
      assert.equal(
        righeDi(path.join(dataRoot, 'backups', preRestore.name), 'transactions'),
        5,
        'e si apre anche da fuori',
      );

      // Il log dice cosa è successo.
      const log = readFileSync(
        path.join(
          dataRoot,
          'logs',
          readdirSync(path.join(dataRoot, 'logs')).find((nome) => nome.endsWith('.log')) ?? '',
        ),
        'utf8',
      );
      assert.match(log, /Ripristino applicato/);
    } finally {
      await termina(secondo);
    }
  });
});

describe('archivio più recente dell-applicazione', () => {
  it("l'avvio termina invece di aprirlo, e i dati restano dove sono", async () => {
    const dataRoot = cartellaTemporanea('appconto-rr-futuro-');
    const databaseFile = path.join(dataRoot, 'database.sqlite');

    // Un archivio normale, creato dall'applicazione.
    const primo = await avvia(dataRoot);
    try {
      await importa(primo.port, [
        '01/06/2026,MOVIMENTO DA CONSERVARE,-15.00',
        '02/06/2026,ALTRO MOVIMENTO,-25.00',
      ]);
      assert.equal(await quanteTransazioni(primo.port), 2);
    } finally {
      await termina(primo);
    }

    // Lo si porta in un futuro che questa versione non conosce: è ciò che
    // accade installando una versione vecchia sopra una cartella dati recente.
    const sqlite = await apriPerScrivere(databaseFile);
    sqlite
      .prepare('insert into __drizzle_migrations (hash, created_at) values (?, ?)')
      .run('migrazione-di-una-versione-futura', 9_999_999_999_999);
    const migrazioniPrima = (
      sqlite.prepare('select count(*) as c from __drizzle_migrations').get() as { c: number }
    ).c;
    sqlite.close();

    const esito = await avviaAspettandosiUnRifiuto(dataRoot);

    // 1. il processo termina, e non con successo
    assert.notEqual(esito.code, 0, `il processo doveva rifiutare, uscita ${String(esito.code)}`);

    // 2. il messaggio è comprensibile e dice le tre cose che servono
    assert.match(esito.output, /Avvio interrotto/);
    assert.match(esito.output, /versione più recente/);
    assert.match(esito.output, /NON è stato modificato/);

    // 3. i dati sono ancora tutti lì, e la migrazione futura non è stata
    //    rimossa: nessun tentativo di adattare l'archivio.
    assert.equal(righeDi(databaseFile, 'transactions'), 2);
    assert.equal(righeDi(databaseFile, '__drizzle_migrations'), migrazioniPrima);
  });
});

describe('isolamento dal database reale', () => {
  it('nessun processo avviato da questo file ha aperto una radice dati reale', () => {
    for (const cartella of temporanee) {
      if (!existsSync(path.join(cartella, 'logs'))) {
        continue;
      }

      const registrato = avvioRegistrato(cartella);
      assert.ok(registrato.dataRoot.startsWith(tmpdir()), `${registrato.dataRoot} non è temporanea`);
      for (const reale of radiciReali) {
        assert.ok(!registrato.database.startsWith(reale));
        assert.ok(!registrato.dataRoot.startsWith(reale));
      }
    }
  });
});
