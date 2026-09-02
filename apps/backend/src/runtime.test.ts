import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/**
 * Verifiche a livello di processo.
 *
 * Ciò che conta qui non si può provare in-process: che l'applicazione trovi i
 * propri dati partendo da una directory di lavoro arbitraria, che le
 * migrazioni continuino ad arrivare da `APP_ROOT`, e che due avvii successivi
 * sulla stessa radice dati vedano lo stesso archivio.
 *
 * Ogni avvio riceve una `DATA_ROOT` temporanea e una porta assegnata dal
 * sistema, e il test legge dal log del processo figlio quali percorsi ha
 * effettivamente usato: è la prova che il database reale non è stato aperto.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..', '..');
const mainEntry = path.join(here, 'main.ts');

/**
 * Il transpilatore va indicato con un percorso assoluto.
 *
 * `--import tsx` lo cercherebbe a partire dalla directory di lavoro del
 * processo figlio, che qui è deliberatamente una cartella arbitraria. Il
 * modulo `main.ts`, invece, risolve le proprie dipendenze dalla posizione del
 * file: è la differenza che questo file mette alla prova.
 */
const tsxCli = path.join(appRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

/**
 * Le radici dati reali: nessun processo di questo file deve toccarle.
 *
 * Sono due perché l'archivio si è spostato: `apps/backend/data` è la posizione
 * storica, `data/` quella introdotta con `DATA_ROOT`. Entrambe vanno
 * controllate — quella vecchia perché potrebbe esistere ancora su
 * un'installazione non migrata, quella nuova perché è dove i dati vivono ora.
 */
const realDataDirs = [
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
      // su Windows il file può restare bloccato: è comunque una cartella temporanea
    }
  }
});

/** Una porta libera, scelta dal sistema. */
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

interface Processo {
  readonly child: ChildProcess;
  readonly port: number;
  readonly dataRoot: string;
  readonly cwd: string;
  readonly output: () => string;
}

const attendi = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function avvia(dataRoot: string, cwd: string): Promise<Processo> {
  const port = await portaLibera();

  // L'ambiente viene costruito, non ereditato: `DATABASE_FILE` o `PORT`
  // lasciati dal processo di test cambierebbero silenziosamente il bersaglio.
  const env = { ...process.env };
  delete env.DATABASE_FILE;
  delete env.PORT;
  env.MYFINANCE_DATA = dataRoot;
  env.MYFINANCE_PORT = String(port);

  let output = '';
  const child = spawn(process.execPath, [tsxCli, mainEntry], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (blocco: string) => {
    output += blocco;
  });
  child.stderr?.on('data', (blocco: string) => {
    output += blocco;
  });

  const scadenza = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`il processo è terminato durante l'avvio:\n${output}`);
    }

    try {
      const risposta = await fetch(`http://127.0.0.1:${String(port)}/api/health`);
      if (risposta.ok) {
        break;
      }
    } catch {
      // non ancora in ascolto
    }

    if (Date.now() > scadenza) {
      throw new Error(`avvio non completato entro il tempo previsto:\n${output}`);
    }
    await attendi(200);
  }

  return { child, port, dataRoot, cwd, output: () => output };
}

async function termina(processo: Processo): Promise<number | null> {
  if (processo.child.exitCode !== null) {
    return processo.child.exitCode;
  }

  const uscita = new Promise<number | null>((resolve) => {
    processo.child.once('exit', (codice) => {
      resolve(codice);
    });
  });

  processo.child.kill('SIGINT');

  return uscita;
}

/** I percorsi che il processo figlio ha registrato all'avvio. */
interface AvvioRegistrato {
  readonly appRoot: string;
  readonly dataRoot: string;
  readonly database: string;
  readonly migrations: string;
  readonly cwd: string;
}

