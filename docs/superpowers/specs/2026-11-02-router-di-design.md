# Router: iniezione delle dipendenze, test e refactoring — design

Data: 02/11/2026 · Branch: `refactor/router` (da `master` dopo il merge di M0–M3)

## 1. Perché

L'utente vuole due cose dal lavoro sui router del backend:

1. **Testare router e servizi con dipendenze finte** (servizi finti per i router, repository finti per i servizi). Per questo la regola del piano M0–M5 "niente mock, SQLite vero" cambia: i finti diventano lo strumento normale per router e servizi.
2. **Un collegamento fra moduli chiaro e uniforme.** Oggi convivono tre stili: router-factory (`createLoansRouter`, `createTransactionsRouter`), router-oggetto fisso che importa il proprio servizio (gli altri otto), e l'import dinamico di `analytics.routes.ts` (A-D7).

Poi, sopra questa base, il refactoring dei router emerso dall'analisi di qualità fatta su master (gruppi A-G3–A-G6, decisioni A-G7 all'utente; testo completo in `2026-11-02-router-analysis.md`, i cui identificativi si citano qui col prefisso `A-`).

## 2. Com'è oggi (fatti dal codice)

- `db/client.ts` **apre il database al momento dell'import**: crea le cartelle, applica il ripristino differito (`applyPendingRestore`), apre SQLite, imposta WAL, registra `lower_unicode` e `fold_search`, esporta `db`, `atomically`, `vacuum`, `vacuumInto`, `databaseSchema`, `runMigrations`, `closeDatabase`.
- Ogni repository importa `db`; diversi servizi importano `atomically`; `backup.service` e `reset.service` importano le funzioni di manutenzione. Quindi **qualunque import di un router, servizio o repository apre il DB**: è la causa dei test che toccano il DB reale (A-G0) e rende impossibile un servizio con repository finto senza aprire comunque il DB.
- I servizi sono singleton di modulo e si chiamano fra loro direttamente: `transactions.service → merchantsService`, `merchants.service → categoriesService, transactionsService` (ciclo già esistente), `cash-flow → loans, settings`, `dashboard → loans, merchants, summary`, `summary → loans`, `import → merchants, transactions`.
- Radici di composizione già presenti: `app.ts` (`createApp`, che collega già prestiti↔movimenti via `TransactionDependents`), `bootstrap.ts` (migrazioni, backup pre-migrazione, backfill dei fingerprint), `main.ts` (avvio, `startServer` con dipendenze già iniettate, `closeDatabase`).
- I test (≈45 file su DB) impostano `DATABASE_FILE` su un file temporaneo **prima** degli import dinamici, poi `runMigrations()` e `closeDatabase()`. I test HTTP esistenti montano `createApp()` sul DB temporaneo.
- Suite attuale: 939 test backend verdi; frontend 77 file.

## 3. Obiettivi, non obiettivi, anti-obiettivi

**Obiettivi**
- Nessun modulo apre il DB al momento dell'import. Il DB si apre in un punto esplicito dell'avvio e si passa in giù.
- Ogni repository, servizio e router si costruisce con una factory che riceve le sue dipendenze; i collegamenti fra feature avvengono solo nelle radici di composizione.
- Contratti HTTP fissati da test (A-T-A, A-T-B, A-T-C) prima del cambio di architettura, e verdi senza modifiche dopo.
- Test unitari di router e servizi con finti, scritti con `mock` di `node:test`.
- Refactoring dei router A-G3–A-G6; A-G7 solo su decisione dell'utente.

**Non obiettivi**
- Contenitori DI, decoratori, librerie nuove (anche per i mock: basta `node:test`).
- Cambiare comportamento o contratti HTTP durante l'iniezione (fasi 1–3): stessi status, corpi e messaggi.
- Toccare il frontend.

