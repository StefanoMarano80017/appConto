import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile, copyTreeVerified } from './copy-tree.mjs';

/**
 * Confeziona la cartella portatile per Windows.
 *
 *     MyFinance/
 *     ├── app/          codice: sostituibile da un aggiornamento
 *     │   ├── backend/  launcher.js + server.js + package.json + native/
 *     │   ├── frontend/ la build Angular di produzione
 *     │   ├── drizzle/  le migrazioni
 *     │   ├── VERSION
 *     │   └── RUNTIME.json
 *     ├── runtime/      node.exe, versione fissata
 *     ├── config/       settings.example.json
 *     ├── start.bat     avvia il launcher
 *     └── stop.bat      chiede l'arresto ordinato all'istanza in esecuzione
 *
 * `launcher.js` sta **accanto** a `server.js` e non in una cartella propria:
 * `paths.ts` deduce `APP_ROOT` dai segmenti finali del percorso del proprio
 * modulo, quindi due bundle nella stessa cartella risolvono le due radici in
 * modo identico. È la ragione per cui non esistono due deduzioni divergenti.
 *
 * `data/` **non** viene creata: nasce al primo avvio. È una scelta, non una
 * dimenticanza — un package che non contiene nemmeno la cartella dei dati non
 * può averci portato dentro per sbaglio l'archivio di chi lo ha confezionato,
 * e il primo avvio lo dimostra creando tutto da zero.
 *
 * Lo script non si limita ad assemblare: verifica. Un package che non supera
 * le verifiche non viene consegnato, perché un difetto scoperto qui costa un
 * messaggio d'errore, e scoperto sulla macchina dell'utente costa i suoi dati.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = path.join(repoRoot, 'dist-package');
const packageRoot = path.join(outRoot, 'MyFinance');

const backendDist = path.join(repoRoot, 'apps', 'backend', 'dist');
const frontendDist = path.join(repoRoot, 'apps', 'frontend', 'dist', 'frontend', 'browser');
const migrations = path.join(repoRoot, 'apps', 'backend', 'drizzle');

/** Interrompe il confezionamento con un messaggio leggibile. */
class PackagingError extends Error {}

function fail(message) {
  throw new PackagingError(message);
}

const kb = (byte) => `${(byte / 1024).toFixed(0)} kB`;
const mb = (byte) => `${(byte / 1024 / 1024).toFixed(1)} MB`;

/** Ogni file sotto `dir`, con il percorso relativo a `dir`. */
function walk(dir, base = dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(base, absolute);
    if (entry.isDirectory()) {
      found.push({ relative, absolute, directory: true });
      found.push(...walk(absolute, base));
    } else {
      found.push({ relative, absolute, directory: false, bytes: statSync(absolute).size });
    }
  }

  return found;
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// ─── 1. Il runtime da incorporare ────────────────────────────────────────────

/**
 * Il runtime è **fissato**, non scelto a runtime.
 *
 * Si accetta un percorso esplicito via `MYFINANCE_NODE_EXE`, altrimenti si usa
 * quello che sta eseguendo questo script. In entrambi i casi la versione viene
 * interrogata al binario e confrontata con il valore fissato: non è il percorso
 * a essere autorevole, è ciò che il binario dichiara di essere.
 */
function resolveRuntime() {
  const pin = JSON.parse(readFileSync(path.join(repoRoot, 'scripts', 'node-runtime.json'), 'utf8'));
  const candidate = process.env.MYFINANCE_NODE_EXE ?? process.execPath;

  if (!existsSync(candidate)) {
    fail(`Runtime Node non trovato: ${candidate}`);
  }

  const dichiarato = JSON.parse(
    execFileSync(
      candidate,
      ['-p', 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch,modules:process.versions.modules})'],
      { encoding: 'utf8' },
    ),
  );

  const disallineamenti = [];
  if (dichiarato.version !== pin.version) {
    disallineamenti.push(`versione ${dichiarato.version}, attesa ${pin.version}`);
  }
  if (dichiarato.platform !== pin.platform) {
    disallineamenti.push(`piattaforma ${dichiarato.platform}, attesa ${pin.platform}`);
  }
  if (dichiarato.arch !== pin.arch) {
    disallineamenti.push(`architettura ${dichiarato.arch}, attesa ${pin.arch}`);
  }

  if (disallineamenti.length > 0) {
    fail(
      [
        `Il runtime da incorporare non è quello fissato in scripts/node-runtime.json: ${disallineamenti.join('; ')}.`,
        `Scarica ${pin.downloadUrl} e indicane il percorso con MYFINANCE_NODE_EXE,`,
        'oppure aggiorna il valore fissato se il cambio è voluto.',
      ].join(' '),
    );
  }

  return { pin, exe: candidate, ...dichiarato };
}

