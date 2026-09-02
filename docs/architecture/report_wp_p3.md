# Report WP-P3 — Data Safety, Atomic Transactions, Backup & Restore

Data: 2026-09-01
Baseline: WP-P2 (Portable Runtime Foundation & Safe SQLite Lifecycle)

---

## 1. Obiettivo

Rendere impossibili le modalità di perdita dati **prevedibili e controllabili**, prima che il
packaging portatile (P4/P5) moltiplichi le occasioni di sbagliare: cartelle copiate a metà,
chiavi USB estratte, versioni diverse dell'applicazione sulla stessa cartella dati.

Quattro proprietà, tutte verificate da test automatici:

| Proprietà | Come è garantita |
|---|---|
| Atomicità delle scritture di massa | una transazione SQLite avvolge l'intero import |
| Backup consistenti e verificati | `VACUUM INTO` → `integrity_check` → conteggi → impronta → rename |
| Protezione durante le migrazioni | nessuna migrazione senza un backup verificato; downgrade rifiutato |
| Ripristino sicuro | preparato a caldo, applicato all'avvio successivo, mai a database aperto |

Il principio guida del WP — *nessuna operazione può lasciare il database parzialmente
modificato senza che il sistema lo rilevi e possa recuperare* — è rispettato. Dove
l'atomicità non è ottenibile dal filesystem, il punto di commit è dichiarato e la procedura
è ricostruibile: vedi §7.

---

## 2. Stato iniziale

Ereditato da P2 e **non duplicato**:

- `APP_ROOT` / `DATA_ROOT` con risoluzione indipendente dal `cwd` (`apps/backend/src/paths.ts`)
- `MYFINANCE_DATA`, `DATABASE_FILE` (alias storico), `config/settings.json`
- `DATA_ROOT/{backups,logs,tmp}` già create da `ensureDataDirectories()`
- logging persistente con ritenzione a 14 giorni
- graceful shutdown con `PRAGMA wal_checkpoint(TRUNCATE)`
- 297 test backend, 169 frontend, typecheck e build verdi

Ciò che **non** c'era, e che l'analisi del codice ha confermato prima di scrivere una riga:

| Punto | Stato trovato |
|---|---|
| `transactionsRepository.insertMany` | ciclo a blocchi da 500, **nessuna transazione** |
| `merchantsRepository.insertMany` | idem |
| `transactionsService.backfillFingerprints` | N `UPDATE` in sequenza, nessuna transazione |
| `importService.importCsv` | merchant e transazioni in **due** operazioni separate |
| Registro delle migrazioni | `__drizzle_migrations(hash, created_at)`, gestito da Drizzle |
| Backup | inesistente; `DATA_ROOT/backups/` predisposta e vuota |
| Guardia sul downgrade | inesistente |

### Verifiche empiriche preliminari

Cinque assunzioni sono state provate su un database temporaneo **prima** di progettare, perché
l'intera strategia vi poggia:

| # | Verifica | Esito |
|---|---|---|
| 1 | `VACUUM INTO ?` con parametro bindato | funziona: nessun quoting di percorsi |
| 2 | snapshot da una 2ª connessione con 5.000 righe **non confermate** in corso | il lettore vede 100 righe (lo stato confermato), `integrity ok` |
| 3 | `VACUUM INTO` dentro una transazione | rifiutato da SQLite → il backup non può annidarsi in un import |
| 4 | transazione annidata + eccezione | rollback completo (SAVEPOINT) |
| 5 | `VACUUM INTO` su destinazione esistente | rifiutato → il `.partial` va rimosso prima |
| 6 | `journal_mode` del file prodotto | `delete`: lo snapshot è **per costruzione** un file singolo |

Il punto 2 è la giustificazione diretta della scelta di `VACUUM INTO`: uno snapshot preso nel
mezzo di un import non contiene un import a metà, contiene lo stato confermato.
Il punto 6 significa che un backup non porta con sé alcun `-wal`: si copia da solo.

---

## 3. File modificati

### Nuovi (produzione)

| File | Righe | Responsabilità |
|---|---|---|
| `apps/backend/src/app-version.ts` | 31 | versione dichiarata dal `package.json`, per il manifest |
| `apps/backend/src/bootstrap.ts` | 61 | radice di composizione del ciclo di vita dei dati |
| `apps/backend/src/db/schema-version.ts` | 149 | lettura e **confronto puro** delle versioni di schema |
| `apps/backend/src/db/safe-migrate.ts` | 134 | la sola sequenza autorizzata a modificare lo schema |
| `apps/backend/src/modules/maintenance/backup.naming.ts` | 115 | nomi e **unica** trasformazione nome → percorso |
| `apps/backend/src/modules/maintenance/backup.retention.ts` | 138 | politica di ritenzione, pura |
| `apps/backend/src/modules/maintenance/backup.manifest.ts` | 230 | formato del manifest, impronta, ispezione di un file |
| `apps/backend/src/modules/maintenance/backup.service.ts` | 412 | creazione, verifica, elenco, pruning |
| `apps/backend/src/modules/maintenance/restore-pending.ts` | 450 | applicazione del ripristino all'avvio |
| `apps/backend/src/modules/maintenance/restore.service.ts` | 176 | preparazione del ripristino |
| `apps/backend/src/modules/maintenance/maintenance.routes.ts` | 103 | le API |
| `apps/backend/src/modules/maintenance/maintenance.view-model.ts` | 72 | DTO: nessun percorso esce |
| `apps/backend/src/modules/maintenance/index.ts` | 25 | API pubblica della feature |

