# Personal Finance Tracker

Applicazione web locale per analizzare gli estratti conto bancari esportati in CSV.

La documentazione di progetto si trova in [docs/architecture/](docs/architecture/).

## Stato

- **WP1 — CSV Import Foundation**: import di un CSV, persistenza delle transazioni
  in SQLite e visualizzazione dell'elenco.
- **WP2 — Merchant Domain**: ogni transazione importata viene associata ad un
  merchant, creato una sola volta a partire dalla descrizione normalizzata.
- **WP3 — Category**: ad ogni merchant può essere assegnata una categoria di
  spesa; le sue transazioni la ereditano automaticamente.
- **WP4 — Import Reliability**: l'importazione è idempotente. Reimportare lo
  stesso estratto conto non crea duplicati e restituisce un riepilogo.
- **WP5 — Monthly Summary**: la home mostra entrate, uscite, saldo e spese per
  categoria del mese selezionato, sempre ricalcolate dalle transazioni.
- **WP6 — Merchant Workspace**: una sezione dedicata ai merchant, con totali
  calcolati, ricerca, filtri e rinomina.
- **WP7 — Transaction Types & Cash Flow**: ogni movimento ha una natura
  (spesa, entrata, prelievo, prestito, trasferimento, altro); solo le spese
  reali entrano nel riepilogo, mentre il cash flow considera tutto.
- **WP7.2 — Cash Flow Dashboard**: card "Liquidità" nella home e pagina
  impostazioni per il saldo di partenza.
- **WP8 — Dashboard Analytics**: filtri condivisi (mese, tipo, categoria,
  merchant), drill down categoria → merchant → transazioni, top merchant e
  confronto con il mese precedente.
- **WP8.1 — Analytics & Time Range**: una pagina dedicata all'analisi storica,
  con periodo libero, filtri combinabili, andamento nel tempo, distribuzione
  per categoria e merchant e sezione prestiti.
- **WP8.2 — Transaction Explorer**: la pagina **Movimenti**, con ricerca,
  filtri, ordinamento e paginazione eseguiti dal database e criteri scritti
  nell'indirizzo. Analytics resta una dashboard e vi rimanda già filtrata.
- **WP9 — Loan Management & Repayments**: un dominio dedicato ai prestiti. Una
  transazione `LOAN` racconta cosa è uscito dal conto; il **prestito** racconta
  quanto denaro si attende indietro, e le **restituzioni** — bancarie o in
  contanti — lo riducono. Credito residuo e stato sono sempre calcolati.

## Avvio

Servono due terminali.

```bash
# 1. backend Express -> http://localhost:3000
npm install
npm run dev:backend

# 2. frontend Angular -> http://localhost:4200
npm run dev:frontend
```

Il database SQLite viene creato automaticamente in `apps/backend/data/appconto.db`
al primo avvio, applicando le migrazioni presenti in `apps/backend/drizzle/`.
Le migrazioni successive vengono applicate ad ogni avvio, senza perdere i dati
già presenti. Per ripartire da zero è sufficiente eliminare la cartella
`apps/backend/data/`.

## Utilizzo

1. Aprire <http://localhost:4200>. In **Impostazioni** indicare il saldo del
   conto ad una certa data: è il punto di partenza del calcolo della liquidità.
2. Nella schermata **Import CSV** selezionare un estratto conto e premere *Importa*.
3. Nel **Riepilogo** scegliere il mese: tutte le sezioni — liquidità, spese per
   categoria, top merchant, confronto col mese precedente e tabella dei
   movimenti — seguono la stessa selezione. Cliccando un merchant o *filtra* su
   una categoria si restringe l'analisi; *Azzera filtri* la riapre.
4. In **Analytics** scegliere un periodo — un mese, un trimestre, un anno o due
   date qualsiasi — e combinare i filtri per tipo, categoria, merchant e stato
   di classificazione. L'**andamento nel tempo** è una spezzata di entrate e
   uscite a passo settimanale (commutabile su giorno o mese) che segue gli
   stessi filtri: scegliendo *Tabacco* mostra solo quelle uscite, settimana per
   settimana. I valori si leggono passando il mouse, con le freccie da tastiera
   o aprendo la tabella sotto il grafico; i punti vuoti sono intervalli
   incompleti. Cliccando una categoria o un merchant si passa ai movimenti.
5. In **Movimenti** cercare e filtrare l'archivio: la ricerca guarda la
   descrizione della banca, il nome dell'esercente e quello scelto da te.
   I criteri stanno nell'indirizzo, quindi un filtro si può ricaricare,
   condividere e ritrovare con il tasto *indietro*. Da Analytics si arriva qui
   già filtrati cliccando una categoria, un merchant o i prestiti.
   Nella colonna **Tipo** correggere i movimenti che non sono spese reali:
   un prelievo al bancomat, un giroconto o un prestito escono dal totale delle
   uscite e dalle categorie, ma restano nel cash flow.
