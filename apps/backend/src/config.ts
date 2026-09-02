import {
  APP_ROOT,
  BACKUPS_DIR,
  DATABASE_FILE,
  DATA_ROOT,
  FRONTEND_DIR,
  INSTANCE_LOCK_FILE,
  LAYOUT,
  LOGS_DIR,
  MIGRATIONS_DIR,
  NATIVE_BINDING_FILE,
  TMP_DIR,
  settings,
} from './paths.js';

/** Ogni quante ore un backup automatico: ambiente, configurazione, default. */
export function resolveAutoBackupHours(
  fromEnv: string | undefined,
  fromSettings: number | undefined,
): number {
  /*
   * Una variabile d'ambiente vuota significa "non indicato", non "zero".
   *
   * `Number('')` vale `0`, che qui è una risposta precisa — disattiva i backup
   * automatici. Senza questo controllo, una variabile dichiarata e lasciata
   * vuota spegnerebbe la funzione in silenzio.
   */
  const scritto = fromEnv?.trim();
  const dallAmbiente = scritto === undefined || scritto.length === 0 ? undefined : Number(scritto);

  for (const candidate of [dallAmbiente, fromSettings]) {
    // `0` va comunque distinto da "non indicato": è una scelta dell'utente.
    if (candidate !== undefined && Number.isFinite(candidate) && candidate >= 0) {
      return candidate;
    }
  }

  return 24;
}

/**
 * La configurazione dell'applicazione.
 *
 * I percorsi non vengono dedotti qui: arrivano da `paths.js`, che è l'unica
 * sorgente di verità. Questo modulo li compone con il resto della
 * configurazione e non aggiunge risoluzione propria.
 */
export const config = {
  /**
   * Solo loopback.
   *
   * L'applicazione custodisce dati finanziari personali e non deve essere
   * raggiungibile dalla rete locale. Non è configurabile da ambiente proprio
   * per non lasciare un modo di aprirla per sbaglio.
   */
  host: '127.0.0.1',
  /** Ambiente, poi configurazione, poi il valore predefinito. */
  port: Number(process.env.MYFINANCE_PORT ?? process.env.PORT ?? settings.port ?? 3000),
  /** La radice del codice: sostituita da un aggiornamento. */
  appRoot: APP_ROOT,
  /** La radice dei dati: mai toccata da un aggiornamento. */
  dataRoot: DATA_ROOT,
  databaseFile: DATABASE_FILE,
  /** Le migrazioni appartengono all'applicazione, non ai dati. */
  migrationsFolder: MIGRATIONS_DIR,
  logsDir: LOGS_DIR,
  /** Gli archivi verificati: nulla vi entra prima di essere stato controllato. */
  backupsDir: BACKUPS_DIR,
  /**
   * I file di lavoro. Sotto `DATA_ROOT` e non in `os.tmpdir()` perché un backup
   * nasce qui e viene poi spostato con `rename`, che è atomico soltanto
   * all'interno dello stesso volume.
   */
  tmpDir: TMP_DIR,
  /**
   * Il file che dichiara quale istanza sta usando questo archivio.
   *
   * Appartiene ai dati e non al codice: è l'archivio a non poter essere
   * aperto due volte.
   */
  instanceLockFile: INSTANCE_LOCK_FILE,
  /**
   * Ogni quanto creare un backup automatico, in millisecondi. Zero: mai.
   *
   * La ritenzione del tipo `auto` — definita e provata in WP-P3 — conserva il
   * più recente di ciascuno degli ultimi sette giorni: la cadenza giornaliera
   * predefinita è quella che quella politica già implicava.
   */
  autoBackupIntervalMs: Math.round(
    resolveAutoBackupHours(process.env.MYFINANCE_AUTO_BACKUP_HOURS, settings.autoBackupHours) *
      60 *
      60 *
      1000,
  ),
  /** In quale disposizione gira: utile solo da registrare all'avvio. */
  layout: LAYOUT,
  /** La build di produzione del frontend, servita sulla stessa origine delle API. */
  frontendDir: FRONTEND_DIR,
  /** Il binario SQLite accanto al bundle, oppure `null` se lo risolve la libreria. */
  nativeBindingFile: NATIVE_BINDING_FILE,
  /** Dimensione massima di un CSV accettato dall'endpoint di import. */
  maxCsvSize: '10mb',
} as const;
