# Analisi di qualità dei router (master, prima del merge di M0–M3)

Copia fedele del rapporto prodotto su master e incollato dall'utente il 02/11/2026; è il riferimento del design `2026-11-02-router-di-design.md`. Gli identificativi D1–D11 qui sotto sono **difetti dei router**, distinti dalle decisioni di dominio D1–D12 del piano M0–M5: nel design si citano come A-D1…A-D11, i gruppi come A-G0…A-G7 e i test come A-T-A, A-T-B, A-T-C. Alcuni percorsi citati sono dello scratchpad di quella sessione e non esistono nel repo.

Per non dedurre il comportamento solo leggendo il codice, ho avviato la vera `createApp` su un DB temporaneo e ho inviato 62 richieste limite. Lo script è in `C:\Users\stefa\AppData\Local\Temp\claude\c--Users-stefa-Desktop-appConto\47fadd36-c362-4934-890c-c6a1354072d4\scratchpad\probe\http-probe.mts`. Le risposte citate più sotto vengono da quella esecuzione, salvo dove scrivo "da lettura del codice".

Legenda: **[V]** problema verificato · **[O]** miglioramento opzionale · **[S]** preferenza stilistica

## 1. Valutazione generale

Il livello HTTP è di buona qualità:
- quasi tutti gli handler sono brevi e delegano a un solo service;
- non ci sono `try/catch` né wrapper;
- il formato degli errori è sempre `{ error: string }`;
- il body parser è applicato solo alle rotte che lo usano;
- l'ordine delle rotte è corretto (`/links` e `/summary` vengono prima di `/:id`).

I problemi reali sono concentrati in tre punti:
- l'error handler classifica in modo troppo generico gli errori 4xx;
- alcune risposte sono costruite nel router con logica non HTTP;
- la copertura di test HTTP è sottile, soprattutto sui casi d'errore.

## 2. Problemi concreti

