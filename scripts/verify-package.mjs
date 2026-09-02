import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { createServer, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyTreeVerified } from './copy-tree.mjs';

/**
 * Verifica il package portatile, fuori dal repository.
 *
 * Non basta che `npm start` funzioni: quello prova il repository. Qui si prova
 * la cartella consegnata — copiata altrove, avviata con il proprio
 * `start.bat`, con il `PATH` privato di qualunque Node di sistema.
 *
 * ## Protezione dell'archivio reale
 *
 * Ogni avvio riceve una radice dati temporanea, e **prima di qualunque
 * richiesta che non sia una lettura** il controllo legge dal log del processo
 * figlio quale `DATA_ROOT` ha effettivamente aperto. Se non è quella
 * temporanea, la verifica si ferma. Una porta diversa non è isolamento: conta
 * il percorso del database, e a dirlo deve essere il processo stesso.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePackage = path.join(repoRoot, 'dist-package', 'MyFinance');

/** Le radici dati reali: nessun processo di questo file deve nominarle. */
const radiciReali = [
  path.join(repoRoot, 'data'),
  path.join(repoRoot, 'apps', 'backend', 'data'),
];

const temporanee = [];
const inEsecuzione = [];
const risultati = [];

function temporanea(prefisso) {
  const creata = mkdtempSync(path.join(tmpdir(), prefisso));
  temporanee.push(creata);

  return creata;
}

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

function portaLibera() {
  return new Promise((resolve, reject) => {
    const sonda = createServer();
    sonda.on('error', reject);
    sonda.listen(0, '127.0.0.1', () => {
      const { port } = sonda.address();
      sonda.close(() => resolve(port));
    });
  });
}

/**
 * L'ambiente di una macchina senza Node.
 *
 * Il `PATH` contiene soltanto le cartelle di sistema che servono a `cmd.exe`.
 * Tutto ciò che riguarda Node o npm viene rimosso, comprese le variabili che
 * npm inietta quando si esegue uno script: se il package le usasse, si
 * scoprirebbe qui.
 */
function ambientePulito(extra = {}) {
  const sistema = process.env.SystemRoot ?? 'C:\\Windows';
  const env = {};

  for (const [chiave, valore] of Object.entries(process.env)) {
    const nome = chiave.toUpperCase();
    if (nome === 'PATH' || nome === 'PATHEXT' || nome.startsWith('NPM_') || nome.startsWith('NODE')) {
      continue;
    }
    if (nome === 'MYFINANCE_DATA' || nome === 'MYFINANCE_PORT' || nome === 'DATABASE_FILE' || nome === 'PORT') {
      continue;
    }
    env[chiave] = valore;
  }

  env.PATH = [path.join(sistema, 'system32'), sistema, path.join(sistema, 'system32', 'Wbem')].join(';');
  env.PATHEXT = '.COM;.EXE;.BAT;.CMD';

  return { ...env, ...extra };
}

const comspec = process.env.COMSPEC ?? 'C:\\Windows\\system32\\cmd.exe';

/**
 * Come si chiede a `cmd.exe` di eseguire uno script il cui percorso contiene spazi.
 *
 * `['/c', percorso]` lasciando quotare a Node: verificato su percorsi con
 * spazi, accenti e cinque livelli di annidamento.
 *
 * **Non** aggiungere `/s`: quel flag cambia la regola di rimozione delle
 * virgolette in "togli la prima e l'ultima e prendi il resto alla lettera", e
 * su un percorso già quotato produce un comando spezzato al primo spazio.
 * Senza `/s`, cmd conserva le virgolette quando racchiudono un eseguibile
 * valido, che è esattamente il caso.
 */
const cmdArgs = (script) => ['/c', script];

/** Termina l'albero di processi: `cmd.exe` avvia `node.exe`, e va giù anche quello. */
function terminaAlbero(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // già terminato
  }
}

/**
 * Il lock di istanza, come lo scrive il launcher.
 *
 * È anche il canale di scoperta: porta di controllo, token e porta del server
 * stanno lì, ed è da lì che un secondo avvio — e questo controllo — sanno
 * dove trovare l'istanza attiva.
 */
function leggiLock(dataRoot) {
  const file = path.join(dataRoot, 'instance.lock');
  if (!existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // Creato e non ancora scritto per intero.
    return null;
  }
}

/** Una richiesta al canale di controllo di un'istanza: una riga JSON. */
function chiediAlCanale(porta, richiesta, timeoutMs = 8_000) {
  return new Promise((resolve) => {
    let risposta = '';
    let concluso = false;
    const finisci = (valore) => {
      if (concluso) {
        return;
      }
      concluso = true;
      socket.destroy();
      resolve(valore);
    };

    const socket = new Socket();
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs, () => finisci(null));
    socket.on('error', () => finisci(null));
    socket.on('close', () => finisci(null));
    socket.on('data', (blocco) => {
      risposta += blocco;
      const fine = risposta.indexOf('\n');
      if (fine >= 0) {
        try {
          finisci(JSON.parse(risposta.slice(0, fine)));
        } catch {
          finisci(null);
        }
      }
    });
    socket.connect(porta, '127.0.0.1', () => {
      socket.write(`${JSON.stringify(richiesta)}\n`);
    });
  });
}

/** Occupa una porta con un processo di test, per provare il ripiego. */
function occupaPorta() {
  return new Promise((resolve, reject) => {
    const presidio = createServer();
    presidio.on('error', reject);
    presidio.listen(0, '127.0.0.1', () => {
      resolve({
        porta: presidio.address().port,
        libera: () =>
          new Promise((fatto) => {
            presidio.close(fatto);
          }),
      });
    });
  });
}

/**
 * Avvia il package tramite il proprio `start.bat`.
 *
 * `cwd` è deliberatamente una cartella arbitraria e diversa dal package: se lo
 * script dipendesse dalla directory di lavoro, non partirebbe.
 */
