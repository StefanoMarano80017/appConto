# Report WP-P4 — Portable Package Without Launcher

Data: 2026-09-01
Baseline: WP-P3 (Data Safety, Atomic Transactions, Backup & Restore)

---

## Sommario

Una cartella di 31 file e 90,2 MB si copia su una macchina Windows senza Node,
si avvia con `start.bat`, crea il proprio archivio, applica le proprie
migrazioni e serve l'applicazione. Non richiede installazione, `npm install`,
terminale configurato, repository né Node di sistema, e non contiene un solo
percorso della macchina su cui è stata costruita.

Il packaging ha trovato **due difetti reali** che nessun test precedente poteva
vedere, ed è questo il suo valore principale:

1. nel package l'intera funzione di backup e ripristino di WP-P3 era rotta,
   perché un secondo punto del codice apriva database senza indicare il binario
   nativo (§7);
2. `fs.cpSync` verso un percorso con caratteri non ASCII **non copia niente e
   non segnala niente**, quindi il confezionamento poteva produrre in silenzio
   un package vuoto (§18).

---

## 1. File modificati

| File | Modifica | Perché |
|---|---|---|
| `apps/backend/src/paths.ts` | `resolveLayout()` puro: riconosce le due disposizioni e ne deriva `APP_ROOT`, migrazioni, frontend e binario nativo | `APP_ROOT` sta tre livelli sopra `apps/backend/src`, due sopra `app/backend`: la profondità non poteva restare una costante |
| `apps/backend/src/config.ts` | usa `FRONTEND_DIR`, `LAYOUT`, `NATIVE_BINDING_FILE`; non compone più percorsi | `frontendDir` era l'ultimo percorso dedotto fuori da `paths.ts`, ed era di forma "repository" |
| `apps/backend/src/db/client.ts` | apre tramite `openSqlite()` | nel package il binario nativo va indicato |
| `apps/backend/src/modules/maintenance/backup.manifest.ts` | `openSqlite()` invece di `new Database()` | **il difetto**: senza questo, nel package ogni backup falliva con 500 |
| `apps/backend/src/main.ts` | registra `layout`, `frontend` e `sqlite` all'avvio; gestisce `EADDRINUSE` con un messaggio leggibile | i percorsi effettivi sono la prova dell'isolamento; una porta occupata non deve uscire come traccia di stack |
| `apps/backend/src/paths.test.ts` | +11 test sulle due disposizioni | §18 |
| `package.json` | `build:backend` passa allo script; aggiunti `package` e `verify:package` | — |
| `.gitignore` | `/dist-package/` | l'artefatto non si versiona |

Il dominio, i repository, i servizi, le view-model, le API e i componenti
Angular **non** sono stati toccati. L'unica modifica dentro una feature è la
riga di `backup.manifest.ts`, ed è una necessità tecnica dimostrata dal
packaging.

## 2. File creati

| File | Righe | Ruolo |
|---|---|---|
| `apps/backend/src/db/sqlite.ts` | 27 | l'**unico** punto che apre un file SQLite |
| `apps/backend/src/db/sqlite.test.ts` | 108 | controllo statico: nessun `new Database(` altrove |
| `scripts/build-backend.mjs` | 133 | bundle di produzione + binario nativo accanto |
| `scripts/package-windows.mjs` | 453 | assembla, verifica, e rifiuta un package non consegnabile |
| `scripts/verify-package.mjs` | 825 | i test A–J sul package vero, fuori dal repository |
| `scripts/copy-tree.mjs` | 79 | copia ricorsiva verificata, perché `cpSync` non è affidabile |
| `scripts/node-runtime.json` | 8 | la versione di Node **fissata** |

## 3. Struttura finale del package

```
MyFinance/                                    31 file, 90,2 MB
├── start.bat                                 433 byte
├── runtime/
│   └── node.exe                              85,7 MB   v24.11.1
├── app/
│   ├── VERSION                               1.0.0
│   ├── RUNTIME.json                          runtime, ABI, impronte
│   ├── backend/
│   │   ├── server.js                         2 057 kB  bundle unico
│   │   ├── package.json                      {"type":"module"}
│   │   └── native/
│   │       └── better_sqlite3.node           1 943 kB  win32-x64, N-API
│   ├── frontend/                             497 kB, 4 file
│   │   ├── index.html · main-*.js · styles-*.css · favicon.ico
│   └── drizzle/                              19 file
│       ├── 0000..0008 *.sql
│       └── meta/_journal.json + snapshot
└── config/
    └── settings.example.json                 esempio, non attivo
```

