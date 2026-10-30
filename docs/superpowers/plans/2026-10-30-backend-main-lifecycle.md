# Entry point del backend: orchestrazione, IPC e lifecycle — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Dentro ogni task: superpowers:test-driven-development; prima di chiuderlo: superpowers:verification-before-completion.

**Goal:** rendere `main.ts` un entry point leggero, con l'orchestrazione dell'avvio, l'IPC con il launcher e lo shutdown isolati, testabili e robusti in caso di avvio parziale.

**Architecture:** tre moduli senza import di DB né logger (ricevono le dipendenze come semplici oggetti): `server.ts` (`startServer`), `launcher-ipc.ts`, `shutdown.ts` (`createShutdown`). Solo `main.ts` importa i moduli reali e li cabla.

**Tech Stack:** Node 24, TypeScript (`strict`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), Express 5, `node:test` via `tsx --test`, `node:assert/strict`, better-sqlite3.

**Spec:** `docs/superpowers/specs/2026-10-30-backend-main-lifecycle-design.md`

## Global Constraints

- Nessuna nuova dipendenza npm; nessuna classe tranne `StartupFailedError`; nessun framework DI.
- Non modificare: `listen.ts`, `bootstrap.ts`, `app.ts`, `config.ts`, `paths.ts`, `db/**`, `modules/**`, `launcher/**`, `runtime.test.ts`, `restore.runtime.test.ts`.
- Protocollo IPC invariato: `ready` = `{ type: 'ready', host, port: actualPort, configuredPort, pid }`; il launcher invia `{ type: 'shutdown' }`.
- `MYFINANCE_PORT_FALLBACK === '1'` letto in `main.ts`; `MYFINANCE_PORT` invariato (in `config.ts`).
- Testi di log invariati, copiati verbatim dal `main.ts` attuale: `Avvio`, `Avvio interrotto: …`, messaggio `EADDRINUSE` con `MYFINANCE_PORT` e `config/settings.json`, `Impossibile mettersi in ascolto su …`, `La porta X era occupata: il server usa la Y`, `Backend in ascolto su http://…`; e da `shutdown.ts`: `Arresto richiesto (<reason>)`, `Database chiuso, WAL consolidato`, `Database chiuso senza consolidare il WAL`, `Arresto completato`, messaggio della rete di sicurezza.
- Segnali gestiti dal server: `SIGINT`, `SIGTERM`, `SIGHUP`, `SIGBREAK`.
- Timeout di shutdown: grazia 5 000 ms, sicurezza 15 000 ms.
- Fallimento del **bootstrap**: nessun `closeDatabase`. Fallimento di `listen`/`scheduler`/inatteso: `closeDatabase` + exit 1.
- Commenti in italiano che spiegano il perché, come nel resto del backend. Import con suffisso `.js`.
- Nuovi moduli e unit test **non** devono importare (nemmeno transitivamente, a runtime) `db/client.js`, `shared/logger.js`, `config.js`, `app.js`, `bootstrap.js`. `import type` è ammesso.

## Review Focus

1. **Launcher morto durante l'attesa del listen** (`process.connected === false` al collegamento): ci si aspetta arresto immediato, non un server orfano → test in Task 1.
2. **Invio di `ready` che fallisce** (callback con errore o `send` che solleva): arresto richiesto, nessuna eccezione → test in Task 1.
3. **Segnale e messaggio `shutdown` quasi simultanei** (Ctrl+C nella console del launcher li produce entrambi): un solo arresto, una sola uscita → test in Task 2 e smoke in Task 0b.
4. **`closeDatabase` che solleva durante l'arresto**: messaggio nel log ed exit 1, non un'eccezione non gestita → test in Task 2.
5. **Porta occupata in avvio senza launcher**: exit 1 con il messaggio per l'utente, nessun `ready` → smoke in Task 0b.

---

### Task 0: Branch

- [ ] Da `master` pulito: `git checkout -b refactor/backend-main-lifecycle`.
- [ ] `git add docs/superpowers/specs/2026-10-30-backend-main-lifecycle-design.md docs/superpowers/plans/2026-10-30-backend-main-lifecycle.md` e commit `docs(backend): design e piano del lifecycle di main`.
- [ ] Baseline: `npm run test:backend` → `ℹ fail 0` (683 test al 30/10).