// ─── 2. Il binario nativo di SQLite ──────────────────────────────────────────

/**
 * Quale binario SQLite serve, e perché non è una questione di ABI.
 *
 * `better-sqlite3` 13 distribuisce prebuild **N-API**: si chiamano
 * `win32-x64.node`, non `node-v137-win32-x64.node`. N-API è un'interfaccia
 * stabile fra versioni di Node, quindi il vincolo non è
 * `NODE_MODULE_VERSION` — che con un addon N-API non entra in gioco — ma la
 * coppia piattaforma/architettura, più la versione minima dichiarata dalla
 * libreria.
 *
 * `NODE_MODULE_VERSION` resta comunque registrato in `RUNTIME.json`: non
 * decide nulla, ma è la prima cosa da guardare se un giorno un addon non
 * N-API entrasse nel grafo delle dipendenze.
 */
function resolveNative(runtime) {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve('better-sqlite3/package.json'));
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

  const nome = `${runtime.platform}-${runtime.arch}.node`;
  const source = path.join(root, 'prebuilds', nome);

  if (!existsSync(source)) {
    fail(
      `better-sqlite3 non contiene il prebuild ${nome}. Disponibili: ${readdirSync(path.join(root, 'prebuilds')).join(', ')}`,
    );
  }

  const minimo = manifest.engines?.node;
  if (typeof minimo === 'string') {
    const richiesta = Number(minimo.replace(/[^\d]/g, ''));
    const offerta = Number(runtime.version.replace(/^v/, '').split('.')[0]);
    if (Number.isFinite(richiesta) && offerta < richiesta) {
      fail(
        `better-sqlite3 ${manifest.version} richiede Node ${minimo}, il runtime fissato è ${runtime.version}.`,
      );
    }
  }

  return { source, nome, version: manifest.version, engines: minimo ?? 'non dichiarato' };
}

/**
 * Il runtime incorporato carica davvero quel binario?
 *
 * È l'unica verifica che conta, e sostituisce qualunque confronto di numeri:
 * si chiede al `node.exe` che verrà consegnato di aprire il `.node` che verrà
 * consegnato, e di usarlo. Se la combinazione non è compatibile si scopre
 * adesso, non all'avvio sulla macchina di chi la userà.
 */
