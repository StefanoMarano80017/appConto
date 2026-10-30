# Entry point del backend: orchestrazione, IPC e lifecycle — design

Data: 2026-10-30 · Stato: bozza da approvare

## Intento

`apps/backend/src/main.ts` funziona, ma esegue tutto come side effect del modulo: bootstrap, listen, scheduler, segnali, IPC. Non si può invocare da un test, e i rami di errore dell'avvio non si possono verificare senza avviare un processo. L'obiettivo è un refactoring incrementale che renda l'avvio **esplicito, testabile e robusto in caso di inizializzazione parziale**, preservando il comportamento esistente (salvo i tre cambi approvati, sotto).

## Stato attuale verificato (baseline: `npm run test:backend` → 683/683)

- `db/client.ts` **apre il database all'import** (prima applica il ripristino differito). `app.ts`, `bootstrap.ts`, `shutdown.ts` e lo scheduler lo importano transitivamente: qualunque modulo che li importi apre il DB.
- `shared/logger.ts` scrive in `LOGS_DIR`, risolto all'import da `paths.ts`: un test che usa il logger reale scrive nella radice dati risolta in quel momento.
- `bootstrap()` è sincrono; solleva se l'avvio non è sicuro (`safeMigrate` non lascia lo schema a metà).
- `listenWithFallback` è corretto: `EADDRINUSE` è l'unico errore che porta al ripiego, il ripiego usa `listen(0)` (nessuna race), i gestori vengono smontati. **Non si tocca.**
- `createBackupScheduler().start()` chiama `backupService.list()` (`readdirSync`): può sollevare. `start` è idempotente, `stop` è sincrono e idempotente, il timer è `unref`.
- `shutdown.ts`: idempotenza tramite flag **globale di modulo**; `closeDatabase` importato direttamente; se `closeDatabase` solleva dentro la callback di `server.close` il processo esce per eccezione non gestita.

### Problemi reali