function avvioRegistrato(dataRoot: string): AvvioRegistrato {
  const logsDir = path.join(dataRoot, 'logs');
  const file = readdirSync(logsDir).find(
    (nome) => nome.startsWith('app-') && nome.endsWith('.log'),
  );
  assert.ok(file !== undefined, `nessun file di log in ${logsDir}`);

  const contenuto = readFileSync(path.join(logsDir, file), 'utf8');
  const riga = contenuto.split('\n').find((testo) => testo.includes('[info] Avvio '));
  assert.ok(riga !== undefined, 'il log deve contenere la riga di avvio con i percorsi');

  return JSON.parse(riga.slice(riga.indexOf('{'))) as AvvioRegistrato;
}

const sizeOf = (file: string): number | null => (existsSync(file) ? statSync(file).size : null);

describe('avvio da una directory di lavoro arbitraria', () => {
  it('trova i propri dati e le proprie migrazioni senza dipendere dal cwd', async () => {
    const dataRoot = cartellaTemporanea('appconto-rt-data-');
    const altrove = cartellaTemporanea('appconto-rt-cwd-');
    const processo = await avvia(dataRoot, altrove);

    try {
      assert.notEqual(path.resolve(altrove), path.resolve(appRoot));

      const avvio = avvioRegistrato(dataRoot);

      // I percorsi che il processo ha davvero usato.
      assert.equal(avvio.cwd, altrove, 'il processo girava altrove');
      assert.equal(avvio.appRoot, appRoot, 'APP_ROOT dedotto dal codice');
      assert.equal(avvio.dataRoot, dataRoot, 'DATA_ROOT preso dall’ambiente');
      assert.equal(avvio.database, path.join(dataRoot, 'database.sqlite'));
      assert.equal(
        avvio.migrations,
        path.join(appRoot, 'apps', 'backend', 'drizzle'),
        'le migrazioni restano un artefatto dell’applicazione',
      );

      // Isolamento: nessuna radice dati reale è stata nemmeno nominata.
      for (const reale of realDataDirs) {
        assert.ok(!avvio.database.startsWith(reale), 'il database reale non va toccato');
        assert.ok(!avvio.dataRoot.startsWith(reale));
      }

      // Il database è nato dove doveva, e non nel cwd.
      assert.ok(existsSync(path.join(dataRoot, 'database.sqlite')));
      assert.ok(!existsSync(path.join(altrove, 'data')), 'nulla deve essere creato nel cwd');

      // La struttura della radice dati è predisposta.
      for (const nome of ['backups', 'logs', 'tmp']) {
        assert.ok(existsSync(path.join(dataRoot, nome)), `manca ${nome}/`);
      }

      // Le migrazioni sono state applicate: il seed è arrivato da APP_ROOT.
      const categorie = (await (
        await fetch(`http://127.0.0.1:${String(processo.port)}/api/categories`)
      ).json()) as unknown[];
      assert.equal(categorie.length, 22);
    } finally {
      await termina(processo);
    }
  });
});

