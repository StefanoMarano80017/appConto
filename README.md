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
3. Nel **Riepilogo** scegliere il mese: entrate, uscite, saldo e spese per
   categoria vengono ricalcolati. Sotto, la tabella delle transazioni.
4. Nella colonna **Tipo** correggere i movimenti che non sono spese reali:
   un prelievo al bancomat, un giroconto o un prestito escono dal totale delle
   uscite e dalle categorie, ma restano nel cash flow.
5. In **Merchant** filtrare su *Da classificare* per assegnare una categoria
   agli esercenti non ancora classificati, partendo da quelli su cui si è speso
   di più. Qui è anche possibile rinominarli: il nome originale della banca
   resta comunque memorizzato.

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
| GET    | `/transactions`              | Elenco delle transazioni, con merchant e relativa categoria  |
| GET    | `/merchants`                 | Elenco dei merchant, con la categoria assegnata              |
| GET    | `/merchants/summary`         | Merchant con transazioni, totale speso e ultima transazione  |
| PATCH  | `/merchants/:id`             | Rinomina il merchant (`{"displayName": "…"}`, `""` ripristina) |
| PATCH  | `/merchants/:id/category`    | Assegna la categoria (`{"categoryId": "…"}`, `null` la toglie) |
| GET    | `/categories`                | Elenco delle categorie                                       |
| PATCH  | `/transactions/:id/type`     | Corregge la natura del movimento (`{"type": "WITHDRAWAL"}`)  |
| GET    | `/summary?month=YYYY-MM`     | Riepilogo del mese (calcolato, mai memorizzato)              |
| GET    | `/cash-flow?month=YYYY-MM`   | Saldo di partenza, movimenti netti e saldo disponibile del mese (senza `month`: tutto l'archivio) |
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