### Modificati

| File | Modifica |
|---|---|
| `apps/backend/src/db/client.ts` | + `atomically()`, `vacuumInto()`, `databaseSchema()`; `runMigrations(folder?)`; chiamata a `applyPendingRestore()` **prima** dell'apertura |
| `apps/backend/src/config.ts` | + `backupsDir` |
| `apps/backend/src/main.ts` | usa `bootstrap()`; su eccezione registra il motivo ed esce con codice 1 |
| `apps/backend/src/app.ts` | monta `/api/backups` e `/api/restore` |
| `apps/backend/src/modules/transactions/transactions.repository.ts` | `insertMany` transazionale |
| `apps/backend/src/modules/transactions/transactions.service.ts` | `backfillFingerprints` transazionale, letture comprese |
| `apps/backend/src/modules/merchants/merchants.repository.ts` | `insertMany` transazionale |
| `apps/backend/src/modules/import/import.service.ts` | l'**intera** persistenza in una transazione |
| `apps/backend/src/runtime.test.ts` | il controllo di isolamento ora copre anche `data/` (vedi §12) |

Nessun repository di dominio ha cambiato firma. Nessuna migrazione è stata aggiunta o
modificata: lo schema del database è identico a quello di P2.

---

## 4. Nuove astrazioni

```
paths.ts (P2)  ──►  config.ts  ──►  app-version.ts
                         │
db/schema-version.ts ◄───┤   __drizzle_migrations.created_at  vs  meta/_journal.json
   (confronto PURO)      │   nessun secondo registro
                         ▼
maintenance/restore-pending.ts ──►  db/client.ts
   (nessuna dipendenza da client)      atomically() · vacuumInto() · databaseSchema()
                                       ▼
                         maintenance/backup.service.ts
                                       ▼
                         maintenance/restore.service.ts
                                       ▼
db/safe-migrate.ts ─────►  bootstrap.ts  ──►  main.ts
                                       ▼
                         maintenance.routes.ts ──►  app.ts
```

Tre scelte di confine meritano una spiegazione, perché non sono ovvie.

**`restore-pending.ts` non dipende da `client.ts`, e ne è importato.** Il ripristino deve
avvenire quando nessuna connessione esiste, cioè un istante prima dell'apertura. Metterlo in
`main.ts` avrebbe funzionato per caso: in ESM `import` esegue, quindi importare `client.js`
apre già il database. Collocando la chiamata dentro `client.ts`, sopra `new Database(...)`,
l'ordine non è più invertibile da chi comporrà l'avvio in futuro.

**`safe-migrate.ts` riceve le dipendenze come parametri.** Le tre condizioni che deve
garantire — archivio più recente, backup fallito, migrazione rotta — richiederebbero una
versione futura dell'applicazione, un disco pieno e una migrazione malformata. Con un porto
esplicito ogni ramo è tre righe di test, **ordine dei passi compreso**.

**`atomically()` invece di `transaction()`.** In questa applicazione "transazione" è già una
cosa: un movimento bancario. In `transactions.repository.ts` è persino un nome di parametro.
Il verbo dice cosa garantisce e non collide con il dominio.

---

## 5. Strategia transaction

`db/client.ts` espone un solo verbo:

```ts
export function atomically<T>(work: () => T): T {
  return sqlite.transaction(work)();
}
```

