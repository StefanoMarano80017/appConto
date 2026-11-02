# Rafforzamento dei test del backend (M0–M5) — Piano operativo

> **Per gli agenti esecutori:** SKILL RICHIESTA: `superpowers:subagent-driven-development` per eseguire il piano gruppo per gruppo; `superpowers:test-driven-development` dentro ogni task; `superpowers:verification-before-completion` prima di ogni dichiarazione di completamento; `superpowers:requesting-code-review` a fine milestone. Gli step usano le checkbox (`- [ ]`).

**Obiettivo:** rendere la suite del backend stabile e capace di intercettare gli errori che contano: calcoli finanziari, import CSV, integrità dei dati, contratti HTTP.

**Architettura:** nessuna modifica architetturale. Si resta su `node:test`, SQLite reale su file temporaneo e migrazioni vere. Ogni bug si riproduce prima con un test rosso, poi si applica la correzione minima. Le correzioni che cambiano la semantica di dominio sono **bloccate** finché non vengono approvate le decisioni del §4.

**Tech stack:** Node 24, TypeScript, `tsx --test`, `node:assert/strict`, better-sqlite3, Drizzle ORM, Express 5, zod, papaparse.

**Fonte:** l'assessment del 30/10/2026 (in conversazione), rianalizzato sul codice attuale nel §1.

**Stato:** v2 **approvata** il 30/10/2026.
- D1–D7 approvate, comprese D1.b, D1.c, D3.b e tutte le voci di D6;
- D7 approvata come "fine giornata";
- D8 resta fuori perimetro.

È autorizzata **solo M0**: ogni milestone successiva richiede un'approvazione esplicita.

