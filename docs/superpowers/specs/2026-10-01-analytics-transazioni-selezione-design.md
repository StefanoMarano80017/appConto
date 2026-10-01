# Analytics: le transazioni dietro un elemento del grafico

Data: 2026-10-01 · Stato: approvato in brainstorming, da pianificare

## Revisione 2026-10-01: la tabella è sempre visibile

Approvata dopo la prima implementazione; dove contraddice il resto del
documento, vale questa sezione.

- **Sempre presente**: con dati non vuoti, `AnalyticsTransactions` sta
  **subito dopo `app-analytics-timeline` e prima di `.columns`**, non più fra
  le colonne e i prestiti, e non aspetta un click.
- **Senza selezione** mostra le prime 25 transazioni del periodo con i filtri
  attivi di Analytics (`{ ...EMPTY_QUERY, from, to, types, categoryIds,
  merchantIds, classification }`), titolo «Transazioni del periodo». Con una
  selezione la query aggiunge `selectionCriteria(sel)` come prima, titolo
  «Transazioni · {etichetta}». L'input `selection` diventa
  `AnalyticsSelectionValue | null`; le righe attenuate restano finché la
  "selezione" non cambia, e `null` → `null` conta come la stessa.
- **Il merchant torna a navigare** verso `/transactions` con
  `explorerParams({ merchantIds: [id] })`. La variante `merchant` esce da
  `AnalyticsSelectionValue`, `selectionCriteria`, `isSelectionAvailable` e
  `selectionLabel`.
- **«Mostra tutto» al posto della ×**: un pulsante testuale, solo con una
  selezione attiva, che chiama `clear()` e riporta la tabella al periodo. L'output
  `closed` diventa `cleared`. Un elemento sparito dai nuovi dati fa lo stesso:
  la selezione cade, la tabella resta e torna al periodo.
- **Niente scroll né focus automatici**: via l'effetto con `scrollIntoView` e
  il focus sul titolo, `revealOnInit`, `initialSelection`, il focus dopo la
  chiusura e il `tabindex="-1"` sul titolo. L'intestazione torna un
  `SectionHeader`.
- Invariati: la selezione persiste fra le visite (servizio root), il
  caricamento e l'errore del pannello, `aria-busy`, il link in fondo «Vedi le N
  transazioni del periodo →».

## Obiettivo

In Analytics, cliccando un elemento di un grafico si vedono **subito, senza
cambiare pagina**, le transazioni che lo compongono. La tabella delle
transazioni esce dalla dashboard, che resta un riepilogo.

Criterio di successo: un click su un bucket dell'andamento, su una categoria
(fetta o riga) o su un merchant apre sotto i grafici un pannello con le
transazioni coinvolte. Da lì si apre la stessa selezione in Movimenti con un
link.

## Decisioni prese

| Tema | Decisione |
|---|---|
| Sorgenti | Tutti e tre: andamento nel tempo (bucket), categorie (fetta o riga), merchant (riga). |
| Navigazione | Il click **non** porta più a `/transactions`: riempie il pannello. Nel pannello c'è il link «Apri in Movimenti →». |
| Quantità | Anteprima: le prime 25 (il `pageSize` più piccolo che il backend accetta: 25, 50, 100), per data decrescente, con «Mostrate 25 di N». |
| Dashboard | La sezione «Transazioni» si rimuove del tutto. |
| Cambio di periodo o filtri | La selezione resta e si ricarica. Si chiude se l'elemento non esiste più nei nuovi dati. |
| Dove vive la selezione | Servizio root separato (approccio B): sopravvive alla navigazione. |
| Modifica | Nessuna: la tabella è in `mode="readonly"`. Per correggere si va in Movimenti. |

Fuori perimetro (YAGNI): evidenziare sul grafico l'elemento selezionato,
ordinamento cliccabile nel pannello, paginazione nel pannello, selezione
nell'URL, togliere `transactions` dalla risposta della dashboard.

## Architettura

```
AnalyticsTimeline ─ transactionsRequested(TimelineSelection) ┐
AnalyticsCategories ─ categorySelected(id | null) ───────────┼─▶ AnalyticsPage ──select()──▶ AnalyticsSelection (root)
AnalyticsMerchants ─ merchantSelected(id) ───────────────────┘        │                        │ selection()
                                                                       │◀───────────────────────┘
                                                     selectionQuery(selection, store) = TransactionQueryState
                                                                       ▼
                                                       AnalyticsTransactions (httpResource)
                                                                       ▼
                                                 <app-transactions-table mode="readonly">
```

