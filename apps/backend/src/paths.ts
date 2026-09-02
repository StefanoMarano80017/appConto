import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Le due radici dell'applicazione.
 *
 * `APP_ROOT` contiene il codice: un aggiornamento lo sostituisce.
 * `DATA_ROOT` contiene l'archivio: un aggiornamento non lo tocca mai.
 *
 * Tutta la risoluzione dei percorsi vive in questo modulo. Nessun altro deve
 * dedurre una directory: nel momento in cui due deduzioni divergono, l'app
 * smette di essere spostabile — ed è esattamente ciò che questo WP evita.
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Le due disposizioni in cui questo codice può trovarsi.
 *
 *     repository   <APP_ROOT>/apps/backend/src/paths.ts       sviluppo (tsx)
 *                  <APP_ROOT>/apps/backend/dist/server.js     build locale
 *
 *     package      <APP_ROOT>/app/backend/server.js           cartella portatile
 *
 * Le due risalite verso `APP_ROOT` sono diverse — tre livelli nel repository,
 * due nel package — quindi la profondità non può essere una costante.
 */
export type Layout = 'repository' | 'package';

export interface LayoutResolution {
  readonly layout: Layout;
  readonly appRoot: string;
  readonly migrationsDir: string;
  readonly frontendDir: string;
  /** Dove si cerca il binario SQLite: presente solo nelle build confezionate. */
  readonly nativeBindingCandidate: string;
}

/**
 * Dove si trova l'applicazione, dedotto da dove si trova questo modulo.
 *
 * Mai `process.cwd()`: l'applicazione va ritrovata accanto al proprio codice,
 * non accanto alla directory da cui è stata avviata.
 *
 * Il riconoscimento guarda i due segmenti finali del percorso: `app/backend` è
 * il package, qualunque altra cosa è il repository. Non un file marcatore, non
 * una variabile d'ambiente: la posizione del modulo dentro la propria
 * disposizione è già l'informazione, e cercarla altrove significherebbe poterla
 * perdere. Ne consegue che `runtime/node.exe app/backend/server.js`, eseguito a
 * mano, risolve i percorsi esattamente come `start.bat`.
 *
 * È pura per la stessa ragione di `resolvePaths`: le due disposizioni si
 * verificano entrambe senza creare due alberi di directory.
 */
export function resolveLayout(moduleDir: string): LayoutResolution {
  const inPackage =
    path.basename(moduleDir) === 'backend' && path.basename(path.dirname(moduleDir)) === 'app';

  return {
    layout: inPackage ? 'package' : 'repository',
    appRoot: inPackage
      ? path.resolve(moduleDir, '..', '..')
      : path.resolve(moduleDir, '..', '..', '..'),
    /**
     * Le migrazioni sono un artefatto dell'applicazione, non un dato: vivono
     * con il codice e vengono sostituite insieme a lui. Il registro di quali
     * sono state applicate sta invece nel database, cioè in `DATA_ROOT`.
     *
     * La formula è la stessa nelle due disposizioni, e non per caso: le
     * migrazioni stanno accanto al backend in entrambe — `apps/backend/drizzle`
     * nel repository, `app/drizzle` nel package.
     */
    migrationsDir: path.resolve(moduleDir, '..', 'drizzle'),
    /**
     * La build di produzione del frontend, servita da Express sulla stessa
     * origine delle API. Nel repository è dove la mette Angular; nel package è
     * dove la mette il confezionamento.
     */
    frontendDir: inPackage
      ? path.join(moduleDir, '..', 'frontend')
      : path.resolve(moduleDir, '..', '..', 'frontend', 'dist', 'frontend', 'browser'),
    /**
     * Il binario di SQLite sta accanto al bundle, in entrambe le disposizioni:
     * `apps/backend/dist/native/` e `app/backend/native/`. Un'unica formula,
     * così `npm start` percorre la stessa strada del package.
     */
    nativeBindingCandidate: path.join(moduleDir, 'native', 'better_sqlite3.node'),
  };
}

