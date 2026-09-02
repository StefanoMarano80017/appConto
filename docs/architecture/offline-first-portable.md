# Offline-First & Portable Application — Studio di fattibilità

> Documento di **analisi**. Nessuna modifica al codice è stata effettuata.
> Stato del repository analizzato: commit `9dbacff`, branch `master`.

---

## 1. Current Architecture

### 1.1 Struttura del repository

```
appConto/
├── package.json              root: dipendenze backend + tsx, NESSUN workspace
├── apps/
│   ├── backend/
│   │   ├── src/              ~9.200 LOC TypeScript, 10 moduli
│   │   ├── drizzle/          9 migrazioni + meta/_journal.json
│   │   ├── data/             appconto.db  (git-ignored)
│   │   ├── drizzle.config.ts path relativi alla ROOT del repo
│   │   └── tsconfig.json     "noEmit": true  ← nessuna build
│   └── frontend/
│       ├── package.json      node_modules separato
│       ├── angular.json      Angular 21, zoneless, CSR puro
│       └── src/              ~12.350 LOC
├── docs/architecture/
└── samples/
```

Due `node_modules` distinti (root ≈ 129 MB). Nessun monorepo tool, nessun
workspace npm: il coordinamento avviene tramite script `--prefix`.

### 1.2 Frontend — cosa ho trovato

| Aspetto | Stato reale |
|---|---|
| Framework | Angular 21.2, standalone components, **zoneless** (nessun polyfill `zone.js` in `angular.json`) |
| Rendering | CSR puro. Nessun SSR, nessun `server.ts`, nessun prerender |
| Routing | `PathLocationStrategy` (default), `<base href="/">`, 9 rotte **tutte eager** — nessun `loadComponent` |
| Bundle | `dist/frontend/browser/`: `main-*.js` 481 KB + `styles-*.css` 535 B + favicon → **497 KB totali** |
| HTTP | `provideHttpClient(withFetch())`, 8 servizi `*.api.ts` |
| **URL backend** | **Una sola costante**: `API_BASE_URL = 'http://localhost:3000'` in [core/api.ts](../../apps/frontend/src/app/core/api.ts) |
| Font | `'Segoe UI', Roboto, Helvetica, Arial, sans-serif` — **solo font di sistema**, nessun `@font-face`, nessun Google Fonts |
| CDN / script remoti | **Nessuno**. `index.html` non contiene un solo `<link>` o `<script>` esterno |
| Immagini remote | Nessuna. Solo `public/favicon.ico` |
| Telemetria | `angular.json` → `"analytics": false`. Nessuna telemetria a runtime |
| Storage browser | **Nessuno**: zero `localStorage`, `sessionStorage`, `IndexedDB`, `serviceWorker`. Tutto lo stato viene da HTTP |
| Service Worker | Assente (`@angular/pwa` non installato) |

Il risultato più importante di questa sezione: **il frontend è già offline-capable
al 100%**. L'unica dipendenza di rete è l'API locale, e il suo indirizzo è
concentrato in **una singola costante** usata da ~40 call site tramite
interpolazione. Cambiare il modo in cui il frontend trova il backend è una
modifica di **una riga**.

### 1.3 Backend — cosa ho trovato

Avvio ([main.ts](../../apps/backend/src/main.ts)), in ordine:

```
runMigrations()                              ← drizzle migrate, sincrono
transactionsService.backfillFingerprints()   ← one-shot, riga per riga
createApp().listen(config.port)              ← NESSUN host specificato
```

Configurazione ([config.ts](../../apps/backend/src/config.ts)):

```ts
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

port:             Number(process.env.PORT ?? 3000)
databaseFile:     process.env.DATABASE_FILE ?? path.join(backendRoot, 'data', 'appconto.db')
migrationsFolder: path.join(backendRoot, 'drizzle')      ← NON sovrascrivibile
maxCsvSize:       '10mb'
```

**Questa è la scoperta più favorevole di tutto lo studio.** I percorsi sono già
risolti a partire da `import.meta.url`, **non** da `process.cwd()`. Ho verificato
con `grep`: `process.cwd()` non compare in nessun punto del backend. Il backend è
quindi **già insensibile alla directory di lavoro**, che è precisamente la
proprietà che rende possibile un'app portatile. La cartella può essere spostata e
il database viene ritrovato, perché il codice cerca accanto a sé stesso.

L'indirezione è anche già **provata dai test**: 9 file di test impostano
`process.env.DATABASE_FILE` su una directory temporanea prima di importare i
moduli. Il meccanismo di override funziona ed è collaudato.

Composizione HTTP ([app.ts](../../apps/backend/src/app.ts)):

| Elemento | Stato | Nota |
|---|---|---|
| `app.use(cors())` | CORS **wildcard**: ogni origine, ogni metodo | Problema di sicurezza, §10 |
| `listen(port)` senza host | Node effettua il bind su **tutte le interfacce** | Problema di sicurezza, §10 |
| Body parser | **Per rotta**, non globale (`text()` per il CSV, `json()` altrove) | Corretto |
| Rotte montate | `/analytics /cash-flow /categories /dashboard /settings /import /loans /merchants /summary /transactions /health` | Tutte a livello root — §11 |
| Static file serving | **Assente** | Il frontend oggi non è servito da Express |
| SPA fallback | Assente | |
| Autenticazione | Assente | Corretto per un'app locale, *a condizione* che il bind sia loopback |
| Upload su disco | **Nessuno**: il CSV arriva come corpo testuale | Elimina traversal, zip-slip, file temporanei |
| Log | Solo `console.log` / `console.error` | Nessun file di log |
| Graceful shutdown | **Assente** | Conseguenza grave, §6.3 |

Nessun endpoint amministrativo, nessun endpoint che esponga il file del database,
nessuna operazione sul filesystem oltre a `mkdirSync` della directory dati.

### 1.4 Database — cosa ho trovato

[db/client.ts](../../apps/backend/src/db/client.ts): connessione unica,
aperta come **effetto collaterale dell'import** del modulo.

```ts
mkdirSync(path.dirname(config.databaseFile), { recursive: true });
const sqlite = new Database(config.databaseFile);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
```

* **Driver**: `better-sqlite3` v13 — sincrono.
* **Migrazioni**: 9, forward-only, applicate ad ogni avvio; `meta/_journal.json`
  tiene il registro. Drizzle esegue ogni migrazione in una propria transazione.
* **Seed**: migrazione `0003_seed_categories.sql`, 22 categorie con UUID fissi e
  `INSERT OR IGNORE` → idempotente, identico su ogni installazione. Ottima scelta.
* **Backup**: **inesistente**. Nessun endpoint, nessuno script, nessun `VACUUM INTO`.
* **Transazioni SQLite esplicite**: **nessuna**. `grep` su `.transaction(` non
  restituisce nulla. `insertMany` esegue N `INSERT` in chunk, ognuno nella propria
  transazione implicita.

#### Prova concreta del rischio WAL

Lo stato attuale di `apps/backend/data/` è la dimostrazione del problema più
serio per un'app portatile:

```
appconto.db          4.096 byte      ← praticamente solo l'header
appconto.db-wal  2.311.352 byte      ← TUTTI i dati sono qui
appconto.db-shm     32.768 byte
```

Il WAL non è **mai** stato consolidato. Non essendoci un handler di shutdown, il
processo `tsx watch` viene terminato bruscamente e `better-sqlite3` non arriva mai
a chiudere la connessione — quindi nessun checkpoint.

**Conseguenza diretta sul requisito §23**: se oggi l'utente copiasse
`finance.sqlite` senza i file `-wal` e `-shm`, **perderebbe l'intero archivio**.
Non è un rischio teorico: è lo stato del repository in questo momento. Qualunque
soluzione di packaging deve risolvere questo punto **prima** di essere distribuita.

### 1.5 Build e avvio — lo stato attuale

| | Oggi |
|---|---|
| Backend dev | `tsx watch apps/backend/src/main.ts` |
| Backend "prod" | `tsx apps/backend/src/main.ts` — **è lo stesso tsx** |
| Backend build | **Non esiste.** `tsconfig.json` ha `"noEmit": true` |
| Frontend dev | `ng serve` → `localhost:4200` |
| Frontend build | `ng build` → `dist/frontend/browser/` |
| Chi serve il frontend in prod | **Nessuno** |
| Avvio | **Due terminali**, come documentato nel README |

Non esiste quindi, al momento, una modalità di produzione. È la prima lacuna da
colmare, indipendentemente dall'architettura scelta.

### 1.6 Un fatto di packaging molto favorevole

`better-sqlite3` v13 include i **prebuild già compilati** per otto piattaforme:

```
prebuilds/win32-x64      win32-arm64
         darwin-x64      darwin-arm64
         linux-x64       linux-arm64
         linuxmusl-x64   linuxmusl-arm64
```

Significa: **nessun `node-gyp`, nessun compilatore C++, nessuna toolchain** in
fase di packaging, e il multipiattaforma (§14) si riduce a copiare il `.node`
giusto. È una delle ragioni per cui l'opzione A, sotto, costa molto poco.

### 1.7 Osservazione incidentale (fuori scope)

`escapeLike` in [shared/sql.ts](../../apps/backend/src/shared/sql.ts) contiene un
errore di template literal. Verificato eseguendolo:

```js
escapeLike('100%_x')  →  "100${character}${character}x"
```

`` `\${character}` `` produce il testo letterale `${character}`, non il carattere
preceduto da backslash. Cercare `100%` in Movimenti non trova nulla. Non ho
modificato il codice: lo segnalo perché emerso durante l'analisi e perché va
corretto prima di distribuire l'app a un utente non tecnico.

---

## 2. Offline Requirements

I cinque requisiti del §3 vanno tenuti separati, perché lo stato attuale è molto
diverso da requisito a requisito.

| Requisito | Definizione operativa | Stato attuale | Cosa manca |
|---|---|---|---|
| **Offline-capable** | Funziona con tutte le interfacce di rete disattivate | ✅ **Già soddisfatto** | Nulla. Zero CDN, zero font remoti, zero API esterne, zero telemetria |
| **Local-first** | Il DB locale è l'unica fonte di verità | ✅ **Già soddisfatto** | Nulla. Non esiste alcun backend remoto con cui sincronizzare |
| **Portable** | La cartella si sposta senza reinstallare | 🟡 **Quasi** | Separazione `app/` ÷ `data/`, checkpoint WAL, `node_modules` da eliminare |
| **Desktop-like** | Doppio click, nessun terminale | ❌ **Assente** | Build backend, static serving, runtime, launcher |
| **Self-contained** | La cartella contiene tutto | ❌ **Assente** | Runtime Node, bundle backend, prebuild nativo |

La lettura di questa tabella è la tesi centrale del documento: **"offline-first"
non è il problema da risolvere — è già risolto.** Il problema reale è
*distribuzione e ciclo di vita del dato*: come si avvia, come si sposta, come si
aggiorna, come si salva. Sono problemi di packaging e di operatività, non di
architettura applicativa. Questo cambia radicalmente il peso delle quattro
opzioni: le soluzioni che promettono "offline" (in primis la PWA) risolvono un
problema che non abbiamo, e ne creano di nuovi sul problema che abbiamo.

