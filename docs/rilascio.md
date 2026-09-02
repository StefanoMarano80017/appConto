# Come si rilascia una nuova versione

Dal codice sorgente alla cartella da consegnare. Cinque comandi, e tre cose da
sapere per non sbagliare.

---

## In breve

```bash
npm test                # 1. le prove passano?
npm run typecheck:backend

npm run package         # 2. costruisce e confeziona → dist-package\MyFinance
npm run verify:package  # 3. prova la cartella confezionata, fuori dal repository
```

Il risultato è la cartella `dist-package\MyFinance`: **quella** si consegna,
per intero.

---

## 1. Dove si scrive il codice

```
apps/backend/src/          il server: dominio, API, accesso ai dati
   modules/<feature>/      una feature per cartella (transazioni, prestiti, …)
   db/                     connessione, migrazioni, azzeramento sicuro
   launcher/               ciò che avvia, sorveglia e ferma l'applicazione
   paths.ts                l'UNICO posto che decide dove stanno i file

apps/backend/drizzle/      le migrazioni dello schema (generate, non scritte a mano)

apps/frontend/src/app/     l'interfaccia Angular
   features/<feature>/     una feature per cartella, con la sua API e i suoi test
   core/                   formattazione, errori, indirizzo delle API

scripts/                   build, confezionamento e verifica del package
```

Due regole che il progetto fa rispettare da sé, e che conviene conoscere prima
di combatterle:

- **nessun modulo deduce un percorso.** Tutto passa da `paths.ts`. Se serve una
  cartella nuova, si aggiunge lì.
- **nessun modulo apre SQLite da sé.** Si passa da `openSqlite()`. Un
  `new Database(...)` altrove fa fallire un test: nella cartella portatile
  `node_modules` non esiste, e la libreria non troverebbe il proprio binario.

## 2. Provare mentre si scrive

```bash
npm run dev             # backend con ricarica automatica (porta 3000)
npm run dev:frontend    # interfaccia Angular con ricarica automatica (porta 4200)
```

In sviluppo si usano **due** processi e il proxy di Angular; in produzione è
Express a servire anche l'interfaccia. Il frontend non conosce l'indirizzo del
backend in nessuno dei due casi: usa `/api`.

Per provare la build di produzione senza confezionare:

```bash
npm run build           # frontend + backend
npm start               # esegue apps/backend/dist/server.js
```

> **Attenzione:** `npm start` e `npm run dev` usano l'archivio **reale** in
> `data/`. Per provare su dati finti, indica un'altra radice:
>
> ```bash
> MYFINANCE_DATA=C:\temp\prova npm start
> ```

## 3. Se hai cambiato lo schema del database

Le migrazioni **non** si scrivono a mano: si generano dalle definizioni delle
tabelle (`*.schema.ts`).

```bash
npm run db:generate     # crea un nuovo file in apps/backend/drizzle/
```

Poi apri il file generato e leggilo: è quello che verrà eseguito sull'archivio
di chi usa l'applicazione, e una migrazione sbagliata non si annulla.

Tre cose da sapere:

1. **Le migrazioni sono solo in avanti.** Non esiste un «indietro»: un archivio
   più recente dell'applicazione fa rifiutare l'avvio, con un messaggio che lo
   spiega. È deliberato — una versione vecchia che apre dati nuovi li
   rovinerebbe in silenzio.
2. **Prima di migrare, l'applicazione crea un backup da sé** e non migra se
   quel backup non riesce. Non serve fare niente.
3. Se aggiungi una tabella, l'azzeramento la troverà da sé: l'elenco delle
   tabelle viene chiesto al database, non scritto a mano. Se invece la nuova
   tabella deve avere un contenuto iniziale, quel contenuto va aggiunto **sia**
   nella migrazione **sia** al seed che l'azzeramento riapplica — e c'è un test
   che pretende che i due coincidano (`categories.seed.test.ts` è l'esempio da
   imitare).

## 4. Prima di confezionare

```bash
npm test                     # backend + frontend
npm run typecheck:backend
```

Se qualcosa è rosso, si ferma qui: `npm run package` non controlla la
correttezza del codice, controlla la cartella.

## 5. Alzare il numero di versione

Una riga in `package.json`:

```json
{ "version": "1.1.0" }
```

Da lì finisce in `app/VERSION` e in `app/RUNTIME.json` dentro il package. Non
va scritta altrove.

## 6. Confezionare

```bash
npm run package
```

Costruisce frontend e backend, poi assembla la cartella. Alla fine stampa cosa
ha prodotto:

```
  package        dist-package\MyFinance
  app            1.1.0
  node           v24.11.1 win32-x64 (NODE_MODULE_VERSION 137, N-API 10)
  sqlite         better-sqlite3@13.0.3 via win32-x64.node (node-api)
  file           33
  dimensione     90.2 MB  (di cui runtime 85.7 MB)

  avvio:         start.bat
  arresto:       stop.bat   (oppure si chiude la finestra)
```

Il confezionamento **si rifiuta** di produrre una cartella non consegnabile.
Fallisce se trova un database, un sourcemap, una cartella `node_modules`, o un
percorso della tua macchina in un qualsiasi file — `node.exe` compreso, che
viene scandito per intero.

### Se si lamenta del runtime

```
Il runtime da incorporare non è quello fissato in scripts/node-runtime.json:
versione v24.12.0, attesa v24.11.1.
```

La versione di Node che viene inclusa nel package è **fissata** in
`scripts/node-runtime.json`, e il confezionamento la verifica interrogando il
binario. Due possibilità:

- vuoi la versione fissata: scaricala e indicala,
  `MYFINANCE_NODE_EXE=C:\node-v24.11.1\node.exe npm run package`;
- vuoi cambiare versione: aggiorna `scripts/node-runtime.json`. È una decisione
  deliberata, e va fatta lì.

## 7. Verificare la cartella

```bash
npm run verify:package
```

Copia il package **fuori dal repository**, gli toglie dal `PATH` qualsiasi Node
di sistema, e lo avvia davvero: su percorsi con spazi e accenti, con una radice
dati esterna, con la porta occupata, con due istanze insieme, con una
terminazione brusca. Diciassette prove, e nessuna tocca il tuo archivio.

Se stampa `17/17 verifiche superate`, la cartella è consegnabile.

---

## Consegnare

### Prima installazione

Si copia `MyFinance` dove si vuole — disco interno, chiave USB, cartella
sincronizzata — e si fa doppio clic su `start.bat`.

Al primo avvio nasce `MyFinance\data\`, con il database, i backup, i log e i
temporanei. **La cartella `data/` non è nel package**: se ci fosse, sarebbe
l'archivio di chi lo ha confezionato.

### Aggiornamento di un'installazione esistente

Questa è l'unica procedura che conta ricordare:

```
1. chiudi l'applicazione        (stop.bat, oppure chiudi la finestra)
2. sostituisci   app\          e   runtime\
3. sostituisci   start.bat     e   stop.bat
4. NON toccare   config\       né  data\
5. riavvia
```

Il motivo è tutto nella divisione fra le due radici:

| cartella | cos'è | in un aggiornamento |
|---|---|---|
| `app\`, `runtime\`, `*.bat` | il programma | **si sostituisce** |
| `config\` | le impostazioni di chi la usa | si lascia |
| `data\` | il suo archivio, i backup, i log | **si lascia** |

Lo prova un test a ogni confezionamento (caso **Q**): rimuove `app/` e
`runtime/`, li ricopia da zero, riavvia, e pretende di ritrovare le
transazioni, i backup e le categorie.

Se non chiudi l'applicazione prima di sostituire i file, Windows rifiuterà di
sovrascrivere `node.exe` perché è in esecuzione. È l'unico sintomo, ed è
benigno: chiudi e riprova.

### Cosa NON consegnare

- `dist-package\verify-report.json` — è il verbale delle prove, non serve a chi
  usa l'applicazione.
- la cartella `data\` di chiunque, per nessun motivo.

---

## Le tre cose da sapere

**Un archivio non torna indietro.** Le migrazioni sono solo in avanti, e una
versione vecchia sopra dati nuovi si rifiuta di partire. Se devi tornare a una
versione precedente del programma, devi ripristinare anche un backup di quando
quella versione era attuale.

**I test non devono toccare l'archivio reale.** Ogni prova che avvia
l'applicazione riceve una radice dati temporanea, e `verify:package` legge dal
log del processo figlio quale cartella ha davvero aperto: se non è quella
temporanea si ferma con
`ISOLAMENTO NON DIMOSTRATO — verifica interrotta`. Quando aggiungi un test che
scrive, la prima cosa da scrivere è l'isolamento — non l'asserzione.

**Il numero di versione serve a te, non al programma.** Nulla nel codice si
comporta diversamente fra la 1.0.0 e la 1.1.0; la versione finisce nel
manifest del package e nei backup, e serve a rispondere alla domanda «quale
versione ha prodotto questo archivio?». Alzarla è gratis, non alzarla costa una
diagnosi difficile fra sei mesi.