6. In **Prestiti** vedere quanto denaro è ancora fuori casa: prestato,
   restituito, da ricevere e quanti prestiti sono aperti. Un prestito **non**
   nasce dall'import — l'estratto conto non sa chi ha ricevuto il denaro: si
   crea da **Movimenti**, dove ogni riga di tipo *Prestito* offre *Crea
   prestito*. Nel dettaglio si registrano le restituzioni, con o senza il
   movimento bancario corrispondente, e il credito residuo si aggiorna da sé.
7. In **Merchant** filtrare su *Da classificare* per assegnare una categoria
   agli esercenti non ancora classificati, partendo da quelli su cui si è speso
   di più. Qui è anche possibile rinominarli: il nome originale della banca
   resta comunque memorizzato.

### Prestiti e liquidità sono due cose diverse

Sono la distinzione più importante da tenere a mente:

| | Risponde a | |
|---|---|---|
| **Liquidità** | cosa è successo al conto | un prestito di 80 € sposta il saldo di −80 € |
| **Prestito** | quanto denaro devo ancora ricevere | quegli 80 € sono un credito, non una spesa |

Le conseguenze pratiche:

- una restituzione **in contanti** riduce il credito ma **non** muove la
  liquidità: nessun movimento bancario è avvenuto, e non ne viene inventato uno;
- una restituzione **bancaria** viene collegata alla transazione già importata,
  che resta la normale entrata che è. Il collegamento aggiunge significato, non
  cambia il tipo del movimento e non conta il denaro due volte: la transazione
  appartiene alla liquidità, la restituzione al calcolo del credito;
- Analytics continua a essere una proiezione delle sole transazioni e non
  duplica i dati dei prestiti: la sezione *Prestiti* rimanda al workspace.

### Prestiti parziali

Una stessa transazione può finanziare **più prestiti** — un pagamento che copre
l'assicurazione di due persone — purché la somma dei crediti non superi l'importo
del movimento.

Da qui la regola che conta: **la quota di un movimento `LOAN` non attribuita a
nessun prestito è una spesa tua**, e viene trattata come tale.

Un pagamento di 1.920 € di cui 1.030 € anticipati per un'altra persona:

| | Importo | Perché |
|---|---|---|
| Liquidità | −1.920 € | dal conto sono usciti tutti |
| Uscite del mese e categoria | 890 € | quelli non prestati li hai spesi tu |
| Patrimonio | −890 € | i 1.030 € sono diventati un credito, non una perdita |
| Prestato | 1.030 € | il credito da incassare |

Finché non registri il prestito la ripartizione non è nota, e il movimento resta
**tutto** credito: è l'ipotesi prudente, perché contare come spesa denaro che ti
aspetti indietro sarebbe peggio. Registrato il prestito, la ripartizione diventa
nota e le uscite si aggiornano. Incassare la restituzione non cambia gli 890 €:
quella spesa è già avvenuta.

Il modulo *Crea prestito* mostra la conseguenza mentre digiti l'importo, e il
dettaglio del prestito la ripete accanto al movimento d'origine.

Un file di esempio è disponibile in [samples/estratto-conto-esempio.csv](samples/estratto-conto-esempio.csv).

### Formato CSV atteso

Sono richieste tre informazioni; le colonne vengono riconosciute tramite alias
(maiuscole/minuscole e suffissi di valuta indifferenti, quindi `Importo ( € )`
e `Importo (EUR)` valgono come `Importo`):

| Campo       | Intestazioni accettate, in ordine di preferenza                               |
|-------------|--------------------------------------------------------------------------------|
| data        | `Data contabile`, `Data operazione`, `Data`, `Date`, `Data valuta`             |
| descrizione | `Descrizione`, `Causale`, `Description`, `Dettagli`, `Nome`, `Tipologia`       |
| importo     | `Importo`, `Amount`, `Valore`                                                  |

Se il file contiene più colonne compatibili con lo stesso campo, per ogni riga
viene usato il **primo valore non vuoto** nell'ordine indicato: una riga con
`Descrizione` vuota ricade su `Nome` invece di essere scartata.

- separatore `,` oppure `;` (riconosciuto automaticamente);
- date `31/12/2025`, `31-12-2025`, `31.12.2025` oppure `2025-12-31`;
- importi `-1.234,56`, `1234.56`, `€ 12,00` — negativo = uscita.