const resolvedLayout = resolveLayout(moduleDir);

/** In quale delle due disposizioni sta girando l'applicazione. */
export const LAYOUT: Layout = resolvedLayout.layout;

/** La radice del codice: un aggiornamento sostituisce ciò che sta sotto. */
export const APP_ROOT = resolvedLayout.appRoot;

/** Le migrazioni incluse nell'applicazione. */
export const MIGRATIONS_DIR = resolvedLayout.migrationsDir;

/** Il frontend compilato che Express serve. */
export const FRONTEND_DIR = resolvedLayout.frontendDir;

/**
 * Il modulo nativo di SQLite incluso accanto al bundle, se c'è.
 *
 * `better-sqlite3` sa trovare da sé il proprio binario quando è installato in
 * `node_modules` — è ciò che avviene in sviluppo. Nel package `node_modules`
 * non esiste: la libreria è inlinata nel bundle e il binario sta in
 * `native/`, accanto ad esso, quindi va indicato esplicitamente.
 *
 * `null` significa "risolvilo tu": nessun percorso viene imposto quando non
 * serve, e lo sviluppo resta identico a prima.
 */
export const NATIVE_BINDING_FILE: string | null = existsSync(
  resolvedLayout.nativeBindingCandidate,
)
  ? resolvedLayout.nativeBindingCandidate
  : null;

/** La configurazione facoltativa dell'utente. */
export const SETTINGS_FILE = path.join(APP_ROOT, 'config', 'settings.json');

/** Il nome del database dentro `DATA_ROOT`. */
const DATABASE_NAME = 'database.sqlite';

/** Le impostazioni riconosciute. Il file può contenerne altre. */
export interface RuntimeSettings {
  readonly port?: number;
  readonly dataRoot?: string;
  /**
   * Ogni quante ore creare un backup automatico. `0` disattiva.
   *
   * Il valore predefinito è ventiquattro, e non è una scelta arbitraria: la
   * ritenzione definita da WP-P3 conserva il più recente di ciascuno degli
   * ultimi sette giorni, quindi una cadenza giornaliera è quella che quella
   * politica già implicava. Sono ammessi valori frazionari — servono ai test,
   * che non possono attendere un giorno.
   */
  readonly autoBackupHours?: number;
}

export interface PathResolution {
  readonly dataRoot: string;
  readonly databaseFile: string;
  readonly backupsDir: string;
  readonly logsDir: string;
  readonly tmpDir: string;
  readonly instanceLockFile: string;
}

/** Le variabili d'ambiente che partecipano alla risoluzione. */
export interface PathEnvironment {
  readonly MYFINANCE_DATA?: string | undefined;
  readonly DATABASE_FILE?: string | undefined;
}

/** Il valore, se è una stringa con del contenuto. */
function trimmed(value: string | undefined): string | null {
  const text = value?.trim();

  return text === undefined || text.length === 0 ? null : text;
}

/**
 * La radice dei dati, nell'ordine: ambiente, configurazione, default.
 *
 * Un percorso relativo si risolve **rispetto ad `APP_ROOT`**, mai al `cwd`: è
 * ciò che permette di spostare la cartella senza riconfigurare nulla, e di
 * avviare l'app da qualunque directory. `path.resolve` lascia intatto un
 * percorso già assoluto, quindi entrambe le forme sono ammesse.
 */
function resolveDataRoot(
  appRoot: string,
  env: PathEnvironment,
  settings: RuntimeSettings,
  databaseFileOverride: string | null,
): string {
  const fromEnv = trimmed(env.MYFINANCE_DATA);
  if (fromEnv !== null) {
    return path.resolve(appRoot, fromEnv);
  }

  const fromSettings = trimmed(settings.dataRoot);
  if (fromSettings !== null) {
    return path.resolve(appRoot, fromSettings);
  }

  // `DATABASE_FILE` è l'alias storico: quando indica il database, la radice
  // dei dati è la sua directory. Così log e temporanei restano accanto al
  // file, e un test che punta a una cartella temporanea non scrive mai fuori
  // da essa.
  if (databaseFileOverride !== null) {
    return path.dirname(path.resolve(appRoot, databaseFileOverride));
  }

  return path.join(appRoot, 'data');
}