describe('logging sotto DATA_ROOT', () => {
  it('scrive un file giornaliero e non registra importi', async () => {
    const dataRoot = cartellaTemporanea('appconto-rt-log-');
    const processo = await avvia(dataRoot, cartellaTemporanea('appconto-rt-cwd-'));

    try {
      // Un import con righe volutamente non convertibili: il riepilogo passa
      // dal logger, e i valori grezzi non devono finire su disco.
      await fetch(`http://127.0.0.1:${String(processo.port)}/api/import/csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: [
          'Data contabile,Descrizione,Importo',
          '01/05/2026,MOVIMENTO BUONO,-12.34',
          'data-invalida,MOVIMENTO SCARTATO,-99999.99',
        ].join('\r\n'),
      });

      const logsDir = path.join(dataRoot, 'logs');
      const file = readdirSync(logsDir).find(
        (nome) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(nome),
      );
      assert.ok(file !== undefined, 'il nome del file deve seguire app-YYYY-MM-DD.log');

      const contenuto = readFileSync(path.join(logsDir, file), 'utf8');

      assert.match(contenuto, /\[info\] Avvio/);
      assert.match(contenuto, /Import CSV completato/);

      // Nessun importo, né quello riuscito né quello scartato.
      assert.ok(!contenuto.includes('12.34'), 'nessun importo nei log');
      assert.ok(!contenuto.includes('99999.99'), 'nessun importo scartato nei log');
      assert.ok(!contenuto.includes('MOVIMENTO BUONO'), 'nessuna descrizione nei log');
      assert.ok(!contenuto.includes('MOVIMENTO SCARTATO'), 'nessuna descrizione nei log');
    } finally {
      await termina(processo);
    }
  });
});

describe('due avvii consecutivi sulla stessa radice dati', () => {
  it('il secondo ritrova ciò che ha scritto il primo', async () => {
    const dataRoot = cartellaTemporanea('appconto-rt-persist-');
    const databaseFile = path.join(dataRoot, 'database.sqlite');

    const primo = await avvia(dataRoot, cartellaTemporanea('appconto-rt-cwd-'));
    const scrittura = await fetch(`http://127.0.0.1:${String(primo.port)}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initialBalance: 4321.99, balanceDate: '2026-05-01' }),
    });
    assert.equal(scrittura.status, 200);

    const walPrima = sizeOf(`${databaseFile}-wal`);
    assert.ok(walPrima !== null && walPrima > 0, 'il WAL contiene la scrittura appena fatta');

    const codice = await termina(primo);

    // Su Windows `process.kill` termina il processo senza consegnare il
    // segnale, quindi il gestore non gira e il WAL resta da consolidare: il
    // dato però non è mai a rischio, ed è questo che va verificato su ogni
    // piattaforma. L'arresto ordinato è provato in `shutdown.test.ts`.
    if (process.platform !== 'win32') {
      assert.equal(codice, 0, 'un arresto ordinato esce con zero');
      const walDopo = sizeOf(`${databaseFile}-wal`);
      assert.ok(walDopo === null || walDopo === 0, 'il WAL va consolidato alla chiusura');
    }

    const secondo = await avvia(dataRoot, cartellaTemporanea('appconto-rt-cwd-'));
    try {
      const impostazioni = (await (
        await fetch(`http://127.0.0.1:${String(secondo.port)}/api/settings`)
      ).json()) as { initialBalance: number; balanceDate: string | null };

      assert.equal(impostazioni.initialBalance, 4321.99, 'nessun dato perso fra i due avvii');
      assert.equal(impostazioni.balanceDate, '2026-05-01');

      // La seconda esecuzione ha usato lo stesso file, non uno nuovo.
      assert.equal(avvioRegistrato(dataRoot).database, databaseFile);
    } finally {
      await termina(secondo);
    }

    // Anche a processi spenti il file resta leggibile e completo.
    const riaperto = new Database(databaseFile, { readonly: true });
    const riga = riaperto.prepare('select initial_balance_cents as c from settings').get() as {
      c: number;
    };
    riaperto.close();

    assert.equal(riga.c, 432199);
  });
});

describe('isolamento dal database reale', () => {
  it('nessun processo avviato da questo file ha aperto la radice dati reale', () => {
    // Ogni avvio registra i percorsi usati: se anche uno solo avesse puntato
    // alla cartella reale, comparirebbe qui.
    for (const cartella of temporanee) {
      const logsDir = path.join(cartella, 'logs');
      if (!existsSync(logsDir)) {
        continue;
      }

      const avvio = avvioRegistrato(cartella);
      assert.ok(avvio.dataRoot.startsWith(tmpdir()), `${avvio.dataRoot} non è temporanea`);
      for (const reale of realDataDirs) {
        assert.ok(!avvio.database.startsWith(reale));
        assert.ok(!avvio.dataRoot.startsWith(reale));
      }
    }
  });
});