`data/` **non è presente**: nasce al primo avvio. Vedi §17.

Nessun `node_modules`. Nessun sourcemap. Nessun database.

## 4. Versione esatta di Node embedded

```
v24.11.1  win32-x64
sha256    f13ac3ca23248dc389507e8fe38c34489ab7edb3e6d6700eb6da6a0b7e128eaf
```

Fissata in `scripts/node-runtime.json`, con l'URL ufficiale da cui prelevarla.
Il confezionamento **interroga il binario** (`node.exe -p process.version`) e si
ferma se versione, piattaforma o architettura non corrispondono al valore
fissato: non è il percorso a essere autorevole, è ciò che il binario dichiara di
essere. Un runtime diverso si indica con `MYFINANCE_NODE_EXE`, e viene
verificato allo stesso modo.

## 5. NODE_MODULE_VERSION — e perché non è il vincolo

```
NODE_MODULE_VERSION  137
N-API                10
```

Il piano del WP chiedeva una verifica di build che fallisse su un disallineamento
`Node runtime ↕ NODE_MODULE_VERSION ↕ binario nativo`. L'ispezione ha mostrato
che quel triangolo **non è la relazione che governa questo progetto**:

```
node_modules/better-sqlite3/prebuilds/
    win32-x64.node        ← nome per piattaforma-architettura
    darwin-arm64.node        NON node-v137-win32-x64.node
    linux-x64.node
    ...
dependencies: { "node-addon-api": "^8.0.0" }
```

I prebuild sono **Node-API**: un'interfaccia binaria stabile fra versioni di
Node. `NODE_MODULE_VERSION` — che cambia a ogni major di Node e romperebbe un
addon compilato contro V8 — con un addon N-API non entra in gioco. I vincoli
reali sono due: la coppia piattaforma/architettura, e la versione minima che la
libreria dichiara (`engines: ">=22"`).

La verifica implementata è quindi quella che conta davvero, e sostituisce
qualunque confronto di numeri: **si chiede al `node.exe` che verrà consegnato di
caricare il `.node` che verrà consegnato**, e di esporre `Database`. Se la
combinazione non funziona, il confezionamento si ferma. `NODE_MODULE_VERSION`
resta registrato in `RUNTIME.json` per diagnosi — non decide nulla, ma sarebbe
la prima cosa da guardare se un addon non N-API entrasse nel grafo delle
dipendenze.

## 6. Versione di better-sqlite3

```
better-sqlite3@13.0.3
prebuild  win32-x64.node   (node-api)
sha256    e21e5efd71fba66578e95b62554d9028064a80dafd7221bf8a8ef155de8d240a
engines   >=22   →   soddisfatto da v24.11.1
caricato e verificato con  v24.11.1
```

## 7. Strategia per il modulo nativo

### La scelta: bundle completo, binario a parte

```
apps/backend/src/main.ts
        ↓  esbuild --bundle --format=esm --external:*.node
app/backend/server.js          tutto inlinato: express, drizzle, zod,
                               papaparse, better-sqlite3 (il JavaScript)
app/backend/native/
    better_sqlite3.node        il solo file che non si può inlinare
```

Nessun `node_modules` nel package. Il grafo delle dipendenze non contiene altri
moduli nativi, e nessuna dipendenza legge file relativi alla propria cartella a
runtime — verificato. `--packages=external`, che era la scelta di WP-P1,
avrebbe richiesto di spedire `node_modules` con i prebuild di otto piattaforme.

### Le tre cose che rendono possibile il bundle completo

**1. Un banner che restituisce `require` al bundle ESM.**
`better-sqlite3` carica il proprio binario con un `require` costruito a runtime.
esbuild non può risolverlo staticamente e lo lascia al proprio shim, che delega
a un `require` reale *se ne trova uno in scope*. In un modulo ESM non ce n'è.
Verificato nei due sensi, sullo stesso bundle:

| Caricato come | Senza banner | Con banner |
|---|---|---|
| CommonJS (nessun `package.json`) | funziona | funziona |
| **ESM** (`{"type":"module"}`) | `Error: Dynamic require of "fs" is not supported` | funziona, `integrity ok` |