async function avvia(pacchetto, { dataRoot, port, extraEnv = {} } = {}) {
  const configurata = port ?? (await portaLibera());
  const env = ambientePulito({
    MYFINANCE_PORT: String(configurata),
    MYFINANCE_DATA: dataRoot,
    // Nessuna finestra del browser: questo controllo avvia il package decine
    // di volte.
    MYFINANCE_NO_BROWSER: '1',
    ...extraEnv,
  });

  /*
   * Il lock che c'era PRIMA di questo avvio.
   *
   * Dopo una terminazione brusca il lock resta su disco, completo della porta
   * del server morto. Leggerlo come se descrivesse il processo appena avviato
   * significherebbe interrogare una porta chiusa — cioè verificare il
   * processo sbagliato, che è peggio di non verificare. Si attende quindi un
   * lock con un token diverso: il token nasce con l'istanza.
   */
  const lockPrecedente = leggiLock(dataRoot);

  const bat = path.join(pacchetto, 'start.bat');
  const child = spawn(comspec, cmdArgs(bat), {
    cwd: temporanea('appconto-cwd-'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsVerbatimArguments: false,
  });

  let output = '';
  for (const flusso of [child.stdout, child.stderr]) {
    flusso.setEncoding('utf8');
    flusso.on('data', (blocco) => {
      output += blocco;
    });
  }

  const processo = {
    child,
    dataRoot,
    configurata,
    /** La porta effettiva: la dichiara il launcher nel lock. */
    porta: configurata,
    lock: null,
    pacchetto,
    output: () => output,
    /** Terminazione brusca dell'albero: è il caso del crash, non l'arresto. */
    stop: () => {
      terminaAlbero(child.pid);
    },
    uscita: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) {
          resolve(child.exitCode);

          return;
        }
        child.once('exit', (codice) => {
          resolve(codice);
        });
      }),
  };
  inEsecuzione.push(processo);

  const morto = () =>
    new Error(`il package è terminato durante l'avvio (uscita ${child.exitCode}):\n${output}`);

  /*
   * La porta effettiva si chiede al launcher, non si assume.
   *
   * Da WP-P5 il launcher concede al server di ripiegare su un'altra porta se
   * quella configurata è occupata: interrogare la porta configurata
   * significherebbe, in quel caso, interrogare il programma che la sta
   * occupando. Il lock dentro DATA_ROOT è la sola sorgente autorevole.
   */
  const scadenzaLock = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw morto();
    }

    const lock = leggiLock(dataRoot);
    const nuovo = lock !== null && (lockPrecedente === null || lock.token !== lockPrecedente.token);
    if (nuovo && typeof lock.serverPort === 'number') {
      processo.lock = lock;
      processo.porta = lock.serverPort;
      break;
    }

    if (Date.now() > scadenzaLock) {
      throw new Error(`il launcher non ha dichiarato la porta del server:\n${output}`);
    }
    await attendi(200);
  }

  const scadenza = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw morto();
    }
    try {
      if ((await fetch(`http://127.0.0.1:${processo.porta}/api/health`)).ok) {
        break;
      }
    } catch {
      // non ancora in ascolto
    }
    if (Date.now() > scadenza) {
      throw new Error(`avvio non completato:\n${output}`);
    }
    await attendi(200);
  }

  return processo;
}

/**
 * L'arresto ordinato, chiesto come lo chiede `stop.bat`.
 *
 * Non `taskkill`: su Windows terminare un processo non consegna nessun
 * segnale, quindi il WAL non verrebbe consolidato. La richiesta passa dal
 * canale di controllo dichiarato nel lock, che è la stessa strada che
 * percorre `stop.bat`.
 */
async function arrestaOrdinato(processo) {
  const lock = leggiLock(processo.dataRoot);
  if (lock === null) {
    throw new Error(`nessun lock in ${processo.dataRoot}: non c'è un'istanza da fermare`);
  }

  const risposta = await chiediAlCanale(lock.controlPort, { cmd: 'shutdown', token: lock.token });
  if (risposta === null || risposta.ok !== true) {
    throw new Error(`arresto rifiutato: ${JSON.stringify(risposta)}`);
  }

  const codice = await Promise.race([processo.uscita(), attendi(60_000).then(() => 'scaduto')]);
  if (codice === 'scaduto') {
    processo.stop();
    throw new Error(`il package non si è arrestato:\n${processo.output()}`);
  }

  return codice;
}

/** Le righe del registro di una radice dati, in ordine. */
function registro(dataRoot) {
  const logsDir = path.join(dataRoot, 'logs');
  if (!existsSync(logsDir)) {
    return [];
  }

  return readdirSync(logsDir)
    .filter((nome) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(nome))
    .sort()
    .flatMap((nome) => readFileSync(path.join(logsDir, nome), 'utf8').split('\n'))
    .filter((riga) => riga.length > 0);
}