/**
 * L'unica funzione che decide dove vivono i dati.
 *
 * È pura — riceve ambiente e impostazioni invece di leggerli — perché è
 * l'unico modo di verificarne le precedenze senza avviare un processo per
 * ogni combinazione.
 */
export function resolvePaths(
  appRoot: string,
  env: PathEnvironment,
  settings: RuntimeSettings,
): PathResolution {
  const databaseFileOverride = trimmed(env.DATABASE_FILE);
  const dataRoot = resolveDataRoot(appRoot, env, settings, databaseFileOverride);

  const databaseFile =
    databaseFileOverride === null
      ? path.join(dataRoot, DATABASE_NAME)
      : path.resolve(appRoot, databaseFileOverride);

  return {
    dataRoot,
    databaseFile,
    backupsDir: path.join(dataRoot, 'backups'),
    logsDir: path.join(dataRoot, 'logs'),
    // Sotto `DATA_ROOT` e non in `os.tmpdir()`: i file temporanei del futuro
    // backup vanno rinominati sul database, e `rename` è atomico solo
    // all'interno dello stesso volume. Con il database su una chiave USB e i
    // temporanei su `C:`, l'operazione degenererebbe in una copia.
    tmpDir: path.join(dataRoot, 'tmp'),
    /**
     * Il segno che un'istanza sta usando questo archivio.
     *
     * Sta **dentro** `DATA_ROOT` perché è l'archivio a dover essere protetto,
     * non il programma: due copie del package che aprono la stessa cartella
     * dati devono escludersi, due copie che aprono cartelle diverse no. Il
     * percorso del file è quindi già la chiave del lock, e non c'è nulla da
     * calcolare — nessun hash del percorso, nessuna normalizzazione, nessuna
     * possibilità che due forme dello stesso percorso producano due chiavi.
     */
    instanceLockFile: path.join(dataRoot, 'instance.lock'),
  };
}

/** Il testo del problema, se la configurazione non è utilizzabile. */
function readSettings(file: string): { settings: RuntimeSettings; problem: string | null } {
  if (!existsSync(file)) {
    return { settings: {}, problem: null };
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { settings: {}, problem: `${file}: il contenuto non è un oggetto JSON.` };
    }

    return { settings: parsed as RuntimeSettings, problem: null };
  } catch (error) {
    // Una configurazione illeggibile non deve impedire l'avvio: si torna ai
    // valori predefiniti e lo si dice, invece di non partire.
    return {
      settings: {},
      problem: `${file}: ${error instanceof Error ? error.message : 'non leggibile'}`,
    };
  }
}

const loaded = readSettings(SETTINGS_FILE);

/** Le impostazioni lette, o un oggetto vuoto se il file non c'è. */
export const settings: RuntimeSettings = loaded.settings;

/** Perché la configurazione è stata ignorata, se è stata ignorata. */
export const SETTINGS_PROBLEM: string | null = loaded.problem;

const resolved = resolvePaths(APP_ROOT, process.env, settings);

export const DATA_ROOT = resolved.dataRoot;
export const DATABASE_FILE = resolved.databaseFile;
export const BACKUPS_DIR = resolved.backupsDir;
export const LOGS_DIR = resolved.logsDir;
export const TMP_DIR = resolved.tmpDir;
export const INSTANCE_LOCK_FILE = resolved.instanceLockFile;

/**
 * Crea le directory dei dati.
 *
 * `backups/` viene predisposta ora ma resta vuota: il sistema di backup è
 * materia del WP-P3. Averla già al posto giusto evita che il WP successivo
 * debba toccare la risoluzione dei percorsi.
 */
export function ensureDataDirectories(): void {
  for (const directory of [DATA_ROOT, BACKUPS_DIR, LOGS_DIR, TMP_DIR]) {
    mkdirSync(directory, { recursive: true });
  }
}