Il banner definisce `require`, `__filename` e `__dirname` — appartengono allo
stesso problema, e nel bundle valgono il file e la cartella del bundle, che è
ciò che il codice inlinato si aspetta.

**2. `app/backend/package.json` con `{"type":"module"}`.**
Il bundle non contiene `import` di primo livello, quindi senza quel file Node lo
classificherebbe come CommonJS con la propria euristica sulla sintassi:
funzionerebbe **per caso**, e smetterebbe di funzionare al primo `import` che
esbuild decidesse di emettere. Dichiararlo rende il comportamento identico
dovunque la cartella venga copiata.

**3. `openSqlite()`, e il difetto che ha rivelato.**
`better-sqlite3` accetta `nativeBinding`, e lo passa a `path.resolve` — quindi
va **assoluto**, altrimenti verrebbe cercato a partire dalla directory di
lavoro. `paths.ts` lo espone come `NATIVE_BINDING_FILE`, che vale `null` quando
`native/` non esiste: in sviluppo non si impone nulla e la libreria si risolve
da sé, come ha sempre fatto.

La prima stesura passava il percorso **solo** dove si apre la connessione
principale. Nel package le query funzionavano e ogni backup rispondeva
`500 Errore interno del server`, perché la verifica di un backup apre un
*secondo* database (`inspectDatabase`), e lì la libreria cercava i propri
prebuild in `app/prebuilds/` e `app/build/Release/` — che nel package non
esistono. **Nel package l'intera funzione di backup e ripristino di WP-P3 era
inservibile.**

Da qui `db/sqlite.ts`: un solo punto che sa come si apre un file SQLite, e un
test statico che scandisce i sorgenti e fallisce se `new Database(` ricompare
altrove. Il test è stato verificato reintroducendo il difetto:

```
✖ nessun `new Database(` nel codice di produzione fuori da db/sqlite.ts
  usa openSqlite() invece di new Database(): nel package il binario nativo va
  indicato. Punti da correggere: modules\maintenance\backup.manifest.ts:101
```

### Una proprietà utile del formato

Il file prodotto da `VACUUM INTO` ha `journal_mode = delete`: un backup è per
costruzione un file singolo, senza `-wal` da portarsi dietro. Aprirlo in sola
lettura non crea file accessori, quindi `backups/` resta esattamente la coppia
`.sqlite` + `.json`.

## 8. Dimensione del package

| Componente | Dimensione | File |
|---|---|---|
| `runtime/node.exe` | 85,7 MB | 1 |
| `app/backend` | 3,9 MB | 3 |
| `app/frontend` | 0,5 MB | 4 |
| `app/drizzle` | 60 kB | 19 |
| `config` | 44 byte | 1 |
| `start.bat` | 433 byte | 1 |
| **Totale** | **90,2 MB** | **31** |

Il 95% è il runtime Node. L'applicazione vera — backend, frontend,
migrazioni — pesa 4,5 MB.

## 9. Procedura di build

```
npm run package
```

che è:

```
npm run build:frontend      ng build              → apps/frontend/dist/frontend/browser
npm run build:backend       scripts/build-backend → apps/backend/dist/{server.js, package.json, native/}
node scripts/package-windows.mjs                  → dist-package/MyFinance
```

`build:backend` produce **lo stesso artefatto** che esegue `npm start` e che
finisce nel package, binario nativo compreso: non esistono due build diverse,
quindi un problema di confezionamento si manifesta già in sviluppo. Il
sourcemap resta in `apps/backend/dist` (`--sourcemap=external`, quindi il bundle
non ne porta il riferimento) e non entra nel package: contiene l'intero sorgente
TypeScript e a chi usa l'applicazione non serve.

`package-windows.mjs` non si limita ad assemblare. Rifiuta il package se:

- manca uno dei dieci file attesi;
- contiene un `*.sqlite`, `*.db`, `*-wal`, `*-shm` o un `.map`;
- contiene una cartella `backups`, `logs`, `tmp`, `data` o `node_modules`;
- un qualunque file — **incluso `node.exe`, scandito per intero** — contiene il
  percorso del repository o della cartella utente di chi confeziona;
- esiste un `config/settings.json` attivo invece del solo esempio;
- il runtime non è quello fissato;
- il runtime non riesce a caricare il binario nativo.

## 10. Procedura di avvio

```
start.bat
```

```bat
@echo off
rem ...
"%~dp0runtime\node.exe" "%~dp0app\backend\server.js" %*
exit /b %ERRORLEVEL%
```

`%~dp0` è la directory dello script stesso, con la barra finale: non dipende
dalla directory da cui viene lanciato, non contiene percorsi assoluti, e regge
spazi e accenti. Il comportamento è **equivalente** a
`runtime\node.exe app\backend\server.js`, come richiesto: eseguito a mano,
quel comando risolve i percorsi allo stesso modo, perché la disposizione viene
riconosciuta dalla posizione del modulo e non da una variabile che `start.bat`
imposta.

Configurazione, con la precedenza già stabilita da WP-P2:

```
DATA_ROOT   MYFINANCE_DATA  →  config/settings.json .dataRoot  →  <APP_ROOT>/data
porta       MYFINANCE_PORT  →  config/settings.json .port      →  3000
```

Un percorso relativo in `settings.json` si risolve rispetto ad `APP_ROOT`, mai
al `cwd`.

## 11–12. Test eseguiti e risultati

### Regressione

```
backend    475 test, 475 pass, 0 fail     (P3: 459 → +16)
frontend   169 test, 169 pass, 0 fail     invariato
typecheck  nessun errore
build      npm run build → exit 0
npm start  invariato, e ora usa lo stesso percorso nativo del package:
           sqlite = apps\backend\dist\native\better_sqlite3.node
           health ok · 22 categorie · POST /api/backups → 201 · frontend servito
npm run dev  invariato (nessuna modifica agli script di sviluppo)
```

I 16 test aggiunti: 11 sulle due disposizioni in `paths.test.ts` (pure, entrambe
verificate senza costruire alberi di directory) e 5 in `db/sqlite.test.ts`, di
cui il controllo statico descritto in §7.

### `npm run verify:package` — i dieci casi obbligatori

```
9/9 verifiche superate
```

| Caso | Esito | Evidenza |
|---|---|---|
| **B** nessun Node di sistema | ok | `PATH` ridotto alle cartelle di sistema; `where node/npm/npx/tsx/ng` → non trovato |
| **A** package production | ok | `start.bat` avvia; `/`, `/transactions`, `/analytics`, `/loans`, `/settings` → 200 con `index.html`; `/loans/<id>` → 200 con ricarica diretta; `main-*.js` → 200, 470 kB |
| **C** database nuovo | ok | `DATA_ROOT` vuoto → `database.sqlite`, `backups/`, `logs/`, `tmp/` creati; 22 categorie dal seed |
| **I** migrazioni dal package | ok | il processo dichiara `migrations = <pkg>\app\drizzle` |
| **H** modulo nativo | ok | il `node.exe` incluso carica il `.node` incluso ed espone `Backup, Database, Statement, StatementIterator, initialize`; `RUNTIME.json` concorda con il binario |
| **D** database esistente | ok | 3 transazioni scritte, processo terminato, riavvio → 3 ritrovate, migrazioni non riapplicate |
| **E** spostamento del package | ok | copia in un percorso diverso, stessa `DATA_ROOT` → stesse 3 transazioni |
| **G** percorsi problematici | ok | `…\Portable Apps\Applicazioni Portàtili\livello uno\livello due\My Finance\` — spazi, accento, cinque livelli, fuori dal repository |
| **F** `DATA_ROOT` esterno | ok | vedi §15 |
| **J** isolamento dal repository | ok | vedi §16 |
| §9 codice di uscita | ok | archivio portato a una versione futura → la guardia di P3 rifiuta → `start.bat` restituisce 1 e il messaggio spiega perché |

## 13. Verifica su macchina senza Node

**Cosa è stato dimostrato.** Il package viene avviato in un ambiente in cui Node
non è raggiungibile: il `PATH` del processo figlio contiene soltanto
`C:\windows\system32`, `C:\windows` e `C:\windows\system32\Wbem`; tutte le
variabili `NODE*` e `NPM_*` sono rimosse, comprese quelle che npm inietta
eseguendo uno script. Nello stesso ambiente, `where node`, `where npm`,
`where npx`, `where tsx` e `where ng` non trovano nulla. `start.bat` invoca
`node.exe` per percorso assoluto derivato da `%~dp0`, quindi non consulta mai il
`PATH`. Il package gira da una cartella fuori dal repository, senza
`node_modules` in nessuna directory antenata.

**Cosa non è stato dimostrato.** Node non è stato disinstallato dalla macchina di
sviluppo. La prova è che il package **non consulta il `PATH` e non usa Node di
sistema**, non che la macchina ne sia priva. La verifica su una macchina
realmente pulita — o in un contenitore Windows — resta l'ultimo passo, e non
richiede modifiche al package.

## 14. Verifica di portabilità

Il package è stato copiato e avviato in:

```
%TEMP%\appconto-pkg-*\primo\MyFinance
%TEMP%\appconto-pkg-*\separato\MyFinance
%TEMP%\appconto-pkg-*\Portable Apps\Applicazioni Portàtili\livello uno\livello due\My Finance
```

Il terzo copre insieme spazi, un carattere accentato e cinque livelli di
annidamento. In tutti i casi: `APP_ROOT` coincide con la cartella del package,
il database aperto è quello indicato, i dati sono gli stessi. Nessuna
configurazione assoluta è stata modificata fra le copie.

Non è stato provato un volume fisicamente diverso: la macchina ha una sola
unità. `APP_ROOT` è però derivato interamente dalla posizione del modulo, e la
radice dell'unità non compare in nessun file del package (verificato), quindi non
esiste un percorso su cui una lettera di unità sia registrata.

## 15. Verifica `APP_ROOT ≠ DATA_ROOT`

```
APP_ROOT   %TEMP%\appconto-pkg-*\separato\MyFinance
DATA_ROOT  %TEMP%\appconto-esterni-*\Archivio Utente        (con spazio nel nome)
```

Dimostrato, dopo un import e la creazione di un backup dalle API:

- `database.sqlite`, `logs/`, `backups/`, `tmp/` sono tutti nella radice esterna;
- il backup creato è **uno**, e sta in `<esterna>/backups/`;
- dentro il package **non** è comparsa nessuna cartella `data/`;
- `app/` e `runtime/` sono invariate **byte per byte** (impronta di nomi e
  dimensioni confrontata prima e dopo);
- rimuovendo `app/` e ricopiandola da capo — cioè simulando un aggiornamento —
  il riavvio ritrova la transazione al suo posto.

L'ultimo punto è il principio del WP messo alla prova: si sostituisce il codice
e i dati non se ne accorgono.

## 16. Verifica di isolamento dal repository

Due controlli distinti.

**A runtime.** Per ogni avvio, i percorsi che il processo *dichiara* nel proprio
log — `appRoot`, `dataRoot`, `database`, `migrations`, `frontend`, `sqlite` —
vengono confrontati con la radice del repository: nessuno vi ricade. Il package
copiato altrove non risolve `apps/backend`, `apps/frontend`,
`repository/node_modules` né `repository/data`.

**Sul contenuto.** Ogni file del package viene letto **come byte** e confrontato
con il percorso del repository e con quello della cartella utente, in entrambe
le forme di separatore. `node.exe`, 85,7 MB, è scandito per intero. Nessuna
occorrenza. Nessun `.sqlite`, `.db`, `.map`, nessuna cartella `node_modules`,
`backups`, `logs`, `tmp` o `data`.

## 17. Deviazioni dal piano

| Deviazione | Motivo |
|---|---|
| `data/` **non** viene creata nel package | L'albero del piano la mostrava. Un package che non contiene nemmeno la cartella dei dati non può averci portato dentro per sbaglio l'archivio di chi lo ha confezionato, e il primo avvio lo dimostra creando tutto da zero. Il controllo di §2 la elenca fra le cartelle vietate. |
| Il database resta `database.sqlite`, non `finance.sqlite` | Il piano stesso chiede di mantenere i nomi già definiti dal progetto salvo motivazione tecnica. Rinominarlo orfanizzerebbe l'archivio esistente dell'utente: rischio di perdita dati per zero beneficio. |
| Nessun `node_modules/` nel package | Il piano lo ammetteva "solo se necessario secondo la strategia scelta". Con il bundle completo non è necessario (§7). |
| Nessun sourcemap nel package | Contiene l'intero sorgente TypeScript; resta in `apps/backend/dist` per le diagnosi. |
| La verifica del modulo nativo non confronta `NODE_MODULE_VERSION` | Con un addon N-API non è il vincolo. Si carica il binario col runtime incluso, che è più forte (§5). |
| Aggiunto `db/sqlite.ts` | Necessità tecnica dimostrata dal packaging: il difetto di §7. |
| Aggiunto il gestore di `EADDRINUSE` in `main.ts` | §10 chiedeva di non assumere che la porta 3000 sia libera, e di non anticipare il launcher. Questo è un messaggio d'errore, non una selezione automatica della porta. |
| `verify:package` non fa parte di `npm test` | Richiede un package costruito e dura minuti. È un comando a sé; le parti che si possono verificare senza package sono nella suite (`paths.test.ts`, `db/sqlite.test.ts`). |
| `build:backend` unificato | `npm start` e il package eseguono lo stesso `server.js`, con lo stesso `native/`. Due configurazioni diverse avrebbero significato che il package esegue codice che nessuno ha provato in sviluppo. |

## 18. Debiti tecnici scoperti

### `fs.cpSync` copia zero file, senza errore, verso percorsi non ASCII

Il difetto più insidioso incontrato in questo WP. Su Node v24.11.1 / Windows 11:

| Metodo | Destinazione `…\Applicazioni Portàtili\My Finance` |
|---|---|
| `cpSync(src, dest, {recursive:true})` | **ok, 0 voci copiate** |
| `cpSync` con destinazione creata prima | **ok, 0 voci copiate** |
| `mkdirSync` + `copyFileSync` a mano | 4 voci, `node.exe` 86 MB |
| `robocopy /E` | 4 voci, `node.exe` 86 MB |

Nessuna eccezione, nessun valore di ritorno: la funzione dichiara di avere
lavorato e la cartella resta vuota. Per uno strumento di confezionamento è il
guasto peggiore possibile — un package silenziosamente vuoto.

Mitigato con `scripts/copy-tree.mjs`, che copia a mano e **conta i file
all'origine e a destinazione**, sollevando se non coincidono. L'applicazione non
è interessata: non usa `cpSync` in nessun punto (usa `copyFileSync`, che
funziona). Resta un debito verso l'esterno: da segnalare a monte, e da tenere
presente in qualunque script futuro.

Questo difetto è stato trovato **solo** perché il test G esisteva. Con percorsi
ASCII il confezionamento funzionava perfettamente.

### `cmd /s` spezza i percorsi quotati

`cmd /d /s /c "C:\Portable Apps\...\start.bat"` fallisce: `/s` cambia la regola
di rimozione delle virgolette in "togli la prima e l'ultima e prendi il resto
alla lettera", e il comando viene spezzato al primo spazio. La forma corretta è
`/c` con il percorso quotato una volta sola. Verificato su dodici combinazioni
di nome, profondità e forma di invocazione. Non riguarda `start.bat` in sé, ma
chiunque lo invochi da uno script — nota per P5.

### Debiti precedenti, invariati

- **`escapeLike()`** — non corretto, come richiesto dal piano. Il fix è di una
  riga in `apps/backend/src/shared/sql.ts` e merita un WP di manutenzione.
- **`cors` e `@types/cors`** ancora dichiarati e non usati, residuo di WP-P1. Il
  piano vieta esplicitamente il cleanup delle dipendenze in questo WP; nota che
  **non finiscono nel package**, perché il bundle include solo ciò che è
  raggiungibile dagli import.
- **Nessuna interfaccia per backup e ripristino**: la funzione è solo API.

### Nuovi, minori

- Il package è **solo `win32-x64`**. La struttura è pronta per altre
  piattaforme — i prebuild ci sono tutti e `resolveNative` è parametrico — ma
  serve il `node` corrispondente e uno script di avvio POSIX.
- Il 95% dei 90 MB è `node.exe`. Ridurlo richiederebbe un runtime ritagliato
  (SEA, o build custom): sconsigliato, perché scambierebbe 80 MB di disco con
  una superficie di rischio sul componente che esegue tutto.

## 19. Rischi residui per P5

| Rischio | Stato attuale | Cosa deve fare P5 |
|---|---|---|
| **Porta occupata** | messaggio chiaro ed uscita con codice 1: *«La porta 3000 è già occupata… indica una porta diversa con MYFINANCE_PORT»* | scegliere una porta libera e passarla all'app |
| **Nessun single-instance** | due `start.bat` sulla stessa `DATA_ROOT` aprono due connessioni allo stesso database | mutex, come già previsto |
| **Doppio clic e finestra** | la finestra di `cmd` si chiude all'uscita, quindi un errore all'avvio non è leggibile senza terminale | avviare senza console e mostrare gli errori |
| **Arresto ordinato** | terminare la finestra o il processo non consegna `SIGINT` su Windows: il WAL non viene consolidato. I dati non sono a rischio — il WAL resta valido e viene recuperato al riavvio — ma il database in quel momento non è un file singolo | inviare un arresto ordinato e attendere il checkpoint prima di uscire |
| **Nessuna apertura del browser** | l'utente deve digitare l'indirizzo | come già previsto |
| **`APP_ROOT` dedotto dai due segmenti finali** | `app/backend` = package, altro = repository | se il packaging cambierà disposizione, `resolveLayout` va aggiornato **e** i suoi 11 test lo diranno subito |
| **Nessun backup automatico periodico** | la politica di ritenzione per il tipo `auto` è scritta e provata da P3, ma nulla lo crea | lo scheduler |

## 20. Protezione del database reale

```
REAL DATABASE TOUCHED: NO
```

Verificato concretamente, non assunto.

### Impronta del database reale, prima e dopo l'intero WP

```
integrity   ok
conteggi    {"__drizzle_migrations":9,"categories":22,"loan_repayments":1,
             "loans":2,"merchants":452,"settings":1,"transactions":931}
dimensione  507904 byte
sha256      b68a8bf4323a65fc41892382ee8261496495aeaf471a55ffca76ebf42fe6d829
```

La stessa impronta registrata come baseline all'inizio di WP-P3. **Identica byte
per byte** al termine di P4, dopo il confezionamento, i nove test sul package,
la suite completa e lo smoke test di `npm start`.

Nel `DATA_ROOT` reale: `backups/` **vuota**, `tmp/` **vuota**, nessun
`restore-pending.json`. Il file di log reale conta 10 righe e la sua ultima
scrittura è **15:28:22** — l'ultima esecuzione dell'utente, precedente
all'inizio di questo lavoro (concluso alle 17:03).

### Come è stato garantito

Ogni avvio del package riceve una `DATA_ROOT` creata con `mkdtempSync` sotto
`%TEMP%`, e **prima di qualunque scrittura** il controllo legge dal log del
processo figlio quali percorsi ha effettivamente aperto, verificando che:

- la `DATA_ROOT` dichiarata sia quella attesa e stia sotto `%TEMP%`;
- né `database` né `dataRoot` inizino per una delle due radici dati reali
  (`<repo>\data` e la posizione storica `<repo>\apps\backend\data`);
- `APP_ROOT` sia dentro il package appena copiato;
- la disposizione riconosciuta sia `package`.

Se uno solo di questi non torna, la verifica **si interrompe** invece di
proseguire. Non è una formalità: al primo giro ha fermato il test E, perché il
controllo leggeva la *prima* riga di avvio di un file di log condiviso fra più
esecuzioni — quindi verificava l'isolamento di un processo che non era quello
appena avviato. Un controllo che dice "ok" guardando la cosa sbagliata è peggio
di nessun controllo; ora legge l'ultima riga e attende quella del package atteso.

Lo smoke test di `npm start` ha usato lo stesso metodo: `DATA_ROOT` temporanea,
porta assegnata dal sistema (57554, mai 3000), e i percorsi letti dal log del
processo.

Un unico processo è rimasto orfano durante il lavoro — uno script di verifica
interrotto da un proprio errore — ed è stato terminato; la porta 3000 è stata
ricontrollata libera. Nessuna richiesta mutante era stata inviata.

---

## Criterio di completamento

> È possibile consegnare una directory `MyFinance/` a una macchina Windows che
> non dispone di Node.js e ottenere: `start.bat` → node.exe incorporato →
> `server.js` di produzione → Express → Angular di produzione → SQLite in
> `DATA_ROOT`.

Soddisfatto, con la precisazione di §13 sul significato di "senza Node".

Senza installazione, senza `npm install`, senza terminale configurato, senza
repository, senza Node di sistema, senza percorsi assoluti e senza database
incorporato nel package. La prova finale è stata eseguita su directory
completamente separate dal repository, compresa una con spazi, accento e cinque
livelli di annidamento.