**[V] D1 – L'error handler tratta ogni errore con `status` 4xx come "corpo non leggibile"**
- Dove: [error-handler.ts:27-50](apps/backend/src/shared/http/error-handler.ts#L27-L50).
- Prova: `GET /api/transactions/%E0%A4%A` e `GET /api/loans/%ZZ` rispondono **400 "Richiesta non valida: il corpo non è leggibile."**. In realtà l'errore è nell'URL e viene da Express: decodifica del parametro, non il body.
- Lo stesso accadrebbe, da lettura del codice, per gli errori di `send` dentro `res.download`, per esempio un file rimosso tra `verify` e il download (404 con quel messaggio).
- Conseguenza: messaggio fuorviante. Gli errori di body-parser e gli altri finiscono nello stesso ramo senza distinzione.

**[V] D2 – Manca il controllo `res.headersSent`**
- Dove: [error-handler.ts:41](apps/backend/src/shared/http/error-handler.ts#L41). È verificato leggendo il codice; non sono riuscito a riprodurlo, perché serve un guasto durante lo streaming.
- Se `res.download` fallisce dopo l'invio degli header, l'handler chiama `res.status().json()`, che solleva `ERR_HTTP_HEADERS_SENT`.
- Express intercetta l'eccezione con il suo handler finale, quindi il processo non va in crash. Però nel log compare un "Errore non gestito" seguito da un secondo errore spurio.

**[V] D3 – `summary` dice "mancante" per un `month` ripetuto**
- `GET /api/summary?month=2026-01&month=2026-02` risponde 400 **"Parametro "month" mancante"**, ma il parametro c'è.
- Dashboard e cash-flow nello stesso caso rispondono "non valido".
- Impatto nullo sul frontend, che non usa `/summary`. Cambiarlo significa cambiare un messaggio di contratto.

**[V] D4 – I parametri ripetuti hanno due politiche diverse**
- Loans, transactions e merchants prendono silenziosamente il primo valore: `?status=open&status=all` → 200 con `open`; `?page=1&page=2` → pagina 1.
- `month` invece rifiuta il valore ripetuto.
- Entrambi i comportamenti sono difendibili. Lo documento soltanto.

**[V] D5 – Messaggi Zod predefiniti, in inglese, esposti al frontend**
- `POST /api/loans` senza body → `"Invalid input: expected object, received undefined"`.
- `POST /api/loans {}` → `"Invalid input: expected string, received undefined"`.
- `borrowerName` di 130 caratteri → `"Too big: expected string to have <=120 characters"`.
- `/import/csv/mapped` senza body → stesso caso.
- La pagina di creazione del prestito mostra questi messaggi all'utente. La causa sta negli schemi dei service, cioè fuori dal livello HTTP. Correggerli cambia il contratto.

**[V] D6 – Logica non HTTP nei router**
- [categories.routes.ts:71-74](apps/backend/src/modules/categories/categories.routes.ts#L71-L74): PATCH chiama `update` e poi `usage` e compone la risposta. Sono due chiamate al service per una risposta.
- [maintenance.routes.ts:33-40](apps/backend/src/modules/maintenance/maintenance.routes.ts#L33-L40): `currentState()` mette insieme `backupService` e `restoreService`.
- [maintenance.routes.ts:55-68](apps/backend/src/modules/maintenance/maintenance.routes.ts#L55-L68): il percorso del file viene risolto con `resolveBackupFile`, poi `verify()` lo risolve di nuovo e restituisce già `check.file`. `restore.service` usa infatti `check.file`.
- [transactions.routes.ts:89-92](apps/backend/src/modules/transactions/transactions.routes.ts#L89-L92): la conversione da `null` a `NotFoundError` avviene nel router.
- Conseguenza: piccola. Il router conosce dettagli applicativi e i test HTTP devono coprire anche quella composizione.

**[V] D7 – `import()` dinamico in analytics, inutile**
- Dove: [analytics.routes.ts:20-24](apps/backend/src/modules/analytics/analytics.routes.ts#L20-L24).
- L'obiettivo era non aprire il DB nei test. L'ho verificato nel turno precedente: importare `analytics.routes.ts` apre già il DB, attraverso `analytics.query`, poi il barrel di transactions, poi `db/client`.
- Conseguenza: l'unico handler `async` del backend e un import a ogni richiesta, senza beneficio.

**[V] D8 – `DELETE /api/restore` risponde 404 `{"cancelled":false}` senza `error`**
- È l'unica risposta 4xx con un formato diverso da `{error}`.
- Il frontend non usa `/restore`. Lo documento e non lo cambio.

**[S] D9 – Quattro helper equivalenti per l'id mancante** (`categoryId`, `merchantId`, `requireId`, `required`)
- Non sono raggiungibili: una rotta `/:id` non corrisponde mai con un id vuoto.
- Sono innocui. Unificarli non porta benefici.

**[S] D10 – Risposte 204 costruite in due modi:** `res.status(204).send()` in categories, `.end()` in loans. In uscita sono equivalenti.

**[S] D11 – Virgolette doppie** nell'`analytics.routes.ts` non committato; il resto dei router usa le singole.

## 3. Validazione HTTP

**Cosa funziona bene:**
- Le query passano da `queryParam` e poi da `parse*Query` del modulo (4 moduli). Ci sono messaggi per ogni parametro e i casi limite sono gestiti.
- Content-type:
  - `json()` ignora gli altri tipi, e in Express 5 `req.body` resta `undefined`, quindi scatta il messaggio di validazione del modulo. Verificato con `text/plain`, senza content-type e con body vuoto: rispondono tutti 400 con il messaggio di categories.
  - L'import CSV con `application/json` risponde 400 con un messaggio esplicito su `text/csv`.
- Body malformato: JSON rotto, valore non oggetto in modalità strict, 413, 415 per charset o encoding rispondono tutti con status corretto e messaggio generico. Va bene.

**Dove sta la validazione oggi, e l'ordine dei controlli** (i test devono fissarlo):

| Rotta | Validazione del body | Prima viene… | Prova |
|---|---|---|---|
| categories, merchants, transactions, restore, reset | router, messaggio fisso | forma → esistenza | `PATCH /transactions/nope/type {"type":"X"}` → **400** |
| loans PATCH | service | **esistenza → forma** | `PATCH /loans/nope {}` → **404** |
| merchants `/:id/category` | router → service | merchant → categoria | entrambi inesistenti → **404 merchant** |
| settings, import mapped | service | — | — |

Spostare la validazione tra router e service invertirebbe alcune di queste righe. Per questo **non lo propongo**.

**Duplicazioni:**
- Sette blocchi `safeParse` → `if` → `throw new ValidationError(messaggio fisso)`. Un helper `parseOrReject(schema, value, message)` accanto a `parseOrThrow` sarebbe giustificato: è la stessa forma ripetuta sette volte, con messaggi invariati. **[O]**
- Il controllo di `month` in tre router usa due messaggi diversi, quindi un helper dovrebbe portarsi dietro entrambe le varianti. Non conviene.
- Il nome vuoto di una categoria è controllato nel router e nel service: è un'invariante di dominio legittima e va tenuta.

## 4. Risposte HTTP

Le differenze hanno quasi tutte una ragione funzionale, quindi **non vanno uniformate**:

| Caso | Comportamento | Giudizio |
|---|---|---|
| POST di creazione (categories, loans, repayments, backups) | 201 | coerente |
| `POST /import/*` | 200 con il report | giusto: è un comando che può importare 0 righe |
| `POST /restore` | 202 con `restartRequired` | giusto: viene applicato al riavvio |
| `POST /reset` | 200 | giusto: l'effetto è immediato |
| `DELETE /categories/:id`, `DELETE /loans/:id` | 204 | coerente (D10 è solo stile) |
| `DELETE /loans/:id/repayments/:rid` | 200 con il prestito aggiornato | giusto: serve alla UI per aggiornare il dettaglio |
| `DELETE /transactions` (bulk) | 200 con `{requested, deleted, notFound}` | giusto: l'esito può essere parziale |
| PATCH | categories → con `merchantCount`; transactions/type → solo `{id,type}`; gli altri → risorsa completa | ogni forma corrisponde a quello che consuma il frontend; documentare |
| `GET /restore` | `200 null` | JSON valido; va bene |
| DELETE /restore | D8 | documentare |

Express 5 è usato correttamente:
- `req.body` resta `undefined` senza parser;
- HEAD e OPTIONS sono automatici: `OPTIONS /api/categories` → 200 `GET, HEAD, POST`;
- `res.download` passa l'errore dal callback a `next`.

**[S]** Due modi di mappare le risposte: alcuni router applicano un DTO (categories, merchants, transactions, maintenance), altri restituiscono direttamente il view-model del service (loans, analytics, dashboard). Entrambi vanno bene; non uniformare.

## 5. Error handling

| Origine | Esempio | Oggi | Proposta |
|---|---|---|---|
| `DomainError` | 400/404/409 | messaggio del dominio | invariato |
| body-parser | `entity.parse.failed`, `entity.too.large`, `charset.unsupported`, `encoding.unsupported`, `request.aborted`, `request.size.invalid` | status proprio e messaggio generico | **riconoscerlo esplicitamente** dalla proprietà `type`, con la stessa risposta |
| altri errori 4xx di Express | decodifica dell'URL (400), `send` 404/416 | stesso ramo, messaggio sbagliato (D1) | **ramo di fallback separato**, con la stessa risposta di oggi; cambiare il messaggio è una decisione a parte (G7) |
| infrastrutturali e imprevisti | `BackupFailedError`, errori di SQLite | 500 generico e log | invariato, più `method` e `originalUrl` nel log |
| dopo l'invio degli header | download interrotto | eccezione nell'handler (D2) | `if (res.headersSent) return next(error)` |

Nessun dettaglio interno esce nelle risposte: il 500 è generico, i messaggi di body-parser sono nascosti, nessun percorso. Le Promise rifiutate sono gestite da Express 5 e non servono wrapper.

## 6. Test HTTP mancanti, in ordine di priorità

Oggi non hanno test HTTP: categories, loans, settings, import, summary, dashboard, cash-flow e l'error handler. Gli esiti attesi sono quelli osservati nella caratterizzazione.

**T-A · Error handler** (app Express minima, senza DB)
1. `ValidationError`, `NotFoundError` e `ConflictError` → 400/404/409 con `{error: message}`.
2. JSON malformato → 400; valore non oggetto in modalità strict → 400; body troppo grande → 413; charset ed encoding non supportati → 415. Tutti con `"Richiesta non valida: il corpo non è leggibile."`.
3. URL con codifica non valida → 400 (oggi con lo stesso messaggio: il test fissa D1).
4. `Error` generico → 500 `"Errore interno del server."`, con il messaggio originale **assente** dal body e il logger chiamato.
5. Valore lanciato che non è un `Error` (stringa) → 500.
6. Handler `async` che rifiuta → 500 (verifica la propagazione nativa di Express 5).
7. Errore dopo `res.headersSent`, dopo la correzione di D2 → nessuna seconda scrittura.

**T-B · Contratti per modulo** (`createApp` con DB temporaneo)
- **categories:**
  - 201 con forma `{id,name,color}`;
  - duplicato → 409;
  - body mancante o di tipo sbagliato → 400 con il messaggio fisso;
  - PATCH `{}` → 400 "name e/o color";
  - PATCH, DELETE e usage su id inesistente → 404;
  - DELETE riuscito → **204 con body vuoto**;
  - eliminare «Da classificare» → 409.
- **loans:**
  - POST senza body, con `{}` e con nome troppo lungo → 400 con i messaggi Zod esatti (D5);
  - transazione inesistente → 404;
  - transazione non di tipo LOAN → 400;
  - PATCH su id inesistente con body `{}` → **404** (ordine dei controlli);
  - DELETE con restituzioni → 409; DELETE riuscito → 204;
  - DELETE di una restituzione → 200 con il dettaglio;
  - `status` non valido → 400; `status` ripetuto → primo valore.
- **settings:**
  - PATCH `{}` → 200 con i valori correnti;
  - PATCH con un array e senza body → 400 con il messaggio fisso.
- **import:**
  - JSON su `/csv` → 400 sul content-type;
  - CSV vuoto o di soli spazi → 400 "Il file CSV è vuoto." (su `/csv` e su `/analysis`);
  - mapped `{}` → "Contenuto del CSV mancante"; mapped senza body → messaggio Zod;
  - CSV sopra `maxCsvSize` → 413.
- **summary/dashboard/cash-flow:**
  - mancante, ripetuto (D3) e malformato → i tre messaggi distinti;
  - dashboard senza `month` → 200.
- **transactions:**
  - GET e PATCH su id inesistente → 404;
  - tipo non valido su id inesistente → **400** (ordine dei controlli);
  - DELETE di ids inesistenti → 200 con `notFound`.
- **merchants:**
  - PATCH `{}` → 400;
  - merchant e categoria entrambi inesistenti → 404 sul merchant.
- **maintenance:**
  - DELETE /restore senza un ripristino in attesa → 404 `{cancelled:false}` (D8);
  - GET /restore → `200 null`.

**T-C · Router di base:** un metodo non previsto (`PUT /api/categories`) → 404 `Risorsa non trovata: PUT /api/categories`.

**Prerequisito fuori perimetro:** `analytics.routes.test.ts` e `merchant-query.test.ts` aprono il DB reale in `appConto/data/` (vedi turno precedente). Prima di aggiungere altri test serve l'isolamento con un preload: tocca `package.json`, quindi è una configurazione e richiede la tua approvazione esplicita.

## 7. Piano incrementale

| Gruppo | Contenuto | Modifica alla produzione | Beneficio | Rischio |
|---|---|---|---|---|
| **G0** | Isolamento dei test (preload, script `test:backend`) | no (solo configurazione) | protegge i dati reali | basso |
| **G1** | T-A, test di caratterizzazione dell'error handler | no | rete di sicurezza per G3 | nullo |
| **G2** | T-B e T-C, due o tre commit per gruppo di moduli | no | baseline dei contratti | nullo (i test D5 dipendono dalla versione di Zod) |
| **G3** | Error handler: riconoscimento esplicito di body-parser, fallback 4xx con risposta invariata, `headersSent`, contesto nel log | sì, 1 file | chiarezza, nessuna eccezione spuria | basso, coperto da G1 |
| **G4** | Analytics: rimuovere l'import dinamico (D7) e uniformare le virgolette (D11) | sì, 1 file | meno complessità | basso |
| **G5** [O] | `parseOrReject` e i 7 blocchi | sì, 5 file | meno ripetizione | basso, coperto da G2 |
| **G6** [O] | D6: usare `check.file` nel download, spostare la composizione di categories PATCH e `currentState` nei service | sì, router e service | router più puliti | medio-basso: ordine dei controlli, coperto da G2 |
| **G7** [decisione tua] | Difetti di contratto: messaggio corretto per i 4xx non legati al body (D1), messaggio per `month` ripetuto (D3), messaggi italiani al posto di quelli Zod (D5) | sì, **cambia i messaggi** | messaggi corretti | modifica intenzionale del contratto |

## 8. Non fare

- Controller, middleware di validazione generici, `asyncHandler`, `try/catch` nei router.
- Spostare la validazione tra router e service: cambia i messaggi e l'ordine dei controlli (vedi la tabella al punto 3).
- `json()` a livello di router o di app: farebbe rispondere 400 a richieste oggi accettate. Esempio: `DELETE /api/loans/nope` con JSON rotto oggi risponde 404.
- Uniformare status e payload: 200/201/202/204, PATCH parziali o completi, il 404 di `/restore`.
- Aggiungere `code`, `details` o un elenco di errori al body, oppure un request ID.
- Nuove classi di errore per i 4xx di Express: bastano la proprietà `type` e il fallback.
- Unificare gli helper dell'id (D9), le 204 (D10) o un helper per `month`.
- Un helper generico che costruisca le query da un elenco di nomi: sono 4 router leggibili così come sono.