Le chiamate si annidano tramite SAVEPOINT (verifica empirica #4), quindi un servizio può
avvolgere in una transazione unica operazioni già transazionali, e l'annullamento risale alla
più esterna.

### Dove è stata applicata, e perché lì

| Punto | Ragione |
|---|---|
| `transactionsRepository.insertMany` | i blocchi da 500 sono un limite di SQLite sui parametri, non un modo di procedere a rate |
| `merchantsRepository.insertMany` | idem |
| `transactionsService.backfillFingerprints` | **letture comprese**: assegna i fingerprint evitando quelli già presi, quindi l'elenco dei presi e le scritture che lo estendono devono vedere lo stesso archivio |
| `importService.importCsv` | l'intera persistenza |

Su `importCsv` sta il punto centrale del WP. Le scritture erano **due** — prima nascono i
merchant, poi le transazioni che li citano — e separate lasciavano, in caso di guasto fra le
due, un archivio con esercenti privi di qualsiasi movimento: nessun errore visibile, un elenco
sporco per sempre. Nella transazione entra anche `detectDuplicates`, perché decide cosa
inserire in base a cosa c'è già.

L'idempotenza del fingerprint è intatta e **non** è stato aggiunto un secondo meccanismo di
deduplicazione: `import.atomicity.test.ts` lo verifica esplicitamente reimportando lo stesso
CSV tre volte (1.200 importate → 1.200 duplicate → riga nuova importata, riga già vista
duplicata).

`VACUUM INTO` non è ammesso dentro una transazione (verifica #3): `vacuumInto()` controlla
`sqlite.inTransaction` e solleva un messaggio comprensibile invece dell'errore grezzo di
SQLite. Un backup preso nel mezzo di un import non avrebbe senso.

---

## 6. Strategia backup

```
VACUUM INTO tmp/<nome>.partial
      ↓
integrity_check                    (completo, non quick_check)
      ↓
conteggi per tabella + versione dello schema
      ↓
confronto: lo schema dello snapshot == quello del database di origine
      ↓
impronta SHA-256, letta a blocchi da 1 MB
      ↓
rename manifest  →  backups/<nome>.json
      ↓
rename database  →  backups/<nome>.sqlite     ← PUNTO DI COMMIT
      ↓
pruning secondo la ritenzione
```

**Un file entra in `backups/` solo dopo essere stato riaperto e controllato.** Fino a quel
momento vive in `tmp/` col suffisso `.partial`, dove nessuna parte del sistema lo riconosce
come backup: la convenzione sui nomi lo esclude a priori, quindi un `.partial` non è mai né
elencato né candidato all'eliminazione. Non è una regola da ricordare, è una conseguenza del
formato dei nomi.

I due rename sono nello stesso volume (`tmp/` e `backups/` stanno entrambi sotto `DATA_ROOT`,
scelta deliberata di P2), quindi atomici. **Il manifest arriva per primo**: il database è il
punto di commit, e così quando il database esiste il suo manifest c'è già. L'ordine opposto
lascerebbe, in caso d'interruzione, un backup che sembra valido e non si può verificare.

### Naming

```
<tipo>-YYYYMMDD-HHmmss.sqlite        tipo ∈ {pre-migration, pre-restore, auto, manual}
```

Ora locale, come i file di log: il nome che l'utente vede corrisponde al suo orologio.
L'istante esatto e non ambiguo sta nel manifest, in ISO UTC. La data in testa rende l'ordine
alfabetico uguale a quello cronologico, quindi **nessuna parte del sistema interpreta una data
per ordinare**. Due backup nello stesso secondo non si sovrascrivono: si avanza al secondo
libero successivo, così il formato del nome resta invariato e l'ordinamento regge.

### Manifest (`<nome>.json`, accanto al database)

```json
{
  "format": "appconto-backup/1",
  "kind": "manual",
  "createdAt": "2026-09-01T08:00:00.000Z",
  "appVersion": "1.0.0",
  "schemaVersion": { "appliedCount": 9, "latestMillis": 1787738595112 },
  "databaseFile": "manual-20260901-100000.sqlite",
  "databaseBytes": 507904,
  "databaseSha256": "b68a8bf4…",
  "rowCounts": { "categories": 22, "transactions": 931, … }
}
```

Nessun percorso assoluto: la cartella dei dati deve poter essere spostata senza invalidare i
backup che contiene (verificato da test).

### Ritenzione

| Tipo | Politica |
|---|---|
| `pre-migration` | ultimi 5 |
| `pre-restore` | ultimi 3 |
| `auto` | 7 giornalieri **∪** 4 settimanali (settimana ISO 8601) |
| `manual` | mai eliminati |

È una funzione pura da nomi a nomi: non guarda il disco né l'orologio. Non tocca ciò che non
riconosce — un file estraneo, un `.partial`, un `replaced-*` — e i manifest seguono i database
che descrivono. Un manifest orfano viene rimosso come residuo di un'interruzione fra i due
rename.

Gli slot giornalieri e settimanali sono un'**unione**: si sovrappongono nella settimana
corrente, ed è ciò che fa sì che la copertura si estenda a un mese senza conservare un file
per ogni giorno del mese. Due mesi di backup giornalieri si riducono a una decina di file.

---

## 7. Strategia restore

Il ripristino avviene in **due tempi**, perché un database SQLite non si sostituisce mentre è
aperto.

### Tempo 1 — `POST /api/restore` prepara (applicazione in funzione)

```
verifica il backup       manifest + integrity_check + impronta
      ↓
compatibilità schema     uno schema più recente dell'app è rifiutato
      ↓
backup pre-restore       dell'archivio ATTUALE, con lo stesso meccanismo verificato
      ↓
copia in tmp/restore-candidate.sqlite      (copia, non spostamento: il backup resta)
      ↓
ricontrolla la copia     è un file diverso da quello verificato, e sarà lui l'archivio
      ↓
scrive restore-pending.json
```

Risposta `202`: *preparato, riavvia*. **Finché `restore-pending.json` non esiste non è stato
deciso niente**, quindi ogni passo può fermare la sequenza senza costo. Se il backup
pre-restore non riesce, il ripristino non comincia.

### Tempo 2 — l'avvio successivo applica

Dentro `db/client.ts`, sopra `new Database(...)`:

```
1. verifica di nuovo il candidato    integrità + impronta + schema
2. il marcatore passa a "applying"                  ← da qui è ricostruibile
3. database.sqlite      → tmp/replaced-<data>.sqlite
4. database.sqlite-wal  → tmp/replaced-<data>.sqlite-wal
5. rimozione di qualunque -wal/-shm residuo accanto al nome database.sqlite
6. tmp/restore-candidate.sqlite → database.sqlite   ← PUNTO DI COMMIT
7. il marcatore viene rimosso
```

La verifica si ripete perché fra la preparazione e l'avvio passa uno spegnimento: in quel
tempo il file può essere stato troncato da un disco pieno, o l'applicazione può essere stata
sostituita con una versione più vecchia.

**Il passo 4 è deliberato e corregge un difetto che avevo introdotto.** La prima stesura
cancellava il `-wal` del vecchio archivio. Ma su Windows `process.kill` termina il processo
senza consegnare il segnale, quindi il WAL non viene consolidato: quel file contiene scritture
**confermate** e non ancora trasferite. Cancellarlo avrebbe reso incompleta la copia di
sicurezza proprio nel momento in cui potrebbe servire. Ora il `-wal` segue il database che
accompagna, e `replaced-<data>.sqlite` + il suo `-wal` sono un insieme completo.

Il passo 5 è invece **necessario per la correttezza**: un `-wal` rimasto accanto al nome
`database.sqlite` verrebbe attribuito da SQLite all'archivio nuovo, a cui non appartiene.

### Punto di commit e ricostruzione

La procedura **non è atomica** — nessun filesystem scambia due file in un colpo solo — e non
finge di esserlo. Il punto di commit è il rename del passo 6. Un'interruzione lascia il
marcatore in `applying`, e l'avvio successivo capisce dallo stato del disco a che punto era
arrivato:

| Candidato | `database.sqlite` | Interpretazione | Azione |
|---|---|---|---|
| presente | presente | lo scambio non era iniziato | riprende da capo |
| presente | assente | interrotto fra i passi 3 e 6 | completa il rename |
| assente | presente | superato il punto di commit | rimuove il marcatore |
| assente | assente | il caso peggiore | rimette al suo posto `replaced-*` |

Nessun passaggio distrugge dati: il database precedente è in `tmp/` (con il suo WAL) e il
backup pre-restore è in `backups/`.

Un marcatore inutilizzabile viene messo in **quarantena** (`restore-pending.invalid.json`) e
l'applicazione parte con l'archivio esistente: un ripristino che non si può fare è un motivo
per continuare, non per non partire. Non resta al suo posto, altrimenti ogni avvio
ritenterebbe la stessa cosa impossibile.

`applyPendingRestore` non solleva mai. Nel gestore dell'errore c'è il caso che non deve
accadere in nessun modo: se il database corrente era già stato spostato via e lo scambio non
si completa, **torna al suo posto** — senza quel recupero SQLite ne creerebbe uno vuoto e
l'utente vedrebbe un conto azzerato con i propri dati in `tmp/`.

Nel marcatore i file sono nominati **relativamente** a `DATA_ROOT`: un percorso assoluto
renderebbe il file di stato valido solo dove è stato scritto, e la cartella dati deve poter
essere copiata altrove anche con un ripristino in sospeso.

### Cosa il ripristino rifiuta

file illeggibile · non-SQLite · troncato · `integrity_check` diverso da `ok` · impronta non
corrispondente · manifest assente · manifest illeggibile · formato non supportato · schema più
recente dell'applicazione · nome che non è un nome di backup.

In tutti i casi l'archivio attuale resta **byte per byte** quello di prima (verificato
confrontando l'impronta prima e dopo).

---

## 8. Strategia migration safety

Non è stato creato un secondo registro delle versioni. La verità è già scritta in due posti
che Drizzle mantiene: `__drizzle_migrations.created_at` nel database, `meta/_journal.json`
accanto alle migrazioni. La regola di confronto è **la stessa** che usa il migratore
(`when` strettamente maggiore dell'ultimo registrato): se divergessero, la guardia direbbe una
cosa e la migrazione ne farebbe un'altra.

```
compareSchema(database, app) →
   appliedCount = 0                → nuovo            → migra, senza backup
   database.latest >  app.latest   → più recente       → RIFIUTA L'AVVIO
   database.latest == app.latest   → allineato         → non fa niente
   database.latest <  app.latest   → da migrare        → backup, POI migra
```

Il backup si crea **solo** quando c'è davvero una migrazione da applicare: farlo a ogni avvio
riempirebbe il disco di copie identiche e renderebbe lento il caso normale, che è "non c'è
niente da fare". Un archivio appena creato non ha nulla da proteggere.

Se il backup non riesce, **la migrazione non viene tentata** e l'applicazione non parte. Se la
migrazione fallisce, l'errore porta il nome del backup da cui ripartire. Drizzle esegue tutte
le migrazioni pendenti in un'unica transazione con `ROLLBACK` al primo errore, quindi lo schema
non resta mai a metà: il test lo verifica confrontando l'elenco delle tabelle prima e dopo.

### Downgrade

Un archivio più recente non viene aperto. Su dati finanziari un adattamento silenzioso è
inaccettabile: una versione precedente non conosce le colonne aggiunte dopo di sé, scriverebbe
righe incomplete e lo farebbe senza accorgersene. Nessun tentativo di adattare, nessun
downgrade automatico, nessuna colonna ignorata.

Il messaggio è scritto per chi usa l'applicazione, non per chi la scrive, e dice le tre cose
che servono:

> Questo archivio è stato creato da una versione più recente di appConto. Contiene 10
> aggiornamenti dello schema, questa versione ne conosce 9. Aprirlo con questa versione
> significherebbe scrivere dati incompleti, quindi l'applicazione si ferma. L'archivio NON è
> stato modificato: per usarlo, installa di nuovo la versione più recente dell'applicazione.

Non nomina Drizzle, il journal né i millisecondi (verificato da test). Il processo termina con
codice diverso da zero: provato end-to-end in `restore.runtime.test.ts` avviando il bundle su
un archivio portato artificialmente nel futuro.

---

## 9. Sicurezza path e API

### Il nome è il controllo

Un client indica un backup **per nome**, e il nome passa da un'unica funzione:

```ts
export function resolveBackupFile(backupsDir: string, name: string): string | null
```

Due sbarramenti indipendenti, perché uno solo è una svista di distanza:

1. il nome deve rispettare `^(pre-migration|pre-restore|auto|manual)-\d{8}-\d{6}\.sqlite$`;
   un percorso — assoluto o relativo — semplicemente non lo è. `../../database.sqlite` non è
   un nome malevolo da neutralizzare: è un nome che non esiste;
2. il percorso risolto, dopo `path.resolve` e **non** per concatenazione, deve trovarsi
   realmente sotto la cartella consentita.

Il secondo controllo è ridondante rispetto al primo, ed è voluto: se un giorno il pattern
venisse allargato, l'invariante resterebbe.

Verificato su 18 forme di traversal (`../`, `../../`, backslash, percorsi assoluti Windows e
POSIX, UNC, `%2e%2e%2f`, `%2E%2E%5C`, `..%2f`, byte nullo, sottocartelle) sia a livello di
funzione pura sia attraverso HTTP, dove Express decodifica le forme percentuali prima che
arrivino al parametro.

### API

```
GET    /api/backups        elenco + eventuale ripristino in attesa
POST   /api/backups        crea un backup manuale                     → 201
GET    /api/backups/:name  scarica il file (verificato prima di servirlo)
GET    /api/restore        stato del ripristino preparato
POST   /api/restore        PREPARA il ripristino                      → 202
DELETE /api/restore        annulla un ripristino preparato
```

- **nessun percorso attraversa il confine**, né nelle risposte né nei messaggi d'errore
  (verificato cercando `DATA_ROOT`, `os.tmpdir()` e pattern di percorso nei corpi JSON);
- la versione dello schema è esposta come **numero di migrazioni**, non come istante interno;
- `POST /api/restore` risponde `202`, non `200`: accettata, non eseguita;
- le mutazioni restano coperte dalla protezione d'origine di P1: una `POST` con `Origin`
  estraneo o `Sec-Fetch-Site: cross-site` riceve `403` e non raggiunge il servizio (verificato
  su entrambi gli endpoint mutanti);
- un nome non valido è `400` (richiesta malformata), non `404`: la distinzione evita di
  suggerire che basti insistere con un altro percorso.

---

## 10. Test aggiunti

| File | Test | Cosa dimostra |
|---|---|---|
| `db/schema-version.test.ts` | 13 | confronto puro, compresa la soglia di **un millisecondo**; journal assente/illeggibile/malformato ferma tutto |
| `db/safe-migrate.test.ts` | 8 | tutti i rami e **l'ordine dei passi**; contenuto dei messaggi |
| `maintenance/backup.naming.test.ts` | 35 | naming, e 18 forme di traversal |
| `maintenance/backup.retention.test.ts` | 14 | politica per tipo, settimane ISO, capodanno, ciò che non tocca |
| `maintenance/backup.manifest.ts` (via service) | — | impronta a blocchi, ispezione, parsing difensivo |
| `maintenance/backup.service.test.ts` | 23 | creazione, manifest, verifica, elenco, ritenzione su disco, **backup durante un import** |
| `maintenance/restore-pending.test.ts` | 20 | applicazione e **tutti i modi di interromperla** |
| `maintenance/restore.service.test.ts` | 15 | preparazione e 8 forme di rifiuto, archivio invariato |
| `maintenance/maintenance.routes.test.ts` | 16 | superficie HTTP, traversal, origine estranea |
| `import/import.atomicity.test.ts` | 7 | **guasto a metà import** e idempotenza del reimport |
| `bootstrap.test.ts` | 8 | migrazione rotta reale, backup valido, downgrade rifiutato |
| `restore.runtime.test.ts` | 3 | ciclo completo su **processi veri**; REFUSE START |

Quattro test meritano una nota, perché sono quelli che dimostrano le proprietà difficili.

**§16 — backup durante un import.** In un processo Node con `better-sqlite3` sincrono la
concorrenza vera non esiste, quindi il test costruisce qualcosa di **più** avverso della
concorrenza reale: l'import di 5.000 righe gira in una transazione ancora aperta, e nello
stesso istante una seconda connessione — indipendente, come sarebbe un altro processo — prende
lo snapshot. Il lettore vede lo stato confermato, non le 5.000 righe in volo; lo snapshot ha
`integrity_check = ok` e i conteggi di prima; annullata la transazione, l'archivio è come era.
Un backup non può contenere un import a metà, e il momento in cui viene preso è garantito
essere esattamente "nel mezzo".

**§17 — crash durante import.** L'inserimento delle transazioni viene sostituito
temporaneamente con uno che scrive **metà** delle righe e poi solleva. Nessun appiglio nel
codice di produzione, e il punto di rottura è quello che conta: dentro l'operazione, dopo che
qualcosa è già stato scritto. Il controllo decisivo non è sulle transazioni ma sui **merchant**:
restano zero: è la prova che la transazione avvolge l'intera operazione e non il solo
inserimento. Poi il database si riapre integro, e lo stesso CSV si reimporta per intero senza
duplicati.

**§18 — migrazione fallita.** La fixture è una **copia** delle migrazioni reali più una voce
volutamente non valida: le migrazioni del progetto non vengono toccate, e un test finale lo
verifica rileggendo la cartella. Dopo il fallimento: il backup pre-migrazione esiste, regge la
verifica, si apre da solo con le 25 righe di prima, e lo schema del database attivo è identico
a quello precedente, elenco delle tabelle compreso.

**§13 — ripristino al riavvio.** Il solo test che poteva provarlo usa due processi veri:
prima esecuzione → 3 righe → backup → altre 2 righe → `POST /api/restore` → **ancora 5 righe**
(niente è stato sostituito) → arresto. Seconda esecuzione → **3 righe**, le righe successive al
backup non ci sono più, il marcatore è consumato, l'archivio precedente è in `tmp/`, e il
backup pre-restore contiene le 5 righe da cui si tornerebbe indietro.

---

## 11. Risultati delle suite

```
backend    459 test, 459 pass, 0 fail          (baseline P2: 297 → +162)
frontend   169 test, 169 pass, 0 fail  (19 file)   invariato
typecheck  nessun errore
build      npm run build → exit 0
           apps/backend/dist/server.js       153.933 byte
           apps/frontend/dist/.../index.html      935 byte
dev        npm run dev invariato (nessuna modifica agli script)
```

### Smoke test del bundle di produzione

Eseguito su `DATA_ROOT` temporanea e porta assegnata dal sistema (62889):

```
POST /api/backups        → 201  manual-20260901-161750.sqlite
GET  /api/backups        → 1 backup, pendingRestore: null
GET  /api/restore        → null
GET  /api/backups/%2e%2e%2f…  → 400  {"error":"Nome del backup non valido."}
GET  /api/categories     → 22    (migrazioni applicate dal bundle)
percorsi assoluti nelle risposte: nessuno
tmp/ dopo il backup: vuota
backups/: manual-20260901-161750.{sqlite,json}
```

---

## 12. Deviazioni dal piano

| Deviazione | Motivo |
|---|---|
| `POST /api/backups` invece di `POST /api/backup` | coerenza con `GET /api/backups`; §15 la indicava come "proposta iniziale" |
| Aggiunti `GET /api/restore` e `DELETE /api/restore` | senza il primo nessuna interfaccia può dire "riavvia"; senza il secondo un ripristino preparato si annulla solo riavviando — che lo **applica** — o modificando i file a mano |
| `transaction()` chiamato `atomically()` | "transazione" è già un concetto di dominio, ed è un nome di parametro in `transactions.repository.ts` |
| Il `-wal` del vecchio archivio viene **spostato**, non cancellato | §13 chiedeva di pulire i residui; cancellarlo avrebbe reso incompleta la copia di sicurezza dopo un arresto brusco (vedi §7) |
| Un backup **senza manifest non è ripristinabile** | conseguenza diretta di §11 ("non accettare un `.sqlite` solo perché SQLite lo apre"). Un `.sqlite` qualsiasi si ripristina copiandolo a mano con l'app chiusa |
| Il tipo `auto` è implementato e testato, ma **nulla lo crea** | §7 chiedeva la politica di ritenzione, che è completa e verificata; uno scheduler non è richiesto da nessun punto del DoD e §21 vieta di anticipare P4/P5 |
| `runMigrations(folder?)` ha un parametro | serve a §18 per descrivere una migrazione fallimentare senza toccare quelle reali; stesso schema di `createApp(frontendDir)` di P1 |
| Corretto il controllo di isolamento in `runtime.test.ts` | puntava ancora ad `apps/backend/data`, posizione **storica**: dopo lo spostamento dell'archivio in `data/` non avrebbe più rilevato un accesso al database reale |

---

## 13. Debiti tecnici

**`escapeLike()` — non corretto, come richiesto da §22.**
`apps/backend/src/shared/sql.ts`:

```ts
return value.replace(/[\%_]/g, (character) => `\${character}`);
```

In un template literal `\$` è un dollaro letterale: la sostituzione produce il testo
`${character}` invece del carattere precedito da backslash. Cercare `%`, `_` o `\` non
funziona. Il fix è di una riga (`` `\\${character}` `` più `\` nella classe di caratteri) ma
riguarda la ricerca, non la sicurezza dei dati, e merita un WP di manutenzione con i propri
test.

**`cors` e `@types/cors` ancora dichiarati e non usati** — residuo di P1, dove `cors()` è stato
rimosso a favore della stessa origine. Nessun `import` nel codice. Da togliere dal
`package.json`.

**Nessuna interfaccia utente per backup e ripristino** — la feature è solo API. §21 vieta
esplicitamente il redesign UI, quindi è corretto che sia così adesso; resta però che l'utente
non può usarla senza uno strumento HTTP.

**Nessun backup automatico** — i soli backup automatici sono `pre-migration` e `pre-restore`,
cioè quelli legati a un'operazione rischiosa. Un backup periodico richiede uno scheduler, che
appartiene al launcher di P5.

---

## 14. Rischi residui

**Lo scambio dei file non è atomico.** È dichiarato, non nascosto: il punto di commit è il
rename finale e la procedura è ricostruibile da `restore-pending.json` in ognuno dei quattro
stati possibili (§7). Il rischio residuo è un'interruzione durante il rename stesso — che i
filesystem trattano come operazione atomica sui metadati, quindi il caso è remoto e comunque
coperto dalle due copie che esistono in quel momento.

**Su Windows l'arresto brusco non consolida il WAL.** Limite noto da P2: `process.kill` termina
il processo senza consegnare il segnale, quindi `wal_checkpoint(TRUNCATE)` non gira. I dati non
sono a rischio — il WAL resta valido e viene consolidato al riavvio — ma il database in quel
momento non è un file singolo, e chi copiasse la cartella dovrebbe portarsi anche il `-wal`.
P3 lo tiene in conto spostando il `-wal` insieme al database che accompagna.

**La guardia sul downgrade gira dopo l'apertura della connessione.** Per leggere la versione
dello schema il database va aperto, e `client.ts` imposta `journal_mode = WAL` prima che
`bootstrap()` decida. Su un archivio già in WAL — cioè qualunque archivio prodotto da questa
applicazione — è un'operazione senza effetto: nessun dato e nessuno schema vengono modificati,
SQLite può al più creare o rimuovere il file di cache `-shm`. Il messaggio "l'archivio non è
stato modificato" è quindi vero riguardo al contenuto. Anticipare la lettura a una connessione
in sola lettura, prima dell'apertura, renderebbe la promessa vera anche a livello di byte:
è un miglioramento possibile, non necessario.

**Disco pieno al momento di una migrazione = applicazione che non parte.** È il compromesso
scelto, e va detto: se il backup obbligatorio non riesce, la migrazione non viene eseguita e
l'avvio si interrompe. L'alternativa — migrare senza rete — è precisamente ciò che questo WP
esclude. L'utente deve liberare spazio; il messaggio lo dice, insieme alla causa tecnica.

**Un backup raddoppia temporaneamente lo spazio occupato dall'archivio**, e lo spazio
disponibile non viene controllato in anticipo: se manca, `VACUUM INTO` fallisce e il backup
viene annullato senza lasciare tracce. Su un archivio molto grande il calcolo dell'impronta è
sincrono e blocca il ciclo di eventi per la durata della lettura (a blocchi da 1 MB, quindi la
memoria è limitata, non il tempo).

**Nessuna protezione contro due processi sulla stessa `DATA_ROOT`.** Rimane
un'assunzione — scrittore singolo — non un'invariante imposta. Appartiene al launcher di P5,
come già stabilito da P2.

**Il `replaced-*` non è un backup.** È una copia di comodo con ritenzione a 2, in `tmp/`. La
copia di sicurezza vera del ripristino è il backup `pre-restore`, che è verificato e sta in
`backups/` con la propria ritenzione.

---

## 15. Isolamento dal database reale

```
REAL DATABASE TOUCHED: NO
```

Non dichiarato perché i test usano database temporanei, ma **dimostrato**.

### Baseline registrata prima di scrivere codice

```
integrity      : ok
conteggi       : {"__drizzle_migrations":9,"categories":22,"loan_repayments":1,
                  "loans":2,"merchants":452,"settings":1,"transactions":931}
max created_at : 1787738595112
dimensione     : 507904 byte
sha256         : b68a8bf4323a65fc41892382ee8261496495aeaf471a55ffca76ebf42fe6d829
```

### Stato dopo l'intero WP, suite completa e smoke test di produzione compresi

```
integrity      : ok
conteggi       : {"__drizzle_migrations":9,"categories":22,"loan_repayments":1,
                  "loans":2,"merchants":452,"settings":1,"transactions":931}
max created_at : 1787738595112
dimensione     : 507904 byte
sha256         : b68a8bf4323a65fc41892382ee8261496495aeaf471a55ffca76ebf42fe6d829   ← identico
```

**Impronta identica byte per byte.** Non un conteggio uguale: lo stesso file.

Inoltre, nel `DATA_ROOT` reale: `backups/` **vuota**, `tmp/` **vuota**, nessun
`restore-pending.json`. Nessun backup, nessun ripristino, nessuna migrazione ha avuto luogo
sull'archivio dell'utente.

### Il log reale non è stato scritto

`data/logs/app-2026-09-01.log` esiste, ma la sua ultima scrittura è **15:28:22** — l'ultima
esecuzione dell'utente, precedente all'inizio di questo lavoro (concluso alle 16:18). Contiene
10 righe, zero occorrenze di `Backup creato`, `Ripristino`, `Archivio migrato`, `Archivio
creato` o `Archivio aggiornato`.

Questa verifica ha richiesto una precauzione non ovvia: in `restore-pending.test.ts` il
`DATABASE_FILE` viene impostato prima di qualunque import **anche se quel file non apre nessun
database tramite l'applicazione**, perché importare il logger legge `LOGS_DIR` da `paths.ts` e
senza quella riga i log del test sarebbero finiti nella cartella dati reale. Una porta diversa
non basta, e nemmeno un database temporaneo: conta ogni percorso che un modulo deduce
all'importazione.

### Audit di tutti i file di test

28 file di test nel backend. 19 impostano `DATABASE_FILE` su una cartella temporanea prima di
qualsiasi import. I 9 che non lo fanno sono stati verificati uno per uno con una chiusura
transitiva degli import: **nessuno raggiunge `db/client.js`**, direttamente o indirettamente.

```
db/safe-migrate.test.ts                    puro, con dipendenze finte
db/schema-version.test.ts                  puro + database temporanei propri
maintenance/backup.naming.test.ts          puro
maintenance/backup.retention.test.ts       puro
transactions/transaction-fingerprint.test.ts   puro
transactions/transaction-type.test.ts      puro
paths.test.ts                              puro (resolvePaths)
runtime.test.ts                            processi figli, ambiente costruito
restore.runtime.test.ts                    processi figli, ambiente costruito
```

I due file che avviano processi cancellano `DATABASE_FILE` e `PORT` dall'ambiente del figlio
invece di ereditarli, impostano `MYFINANCE_DATA` su una cartella temporanea, e **leggono dal
log del figlio quali percorsi ha effettivamente usato**: l'isolamento è verificato dal processo
stesso, non assunto. Entrambi controllano le due radici dati reali, `data/` e la posizione
storica `apps/backend/data`.

### Smoke test di produzione: i cinque punti

| # | Richiesto | Dimostrato |
|---|---|---|
| 1 | quale processo possiede la porta | porta **62889**, assegnata dal sistema con `listen(0)`, mai 3000 — verificato che nessun processo era in ascolto su 3000 prima di iniziare |
| 2 | quale PID | **27932**, il processo generato dallo script |
| 3 | quale `DATABASE_FILE` / `DATA_ROOT` | letti **dal log del processo stesso**: `…\Temp\appconto-smoke-o2wsOx\database.sqlite`; controllato che non inizi per il `DATA_ROOT` reale |
| 4 | il database di test è temporaneo | sotto `%TEMP%`, creato con `mkdtempSync`, diverso dal `DATA_ROOT` reale |
| 5 | il processo avviato è quello che riceve le richieste | `POST /api/backups` ha risposto 201, e il file è comparso **nella cartella temporanea che il processo aveva dichiarato**: la richiesta non può essere arrivata altrove |

Durante il WP un processo di smoke test è rimasto orfano per un errore dello script di verifica
(PID 21076): è stato terminato, e la porta 3000 è stata ricontrollata come libera. Nessuna
richiesta era stata inviata da quello script prima dell'errore.

---

## Definition of Done

### Atomicità
- [x] `insertMany` è atomico — transazioni e merchant
- [x] `backfillFingerprints` è atomico, letture comprese
- [x] crash/errore durante l'import non lascia un import parziale — provato con guasto a metà
- [x] il reimport dello stesso CSV resta idempotente — nessun secondo meccanismo di dedup

### Backup
- [x] backup tramite `VACUUM INTO`
- [x] file temporaneo sotto `DATA_ROOT/tmp`
- [x] `integrity_check` obbligatorio
- [x] conteggi verificati e registrati nel manifest
- [x] rename atomico nello stesso volume — verificato che i due percorsi condividono la radice
- [x] `.partial` mai presentato come backup valido — escluso dalla convenzione sui nomi
- [x] naming deterministico e ordinabile
- [x] ritenzione implementata e testata per tutti i quattro tipi

### Migrazioni
- [x] backup automatico prima della migrazione
- [x] la migrazione non parte se il backup fallisce
- [x] fallimento della migrazione testato con una fixture reale
- [x] backup pre-migration verificato e apribile da solo
- [x] downgrade rifiutato esplicitamente, in-process ed end-to-end

### Restore
- [x] backup validato prima di essere applicato — due volte: alla richiesta e all'avvio
- [x] impronta verificata
- [x] `integrity_check` verificato
- [x] compatibilità di schema verificata
- [x] backup pre-restore creato, e il restore non procede se fallisce
- [x] restore staged
- [x] database attivo mai sostituito mentre è aperto
- [x] `restore-pending.json` persistente, con percorsi relativi
- [x] restore corrotto/troncato rifiutato — 8 forme
- [x] database corrente invariato in caso di restore fallito — verificato per impronta

### Sicurezza
- [x] nessun directory traversal — 18 forme, a livello di funzione e via HTTP
- [x] nessun percorso assoluto esposto dalle API
- [x] nessun backup scritto fuori da `DATA_ROOT`
- [x] nessun dato reale usato nei test distruttivi — §15

### Regression
- [x] suite backend verde — 459/459
- [x] suite frontend verde — 169/169
- [x] typecheck verde
- [x] build di produzione verde, e il bundle provato
- [x] `npm run dev` invariato
- [x] P1/P2 non regressi

---

## Il quadro, alla fine

```
SQLite WAL
    │
    ├── atomically()      → tutto o niente, anche fra due scritture diverse
    │
    ├── checkpoint        → alla chiusura: un file singolo, copiabile        (P2)
    │
    ├── VACUUM INTO       → snapshot consistente, senza fermare l'app
    │
    ├── integrity_check   → un backup è tale solo dopo essere stato riletto
    │
    ├── pre-migration     → nessun aggiornamento dello schema senza rete
    │
    ├── downgrade guard   → un archivio più recente non si apre
    │
    └── staged restore    → si sostituisce quando nessuno tiene il file
```

Nessun sistema di gestione database è stato costruito. Ogni pezzo è una primitiva che SQLite
già offre, messa nel punto in cui serve, con una verifica che dice se ha funzionato.

Il prossimo passo sensato non è dentro questo perimetro: è il packaging (P4) e il launcher
(P5), che chiuderanno l'ultima assunzione rimasta — lo scrittore singolo — e daranno un posto
allo scheduler dei backup automatici, la cui politica di ritenzione è già scritta e provata.