**Anti-obiettivi** (il lavoro fallisce anche se "funziona")
- Test con i finti che sostituiscono i test su SQLite vero per repository e query: i bug di M1–M3 (accenti, `lower`, vincoli, migrazioni) erano lì, e un finto non li vedrebbe.
- Mock che replicano la logica che dovrebbero isolare, o test che verificano solo che un finto sia stato chiamato senza fissare un comportamento osservabile.
- Rompere l'ordine dell'avvio: il ripristino differito deve restare applicato **prima** che esista qualunque connessione.
- Un periodo lungo in cui convivono il vecchio e il nuovo stile.

## 4. Approcci considerati

| | Approccio | Pro | Contro |
|---|---|---|---|
| A | Prima le factory in tutti i moduli, poi i test, poi il refactoring | lineare | il cambio più rischioso avviene con la rete più debole: molti test esistenti costruiscono i servizi direttamente e vanno riscritti insieme |
| **B** | **Prima i test di contratto HTTP (scatola nera), poi l'iniezione livello per livello, poi i test con i finti, poi il refactoring** | la rete non dipende dalla struttura interna e protegge davvero il cambio di architettura | i mock arrivano dopo i contratti |
| C | Un modulo alla volta, dall'iniezione al refactoring | consegne piccole | il cambio del DB va fatto comunque per primo e tocca tutti; stili misti per molto tempo |

**Scelta dell'utente: B.**

## 5. Il design

### 5.1 Fasi

**Fase 0 — Isolamento dei test (A-G0).** Nessun test può aprire `data/database.sqlite`. Con il DB ancora aperto all'import serve un preload che imposti `DATABASE_FILE` su un file temporaneo per ogni processo di test (tocca lo script `test:backend` in `package.json`: autorizzato esplicitamente dall'utente il 02/11/2026). Un test verifica che il DB reale non venga creato né modificato. Diventa superfluo alla fine della fase 2, ma resta come rete.

**Fase 1 — Contratti HTTP (A-G1 + A-G2 = A-T-A, A-T-B, A-T-C).** Esiti attesi = comportamento osservato oggi, compresi i difetti (A-D1, A-D3, A-D5, A-D8) che i test fissano esplicitamente con un commento che rimanda ad A-G7. Dove M3 ha già cambiato un esito rispetto all'analisi (es. 409 su `PATCH /transactions/:id/type` per D9, `merchantCount` di «Da classificare» per D3.b), vale il comportamento attuale.
- A-T-A usa un'app Express minima con l'error handler, senza DB.
- A-T-B e A-T-C passano da **un solo aiutante di test** (es. `test-support/http-app.ts`: `startTestApp()` che restituisce `baseUrl` e `close`). Oggi l'aiutante imposta il DB temporaneo e chiama `createApp()`; in fase 2 cambia solo il suo interno. **I file di test A-T-B/A-T-C non si modificano durante la fase 2**: è il criterio che rende la rete significativa.
- I messaggi Zod (A-D5) dipendono dalla versione di Zod: annotarlo nel test.

**Fase 2 — Iniezione, dal basso verso l'alto.** Un livello per volta, ogni passo con suite completa verde e i test di fase 1 invariati:
1. **Database.** `db/client.ts` diventa `openDatabase(options)` → un oggetto `Database` (`db`, `atomically`, `vacuum`, `vacuumInto`, `schema()`, `runMigrations()`, `close()`), che registra `lower_unicode` e `fold_search`. `ensureDataDirectories` e `applyPendingRestore` vengono chiamati da `openDatabase` stesso, prima di aprire il file, così l'ordine resta impossibile da invertire. `main.ts` apre il DB e lo passa a `bootstrap` e a `createApp`; `closeDatabase` diventa `database.close()`.
   - *Scelta del lead:* il DB si apre **come primo passo della fase `bootstrap` di `startServer`**, così un errore di apertura o di ripristino differito passa dalla gestione delle fasi già esistente (`StartupFailedError`, il DB non si chiude se il bootstrap non è riuscito). Criterio: log ed exit code d'avvio identici a oggi, e i test runtime (`runtime.test.ts`, `restore.runtime.test.ts`, `server*.test.ts`, `shutdown*.test.ts`) verdi **senza modifiche alle asserzioni**. Se un messaggio d'avvio dovesse cambiare, ci si ferma e si chiede all'utente.