### 1. `AnalyticsSelection`: `features/analytics/analytics-selection.ts`

Servizio `@Injectable({ providedIn: 'root' })`, separato da `AnalyticsStore`.
Lo store non si tocca: oltre a restare piccolo, così il controllo «dominio
intatto» del gate, che segnala ogni `*.store.ts` modificato, resta verde.

```ts
export type AnalyticsSelectionValue =
  | { kind: 'period'; granularity: TimelineGranularity; period: string; range: DateRange; label: string }
  | { kind: 'category'; categoryId: string | null; name: string }
  | { kind: 'merchant'; merchantId: string; name: string };
```

- `selection: Signal<AnalyticsSelectionValue | null>`, `select(value)`, `clear()`.
- Riselezionare lo stesso elemento non lo deseleziona: la chiusura passa solo dal pulsante ×.

Nello stesso file ci sono due **funzioni pure**, testate a parte:

- `selectionCriteria(selection): Partial<TransactionQueryState>` traduce la
  selezione nei criteri della query. È la stessa traduzione che oggi fa la
  navigazione della pagina:
  - period → `{ from, to }` del bucket;
  - category con id → `{ categoryIds: [id], types: ['EXPENSE'] }`;
  - category `null` → `{ classification: 'unclassified', types: ['EXPENSE'] }`;
  - merchant → `{ merchantIds: [id] }`.
- `isSelectionAvailable(selection, data: Analytics): boolean` dice se
  l'elemento selezionato esiste nei dati caricati:
  - period: `data.timeline.granularity === granularity` e un bucket con quel `period`;
  - category: una voce di `data.byCategory` con quel `categoryId`, `null` compreso;
  - merchant: una voce di `data.byMerchant` con quel `merchantId`.

### 2. Modifiche ai componenti esistenti di Analytics

- **`AnalyticsTimeline`**: `transactionsRequested` emette
  `TimelineSelection = { granularity, period, range, label }` invece di
  `DateRange`. `label` è `GRANULARITY[g].long(period)`, per esempio «settimana del 10 marzo 2026».
  Il tipo è esportato dal file del componente, non da `analytics.model.ts`, che resta invariato.
- **`AnalyticsCategories`** e **`AnalyticsMerchants`**: gli output restano
  quelli di oggi. Il nome per il titolo la pagina lo ricava da `data.byCategory`
  o `data.byMerchant`. «Da classificare» quando `categoryId` è `null`.
- **`AnalyticsPage`**:
  - i tre handler chiamano `selection.select(…)` invece di `openExplorer`.
    `openExplorer` resta solo se ha ancora altri usi, altrimenti si rimuove;
  - `panelQuery = computed(() => …)` costruisce la `TransactionQueryState` con
    `{ ...EMPTY_QUERY, ...periodo e filtri dello store, ...selectionCriteria(sel), page: 1, pageSize: EMPTY_QUERY.pageSize (25), sortBy: 'bookingDate', sortDirection: 'desc' }`;
  - un `effect` sui dati caricati: se la selezione c'è e `!isSelectionAvailable(sel, data)`, chiama `clear()`.
    Gira anche al rientro nella pagina, perché la selezione è persistita;
  - il pannello sta fra `.columns` (categorie e merchant) e `app-analytics-loans`,
    solo con una selezione e solo quando i dati non sono vuoti.

### 3. `AnalyticsTransactions`: `features/analytics/analytics-transactions.{ts,html,scss}`

**Input**: `selection` (required), `query: TransactionQueryState` (required).
**Output**: `closed`.

- **Caricamento**: `httpResource<TransactionPage>(() => transactionsRequest(this.query()))`.
- **Intestazione** (`SectionHeader`):
  - titolo «Transazioni · {etichetta}», dove l'etichetta è la `label` del bucket,
    il nome della categoria (o «Da classificare») oppure il nome del merchant;
  - il titolo ha `tabindex="-1"`;
  - nelle `panelActions` c'è il pulsante × con `aria-label="Chiudi dettaglio"`.
- **Corpo**:
  - **prima risposta**: «Caricamento in corso…»;
  - **ricaricamento**: le righe precedenti restano, con la classe `.stale`;
  - **errore**: `app-error-retry`, la cui azione ricarica la risorsa;
  - **zero righe**: `app-empty-state` con «Nessuna transazione per questa selezione.»;
  - **altrimenti**: `<app-transactions-table mode="readonly" [typeOptions]="TRANSACTION_TYPE_OPTIONS" [showTotal]="items.length === total">`.