Le righe non convertibili vengono scartate e segnalate nell'esito dell'import;
le altre vengono comunque importate.

### Importazioni ripetute

Ogni transazione è identificata da un **fingerprint** calcolato su data
contabile, importo in centesimi e descrizione, più un progressivo che distingue
movimenti realmente identici avvenuti lo stesso giorno. Reimportare lo stesso
file, o due estratti conto con periodi sovrapposti, non crea duplicati:
vengono archiviate solo le transazioni non ancora presenti.

Al termine l'import restituisce un riepilogo con righe lette, transazioni
nuove, duplicate, righe scartate e merchant creati.

## API

| Metodo | Rotta                        | Descrizione                                                  |
|--------|------------------------------|--------------------------------------------------------------|
| POST   | `/import/csv`                | Importa un CSV (body testuale, `text/csv`)                   |
| GET    | `/transactions`              | Ricerca paginata: `from`, `to`, `search`, `types`, `categoryIds`, `merchantIds`, `classification`, `minAmount`, `maxAmount`, `page`, `pageSize`, `sortBy`, `sortDirection` |
| GET    | `/transactions/:id`          | Una singola transazione, con il proprio merchant             |
| GET    | `/merchants`                 | Elenco dei merchant, con la categoria assegnata              |
| GET    | `/merchants/summary`         | Merchant con transazioni, totale speso e ultima transazione  |
| PATCH  | `/merchants/:id`             | Rinomina il merchant (`{"displayName": "…"}`, `""` ripristina) |
| PATCH  | `/merchants/:id/category`    | Assegna la categoria (`{"categoryId": "…"}`, `null` la toglie) |
| GET    | `/categories`                | Elenco delle categorie                                       |
| PATCH  | `/transactions/:id/type`     | Corregge la natura del movimento (`{"type": "WITHDRAWAL"}`)  |
| GET    | `/dashboard?month=YYYY-MM`   | Vista aggregata della home; accetta `type`, `categoryId`, `merchantId` |
| GET    | `/analytics?from=&to=`       | Analisi di un periodo; accetta `types`, `categoryIds`, `merchantIds` (elenchi separati da virgole), `classification` e `granularity` (`day`, `week`, `month`) |
| GET    | `/summary?month=YYYY-MM`     | Riepilogo del mese (calcolato, mai memorizzato)              |
| GET    | `/cash-flow?month=YYYY-MM`   | Saldo di partenza, movimenti netti e saldo disponibile del mese (senza `month`: tutto l'archivio) |
| GET    | `/loans`                     | Prestiti con residuo e stato, più i totali della posizione; accetta `status` (`open`, `settled`, `all`), `borrower`, `search`, `sortBy` (`remainingAmount`, `lentAt`, `amount`, `borrower`), `sortDirection` |
| GET    | `/loans/links`               | Indice dei movimenti che hanno un prestito dietro, per l'esplorazione |
| GET    | `/loans/:id`                 | Dettaglio con movimento d'origine e storico delle restituzioni |
| POST   | `/loans`                     | Crea il credito nato da una transazione `LOAN` (`transactionId`, `borrowerName`, `description`, `amount`, `lentAt`) |
| PATCH  | `/loans/:id`                 | Corregge persona, descrizione, importo o data                 |
| DELETE | `/loans/:id`                 | Elimina un prestito **senza** restituzioni (altrimenti `409`) |
| POST   | `/loans/:id/repayments`      | Registra una restituzione (`amount`, `repaymentDate`, `note`, `transactionId` opzionale) |
| PATCH  | `/loans/:id/repayments/:rid` | Corregge una restituzione                                     |
| DELETE | `/loans/:id/repayments/:rid` | Elimina una restituzione: il credito torna a comprenderla     |
| GET    | `/settings`                  | Saldo iniziale e sua data                                    |
| PATCH  | `/settings`                  | Aggiorna `initialBalance` e/o `balanceDate`                  |
| GET    | `/health`                    | Stato del servizio                                           |

## Comandi

| Comando                      | Descrizione                                   |
|------------------------------|-----------------------------------------------|
| `npm run dev:backend`        | Backend in watch mode                         |
| `npm run start:backend`      | Backend senza watch                           |
| `npm run typecheck:backend`  | Type check del backend                        |
| `npm test`                   | Test backend + frontend                       |
| `npm run test:backend`       | Test del backend (`node:test`)                |
| `npm run test:frontend`      | Test del frontend (vitest)                    |
| `npm run db:generate`        | Genera le migrazioni Drizzle dallo schema     |
| `npm run dev:frontend`       | Dev server Angular                            |
| `npm run build:frontend`     | Build di produzione del frontend              |