**Decisioni prese all'avvio di M0 (30/10/2026):**
- **T0.2 resta aperto in questo piano** (decisione dell'utente, 30/10/2026, rivista in chiusura di M0). Il piano `docs/superpowers/plans/2026-10-30-backend-main-lifecycle.md` esclude esplicitamente `runtime.test.ts`: lo mette fra i file da non modificare (riga 16) e, nel design (riga 41), scrive che è "in carico al piano … m0-m5". T0.2 si riprende **dopo il merge di `refactor/backend-main-lifecycle`**, perché il nuovo percorso di arresto potrebbe cambiare la causa.
  - Fino ad allora un fallimento di `runtime.test.ts:278` (`SQLITE_IOERR_TRUNCATE`) è un **fallimento noto e tollerato** in tutte le verifiche `SUITE×5` di M0–M5 (§2). Va comunque registrato nel ledger a ogni occorrenza.
- **T5.5 anticipato in M0** (decisione dell'utente). L'instabilità di `backup.scheduler.test.ts:148`, osservata in 1 esecuzione su 5 della suite completa durante la chiusura di M0, è stabilizzazione della suite. M0 comprende quindi T0.1 e T5.5.
- **Esecuzione in worktree.** Ogni milestone gira in un worktree dedicato, `.claude/worktrees/<branch>` (già escluso da git tramite `.git/info/exclude`), creato con `superpowers:using-git-worktrees`, per non interferire con altre sessioni che usano la cartella principale. Due dettagli:
  - `node_modules` è una **junction** verso quella della cartella principale. `npm ci` nel worktree fallisce compilando `better-sqlite3`, e `runtime.test.ts:37` cerca `tsx` sotto la radice del worktree. Le dipendenze sono identiche a `master`.
  - Quando il worktree viene rimosso, la junction va eliminata **prima** e come collegamento, mai con una cancellazione ricorsiva. Procedura, da ripetere anche al momento di chiudere il branch (`finishing-a-development-branch`), dalla radice del worktree in PowerShell:
    1. verificare che `(Get-Item node_modules).LinkType -eq 'Junction'` restituisca `True`;
    2. `(Get-Item node_modules).Delete()`;
    3. verificare che `node_modules` non esista più nel worktree e che `C:\Users\stefa\Desktop\appConto\node_modules\tsx` esista ancora;
    4. solo a quel punto `git worktree remove`.
  - Se la cartella principale reinstalla le dipendenze, va riverificato che `package.json` e `package-lock.json` del branch siano identici a `master` (`git diff --quiet master -- package.json package-lock.json`).

---

## 0. Modifiche rispetto alla v1

1. **Agenti:** da ~33 implementatori a **24 gruppi**. Ho raggruppato solo dove il tema e i file coincidono:
   - prestiti T2.4 → T2.5 → T2.2;
   - transazioni T3.3 + T3.4;
   - piccoli test tabellari dell'import T1.4 + T1.5;
   - router HTTP per tema;
   - igiene dei file di test.
2. **Parallelismo rivisto.** La v1 parallelizzava task con file diversi, ma molti test d'integrazione importano moduli di produzione che un altro task sta modificando: l'import usa `csv-values`, `csv-parser` e `toAmountCents`; dashboard e cash-flow usano `loans`. Nuova regola nel §3.3. Di conseguenza in M1–M3 il parallelismo vero è minore, e il resto si ottiene sovrapponendo il lavoro: un implementatore lavora mentre i revisori del gruppo precedente leggono.
3. **Commit e skill.** `subagent-driven-development` vieta implementatori paralleli nello stesso albero di lavoro e prevede che sia l'implementatore a committare. Decisioni:
   - nei gruppi **sequenziali** l'implementatore committa;
   - nelle **ondate parallele**, ammesse solo per task di soli test o con moduli disgiunti, nessun agente committa: committa il lead, gruppo per gruppo, con i percorsi espliciti.
4. **Modelli rivisti.** Opus non viene più assegnato solo perché un task tocca codice di produzione. Vedi la colonna "Motivazione" nel §3.2.
5. **Verifiche:** quattro classi di rischio (V1–V4) con gate obbligatori (§3.4):
   - rosso e verde documentati;
   - verifica di regressione con la correzione rimossa;
   - controllo del perimetro con `git diff --name-only`;
   - typecheck;
   - invarianti per i task finanziari.
6. **Invarianti aggiunti:**
   - continuità dei saldi su 12 mesi (T2.1);
   - stessi totali fra summary, analytics e dashboard (T2.3);
   - invarianza della liquidità e simmetria prestito/restituzione (T2.6);
   - andata e ritorno euro → centesimi su tutto un intervallo (T1.6);
   - andata e ritorno formato → importo (T1.2).
7. **Dipendenze prima non esplicite:**
   - T2.6 dipende da T2.5: senza il vincolo D4, lo stesso accredito collegato due volte renderebbe negative le entrate;
   - T2.6 dipende da T2.1 (stesso file);
   - T3.2 va prima di T3.1, perché la nuova migrazione cambierebbe il DB su cui girano i test dei vincoli;
   - le M4 sui router dipendono dalle correzioni di M1–M3.
8. **Conflitti risolti:**
   - `loans.service.test.ts` compariva sia in T5.2 sia in T5.3: ora è solo in T5.3;
   - `import.test.ts` e `transactions.search.test.ts` comparivano sia in T5.1 sia in T5.2: ora sono nello stesso gruppo G5-A.
9. **Decisioni:**
   - D1 e D2 hanno una mappa degli effetti per vista, contratto e frontend;
   - D3 ha un sottopunto sul contatore della riga "Da classificare";
   - nuova D7, la semantica della data del saldo;
   - nuova D8, segnalata: rimborsi importati come entrate;
   - D6 ha due voci in più.
10. **Impatto sui dati reali**, misurato in sola lettura (§1).

---

## 1. Rianalisi: cosa è cambiato e cosa è confermato

**Repository:** il branch `fix/analytics-tests` è stato unito in `master` (PR #5, `b80a914`). Fra `a83b52d` e `HEAD` cambiano solo `analytics.mapper.ts` e `analytics.query.ts`, cioè le modifiche già esaminate come non committate nell'assessment. File non tracciati: `.vscode/` e questo piano.

**Impatto sui dati reali** (`data/database.sqlite`, sola lettura, 982 movimenti dal 2019-12-09 al 2026-10-15):

| Criticità o decisione | Cosa cambia sul tuo DB |
|---|---|
| A1 (data del saldo `2025-08-01`) | 453 movimenti cadono entro la data del saldo. Tutti i mesi da dicembre 2019 ad agosto 2025 mostrano oggi saldi iniziale e finale errati. Ad agosto 2025 l'errore è di 135,38 € (i movimenti del 1° agosto) |
| D1 (rimborsi su `EXPENSE`) | Nessun movimento `EXPENSE` positivo: **nessun valore cambia oggi** |
| D2 (restituzioni) | 2 restituzioni, entrambe in contanti: **nessun valore cambia oggi** |
| D3 ("Da classificare") | 22 merchant con `null`, 0 sulla riga reale: la migrazione è una no-op |
| D4 / D5 (prestiti) | 2 prestiti, entrambi con origine negativa; nessuna restituzione collegata: nessuna bonifica |
| D6.5 (nomi delle categorie) | Nessun nome duplicato a meno di maiuscole e minuscole |

**Criticità confermate sul codice attuale**

| ID | Criticità | Dove | Verifica |
|---|---|---|---|
| A1 | Saldi del cash-flow mensile errati quando la data del saldo cade dentro o dopo il mese | `cash-flow.service.ts:62-136` (`carriedCents` è vuoto se `balanceDate ≥ inizio mese`; `totals` prende il mese intero) | lettura + script |
| A2 | `escapeLike` produce il testo letterale `${character}` e non fa l'escape di `\` | `shared/sql.ts:14-16` | eseguito |
| A2b | Test tautologici che lo mascherano | `transactions.search.test.ts:241-242`, `loans.service.test.ts:670` | lettura |
| A3 | Data con ora → `null`; `'1,234,567'` → `null`; `'-120,00-'` → `120`; `'31/12/99'` → 2099; ISO non ancorata; errori di Papa ignorati | `csv-values.ts:14-70`, `csv-parser.ts:24-35` | eseguiti |
| A4 | "Da classificare" ha due rappresentazioni | `categories.service.ts:94` contro `transactions.repository.ts:103`, `merchants.service.ts:154,161`, `analytics.query.ts:182-185`, `summary.service.ts:74` | lettura |
| A5 | Restituzione validata solo sul segno; origine `LOAN` positiva accettata (`Math.abs`) | `loans.service.ts:63,131-144,479` | lettura |
| A6 | Test instabili | `backup.service.test.ts:231`, `runtime.test.ts:278` | 3 esecuzioni rosse su 9 |
| M1 | Rimborsi trattati in modo diverso fra le viste; `percentChange` con mese precedente ≤ 0 | `summary.service.ts:92`, `analytics.aggregation.ts:183`, `dashboard.service.ts:157,202` | lettura |
| M3 | `Math.round(x*100)` duplicato in 3 punti (`1.005` → 100) | `transaction.model.ts:57`, `cash-flow.service.ts:18`, `settings.repository.ts:25` | lettura |
| M4 | `lower()` di SQLite tratta solo l'ASCII; ordinamento per merchant sensibile a maiuscole e minuscole | `transactions.repository.ts:115-119,136` | script |
| — | Restituzione bancaria contata come entrata e come aumento di patrimonio | `cash-flow.service.ts:103-106`, `summary.service.ts:55`, `analytics.aggregation.ts:76` | lettura → D2 |

**Non è un bug:** `'STORNO PRELIEVO'` positivo → `WITHDRAWAL` è la base dei "prelievi al netto degli storni" (`6b2082f`). Va fissato con un test.

---

## 2. Vincoli globali

- **Perimetro:** solo `apps/backend/**` e questo piano. Due eccezioni, da approvare: `docs/architecture/data-model.md` (se D2 o D3 cambiano la semantica) e il `package.json` di root (T5.4). Il frontend non si tocca.
- **Strumenti:** `node:test`, `node:assert/strict` e SQLite reale su file temporaneo (`DATABASE_FILE` impostato prima degli `import` dinamici, poi `runMigrations()`). Nessuna nuova dipendenza e nessun framework di mock. `mock.timers` di `node:test` è ammesso, perché fa già parte del runner.
- **Nuovi file di test:** ognuno ha il proprio DB temporaneo e chiama `closeDatabase()` in `after`.
- **Test esistenti:** non si riscrivono quelli solidi; si modifica solo ciò che il task nomina.
- **Codice di produzione:** solo correzioni minime, legate a un test rosso. Niente refactoring estraneo.
- **Stile:** nomi dei test e commenti in italiano, nello stile dei file vicini; apici singoli.
- **Date nei test:** fisse, mai `new Date()` senza argomenti.
- **DB reale:** mai aperto in scrittura. Solo copie in `os.tmpdir()`.
- **Branch:** uno per milestone, da `master` (`test/m0-stabilita`, `test/m1-parsing`, `test/m2-dominio`, `test/m3-integrita`, `test/m4-http`, `test/m5-igiene`). Lo crea il lead all'avvio della milestone. Il merge in `master` lo fai tu.
- **Comandi di verifica** (dalla root del repo):

| Nome | Comando | Esito richiesto |
|---|---|---|
| `FILE` | `npx tsx --test <file di test…>` | `ℹ fail 0` |
| `TC` | `npm run typecheck:backend` | exit 0, nessun output di errore |
| `SUITE` | `npm run test:backend` | `ℹ fail 0` |
| `SUITE×5` | cinque esecuzioni di `npm run test:backend`, senza interrompersi al primo fallimento | cinque volte `ℹ fail 0`, con una sola eccezione: un fallimento di `runtime.test.ts:278` resta tollerato come noto finché T0.2 non è chiuso, e va registrato nel ledger |
| `PERIMETRO` | `git diff --name-only <BASE>..HEAD` (o `git status --porcelain` prima del commit) | solo file elencati nel task |

---

## 3. Orchestrazione

### 3.1 Modelli

Lo strumento `Agent` accetta un modello per ogni subagent. Uso `opus`, `sonnet` e `haiku`. `fable` è disponibile ma non lo uso, perché non ho elementi per collocarlo rispetto agli altri tre.

Criteri, ripresi da `subagent-driven-development`:
- **Haiku:** solo quando il task è completamente specificato (casi e valori nel brief) e tocca 1–2 file.
- **Sonnet:** la soglia minima per i revisori e per chi lavora da una descrizione in prosa. Un modello economico che impiega più turni costa di più.
- **Opus:** quando serve giudizio di dominio, debugging di un problema intermittente, una migrazione dati, una modifica trasversale, oppure come revisore di modifiche ai calcoli.

Il revisore è sempre un'istanza **nuova**, diversa dall'implementatore, anche quando usa lo stesso modello.

### 3.2 Gruppi di agenti

Legenda:
- **Impl. / Rev.:** modello dell'implementatore e del revisore;
- **Modo:** `S` = sequenziale, l'implementatore committa; `P` = ondata parallela, committa il lead;
- **V:** classe di verifica (§3.4).

| Gruppo | Task | Impl. | Rev. | Modo | V | Motivazione |
|---|---|---|---|---|---|---|
| **M0** | | | | | | |
| G0-A | T0.1 | haiku | sonnet | P | V1 | Due modifiche meccaniche e già specificate in un file di test |
| G0-B | T0.2 | opus | sonnet | — | V1 | **Rimandato** a dopo il merge di `refactor/backend-main-lifecycle`. Bug intermittente legato alla piattaforma: serve isolare la causa. Il diff atteso è piccolo e solo di test; un sonnet basta a giudicarlo, insieme alle 10 esecuzioni del lead |
| G0-C | T5.5 | sonnet | sonnet | S | V1 | **Anticipato da M5.** Scelta fra `mock.timers` e tolleranze; solo test |
| **M1** | | | | | | |
| G1-A | T1.2 | sonnet | **opus** | P | V3 | Importi e segni: un errore qui corrompe i dati importati in modo silenzioso |
| G1-B | T1.3 | sonnet | sonnet | P | V2 | Correzione circoscritta al parser |
| G1-C | T1.1 | sonnet | sonnet | S | V2 | Correzione di una riga più due test d'integrazione da riscrivere |
| G1-D | T1.4 + T1.5 | haiku | sonnet | S | V2 | Test tabellari già specificati sugli aiutanti dell'import; correzione di una riga |
| G1-E | T1.6 | sonnet | **opus** | S | V3 | Una regola di arrotondamento usata in tutta l'app: il rischio è sottile anche se il codice è breve |
| **M2** | | | | | | |
| G2-A | T2.1 | **opus** | **opus** | P | V4 | Il numero centrale dell'app, con una regola temporale da derivare |
| G2-B | T2.7 | haiku | sonnet | P | V1 | Solo test, con casi già specificati |
| G2-C | T2.4 → T2.5 → T2.2 | sonnet | **opus** | S | V3 | Stesso servizio e stesso file di test. Validazioni semplici, ma con somme fra prestiti e il caso "esclusa la restituzione in modifica" |
| G2-D | T2.3 | **opus** | **opus** | S | V4 | Una regola di dominio condivisa da 3 servizi |
| G2-E | T2.6 | **opus** | **opus** | S | V4 | Modifica semantica trasversale, con l'aggiornamento di test esistenti e della documentazione |
| G2-F | T2.8 | sonnet | sonnet | P | V2 | Aggiunto dall'utente dopo M1. Correzione circoscritta al parser, nella prima ondata con G2-A e G2-B: file disgiunti, e nessuno dei due gruppi importa il parser |
| **M3** | | | | | | |
| G3-A | T3.2 | sonnet | sonnet | P | V1 | Test sui vincoli, nessuna modifica di produzione prevista |
| G3-B | T3.3 + T3.4 | sonnet | sonnet | P | V1 | Due test d'integrazione dello stesso modulo |
| G3-C | T3.1 | **opus** | **opus** | S | V4 | Migrazione dati su DB reale più cambio di rappresentazione |
| G3-D | T3.5 | haiku | sonnet | S | V2 | Specificato; 2 file |
| G3-E | T3.6 | sonnet | **opus** | S | V3 | Tocca `db/client.ts`, quindi tutte le connessioni |
| G3-G | T3.9 → T3.10 | sonnet | **opus** | S | V3 | Coda di M3: D11 e D12. Toccano entrambi `transactions.repository.ts`, quindi in sequenza |
| G3-H | T3.11 + T3.12 | haiku | sonnet | P | V2 | Coda di M3: modifiche piccole e già specificate, file disgiunti da G3-G |
| G3-F | T3.7 → T3.8 | sonnet | **opus** | S | V3 | Aggiunto dopo le decisioni D9 e D10. Regole semplici, ma toccano la porta fra `transactions` e `loans` e test esistenti. Va per primo: `transactions.service` è importato dai test di G3-B |
| **M4** | | | | | | |
| G4-A | T4.1 + T4.6 | sonnet | sonnet | P | V1 | Errori di richiesta (400, 413, 500) |
| G4-B | T4.2 + T4.7 | sonnet | sonnet | P | V1 | Rotte che modificano categorie, merchant e transazioni |
| G4-C | T4.3 + T4.5 | sonnet | sonnet | P | V1 | Validazione degli importi via HTTP (prestiti, saldo iniziale) |
| G4-D | T4.4 | sonnet | sonnet | S | V1 | 4 router di sola lettura con la stessa forma: un unico brief |
| **M5** | | | | | | |
| G5-A | T5.1 + T5.2 + T5.4 | haiku | sonnet | P | V1 | Modifiche meccaniche già elencate riga per riga |
| G5-B | T5.3 | sonnet | sonnet | P | V1 | Spostare la preparazione dei dati richiede attenzione all'ordine |
| ~~G5-C~~ | ~~T5.5~~ | | | | | Spostato in M0 come G0-C |

In totale sono **24 implementatori**, 24 revisioni di gruppo e **6 revisioni `opus` di fine milestone**. Delle revisioni di gruppo, 8 sono `opus` (G1-A, G1-E, G2-A, G2-C, G2-D, G2-E, G3-C, G3-E) e le altre `sonnet`. Gli implementatori `opus` sono 5 (G0-B, G2-A, G2-D, G2-E, G3-C).

**Cosa non si raggruppa, e perché:**
- T2.3 e T2.6 restano separati: sono due decisioni di dominio diverse e ognuna merita una revisione a sé.
- T3.1 e T3.5 restano separati: il primo è una migrazione da opus, il secondo un compito da haiku.
- T1.6 resta separato da T1.2: tocca un punto usato ovunque e la sua revisione deve concentrarsi solo su quello.

### 3.3 Parallelismo (al massimo 3 subagent attivi)

**Regola di parallelismo nello stesso albero di lavoro.** Due gruppi possono girare insieme solo se valgono entrambe le condizioni:
1. i file modificati sono disgiunti;
2. nessuno dei due modifica un modulo di produzione importato, anche indirettamente, dai test dell'altro.

Dove la condizione 2 non vale, si procede in sequenza.

**Sovrapposizione.** Il revisore del gruppo N, che legge solo un file di diff, può lavorare mentre l'implementatore del gruppo N+1 è attivo. Il totale resta di 3 subagent.

**Ondate parallele (modo `P`):**
- gli agenti non eseguono comandi git che scrivono;
- eseguono solo i propri `FILE` e non `SUITE`, perché vedrebbero il lavoro incompleto degli altri;
- a fine ondata il lead esegue `TC` e `SUITE`;
- poi committa ogni gruppo separatamente (`git add <percorsi del gruppo>`) e genera il pacchetto di revisione di quel commit.

**Albero di lavoro separato (`isolation: "worktree"`): non lo uso.** Un albero separato non ha `node_modules`, e verificarlo richiederebbe di avviare agenti, cosa esclusa in questa fase. Se servirà più parallelismo, lo proporrò con una prova dedicata.

### 3.4 Gate di verifica per ogni gruppo

Nessun gruppo è chiuso finché il lead non ha l'**output effettivo** dei comandi. La dichiarazione dell'agente non basta.

| Gate | V1 (solo test) | V2 (produzione circoscritta) | V3 (produzione delicata) | V4 (dominio finanziario o migrazione) |
|---|---|---|---|---|
| a. Rosso con il motivo previsto, output nel report | ✓ (oppure "passa subito": test che documenta un comportamento esistente) | ✓ | ✓ | ✓ |
| b. Verde: `FILE` | ✓ | ✓ | ✓ | ✓ |
| c. `TC` | ✓ | ✓ | ✓ | ✓ |
| d. `PERIMETRO`: nessun file fuori elenco | ✓ | ✓ | ✓ | ✓ |
| e. Verifica di regressione | — | ✓ ¹ | ✓ ¹ | ✓ ¹ |
| f. Regressione del modulo: tutti i test del modulo e dei suoi utilizzatori diretti ² | — | ✓ | ✓ | ✓ |
| g. `SUITE` | fine ondata | ✓ | ✓ | ✓ |
| h. Invarianti (indicati nel task) | — | — | dove indicati | ✓ obbligatori |
| i. Revisione del diff con verdetto su specifica **e** qualità | sonnet | sonnet | opus | opus |
| j. Lettura del diff da parte del lead | a campione | ✓ | ✓ | ✓, riga per riga |
| k. Prova su una copia del DB reale | — | — | — | ✓ se c'è una migrazione |

¹ La verifica di regressione la esegue il lead:
1. annulla temporaneamente la sola correzione di produzione (`git diff <BASE> HEAD -- <file di produzione> | git apply -R`);
2. esegue `FILE`, che **deve fallire**;
3. ripristina la correzione (`git apply`);
4. esegue di nuovo `FILE`, che deve essere verde.

² Gli utilizzatori diretti sono i file di test che importano il modulo modificato, ricavati con `grep -rl "<modulo>" apps/backend/src --include=*.test.ts`.

### 3.5 Ciclo di un gruppo

1. **Apertura della milestone.** Il lead:
   - crea il branch;
   - inizializza il ledger con `scripts/sdd-workspace`, che scrive in `.superpowers/sdd/…/progress.md`, cartella già esclusa da git;
   - esegue la scansione dei conflitti di `references/preflight.md` sui gruppi della milestone. La tabella e le decisioni vanno nel ledger.
2. **Brief.** Il lead estrae il brief di ogni task con `scripts/task-brief`. Il prompt di avvio contiene:
   - il percorso del brief;
   - le interfacce prodotte dai task precedenti;
   - i file modificabili e quelli vietati;
   - la classe di verifica;
   - il percorso del file di report.
3. **Implementazione.** L'implementatore lavora in TDD e scrive il report su file:
   - rosso e verde, con l'output incollato;
   - i file toccati;
   - le scelte fatte;
   - i dubbi.

   Non avvia altri subagent.
4. **Revisione.** Il lead genera il pacchetto con `scripts/review-package <piano> <BASE> <HEAD>` e avvia il revisore, che riceve brief, report, pacchetto e i vincoli del §2.
5. **Correzioni.** Si segue `references/fix-loop.md`, che il lead rilegge prima di ogni giro e che fissa il numero massimo di giri. La gestione delle eccezioni segue `references/handling-reports.md`.
6. **Chiusura.** Il lead esegue i gate del §3.4 e scrive la riga di chiusura nel ledger.

**Stop obbligatori** (si riporta a te, senza decidere):
- è necessaria una decisione di dominio non prevista;
- un task di soli test rivela un bug di produzione: diventa un nuovo task, da approvare;
- violazione del perimetro;
- una migrazione si comporta in modo inatteso sulla copia del DB;
- si raggiunge il limite di giri della correzione su un rilievo Critical.

**Due deviazioni da `subagent-driven-development`, volute:**
- la skill chiede di non fermarsi mai: qui ci si ferma **a fine milestone** per la tua approvazione;
- la skill chiede di decidere in autonomia le ambiguità: le **decisioni di dominio** restano tue.

### 3.6 Chiusura di una milestone

1. `SUITE×5` verde, con l'output conservato nel ledger.
2. `TC` verde.
3. Revisione `opus` dell'intero diff della milestone (`git diff master...HEAD`), seguendo `requesting-code-review` e `references/final-review.md`: un solo giro di correzioni.
4. Verifica dei requisiti: si rilegge ogni task e si spunta ogni checkbox con la prova accanto. Se manca una prova, la checkbox resta vuota e la milestone non è chiusa.
5. Riepilogo a te, poi attesa del tuo ok prima della milestone successiva:
   - modifiche fatte;
   - test aggiunti;
   - output delle verifiche;
   - problemi residui;
   - aggiornamento del §9.

---

## 4. Decisioni che richiedono la tua approvazione

**I gruppi che dipendono da una decisione non partono senza approvazione.** Per ogni decisione indico gli effetti sui servizi, sul contratto HTTP e sul frontend.

### D1 — Rimborsi (`EXPENSE` con importo positivo) — blocca G2-D

**Oggi:**
- I totali sono **netti** (`expenseCents` = `-amountCents`).
- Le categorie con netto ≤ 0:
  - **summary** e **analytics** le mostrano con segno negativo e percentuale negativa;
  - la **dashboard** le scarta.
- `percentChange` gestisce solo il mese precedente pari a 0.
- Sui tuoi dati non c'è nessun rimborso `EXPENSE`.

**Opzioni:**

| | Contenuto | Contratto HTTP | Frontend |
|---|---|---|---|
| A | Netto ovunque; categorie negative mostrate ovunque, dashboard compresa | invariato | deve gestire importi e percentuali negativi in dashboard: fuori perimetro |
| **B (raccomandata)** | Totali netti; in ogni **distribuzione** (classifica o percentuale) restano solo le voci con netto > 0; la base delle percentuali è la somma delle voci positive; `percentChange = null` se il mese precedente è ≤ 0 | invariato (cambiano righe e valori) | nessuna modifica; meno righe nelle classifiche |
| C | Totali lordi più una voce "rimborsi" | nuovi campi | nuove viste: fuori perimetro |

**Effetti di B per vista:**

| Vista | Cosa cambia | Cosa resta |
|---|---|---|
| summary | `amountByCategory` senza le voci ≤ 0 | `expenses`, `balance` e `uncategorized.amount` restano netti e possono essere negativi |
| analytics | `byCategory` e `byMerchant` senza le voci ≤ 0; percentuali sulla somma delle voci positive | `overview.expenses`, `balance` e la serie della timeline restano netti |
| dashboard | `topCategories`: la base delle percentuali diventa la somma delle voci positive (oggi è `summary.expenses`); `percentChange` è `null` se il mese precedente è ≤ 0 | `summary.expenses` resta netto |
| cash-flow | nulla (non ha distribuzioni) | |

*Nota di esecuzione (M2, T2.3):* in dashboard le quote delle prime cinque categorie sono calcolate sulla somma di **tutte** le categorie positive, come dice la riga qui sopra. Con più di cinque categorie le quote mostrate sommano quindi a meno di 100. Un test lo fissa (7 categorie → 5 voci, somma 86).

**Sottodecisioni:**
- **D1.b:** in un mese di soli rimborsi, il totale delle uscite resta **netto e negativo** (−30), oppure va fermato a 0? Raccomando di lasciarlo netto: è il dato vero, e fermarlo a 0 renderebbe falsi saldo e patrimonio.
- **D1.c:** la regola si applica anche a `byMerchant` di analytics. Raccomando sì, per coerenza.

### D2 — Restituzione di un credito contro entrata ordinaria — blocca G2-E

**Oggi:** la Transaction collegata a una restituzione resta `INCOME` (`data-model.md:166`), quindi entra nelle entrate e nel patrimonio. Il movimento `LOAN` d'origine invece **non** aveva ridotto il patrimonio, perché era credito. L'effetto è asimmetrico: presto 80, me ne restituiscono 50 in banca, il patrimonio sale di 50.

**Opzioni:**

| | Contenuto | Coerenza con il modello dati |
|---|---|---|
| A | Lasciare com'è; aggiungere solo test e documentazione dell'asimmetria | Coerente con `data-model.md` com'è scritto, ma il patrimonio non è corretto |
| **B (raccomandata)** | Il tipo resta `INCOME`, ma la quota collegata a restituzioni (`repaidCents`) non entra né nelle entrate né nel patrimonio. È lo schema speculare a `lentCents`: `loans` fornisce i centesimi per Transaction e `transactions` li riceve come parametro, così la dipendenza resta `loans → transactions` | Coerente con il principio "il collegamento non trasforma il movimento"; corregge l'asimmetria. Va aggiornato `data-model.md` |
| A' (scartata) | Contare l'uscita `LOAN` come calo del patrimonio e la restituzione come aumento | Contraddice la regola documentata "la quota di credito non è spesa" |
| C (scartata) | Un nuovo tipo `LOAN_REPAYMENT` | Migrazione dell'enum e frontend |

**Mappa degli effetti di B**, sullo scenario: prestito di 80 (movimento −80), restituzione di 50 collegata a un accredito +50, restituzione di 10 in contanti.

| Vista | Campo | Oggi | Con B |
|---|---|---|---|
| cash-flow | `income` | 50 | **0** |
| cash-flow | `netWorthChange` | +50 | **0** |
| cash-flow | `netMovement`, `closingBalance` (liquidità) | −30 | −30 (invariato) |
| cash-flow | `byType` (`INCOME` 50, `LOAN` −80: liquidità per tipo) | invariato | invariato ³ |
| cash-flow | `expenses` | 0 | 0 |
| summary | `income` / `balance` | 50 / 50 | **0 / 0** |
| analytics | `overview.income` / `overview.balance`, serie delle entrate nella timeline | 50 | **0** |
| analytics | `overview.netMovement` | −30 | −30 |
| analytics | sezione `loans.lent` | 80 | 80 |
| dashboard | `summary.income` / `balance` | 50 | **0** |
| dashboard | blocco prestiti (crediti, rientrato) | invariato | invariato |
| pagina prestiti | residuo, rientrato | 20 da ricevere, 60 rientrati | invariato |
| lista transazioni | tipo e filtro `INCOME` | invariato | invariato |

³ Raccomando che `byType` resti la ripartizione della **liquidità**. Altrimenti la somma di `byType` non sarebbe più uguale a `netMovement`.

**Contratto HTTP e frontend:** nessun campo nuovo o rimosso; il frontend non va modificato. Cambia però il significato di "Entrate": non comprende più le restituzioni collegate. Un campo `repayments` nel cash-flow sarebbe un'aggiunta al contratto: **non è nel piano** e richiederebbe una decisione a parte.

**Casi limite da fissare nei test di G2-E:**
- accredito di 70 con 50 collegati → `income` 20;
- restituzione collegata a un accredito di un mese diverso da quello del prestito → l'esclusione avviene nel mese dell'accredito;
- scollegare la restituzione → l'entrata torna;
- restituzione bancaria **non** collegata → resta un'entrata. È responsabilità di chi usa l'app collegarla; segnalarla in dashboard sarebbe un'altra funzione, non pianificata.

**Dipendenze:**
- B richiede D4, altrimenti un accredito collegato più volte farebbe scendere le entrate sotto zero;
- per prudenza `repaidCents` viene comunque limitato all'importo del movimento.

**Sui tuoi dati:** nessun valore cambia oggi (2 restituzioni, entrambe in contanti).

### D3 — "Da classificare": `null` o riga reale — blocca G3-C

**Oggi:**
- i merchant nuovi nascono con `null`;
- `remove` di una categoria li sposta sulla riga reale;
- si può assegnare a mano la riga reale;
- tutti i filtri e i conteggi usano `null`;
- il frontend usa `classification: 'unclassified'` per il filtro e mostra le voci con `categoryId: null` come "Da classificare".

**Opzioni:**

| | Contenuto | Servizi | Contratto / frontend |
|---|---|---|---|
| **A (raccomandata)** | `null` è l'unica rappresentazione. `remove` riassegna a `null`. `assignCategory(fallbackId)` diventa `null`. Una migrazione idempotente riporta a `null` i merchant sulla riga reale. La riga resta come etichetta | categories, merchants, migrazione `0009` | contratto invariato; il frontend non va modificato (la finestra di eliminazione dice "verranno spostati su «Da classificare»", che resta vero) |
| B | La riga reale è l'unica rappresentazione | più di 6 controlli su `null`, oltre a DTO, filtri e conteggi | il DTO oggi espone `category: null`: tocca il frontend |
| C | Entrambe le forme valgono come "non classificato" | ogni query | fragile |

**D3.b (nuova):** con A, l'API delle categorie mostrerebbe sempre `merchantCount: 0` per "Da classificare", come già oggi sul tuo DB, mentre i merchant non classificati sono 22. Propongo che per quella riga il conteggio sia il numero di merchant con `null`. Cambia un valore, non la forma della risposta. Va confermato perché è visibile nella pagina categorie.

### D4 — Capienza del movimento di restituzione — blocca G2-C (T2.5)

La somma delle restituzioni collegate alla stessa Transaction non può superare il suo importo. Il vincolo vale anche fra prestiti diversi: un solo bonifico che ripaga due prestiti resta lecito se basta a coprirli. È la regola speculare a quella già in vigore per l'origine (`assertFitsTransaction`), e vale anche per la modifica di una restituzione. **Raccomandata.**

### D5 — Origine del prestito positiva — blocca G2-C (T2.4)

Si rifiuta con `ValidationError` un prestito su un movimento `LOAN` con importo ≥ 0, coerentemente con `data-model.md`. **Raccomandata.**

### D6 — Scelte minori (da confermare in blocco) — bloccano i gruppi indicati

1. **Anni a due cifre:** soglia 70 (`00–69` → 20xx, `70–99` → 19xx), indipendente dall'orologio. *(G1-A)*
2. **Date con l'ora:** accettate, con l'ora ignorata. *(G1-A)*
3. **Importi:** `'-120,00-'` → `null`; `'12,50 EUR'` e `'EUR -12,50'` accettati; `'(12,50)'` → `null`; `'1,234'` → `1.234`. *(G1-A)*
4. **CSV malformato:** con virgolette non chiuse si rifiuta **l'intero file** con un errore che indica la riga. *(G1-B)*
5. **Nomi delle categorie:** unicità senza distinzione fra maiuscole e minuscole, controllata nel service. *(G3-D)*
6. **Ricerca e ordinamento:** funzione SQLite `lower_unicode` registrata in `db/client.ts`. *(G3-E)*
7. **Script `test:coverage`:** nel `package.json` di root. *(G5-A)*
8. **Arrotondamento euro → centesimi:** a metà, lontano da zero e simmetrico (`1.005` → 101, `-1.005` → −101). *(G1-E)*
9. ~~**`FieldMismatch` di Papa:** si rifiuta il file solo se non compare nei campioni reali di `samples/`; altrimenti si rifiutano solo gli errori di virgolette.~~ **Rivista dall'utente il 30/10/2026, durante M1:** si rifiuta il file **solo** per errori di virgolette (`Quotes`). Le righe con campi in più o in meno restano accettate come prima: quelle senza data o importo validi finiscono già fra le righe scartate e segnalate dall'import.
   - Motivo: la revisione di T1.3 ha mostrato che rifiutare `FieldMismatch` bloccava file bancari plausibili (`;` finale solo sui dati, riga "Saldo finale", colonna vuota in più nell'intestazione).
   - Il messaggio d'errore è interamente in italiano: "Il file CSV ha virgolette non chiuse alla riga N.", con N contato da 1 e intestazione compresa. *(G1-B)*
   - **Precisata dall'utente il 30/10/2026, dopo la revisione di fine M1:** "errori di virgolette" significa **virgolette non chiuse**, cioè il codice Papa `MissingQuotes`, che inghiotte le righe successive. Le virgolette interne non raddoppiate (`"BAR "SPORT" ROMA"`, codice `InvalidQuotes`), che Papa legge correttamente e che prima di M1 si importavano, restano accettate.
  - **Estesa dall'utente il 30/10/2026, all'approvazione di M2:** si rifiuta anche un `InvalidQuotes` la cui riga ha un campo con un a capo, perché è il segno di due righe fuse. → T2.8

### D7 — Significato della data del saldo (nuova) — blocca G2-A

Il codice tratta il saldo come valido **a fine giornata** di `balanceDate`: i movimenti di quel giorno sono già compresi (`date > balanceDate` in `cash-flow.service.ts:74`). La correzione di A1 deriva da questa regola.

Sul tuo DB i movimenti del 1° agosto 2025 valgono −135,38 €. Se invece il saldo che hai inserito è quello **di inizio giornata**, la regola va ribaltata (`date ≥ balanceDate`) e i saldi cambiano di conseguenza.

**Raccomando di confermare "fine giornata":** è la regola già in uso nella vista completa, e cambiarla toccherebbe anche quella.

### D8 — Rimborsi importati come entrate (segnalata, nessun task)

Il resolver assegna `INCOME` a ogni importo positivo senza indizi. Un rimborso di un negozio arriva quindi come entrata e non riduce le uscite, salvo correzione a mano del tipo. Lo segnalo perché tocca D1, ma è una funzione nuova (riconoscere i rimborsi) e resta **fuori da questo piano**.

### D9 — Restituzioni solo su movimenti in entrata (decisa dall'utente il 30/10/2026, dopo M2) — G3-F (T3.7)

Una restituzione si può collegare solo a un movimento `INCOME` con importo positivo. Così l'esclusione D2 copre tutti i movimenti collegati, e il punto aperto di `data-model.md` si chiude.

Conseguenza applicata dal lead: un movimento collegato a restituzioni non può essere riclassificato in un tipo diverso da `INCOME`. Altrimenti la regola si aggirerebbe cambiando il tipo dopo il collegamento. L'errore va dato con la stessa porta `TransactionDependents` già usata per l'eliminazione, senza che `transactions` importi `loans`. Sul DB reale non ci sono restituzioni collegate: nessuna migrazione.

### D10 — Restituzione non anteriore al prestito (decisa dall'utente il 30/10/2026, dopo M2) — G3-F (T3.8)

La data di una restituzione non può essere precedente a `lentAt`; la stessa giornata è ammessa. Vale per la creazione e per la modifica di una restituzione.

Conseguenza applicata dal lead: anche la modifica di `lentAt` di un prestito non può spostarlo dopo la sua restituzione più vecchia. Sul DB reale nessuna restituzione è anteriore al prestito: nessuna migrazione.

**Lasciato com'è su decisione dell'utente:** la capienza (D4) si ricontrolla anche quando di una restituzione cambiano solo nota o data.

### D11 — Ricerca senza accenti (decisa dall'utente il 02/11/2026, dopo M3) — G3-G (T3.9)

La ricerca testuale di movimenti e prestiti ignora gli accenti oltre alle maiuscole: «caffe» trova «CAFFÈ ROMA», «caffè» trova «CAFFE». Il termine e la colonna passano dalla stessa funzione di normalizzazione (minuscolo, scomposizione NFD, rimozione dei segni diacritici), registrata in `db/client.ts` accanto a `lower_unicode`.

Ruling del lead: la decisione riguarda la ricerca. Ordinamento (`lower_unicode`, T3.6) e unicità del nome categoria (D6.5) restano come sono.

### D12 — Filtro per "Da classificare" = non classificati (deciso dall'utente il 02/11/2026, dopo M3) — G3-G (T3.10)

Un filtro per categoria che contiene l'id della riga "Da classificare" include i movimenti non classificati, con la stessa definizione del filtro `classification: 'unclassified'`, nei movimenti e nelle analisi. Con altri id nello stesso filtro le condizioni si sommano (OR).

### Frontend (autorizzato dall'utente il 02/11/2026, perché di piccola entità) — G3-H (T3.11)

- I candidati per collegare una restituzione sono solo movimenti `INCOME` positivi, coerentemente con D9.
- I due commenti superati da D1 in `dashboard.model.ts` vengono eliminati.

### Decisioni che potrebbero emergere durante l'esecuzione (ci si ferma e si riporta)

- Restituzione con data anteriore a `lentAt`: va vietata? *(G2-C, T2.2)*
- Eliminazione di un movimento collegato a una restituzione: oggi FK o 500? *(G3-B, T3.4)*
- Indici unici mancanti nelle migrazioni. *(G3-A)*
- Connessioni di restore e backup che eseguono ricerche senza `lower_unicode`. *(G3-E)*

---

## 5. Review Focus

Questi sono i casi che un utente incontra e che nessun test copre oggi. Ognuno è assegnato a un task.

1. **CSV con data e ora nella colonna data:** l'import funziona. → T1.2
2. **Cash-flow del mese che contiene la data del saldo, o di un mese precedente:** i saldi sono continui. → T2.1
3. **Ricerca di `%`, `_` o lettere accentate:** trova le righe giuste. → T1.1, T3.6
4. **Eliminazione di una categoria usata:** i merchant tornano "da classificare" in filtri e contatori. → T3.1
5. **Un accredito usato per più restituzioni:** non gonfia i crediti rientrati né, dopo D2, porta le entrate sotto zero. → T2.5, T2.6

---

## 6. Grafo delle dipendenze

```
Legenda: ∥ = in parallelo (stessa ondata)   → = in sequenza   [Dn] = richiede la decisione

M0   G0-A(T0.1) → G0-C(T5.5) ──► chiusura M0 (SUITE×5, revisione opus)
     G0-B(T0.2): rimandato a dopo il merge di refactor/backend-main-lifecycle
                                        │
M1   G1-A(T1.2)[D6.1-3] ∥ G1-B(T1.3)[D6.4,6.9]      ← moduli puri e disgiunti
        → G1-C(T1.1)                               ← i suoi test passano dall'import
        → G1-D(T1.4+T1.5)                          ← modifica il resolver usato dall'import
        → G1-E(T1.6)[D6.8]                         ← toAmountCents è usato da tutti
        ──► chiusura M1
                                        │
M2   G2-A(T2.1)[D7] ∥ G2-B(T2.7) ∥ G2-F(T2.8)[D6.9] ← T2.7 importa solo analytics.timeline; T2.8 solo il parser
        → G2-C(T2.4[D5] → T2.5[D4] → T2.2)         ← cash-flow e dashboard importano loans
        → G2-D(T2.3)[D1]
        → G2-E(T2.6)[D2]                           ← dopo T2.1 (stesso file), T2.3 (stessi servizi), T2.5 (vincolo D4)
        ──► chiusura M2 (+ controllo manuale sull'app)
                                        │
M3   G3-F(T3.7[D9] → T3.8[D10])                    ← regole delle restituzioni, decise dopo M2
        → G3-A(T3.2) ∥ G3-B(T3.3+T3.4)             ← solo test, prima della migrazione
        → G3-C(T3.1)[D3]                           ← migrazione 0009
        → G3-D(T3.5)[D6.5]                         ← stessi file di T3.1
        → G3-E(T3.6)[D6.6]                         ← db/client.ts, dopo T3.2
        ──► chiusura M3
                                        │
M4   G4-A(T4.1+T4.6) ∥ G4-B(T4.2+T4.7) ∥ G4-C(T4.3+T4.5)   ← solo test, file disgiunti
        → G4-D(T4.4)
        ──► chiusura M4
                                        │
M5   G5-A(T5.1+T5.2+T5.4)[D6.7] ∥ G5-B(T5.3)          (T5.5 spostato in M0)
        ──► chiusura M5
```

Le dipendenze **logiche** fra milestone sono queste. Ogni milestone vive su un suo branch partito da `master` dopo il tuo merge, per cui la sequenza dei merge le soddisfa.
- M4 verifica comportamenti corretti in M1 (T4.5 si basa su T1.6), M2 (T4.3 sui prestiti) e M3 (T4.2 e T4.7 sui duplicati e su "Da classificare").
- M5 rafforza asserzioni in file modificati da M1–M3.

---

## 7. Milestone e task

Ogni task indica i file (che sono anche il perimetro), il gruppo e i passi. Modello, revisore, modo e classe di verifica sono nel §3.2.

### M0 — Stabilizzazione della suite

**Criteri di accettazione** (rivisti dopo il rinvio di T0.2 e l'anticipo di T5.5):
- `SUITE×5` eseguita, con l'output nel ledger, **senza alcun fallimento** tranne l'eventuale `runtime.test.ts:278`, tollerato come noto (§2);
- `backup.service.test.ts` verde in 20 esecuzioni isolate consecutive;
- `backup.scheduler.test.ts` verde in 20 esecuzioni isolate consecutive e in 5 esecuzioni concorrenti con `SUITE` (carico reale);
- `PERIMETRO` = solo `backup.service.test.ts` e `backup.scheduler.test.ts`; nessun file di produzione;
- revisione `opus` della milestone senza rilievi Critical o Important aperti.

**Rischi:** se lo scheduler non accetta timer simulati (per esempio perché usa `Date.now()` insieme ai timer), T5.5 ripiega sulle tolleranze, e queste non devono indebolire ciò che il test verifica. Il rischio di T0.2 (consolidamento del WAL su Windows) appartiene al task rimandato.

#### T0.1 — Impronta del backup sempre diversa *(G0-A)*
- **File:** `apps/backend/src/modules/maintenance/backup.service.test.ts`
- [x] Nel test "un'impronta che non corrisponde…": `const originale = String(manifest.databaseSha256)`. Il primo carattere diventa `'1'` se era `'0'`, altrimenti `'0'`. Poi `assert.notEqual(manifest.databaseSha256, originale)` prima di `verify`.
- [x] Nel test "file troncato", aggiungere `assert.match(check.problem, /…/)`, con il messaggio rilevato eseguendo il test.
- [x] Gate V1. Per il punto "a": il test passa già; la prova è che `assert.notEqual` rende impossibile il caso in cui l'alterazione non cambia nulla. Nel report va spiegato.

#### T0.2 — `SQLITE_IOERR_TRUNCATE` dopo `process.kill` su Windows *(G0-B, con `systematic-debugging`)* — **RIMANDATO**

> **Rimandato, ma resta in questo piano** (decisione dell'utente, 30/10/2026). Il piano `backend-main-lifecycle` esclude `runtime.test.ts` e lo rimanda qui. Si riprende dopo il merge di `refactor/backend-main-lifecycle`; fino ad allora il fallimento è tollerato come noto nelle verifiche `SUITE×5` (§2).

- **File:** `apps/backend/src/runtime.test.ts`. Vietati `shutdown.ts`, `main.ts` e `db/**`.
- [ ] Riprodurre: 20 esecuzioni del file, di cui 5 concorrenti con `SUITE`. Riportare la frequenza.
- [ ] Verificare l'ipotesi: `termina()` restituisce il controllo prima che Windows rilasci i file `-wal` e `-shm`, e l'apertura `readonly` tenta un truncate. Verificare che si attenda l'evento `exit`.
- [ ] Correggere **nel test** in uno dei due modi, motivando la scelta in un commento:
  - riaprire con tentativi limitati (al massimo ~2 s, solo su `SQLITE_IOERR*` e `SQLITE_BUSY`);
  - leggere il dato con un terzo avvio.
- [ ] Se la causa è nel prodotto (dato non consolidato o file illeggibile anche dopo il rilascio), **fermarsi e riportare**.
- [ ] Gate V1, più 10 esecuzioni isolate e 3 concorrenti con `SUITE`, tutte verdi.

#### T5.5 — Scheduler senza tempo reale *(G0-C, anticipato da M5)*
- **File:** `apps/backend/src/modules/maintenance/backup.scheduler.test.ts`, solo il `describe('lo scheduler in esecuzione', …)` (oggi righe 147-290 circa). Vietato modificare `backup.scheduler.ts` e ogni altro file.
- **Sintomo:** `backup.scheduler.test.ts:148` ("crea un backup, poi si riarma per l'intervallo pieno") attende 200 ms di tempo reale per vedere almeno due backup (margine 10 ms più intervallo 60 ms). Sotto il carico della suite completa ne vede uno solo: è successo 1 volta su 5, mentre in isolamento è 15/15 verde. Gli altri test del blocco usano lo stesso schema, con attese reali e un'attesa attiva da 40 ms.
- [x] Leggere `backup.scheduler.ts` e stabilire quali primitive di tempo usa: `setTimeout`/`setInterval` globali, `unref`, l'orologio iniettato `now`. Riportarlo.
- [x] Se usa i timer globali: `mock.timers.enable({ apis: ['setTimeout'] })`, più le altre API effettivamente usate, in un `beforeEach`/`afterEach` del blocco; si avanza il tempo con `mock.timers.tick(ms)`. Le asserzioni diventano **esatte** e non "almeno":
  - dopo `tick(10)` c'è 1 backup;
  - dopo `tick(60)` ce ne sono 2;
  - dopo un altro `tick(60)` ce ne sono 3;
  - gli eventi `programmato` hanno `delayMs` uguale a 10 e poi a 60, come oggi;
  - il numero di eventi `creato` è uguale al numero di backup.

  Per gli altri test del blocco, stesse condizioni: si sostituisce ogni attesa reale e l'attesa attiva con `tick`, conservando quello che ogni test afferma (nessuna sovrapposizione, arresto, gestione degli errori, ecc.).
- [x] *(non applicabile: mock.timers compatibile)* Se lo scheduler non è compatibile con `mock.timers`, ripiegare sulle tolleranze. In quel caso nessuna asserzione può diventare più debole: ci si limita ad allungare le attese o ad aspettare un evento invece di un tempo fisso. Va riportato con la motivazione.
- [x] Il numero di test del file resta invariato (oggi verificabile con `ℹ tests` del file); i nomi dei test non cambiano.
- [x] Gate V1:
  - a. Il test passa già: nel report va spiegato perché la nuova forma non dipende più dal carico, cioè quale tempo reale resta, se ne resta;
  - b. `FILE` verde;
  - c. `TC`;
  - d. `PERIMETRO`.

  Il lead esegue poi 20 esecuzioni isolate e 5 concorrenti con `SUITE`.

### M1 — Funzioni pure del parsing e dei dati condivisi

**Criteri di accettazione:**
- un file di unit test per `sql`, `csv-values`, `csv-parser`, `transaction-type-resolver`, `merchant-normalizer`, `transaction.model`;
- per ogni bug: rosso con il motivo previsto, poi verifica di regressione (gate "e");
- `import.test.ts` invariato e verde;
- invarianti di T1.2 e T1.6 verdi;
- `TC` e `SUITE×5` verdi;
- `PERIMETRO` limitato ai file dei task.

**Rischi:** un formato CSV reale potrebbe cambiare interpretazione. Mitigazione: `import.test.ts` invariato, più una prova in sola lettura sui file di `samples/`: il numero di righe importate e la somma degli importi devono restare uguali prima e dopo M1. La esegue il lead in chiusura, su un DB temporaneo.

#### T1.1 — `escapeLike` e ricerca letterale *(G1-C)*
- **File:**
  - nuovo `apps/backend/src/shared/sql.test.ts`;
  - `shared/sql.ts`;
  - `modules/transactions/transactions.search.test.ts:240-243`;
  - `modules/loans/loans.service.test.ts:670`.
- **Interfaccia:** `escapeLike(value: string): string`, dove `%`, `_` e `\` vengono preceduti da `\`.
- [x] Unit test:
  - `escapeLike('100%_a') === '100\\%\\_a'`;
  - `escapeLike('a\\b') === 'a\\\\b'`;
  - `escapeLike('abc') === 'abc'`.
- [x] Integrazione sulle transazioni:
  - seminare `SCONTO 100%`, `IMPORTO 1000` e `COD_A1`;
  - `'100%'` trova solo la prima;
  - `'_'` trova solo `COD_A1`;
  - `'1000'` trova solo la seconda.
- [x] Integrazione sui prestiti: un `borrowerName` con `%` viene trovato; un nome senza `%` non viene trovato cercando `'%'`.
- [x] Gate V2. Utilizzatori diretti: tutti i test che importano i repository di transazioni e prestiti.

#### T1.2 — `parseCsvDate` / `parseCsvAmount` *(G1-A; D6.1–6.3)*
- **File:** nuovo `modules/import/csv-values.test.ts`; `csv-values.ts`; `csv-column-detector.test.ts` (un solo test aggiunto).
- [x] Tabella `parseCsvDate`:

  | Input | Atteso |
  |---|---|
  | `'31/12/2025'`, `'31-12-2025'`, `'31.12.2025'`, `'2025-12-31'` | `'2025-12-31'` |
  | `'31/12/2025 10:30'`, `'31/12/2025 10:30:15'`, `'2025-12-31T10:30:00'`, `'2025-12-31 10:30'` | `'2025-12-31'` |
  | `'1/2/2026'` | `'2026-02-01'` |
  | `'29/02/2024'` | `'2024-02-29'` |
  | `'29/02/2025'`, `'32/13/2026'`, `'2025-12-31xyz'`, `''` | `null` |
  | `'31/12/25'` | `'2025-12-31'` |
  | `'01/01/99'` | `'1999-01-01'` |
  | `'01/01/69'` | `'2069-01-01'` |

- [x] Tabella `parseCsvAmount`:

  | Input | Atteso |
  |---|---|
  | `'-54,30'`, `'-54.30'` | `-54.3` |
  | `'2.450,00'` | `2450` |
  | `'1.234'` | `1234` |
  | `'1,234'` | `1.234` |
  | `'1,234,567'` | `1234567` |
  | `'1.234.567,89'`, `'1,234,567.89'` | `1234567.89` |
  | `'1 234,56'` | `1234.56` |
  | `'€ 12,00'`, `'12,00 €'` | `12` |
  | `'12,50 EUR'` | `12.5` |
  | `'EUR -12,50'` | `-12.5` |
  | `'120,00-'` | `-120` |
  | `'120,00+'`, `'+120,00'` | `120` |
  | `'-120,00-'`, `'(12,50)'`, `''`, `'abc'` | `null` |

- [x] **Invariante di andata e ritorno:**
  - per ogni importo intero in centesimi `c` da −1.000.000 a +1.000.000, con un passo che includa i valori `±1`, `±99`, `±100`, `±100000`, ecc.;
  - formattato all'italiana con le migliaia (`1.234,56`, `-0,01`);
  - `Math.round(parseCsvAmount(testo)! * 100) === c`.
- [x] Rilevatore di colonne: una colonna `Data` con valori `'01/01/2026 10:00'` viene riconosciuta come data.
- [x] Gate V3, più gli invarianti. Utilizzatori diretti: `csv-column-detector.test.ts`, `column-mapping.test.ts`, `import.test.ts`.

#### T1.3 — `parseCsv`: BOM, intestazione, CSV malformato *(G1-B; D6.4, D6.9)*
- **File:** nuovo `modules/import/csv-parser.test.ts`; `csv-parser.ts`.
- [x] Test:
  - BOM iniziale → `headers[0] === 'Data contabile'`;
  - contenuto vuoto o solo spazi → `ValidationError`;
  - virgolette non chiuse alla riga 3 → `ValidationError` con il messaggio che contiene `3`;
  - lo stesso CSV con `;` e con `,` → stesse righe.
- [x] Prima di implementare, eseguire `parseCsv` in sola lettura su ogni file di `samples/` e riportare gli errori Papa per tipo. Questo decide l'applicazione di D6.9.
- [x] Correzione: leggere `result.errors` secondo D6.9.
- [x] Gate V2. Utilizzatori diretti: `import.test.ts`, `import.atomicity.test.ts`.

#### T1.4 — Resolver dei tipi *(G1-D)*
- **File:** nuovo `modules/import/transaction-type-resolver.test.ts`; `transaction-type-resolver.ts`.
- [x] Tabella `resolveTransactionType(hint, amount)`:

  | Hint | Importo | Atteso | Nota |
  |---|---|---|---|
  | `'PRELIEVO BANCOMAT'` | −50 | `WITHDRAWAL` | |
  | `'Prelievi contanti'` | −50 | `WITHDRAWAL` | oggi `EXPENSE` |
  | `'Prelevamento'` | −50 | `WITHDRAWAL` | |
  | `'STORNO PRELIEVO'` | 50 | `WITHDRAWAL` | voluto |
  | `'ACCREDITO STIPENDIO'` | 1000 | `INCOME` | |
  | `'Accrediti vari'` | 10 | `INCOME` | |
  | `'ACCREDITO'` | −10 | `INCOME` | fissato |
  | `''` | 0 | `EXPENSE` | fissato |
  | `''` | 0.01 | `INCOME` | |
  | `'POS'` | −1 | `EXPENSE` | |

- [x] Correzione: radici `preliev`, `prelevament`, `accredit`.
- [x] Gate V2.

#### T1.5 — Normalizzazione dei merchant *(G1-D)*
- **File:** nuovo `modules/merchants/merchant-normalizer.test.ts`; `modules/import/import.test.ts` (un test in fondo, con prefisso `S13 `).
- [x] `normalizeMerchantName('  Bar   X ')` → `'bar x'`; tabulazioni e a capo diventano uno spazio; `'CAFFÈ'` → `'caffè'`.
- [x] Importando `BAR X` e `Bar  x` si ottiene un solo merchant.
- [x] Solo test. Se qualcosa fallisce, **riportarlo**.
- [x] Gate V1.

#### T1.6 — Un solo arrotondamento euro → centesimi *(G1-E; D6.8)*
- **File:** `transaction.model.ts:56-57`; `cash-flow.service.ts:18`; `settings.repository.ts:25`; nuovo `modules/transactions/transaction.model.test.ts`.
- **Interfaccia:** `toAmountCents(amount: number): number`, l'unica conversione. Cash-flow e settings la importano.
- [x] Tabella:

  | Input | Atteso |
  |---|---|
  | `1.005` | `101` |
  | `0.285` | `29` |
  | `-1.005` | `-101` |
  | `2450` | `245000` |
  | `0.1 + 0.2` | `30` |
  | `-0.004` | `0`, verificato con `Object.is(r, 0)` |

- [x] **Invariante:** per ogni intero `c` da −1.000.000 a +1.000.000, `toAmountCents(c / 100) === c`. È un ciclo deterministico.
- [x] **Simmetria e niente `-0`** (richiesta in fase di approvazione):
  - per ogni `x` dell'invariante e per i casi a metà `±0.005`, `±1.005`, `±2.675`: `toAmountCents(-x) === -toAmountCents(x)`;
  - quando il risultato è zero, deve essere `Object.is(r, 0)` per `0`, `-0`, `-0.004`, `0.004`, `-0.0049`;
  - `toAmountCents(-0.005) === -1` e `toAmountCents(0.005) === 1`.
- [x] Implementazione: spostamento decimale (`Number(`${amount}e2`)`), poi un arrotondamento a metà lontano da zero.
- [x] Gate V3, più gli invarianti. Utilizzatori diretti: **tutta la suite**. Nessun valore esistente deve cambiare.

#### T1.7 — Vocabolario del rilevatore allineato al resolver *(G1-F, aggiunto su decisione dell'utente il 30/10/2026)*
Emerso dalla revisione di fine M1: T1.4 ha allargato le radici del resolver (`preliev`, `prelevament`, `accredit`), ma il rilevatore di colonne riconosce ancora una colonna "tipo" solo dalle parole singolari `prelievo`, `prelevamento`, `accredito` (`csv-column-detector.ts:59-62`, `TYPE_VOCABULARY`). Così una colonna di tipo con valori al plurale e senza un'intestazione indicativa non viene riconosciuta, e la correzione di T1.4 non arriva all'import automatico.
- **File:** `apps/backend/src/modules/import/csv-column-detector.ts` (solo le voci `prelievo`, `prelevamento`, `accredito` di `TYPE_VOCABULARY`, sostituite dalle radici `preliev`, `prelevament`, `accredit`); `apps/backend/src/modules/import/csv-column-detector.test.ts` (test in fondo).
- [x] Test (rosso prima della correzione): un CSV la cui colonna di tipo ha un'intestazione **non** indicativa (verificare nel rilevatore quali intestazioni sono già indizi di tipo e sceglierne una che non lo sia) e valori come `Prelievi contanti`, `Accrediti vari`, `Prelievi ATM` → quella colonna è riconosciuta come `typeHint`.
- [x] Test: lo stesso CSV con i valori al singolare continua a essere riconosciuto (fissato, deve passare già prima).
- [x] Nessun altro test del file cambia esito; `import.test.ts` e `column-mapping.test.ts` restano verdi senza modifiche.
- [x] Gate V2 (rosso dopo aver ripristinato il vecchio file).
- **Mod.:** `haiku`, revisore `sonnet`. Modifica di una riga, casi già specificati.

### M2 — Invarianti finanziari e correttezza del dominio

**Criteri di accettazione:**
- A1 corretto, con l'invariante di continuità verde;
- D1, D2, D4, D5, D7 applicati esattamente come approvati;
- tutti gli invarianti di G2-A, G2-D e G2-E verdi;
- verifica di regressione eseguita per ogni correzione;
- `TC` e `SUITE×5` verdi;
- revisione opus di ogni gruppo ★ e della milestone;
- **controllo manuale sull'app** con una copia del DB reale: cash-flow di luglio, agosto e settembre 2025, la dashboard, analytics. Le differenze rispetto a prima vanno elencate e spiegate. Lo fa il lead, con `DATABASE_FILE` che punta a una copia in `os.tmpdir()`.

**Rischi:** D1 e D2 cambiano il significato di valori visibili. Sui tuoi dati non cambia nulla oggi; A1 invece cambia i saldi storici, ed è l'effetto voluto.

#### T2.1 — Saldo del cash-flow rispetto alla data del saldo *(G2-A; D7)*
- **File:** nuovo `modules/cash-flow/cash-flow.balance-date.test.ts`; `cash-flow.service.ts`.
- **Regola (D7, fine giornata):**
  - saldo iniziale(mese) = saldo + Σ(`balanceDate < data < inizio mese`) − Σ(`inizio mese ≤ data ≤ balanceDate`);
  - con `balanceDate = null` resta il comportamento attuale.
- [x] Scenario puntuale: saldo 1000 al 2040-05-10; movimenti −5 (04-15), −40 (05-02), −60 (05-20), −10 (06-03).

  | Mese | Saldo iniziale | Saldo finale |
  |---|---|---|
  | aprile | 1045 | 1040 |
  | maggio | 1040 | 940 |
  | giugno | 940 | 930 |

- [x] **Invariante di continuità:**
  - 12 mesi consecutivi, con movimenti deterministici di tutti i tipi, compreso un prestito parziale;
  - `balanceDate` viene fatta variare su: il giorno prima del primo mese, il 1° del mese, il 15, l'ultimo giorno del mese e un giorno dopo l'ultimo movimento;
  - per ogni mese, saldo finale = saldo iniziale del mese successivo;
  - saldo finale di ogni mese = saldo iniziale + `netMovement`.
- [x] **Invariante di ancoraggio** (obbligatoria, richiesta in fase di approvazione). Per ogni variante di `balanceDate` dell'invariante di continuità, il saldo a fine giornata di `balanceDate` deve valere esattamente il saldo inserito. Lo si calcola come saldo iniziale del mese di `balanceDate` più Σ dei movimenti con `inizio mese ≤ data ≤ balanceDate`, e lo si verifica con un test dedicato, non come conseguenza di altri.
  - Va verificata esplicitamente anche la sensibilità al confine: un movimento **nel giorno stesso** di `balanceDate` è già compreso nel saldo; un movimento del giorno dopo no. Due test separati, uno per lato.
- [x] La vista completa resta invariata: i test esistenti vanno lasciati come sono.
- [x] Gate V4. Utilizzatori diretti: `cash-flow.service.test.ts`, `loans.cash-flow.test.ts`, `loans.partial-expense.test.ts`.

#### T2.7 — Analytics: passaggio d'anno e anno bisestile *(G2-B)*
- **File:** nuovo `modules/analytics/analytics.timeline.test.ts`.
- [x] `startOfWeek('2026-01-01') === '2025-12-29'`; `startOfWeek('2024-02-29') === '2024-02-26'`.
- [x] `buildTimeline` mensile da `2025-11-15` a `2026-02-10` → bucket `2025-11, 2025-12, 2026-01, 2026-02`.
- [x] Settimanale attraverso il capodanno → nessuna settimana duplicata o mancante.
- [x] Solo test. Se qualcosa fallisce, **riportarlo**. Gate V1.

#### Gruppo G2-C — Prestiti (T2.4 → T2.5 → T2.2, un commit per task)

**File del gruppo:** `modules/loans/loans.service.ts`, `modules/loans/loans.repository.ts` (solo per la somma per `transactionId`), nuovo `modules/loans/loans.validation.test.ts`.

##### T2.4 — Origine negativa *(D5)*
- [x] Movimento `LOAN` +250 → `ValidationError`; −250 → accettato come oggi. Gate V3.

##### T2.5 — Capienza del movimento di restituzione *(D4)*
- [x] Accredito +100, prestiti A e B da 90:
  - A 60 collegata → ok;
  - B 40 collegata → ok;
  - B 1 collegata → `ValidationError` con il residuo del movimento.
- [x] Una modifica che supera la capienza → errore. Ridurre → ok. Una modifica senza cambio di importo → ok, perché la restituzione stessa va esclusa dalla somma.
- [x] **Invariante:** dopo ogni operazione accettata, per ogni Transaction Σ restituzioni collegate ≤ importo. Si verifica con una query al termine di ogni sequenza di test.
- [x] **Modifica successiva dell'importo della Transaction collegata** (richiesta in fase di approvazione). Oggi l'importo è immutabile: le uniche scritture su `transactions` sono `set({ type })` e `set({ fingerprint })` (`transactions.repository.ts:319,401`), e le rotte espongono solo `GET`, `DELETE` e `PATCH /:id/type`.
  - Test: un `PATCH /api/transactions/:id` con `amount` → 404, e l'importo resta invariato.
  - Test: `updateType` su un accredito collegato non cambia l'importo e non viola l'invariante. Va verificato anche il cambio di tipo verso un tipo non `INCOME`: deve restare coerente con D2 e, se non lo è, va riportato.
  - Commento in `loans.service.ts` accanto al controllo di capienza: qualunque percorso futuro che modifichi `amount_cents` deve rieseguire la stessa verifica.
  - Il lead, in chiusura di G2-C, riesegue `grep -n "db.update(transactions)" apps/backend/src -r` e riporta l'esito.
- [x] Gate V3.

##### T2.2 — Vincoli di `update` e casi scoperti
- [x] Gli scenari:

  | Scenario | Atteso |
  |---|---|
  | `update` sotto il già restituito | `ValidationError` "non può valere meno" |
  | `update` oltre la capienza, con prestiti fratelli | `ValidationError` |
  | `update` pari al già restituito | ok, residuo 0 |
  | Restituzione anteriore a `lentAt` | **fissare** il comportamento attuale e riportarlo (decisione eventuale) |
  | 0.004 | rifiutato |
  | 0.005 | 1 centesimo |
  | `parseLoanQuery`: valori validi, non validi e default | come da `loan-query.ts` |

- [x] Gate V1 (solo test).

#### T2.3 — Rimborsi coerenti fra le viste *(G2-D; D1)*
- **File:** `summary.service.ts`, `analytics.mapper.ts` (e `analytics.aggregation.ts` se necessario), `dashboard.service.ts`, un helper condiviso accanto a `expenseCents` in `transactions/transaction-type.ts` (oppure un nuovo file in `transactions/`, nominato nel report), nuovo `modules/dashboard/refunds.consistency.test.ts`.
- [x] Scenario (B): Alimentari −100 e +30; Shopping solo +20. Su summary, analytics e dashboard per lo stesso mese:
  - `expenses` = 50;
  - le distribuzioni sono `[Alimentari 70 → 100%]`, senza Shopping;
  - `byMerchant` segue D1.c.
- [x] `percentChange` per una coppia (mese precedente, mese attuale):

  | Precedente | Attuale | Atteso |
  |---|---|---|
  | −30 | 100 | `null` |
  | 0 | 100 | `null` |
  | 50 | 100 | `100` |

- [x] **Invarianti incrociati**, su tre scenari: solo spese, spese con rimborsi, solo rimborsi.
  - `summary.expenses === analytics.overview.expenses === dashboard.summary.expenses`;
  - le percentuali di ogni distribuzione sommano a 100 ± 0,1, oppure la distribuzione è vuota (precisato in chiusura di M2: vale per le distribuzioni complete degli scenari del test; con molte voci l'arrotondamento a un decimale di ciascuna quota può superare la tolleranza, es. 6 voci uguali → 100,2);
  - nessuna voce di distribuzione ha importo ≤ 0.
- [x] La regola vive in un solo punto e non viene copiata nei servizi.
- [x] Gate V4. Utilizzatori diretti: i test di summary, analytics e dashboard.

#### T2.6 — Restituzioni fuori da entrate e patrimonio *(G2-E; D2 = B)*
- **File:**
  - `transactions/transaction-type.ts`: `isIncome`/`incomeCents` e `netWorthCents` ricevono `repaidCents`;
  - `cash-flow.service.ts`, `summary.service.ts`, `analytics.aggregation.ts`, `dashboard.service.ts`;
  - `loans.service.ts`: `repaymentsByTransaction(): Map<string, number>`;
  - `transaction-type.test.ts`;
  - `loans.cash-flow.test.ts:89,94,166`;
  - `docs/architecture/data-model.md`;
  - nuovo `modules/loans/loans.repayment-income.test.ts`.
- [x] I valori della mappa D2 (§4) per lo scenario 80 / 50 collegati / 10 in contanti, su ogni vista della tabella.
- [x] Accredito 70 con 50 collegati → `income` 20. Scollegare → `income` 70.
- [x] Accredito in un mese diverso dal prestito → l'esclusione avviene nel mese dell'accredito.
- [x] **Invarianti:**
  - collegare o scollegare una restituzione non cambia `netMovement` né `closingBalance` di nessun mese;
  - `income(con collegamento) + quota collegata = income(senza collegamento)`;
  - prestare X e ricevere X collegati → il contributo a `netWorthChange` e `income` sull'intero periodo è 0;
  - Σ `byType` = `netMovement`.
- [x] `repaidCents` limitato all'importo positivo del movimento.
- [x] I test che fissavano il vecchio comportamento si aggiornano **solo** alle righe citate, con un commento che rimanda a D2.
- [x] Gate V4. Utilizzatori diretti: cash-flow, summary, analytics, dashboard e loans.

#### T2.8 — Righe fuse da virgolette malformate *(G2-F; D6.9, aggiunto su decisione dell'utente il 30/10/2026)*
- **Origine:** osservazione della revisione di fine M1, verificata dal lead. Il caso esiste già su `master`.
  - Un campo con virgoletta d'apertura non chiusa ma con un numero pari di virgolette interne produce solo `InvalidQuotes`, non `MissingQuotes`.
  - Nell'esempio `02/01/2026;"BAR "SPORT" ROMA;-3,50` seguito da `03/01/2026;"PANE";-1,20`, Papa restituisce **una** riga: `Data` 02/01/2026, `Descrizione` che contiene `;-3,50`, un a capo e `03/01/2026;"PANE`, e `Importo` −1,20.
  - Il risultato è una transazione valida ma sbagliata, e la riga intermedia si perde senza errori.
- **Regola approvata:** il file si rifiuta anche quando un campo della riga segnalata da `InvalidQuotes` contiene un a capo (`\n` o `\r`).
  - Il messaggio è lo stesso di T1.3: "Il file CSV ha virgolette non chiuse alla riga N.", con N la riga del file in cui inizia la riga fusa, contata da 1 e con l'intestazione compresa.
- **File:** `modules/import/csv-parser.ts`, `modules/import/csv-parser.test.ts`.
- [x] Il caso di fusione qui sopra viene rifiutato con N = 2. Una variante con CRLF dà lo stesso N.
- [x] Restano accettati, con le righe attese:
  - `"BAR "SPORT" ROMA"` (`InvalidQuotes` senza a capo);
  - un campo su più righe chiuso correttamente (`"BAR\nSPORT"`, nessun errore);
  - un file con un campo su più righe corretto in una riga e virgolette interne in **un'altra** riga. La regola guarda la riga segnalata, non l'intero file.
- [x] **Effetto collaterale, da fissare con un test:** un campo su più righe che contiene anche virgolette interne non raddoppiate (`"BAR\n"SPORT" ROMA"`) viene rifiutato. Papa lo legge correttamente, ma non è distinguibile dalla fusione.
- [x] I test esistenti su `MissingQuotes` restano verdi senza modifiche.
- [x] Gate V2. Utilizzatori diretti: `csv-parser.test.ts`, `csv-column-detector.test.ts`, `column-mapping.test.ts`, `import.test.ts`, `import.atomicity.test.ts`. Più la prova sul campione reale, che deve dare lo stesso risultato di `master`.

### M3 — Integrità dei dati e vincoli del database

**Criteri di accettazione:**
- il test dei vincoli fallisce se si toglie `foreign_keys = ON`, verificato una volta dal lead modificando temporaneamente la riga;
- D3 applicata;
- migrazione `0009` verificata su una copia del DB reale;
- `TC` e `SUITE×5` verdi;
- `PERIMETRO` limitato ai file dei task.

**Rischi:** la migrazione gira sul DB reale al primo avvio dopo il merge. Il backup automatico c'è già; va comunque provata prima sulla copia.

#### Gruppo G3-F — Regole delle restituzioni decise dopo M2 (T3.7 → T3.8, un commit per task)

**File del gruppo:** `modules/loans/loans.service.ts`, `modules/transactions/transactions.service.ts` (solo `updateType` e, se serve, la porta `TransactionDependents`), `app.ts` (solo il collegamento della porta), `docs/architecture/data-model.md`, nuovo `modules/loans/loans.repayment-rules.test.ts`. Nei test esistenti si cambiano **solo** quelli che fissavano il comportamento superato, con un commento che rimanda a D9 o D10.

##### T3.7 — Restituzioni solo su movimenti in entrata *(D9)*
- [x] Collegare una restituzione a un `EXPENSE`, `OTHER`, `TRANSFER` o `WITHDRAWAL` positivo → `ValidationError`, sia in creazione sia in modifica. A un `INCOME` positivo → ok.
- [x] `updateType` verso un tipo non `INCOME` di un movimento collegato a restituzioni → errore con il nome del prestito, tipo invariato. Verso `INCOME` (stesso tipo) → ok. Un movimento non collegato si riclassifica come oggi.
- [x] L'errore di `updateType` passa dalla porta `TransactionDependents`; `transactions` non importa `loans`.
- [x] `data-model.md`: il punto aperto sui movimenti non `INCOME` diventa la regola D9.
- [x] Gate V3.

##### T3.8 — Restituzione non anteriore al prestito *(D10)*
- [x] Prestito del 2040-03-10: restituzione del 2040-03-09 → `ValidationError`; del 2040-03-10 → ok; del 2040-03-11 → ok. Stessi casi in modifica della data.
- [x] Modifica di `lentAt` dopo la restituzione più vecchia → `ValidationError`; fino al giorno della restituzione → ok; prestito senza restituzioni → ok.
- [x] Gate V3.

#### T3.2 — Vincoli a livello di database *(G3-A)*
- **File:** nuovo `apps/backend/src/db/constraints.test.ts`.
- [x] I casi:

  | Caso | Atteso |
  |---|---|
  | `PRAGMA foreign_keys` | `1` |
  | Inserimento in `loans` con `transaction_id` inesistente | `SQLITE_CONSTRAINT_FOREIGNKEY` |
  | `DELETE` di una transaction con prestito | `SQLITE_CONSTRAINT_FOREIGNKEY` |
  | Duplicati sugli indici unici esistenti | `SQLITE_CONSTRAINT_UNIQUE` |
  | `atomically` annidato, errore catturato dentro | annulla solo l'interno |
  | `atomically` annidato, errore propagato | annulla tutto |
  | `vacuum()` dentro `atomically` | errore |

  Gli indici unici da testare si ricavano da `apps/backend/drizzle/*.sql`; quelli attesi ma assenti vanno riportati.
- [x] Gate V1.

#### T3.3 — `backfillFingerprints` con righe reali *(G3-B)*
- **File:** nuovo `modules/transactions/fingerprint.backfill.test.ts`.
- [x] 3 righe senza fingerprint, di cui 2 identiche nello stesso giorno → `backfillFingerprints() === 3`. Fingerprint distinti, uguali a quelli dell'import, quindi il re-import non duplica. La seconda chiamata → `0`.
- [x] Gate V1.

#### T3.4 — Eliminare un movimento collegato a una restituzione *(G3-B)*
- **File:** `modules/transactions/transactions.delete.test.ts` (un `describe` in fondo).
- [x] Rilevare prima il comportamento attuale. Se è `ConflictError` senza eliminazioni, si fissa. Se è un 500 o un'eliminazione riuscita, **fermarsi e riportare**.
- [x] Gate V1.

#### T3.1 — Una sola rappresentazione di "Da classificare" *(G3-C; D3 = A, D3.b)*
- **File:**
  - `categories.service.ts`, `categories.repository.ts`;
  - `merchants.service.ts` (`assignCategory`);
  - nuova migrazione `apps/backend/drizzle/0009_*.sql` più `meta/_journal.json` e lo snapshot (con `npm run db:generate`, oppure a mano sul formato di `0003_seed_categories.sql`);
  - nuovo `modules/categories/unclassified.test.ts`.
- [x] Eliminare una categoria con 2 merchant:
  - entrambi passano a `categoryId === null`;
  - `counts.unclassified` aumenta di 2;
  - il filtro transazioni `'unclassified'` li include.
- [x] `assignCategory(id, FALLBACK_CATEGORY_ID)` → `null`.
- [x] D3.b: `merchantCount` della riga "Da classificare" = numero di merchant con `null`.
- [x] Migrazione su un DB di test con un merchant sul fallback → `null`. Seconda esecuzione → no-op.
- [x] **Prova su una copia del DB reale** (gate "k"), eseguita dal lead:
  1. copia di `data/database.sqlite` in `os.tmpdir()`;
  2. `runMigrations()` con `DATABASE_FILE` sulla copia;
  3. riportare prima e dopo: numero di merchant, quanti con `null`, quanti sul fallback, numero di transazioni, numero di righe in `__drizzle_migrations`, esito di `PRAGMA integrity_check`;
  4. seconda esecuzione: nessuna differenza.
- [x] Gate V4.

#### T3.5 — Unicità del nome categoria senza maiuscole e minuscole *(G3-D; D6.5)*
- **File:** `categories.service.ts`, `categories.repository.ts`, `categories.service.test.ts` (un `describe` in fondo).
- [x] I casi:
  - `create('spesa')` con `Spesa` esistente → `ConflictError`;
  - `rename` verso un nome uguale a meno delle maiuscole a quello di un'altra categoria → `ConflictError`;
  - rinominare `Spesa` in `SPESA` (stessa categoria) → ok.
- [x] Gate V2.

#### T3.6 — Ricerca e ordinamento con lettere accentate *(G3-E; D6.6)*
- **File:**
  - `db/client.ts` (`sqlite.function('lower_unicode', { deterministic: true }, …)`);
  - `transactions.repository.ts:115-119,136`;
  - `loans.repository.ts` (ricerca e ordinamento);
  - in fondo a `transactions.search.test.ts` e `loans.service.test.ts`.
- [x] `'caffè'` trova `CAFFÈ ROMA`. L'ordinamento per merchant di `ZETA`, `alfa`, `Cassa` dà `alfa, Cassa, ZETA`. Stessi casi sui prestiti.
- [x] Verificare quali altre connessioni (restore, backup) eseguono queste query e riportarlo.
- [x] Gate V3. Utilizzatori diretti: tutti i test che importano `db/client`, cioè la suite.

#### Coda di M3 — decisioni dell'utente dopo la chiusura (02/11/2026)

##### T3.9 — Ricerca senza accenti *(G3-G; D11)*
- **File:** `db/client.ts` (registrazione della funzione), un aiutante JS condiviso per il termine (in `shared/`), `transactions.repository.ts` e `loans.repository.ts` (solo le condizioni di ricerca), un `describe` in fondo a `transactions.search.test.ts` e a `loans.service.test.ts`.
- [x] «caffe» trova «CAFFÈ ROMA»; «CAFFÈ» trova «caffe bar»; «perche» trova «PERCHÉ NO»; i prestiti con lo stesso schema (nome, descrizione, movimento).
- [x] `%` e `_` restano letterali (T1.1); l'ordinamento non cambia.
- [x] Gate V3.

##### T3.10 — Filtro per "Da classificare" *(G3-G; D12)*
- **File:** i punti in cui `transactions` e `analytics` applicano `categoryIds`, più un `describe` nei rispettivi test di ricerca e di servizio.
- [x] `categoryIds=[ripiego]` dà gli stessi movimenti di `classification: 'unclassified'`; `[ripiego, Alimentari]` dà l'unione; senza ripiego nulla cambia. Stessi casi in analytics.
- [x] Gate V3.

##### T3.11 — Frontend: candidati solo in entrata e commenti superati *(G3-H)*
- **File:** `apps/frontend/src/app/features/loans/loan-detail-page.ts` e il suo `.spec.ts`; `apps/frontend/src/app/features/dashboard/dashboard.model.ts`.
- [x] La ricerca dei candidati chiede `types: ['INCOME']`; il filtro `amount > 0` resta. Il test del componente verifica il parametro nella richiesta.
- [x] Eliminati i commenti delle righe 25 e 52 di `dashboard.model.ts`.
- [x] `ng test` verde.

##### T3.12 — `csv-values.test.ts` non apre il DB *(G3-H)*
- [x] `toAmountCents` importato da `transactions/transaction.model.ts`, non dal barrel. Verifica: con `DATABASE_FILE` su un file inesistente, il test non lo crea.

### M4 — Contratti HTTP dei router

> **Sostituita il 02/11/2026** dal lavoro sui router: design `docs/superpowers/specs/2026-11-02-router-di-design.md`, piano `docs/superpowers/plans/2026-11-02-router-di.md` (branch `refactor/router`). I contratti HTTP sono la sua fase 1; la regola "niente mock" non vale più per router e servizi. Il testo qui sotto resta come storia.

**Criteri di accettazione:**
- un file di test HTTP per analytics, cash-flow, summary, dashboard, categories, import, loans, settings;
- per ognuno: un caso positivo con le **chiavi del view-model** verificate, un 400, e il 404 o 409 dove esiste;
- ramo 500 coperto, senza dettagli nella risposta;
- solo file di test (`PERIMETRO`). Se un test rivela un bug, si apre un nuovo task da approvare;
- `TC` e `SUITE×5` verdi.

**Schema comune** (`transactions.routes.test.ts:1-50`):
- radice temporanea, `createApp(frontendDir).listen(0, config.host)`;
- `fetch` su `http://${config.host}:${port}`;
- `server.close()` e `closeDatabase()` in `after`.

Nessun helper condiviso nuovo, salvo che la revisione di milestone rilevi più di ~20 righe duplicate per file: in quel caso diventa un task di M5.

| Task | Gruppo | File | Casi minimi |
|---|---|---|---|
| T4.1 | G4-A | nuovo `modules/import/import.routes.test.ts` | `POST /api/import/csv` `text/csv` → 200 con conteggi; `Content-Type` JSON → 400; corpo oltre il limite → 413; `/csv/analysis` → colonne proposte; `/csv/mapped` con mapping non valido → 400 |
| T4.6 | G4-A | nuovo `shared/http/error-handler.test.ts` | errore generico → 500, "Errore interno del server.", nessuno stack o messaggio interno; `DomainError` → 400/404/409; JSON malformato → 400 |
| T4.2 | G4-B | nuovo `modules/categories/categories.routes.test.ts` | `POST` → 201; nome vuoto → 400; duplicato, anche a meno delle maiuscole → 409; `PATCH` → 200; `DELETE` → 204; `DELETE` del fallback → 409; `merchantCount` del fallback (D3.b) nelle risposte di `GET` e `PATCH`; `PATCH` di un merchant verso l'id del fallback → 200 con `category: null` (rimandato dalla revisione di fine M3) |
| T4.7 | G4-B | `merchants.routes.test.ts`, `transactions.routes.test.ts` (in fondo) | `PATCH /merchants/:id` e `/:id/category` (200, 404, categoria inesistente 400, fallback → `category: null`); `GET /transactions/:id` (200, 404); `PATCH /transactions/:id/type` (200, 400, 404); rafforzare `merchants.routes.test.ts:119-142` con valori esatti |
| T4.3 | G4-C | nuovo `modules/loans/loans.routes.test.ts` | creazione → 201; importo non valido → 400; inesistente → 404; `DELETE` con restituzioni → 409; restituzione oltre la capienza (D4) → 400; origine positiva (D5) → 400; lista con `search`, `status`, `sort` |
| T4.5 | G4-C | nuovo `modules/settings/settings.routes.test.ts` | `GET` → forma; `PATCH` parziale; `balanceDate` non valida → 400; `initialBalance` `NaN`, `"abc"` o `Infinity` → 400; `1.005` → riletto `1.01` |
| T4.4 | G4-D | nuovi `analytics.routes.test.ts`, `cash-flow.routes.test.ts`, `summary.routes.test.ts`, `dashboard.routes.test.ts` | parametri validi → 200 con le chiavi del view-model; mese o data malformati → 400; liste nei parametri (`categoryIds` ripetuto e separato da virgole) |

### M5 — Igiene

**Criteri di accettazione:**
- il numero di cartelle `appconto-*` in `os.tmpdir()` dopo `SUITE` non supera quello prima. Su Windows è ammessa al massimo 1 cartella residua, documentata, per i file WAL bloccati dai processi avviati da `runtime.test.ts`;
- il numero di test non cambia, tranne le nuove asserzioni dentro test esistenti;
- `TC` e `SUITE×5` verdi.

#### T5.1 — `closeDatabase()` in ogni `after` *(G5-A)*
- **File:** individuati con `grep -L closeDatabase` fra i test con DB. Oggi sono attesi: `import.test.ts`, `merchants.service.test.ts`, `merchants.search.test.ts`, `categories.service.test.ts`, `transactions.search.test.ts`, `transactions.delete.test.ts`, `db/client.test.ts`.
- [ ] Contare le cartelle temporanee prima e dopo `SUITE`, e riportare i due numeri.

#### T5.2 — Asserzioni deboli *(G5-A)*
- [ ] Gli interventi:

  | File | Intervento |
  |---|---|
  | `cash-flow.service.test.ts:92-95` | asserire il valore della categoria |
  | `dashboard.service.test.ts:182` | asserire prima la lunghezza |
  | `transactions.search.test.ts:308` | numero esatto |
  | `import.test.ts:187` | elenco completo degli importi |
  | `csv-column-detector.test.ts:191` | colonna esatta |
  | `analytics.service.test.ts:450` | quali bucket sono `partial` |

- [ ] Ogni asserzione nuova va fatta fallire una volta, cambiando l'atteso, e poi ripristinata. L'output del fallimento va nel report.

#### T5.4 — Script `test:coverage` *(G5-A; D6.7)*
- [ ] `package.json` di root: `"test:coverage": "tsx --test --experimental-test-coverage --test-coverage-exclude=\"**/*.test.ts\" \"apps/backend/src/**/*.test.ts\""`.
- [ ] Eseguirlo: compare la tabella e l'exit code è 0.

#### T5.3 — Preparazione nei `describe` e pulizia in `finally` *(G5-B)*
- **File:** `loans.partial-expense.test.ts:99,121-129`; `loans.service.test.ts` (pulizia in `finally`, e `603-611` con valori letterali al posto del `reduce`).
- [ ] Numero di test ed esiti invariati, con l'elenco prima e dopo nel report.

#### ~~T5.5 — Scheduler senza busy-wait~~
Spostato in M0 come G0-C (decisione dell'utente, 30/10/2026). Vedi T5.5 nella sezione M0.

---

## 8. Complessità e rischi

| Milestone | Complessità | Rischio principale | Mitigazione |
|---|---|---|---|
| M0 | Bassa | Instabilità dei test che dipendono dal tempo reale o dal contenuto variabile (T0.1, T5.5) | Correzioni solo nei test; esecuzioni ripetute isolate e sotto carico. Il rischio WAL di T0.2 appartiene al task rimandato |
| M1 | Media | Formati CSV reali che cambiano interpretazione | `import.test.ts` invariato; confronto prima e dopo sui file di `samples/`; invarianti di andata e ritorno |
| M2 | **Alta** | Saldi storici e significato di entrate e patrimonio | Revisori opus; invarianti incrociati; prova manuale su una copia del DB; D7 confermata prima |
| M3 | Media | Migrazione sul DB reale | Prova su copia, idempotenza, backup automatico |
| M4 | Bassa-media | Test HTTP che scoprono bug | Stop e nuovo task; nessuna correzione silenziosa |
| M5 | Bassa | Cambiare la preparazione cambia l'ordine dei test | Elenco dei test prima e dopo |

**Parallelismo effettivo:**
- vero in M4 e M5;
- nessuno in M0, che dopo il rinvio di T0.2 è sequenziale (G0-A → G0-C);
- parziale in M1–M3 (ondate da 2 più sovrapposizione), per i motivi del §3.3.

---

## 9. Stato della roadmap

| Milestone | Stato | Bloccata da |
|---|---|---|
| M0 Stabilizzazione | ✅ completata il 30/10/2026: T0.1 (`8e3b3f5`), T5.5 (`03ee9da`). Merge in `master` da parte dell'utente | — |
| T0.2 (fuori milestone) | ⏸ aperto | merge di `refactor/backend-main-lifecycle`; poi va ripianificato con una tua approvazione |
| M1 Parsing e funzioni pure | ✅ completata il 30/10/2026 (T1.1–T1.7; D6.9 rivista e precisata). Branch `test/m1-parsing`, sopra M0: merge di M0 prima di M1 | — |
| M2 Invarianti finanziari | ✅ completata il 30/10/2026 (T2.1–T2.8, compreso il nuovo T2.8). Branch `test/m2-dominio`, sopra M1: ordine di merge M0 → M1 → M2. Restano da decidere: restituzioni collegate a movimenti non `INCOME`, restituzione anteriore a `lentAt` | — |
| M3 Integrità dei dati | ✅ completata il 02/11/2026 (T3.1–T3.8, con D9 e D10; migrazione 0009 provata su una copia del DB reale). Branch `test/m3-integrita`, sopra M2: ordine di merge M0 → M1 → M2 → M3. ✅ Coda chiusa il 02/11/2026: D11, D12, frontend (T3.9–T3.12); revisione opus "Ready", suite 939/939 ×5, `ng test` 77 file verdi | — |
| M4 Contratti HTTP | ↪ sostituita dal piano `docs/superpowers/plans/2026-11-02-router-di.md` (fasi 0–4, branch `refactor/router`) | — |
| M5 Igiene | ⏳ | piano dei router, D6.7 |