function verifyNativeLoads(runtime, nativeFile) {
  const scratch = mkdtempSync(path.join(tmpdir(), 'appconto-pkg-check-'));

  try {
    const script = [
      'const addon = require(process.argv[1]);',
      "const path = require('path');",
      'const keys = Object.keys(addon).sort();',
      'process.stdout.write(JSON.stringify({ keys, napi: process.versions.napi ?? null }));',
    ].join('');

    const esito = JSON.parse(
      execFileSync(runtime.exe, ['-e', script, nativeFile], { encoding: 'utf8' }),
    );

    if (!esito.keys.includes('Database')) {
      fail(
        `Il runtime ${runtime.version} ha caricato il binario nativo ma non espone "Database": ${esito.keys.join(', ')}`,
      );
    }

    return esito;
  } catch (error) {
    if (error instanceof PackagingError) {
      throw error;
    }
    fail(
      `Il runtime ${runtime.version} non riesce a caricare ${path.basename(nativeFile)}: ${error.message}`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ─── 3. Assemblaggio ─────────────────────────────────────────────────────────

const START_BAT = [
  '@echo off',
  'rem Avvio di MyFinance.',
  'rem',
  'rem %~dp0 e la directory di QUESTO file, con la barra finale: lo script non',
  'rem dipende dalla directory da cui viene lanciato, e non contiene percorsi',
  'rem assoluti. Il runtime e quello incluso: nessun Node di sistema serve.',
  'rem',
  'rem Equivalente a:  runtime\\node.exe app\\backend\\launcher.js',
  'setlocal',
  'rem',
  'rem Questa finestra si chiudera da sola?',
  'rem',
  'rem %cmdcmdline% contiene il nome di questo file solo quando cmd e stato',
  'rem avviato PER ESEGUIRLO: e cio che accade con il doppio clic da Explorer.',
  'rem Da un terminale contiene solo cmd.exe. Il launcher usa questa risposta',
  'rem per trattenere la finestra quando c-e un errore da leggere, e per NON',
  'rem trattenerla mai negli altri casi.',
  'rem',
  'rem L-espansione ritardata serve a non spezzare il comando su un percorso',
  'rem che contenga & oppure parentesi.',
  'if not defined SystemRoot set "SystemRoot=C:\\Windows"',
  'setlocal enabledelayedexpansion',
  'set "CONSOLE_TEMPORANEA="',
  'rem find.exe per percorso assoluto: su una macchina con Git o MSYS nel PATH,',
  'rem "find" e il find di Unix, che non conosce /i e stampa un errore.',
  'echo !cmdcmdline! | "%SystemRoot%\\System32\\find.exe" /i "%~nx0" >nul && set "CONSOLE_TEMPORANEA=1"',
  'endlocal & set "MYFINANCE_CONSOLE_TEMPORANEA=%CONSOLE_TEMPORANEA%"',
  '"%~dp0runtime\\node.exe" "%~dp0app\\backend\\launcher.js" %*',
  'exit /b %ERRORLEVEL%',
  '',
].join('\r\n');

/**
 * Fermare l'applicazione senza chiudere la finestra.
 *
 * Su Windows non esiste un modo corretto di chiedere a un altro processo di
 * fermarsi — `taskkill` lo termina, e un processo terminato non consolida il
 * WAL — quindi la richiesta passa dal canale di controllo dell'istanza, che è
 * lo stesso percorso che un secondo avvio usa per scoprire il primo.
 */
const STOP_BAT = [
  '@echo off',
  'rem Arresto ordinato di MyFinance.',
  'rem',
  'rem Chiede all-istanza in esecuzione di fermarsi e di consolidare il',
  'rem database prima di uscire. Equivale a chiudere la finestra di start.bat.',
  'setlocal',
  'if not defined SystemRoot set "SystemRoot=C:\\Windows"',
  'setlocal enabledelayedexpansion',
  'set "CONSOLE_TEMPORANEA="',
  'rem find.exe per percorso assoluto: su una macchina con Git o MSYS nel PATH,',
  'rem "find" e il find di Unix, che non conosce /i e stampa un errore.',
  'echo !cmdcmdline! | "%SystemRoot%\\System32\\find.exe" /i "%~nx0" >nul && set "CONSOLE_TEMPORANEA=1"',
  'endlocal & set "MYFINANCE_CONSOLE_TEMPORANEA=%CONSOLE_TEMPORANEA%"',
  '"%~dp0runtime\\node.exe" "%~dp0app\\backend\\launcher.js" --stop %*',
  'exit /b %ERRORLEVEL%',
  '',
].join('\r\n');

function assemble(runtime, native) {
  for (const [what, where] of [
    ['il bundle del backend', path.join(backendDist, 'server.js')],
    ['la build del frontend', path.join(frontendDist, 'index.html')],
    ['le migrazioni', path.join(migrations, 'meta', '_journal.json')],
  ]) {
    if (!existsSync(where)) {
      fail(`Manca ${what} (${path.relative(repoRoot, where)}). Esegui prima "npm run build".`);
    }
  }

  rmSync(outRoot, { recursive: true, force: true });
  mkdirSync(path.join(packageRoot, 'app', 'backend', 'native'), { recursive: true });

  // Backend: il bundle e il tipo di modulo dichiarato. Il sourcemap resta nel
  // repository — porta con sé i sorgenti e non serve a chi usa l'applicazione.
  copyFile(path.join(backendDist, 'server.js'), path.join(packageRoot, 'app', 'backend', 'server.js'));
  copyFile(path.join(backendDist, 'launcher.js'), path.join(packageRoot, 'app', 'backend', 'launcher.js'));
  copyFile(
    path.join(backendDist, 'package.json'),
    path.join(packageRoot, 'app', 'backend', 'package.json'),
  );

  const nativeFile = path.join(packageRoot, 'app', 'backend', 'native', 'better_sqlite3.node');
  copyFile(native.source, nativeFile);

  copyTreeVerified(frontendDist, path.join(packageRoot, 'app', 'frontend'));
  copyTreeVerified(migrations, path.join(packageRoot, 'app', 'drizzle'));

  const appVersion = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
  writeFileSync(path.join(packageRoot, 'app', 'VERSION'), `${appVersion}\n`, 'utf8');

  mkdirSync(path.join(packageRoot, 'runtime'), { recursive: true });
  copyFile(runtime.exe, path.join(packageRoot, 'runtime', 'node.exe'));

  mkdirSync(path.join(packageRoot, 'config'), { recursive: true });
  writeFileSync(
    path.join(packageRoot, 'config', 'settings.example.json'),
    `${JSON.stringify({ port: 47318, dataRoot: './data', autoBackupHours: 24 }, null, 2)}
`,
    'utf8',
  );

  writeFileSync(path.join(packageRoot, 'start.bat'), START_BAT, 'utf8');
  writeFileSync(path.join(packageRoot, 'stop.bat'), STOP_BAT, 'utf8');

  return { nativeFile, appVersion };
}

/** Il documento che rende verificabile di cosa è fatto il package. */
function writeRuntimeManifest(runtime, native, nativeFile, appVersion, napi) {
  const manifest = {
    appVersion,
    node: {
      version: runtime.version,
      platform: runtime.platform,
      arch: runtime.arch,
      /** Registrato per diagnosi: con un addon N-API non è il vincolo. */
      nodeModuleVersion: runtime.modules,
      napiVersion: napi ?? null,
      sha256: sha256(path.join(packageRoot, 'runtime', 'node.exe')),
    },
    sqlite: {
      library: `better-sqlite3@${native.version}`,
      engines: native.engines,
      binding: 'app/backend/native/better_sqlite3.node',
      prebuild: native.nome,
      abi: 'node-api',
      sha256: sha256(nativeFile),
      verifiedWith: runtime.version,
    },
    layout: {
      appRoot: 'la cartella che contiene app/ e runtime/',
      dataRoot: 'MYFINANCE_DATA -> config/settings.json dataRoot -> <APP_ROOT>/data',
      port: 'MYFINANCE_PORT -> config/settings.json port -> 3000',
    },
  };

  writeFileSync(
    path.join(packageRoot, 'app', 'RUNTIME.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  return manifest;
}

// ─── 4. Guardie ──────────────────────────────────────────────────────────────

/**
 * Il package non deve contenere dati, e non deve contenere la macchina di chi
 * lo ha costruito.
 *
 * Le due cose si controllano allo stesso modo — guardando tutto ciò che è
 * stato scritto — e falliscono il confezionamento invece di essere segnalate:
 * un archivio spedito per sbaglio non si può richiamare.
 */
function guard(runtime) {
  const files = walk(packageRoot);
  const problemi = [];

  const vietatiPerNome = [
    { test: (nome) => /\.sqlite(-wal|-shm)?$/i.test(nome), perche: 'è un database' },
    { test: (nome) => /\.db(-wal|-shm)?$/i.test(nome), perche: 'è un database' },
    { test: (nome) => /\.map$/i.test(nome), perche: 'è un sourcemap, che porta con sé i sorgenti' },
  ];

  const cartelleVietate = new Set(['backups', 'logs', 'tmp', 'node_modules', 'data']);

  for (const file of files) {
    const nome = path.basename(file.relative);

    if (file.directory) {
      if (cartelleVietate.has(nome)) {
        problemi.push(`${file.relative}/ non deve stare nel package (${nome === 'node_modules' ? 'dipendenze non necessarie' : 'appartiene ai dati'})`);
      }
      continue;
    }

    for (const vietato of vietatiPerNome) {
      if (vietato.test(nome)) {
        problemi.push(`${file.relative} ${vietato.perche}`);
      }
    }
  }

  // Percorsi della macchina di chi confeziona: cercati byte per byte, anche
  // nei file binari. Il runtime incluso pesa novanta megabyte e viene scandito
  // comunque: se contenesse il percorso di questo repository sarebbe una
  // scoperta, non un falso positivo.
  const impronte = [
    { nome: 'la radice del repository', valore: repoRoot },
    { nome: 'la cartella utente', valore: path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '') },
  ].filter((impronta) => impronta.valore.length > 3);

  for (const file of files) {
    if (file.directory) {
      continue;
    }
    const contenuto = readFileSync(file.absolute);
    for (const impronta of impronte) {
      for (const forma of [impronta.valore, impronta.valore.replace(/\\/g, '/')]) {
        if (contenuto.includes(forma)) {
          problemi.push(`${file.relative} contiene ${impronta.nome} (${forma})`);
        }
      }
    }
  }

  // Ciò che invece deve esserci.
  const attesi = [
    'start.bat',
    'stop.bat',
    path.join('runtime', 'node.exe'),
    path.join('app', 'backend', 'server.js'),
    path.join('app', 'backend', 'launcher.js'),
    path.join('app', 'backend', 'package.json'),
    path.join('app', 'backend', 'native', 'better_sqlite3.node'),
    path.join('app', 'frontend', 'index.html'),
    path.join('app', 'drizzle', 'meta', '_journal.json'),
    path.join('app', 'VERSION'),
    path.join('app', 'RUNTIME.json'),
    path.join('config', 'settings.example.json'),
  ];

  for (const atteso of attesi) {
    if (!existsSync(path.join(packageRoot, atteso))) {
      problemi.push(`manca ${atteso}`);
    }
  }

  // `settings.json` attivo: se ci fosse, il package imporrebbe la
  // configurazione di chi lo ha costruito.
  if (existsSync(path.join(packageRoot, 'config', 'settings.json'))) {
    problemi.push('config/settings.json non deve essere incluso: solo l-esempio');
  }

  if (problemi.length > 0) {
    fail(`Il package non è consegnabile:\n  - ${problemi.join('\n  - ')}`);
  }

  return {
    files: files.filter((file) => !file.directory).length,
    bytes: files.reduce((totale, file) => totale + (file.bytes ?? 0), 0),
    runtimeBytes: statSync(path.join(packageRoot, 'runtime', 'node.exe')).size,
  };
}

// ─── 5. Esecuzione ───────────────────────────────────────────────────────────

export async function packageWindows() {
  const runtime = resolveRuntime();
  const native = resolveNative(runtime);
  const { nativeFile, appVersion } = assemble(runtime, native);
  const caricamento = verifyNativeLoads(runtime, nativeFile);
  const manifest = writeRuntimeManifest(runtime, native, nativeFile, appVersion, caricamento.napi);
  const misure = guard(runtime);

  return { runtime, native, manifest, misure, packageRoot };
}

const eseguitoDirettamente =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (eseguitoDirettamente) {
  try {
    const esito = await packageWindows();

    console.log('');
    console.log(`  package        ${path.relative(repoRoot, esito.packageRoot)}`);
    console.log(`  app            ${esito.manifest.appVersion}`);
    console.log(`  node           ${esito.runtime.version} ${esito.runtime.platform}-${esito.runtime.arch} (NODE_MODULE_VERSION ${esito.runtime.modules}, N-API ${esito.manifest.node.napiVersion ?? '?'})`);
    console.log(`  sqlite         ${esito.manifest.sqlite.library} via ${esito.native.nome} (node-api), caricato da ${esito.runtime.version}`);
    console.log(`  file           ${esito.misure.files}`);
    console.log(`  dimensione     ${mb(esito.misure.bytes)}  (di cui runtime ${mb(esito.misure.runtimeBytes)})`);
    console.log('');
    console.log('  avvio:         start.bat');
    console.log('  arresto:       stop.bat   (oppure si chiude la finestra)');
    console.log('');
  } catch (error) {
    if (error instanceof PackagingError) {
      console.error(`\nConfezionamento interrotto.\n${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}