### Task 0b: Smoke test IPC sul `main.ts` attuale (caratterizzazione)

**Files:**
- Test: `apps/backend/src/server.ipc.runtime.test.ts`

Prima di toccare il codice si fissa il comportamento osservabile del processo reale, sul percorso che il launcher usa davvero anche su Windows.

- [ ] **Step 1: scrivere lo smoke test.** Struttura come `runtime.test.ts` (tsx con percorso assoluto, ambiente costruito: elimina `DATABASE_FILE` e `PORT`, imposta `MYFINANCE_DATA` temporanea e `MYFINANCE_PORT`), ma `stdio: ['ignore', 'pipe', 'pipe', 'ipc']`. Helper: `pronto(child)` = Promise del primo messaggio `type === 'ready'` o rifiuto all'uscita; `uscita(child, ms = 30_000)` = codice di uscita o rifiuto (con `child.kill()`) a scadenza. Test:
  - `annuncia la porta effettiva, ripiegando se la configurata è occupata` → occupare una porta con `net.createServer().listen(0)`, `MYFINANCE_PORT_FALLBACK=1` → `ready.type === 'ready'`, `host === '127.0.0.1'`, `configuredPort === occupata`, `port !== occupata`, `pid === child.pid`; `GET /api/health` sulla `port` → 200; poi `send({ type: 'shutdown' })` → exit `0`.
  - `l'arresto chiesto via IPC consolida il WAL, anche se chiesto due volte` → `PATCH /api/settings` `{ initialBalance: 4321.99, balanceDate: '2026-05-01' }` → 200, WAL > 0; due `send({ type: 'shutdown' })` → exit `0`; WAL assente o vuoto; nell'output `Arresto richiesto (launcher)` compare una volta sola; riaprendo il file `select initial_balance_cents from settings` → `432199`.
  - `se il launcher si disconnette il server si arresta in ordine` → dopo `ready`, `child.disconnect()` → exit `0`; output contiene `Arresto richiesto (launcher disconnesso)` e `Arresto completato`. **Marcato `{ todo: 'attivato nel Task 4' }`**: oggi il server resta orfano.
  - `porta occupata senza ripiego: uscita 1 e messaggio per l'utente` → senza `MYFINANCE_PORT_FALLBACK`, porta occupata → nessun `ready`, exit `1`, output contiene `è già occupata da un altro programma` e `MYFINANCE_PORT`.
- [ ] **Step 2:** `npx tsx --test apps/backend/src/server.ipc.runtime.test.ts` → `ℹ fail 0`, `ℹ todo 1` (il todo fallisce per scadenza: è il bug 5 dello spec, atteso).
- [ ] **Step 3:** commit `test(backend): smoke test del protocollo IPC con il launcher`.

### Task 1: `launcher-ipc.ts`

**Files:**
- Create: `apps/backend/src/launcher-ipc.ts`
- Test: `apps/backend/src/launcher-ipc.test.ts`

**Interfaces:**
- Consumes: `import type { ListenOutcome } from './listen.js'`.
- Produces:
  ```ts
  export interface LauncherProcess {
    readonly pid: number;
    readonly connected?: boolean;
    readonly send?: (message: unknown, callback?: (error: Error | null) => void) => boolean;
    on(event: 'message', listener: (message: unknown) => void): unknown;
    on(event: 'disconnect', listener: () => void): unknown;
  }
  export function isShutdownMessage(message: unknown): message is { readonly type: 'shutdown' };
  export function connectLauncher(
    proc: LauncherProcess,
    listening: ListenOutcome,
    requestShutdown: (reason: string) => void,
  ): boolean;
  ```
  `LauncherProcess` deve accettare il `process` reale senza cast (verificato da `npm run typecheck:backend` in Task 4; se gli overload di `process.on` non sono assegnabili, adattare la firma di `on`, non usare `as`).