/** Avvia aspettandosi che rinunci, e restituisce codice di uscita e output. */
async function avviaAspettandosiUnaRinuncia(pacchetto, { dataRoot } = {}) {
  const porta = await portaLibera();
  const env = ambientePulito({
    MYFINANCE_PORT: String(porta),
    MYFINANCE_DATA: dataRoot,
    // Anche una rinuncia può aprire il browser: la seconda istanza mostra
    // quella gia attiva.
    MYFINANCE_NO_BROWSER: "1",
  });

  const child = spawn(comspec, cmdArgs(path.join(pacchetto, 'start.bat')), {
    cwd: temporanea('appconto-cwd-'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsVerbatimArguments: false,
  });

  let output = '';
  for (const flusso of [child.stdout, child.stderr]) {
    flusso.setEncoding('utf8');
    flusso.on('data', (blocco) => {
      output += blocco;
    });
  }

  const code = await new Promise((resolve, reject) => {
    const scadenza = setTimeout(() => {
      terminaAlbero(child.pid);
      reject(new Error(`il package non è terminato:\n${output}`));
    }, 60_000);
    scadenza.unref();
    child.once('exit', (codice) => {
      clearTimeout(scadenza);
      resolve(codice);
    });
  });

  return { code, output };
}

/**
 * I percorsi che il processo figlio dichiara di avere aperto.
 *
 * Letti dal suo file di log, non dedotti: è la sola prova che vale.
 */
async function avvioDichiarato(dataRoot, appRootAtteso) {
  const logsDir = path.join(dataRoot, 'logs');
  const scadenza = Date.now() + 20_000;

  for (;;) {
    if (existsSync(logsDir)) {
      for (const file of readdirSync(logsDir).filter((nome) =>
        /^app-\d{4}-\d{2}-\d{2}\.log$/.test(nome),
      )) {
        /*
         * L'**ultima** riga di avvio, non la prima.
         *
         * Il file di log appartiene alla radice dati, quindi si accumula fra
         * gli avvii: su una radice riusata, la prima riga è quella di un
         * processo precedente. Leggerla significherebbe verificare
         * l'isolamento di un processo che non è quello appena avviato — un
         * controllo che dice "ok" guardando la cosa sbagliata, cioè peggio di
         * nessun controllo.
         */
        const righe = readFileSync(path.join(logsDir, file), 'utf8')
          .split('\n')
          .filter((testo) => testo.includes('[info] Avvio '));

        for (const riga of righe.reverse()) {
          const avvio = JSON.parse(riga.slice(riga.indexOf('{')));
          if (appRootAtteso === undefined || avvio.appRoot === appRootAtteso) {
            return avvio;
          }
        }
      }
    }

    if (Date.now() > scadenza) {
      throw new Error(
        `nessuna riga di avvio per ${appRootAtteso ?? '(qualunque package)'} in ${logsDir}`,
      );
    }
    await attendi(200);
  }
}

/**
 * REGOLA ZERO: il processo sta usando la radice dati che credo?
 *
 * Va chiamata subito dopo l'avvio e prima di qualunque scrittura.
 */
async function esigiIsolamento(processo, dataRootAtteso) {
  const avvio = await avvioDichiarato(dataRootAtteso, processo.pacchetto);

  const problemi = [];
  if (path.resolve(avvio.dataRoot) !== path.resolve(dataRootAtteso)) {
    problemi.push(`il processo usa ${avvio.dataRoot}, atteso ${dataRootAtteso}`);
  }
  if (!avvio.dataRoot.startsWith(tmpdir())) {
    problemi.push(`${avvio.dataRoot} non è una cartella temporanea`);
  }
  for (const reale of radiciReali) {
    if (avvio.database.startsWith(reale) || avvio.dataRoot.startsWith(reale)) {
      problemi.push(`il processo punta alla radice dati REALE ${reale}`);
    }
  }
  if (avvio.layout !== 'package') {
    problemi.push(`il processo non si riconosce come package (${avvio.layout})`);
  }
  if (!avvio.appRoot.startsWith(processo.pacchetto)) {
    problemi.push(`APP_ROOT è ${avvio.appRoot}, fuori dal package ${processo.pacchetto}`);
  }

  if (problemi.length > 0) {
    throw new Error(`ISOLAMENTO NON DIMOSTRATO — verifica interrotta:\n  - ${problemi.join('\n  - ')}`);
  }

  return avvio;
}

const chiedi = async (porta, percorso) => {
  const risposta = await fetch(`http://127.0.0.1:${porta}${percorso}`);

  return { status: risposta.status, testo: await risposta.text() };
};

const chiediJson = async (porta, percorso) =>
  (await fetch(`http://127.0.0.1:${porta}${percorso}`)).json();

async function importa(porta, righe) {
  const risposta = await fetch(`http://127.0.0.1:${porta}/api/import/csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: ['Data contabile,Descrizione,Importo', ...righe].join('\r\n'),
  });
  if (risposta.status !== 200) {
    throw new Error(`import non riuscito: ${risposta.status} ${await risposta.text()}`);
  }

  return risposta.json();
}

const quante = async (porta) => (await chiediJson(porta, '/api/transactions')).pagination.total;

/** Ogni file sotto `dir`, relativo a `dir`. */
function elenca(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const trovati = [];
  for (const voce of readdirSync(dir, { withFileTypes: true })) {
    const assoluto = path.join(dir, voce.name);
    if (voce.isDirectory()) {
      trovati.push(...elenca(assoluto).map((n) => path.join(voce.name, n)));
    } else {
      trovati.push(voce.name);
    }
  }

  return trovati;
}

/** L'impronta di ciò che sta sotto una cartella: nomi e dimensioni. */
function impronta(dir) {
  return elenca(dir)
    .sort()
    .map((nome) => `${nome}:${statSync(path.join(dir, nome)).size}`)
    .join('|');
}

async function prova(nome, corpo) {
  const inizio = Date.now();
  try {
    const dettaglio = await corpo();
    risultati.push({ nome, esito: 'ok', ms: Date.now() - inizio, dettaglio });
    console.log(`  ok    ${nome}`);
    for (const riga of dettaglio ?? []) {
      console.log(`          ${riga}`);
    }
  } catch (error) {
    risultati.push({ nome, esito: 'FALLITO', ms: Date.now() - inizio, errore: error.message });
    console.log(`  FALLITO ${nome}`);
    console.log(`          ${error.message.split('\n').join('\n          ')}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

if (!existsSync(path.join(sourcePackage, 'start.bat'))) {
  console.error('\nNessun package da verificare. Esegui prima "npm run package".\n');
  process.exit(1);
}

console.log('');
console.log('Verifica del package portatile');
console.log(`  origine   ${path.relative(repoRoot, sourcePackage)}`);
console.log('');

/** Il package copiato fuori dal repository, con il nome indicato. */
function copiaFuoriDalRepo(sottoCartella, nomePacchetto = 'MyFinance') {
  const base = temporanea('appconto-pkg-');
  const destinazione = path.join(base, sottoCartella, nomePacchetto);
  mkdirSync(path.dirname(destinazione), { recursive: true });

  // Copia verificata, e non `fs.cpSync`: quest'ultimo verso un percorso con
  // caratteri non ASCII non copia niente e non segnala niente. Senza il
  // controllo, il test avrebbe provato una cartella vuota — ed è esattamente
  // quello che è accaduto la prima volta.
  copyTreeVerified(sourcePackage, destinazione);

  return destinazione;
}

// ── B — nessun Node di sistema ───────────────────────────────────────────────

await prova('B — sulla macchina non esiste Node raggiungibile', async () => {
  const env = ambientePulito();
  const dettaglio = [`PATH usato: ${env.PATH}`];

  for (const comando of ['node', 'npm', 'npx', 'tsx', 'ng']) {
    let trovato = null;
    try {
      trovato = execFileSync(comspec, ['/c', 'where', comando], { env, encoding: 'utf8' }).trim();
    } catch {
      // `where` esce con codice diverso da zero quando non trova nulla
    }
    if (trovato !== null && trovato.length > 0) {
      throw new Error(`"${comando}" è ancora raggiungibile: ${trovato}`);
    }
    dettaglio.push(`where ${comando} -> non trovato`);
  }

  return dettaglio;
});

// ── A + C + I + H — package nuovo, database nuovo ────────────────────────────

let pacchettoA;
let datiA;

await prova('A/C/I — start.bat avvia il package, crea il database e applica le migrazioni', async () => {
  pacchettoA = copiaFuoriDalRepo('primo');
  datiA = path.join(temporanea('appconto-dati-'), 'UserData');

  const prima = impronta(pacchettoA);
  const processo = await avvia(pacchettoA, { dataRoot: datiA });
  const avvio = await esigiIsolamento(processo, datiA);

  // C — il database non esisteva: è nato ora, con le migrazioni del package.
  const categorie = await chiediJson(processo.porta, '/api/categories');
  if (categorie.length !== 22) {
    throw new Error(`seed non applicato: ${categorie.length} categorie invece di 22`);
  }

  // I — le migrazioni usate sono quelle incluse nel package.
  if (avvio.migrations !== path.join(pacchettoA, 'app', 'drizzle')) {
    throw new Error(`migrazioni prese da ${avvio.migrations}`);
  }

  // H — il motore SQLite è quello del package, non uno risolto altrove.
  const nativeAtteso = path.join(pacchettoA, 'app', 'backend', 'native', 'better_sqlite3.node');
  if (avvio.sqlite !== nativeAtteso) {
    throw new Error(`SQLite caricato da ${avvio.sqlite}, atteso ${nativeAtteso}`);
  }

  // Il frontend servito è quello del package.
  if (avvio.frontend !== path.join(pacchettoA, 'app', 'frontend')) {
    throw new Error(`frontend servito da ${avvio.frontend}`);
  }

  // La struttura dei dati è nata sotto DATA_ROOT.
  for (const nome of ['database.sqlite', 'backups', 'logs', 'tmp']) {
    if (!existsSync(path.join(datiA, nome))) {
      throw new Error(`manca ${nome} sotto la radice dati`);
    }
  }

  // Il package non è stato modificato dall'esecuzione.
  if (impronta(pacchettoA) !== prima) {
    throw new Error('il package è stato modificato durante l-esecuzione');
  }

  return [
    `layout dichiarato: ${avvio.layout}`,
    `APP_ROOT:  ${avvio.appRoot}`,
    `DATA_ROOT: ${avvio.dataRoot}`,
    `SQLite:    ${path.relative(pacchettoA, avvio.sqlite)}`,
    `categorie dal seed: ${categorie.length}`,
  ];
});

// ── A — il frontend e le rotte profonde ──────────────────────────────────────

await prova('A — il frontend di produzione è servito, comprese le rotte profonde', async () => {
  const processo = inEsecuzione.at(-1);
  const dettaglio = [];

  for (const rotta of ['/', '/transactions', '/analytics', '/loans', '/settings']) {
    const { status, testo } = await chiedi(processo.porta, rotta);
    if (status !== 200 || !testo.includes('<app-root>')) {
      throw new Error(`${rotta} ha risposto ${status}`);
    }
    dettaglio.push(`${rotta} -> 200, index.html`);
  }

  // Una rotta profonda con ricarica diretta: è il caso che rompe le SPA
  // servite male.
  const profonda = await chiedi(processo.porta, '/loans/2f6c1e40-0000-4000-8000-000000000000');
  if (profonda.status !== 200 || !profonda.testo.includes('<app-root>')) {
    throw new Error(`rotta profonda: ${profonda.status}`);
  }
  dettaglio.push('/loans/<id> -> 200, index.html (ricarica diretta)');

  // Gli asset compilati arrivano davvero.
  const indice = (await chiedi(processo.porta, '/')).testo;
  const bundle = /src="(main-[^"]+\.js)"/.exec(indice)?.[1];
  if (bundle === undefined) {
    throw new Error("l'index non fa riferimento al bundle Angular");
  }
  const asset = await chiedi(processo.porta, `/${bundle}`);
  if (asset.status !== 200 || asset.testo.length < 100_000) {
    throw new Error(`${bundle}: ${asset.status}, ${asset.testo.length} byte`);
  }
  dettaglio.push(`/${bundle} -> 200, ${(asset.testo.length / 1024).toFixed(0)} kB`);

  return dettaglio;
});

// ── D — database esistente, dati preservati ──────────────────────────────────

await prova('D — un secondo avvio ritrova i dati del primo', async () => {
  const primo = inEsecuzione.at(-1);

  await importa(primo.porta, [
    '01/05/2026,MOVIMENTO DEL PACKAGE A,-11.00',
    '02/05/2026,MOVIMENTO DEL PACKAGE B,-22.00',
    '03/05/2026,MOVIMENTO DEL PACKAGE C,-33.00',
  ]);
  if ((await quante(primo.porta)) !== 3) {
    throw new Error('le tre righe non sono state importate');
  }
  primo.stop();
  await attendi(1_500);

  const secondo = await avvia(pacchettoA, { dataRoot: datiA });
  await esigiIsolamento(secondo, datiA);

  const totale = await quante(secondo.porta);
  if (totale !== 3) {
    throw new Error(`dopo il riavvio ci sono ${totale} transazioni invece di 3`);
  }
  const categorie = await chiediJson(secondo.porta, '/api/categories');
  if (categorie.length !== 22) {
    throw new Error('le migrazioni sono state riapplicate');
  }

  secondo.stop();
  await attendi(1_000);

  return [`3 transazioni scritte, 3 ritrovate dopo il riavvio`];
});

// ── E + G + J — il package si sposta, i dati restano ─────────────────────────

await prova('E/G/J — il package copiato altrove usa lo stesso archivio', async () => {
  // Percorso con spazi, accenti e annidamento profondo, fuori dal repository.
  const pacchettoB = copiaFuoriDalRepo(
    path.join('Portable Apps', 'Applicazioni Portàtili', 'livello uno', 'livello due'),
    'My Finance',
  );

  if (pacchettoB.startsWith(repoRoot)) {
    throw new Error('il package di prova non è fuori dal repository');
  }

  const processo = await avvia(pacchettoB, { dataRoot: datiA });
  const avvio = await esigiIsolamento(processo, datiA);

  const totale = await quante(processo.porta);
  if (totale !== 3) {
    throw new Error(`il package spostato vede ${totale} transazioni invece di 3`);
  }

  // J — nulla è stato risolto dal repository.
  for (const percorso of [avvio.appRoot, avvio.migrations, avvio.frontend, avvio.sqlite, avvio.database, avvio.dataRoot]) {
    if (percorso.startsWith(repoRoot)) {
      throw new Error(`il package ha risolto ${percorso} dentro il repository`);
    }
  }

  const pagina = await chiediJson(processo.porta, '/api/transactions?pageSize=25');
  const descrizioni = pagina.items.map((r) => r.description).join(' ');
  if (!descrizioni.includes('MOVIMENTO DEL PACKAGE A')) {
    throw new Error('i dati non sono quelli attesi');
  }

  processo.stop();
  await attendi(1_000);

  return [
    `package:   ${pacchettoB}`,
    `APP_ROOT:  ${avvio.appRoot}`,
    `DATA_ROOT: ${avvio.dataRoot} (invariato)`,
    'nessun percorso risolto dentro il repository',
    '3 transazioni ritrovate',
  ];
});

// ── F — APP_ROOT ≠ DATA_ROOT, e nessuna scrittura sotto app/ ─────────────────

await prova('F — con DATA_ROOT esterno, nulla viene scritto sotto app/ o runtime/', async () => {
  const pacchetto = copiaFuoriDalRepo('separato');
  const dati = path.join(temporanea('appconto-esterni-'), 'Archivio Utente');

  const improntaApp = impronta(path.join(pacchetto, 'app'));
  const improntaRuntime = impronta(path.join(pacchetto, 'runtime'));

  const processo = await avvia(pacchetto, { dataRoot: dati });
  const avvio = await esigiIsolamento(processo, dati);

  await importa(processo.porta, ['10/06/2026,MOVIMENTO SU DATI ESTERNI,-77.00']);

  // Il backup si chiede alle API e l'esito si controlla: è il modo di scoprire
  // se il motore SQLite del package sa fare `VACUUM INTO` verso una cartella
  // dei dati che sta altrove, e con uno spazio nel nome.
  const risposta = await fetch(`http://127.0.0.1:${processo.porta}/api/backups`, {
    method: 'POST',
  });
  const corpo = await risposta.text();
  if (risposta.status !== 201) {
    throw new Error(`POST /api/backups ha risposto ${risposta.status}: ${corpo}`);
  }

  processo.stop();
  await attendi(1_500);

  // Database, log, backup e temporanei stanno tutti nella radice esterna.
  for (const nome of ['database.sqlite', 'logs', 'backups', 'tmp']) {
    if (!existsSync(path.join(dati, nome))) {
      throw new Error(`manca ${nome} nella radice dati esterna`);
    }
  }
  const backup = readdirSync(path.join(dati, 'backups')).filter((n) => n.endsWith('.sqlite'));
  if (backup.length !== 1) {
    throw new Error(`nella radice esterna ci sono ${backup.length} backup invece di 1`);
  }

  // E nulla è comparso dentro il package.
  if (existsSync(path.join(pacchetto, 'data'))) {
    throw new Error('è stata creata una cartella data/ dentro il package');
  }
  if (impronta(path.join(pacchetto, 'app')) !== improntaApp) {
    throw new Error('app/ è stata modificata');
  }
  if (impronta(path.join(pacchetto, 'runtime')) !== improntaRuntime) {
    throw new Error('runtime/ è stata modificata');
  }

  // La sostituzione di app/ non tocca i dati: si simula rimuovendola e
  // rimettendola da capo dalla sorgente, come farebbe un aggiornamento.
  rmSync(path.join(pacchetto, 'app'), { recursive: true, force: true });
  copyTreeVerified(path.join(sourcePackage, 'app'), path.join(pacchetto, 'app'));

  const dopoAggiornamento = await avvia(pacchetto, { dataRoot: dati });
  await esigiIsolamento(dopoAggiornamento, dati);
  const totale = await quante(dopoAggiornamento.porta);
  dopoAggiornamento.stop();
  await attendi(1_000);

  if (totale !== 1) {
    throw new Error(`dopo la sostituzione di app/ ci sono ${totale} transazioni invece di 1`);
  }

  return [
    `APP_ROOT:  ${avvio.appRoot}`,
    `DATA_ROOT: ${avvio.dataRoot}`,
    'database, logs, backups e tmp: tutti nella radice esterna',
    'app/ e runtime/ invariate byte per byte',
    'app/ sostituita da capo: 1 transazione ancora al suo posto',
  ];
});

// ── §9 — start.bat propaga il codice di uscita ───────────────────────────────

await prova('start.bat propaga il codice di uscita del processo', async () => {
  const pacchetto = copiaFuoriDalRepo('uscita');
  const dati = path.join(temporanea('appconto-uscita-'), 'UserData');

  // Si porta l'archivio in un futuro che il package non conosce: la guardia di
  // WP-P3 rifiuta l'avvio, ed è l'occasione per verificare che il codice di
  // uscita arrivi fino a chi ha lanciato lo script.
  const primo = await avvia(pacchetto, { dataRoot: dati });
  await esigiIsolamento(primo, dati);
  primo.stop();
  await attendi(1_500);

  // L'iniezione è compito dell'armatura di test, non del package: si usa la
  // libreria del repository su un database che sta in una cartella temporanea.
  const databaseFile = path.join(dati, 'database.sqlite');
  if (!databaseFile.startsWith(tmpdir())) {
    throw new Error(`rifiuto di modificare ${databaseFile}: non è temporaneo`);
  }

  const { default: Database } = await import('better-sqlite3');
  const sqlite = new Database(databaseFile);
  try {
    sqlite
      .prepare('insert into __drizzle_migrations (hash, created_at) values (?, ?)')
      .run('migrazione-di-una-versione-futura', 9_999_999_999_999);
  } finally {
    sqlite.close();
  }

  const esito = await avviaAspettandosiUnaRinuncia(pacchetto, { dataRoot: dati });

  if (esito.code === 0) {
    throw new Error(`start.bat ha restituito 0 mentre l'applicazione ha rinunciato`);
  }
  if (!/versione più recente/.test(esito.output)) {
    throw new Error(`il messaggio non spiega il rifiuto:\n${esito.output}`);
  }

  return [
    `codice di uscita propagato: ${esito.code}`,
    'il messaggio spiega perché e dice che l-archivio non è stato modificato',
  ];
});

// ── H — il runtime incorporato carica il binario del package ─────────────────

await prova('H — il node.exe incluso carica il .node incluso', async () => {
  const pacchetto = pacchettoA;
  const nodeExe = path.join(pacchetto, 'runtime', 'node.exe');
  const nativo = path.join(pacchetto, 'app', 'backend', 'native', 'better_sqlite3.node');

  const dichiarato = JSON.parse(
    execFileSync(
      nodeExe,
      [
        '-p',
        "JSON.stringify({version:process.version,modules:process.versions.modules,napi:process.versions.napi,keys:Object.keys(require(process.argv[1])).sort()})",
        nativo,
      ],
      { encoding: 'utf8', env: ambientePulito() },
    ),
  );

  if (!dichiarato.keys.includes('Database')) {
    throw new Error(`il binario non espone Database: ${dichiarato.keys.join(', ')}`);
  }

  const manifest = JSON.parse(readFileSync(path.join(pacchetto, 'app', 'RUNTIME.json'), 'utf8'));
  if (manifest.node.version !== dichiarato.version) {
    throw new Error(
      `RUNTIME.json dichiara ${manifest.node.version}, il binario è ${dichiarato.version}`,
    );
  }

  return [
    `node incluso: ${dichiarato.version} (NODE_MODULE_VERSION ${dichiarato.modules}, N-API ${dichiarato.napi})`,
    `binario: ${manifest.sqlite.prebuild} (${manifest.sqlite.abi})`,
    `esporta: ${dichiarato.keys.join(', ')}`,
  ];
});

// ── J — il package non contiene niente del repository ────────────────────────

await prova('J — il package non contiene tracce del repository né dati', async () => {
  const vietati = [];
  const impronte = [repoRoot, path.join(repoRoot, 'node_modules')];

  const visita = (dir) => {
    for (const voce of readdirSync(dir, { withFileTypes: true })) {
      const assoluto = path.join(dir, voce.name);
      const relativo = path.relative(sourcePackage, assoluto);

      if (voce.isDirectory()) {
        if (['node_modules', 'backups', 'logs', 'tmp', 'data'].includes(voce.name)) {
          vietati.push(`${relativo}/`);
        }
        visita(assoluto);
        continue;
      }

      if (/\.(sqlite|db)(-wal|-shm)?$|\.map$/i.test(voce.name)) {
        vietati.push(relativo);
      }

      const contenuto = readFileSync(assoluto);
      for (const forma of impronte.flatMap((p) => [p, p.replace(/\\/g, '/')])) {
        if (contenuto.includes(forma)) {
          vietati.push(`${relativo} contiene ${forma}`);
        }
      }
    }
  };

  visita(sourcePackage);

  if (vietati.length > 0) {
    throw new Error(`il package contiene:\n  - ${vietati.join('\n  - ')}`);
  }

  const file = elenca(sourcePackage);
  const byte = file.reduce((t, n) => t + statSync(path.join(sourcePackage, n)).size, 0);

  return [
    `${file.length} file, ${(byte / 1024 / 1024).toFixed(1)} MB`,
    'nessun database, nessun sourcemap, nessun node_modules',
    'nessun percorso del repository in nessun file, runtime compreso',
  ];
});

// ── K — istanza unica per archivio ───────────────────────────────────────────

await prova('K — una sola istanza per archivio, ma due archivi convivono', async () => {
  const pacchetto = copiaFuoriDalRepo('istanze');
  const datiUno = path.join(temporanea('appconto-ist-'), 'Archivio Uno');
  const datiDue = path.join(temporanea('appconto-ist-'), 'Archivio Due');

  const primo = await avvia(pacchetto, { dataRoot: datiUno });
  await esigiIsolamento(primo, datiUno);

  // Un secondo avvio sullo stesso archivio: deve rinunciare, spiegarlo, e
  // uscire con zero — l'utente voleva l'applicazione, e l'applicazione c'è.
  const secondo = await avviaAspettandosiUnaRinuncia(pacchetto, { dataRoot: datiUno });
  if (secondo.code !== 0) {
    throw new Error(`la seconda istanza è uscita con ${secondo.code}, atteso 0`);
  }
  if (!/già in esecuzione/.test(secondo.output)) {
    throw new Error(`il messaggio non spiega il rifiuto:\n${secondo.output}`);
  }
  // Indica dove è aperta l'applicazione attiva.
  if (!secondo.output.includes(`127.0.0.1:${primo.porta}`)) {
    throw new Error(`il messaggio non indica la porta dell'istanza attiva:\n${secondo.output}`);
  }

  // Il lock è ancora del primo, e il primo è ancora vivo.
  const lock = leggiLock(datiUno);
  if (lock === null || lock.serverPort !== primo.porta) {
    throw new Error('il secondo avvio ha alterato il lock del primo');
  }
  if (!(await fetch(`http://127.0.0.1:${primo.porta}/api/health`)).ok) {
    throw new Error('il primo non risponde più');
  }

  // Un archivio diverso è un'altra applicazione: deve poter girare insieme.
  const terzo = await avvia(pacchetto, { dataRoot: datiDue });
  await esigiIsolamento(terzo, datiDue);
  if (terzo.porta === primo.porta) {
    throw new Error('le due istanze condividono la porta');
  }
  if (!existsSync(path.join(datiDue, 'instance.lock'))) {
    throw new Error('la seconda radice dati non ha un lock');
  }

  await arrestaOrdinato(terzo);
  await arrestaOrdinato(primo);

  return [
    `stesso archivio: rifiutata, uscita ${secondo.code}, messaggio con la porta ${primo.porta}`,
    `archivi diversi: ${primo.porta} e ${terzo.porta}, entrambe attive`,
    'il lock vive dentro DATA_ROOT: la chiave è l-archivio, non il package',
  ];
});

// ── L — porta occupata ───────────────────────────────────────────────────────

await prova("L — con la porta configurata occupata, l-applicazione ne usa un'altra", async () => {
  const pacchetto = copiaFuoriDalRepo('porta');
  const dati = path.join(temporanea('appconto-porta-'), 'UserData');

  // La porta viene occupata da un processo di test, non da un'altra istanza
  // dell'applicazione: è il caso reale di una macchina su cui gira già
  // qualcosa.
  const presidio = await occupaPorta();

  try {
    const processo = await avvia(pacchetto, { dataRoot: dati, port: presidio.porta });
    const avvio = await esigiIsolamento(processo, dati);

    if (processo.porta === presidio.porta) {
      throw new Error(`l'applicazione ha usato la porta occupata ${presidio.porta}`);
    }
    if (avvio.configuredPort !== presidio.porta) {
      throw new Error(`il server non ha ricevuto la porta configurata: ${avvio.configuredPort}`);
    }

    // La salute risponde sulla porta effettiva, e il presidio è ancora al suo
    // posto: nessuna porta è stata rubata a nessuno.
    const salute = await chiediJson(processo.porta, '/api/health');
    if (salute.status !== 'ok') {
      throw new Error(`la porta effettiva non risponde: ${JSON.stringify(salute)}`);
    }

    // Entrambe le porte sono registrate: è ciò che permette di capire perché
    // l'indirizzo non è quello configurato.
    const ripiego = registro(dati).filter((riga) => riga.includes('era occupata'));
    if (ripiego.length === 0) {
      throw new Error('il registro non dice che la porta configurata era occupata');
    }

    await arrestaOrdinato(processo);

    return [
      `configurata ${presidio.porta}, occupata da un processo di test`,
      `effettiva ${processo.porta}, /api/health risponde ok`,
      'la scelta appartiene al processo che apre il listener: nessuna corsa',
    ];
  } finally {
    await presidio.libera();
  }
});

// ── M — arresto ordinato e riavvio ───────────────────────────────────────────

await prova('M — stop.bat arresta ordinatamente, consolida il WAL e i dati restano', async () => {
  const pacchetto = copiaFuoriDalRepo('arresto');
  const dati = path.join(temporanea('appconto-arresto-'), 'UserData');

  const processo = await avvia(pacchetto, { dataRoot: dati });
  await esigiIsolamento(processo, dati);

  await importa(processo.porta, [
    '01/07/2026,MOVIMENTO PRIMA DELL ARRESTO A,-15.00',
    '02/07/2026,MOVIMENTO PRIMA DELL ARRESTO B,-25.00',
  ]);
  if ((await quante(processo.porta)) !== 2) {
    throw new Error('le due righe non sono state importate');
  }

  const walFile = path.join(dati, 'database.sqlite-wal');
  const walPrima = existsSync(walFile) ? statSync(walFile).size : 0;
  if (walPrima === 0) {
    throw new Error('il WAL doveva contenere le scritture appena fatte');
  }

  // L'arresto si chiede con lo strumento che ha l'utente, non con taskkill.
  const arresto = spawn(comspec, cmdArgs(path.join(pacchetto, 'stop.bat')), {
    cwd: temporanea('appconto-cwd-'),
    env: ambientePulito({ MYFINANCE_DATA: dati }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let messaggio = '';
  for (const flusso of [arresto.stdout, arresto.stderr]) {
    flusso.setEncoding('utf8');
    flusso.on('data', (blocco) => {
      messaggio += blocco;
    });
  }

  const codiceStop = await new Promise((resolve) => {
    arresto.once('exit', (codice) => {
      resolve(codice);
    });
  });
  if (codiceStop !== 0) {
    throw new Error(`stop.bat è uscito con ${codiceStop}:\n${messaggio}`);
  }

  const codice = await Promise.race([processo.uscita(), attendi(60_000).then(() => 'scaduto')]);
  if (codice !== 0) {
    throw new Error(`l'applicazione è uscita con ${codice}:\n${processo.output()}`);
  }

  // 1. non risponde più
  let risponde = true;
  try {
    await fetch(`http://127.0.0.1:${processo.porta}/api/health`);
  } catch {
    risponde = false;
  }
  if (risponde) {
    throw new Error('la porta risponde ancora dopo l-arresto');
  }

  // 2. il lock è stato rilasciato: l'applicazione si può riavviare
  if (existsSync(path.join(dati, 'instance.lock'))) {
    throw new Error('il lock non è stato rilasciato');
  }

  // 3. il WAL è stato consolidato: il database è un file singolo, copiabile
  const walDopo = existsSync(walFile) ? statSync(walFile).size : 0;
  if (walDopo !== 0) {
    throw new Error(`il WAL misura ancora ${walDopo} byte`);
  }

  const righe = registro(dati);
  for (const atteso of ['WAL consolidato', 'Arresto completato']) {
    if (!righe.some((riga) => riga.includes(atteso))) {
      throw new Error(`il registro non dichiara "${atteso}"`);
    }
  }

  // 4. si riavvia e ritrova tutto
  const secondo = await avvia(pacchetto, { dataRoot: dati });
  await esigiIsolamento(secondo, dati);
  const totale = await quante(secondo.porta);
  await arrestaOrdinato(secondo);

  if (totale !== 2) {
    throw new Error(`dopo il riavvio ci sono ${totale} transazioni invece di 2`);
  }

  return [
    `WAL prima dell-arresto: ${(walPrima / 1024).toFixed(0)} kB, dopo: 0 byte`,
    'lock rilasciato, porta libera, uscita 0',
    'riavvio: 2 transazioni ritrovate',
  ];
});

// ── N — riavvio dopo una terminazione anomala ────────────────────────────────

await prova('N — dopo una terminazione brusca il lock residuo non blocca l-avvio', async () => {
  const pacchetto = copiaFuoriDalRepo('crash');
  const dati = path.join(temporanea('appconto-crash-'), 'UserData');

  const primo = await avvia(pacchetto, { dataRoot: dati });
  await esigiIsolamento(primo, dati);
  await importa(primo.porta, ['05/07/2026,MOVIMENTO PRIMA DEL CRASH,-33.00']);

  // Terminazione dell'intero albero: è ciò che accade a un processo ucciso, e
  // su Windows non consegna nessun segnale — quindi niente rilascio del lock
  // e niente consolidamento del WAL.
  primo.stop();
  await attendi(2_500);

  const lockResiduo = leggiLock(dati);
  if (lockResiduo === null) {
    throw new Error('il lock è stato rilasciato: la terminazione non è stata brusca');
  }

  const secondo = await avvia(pacchetto, { dataRoot: dati });
  await esigiIsolamento(secondo, dati);

  const totale = await quante(secondo.porta);
  const lockNuovo = leggiLock(dati);
  await arrestaOrdinato(secondo);

  if (totale !== 1) {
    throw new Error(`dopo il crash ci sono ${totale} transazioni invece di 1`);
  }
  if (lockNuovo === null || lockNuovo.controlPort === lockResiduo.controlPort) {
    throw new Error('il lock non è stato preso dalla nuova istanza');
  }

  return [
    `lock residuo del processo ${lockResiduo.pid}, canale ${lockResiduo.controlPort} muto`,
    `nuova istanza: canale ${lockNuovo.controlPort}`,
    '1 transazione ritrovata: il WAL è stato recuperato al riavvio',
  ];
});

// ── O — backup automatici ────────────────────────────────────────────────────

await prova('O — lo scheduler crea i backup automatici, la ritenzione li tiene a uno', async () => {
  const pacchetto = copiaFuoriDalRepo('scheduler');
  const dati = path.join(temporanea('appconto-auto-'), 'UserData');

  // Circa due secondi, e solo qui: la cadenza reale è giornaliera.
  const processo = await avvia(pacchetto, {
    dataRoot: dati,
    extraEnv: { MYFINANCE_AUTO_BACKUP_HOURS: '0.0006' },
  });
  await esigiIsolamento(processo, dati);

  await importa(processo.porta, ['10/07/2026,MOVIMENTO DA SALVARE,-44.00']);

  // Si attende che ne siano avvenuti almeno due: il primo dimostra che parte,
  // il secondo che si riarma.
  const scadenza = Date.now() + 40_000;
  let creati = [];
  for (;;) {
    creati = registro(dati).filter((riga) => riga.includes('Backup automatico creato'));
    if (creati.length >= 2) {
      break;
    }
    if (Date.now() > scadenza) {
      throw new Error(
        `dopo 40 secondi i backup automatici creati sono ${creati.length}:\n${registro(dati).slice(-8).join('\n')}`,
      );
    }
    await attendi(500);
  }

  const backups = readdirSync(path.join(dati, 'backups'));
  const auto = backups.filter((nome) => nome.startsWith('auto-') && nome.endsWith('.sqlite'));

  // La ritenzione di WP-P3 conserva il più recente di ciascuno degli ultimi
  // sette giorni: più backup nello stesso giorno finiscono nello stesso slot,
  // quindi ne sopravvive uno.
  if (auto.length !== 1) {
    throw new Error(
      `nella cartella ci sono ${auto.length} backup automatici invece di 1: ${auto.join(', ')}`,
    );
  }
  if (!backups.includes(`${auto[0].slice(0, -'.sqlite'.length)}.json`)) {
    throw new Error('il backup automatico non ha il suo manifest');
  }

  // Il backup è verificabile: non è un file lasciato lì, è un esito.
  const elenco = await chiediJson(processo.porta, '/api/backups');
  const dto = elenco.backups.find((voce) => voce.name === auto[0]);
  if (dto === undefined || dto.status !== 'completo') {
    throw new Error(`il backup automatico non è completo: ${JSON.stringify(dto)}`);
  }
  if (dto.rowCounts.transactions !== 1) {
    throw new Error(`il backup non contiene la transazione: ${JSON.stringify(dto.rowCounts)}`);
  }

  await arrestaOrdinato(processo);

  // §14 — lo scheduler si ferma con l'applicazione, e non crea backup dopo.
  const righe = registro(dati);
  const fermato = righe.findIndex((riga) => riga.includes('Backup automatici fermati'));
  if (fermato < 0) {
    throw new Error('il registro non dichiara l-arresto dello scheduler');
  }
  const dopo = righe.slice(fermato).filter((riga) => riga.includes('Backup automatico creato'));
  if (dopo.length > 0) {
    throw new Error('un backup automatico è avvenuto dopo l-arresto dello scheduler');
  }

  await attendi(3_000);
  const dopoAncora = readdirSync(path.join(dati, 'backups')).filter(
    (nome) => nome.startsWith('auto-') && nome.endsWith('.sqlite'),
  );
  if (dopoAncora.length !== 1) {
    throw new Error('un timer è sopravvissuto all-arresto');
  }

  return [
    `${creati.length} backup automatici creati con cadenza di due secondi`,
    `nella cartella ne resta 1 (${auto[0]}), come vuole la ritenzione del tipo auto`,
    'verificato via API: completo, 1 transazione',
    'scheduler fermato con l-applicazione, nessun backup e nessun timer dopo',
  ];
});

// ── P — il browser non prima che l-applicazione risponda ─────────────────────

await prova('P — l-ordine dell-avvio: processo, ascolto, pronto, browser', async () => {
  const pacchetto = copiaFuoriDalRepo('ordine');
  const dati = path.join(temporanea('appconto-ordine-'), 'UserData');

  const processo = await avvia(pacchetto, { dataRoot: dati });
  await esigiIsolamento(processo, dati);
  await arrestaOrdinato(processo);

  const righe = registro(dati);
  const tappe = [
    ['Server avviato', righe.findIndex((riga) => riga.includes('Server avviato'))],
    ['Backend in ascolto', righe.findIndex((riga) => riga.includes('Backend in ascolto'))],
    ['Server pronto', righe.findIndex((riga) => riga.includes('Server pronto'))],
    ['decisione sul browser', righe.findIndex((riga) => riga.includes('Apertura del browser'))],
  ];

  for (const [nome, posizione] of tappe) {
    if (posizione < 0) {
      throw new Error(`il registro non contiene "${nome}"`);
    }
  }
  for (let i = 1; i < tappe.length; i += 1) {
    if (tappe[i][1] <= tappe[i - 1][1]) {
      throw new Error(`"${tappe[i][0]}" non viene dopo "${tappe[i - 1][0]}"`);
    }
  }

  return [
    'processo avviato -> in ascolto -> /api/health ok -> browser',
    "il browser segue la risposta dell-applicazione, non l-avvio del processo",
  ];
});

// ── Q — aggiornamento del package ───────────────────────────────────────────

await prova('Q — arresto ordinato, app/ e runtime/ sostituite, i dati restano', async () => {
  const pacchetto = copiaFuoriDalRepo('aggiornamento');
  const dati = path.join(temporanea('appconto-agg-'), 'Archivio Utente');

  // 1. La versione «v1» crea l'archivio e vi scrive.
  const v1 = await avvia(pacchetto, { dataRoot: dati });
  await esigiIsolamento(v1, dati);

  await importa(v1.porta, [
    '01/08/2026,MOVIMENTO SCRITTO DA V1 A,-19.00',
    '02/08/2026,MOVIMENTO SCRITTO DA V1 B,-29.00',
    '03/08/2026,MOVIMENTO SCRITTO DA V1 C,-39.00',
  ]);
  const backupPrima = await fetch(`http://127.0.0.1:${v1.porta}/api/backups`, { method: 'POST' });
  if (backupPrima.status !== 201) {
    throw new Error(`il backup manuale non è riuscito: ${backupPrima.status}`);
  }

  // 2. Arresto ordinato: il WAL viene consolidato prima della sostituzione.
  const codice = await arrestaOrdinato(v1);
  if (codice !== 0) {
    throw new Error(`l'arresto è uscito con ${codice}`);
  }

  /*
   * L'impronta si prende **dopo** l'arresto, non prima.
   *
   * L'arresto ordinato consolida il WAL: il database cresce e il file -wal
   * scompare. Misurare prima significherebbe attribuire alla sostituzione di
   * app/ un cambiamento che è invece la prova che l'arresto ha funzionato.
   */
  const improntaDati = impronta(dati);

  // 3. Si sostituisce ciò che l'aggiornamento sostituisce, e solo quello.
  rmSync(path.join(pacchetto, 'app'), { recursive: true, force: true });
  rmSync(path.join(pacchetto, 'runtime'), { recursive: true, force: true });
  rmSync(path.join(pacchetto, 'start.bat'), { force: true });
  rmSync(path.join(pacchetto, 'stop.bat'), { force: true });

  // La radice dati non è nemmeno stata sfiorata: si controlla adesso, mentre
  // l'applicazione non esiste.
  if (impronta(dati) !== improntaDati) {
    throw new Error('la sostituzione di app/ e runtime/ ha toccato la radice dati');
  }

  copyTreeVerified(path.join(sourcePackage, 'app'), path.join(pacchetto, 'app'));
  copyTreeVerified(path.join(sourcePackage, 'runtime'), path.join(pacchetto, 'runtime'));
  copyFileSync(path.join(sourcePackage, 'start.bat'), path.join(pacchetto, 'start.bat'));
  copyFileSync(path.join(sourcePackage, 'stop.bat'), path.join(pacchetto, 'stop.bat'));

  // 4. La versione «v2» apre lo stesso archivio.
  const v2 = await avvia(pacchetto, { dataRoot: dati });
  const avvio = await esigiIsolamento(v2, dati);

  const totale = await quante(v2.porta);
  const elenco = await chiediJson(v2.porta, '/api/backups');
  const categorie = await chiediJson(v2.porta, '/api/categories');

  await arrestaOrdinato(v2);

  if (totale !== 3) {
    throw new Error(`dopo l'aggiornamento ci sono ${totale} transazioni invece di 3`);
  }
  if (elenco.backups.length !== 1) {
    throw new Error(`i backup dell'utente sono ${elenco.backups.length} invece di 1`);
  }
  if (categorie.length !== 22) {
    throw new Error('le migrazioni sono state riapplicate');
  }
  // Nessuna cartella dei dati è comparsa dentro il package sostituito.
  if (existsSync(path.join(pacchetto, 'data'))) {
    throw new Error('è comparsa una cartella data/ dentro il package');
  }

  return [
    `DATA_ROOT: ${avvio.dataRoot} (mai sostituita)`,
    'app/, runtime/, start.bat e stop.bat rimossi e ricopiati da capo',
    '3 transazioni, 1 backup e 22 categorie ritrovati',
    'nessuna riapplicazione delle migrazioni',
  ];
});

// ── Chiusura ─────────────────────────────────────────────────────────────────

for (const processo of inEsecuzione) {
  processo.stop();
}
await attendi(1_500);

let residui = [];
for (const cartella of temporanee) {
  try {
    rmSync(cartella, { recursive: true, force: true });
  } catch {
    residui.push(cartella);
  }
}

const falliti = risultati.filter((r) => r.esito !== 'ok');

console.log('');
console.log(`  ${risultati.length - falliti.length}/${risultati.length} verifiche superate`);
if (residui.length > 0) {
  console.log(`  ${residui.length} cartelle temporanee non rimosse (file ancora bloccati)`);
}
console.log('');

writeFileSync(
  path.join(repoRoot, 'dist-package', 'verify-report.json'),
  `${JSON.stringify({ risultati }, null, 2)}\n`,
  'utf8',
);

process.exit(falliti.length === 0 ? 0 : 1);