1. Scheduler che fallisce dopo il listen → rifiuto del top-level await, traccia di stack, server non chiuso, WAL non consolidato, nessun `ready`.
2. Listen fallito dopo un bootstrap riuscito → `process.exit(1)` senza `closeDatabase()`.
3. Idempotenza dello shutdown non verificabile in isolamento (stato globale; il test della "seconda richiesta" dipende dall'ordine).
4. Errore in `closeDatabase` durante lo shutdown → eccezione non gestita invece di messaggio + codice 1.
5. Launcher che sparisce → server orfano con porta e DB aperti (nessun gestore di `disconnect`).
6. `SIGBREAK` (Ctrl+Break su Windows) non gestito dal server: terminazione senza consolidamento.
7. `runtime.test.ts` ferma il server con `kill('SIGINT')`, che su Windows termina il processo: il percorso di arresto reale su Windows (IPC) non ha uno smoke test.

## Obiettivi

- `main.ts` limitato a: log di avvio, cablaggio delle dipendenze reali, integrazione con il processo, errori fatali e uscita.
- Orchestrazione invocabile da un test **senza database e senza processo reale**.
- IPC isolato e verificabile con un finto `process`.
- Shutdown idempotente **per istanza**, con cleanup che non esplode.
- Nessuno stato parzialmente avviato con risorse aperte.

## Non-obiettivi

- Nessuna modifica a `listen.ts`, `bootstrap.ts`, `app.ts`, `config.ts`, `paths.ts`, `db/**`, moduli applicativi, migrazioni, launcher.
- Nessun framework DI, nessuna classe, nessun lifecycle manager generico, nessuna nuova dipendenza npm.
- Non si rende `db/client.ts` lazy (cambierebbe il momento del ripristino differito: fuori perimetro).
- Non si modifica `runtime.test.ts` (in carico al piano `docs/plans/2026-10-30-backend-testing-m0-m5.md`, T per A6).

## Anti-obiettivi

- Un refactoring che aggiunge strati senza rendere testabile nulla di nuovo.
- Un cambio del protocollo IPC o della semantica di `MYFINANCE_PORT` / `MYFINANCE_PORT_FALLBACK`.
- Perdere i messaggi per l'utente finale già presenti.

## Approcci considerati

| | Descrizione | Pro | Contro |
|---|---|---|---|
| **A (scelto)** | `server.ts` (`startServer`), `launcher-ipc.ts`, `shutdown.ts` con stato per istanza | Ogni pezzo testabile da solo; idempotenza provabile | Tre file toccati/creati |
| B | Solo `startServer` + IPC, `shutdown.ts` invariato | Rischio minimo | Idempotenza e cleanup restano non verificabili |
| C | `startServer` e IPC nello stesso file | Un file in meno | Mescola orchestrazione e integrazione col processo |

**Scelta dell'utente: A.**

## Cambi di comportamento approvati dall'utente

1. **Shutdown su `disconnect` IPC**: se il canale con il launcher si chiude, il server esegue l'arresto ordinato (`reason: 'launcher disconnesso'`).
2. **Cleanup su avvio fallito**: se l'avvio fallisce **nelle fasi `listen` o `scheduler`** (cioè dopo un bootstrap riuscito), si chiude il server (se in ascolto) e si consolida il WAL prima di uscire con 1. Un fallimento del **bootstrap** resta com'è oggi: nessun checkpoint, perché il messaggio all'utente promette che l'archivio non è stato toccato e `safeMigrate` può aver rifiutato un archivio più recente dell'applicazione.
3. **`SIGBREAK` gestito dal server**, come già fa il launcher.

## Architettura

```
main.ts          log di avvio · cablaggio · process · errori fatali · exit
  ├─ server.ts        startServer(options, deps)  ← nessun import di DB/logger
  ├─ shutdown.ts      createShutdown(...) · installSignalHandlers(...)
  └─ launcher-ipc.ts  isShutdownMessage · connectLauncher(...)
```

Dipendenze: `server.ts` importa solo tipi (`listen.js`, `node:http`); `shutdown.ts` e `launcher-ipc.ts` non importano DB né logger (li ricevono). Nessun ciclo: solo `main.ts` importa i moduli reali.

### `server.ts` — `startServer`

```ts
export interface StartOptions { host: string; port: number; allowFallback: boolean }

export interface ServerDeps {
  bootstrap: () => void;
  createApp: () => RequestListener;
  listen: (server: Server, request: ListenRequest) => Promise<ListenOutcome>;
  createScheduler: () => { start(): void; stop(): void };
  log: { info(msg: string, details?: unknown): void; error(msg: string, details?: unknown): void };
}

export interface StartedServer { server: Server; listen: ListenOutcome; background: { stop(): void } }

export class StartupFailedError extends Error {
  constructor(readonly phase: 'bootstrap' | 'listen' | 'scheduler', readonly cause: unknown)
}

export async function startServer(options: StartOptions, deps: ServerDeps): Promise<StartedServer>
```

Ordine (esplicito e documentato nel codice):

1. `deps.bootstrap()` — se solleva: log `Avvio interrotto: <messaggio>` → `StartupFailedError('bootstrap')`. Nessun server creato.
2. `createServer(deps.createApp())`.
3. `await deps.listen(server, { host, port, allowFallback })` — se solleva: stesso messaggio di oggi (`EADDRINUSE` → testo con `MYFINANCE_PORT` / `settings.json`; altro → `Impossibile mettersi in ascolto su host:port`) → `StartupFailedError('listen')`.
4. Log di ripiego (se `fellBack`) e `Backend in ascolto su …` — testi invariati.
5. `scheduler = deps.createScheduler(); scheduler.start()` — se solleva: `scheduler.stop()` (best effort), chiusura del server (`closeAllConnections` + `close` atteso), log `Impossibile avviare i backup automatici` → `StartupFailedError('scheduler')`.
6. Restituisce `{ server, listen, background: scheduler }`.

I messaggi diagnostici stanno in `startServer` (vicino alla fase che fallisce, e verificabili con un logger finto); `main.ts` decide solo il cleanup del DB e l'uscita.

L'installazione dei gestori di arresto **non** è in `startServer`: è integrazione col processo e sta in `main.ts`. Non si apre alcuna finestra nuova: fra la risoluzione del listen e il ritorno di `startServer` non c'è un turno del ciclo di eventi, quindi un segnale non può essere consegnato in mezzo (finestra identica a oggi: la sola attesa del listen).

### `shutdown.ts`

```ts
export interface ShutdownDeps {
  server: Server;
  background?: BackgroundWork;
  closeDatabase: () => DatabaseCloseOutcome;
  exit: (code: number) => void;
  log: Logger;
  graceMs?: number;      // default 5_000 — esposti solo per i test
  safetyMs?: number;     // default 15_000
}
export function createShutdown(deps: ShutdownDeps): (reason: string) => void
export function installSignalHandlers(request: (reason: string) => void, proc?: Pick<NodeJS.Process, 'on'>): void
```

- Sequenza e timeout invariati (scheduler → `close` → `closeIdleConnections` → forzatura a 5 s → checkpoint → `exit(0)`; rete di sicurezza a 15 s → `exit(1)`).
- Idempotenza nello stato della closure restituita.
- `closeDatabase` in `try/catch`: se solleva, log dell'errore ed `exit(1)`.
- Segnali: `SIGINT`, `SIGTERM`, `SIGHUP`, **`SIGBREAK`**.
- `shutdown.test.ts` viene adattato alla nuova firma (resta il test d'integrazione su DB reale).

### `launcher-ipc.ts`

```ts
export function isShutdownMessage(message: unknown): message is { type: 'shutdown' }
export function connectLauncher(
  proc: Pick<NodeJS.Process, 'send' | 'on' | 'pid' | 'connected'>,
  listening: ListenOutcome,
  requestShutdown: (reason: string) => void,
): boolean   // false se non c'è un canale IPC
```

- Se `proc.send` non è una funzione: non fa nulla, restituisce `false`.
- Invia `{ type: 'ready', host, port: actualPort, configuredPort, pid }`: **identico a oggi**.
- `message`: `isShutdownMessage` → `requestShutdown('launcher')`; tutto il resto ignorato in silenzio (come oggi).
- `disconnect` → `requestShutdown('launcher disconnesso')`.
- I duplicati sono assorbiti dall'idempotenza di `createShutdown`, non duplicata qui.
- *(scelta del progettista)* Canale già chiuso al momento del collegamento (il launcher è morto durante l'attesa del listen, e `disconnect` è già stato emesso): se `proc.connected === false`, oppure se `send` solleva o riporta un errore nella callback, si richiede subito `requestShutdown('launcher disconnesso')`. Così `connectLauncher` non solleva mai, e il problema 5 è coperto anche in quella finestra.
- *(scelta del progettista)* Un arresto per `disconnect` che si completa regolarmente esce con **0**, come quello chiesto dal launcher: è un arresto ordinato riuscito. Esce con 1 solo per le stesse ragioni di ogni altro arresto (checkpoint fallito, rete di sicurezza).

### `main.ts`

```
if SETTINGS_PROBLEM → log
allowPortFallback = MYFINANCE_PORT_FALLBACK === '1'   (letto qui, come oggi)
log 'Avvio' {…}                                        (invariato: runtime.test.ts lo legge)
try started = await startServer(…, deps reali)
catch:
  StartupFailedError 'bootstrap'          → process.exit(1)               (come oggi)
  'listen' | 'scheduler' | non previsto   → closeDatabase() + log esito; process.exit(1)
requestShutdown = createShutdown({ …, exit: process.exit })
installSignalHandlers(requestShutdown)
connectLauncher(process, started.listen, requestShutdown)
```

*(Scelta del progettista.)* Il `try` copre solo `startServer`. Il cablaggio successivo non può sollevare: `createShutdown` e `installSignalHandlers` registrano soltanto delle funzioni, e `connectLauncher` gestisce da sé gli errori di `send` (vedi sopra). Per questo non serve un secondo percorso di cleanup.

`process.exit` resta: il canale IPC (quando c'è) e il timer di sicurezza tengono vivo il ciclo di eventi, quindi `process.exitCode` da solo non farebbe uscire il processo avviato dal launcher. Un errore non previsto (non `StartupFailedError`) viene comunque registrato e porta allo stesso cleanup.

Il caso "apertura del DB fallita all'import" resta com'è (eccezione prima del log di avvio): renderlo gestibile richiederebbe un `db/client.ts` lazy, fuori perimetro.

## Test

| Livello | File | Cosa |
|---|---|---|
| Unit | `server.test.ts` (nuovo) | ordine bootstrap → listen → scheduler; app passata al server; parametri di listen e `allowFallback`; errore bootstrap → nessun listen; errore listen → nessuno scheduler, messaggio `EADDRINUSE` vs generico; errore scheduler → server chiuso (porta di nuovo libera) e `stop` chiamato; `StartupFailedError.phase` corretta per ciascuna fase; `fellBack` loggato. Server HTTP reale su porta 0, nessun DB. |
| Unit | `launcher-ipc.test.ts` (nuovo) | `ready` con i cinque campi; `shutdown` → richiesta; messaggi non validi/sconosciuti ignorati; `disconnect` → richiesta; canale già chiuso (`connected: false`) o `send` in errore → richiesta immediata; senza IPC → `false`, nulla registrato. Finto `process` = `EventEmitter`. |
| Unit | `shutdown.unit.test.ts` (nuovo) | idempotenza (anche concorrente); `stop` prima della chiusura; `closeDatabase` che solleva → `exit(1)`; rete di sicurezza con timeout corti; `SIGBREAK` registrato. Server reale su porta 0, `closeDatabase` finto. |
| Integrazione | `shutdown.test.ts` (adattato) | WAL consolidato e dati integri con DB reale. |
| Smoke | `server.ipc.runtime.test.ts` (nuovo) | processo reale con `stdio` `ipc`: `ready` con porta effettiva e ripiego quando la porta configurata è occupata; HTTP disponibile; `shutdown` via IPC → exit 0 e WAL consolidato dopo una scrittura; `disconnect` → exit 0; porta occupata senza `MYFINANCE_PORT_FALLBACK` → exit 1 con il messaggio per l'utente. Funziona anche su Windows. |

## Verifica di compatibilità

`npm run typecheck:backend`, `npm run test:backend`, `npm run build:backend`, avvio di `apps/backend/dist/server.js` via IPC (lo stesso percorso del launcher), `launcher/run.test.ts` invariato e verde.

## Lasciato a chi implementa

- Nomi interni, testo esatto dei commenti (stile del file: commenti in italiano che spiegano il perché).
- Se `graceMs`/`safetyMs` servono davvero nei test unitari o bastano le costanti.