### 2.1 Verifica "internet OFF" (§15)

Ricerca esaustiva su `apps/frontend/src` e `apps/frontend/public` di
`https?://`, `//cdn`, `googleapis`, `gstatic`, `fonts.`, `unpkg`, `jsdelivr`,
`cdnjs`. **Due sole occorrenze**, entrambe nel codice sorgente e nessuna che
generi traffico esterno:

* `core/api.ts` → `http://localhost:3000` (il backend locale);
* `core/http-error.ts` → la stessa stringa in un messaggio d'errore.

Nessun `@import` né `url()` nei file SCSS. Nessun `@font-face`. Nessuna immagine
remota. Nessun update check. Nessun `navigator.onLine`.

**L'app supera già il test "Internet OFF / Wi-Fi OFF / Ethernet OFF"**, purché il
backend sia in esecuzione. Va evitata una sola regressione futura: nessun font
web, nessuna libreria da CDN, nessun controllo aggiornamenti online.

---

## 3. Portability Requirements

### 3.1 Il problema in una riga

Il requisito §6 — copiare `MyFinance/` da `C:\Users\Stefano\Documents\` a
`D:\PortableApps\` e ritrovare i dati — richiede che **nessun percorso assoluto
sopravviva allo spostamento** e che **nessuno stato viva fuori dalla cartella**.

### 3.2 Stato dei percorsi

| Meccanismo | Uso attuale | Verdetto |
|---|---|---|
| `import.meta.url` → `backendRoot` | Base di `databaseFile` e `migrationsFolder` | ✅ **Corretto e già portatile** |
| `process.cwd()` | **Mai usato nel backend** | ✅ Ottimo |
| `__dirname` | Non usato (ESM) | — |
| Percorsi assoluti hard-coded | Nessuno nel codice applicativo | ✅ |
| `process.env.DATABASE_FILE` | Override supportato, usato dai test | ✅ |
| `migrationsFolder` | **Non** sovrascrivibile | 🟡 Accettabile: le migrazioni *sono* codice, appartengono ad `app/` |
| `drizzle.config.ts` | `'./apps/backend/data/appconto.db'` **relativo al cwd** | 🟡 Solo strumento di sviluppo, non entra nel pacchetto |
| Directory dell'eseguibile | Concetto non ancora presente | ❌ Da introdurre nel launcher |
| Log | Solo stdout, nessun file | ❌ Da introdurre sotto `data/` |
| File temporanei | Nessuno in produzione; i test usano `os.tmpdir()` | 🟡 §8.4 |

### 3.3 La convenzione proposta: APP_ROOT / DATA_ROOT

Due radici, con una regola di appartenenza netta.

```
APP_ROOT/                        ← SOSTITUIBILE da un aggiornamento
├── MyFinance.exe                   launcher
├── app/
│   ├── backend/
│   │   ├── server.js               bundle esbuild
│   │   ├── drizzle/                migrazioni: sono CODICE
│   │   └── native/
│   │       └── better_sqlite3.node prebuild della piattaforma
│   ├── frontend/                   output di ng build
│   └── VERSION                     es. "1.4.0"
├── runtime/
│   └── node.exe                    runtime embedded
│
├── config/                      ← PRESERVATA dagli aggiornamenti
│   └── settings.json               opzionale, creata solo se serve
│
└── data/          = DATA_ROOT   ← MAI toccata da un aggiornamento
    ├── finance.sqlite
    ├── backups/
    ├── logs/
    ├── tmp/                        file temporanei: stesso volume del DB
    ├── runtime/
    │   └── port.lock               { pid, port, startedAt }
    └── .state.json                 { lastAppVersion, lastMigration }
```

**Regola di risoluzione** (da implementare in un unico `paths.ts`):

```
APP_ROOT  = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
            → dal bundle in app/backend/server.js si risale alla radice.
              Mai process.cwd(). Mai un percorso assoluto compilato.

DATA_ROOT = process.env.MYFINANCE_DATA
          ?? <config/settings.json>.dataRoot
          ?? join(APP_ROOT, 'data')