- **Piede**:
  - con righe parziali: «Mostrate {n} di {total} · Apri in Movimenti →»;
  - altrimenti: «{total} transazioni» (singolare con 1) «· Apri in Movimenti →»;
  - il link è `routerLink="/transactions"` con `toQueryParams(query)`: il pannello usa già il `pageSize` predefinito, quindi Movimenti apre la stessa prima pagina.
- **Focus e scroll**: a ogni cambio di selezione, dopo il render, il componente
  porta il pannello in vista (`scrollIntoView({ block: 'nearest' })`) e mette il
  focus sul titolo. Alla chiusura la pagina porta il focus sul primo titolo
  della pagina Analytics. Non si torna all'elemento del grafico, perché un punto
  del canvas non si rimette a fuoco in modo affidabile.

### 4. Tabella condivisa: input `showTotal`

`shared/ui/transactions-table` riceve `showTotal = input(true)`. Con `false`
il `tfoot` non viene reso. Senza questo input, con 25 righe su 312 «Totale del
periodo mostrato» sommerebbe solo l'anteprima, che è fuorviante. Il totale della
selezione intera è comunque già nel grafico.

### 5. Dashboard

Si rimuove il pannello «Transazioni» da `dashboard-page.html`, con l'import di
`TransactionsTable`, quello di `TRANSACTION_TYPE_OPTIONS` e gli stili usati
solo da lui (`.count`, `.message`, se non servono altrove). `dashboard.model.ts`
e il backend non cambiano: `activeFilters()` usa ancora `data.transactions`
per il nome del chip del merchant. Toglierle dalla risposta è un possibile
seguito, separato.

## Errori e casi limite

- Errore HTTP nel pannello: `ErrorRetry` dentro il pannello. Il resto di Analytics non ne risente.
- Selezione su un elemento sparito dopo un cambio di filtri, periodo o granularità: il pannello si chiude.
- Bucket parziale (`partial`): il range del bucket sostituisce il periodo dello store, com'era già per la navigazione verso Movimenti.
- Categoria con un filtro di categorie già attivo: `categoryIds` è sostituito da `[id]`, stessa semantica di `explorerParams(extra)` di oggi.
- Ritorno su Analytics con la selezione persistita e dati ancora in caricamento: la verifica si fa all'arrivo dei dati, non prima.

## Test (TDD, Vitest)

- `analytics-selection.spec.ts`:
  - `select`/`clear`;
  - `selectionCriteria` per ogni `kind`, compresa la categoria `null`;
  - `isSelectionAvailable` nei casi presente, assente e granularità diversa.
- `analytics-transactions.spec.ts`:
  - la richiesta con `pageSize` 25 (cioè assente dalla query string, perché è il predefinito), `sortBy=bookingDate`, `sortDirection=desc` e i criteri;
  - il titolo per ogni `kind`;
  - «Mostrate 25 di N» con il `tfoot` assente, «N transazioni» con il `tfoot` presente, il singolare;
  - caricamento, errore con riprova, vuoto;
  - × emette `closed`;
  - i parametri del link verso Movimenti;
  - la tabella è readonly: nessun `select`, nessuna checkbox.
- `analytics-timeline.spec.ts`: il nuovo payload di `transactionsRequested`.
- `analytics-page.spec.ts`:
  - un click su bucket, categoria o merchant **non naviga** e apre il pannello;
  - il cambio di un filtro ricarica il pannello con i nuovi criteri;
  - il cambio di granularità chiude una selezione di tipo period;
  - la selezione resta uscendo e rientrando dalla pagina;
  - × chiude.
  
  I test che oggi si aspettano la navigazione vanno aggiornati.
- `shared/ui/transactions-table.spec.ts`: `showTotal=false` non rende il `tfoot`.
- `dashboard-page.spec.ts`: la dashboard non contiene `app-transactions-table`.
- Verifica finale: tutta la suite frontend, `ng build`, `scripts/design-system-gate.sh`.
  I 2 test di `analytics-filters.spec.ts` sono già rossi su `e079c52` e non sono in
  perimetro: si segnalano, non si toccano.

## Documentazione

`docs/architecture/frontend-shared-components-proposal.md` §11: la riga di
Analytics aggiunge il pannello `AnalyticsTransactions`, che usa la tabella
condivisa in readonly. La riga della dashboard toglie `TransactionsTable`.