Comportamento: senza `send` → `false`, nessun listener. Altrimenti registra `message` e `disconnect`, poi invia `ready` con callback; se `connected === false`, se `send` solleva o la callback riceve un errore → `requestShutdown('launcher disconnesso')`. `message` valido → `requestShutdown('launcher')`; altro → ignorato. `disconnect` → `requestShutdown('launcher disconnesso')`. Restituisce `true`. Mai solleva.

- [ ] **Step 1: test che falliscono.** Finto processo: `EventEmitter` con `pid: 4242`, `connected: true`, `send` che registra i messaggi e chiama la callback con `null`. `listening = { host: '127.0.0.1', configuredPort: 3000, actualPort: 51000, fellBack: true }`. Test:
  - `isShutdownMessage`: `true` per `{ type: 'shutdown' }` e `{ type: 'shutdown', extra: 1 }`; `false` per `null`, `'shutdown'`, `{}`, `{ type: 'ready' }`, `{ type: 42 }`, `[]`.
  - `invia ready con i cinque campi` → `deepEqual(inviati, [{ type: 'ready', host: '127.0.0.1', port: 51000, configuredPort: 3000, pid: 4242 }])`, restituisce `true`.
  - `shutdown chiede l'arresto` → `emit('message', { type: 'shutdown' })` → richieste `['launcher']`.
  - `messaggi non validi o sconosciuti ignorati` → emit `null`, `'x'`, `{ type: 'boh' }`, `{}` → richieste `[]`.
  - `richieste duplicate inoltrate` → due `shutdown` → `['launcher', 'launcher']` (l'idempotenza è di `createShutdown`).
  - `disconnect chiede l'arresto` → `['launcher disconnesso']`.
  - `canale già chiuso` → `connected: false` → `['launcher disconnesso']` senza alcun emit.
  - `send con errore nella callback` → `['launcher disconnesso']`; `send che solleva` → idem, `doesNotThrow`.
  - `senza IPC` → oggetto senza `send` → `false`, `listenerCount('message') === 0`, `listenerCount('disconnect') === 0`.
- [ ] **Step 2:** `npx tsx --test apps/backend/src/launcher-ipc.test.ts` → FAIL (modulo inesistente).
- [ ] **Step 3:** implementare `apps/backend/src/launcher-ipc.ts`, spostando qui il commento "Il canale con il launcher" da `main.ts`.
- [ ] **Step 4:** stesso comando → `ℹ fail 0`.
- [ ] **Step 5:** commit `feat(backend): isola il canale IPC con il launcher`.

### Task 2: `shutdown.ts` con stato per istanza

**Files:**
- Modify: `apps/backend/src/shutdown.ts` (intero), `apps/backend/src/shared/logger.ts` (aggiunge solo `export type Logger = typeof logger;`)
- Modify: `apps/backend/src/shutdown.test.ts`
- Modify: `apps/backend/src/main.ts` (solo l'uso della nuova API, Step 5)
- Test: `apps/backend/src/shutdown.unit.test.ts`

**Interfaces:**
- Consumes: `import type { DatabaseCloseOutcome } from './db/client.js'`, `import type { Logger } from './shared/logger.js'`.
- Produces:
  ```ts
  export interface BackgroundWork { readonly stop: () => void }           // invariata
  export type CloseResult = 'consolidato' | 'non-consolidato' | 'fallito';
  export function closeAndReport(closeDatabase: () => DatabaseCloseOutcome, log: Logger): CloseResult;
  export interface ShutdownDeps {
    readonly server: Server;
    readonly background?: BackgroundWork;
    readonly closeDatabase: () => DatabaseCloseOutcome;
    readonly exit: (code: number) => void;
    readonly log: Logger;
    readonly graceMs?: number;   // default 5_000
    readonly safetyMs?: number;  // default 15_000
  }
  export function createShutdown(deps: ShutdownDeps): (reason: string) => void;
  export interface SignalSource { on(signal: NodeJS.Signals, listener: () => void): unknown }
  export function installSignalHandlers(request: (reason: string) => void, proc?: SignalSource): void; // default process
  ```
  Rimossi: `shutdown(...)`, `installShutdownHandlers(...)`, il flag di modulo `shuttingDown`.

`closeAndReport`: chiama `closeDatabase`; `checkpointed` → log info `Database chiuso, WAL consolidato` → `'consolidato'`; altrimenti log error `Database chiuso senza consolidare il WAL` → `'non-consolidato'`; se solleva → log error `Impossibile chiudere il database` con l'errore → `'fallito'`. In `createShutdown`, `finish` esce con `1` solo su `'fallito'` (`'non-consolidato'` resta `0`, come oggi). Sequenza, commenti e timer della rete di sicurezza (non `unref`) invariati.

- [ ] **Step 1: test che falliscono in `shutdown.unit.test.ts`.** Server HTTP reale su `127.0.0.1:0`, `closeDatabase` finto che restituisce `{ checkpointed: true, walPages: 0, movedPages: 0, alreadyClosed: false }`, logger finto che registra `[livello, messaggio]`, `exit` che risolve una Promise. Test:
  - `ferma le attività prima di chiudere il database ed esce con 0` → ordine `['stop', 'closeDatabase', 'exit 0']`; `server.listening === false`.
  - `è idempotente per istanza` → `richiedi('a'); richiedi('b')` nello stesso tick → un solo `stop`, una sola `exit`; un solo log `Arresto richiesto (a)`.
  - `due istanze sono indipendenti` → una seconda `createShutdown` su un altro server esce anch'essa con 0.
  - `closeDatabase che solleva → exit 1 e messaggio` → codice `1`, log error contiene `Impossibile chiudere il database`.
  - `WAL non consolidato → exit 0 e log di errore` → `checkpointed: false` → codice `0`, log `Database chiuso senza consolidare il WAL`.
  - `stop che solleva non blocca l'arresto` → codice `0`, log `Impossibile fermare le attività periodiche`.
  - `rete di sicurezza` → finto server `{ close() {}, closeIdleConnections() {}, closeAllConnections() {} }` con `as unknown as Server`, `graceMs: 10`, `safetyMs: 50` → codice `1`, `closeDatabase` mai chiamato.
  - `installSignalHandlers registra SIGINT, SIGTERM, SIGHUP e SIGBREAK` → su un `EventEmitter`, emettere ciascuno → richieste `['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']`.
- [ ] **Step 2:** `npx tsx --test apps/backend/src/shutdown.unit.test.ts` → FAIL (`createShutdown` non esportata).
- [ ] **Step 3:** riscrivere `shutdown.ts` secondo le interfacce; aggiornare il commento di `installSignalHandlers` (quattro sorgenti; l'IPC sta in `launcher-ipc.ts`).
- [ ] **Step 4:** adattare `shutdown.test.ts` (integrazione su DB reale): a livello di modulo `const richiedi = createShutdown({ server, background, closeDatabase, exit, log: logger })`, con `background` ed `exit` che registrano in variabili del modulo; il test del WAL resta identico nelle asserzioni; "una seconda richiesta di arresto non fa nulla" richiama **la stessa** `richiedi`; il test dei gestori usa `installSignalHandlers(() => {}, emitter)` su un `EventEmitter` invece di `process` e include `SIGBREAK`.
- [ ] **Step 5:** adattare `main.ts` al minimo per la nuova API, senza altro cambiamento: `const richiedi = createShutdown({ server, background: autoBackup, closeDatabase, exit: (code) => { process.exit(code) }, log: logger })`, `installSignalHandlers(richiedi)`, e nel gestore IPC esistente `richiedi('launcher')` al posto di `shutdown(...)`.
- [ ] **Step 6:** `npx tsx --test apps/backend/src/shutdown.unit.test.ts apps/backend/src/shutdown.test.ts apps/backend/src/server.ipc.runtime.test.ts` → `ℹ fail 0`; `npm run typecheck:backend` → nessun errore.
- [ ] **Step 7:** commit `refactor(backend): shutdown con stato per istanza, SIGBREAK e chiusura del DB protetta`.

### Task 3: `server.ts` — `startServer`

**Files:**
- Create: `apps/backend/src/server.ts`
- Test: `apps/backend/src/server.test.ts`

**Interfaces:**
- Consumes: `ListenFailedError` (valore) e `type ListenOutcome`, `type ListenRequest` da `./listen.js`; `createServer`, `type RequestListener`, `type Server` da `node:http`; `import type { Logger } from './shared/logger.js'`; `import type { BackgroundWork } from './shutdown.js'`.
- Produces:
  ```ts
  export interface StartOptions { readonly host: string; readonly port: number; readonly allowFallback: boolean }
  export interface ServerDeps {
    readonly bootstrap: () => void;
    readonly createApp: () => RequestListener;
    readonly listen: (server: Server, request: ListenRequest) => Promise<ListenOutcome>;
    readonly createScheduler: () => { start(): void; stop(): void };
    readonly log: Logger;
  }
  export interface StartedServer { readonly server: Server; readonly listen: ListenOutcome; readonly background: BackgroundWork }
  export type StartupPhase = 'bootstrap' | 'listen' | 'scheduler';
  export class StartupFailedError extends Error { readonly phase: StartupPhase } // cause via super(message, { cause })
  export async function startServer(options: StartOptions, deps: ServerDeps): Promise<StartedServer>;
  ```

Ordine e messaggi: come nella sezione "server.ts" dello spec. Su errore dello scheduler: `stop()` in `try/catch`, poi `server.closeAllConnections()` e `await` di `server.close`, log error `Impossibile avviare i backup automatici` con l'errore, poi `StartupFailedError('scheduler')`. Il commento sopra la funzione documenta l'ordine e perché i gestori di arresto stanno in `main.ts`. I commenti che oggi stanno in `main.ts` accanto a ciascun ramo (porta occupata, avvio non sicuro) si spostano qui.

- [ ] **Step 1: test che falliscono in `server.test.ts`.** Dipendenze finte che registrano in `ordine: string[]`; `createApp` restituisce `(_req, res) => { res.end('app di prova') }`; `listen` delega al vero `listenWithFallback` registrando la richiesta; `options = { host: '127.0.0.1', port: 0, allowFallback: false }`. Chiudere ogni server in `after`. Test:
  - `esegue bootstrap, app, listen e scheduler in quest'ordine` → `['bootstrap', 'createApp', 'listen', 'scheduler.start']`.
  - `il server serve l'applicazione ricevuta` → `fetch` sulla porta di `listen.actualPort` → testo `'app di prova'`.
  - `passa host, porta e permesso di ripiego al listen` → richiesta registrata `deepEqual { host: '127.0.0.1', port: 0, allowFallback: false }`; ripetere con `allowFallback: true`.
  - `restituisce l'esito del listen e lo scheduler come attività di sfondo` → `started.background.stop()` chiama lo `stop` finto.
  - `registra il ripiego` → `listen` finto che restituisce `fellBack: true, configuredPort: 3000, actualPort: <porta reale>` (dopo aver fatto `listen(0)` davvero) → log info `La porta 3000 era occupata: il server usa la …`.
  - `bootstrap fallito: niente listen` → `rejects` con `StartupFailedError`, `phase === 'bootstrap'`; `ordine` non contiene `listen`; log error `Avvio interrotto: archivio rotto` (bootstrap solleva `new Error('archivio rotto')`).
  - `porta occupata: messaggio per l'utente e niente scheduler` → `listen` solleva `new ListenFailedError('x', 47318, 'EADDRINUSE', errno)` → `phase === 'listen'`; log contiene `La porta 47318 è già occupata da un altro programma` e `MYFINANCE_PORT`; `ordine` non contiene `scheduler.start`.
  - `altro errore di listen: messaggio generico` → `code: 'EACCES'` → log contiene `Impossibile mettersi in ascolto su 127.0.0.1:`.
  - `scheduler fallito: server chiuso e scheduler fermato` → `start` solleva → `phase === 'scheduler'`, `stop` chiamato, `server.listening === false` (trattenere il server creato avvolgendo `listen`), log `Impossibile avviare i backup automatici`.
- [ ] **Step 2:** `npx tsx --test apps/backend/src/server.test.ts` → FAIL (modulo inesistente).
- [ ] **Step 3:** implementare `server.ts`.
- [ ] **Step 4:** stesso comando → `ℹ fail 0`; verificare con `grep` che `server.ts` non contenga import di valore da `db/`, `shared/logger`, `config`, `app`, `bootstrap`.
- [ ] **Step 5:** commit `refactor(backend): estrae startServer dall'entry point`.

### Task 4: `main.ts` leggero

**Files:**
- Modify: `apps/backend/src/main.ts` (intero)
- Modify: `apps/backend/src/server.ipc.runtime.test.ts` (solo rimozione del `todo`)

**Interfaces:**
- Consumes: `startServer`, `StartupFailedError` (Task 3); `createShutdown`, `installSignalHandlers`, `closeAndReport` (Task 2); `connectLauncher` (Task 1); `bootstrap`, `createApp`, `listenWithFallback`, `createAutoBackupScheduler`, `closeDatabase`, `config`, `SETTINGS_PROBLEM`, `logger` reali.

`main.ts` segue lo pseudocodice "main.ts" dello spec: log `SETTINGS_PROBLEM`, `allowPortFallback` con il suo commento, log `Avvio` identico, poi `startServer`. Nel catch: `StartupFailedError` con `phase === 'bootstrap'` → `process.exit(1)`; altrimenti (errore inatteso → prima log `Avvio interrotto: <messaggio>`) → `closeAndReport(closeDatabase, logger)`, `process.exit(1)`. Poi `createShutdown({ server, background, closeDatabase, exit: (code) => { process.exit(code) }, log: logger })`, `installSignalHandlers(richiedi)`, `connectLauncher(process, started.listen, richiedi)`.

- [ ] **Step 1:** rimuovere `{ todo: … }` dal test `disconnect` in `server.ipc.runtime.test.ts`.
- [ ] **Step 2:** `npx tsx --test apps/backend/src/server.ipc.runtime.test.ts` → FAIL solo `se il launcher si disconnette…` (scadenza).
- [ ] **Step 3:** riscrivere `main.ts`.
- [ ] **Step 4:** `npx tsx --test apps/backend/src/server.ipc.runtime.test.ts` → `ℹ fail 0`; `npm run typecheck:backend` → nessun errore (verifica anche che `process` soddisfi `LauncherProcess`).
- [ ] **Step 5:** `npm run test:backend` → `ℹ fail 0` (i flaky noti di A6 in `runtime.test.ts`/`backup.service.test.ts`, se compaiono, vanno rieseguiti e segnalati, non corretti qui).
- [ ] **Step 6:** commit `refactor(backend): main.ts come entry point leggero; arresto su disconnect del launcher`.

### Task 5: Verifica finale e revisione

- [ ] `npm run typecheck:backend` → nessun errore.
- [ ] `npm run test:backend` → `ℹ fail 0`; annotare il totale (atteso 683 + i nuovi).
- [ ] `npm run build:backend` → produce `apps/backend/dist/server.js` e `launcher.js` senza errori.
- [ ] Avvio del bundle come lo avvia il launcher: script nello scratchpad che esegue `node apps/backend/dist/server.js` con `stdio` `ipc`, `MYFINANCE_DATA` temporanea, `MYFINANCE_PORT_FALLBACK=1` → riceve `ready`, `GET /api/health` 200, `send({ type: 'shutdown' })` → exit 0, WAL assente o vuoto.
- [ ] Avvio senza launcher: `node apps/backend/dist/server.js` con `MYFINANCE_DATA` temporanea → `Backend in ascolto su …` nel log; la stessa porta occupata → exit 1 con il messaggio per l'utente.
- [ ] `npx tsx --test apps/backend/src/launcher/*.test.ts` → `ℹ fail 0`.
- [ ] Revisione dell'intero branch con superpowers:requesting-code-review, con i punti della sezione 9 della richiesta: complessità contro beneficio, cicli (`npx madge` non è installato: verificare con `grep` che nessun nuovo modulo importi `main.ts` o si importi a vicenda in ciclo), tipi, eccezioni, risorse, race, significatività dei test, compatibilità con il launcher.
- [ ] Report finale secondo la sezione "Report finale" della richiesta.