```

Tre regole non negoziabili:

1. **Precedenza fissa**: env → config file → default. Un percorso *relativo* nel
   file di configurazione si risolve **rispetto ad APP_ROOT**, mai al cwd.
2. **Il pacchetto distribuito non contiene percorsi assoluti.** `settings.json`
   nasce vuoto o assente; l'utente può scrivere `"dataRoot": "../MyFinanceData"`
   o un percorso assoluto solo se *sceglie* di farlo.
3. **`data/tmp/` sta sotto DATA_ROOT, non in `os.tmpdir()`.** Motivo tecnico
   preciso: i backup vengono scritti come file temporaneo e poi rinominati, e
   `rename()` è atomico **solo all'interno dello stesso volume**. Con
   `os.tmpdir()` su `C:` e un DB su una chiave USB `E:`, l'operazione degenera in
   una copia non atomica. Questa scelta è quella che rende i backup affidabili
   quando la cartella vive su un supporto rimovibile.

### 3.4 Dove vive cosa

| Elemento | Radice | Sopravvive all'update | Perché |
|---|---|---|---|
| `database` | `DATA_ROOT/finance.sqlite` | ✅ | È il dato dell'utente |
| `backups` | `DATA_ROOT/backups/` | ✅ | Sono dati dell'utente |
| `logs` | `DATA_ROOT/logs/` | ✅ | Diagnostica del *suo* uso |
| `tmp` | `DATA_ROOT/tmp/` | ✅ (svuotata all'avvio) | Atomicità del rename |
| `migrations` | `APP_ROOT/app/backend/drizzle/` | ❌ (sostituite) | **Sono codice versionato** |
| `config` utente | `APP_ROOT/config/settings.json` | ✅ | Scelta dell'utente |
| `config` default | dentro il bundle | ❌ | Sono codice |
| frontend, backend, runtime | `APP_ROOT/app/`, `APP_ROOT/runtime/` | ❌ | Sono l'applicazione |

Il punto delicato è `migrations`: appartengono ad `app/` (sono artefatti di
build), ma il **registro di quali sono state applicate** vive nel database, cioè
in `data/`. È esattamente la separazione corretta, ed è ciò che rende possibile
la strategia di aggiornamento del §9.

---

## 4. Packaging Analysis

### 4.1 Le cinque opzioni di distribuzione

| Opzione | Dimensione | Complessità build | UX utente non tecnico | Aggiornabilità | Portabilità |
|---|---|---|---|---|---|
| **npm package** (`npx myfinance`) | ~2 MB + Node di sistema | Minima | ❌ Richiede Node, terminale, `npx` | ✅ `npm update` | ❌ Dati in `~/.myfinance` |
| **Standalone folder + Node di sistema** | ~5 MB | Bassa | 🟡 Serve Node installato | 🟡 Sostituzione manuale | ✅ Buona |
| **Standalone folder + Node embedded** | **~118 MB** | **Media-bassa** | ✅ Doppio click | ✅ Sostituisci `app/` + `runtime/` | ✅ **Ottima** |
| **Electron package** | ~180-250 MB | Media-alta | ✅ Finestra nativa | ✅ `electron-updater` maturo | ✅ Buona (build `--dir`) |
| **Tauri package** | ~15-25 MB *+ sidecar Node ~110 MB* | **Alta** | ✅ Finestra nativa | 🟡 Updater proprio | 🟡 Vedi §5.4 |

Dettaglio della terza riga, che è quella raccomandata:

| Componente | Dimensione stimata |
|---|---|
| `runtime/node.exe` (Node 24 win-x64) | ~110 MB |
| `app/backend/server.js` (esbuild: express + drizzle + zod + papaparse) | ~1,5 MB |
| `app/backend/native/better_sqlite3.node` | ~2,5 MB |
| `app/backend/drizzle/` | ~50 KB |
| `app/frontend/` | **497 KB** (misurato) |
| `MyFinance.exe` (launcher Go) | ~3 MB |
| **Totale** | **≈ 118 MB, di cui 110 MB è node.exe** |

Osservazione: **l'applicazione vera è meno di 5 MB.** Tutto il peso è il runtime.
Questo è rilevante per gli aggiornamenti (§9): un aggiornamento che non cambia
versione di Node è un download di **pochi MB**.

### 4.2 Alternative valutate per il runtime

* **Node SEA** (Single Executable Application, stabile da Node 20): incorpora il
  JS in una copia di `node.exe`. Il risultato pesa comunque ~110 MB, il `.node`
  nativo resta esterno, e si aggiunge complessità di build. **Nessun vantaggio
  reale** rispetto a spedire `node.exe` e un `server.js` accanto — che ha anche il
  pregio di essere ispezionabile e sostituibile.
* **Richiedere Node di sistema**: viola "self-contained" e "utente non tecnico".
  Scartata.
* **`node:sqlite`** (built-in in Node 24) al posto di `better-sqlite3`:
  eliminerebbe il `.node` nativo. Ma richiederebbe di riscrivere il driver
  Drizzle. Non giustificato: i prebuild di `better-sqlite3` risolvono già il
  problema che questa sostituzione risolverebbe. **Da non fare.**

### 4.3 Il launcher: quale tecnologia

| Opzione | Peso | Pro | Contro |
|---|---|---|---|
| `start.bat` | 0 | Zero build | Finestra console visibile, nessuna icona, nessun single-instance |
| `.vbs`/`.cmd` wrapper | 0 | Nasconde la console | Fragile, allarma gli antivirus |
| **Go, singolo eseguibile** | ~3 MB | Icona, nessuna console, mutex single-instance, tray, cross-compile banale (`GOOS`) | Un linguaggio in più nel progetto |
| Rust | ~2 MB | Idem | Build più lenta, curva più ripida |
| C# | ~1 MB o ~15 MB AOT | Integrazione Windows ottima | Dipende da .NET se non AOT |

**Raccomandazione: Go.** Il launcher è ~300 righe che non cambieranno quasi mai,
e Go cross-compila per Windows, Linux e macOS da una sola macchina senza
toolchain aggiuntive. Nella Fase 4 (§13) si usa `start.bat` come ponte: permette
di validare il pacchetto prima di scrivere il launcher.

---

## 5. PWA vs Localhost vs Electron vs Tauri

### 5.1 Opzione A — Angular + Express + SQLite + Node embedded

```
MyFinance.exe ──► runtime/node.exe app/backend/server.js
                        │
                        ├── serve app/frontend/  (static + SPA fallback)
                        ├── /api/*               (i 10 router esistenti)
                        └── data/finance.sqlite  (WAL)
                        │
                        └──► msedge --app=http://127.0.0.1:47318
```

**Cosa cambia nel codice esistente.** Poco, e in punti già isolati:

1. `app.ts`: montare i router sotto `/api`, aggiungere `express.static` + SPA
   fallback, rimuovere `cors()` in produzione. **~15 righe.**
2. `core/api.ts`: `API_BASE_URL = '/api'`. **1 riga** — i ~40 call site
   interpolano la costante e non vengono toccati.
3. `config.ts` → `paths.ts`: introdurre APP_ROOT/DATA_ROOT. **~30 righe.**
4. `main.ts`: bind su `127.0.0.1`, graceful shutdown con checkpoint. **~20 righe.**
5. Nuovo: script di build (esbuild) e di packaging. **Codice nuovo, zero impatto
   sull'esistente.**

**Cosa NON cambia**: i 10 moduli di dominio, i repository, i servizi, le view
model, le migrazioni, i test backend, i componenti Angular, gli store, il
routing. Le *feature boundaries* del §18 sono intatte perché tutte le modifiche
cadono nei "bordi" che l'architettura ha già isolato — esattamente i punti che
[architecture.md](architecture.md) chiama adattatori.

**Costi reali, senza sconti:**

* La finestra è un browser. Con `--app` non ha barra indirizzi né schede, ma resta
  Edge/Chrome: nessun menu nativo, nessuna icona nella tray *senza* il launcher,
  aggiornamenti del browser fuori dal nostro controllo.
* Nessun dialogo di sistema per salvare file: un export scarica nella cartella
  Download. Per questa app è irrilevante (l'import è `<input type=file>`, l'export
  è un blob).
* La chiusura della finestra non termina il backend: serve il launcher residente.
* Un `.exe` non firmato attiva SmartScreen al primo avvio (§14 dei rischi).

### 5.2 Opzione B — PWA

**Cosa servirebbe davvero.** Non è un porting, è una riscrittura del lato dati.

| Passaggio | Lavoro |
|---|---|
| SQLite nel browser | `@sqlite.org/sqlite-wasm` + **OPFS** per la persistenza (IndexedDB come fallback, molto più lento) |
| Driver Drizzle | Il driver attuale `better-sqlite3` è **sincrono**. Quello WASM/OPFS è **asincrono**. Ogni `.all()`, `.get()`, `.run()` nei repository e nei service diventa `await` — **e ogni service diventa async a cascata**, quindi ~9.200 LOC di backend da rivedere |
| Dove gira la logica | I 10 moduli devono spostarsi *dentro* il bundle browser, tipicamente in un Web Worker (OPFS sincrono richiede un worker). Il confine HTTP che oggi separa dominio e UI **scompare**, e con esso la regola "il frontend non accede mai al database" di [architecture.md](architecture.md) |
| Migrazioni | `drizzle-orm/better-sqlite3/migrator` legge le migrazioni **dal filesystem**. Nel browser non esiste: va reimplementato il migratore, incluso il journal |
| Import CSV | Funzionerebbe (già `file.text()`), ma il parsing di 10 MB va nel worker per non bloccare la UI |
| Backup | Si può leggere il file OPFS e offrirlo come download. Il *restore* è più delicato: sovrascrivere un file OPFS con il DB aperto |
| Bundle | +1,5 MB circa di WASM |

**E poi il punto che chiude la discussione.** Il database OPFS vive nel profilo
del browser, indicizzato per **origine**. Non è un file in una cartella. Quindi:

* non si può copiare `MyFinance/` su un'altra macchina e ritrovare i dati — **il
  requisito §6 e il criterio di successo §23 diventano tecnicamente impossibili**;
* il DB è legato all'origine: cambiare `localhost:4200` in `127.0.0.1:8080` fa
  vedere all'app un archivio **vuoto**;
* "Cancella dati di navigazione" cancella l'archivio finanziario;
* in modalità privata l'app parte vuota ogni volta.

Una PWA risolverebbe l'offline — che **è già risolto** — e distruggerebbe la
portabilità, che è il requisito che il documento definisce "fondamentale". Non è
un compromesso: è una **squalifica**. La PWA va scartata.

### 5.3 Opzione C — Electron

```
Electron main  ──► avvia (o importa) il server Express in-process
      │
      └── BrowserWindow ──► http://127.0.0.1:port  oppure  file:// + IPC
```

| | |
|---|---|
| **Vantaggi** | Finestra vera con icona propria, menu nativi, dialoghi file nativi, tray, single-instance integrato (`app.requestSingleInstanceLock()`), `electron-updater` maturo con delta e firma, comportamento identico su Windows/macOS/Linux perché il Chromium è il *nostro* |
| **Svantaggi** | 180-250 MB; RAM 180-300 MB (Chromium dedicato, non condiviso con il browser già aperto); superficie di sicurezza da configurare (`contextIsolation`, `nodeIntegration: false`, CSP); `electron-builder` nella pipeline di build; **il modulo nativo va ricompilato per l'ABI di Electron** (`electron-rebuild`) — l'unico punto in cui i prebuild di `better-sqlite3` non aiutano |
| **Dimensione** | ~180 MB (`--dir`, portatile) / ~90 MB installer NSIS compresso |
| **Packaging** | `electron-builder`: molto maturo, molti target |
| **Filesystem / DB** | Accesso pieno; `app.getPath('userData')` — ma per la **portabilità va evitato** e sostituito con la logica APP_ROOT/DATA_ROOT, esattamente come nell'opzione A |
| **Aggiornamenti** | Il punto in cui Electron è genuinamente superiore: auto-update firmato e differenziale, gratis |
| **Sicurezza** | Da configurare, ma il vantaggio strutturale è reale: **niente porta in ascolto** se si usa IPC invece di HTTP. Elimina alla radice i problemi del §10 |
| **Portabilità** | Buona con il target `dir`/portable; i dati vanno comunque reindirizzati a mano |
| **Windows / Linux / macOS** | Tutti e tre, con `electron-rebuild` per ciascuno |

Electron **funzionerebbe**. Il punto è che, per ottenerlo, va costruito prima
tutto ciò che serve all'opzione A (build backend, static serving, DATA_ROOT,
backup, migrazioni sicure) e **poi** si aggiungono 180 MB, `electron-rebuild` e
una dipendenza nel ciclo di sviluppo quotidiano — in cambio di: finestra
garantita senza browser, dialoghi nativi, auto-update. Per un'app personale a
utente singolo, è un prezzo alto per benefici che il launcher + `--app` mode
coprono all'80%.

### 5.4 Opzione D — Tauri

Qui c'è un fraintendimento diffuso da chiarire, perché ribalta la valutazione.

**Tauri non include un runtime Node.** Il processo host è Rust, la webview è
quella del sistema (WebView2 su Windows). Non esiste un posto dove far girare
Express. Restano due strade:

**D1 — Express come sidecar.** Tauri lancia `node.exe app/backend/server.js`
come processo esterno e la webview punta a `127.0.0.1`.
→ Serve **tutto** ciò che serve all'opzione A (runtime Node embedded, bundle,
porta, health check, DATA_ROOT) **più** Rust, `tauri.conf.json`, la gestione dei
sidecar e la firma. È **strettamente più complesso dell'opzione A**, con in più il
peso del runtime Node che si voleva evitare. Il vantaggio dimensionale di Tauri
**svanisce**: 15 MB + 110 MB di Node.

**D2 — Riscrivere il backend in Rust.** Si buttano ~9.200 LOC di dominio
TypeScript, i test, Drizzle, e l'intera struttura descritta in
[architecture.md](architecture.md). Sono mesi di lavoro per ottenere la stessa
applicazione, e violerebbe frontalmente il §18 ("non compromettere il dominio")
e il principio "Incremental Evolution".

| | |
|---|---|
| **Vantaggi** | Binario piccolissimo (D2), RAM contenuta, sicurezza per default, allowlist granulare |
| **Svantaggi** | Rust nella toolchain; WebView2 va garantita presente (evergreen su Win11, non su Win10 vecchi); ecosistema updater meno maturo di Electron; **integrazione con Express: nulla** |
| **Riscrittura backend** | D1: nessuna, ma nessun vantaggio. D2: **totale** |
| **Dimensione** | D1: ~125 MB. D2: ~20 MB |
| **Portabilità** | Buona in astratto, ma D1 eredita ogni complessità di A e D2 non è realizzabile in tempi ragionevoli |

**Tauri è la peggiore delle quattro opzioni per questo progetto specifico.** Non
per demerito proprio — è un'ottima tecnologia — ma perché il suo punto di forza
(nessun runtime JS incorporato) è precisamente incompatibile con l'asset più
grande del progetto: un backend Node maturo e testato.

### 5.5 Opzione E — Soluzioni ibride

L'opzione A **è** già l'ibrido descritto al §4E: Angular → localhost → Express →
SQLite, con un piccolo launcher nativo. Non serve inventare altro. Vale però
rendere espliciti i due gradi di libertà, perché è qui che si guadagna UX a costo
quasi zero:

**E1 — Browser di default.** `MyFinance.exe` apre l'URL nel browser predefinito.
Zero codice extra. UX: una scheda con barra indirizzi. Funziona sempre.

**E2 — Modalità applicazione del browser (raccomandata).**

```
msedge.exe --app=http://127.0.0.1:47318 --window-size=1400,900
           --user-data-dir=<APP_ROOT>/data/browser-profile
```

Finestra **senza barra indirizzi, senza schede**, con icona propria nella barra
delle applicazioni. Su Windows 11 `msedge.exe` è **garantito presente**, quindi
non è un requisito aggiuntivo. Con `--user-data-dir` dedicato la finestra è
isolata dal profilo personale dell'utente e non subisce le sue estensioni.
Fallback a cascata: Edge → Chrome → browser di default.

**Il risultato di E2 è visivamente indistinguibile da Electron per il 90% degli
utenti, a costo zero di dimensione e RAM aggiuntiva.** È il punto di equilibrio
dell'intero studio, e la ragione principale per cui la desktop shell non serve.

### 5.6 La domanda del §5: serve una desktop shell?

Confronto concreto, sul caso d'uso reale (un utente, un PC, doppio click):

| | Browser + localhost (`--app`) | Electron | Tauri (D1) |
|---|---|---|---|
| Doppio click → app aperta | ✅ ~1,5-2,5 s | ✅ ~1,5-3 s | ✅ ~1-2 s |
| Finestra senza barra indirizzi | ✅ con `--app` | ✅ garantita | ✅ garantita |
| Icona nella barra applicazioni | ✅ | ✅ | ✅ |
| Dimensione distribuzione | 118 MB | 180-250 MB | ~125 MB |
| RAM | node ~70 MB + finestra ~150 MB *condivisa col browser già aperto* | ~250 MB **dedicati** | ~120 MB |
| Menu nativi, dialoghi file | ❌ | ✅ | ✅ |
| Rischio "il browser cambia sotto di noi" | 🟡 reale | ✅ nessuno | 🟡 WebView2 |
| Righe di codice nuove | **~350** (launcher + build) | ~700 + config builder | ~900 + Rust |
| Impatto su `npm run dev` | **Nessuno** | Presente | Presente |
| Superficie di rete | Porta loopback in ascolto | **Nessuna** (con IPC) | Porta loopback |
| Auto-update | Da costruire | ✅ Maturo | Da costruire |

**Risposta: no, una desktop shell non serve.** Le tre cose che Electron dà in più
— dialoghi nativi, assenza di porta in ascolto, auto-update — sono
rispettivamente: non necessaria per questa app, mitigabile con quattro middleware
(§10), e non richiesta finché la distribuzione è "scarica lo zip, sostituisci
`app/`".

E il punto strategico decisivo: **il percorso raccomandato è un prefisso esatto
del percorso Electron.** Tutto ciò che si costruisce nelle fasi 1-7 (build
backend, static serving, APP_ROOT/DATA_ROOT, checkpoint WAL, backup con
`VACUUM INTO`, migrazioni sicure, aggiornamenti) è **necessario anche** in una
versione Electron. Se un giorno la finestra chromeless diventasse un requisito
rigido, Electron si aggiunge sopra senza buttare nulla. Non è un vicolo cieco: è
la fondazione condivisa. Nessuna delle altre tre opzioni ha questa proprietà.

---

## 6. Database Strategy

### 6.1 SQLite resta la scelta corretta

Confermato, e senza esitazioni. Le ragioni sono strutturali, non di comodità:

* è un **singolo file** — cioè esattamente l'unità che il §6 vuole poter copiare;
* zero configurazione, zero servizio, zero porta: nessun'altra opzione lo offre;
* transazioni ACID reali, chiavi esterne, e il vincolo `UNIQUE` su `fingerprint`
  che è ciò che rende l'import idempotente — una garanzia *del database*, non del
  codice applicativo;
* `VACUUM INTO` fornisce backup consistenti a caldo, senza fermare l'app;
* i prebuild multipiattaforma (§1.6) risolvono il packaging.

**Nessuna motivazione per cambiare.** Un DB server (Postgres embedded, ecc.)
distruggerebbe portabilità e self-containment. Un file JSON o DuckDB
perderebbero rispettivamente ACID e maturità sul carico transazionale.

### 6.2 Lock e concorrenza

`better-sqlite3` è sincrono e Node è single-thread: **all'interno di un processo
non esiste contesa**. Ogni richiesta HTTP viene servita in sequenza. Il modello
di concorrenza dell'app è, di fatto, "un writer alla volta" — la condizione in cui
SQLite è più solido.

Il caso critico sono **due processi**. WAL permette più writer, e
`better-sqlite3` applica un `busy_timeout` di 5 secondi, quindi funzionerebbe
quasi sempre — ma "quasi" non è la garanzia che si vuole su dati finanziari, e due
UI che mostrano stati diversi confonderebbero. **Il single-instance del launcher
(§11) è la mitigazione corretta**, non il lock del database.

### 6.3 Journaling, WAL, e il checkpoint obbligatorio

Il WAL è la scelta giusta e va mantenuta: sopravvive ai crash, non blocca i lettori
durante una scrittura, ed è più veloce sugli import massivi. Ma comporta tre
obblighi che oggi non sono soddisfatti:

**1. Checkpoint alla chiusura — la correzione più importante di tutto il documento.**

```
SIGINT / SIGTERM / richiesta di shutdown
   → sqlite.pragma('wal_checkpoint(TRUNCATE)')
   → sqlite.close()
```

Dopo un'uscita pulita, `finance.sqlite` è **autosufficiente**: `-wal` e `-shm`
sono vuoti o assenti. È ciò che rende vero il criterio §23 "copia la cartella e
ritrova i dati". Senza questo, lo stato osservato al §1.4 (4 KB di DB, 2,3 MB di
WAL) si ripresenterà su ogni installazione, e la prima copia della cartella
sembrerà riuscita per poi rivelarsi vuota.

**2. I backup non si fanno copiando il file.** Si fanno con `VACUUM INTO`, che
produce un file singolo, consistente, compattato e **già comprensivo del
contenuto del WAL**, mentre l'app è in esecuzione. È il cuore del §8.

**3. Il WAL non è utilizzabile su alcuni filesystem.** Il file `-shm` richiede
memoria condivisa mappata: su condivisioni di rete (SMB/NFS) il WAL può fallire o
corrompersi. Rilevante per il §7, sotto.

Alternativa valutata: passare a `journal_mode = DELETE` per avere sempre un solo
file. **Scartata**: si perderebbero resilienza ai crash e concorrenza
lettore/scrittore, per ottenere un beneficio che checkpoint-alla-chiusura +
`VACUUM INTO` già garantiscono.

### 6.4 Copia, USB, cartelle sincronizzate

| Scenario | Verdetto | Regola |
|---|---|---|
| Copia della cartella con **app chiusa** | ✅ Sicuro | Dopo il checkpoint il DB è un file singolo e coerente |
| Copia con **app aperta** | ❌ **Rischio corruzione** | Il launcher residente rende evidente che l'app è in esecuzione; da documentare |
| DB su **chiave USB** (exFAT/NTFS) | ✅ Funziona | Single-writer; `data/tmp` sullo stesso volume garantisce rename atomico |
| DB su **condivisione di rete** (SMB/NFS) | ❌ **Da vietare** | Il locking WAL non è affidabile |
| DB in **OneDrive / Dropbox / Google Drive** | ❌ **Il rischio più concreto** | Il servizio sincronizza `.db` e `-wal` in momenti diversi, o legge un file a metà scrittura → corruzione silenziosa |
| Due istanze contemporanee | 🟡 Tecnicamente tollerato, da impedire | Mutex nel launcher |

**Mitigazione per il caso cloud**, che è quello in cui un utente cade
spontaneamente ("metto la cartella in OneDrive così ho un backup"): all'avvio,
confrontare DATA_ROOT con i percorsi noti dei client di sincronizzazione
(`%OneDrive%`, `~/Dropbox`, `~/Google Drive`) e mostrare un avviso non bloccante
in Impostazioni: *"la cartella dati è sincronizzata sul cloud: c'è rischio di
corruzione. Usa Backup → Esporta per conservare copie su cloud."* Il messaggio
indirizza l'utente verso la strada corretta invece di limitarsi a vietare.

### 6.5 Atomicità delle scritture applicative

Manca oggi, e va aggiunta prima della distribuzione:

* `insertMany` esegue N `INSERT` in chunk **senza transazione avvolgente**: un
  crash a metà import lascia un import parziale. Il danno è limitato dal design
  del `fingerprint` — **reimportare lo stesso file completa l'operazione senza
  duplicare** (l'idempotenza progettata nel WP4 protegge già da questo scenario) —
  ma la correzione è banale e va fatta:

  ```
  const insertAll = sqlite.transaction((items) => { ... });
  ```

  Beneficio collaterale non trascurabile: su un import di migliaia di righe,
  un'unica transazione è **10-100× più veloce** di N transazioni implicite.

* `backfillFingerprints()` aggiorna riga per riga all'avvio: stessa correzione.

* Le operazioni sui prestiti sono scritture singole (`insert`, `update`,
  `delete`) e sono già atomiche per costruzione. Va però verificato che una
  futura operazione composta (es. "elimina prestito e le sue restituzioni") nasca
  già dentro `sqlite.transaction()`.

### 6.6 Prestazioni e volumi (§19)

| Metrica | Stima |
|---|---|
| Apertura DB + pragma + verifica migrazioni | 10-30 ms |
| Avvio processo Node (cold) | 40-60 ms |
| Import di express + drizzle + moduli | 150-300 ms |
| **Backend pronto** | **< 1 s** |
| Finestra browser (Edge cold / warm) | 1-2 s / ~300 ms |
| **Doppio click → app usabile** | **~1,5-2,5 s a freddo** |
| RAM: processo Node | 60-90 MB |
| Backup `VACUUM INTO` di un DB da 50 MB | < 1 s |
| Build Angular produzione | 10-20 s |
| Build backend (esbuild) | < 1 s |

Sui volumi: un uso personale realistico produce 500-5.000 transazioni all'anno,
cioè **decine di migliaia nell'arco di una vita**. SQLite le scansiona in
millisecondi. **Non c'è nulla da ottimizzare.**

Per completezza, i due limiti che emergerebbero a *milioni* di righe: la ricerca
usa `LIKE '%…%'`, che **non può usare un indice** in nessun database (la risposta
sarebbe FTS5), e `transactions` non ha indici su `booking_date` / `merchant_id`
(un indice su `booking_date` sarebbe la prima mossa, banale). Entrambi sono
osservazioni per il futuro: **oggi ottimizzarli sarebbe premature optimization**,
come chiede il §19.

---

## 7. Data Directory Strategy

Definita al §3.3. Qui le decisioni operative che ne conseguono.

### 7.1 Configurazione (§16)

Precedenza, dal più forte al più debole:

```
1. Variabile d'ambiente      MYFINANCE_PORT, MYFINANCE_DATA
                             (le imposta il launcher; utili anche in CI e nei test)
2. config/settings.json      scelta esplicita dell'utente
3. Default derivati da APP_ROOT
```

`config/settings.json`, **interamente opzionale**, con soli percorsi relativi:

```json
{
  "port": 47318,
  "dataRoot": "./data",
  "browser": "auto",
  "backup": { "auto": true, "keepDaily": 7, "keepWeekly": 4 }
}
```

Regole:

* nel pacchetto distribuito il file **non esiste** o è privo di percorsi: nessun
  `C:\Users\...` viene mai spedito;
* un percorso relativo si risolve **rispetto ad APP_ROOT**, mai al cwd — è ciò che
  rende la configurazione sopravvissuta allo spostamento della cartella;
* le variabili d'ambiente conservano `DATABASE_FILE` come alias per non rompere i
  9 file di test che già lo usano.

Nota su `LOG_PATH`: non serve una variabile dedicata. I log derivano da
DATA_ROOT (`DATA_ROOT/logs/`). Meno superficie di configurazione, meno modi di
sbagliare.

### 7.2 Logging

Oggi solo `console`. In produzione lo stdout del processo non ha una finestra
dove finire, quindi va scritto su file:

```
data/logs/app-YYYY-MM-DD.log      rotazione giornaliera, ritenzione 14 giorni
data/logs/launcher.log            stdout/stderr catturati dal launcher
```

Il `logger` attuale è già l'unico punto di uscita ed è usato solo ai bordi
dell'applicazione: aggiungere un sink su file è una modifica di ~20 righe in un
solo file. **Nessun dato sensibile nei log**: gli importi e le descrizioni non
vanno registrati (oggi `import.service.ts` logga il *riepilogo* numerico, che va
bene).

---

## 8. Backup / Restore Strategy

Questa sezione è, insieme al §6.3, la più importante del documento: è l'unica
parte che protegge dati non ricostruibili.

### 8.1 Primitiva unica

**Ogni** backup si crea con:

```sql
VACUUM INTO '<destinazione>';
```

Perché non `fs.copyFile`: `VACUUM INTO` produce un file **singolo, consistente,
compattato, comprensivo del WAL**, generato mentre l'app è in esecuzione e senza
bloccare gli scrittori. Una copia del filesystem, sullo stesso database, può
catturare uno stato intermedio o perdere il WAL — cioè, come mostrato al §1.4,
perdere tutto.

### 8.2 Sequenza di creazione (atomica)

```
1. VACUUM INTO  data/tmp/<nome>.partial          ← stesso volume del DB
2. apri il file in sola lettura
     PRAGMA integrity_check      → deve dire "ok"
     conteggio righe delle tabelle principali → confronto di sanità
3. rename(data/tmp/<nome>.partial → data/backups/<nome>.sqlite)   ← atomico
4. scrivi il risultato nel log
```

L'invariante che ne deriva: **in `backups/` non esiste mai un file a metà.** Un
nome definitivo implica un backup verificato. È il motivo per cui `data/tmp/`
deve stare sullo stesso volume (§3.3, regola 3).

### 8.3 Tassonomia e ritenzione

```
data/backups/
├── pre-migration-0008-to-0011-20260826-141230.sqlite   conservati: ultimi 5
├── pre-restore-20260826-150000.sqlite                  conservati: ultimi 3
├── auto-20260826-190000.sqlite                         7 giornalieri + 4 settimanali
└── manual-20260826-143000.sqlite                       mai eliminati automaticamente
```

Naming: `<tipo>-<timestamp ordinabile>.sqlite`. Il timestamp
`YYYYMMDD-HHmmss` rende l'ordinamento alfabetico identico a quello cronologico,
quindi la pruning è una `readdir` + `sort` + `slice`, senza leggere metadati né
parsare date. Semplice e non ambiguo.

| Tipo | Quando | Ritenzione |
|---|---|---|
| `pre-migration` | Automatico, **prima** di ogni migrazione che cambia lo schema | Ultimi 5 — sono il meccanismo di rollback (§9) |
| `pre-restore` | Automatico, prima di ogni restore | Ultimi 3 |
| `auto` | Su uscita pulita se l'ultimo `auto` ha più di 24 h | 7 giornalieri + 4 settimanali (GFS ridotto) |
| `manual` | Su richiesta dell'utente | Nessuna eliminazione automatica |

Il momento scelto per l'`auto` — l'uscita pulita — non è casuale: il checkpoint è
appena avvenuto, non c'è alcuna scrittura in corso, e non si rallenta l'avvio.

### 8.4 Backup durante una scrittura

Non serve mettere in quiete l'applicazione. Con il WAL, `VACUUM INTO` prende un
lock di lettura e produce uno snapshot coerente al proprio istante di inizio,
mentre gli scrittori proseguono. La conseguenza va però dichiarata: **un backup
avviato durante un import contiene il database come era all'inizio del backup,
non a import finito.** È il comportamento corretto (uno stato consistente, non
uno stato parziale), ma va scritto nella documentazione.

### 8.5 Restore — deve essere un'operazione del launcher

Sostituire il file del database mentre una connessione è aperta è il modo classico
di corrompere SQLite. Il restore quindi **non si esegue nel processo server**:

```
Server (durante l'uso):
  POST /api/restore  { source: "<file o upload>" }
    → valida: integrity_check, manifest, schema non più recente dell'app
    → copia il candidato in data/tmp/restore-candidate.sqlite
    → scrive data/restore-pending.json
    → risponde: "riavvia l'applicazione per completare"

Launcher (al successivo avvio, PRIMA di lanciare node):
  se restore-pending.json esiste:
    → VACUUM INTO  backups/pre-restore-<ts>.sqlite   (dal DB attuale)
    → rename       finance.sqlite → tmp/replaced-<ts>.sqlite
    → rename       tmp/restore-candidate.sqlite → finance.sqlite
    → elimina i file -wal / -shm rimasti
    → elimina restore-pending.json
    → avvia node (che applicherà le eventuali migrazioni mancanti)
```

Il vantaggio è che nel momento dello scambio **nessun processo tiene il database
aperto**, e se il launcher viene interrotto a metà, il file `restore-pending.json`
fa ripartire l'operazione al prossimo avvio: l'operazione è **idempotente e
ripetibile**.

### 8.6 Formato di export completo (§9 della richiesta)

Un solo file, comodo da spostare e da archiviare:

```
finance-backup-20260826-143000.zip
├── manifest.json
├── database.sqlite        ← output di VACUUM INTO: niente -wal, niente -shm
└── config/settings.json   ← se presente
```

```json
{
  "formatVersion": 1,
  "appVersion": "1.4.0",
  "schemaVersion": "0011_...",
  "createdAt": "2026-08-26T14:30:00Z",
  "platform": "win32-x64",
  "databaseSha256": "…",
  "rowCounts": {
    "transactions": 4821, "merchants": 512, "categories": 22,
    "settings": 1, "loans": 7, "loan_repayments": 19
  }
}
```

**Perché il file SQLite e non un export tabella-per-tabella in JSON o CSV.**
Il database *è* il dominio. Includendolo si portano dietro — automaticamente e
senza codice da mantenere — transactions, merchants, categories, settings, loans,
repayments, i `fingerprint` che garantiscono l'idempotenza dell'import, l'integrità
referenziale e **ogni tabella futura**. Un export per tabella richiederebbe di
aggiornare l'esportatore, l'importatore e l'ordine di inserimento ad ogni nuova
feature: è precisamente il tipo di manutenzione che il §18 chiede di evitare. Un
export JSON/CSV resta utile come **feature separata** (interoperabilità,
ispezione), non come formato di backup.

Ruolo dei campi del manifest, ciascuno con uno scopo preciso:

* `databaseSha256` → rileva uno zip troncato **prima** di tentare il restore;
* `rowCounts` → verifica leggibile da un essere umano ("mi aspettavo ~4.800
  movimenti");
* `schemaVersion` → la regola di compatibilità del §9.2;
* `appVersion`, `platform`, `createdAt` → diagnostica.

---

## 9. Update Strategy

### 9.1 Il principio

L'aggiornamento sostituisce `app/` e `runtime/`. **Non tocca `data/` né
`config/`.** La separazione del §3.3 non è organizzativa: è il meccanismo stesso
di aggiornamento.

```
MyFinance/
├── MyFinance.exe   ← sostituito
├── app/            ← sostituito     (l'aggiornamento è essenzialmente questo)
├── runtime/        ← sostituito solo se cambia la versione di Node
├── config/         ← PRESERVATO
└── data/           ← PRESERVATO — mai letto in scrittura dall'updater
```

Poiché `app/` pesa ~5 MB e `runtime/` ~110 MB, **un aggiornamento che non cambia
Node è un download di pochi MB.** È una conseguenza gradevole della struttura.

### 9.2 Sequenza all'avvio

```
1. leggi  app/VERSION                       → versione dell'applicazione
2. leggi  data/.state.json                  → { lastAppVersion, lastMigration }
3. leggi  drizzle/meta/_journal.json        → migrazioni disponibili in app/

4. se lastMigration > ultima migrazione disponibile:
     → RIFIUTA L'AVVIO con messaggio chiaro          (guardia di downgrade)

5. se ci sono migrazioni da applicare:
     → VACUUM INTO backups/pre-migration-<da>-to-<a>-<ts>.sqlite
     → verifica il backup (integrity_check)
     → esegui drizzle migrate
     → in caso di errore: NON avviare, log + messaggio + indica il backup

6. aggiorna data/.state.json
7. avvia il server
```

**La guardia di downgrade del punto 4 è essenziale.** Uno schema più recente
letto da un'app più vecchia non produce un errore: produce **letture errate
silenziose** (colonne ignorate, valori di default applicati a dati reali). Su dati
finanziari è inaccettabile. Fallire in modo esplicito è l'unico comportamento
corretto.

### 9.3 Rollback

Le migrazioni Drizzle sono **forward-only**: non esiste un `down`. Va dichiarato
apertamente invece di lasciarlo implicito, perché determina il disegno del
rollback:

**Il meccanismo di rollback è il backup pre-migrazione, non una down-migration.**

```
Aggiornamento 1.4.0 → 1.5.0 andato male
   ├── data/finance.sqlite è già migrato allo schema nuovo
   ├── data/backups/pre-migration-0008-to-0011-<ts>.sqlite è lo stato precedente
   └── app.previous/ contiene ancora la 1.4.0

Rollback:
   1. il launcher stacca app/, rinomina app.previous/ → app/
   2. stage del restore del backup pre-migrazione (§8.5)
   3. riavvio
```

Conservare `app.previous/` costa ~5 MB e trasforma il rollback in due `rename`.
È l'assicurazione con il miglior rapporto costo/beneficio dell'intero disegno.

Drizzle esegue ogni migrazione in una propria transazione: una migrazione che
fallisce non lascia lo schema a metà. Ma una *sequenza* di migrazioni può
fermarsi a metà strada (0009 e 0010 applicate, 0011 fallita), e in quel caso lo
stato è coerente ma intermedio — ed è esattamente lo scenario per cui serve il
backup pre-migrazione.

### 9.4 Modalità di distribuzione

| Fase | Meccanismo | Note |
|---|---|---|
| Iniziale (raccomandata a lungo) | ZIP + sostituzione manuale di `app/` e `runtime/` | Zero codice, zero infrastruttura, zero rischio. Per un'app personale può bastare **per sempre** |
| Successiva, opzionale | `update.exe` locale: prende uno ZIP, verifica il mutex, ruota `app/` → `app.previous/`, scompatta | ~150 righe |
| Solo se necessaria | Auto-update con controllo remoto | ⚠️ **Introduce una dipendenza da internet**, in contrasto con lo spirito del §15. Se implementata: mai automatica, mai bloccante, disattivabile |

L'ultima riga merita attenzione: un auto-update contraddice parzialmente il
requisito "nessuna dipendenza da internet". Un controllo aggiornamenti **manuale
e su richiesta** è il compromesso coerente con gli obiettivi dichiarati.

---

## 10. Security Analysis

### 10.1 I due problemi reali di oggi

**(A) Il bind non è limitato al loopback.**
`main.ts` chiama `createApp().listen(config.port, callback)` senza argomento host.
Node in questo caso effettua il bind su **tutte le interfacce** (`::` / `0.0.0.0`).
Conseguenza: chiunque sia sulla stessa rete — Wi-Fi di casa, hotspot, rete
aziendale — può raggiungere `http://<ip-del-pc>:3000/transactions` e **leggere e
modificare l'archivio finanziario**, senza alcuna autenticazione. È precisamente
lo scenario che il §13 chiede di evitare.

Correzione:

```ts
app.listen(config.port, '127.0.0.1', callback);
```

Beneficio secondario non ovvio: **Windows non mostra il prompt del firewall** per
i socket in ascolto solo su loopback. La correzione più importante per la
sicurezza è anche quella che migliora la prima esperienza d'uso.

**(B) CORS wildcard.**
`app.use(cors())` autorizza **ogni** origine. Un qualunque sito web visitato
dall'utente può eseguire `fetch('http://localhost:3000/transactions')` e leggere
la risposta: il browser la consegna perché l'header lo permette. Il bind su
loopback **non protegge** da questo, perché la richiesta parte dalla macchina
stessa.

### 10.2 Il modello di sicurezza proposto

Il passaggio a **same-origin** (frontend servito da Express, §11) è ciò che rende
tutto semplice: se non ci sono origini diverse, CORS non serve.

| # | Misura | Attacco neutralizzato |
|---|---|---|
| 1 | `listen(port, '127.0.0.1')` | Accesso dalla LAN |
| 2 | **Nessun CORS in produzione**; in sviluppo `cors({ origin: 'http://localhost:4200' })` | Lettura cross-origin da un sito web |
| 3 | Allowlist dell'header `Host`: solo `127.0.0.1:<port>` e `localhost:<port>` | **DNS rebinding** (un dominio che risolve a 127.0.0.1) |
| 4 | Su ogni richiesta non-GET: `Sec-Fetch-Site: same-origin` **oppure** `Origin` corrispondente | **CSRF**, senza token e senza sessioni |
| 5 | `express.static` con root fissa; `data/` **mai** servita | Esposizione del database via HTTP |
| 6 | Download dei backup: `path.resolve` + verifica `startsWith(backupsDir + sep)` | **Directory traversal** — l'unica superficie che l'app avrà |
| 7 | Import CSV: mantenere il corpo testuale con limite 10 MB | Nessun multipart, nessun nome file, nessun file temporaneo → nessun traversal, nessuno zip-slip |
| 8 | Nessun endpoint amministrativo; `POST /api/shutdown` protetto dalle misure 3+4 | Spegnimento indotto da terzi |

Le misure 1-4 sono, insieme, **~40 righe di middleware**. Dopo di esse una pagina
web arbitraria non può né leggere né modificare i dati, e la rete locale non vede
nulla.

Opzione ulteriore, valutata e giudicata **superflua**: un token casuale generato
dal launcher, passato nell'URL e conservato in `sessionStorage`. Aggiunge una
difesa in profondità ma anche complessità (URL non condivisibile, rottura del
refresh) a fronte di un rischio residuo già coperto dalle misure 3 e 4.

### 10.3 Considerazioni sul CSV

Rischi verificati sull'import attuale:

* **Traversal / zip-slip**: impossibili — non arriva alcun nome di file, solo testo.
* **Formula injection**: è un rischio dell'**export**, non dell'import. Se in
  futuro si aggiungerà un export CSV, i campi che iniziano con `=`, `+`, `-`, `@`
  vanno prefissati.
* **DoS**: un CSV da 10 MB con righe patologiche può occupare la CPU. Trattandosi
  di un'app locale a utente singolo, l'utente danneggerebbe solo sé stesso. Un
  limite sul numero di righe è igiene, non urgenza.

### 10.4 Note su Windows

* **SmartScreen**: un `.exe` non firmato mostra "Windows ha protetto il PC". È il
  singolo ostacolo più probabile per un utente non tecnico (§14 dei rischi).
* **Antivirus**: un eseguibile ignoto che lancia `node.exe` e apre un socket è un
  pattern che alcune euristiche segnalano. La firma del codice risolve anche questo.
* **Permessi filesystem**: installando la cartella sotto `Documenti`, `Desktop` o
  una chiave USB non serve alcun privilegio di amministratore. **Da evitare
  `C:\Program Files`**, dove la scrittura in `data/` richiederebbe l'elevazione o
  incapperebbe nella virtualizzazione del registro.

---

## 11. Development vs Production

### 11.1 Un'unica architettura, due cablaggi

L'obiettivo del §17 e del §20 — non introdurre una seconda architettura — si
ottiene rendendo la differenza tra dev e prod **una sola**: chi serve i file
statici.

```
SVILUPPO                              PRODUZIONE
ng serve  :4200                       node runtime/… app/backend/server.js
   │  proxy /api → :3000                 │
   ▼                                     ├── express.static(app/frontend)
tsx watch  :3000                         ├── /api/*  (gli stessi 10 router)
   └── /api/*  (gli stessi router)        └── SPA fallback → index.html
```

Identici in entrambe le modalità: i router, i servizi, il dominio, i repository,
le migrazioni, il database, il percorso delle richieste (`/api/...`), l'origine
(same-origin **anche in sviluppo**, grazie al proxy). Quest'ultimo punto è
importante: i middleware di sicurezza del §10.2 vengono **esercitati in sviluppo
esattamente come in produzione**, quindi non possono rompersi solo in produzione.

### 11.2 Il prefisso `/api` è necessario, non estetico

Emerge un problema concreto passando a same-origin. Oggi i router sono montati a
livello root: `/transactions`, `/analytics`, `/loans`… Ma `/transactions`,
`/analytics` e `/loans` sono **anche rotte Angular** (`app.routes.ts`).

Se Express serve il frontend, `GET /transactions` è ambiguo:

* digitato nella barra indirizzi (o dopo un refresh) → deve restituire `index.html`;
* chiamato da `HttpClient` → deve restituire JSON.

Sono **entrambe richieste GET same-origin**: distinguerle in base agli header
sarebbe fragile e sorprendente. La soluzione corretta è spostare l'API sotto un
prefisso:

```ts
// app.ts
const api = Router();
api.use('/transactions', transactionsRouter);   // …e gli altri 9
app.use('/api', api);

app.use(express.static(frontendDir, { index: false }));
app.get('*', (_req, res) => res.sendFile(join(frontendDir, 'index.html')));
```

```ts
// core/api.ts
export const API_BASE_URL = '/api';
```

Il costo è **due file modificati**. I ~40 call site non cambiano, perché
interpolano tutti `API_BASE_URL`: è il dividendo della scelta di concentrare
l'indirizzo in una costante. Gli spec del frontend importano la stessa costante,
quindi **si adeguano automaticamente**. `<base href="/">` resta valido.

In sviluppo, `proxy.conf.json`:

```json
{ "/api": { "target": "http://localhost:3000", "secure": false } }
```

### 11.3 Script proposti

```jsonc
{
  "dev":            "…concurrently… dev:backend + dev:frontend",  // invariato
  "dev:backend":    "tsx watch apps/backend/src/main.ts",          // invariato
  "dev:frontend":  "npm start --prefix apps/frontend",             // + proxy.conf.json

  "build":          "npm run build:frontend && npm run build:backend",
  "build:frontend": "npm run build --prefix apps/frontend",        // invariato
  "build:backend":  "esbuild … --bundle --platform=node --format=esm --external:better-sqlite3",
  "start":          "node apps/backend/dist/server.js",            // prod locale, senza packaging

  "package":        "node scripts/package.mjs",                    // assembla MyFinance/
  "test":           "…"                                            // invariato
}
```

`npm run dev` **non cambia**. Il packaging è un target aggiuntivo, e nessuna
dipendenza di Electron o Tauri entra nel ciclo quotidiano — che è la richiesta
esplicita del §20.

### 11.4 Impatto sui test (§18)

| Suite | Impatto |
|---|---|
| Backend (`node:test` via tsx, 9 file) | **Nessuno.** I test chiamano i servizi direttamente, non passano da HTTP. `process.env.DATABASE_FILE` continua a funzionare come alias di `MYFINANCE_DATA` |
| Frontend (vitest + `HttpTestingController`) | **Nessuno**: gli spec importano `API_BASE_URL`, quindi seguono il nuovo valore |
| Nuovi | Risoluzione dei percorsi (da cwd diversi, da cartelle diverse), fallback SPA, collisione fra rotta API e rotta Angular, ciclo backup/restore, migrazione con guardia di downgrade, avvio doppia istanza |

---

## 12. Recommended Architecture

### 12.1 La scelta

```
╔═══════════════════════════════════════════════════════════════════╗
║  RECOMMENDED ARCHITECTURE                                         ║
║                                                                   ║
║  Opzione A / E2 — Cartella portatile con Node embedded,           ║
║  Express che serve sia l'API sia il frontend su 127.0.0.1,        ║
║  SQLite in data/, launcher nativo che apre il browser in          ║
║  modalità applicazione.                                           ║
║                                                                   ║
║  NON Electron. NON Tauri. NON PWA.                                ║
╚═══════════════════════════════════════════════════════════════════╝
```

```
MyFinance/
├── MyFinance.exe            launcher Go: mutex, porta, health, tray, --app
├── app/
│   ├── backend/server.js    bundle esbuild (~1,5 MB)
│   ├── backend/drizzle/     migrazioni
│   ├── backend/native/      better_sqlite3.node (prebuild)
│   ├── frontend/            ng build (497 KB)
│   └── VERSION
├── runtime/node.exe         ~110 MB
├── config/settings.json     opzionale
└── data/                    finance.sqlite, backups/, logs/, tmp/, runtime/
```

### 12.2 Tabella comparativa (§21)

Scala: ✅✅ ottimo · ✅ buono · 🟡 accettabile · ❌ problematico · ⛔ squalificante

| Criterio | Localhost + Node | PWA | Electron | Tauri |
|---|---|---|---|---|
| **Offline** | ✅✅ già oggi | ✅✅ | ✅✅ | ✅✅ |
| **Portabilità** | ✅✅ copia la cartella | ⛔ **impossibile**: OPFS vive nel profilo browser | ✅ con target `dir` | 🟡 (D1) / ✅ (D2) |
| **SQLite** | ✅✅ nativo, sincrono, prebuild pronti | ❌ WASM+OPFS, driver async, migratore da riscrivere | ✅ nativo ma serve `electron-rebuild` | 🟡 (D1) / ❌ da riscrivere (D2) |
| **Dimensione** | ✅ 118 MB | ✅✅ ~2 MB | 🟡 180-250 MB | ❌ 125 MB (D1) / ✅✅ 20 MB (D2) |
| **Semplicità** | ✅✅ ~350 righe nuove | ❌ riscrittura del lato dati | 🟡 builder + rebuild nativo | ❌ Rust + sidecar |
| **UX desktop** | ✅ con `--app`: nessuna barra indirizzi, icona propria | 🟡 dipende dal browser | ✅✅ finestra e menu nativi | ✅✅ |
| **Aggiornamenti** | ✅ sostituisci `app/` (pochi MB) | 🟡 service worker | ✅✅ `electron-updater` | 🟡 updater da costruire |
| **Backup** | ✅✅ `VACUUM INTO` su un file | ❌ export da OPFS, restore delicato | ✅✅ | ✅✅ (D1) |
| **Manutenibilità** | ✅✅ resta un'app Node+Angular | ❌ tutto in un bundle browser | ✅ un layer in più | ❌ due linguaggi |
| **Compatibilità architettura attuale** | ✅✅ **~65 righe modificate** | ⛔ viola "il frontend non accede al DB" | ✅ nessuna modifica al dominio | ❌ (D2) riscrittura totale |

### 12.3 Perché è la scelta giusta *per questa applicazione*

Cinque ragioni, tutte specifiche di questo repository e non trasferibili:

**1. Il codice è già a un passo.** `import.meta.url` invece di `process.cwd()`;
`DATABASE_FILE` già overridabile e già collaudato da 9 test; zero dipendenze di
rete; l'URL del backend in **una** costante; prebuild nativi per 8 piattaforme;
nessuno stato nel browser. Non è fortuna: sono le conseguenze delle regole di
[architecture.md](architecture.md). L'architettura ha già fatto il lavoro — resta
da raccoglierlo. **~65 righe modificate su ~21.500 LOC.**

**2. Il vero problema non è l'offline.** L'app è già offline-capable. I problemi
reali sono il checkpoint del WAL, l'assenza di backup, l'assenza di una build di
produzione, il bind su tutte le interfacce, il CORS wildcard. **Nessuno di questi
viene risolto scegliendo Electron o Tauri**: bisogna risolverli comunque. Scegliere
una shell nativa significherebbe aggiungere un problema (il packaging della shell)
prima di aver risolto quelli che ci sono già.

**3. La PWA è squalificata da un requisito, non sconfitta ai punti.** Il §6 chiede
di copiare la cartella e ritrovare i dati. OPFS non lo permette: il database non è
un file in una cartella, è uno stato del profilo browser legato all'origine. Non
c'è compromesso possibile.

**4. Tauri è incompatibile con l'asset più prezioso del progetto.** Non include
Node. Con il sidecar è strettamente più complessa dell'opzione A e ne eredita
tutti i requisiti; senza sidecar richiede di riscrivere 9.200 LOC di dominio
testato in Rust.

**5. È un prefisso del percorso Electron, non un vicolo cieco.** Build backend,
static serving, APP_ROOT/DATA_ROOT, checkpoint, `VACUUM INTO`, migrazioni con
guardia, sicurezza loopback: **servono anche a Electron**. Se un giorno la
finestra chromeless diventasse obbligatoria, si aggiunge Electron sopra un
fondamento già solido, senza buttare nulla. Nessuna delle altre opzioni offre
questa proprietà — la PWA anzi la nega.

### 12.4 Cosa si accetta consapevolmente

Non è una scelta senza costi, e vale elencarli:

* la finestra è Edge/Chrome in `--app` mode, non una finestra nativa;
* nessun menu di sistema né dialogo file nativo (per questa app, irrilevante);
* un socket in ascolto su loopback (mitigato da §10.2, ma esiste);
* `.exe` non firmato → SmartScreen al primo avvio;
* l'auto-update va costruito, se e quando servirà;
* teoricamente, un aggiornamento del browser potrebbe cambiare il comportamento
  di `--app` (rischio basso: è una funzionalità stabile da anni, e il fallback al
  browser di default resta sempre disponibile).

---

## 13. Migration Roadmap

Otto fasi. Le prime tre non producono un `.exe`, ma sono quelle che rendono i dati
sicuri: **l'ordine è deliberato.** Il packaging moltiplica il numero di macchine
su cui i dati possono essere perduti, quindi la sicurezza del dato viene prima.

---

### WP-P1 — Modalità produzione e API same-origin

**Obiettivo** — `npm run build && npm start` produce un'app completa e usabile su
`http://127.0.0.1:3000`, senza dev server e senza `tsx`.

**Modifiche**
* `app.ts`: router sotto `/api`; `express.static`; SPA fallback; `cors()` solo in dev, con origine esplicita.
* `core/api.ts`: `API_BASE_URL = '/api'` (una riga).
* `apps/frontend/proxy.conf.json` + `angular.json` (`proxyConfig`).
* `main.ts`: `listen(port, '127.0.0.1')`.
* `build:backend` con esbuild, `--external:better-sqlite3`; `tsconfig` per l'emissione.
* Middleware: allowlist `Host`, verifica `Origin`/`Sec-Fetch-Site` sui non-GET.

**Rischio: basso.** Il punto sensibile è la collisione fra rotte API e rotte
Angular, che il prefisso `/api` risolve per costruzione.

**Dipendenze**: nessuna. Si può iniziare subito.

**Test**
* `/api/health` risponde; `/transactions` restituisce `index.html`; `/api/transactions` restituisce JSON.
* Refresh su `/loans/<id>` funziona (fallback SPA).
* Le suite esistenti passano invariate.
* Una richiesta con `Host: evil.example` viene rifiutata; un `POST` con `Origin` estranea viene rifiutato.

**Criterio di uscita**: l'app è pienamente utilizzabile con un solo processo e un
solo comando.

---

### WP-P2 — APP_ROOT / DATA_ROOT, logging, shutdown pulito

**Obiettivo** — Nessuna dipendenza dal cwd, tutti i dati sotto un'unica radice
configurabile, e un database autosufficiente dopo ogni uscita.

**Modifiche**
* Nuovo `paths.ts`: APP_ROOT da `import.meta.url`, DATA_ROOT con precedenza env → config → default; `config.ts` lo usa.
* `settings.json` opzionale con risoluzione dei percorsi relativi su APP_ROOT.
* Sink su file per il logger, `data/logs/`, rotazione giornaliera.
* **Graceful shutdown**: `SIGINT`/`SIGTERM` → `wal_checkpoint(TRUNCATE)` → `close()` → uscita.
* `data/tmp/` creata e svuotata all'avvio.

**Rischio: basso-medio** — i bug sui percorsi sono insidiosi. Mitigazione: un
unico modulo, e test che lo esercitano da directory diverse.

**Dipendenze**: WP-P1.

**Test**
* Avvio da tre cwd diversi → stesso database risolto.
* Cartella spostata da `C:\…\Documents\` a `D:\…\` → stessi dati.
* `MYFINANCE_DATA` e `DATABASE_FILE` (alias) hanno effetto.
* **Dopo uno shutdown pulito: `-wal` vuoto o assente** — la verifica che chiude il problema del §1.4.
* Copiare il solo `finance.sqlite` dopo l'uscita e aprirlo altrove → dati integri.

---

### WP-P3 — Sicurezza del dato: transazioni, backup, integrità

**Obiettivo** — Nessuna perdita di dati possibile per crash, migrazione o errore
dell'utente. **È la fase da non affrettare.**

**Modifiche**
* `insertMany` e `backfillFingerprints` dentro `sqlite.transaction()`.
* Modulo `backup`: `VACUUM INTO` → `data/tmp` → `integrity_check` + conteggi → `rename`.
* Backup automatico pre-migrazione con la sequenza del §9.2.
* `GET /api/backups`, `POST /api/backup`, `GET /api/backups/:name` (con guardia anti-traversal).
* Ritenzione e pruning per tipo.
* Restore *in stage* (`restore-pending.json`); l'applicazione avviene ancora con un riavvio manuale.
* Guardia di downgrade su `data/.state.json`.

**Rischio: medio** — è il codice che tocca i dati dell'utente.

**Dipendenze**: WP-P2 (serve DATA_ROOT).

**Test**
* Backup **durante** un import di 5.000 righe → integro, coerente.
* Restore di un backup → conteggi righe identici.
* Backup troncato / hash errato → **rifiutato**.
* Crash simulato a metà import → nessuna riga parziale; reimport completa.
* Migrazione con schema modificato → il backup pre-migrazione esiste e si apre.
* DB con `lastMigration` più recente dell'app → avvio rifiutato.

---

### WP-P4 — Cartella portatile (senza launcher)

**Obiettivo** — `MyFinance/` funzionante con `start.bat` su una macchina **senza
Node installato**.

**Modifiche**
* `scripts/package.mjs`: assembla `app/`, scarica/copia `runtime/node.exe`,
  seleziona il prebuild `better_sqlite3.node` giusto, scrive `VERSION`.
* **Asserzione ABI**: `NODE_MODULE_VERSION` del runtime spedito == quello del
  prebuild. Errore di build se divergono (§14, rischio 5).
* `start.bat` provvisorio.
* Porta preferita fissa (es. 47318) con fallback dinamico; `data/runtime/port.lock`.

**Rischio: basso.**

**Dipendenze**: WP-P1 (build), WP-P2 (percorsi).

**Test**
* VM Windows pulita, **senza Node** → doppio click su `start.bat` → l'app funziona.
* Cartella su chiave USB exFAT → funziona, backup incluso.
* Cartella rinominata e spostata → funziona.
* Percorso con spazi e caratteri accentati → funziona.

---

### WP-P5 — Launcher nativo

**Obiettivo** — Doppio click su `MyFinance.exe`, nessuna console, un'unica
istanza, chiusura ordinata.

**Modifiche** — launcher Go (~300 righe):
```
APP_ROOT da os.Executable()
mutex Windows single-instance
applica restore-pending.json se presente
legge port.lock → probe /api/health
   ├── risponde  → apre solo la finestra ed esce
   └── non risponde → rimuove il lock stantio
spawn runtime/node.exe app/backend/server.js  (env MYFINANCE_DATA)
stdout/stderr → data/logs/launcher.log
attende /api/health  (timeout ~15 s)
apre  msedge --app=…  →  chrome --app=…  →  browser di default
icona nella tray: Apri / Backup ora / Esci
all'uscita: segnale a node → checkpoint → attesa → terminazione
```

**Rischio: medio** — il ciclo di vita dei processi è dove nascono gli orfani.

**Dipendenze**: WP-P4.

**Test**
* Doppio avvio → una sola istanza, la finestra passa in primo piano.
* `node.exe` ucciso dall'esterno → il launcher lo rileva e lo segnala.
* Finestra chiusa e riaperta → riusa il backend attivo.
* Porta occupata da altri → fallback su un'altra porta.
* Edge assente → fallback su Chrome, poi sul browser di default.
* Uscita dalla tray → **WAL consolidato** (la verifica che lega §6.3 e §11).
* Nessun prompt del firewall Windows (conferma del bind loopback).

---

### WP-P6 — Aggiornamenti e guardie

**Obiettivo** — Sostituire l'applicazione senza mai toccare i dati.

**Modifiche**
* Confronto versioni, rotazione `app/` → `app.previous/`.
* Rifiuto dell'avvio su schema più recente (già in WP-P3, qui esposto in UI).
* Messaggio di errore in linguaggio comune, con il percorso del backup.
* Opzionale: `update.exe` che verifica il mutex, ruota e scompatta.
* Documento `UPDATING.md`.

**Rischio: medio.**

**Dipendenze**: WP-P3, WP-P5.

**Test**
* 1.0 → 1.1 con migrazione → dati preservati, backup pre-migrazione presente.
* 1.1 → 1.0 → **rifiutato** con messaggio chiaro.
* Migrazione volutamente difettosa → l'app non parte, il DB è intatto, il backup è utilizzabile.
* Aggiornamento tentato con l'app in esecuzione → rifiutato.
* `data/` e `config/` invariati byte per byte dopo l'update.

---

### WP-P7 — Rifinitura: export/import ZIP e UX

**Obiettivo** — L'utente può salvare, spostare e ripristinare tutto senza aprire
una cartella.

**Modifiche**
* `finance-backup-<ts>.zip` con `manifest.json` (§8.6).
* In Impostazioni: Esporta tutto / Importa backup / elenco backup con date e dimensioni / Esci dall'applicazione.
* Restore completo tramite il launcher.
* Rilevamento della cartella dati su servizi cloud + avviso.
* Schermata di primo avvio.

**Rischio: basso.**

**Dipendenze**: WP-P3, WP-P5.

---

### WP-P8 — Multipiattaforma (opzionale)

**Obiettivo** — Linux e macOS senza cambiare architettura.

**Modifiche** — solo build matrix: runtime Node per piattaforma, il prebuild
`better-sqlite3` corrispondente (già presenti tutti e 8), cross-compilazione Go
(`GOOS`/`GOARCH`), comando browser per piattaforma, notarizzazione su macOS.

**Rischio: basso** dal lato architetturale, **medio** su macOS (Gatekeeper).

---

### Riepilogo

| WP | Consegna | Rischio | Dipendenze |
|---|---|---|---|
| P1 | Produzione same-origin, un solo comando | Basso | — |
| P2 | Portabilità dei percorsi, log, **checkpoint WAL** | Basso-medio | P1 |
| P3 | **Transazioni, backup, integrità, guardie** | Medio | P2 |
| P4 | Cartella portatile con Node embedded | Basso | P1, P2 |
| P5 | `MyFinance.exe` + tray + `--app` | Medio | P4 |
| P6 | Aggiornamenti e rollback | Medio | P3, P5 |
| P7 | ZIP export/import, UX | Basso | P3, P5 |
| P8 | Linux / macOS | Basso | P4-P7 |

**Il criterio di successo del §23 è raggiunto alla fine di WP-P5.** P6-P8 rendono
il risultato mantenibile nel tempo.

---

## 14. Risks

Ordinati per prodotto probabilità × impatto.

| # | Rischio | P × I | Mitigazione | Fase |
|---|---|---|---|---|
| 1 | **WAL non consolidato**: si copia la cartella e i dati sono nel `-wal`, o si perde il `-wal`. **Già presente nel repo: DB 4 KB, WAL 2,3 MB** | Alta × Critico | Checkpoint su ogni uscita pulita; backup con `VACUUM INTO`; single-instance; documentare "esci prima di copiare" | P2, P3, P5 |
| 2 | **SmartScreen / antivirus** su un `.exe` non firmato → l'utente non tecnico si ferma | Alta × Alto | Firma del codice (~200-400 €/anno) è la soluzione reale; altrimenti istruzioni esplicite per "Ulteriori informazioni → Esegui comunque" | P5 |
| 3 | **Cartella dati su OneDrive/Dropbox** → corruzione silenziosa | Media × Critico | Rilevamento + avviso; indirizzare verso l'export ZIP come modo corretto di usare il cloud | P7 |
| 4 | **Migrazione fallita** sulla macchina dell'utente, senza sviluppatore presente | Media × Alto | Backup pre-migrazione verificato; nessun avvio in stato incerto; messaggio comprensibile; `app.previous/` | P3, P6 |
| 5 | **Mismatch ABI** fra il Node spedito e il prebuild `better-sqlite3` → l'app non parte su nessuna macchina | Media × Alto | Asserzione `NODE_MODULE_VERSION` in fase di build; versioni fissate | P4 |
| 6 | **Processi orfani**: `node.exe` resta in esecuzione dopo la chiusura della finestra | Media × Medio | Launcher residente con tray; opzionale spegnimento per inattività | P5 |
| 7 | **Import parziale** per crash a metà | Bassa × Medio | Transazione unica; l'idempotenza del `fingerprint` già limita il danno | P3 |
| 8 | **Cancellazione di `data/` da parte dell'utente**: i backup sono dentro `data/` e sparirebbero con essa | Bassa × Critico | Export ZIP su un altro supporto; promemoria periodico. **Limite dichiarato**: un backup nella stessa cartella non protegge dalla perdita della cartella | P7 |
| 9 | **Porta occupata** o URL con porta salvato nei preferiti che smette di funzionare | Media × Basso | Porta preferita fissa + fallback; il launcher è sempre il punto d'ingresso corretto | P4, P5 |
| 10 | **Deriva di `--app` mode** nei browser | Bassa × Medio | Fallback a cascata; funzionalità stabile da anni | P5 |
| 11 | **Aggiornamento con app in esecuzione** → file bloccati, stato misto | Media × Medio | L'updater verifica il mutex e rifiuta | P6 |
| 12 | **Due istanze** su cartelle diverse che puntano allo stesso DATA_ROOT | Bassa × Alto | Mutex per percorso di DATA_ROOT, non per eseguibile | P5 |

---

## 15. Open Questions

Domande a cui serve una risposta perché cambiano il disegno, non curiosità.

1. **Utente singolo confermato?** L'analisi assume una persona, un PC, una
   cartella. Se servissero due archivi separati (o due utenti Windows), la scelta
   fra `./data` (portatile, come richiesto) e `%LOCALAPPDATA%` (per utente, non
   portatile) va rifatta. **Assunzione corrente: `./data`**, coerente col §6.

2. **Launcher residente con tray, o "avvia e dimentica"?** Il residente
   garantisce il checkpoint del WAL alla chiusura — cioè mitiga il rischio n. 1.
   **Raccomandazione: residente.** Confermi?

3. **La finestra del browser in `--app` mode è accettabile?** Se una finestra
   chromeless **garantita su qualsiasi macchina** fosse un requisito rigido, la
   risposta cambia in Electron. Se è una preferenza, `--app` la soddisfa a costo
   zero. Questa è la domanda che più influenza la raccomandazione.

4. **Budget per la firma del codice?** Determina quanto è ripido il primo avvio
   (rischio n. 2). È la voce di costo con il maggior impatto sull'esperienza di un
   utente non tecnico.

5. **Porta fissa o dinamica?** Fissa (47318) è memorizzabile nei preferiti;
   dinamica non collide mai. **Raccomandazione: preferita fissa con fallback.**

6. **I backup devono poter finire anche su un secondo supporto?** `data/backups/`
   è portatile ma condivide il destino della cartella (rischio n. 8). Serve una
   destinazione secondaria configurabile?

7. **Auto-update: serve?** "Scarica lo ZIP e sostituisci `app/`" può bastare per
   sempre e non introduce dipendenze da internet. **Raccomandazione: rinviare**, e
   se mai servisse, renderlo manuale e disattivabile.

8. **Politica sulla versione di Node**: fissata a una specifica 24.x e aggiornata
   deliberatamente, o allineata all'LTS? Determina quanto spesso `runtime/` entra
   negli aggiornamenti (e quindi se pesano 5 MB o 118 MB).

9. **Linux/macOS sono un obiettivo reale o solo un'opzione da non precludere?**
   Non cambia l'architettura, cambia solo quando costruire la build matrix.

10. **`escapeLike` (§1.7)**: la correggo in un WP a sé, o la includo in P1?

---

## 16. Proposed First Implementation WP

### WP-P1 — Production Mode & Same-Origin API

Scelto come primo intervento per quattro ragioni: non tocca alcun dato, non ha
dipendenze, produce immediatamente qualcosa di utile (`npm run build && npm
start`), e **abilita ogni fase successiva** — senza una build di produzione non
c'è nulla da impacchettare.

**Ambito**

| File | Intervento |
|---|---|
| `apps/backend/src/app.ts` | Router sotto `/api`; `express.static`; SPA fallback; CORS solo dev con origine esplicita; middleware `Host` + `Origin`/`Sec-Fetch-Site` |
| `apps/backend/src/main.ts` | `listen(port, '127.0.0.1')` |
| `apps/backend/src/config.ts` | Aggiunta di `frontendDir` (preparazione a P2, non ancora APP_ROOT completo) |
| `apps/frontend/src/app/core/api.ts` | `API_BASE_URL = '/api'` |
| `apps/frontend/src/app/core/http-error.ts` | Aggiornare il messaggio "Backend non raggiungibile…" |
| `apps/frontend/proxy.conf.json` | **Nuovo**: `/api` → `localhost:3000` |
| `apps/frontend/angular.json` | `serve.options.proxyConfig` |
| `apps/backend/tsconfig.build.json` | **Nuovo**: emissione per esbuild |
| `package.json` | `build`, `build:backend`, `start` |

**Fuori ambito** (esplicitamente): APP_ROOT/DATA_ROOT, backup, launcher, runtime
embedded, checkpoint WAL. Ognuno ha il proprio WP.

**Sequenza consigliata**

1. `/api` sul backend + `API_BASE_URL` sul frontend; verificare che `npm run dev`
   funzioni ancora, ora attraverso il proxy.
2. `express.static` + fallback SPA; verificare il refresh su una rotta profonda.
3. Bind loopback + i quattro middleware di sicurezza; verificare che dev funzioni
   ancora (same-origin via proxy → li esercita).
4. `build:backend` con esbuild + `start`; verificare l'app con un solo processo.

**Definizione di "fatto"**

* `npm run build && npm start` → app completa su `http://127.0.0.1:3000`, senza
  `ng serve` e senza `tsx`.
* `npm run dev` funziona **esattamente come prima** dal punto di vista dello
  sviluppatore.
* Tutte le suite esistenti passano senza modifiche di sostanza.
* `curl -H 'Host: evil.example' …` → rifiutato; `POST` con `Origin` estranea →
  rifiutato; nessuna porta raggiungibile da un'altra macchina della LAN.
* Refresh su `/loans/<id>` e `/transactions?search=…` → l'app si ricarica
  correttamente.

**Rischio residuo**: la collisione fra rotte, coperta dal prefisso `/api`; e i
messaggi d'errore del frontend che citano `localhost:3000`, da aggiornare.

**Stima**: mezza giornata di lavoro, più i test.

---

## Sintesi

L'applicazione è **già** offline-capable e local-first: zero CDN, zero font
remoti, zero telemetria, zero stato nel browser, percorsi risolti da
`import.meta.url` e non dal cwd, e prebuild nativi per otto piattaforme. Le
regole che [architecture.md](architecture.md) si era dato hanno prodotto, come
effetto collaterale, un'applicazione quasi pronta a diventare portatile.

Ciò che manca non è offline-first: sono **una build di produzione, una separazione
`app/` ÷ `data/`, il consolidamento del WAL, i backup, e un launcher.** Circa 65
righe modificate nel codice esistente e ~350 righe nuove.

La raccomandazione è quindi la soluzione **meno sofisticata** fra quelle valutate,
scelta perché è quella che rispetta l'architettura già costruita e mette al primo
posto l'affidabilità del dato: **cartella portatile, Node embedded, Express che
serve tutto su 127.0.0.1, SQLite in `data/`, launcher nativo che apre il browser
in modalità applicazione.**

La PWA è squalificata da un requisito (la portabilità dei dati, tecnicamente
impossibile con OPFS). Tauri è incompatibile con l'asset più prezioso del
progetto (non incorpora Node). Electron funzionerebbe, ma richiede di costruire
prima tutto ciò che serve alla soluzione raccomandata — e quindi resta
disponibile, in qualunque momento, come strato aggiuntivo sopra un fondamento che
non va sprecato.