2. **Repository.** `createXRepository(database)`.
3. **Servizi.** `createXService(deps)`, dove `deps` contiene i repository e, quando servono, `atomically` e i servizi di altre feature, tipizzati con interfacce minime (`Pick<…>` o porte come `TransactionDependents`). Il ciclo merchants↔transactions va rotto in questa fase (per esempio con una porta, come già fatto per prestiti↔movimenti).
4. **Router.** `createXRouter(service)` per tutti i router, sullo stile di `createLoansRouter`; sparisce l'import dinamico di analytics (A-D7).
5. **Composizione.** `createApp({ database, frontendDir })` costruisce repository → servizi → router e collega le feature; `bootstrap` riceve ciò che usa (backup, backfill). Spariscono gli export dei singleton di modulo e le istanze precostruite (`loansRouter`, `analyticsRouter`, …). Gli `index.ts` delle feature esportano factory e tipi.
   - *Scelta del lead, perimetro:* l'iniezione copre **tutto ciò che oggi tocca il DB**, non solo i router: i servizi di `maintenance` (backup, restore, reset) e i loro router, lo scheduler dei backup automatici (`createAutoBackupScheduler` riceve il servizio di backup), `shutdown.ts` (riceve la chiusura del `Database`), `server.ts`/`ServerDeps` dove serve. Senza questo l'obiettivo "nessun modulo apre il DB all'import" non si raggiunge.
- Questa fase è riorganizzazione: nessun cambio di comportamento. I test di servizio e repository esistenti si adattano solo nella costruzione (un aiutante `createTestDatabase()` che apre un DB temporaneo migrato), non nelle asserzioni.

**Fase 3 — Test con i finti.**
- **Router:** servizio finto (oggetti scritti a mano tipizzati con l'interfaccia del router, `mock.fn` dove serve contare le chiamate). Si fissano: parsing di query e body, status, forma della risposta, mappatura DTO, ordine dei controlli che vive nel router, traduzione degli errori del servizio in risposte.
- **Servizi:** repository e servizi di altre feature finti. Si fissano regole di dominio e orchestrazione (es. D9/D10, `atomically` invocato, conflitti), cioè ciò che oggi è provato solo passando dal DB.
- **Repository e query:** restano su SQLite vero, come oggi.
- I test di contratto della fase 1 restano come test end-to-end: pochi, sull'app intera.

**Fase 4 — Refactoring dei router (A-G3–A-G6).** Error handler (riconoscimento di body-parser, fallback 4xx con risposta invariata, `headersSent`, contesto nel log), virgolette di analytics (A-D11; A-D7 è già sparito in fase 2), `parseOrReject` per i 7 blocchi, spostamento nei servizi della composizione di categories PATCH e `currentState`, uso di `check.file`. Contratti invariati. Vale la lista "Non fare" dell'analisi (§8).

**A-G7** (messaggi di A-D1, A-D3, A-D5) resta una decisione dell'utente, fuori da questo lavoro salvo richiesta.

### 5.2 Regole di lavoro (dal piano M0–M5, aggiornate)
- Branch `refactor/router`; un commit per task; l'utente fa i merge. Stop alla fine di ogni fase per l'approvazione.
- Prima di ogni passo di fase 2: suite completa verde; dopo: suite ×5 verde e typecheck.
- Il DB reale non si apre mai in scrittura; solo copie in tmp.
- Nessuna libreria nuova. Le decisioni di dominio restano all'utente.
- **Regola cambiata:** "niente mock" non vale più per router e servizi; resta "SQLite vero" per repository, query, migrazioni e test end-to-end.

## 6. Lasciato al builder
- Nomi esatti di tipi, factory e file degli aiutanti di test.
- Ordine dei moduli dentro ciascun livello della fase 2 e granularità dei commit.
- Forma precisa delle porte per rompere il ciclo merchants↔transactions.
- Se i finti sono oggetti scritti a mano o `mock.fn`, caso per caso.
- Quali test di servizio esistenti, già coperti dai nuovi test con i finti, convertire o lasciare.
