# Transazioni della selezione in Analytics: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** in Analytics un click su un bucket, una categoria o un merchant apre sotto i grafici un pannello con le transazioni coinvolte, senza cambiare pagina. La dashboard perde la tabella.

**Architecture:** la selezione vive nel servizio root `AnalyticsSelection` e sopravvive alla navigazione. `AnalyticsPage` traduce i tre output dei grafici in una selezione, ne ricava una `TransactionQueryState` e la passa al pannello di feature `AnalyticsTransactions`. Il pannello carica con `httpResource` e rende la tabella condivisa in readonly. Un `effect` della pagina chiude la selezione quando l'elemento non esiste più nei dati.

**Tech Stack:** Angular (standalone, signals, control flow), `httpResource`, Vitest via `ng test`, `HttpTestingController`.

**Spec:** `docs/superpowers/specs/2026-10-01-analytics-transazioni-selezione-design.md`

## Global Constraints

- Comandi da `apps/frontend`: test `npm test -- --watch=false` (un file: `npm test -- --watch=false --include <path>`), build `npx ng build`, gate `bash scripts/design-system-gate.sh`.
- Il gate deve restare verde. Nessun `*.model.ts`, `*.api.ts`, `*.store.ts` o `*.query.ts` di feature modificato, nessun file sotto `apps/backend`, niente stringa `features/` sotto `shared/`, spaziature, raggi e font solo da token.
- `pageSize` del pannello = `EMPTY_QUERY.pageSize` (25): il backend accetta solo 25, 50 e 100.
- Ordinamento del pannello: `sortBy: 'bookingDate'`, `sortDirection: 'desc'`, `page: 1`.
- Testi: titolo «Transazioni · {etichetta}»; «Da classificare» per la categoria `null`; «Mostrate {n} di {total} · Apri in Movimenti →»; «{total} transazioni» / «1 transazione»; «Nessuna transazione per questa selezione.»; «Caricamento in corso…»; `aria-label="Chiudi dettaglio"`.
- Commenti e nomi dei test in italiano, con la densità di commento dei file vicini. Commit in stile conventional italiano, con la riga finale `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- I 2 test rossi di `analytics-filters.spec.ts` sono preesistenti (rossi anche su `e079c52`): non toccarli. «Suite verde» qui significa: nessun altro fallimento.

## Review Focus

1. **Due click rapidi** (categoria, poi merchant, prima che la prima risposta arrivi): il pannello deve mostrare il merchant, mai la categoria arrivata in ritardo. Test nel Task 5.
2. **Cambio di granularità mentre i dati vecchi sono ancora a schermo**: la selezione period non deve chiudersi prima che arrivino i nuovi dati né restare aperta dopo. Test nel Task 6.
3. **Rientro su Analytics con selezione persistita e dati non ancora caricati**: nessuna chiusura prematura e pannello di nuovo visibile all'arrivo dei dati. Test nel Task 6.
4. **Dati Analytics vuoti con una selezione attiva**: il pannello sparisce insieme alle sezioni e la selezione si chiude, invece di riapparire vuota. Test nel Task 6.
5. **Selezione cambiata col pannello già aperto**: lo scroll e il focus devono ripartire, non solo al primo render. Test nel Task 5.

---

### Task 1: la dashboard senza tabella

**Files:**
- Modify: `apps/frontend/src/app/features/dashboard/dashboard-page.html` (pannello «Transazioni» con `app-section-header` e `app-transactions-table`)
- Modify: `apps/frontend/src/app/features/dashboard/dashboard-page.ts` (import `TransactionsTable`, `TRANSACTION_TYPE_OPTIONS` e tutto ciò che resta inutilizzato)
- Modify: `apps/frontend/src/app/features/dashboard/dashboard-page.scss` (regole usate solo da quel pannello, se ce ne sono)
- Test: `apps/frontend/src/app/features/dashboard/dashboard-page.spec.ts`

**Interfaces:** nessuna. `dashboard.model.ts` resta invariato: `activeFilters()` legge ancora `data.transactions`.

- [ ] **Step 1:** sostituire il test "readonly" aggiunto nel refactor e quello che conta le righe (`'app-transactions-table tbody tr'`) con `it('la dashboard è un riepilogo: non mostra la tabella dei movimenti')`. Il test controlla che `app-transactions-table` sia assente e che il testo «nel periodo selezionato» non compaia.
- [ ] **Step 2:** eseguire lo spec. Expected: FAIL.
- [ ] **Step 3:** rimuovere il pannello dal template e ciò che resta inutilizzato in `.ts` e `.scss`.
- [ ] **Step 4:** eseguire lo spec e `npx ng build`. Expected: PASS, build ok.
- [ ] **Step 5:** commit `feat(dashboard): la dashboard non mostra più la tabella dei movimenti`.

### Task 2: `showTotal` nella tabella condivisa

**Files:**
- Modify: `apps/frontend/src/app/shared/ui/transactions-table.ts`, `transactions-table.html`
- Test: `apps/frontend/src/app/shared/ui/transactions-table.spec.ts`

**Interfaces:**
- Produces: `readonly showTotal = input(true)` su `TransactionsTable`. Con `false` il `<tfoot>` non viene reso.

- [ ] **Step 1:** due test:
  - `it('con showTotal a false non rende la riga di totale')`: `setInput('showTotal', false)` e poi `expect(host.querySelector('tfoot')).toBeNull()`;
  - `it('di norma la riga di totale c'è')`: `tfoot` non è null.
- [ ] **Step 2:** eseguire lo spec. Expected: FAIL sul primo.
- [ ] **Step 3:** aggiungere l'input con un commento: il totale di un'anteprima sarebbe fuorviante. Avvolgere il `<tfoot>` in `@if (showTotal())`.
- [ ] **Step 4:** eseguire lo spec. Expected: PASS.
- [ ] **Step 5:** commit `feat(ui): la tabella dei movimenti può nascondere il totale`.

### Task 3: il servizio `AnalyticsSelection` e le sue funzioni pure

**Files:**
- Create: `apps/frontend/src/app/features/analytics/analytics-selection.ts`
- Test: `apps/frontend/src/app/features/analytics/analytics-selection.spec.ts`

**Interfaces:**
- Consumes: `DateRange` (`core/period`), `TimelineGranularity` e `Analytics` (`./analytics.model`), `TransactionQueryState` (`../transactions/transaction-query`).
- Produces:
  ```ts
  export type AnalyticsSelectionValue =
    | { kind: 'period'; granularity: TimelineGranularity; period: string; range: DateRange; label: string }
    | { kind: 'category'; categoryId: string | null; name: string }
    | { kind: 'merchant'; merchantId: string; name: string };

  @Injectable({ providedIn: 'root' })
  export class AnalyticsSelection {
    readonly selection: Signal<AnalyticsSelectionValue | null>;
    select(value: AnalyticsSelectionValue): void;
    clear(): void;
  }

  export function selectionCriteria(selection: AnalyticsSelectionValue): Partial<TransactionQueryState>;
  export function isSelectionAvailable(selection: AnalyticsSelectionValue, data: Analytics): boolean;
  /** Il testo dopo «Transazioni · ». */
  export function selectionLabel(selection: AnalyticsSelectionValue): string;
  ```

- [ ] **Step 1:** test.
  - `selection()` parte `null`; `select(v)` → `v`; `clear()` → `null`. `TestBed.inject(AnalyticsSelection)`.
  - `selectionCriteria`:
    - period `{ range: { from: '2026-07-06', to: '2026-07-12' } }` → `{ from: '2026-07-06', to: '2026-07-12' }`;
    - category `'cat-1'` → `{ categoryIds: ['cat-1'], types: ['EXPENSE'] }`;
    - category `null` → `{ classification: 'unclassified', types: ['EXPENSE'] }`;
    - merchant `'m-1'` → `{ merchantIds: ['m-1'] }`.
  - `isSelectionAvailable`, con una fixture `Analytics` minimale (bucket `'2026-07-06'` con granularità `'week'`, categoria `'cat-1'` e una voce `categoryId: null`, merchant `'m-1'`):
    - true per ciascuno dei tre;
    - false per il bucket `'2026-07-13'`;
    - false per lo stesso bucket con `granularity: 'month'`;
    - false per `'cat-2'`;
    - true per la categoria `null` quando esiste la voce `null`, false quando non esiste;
    - false per `'m-2'`.
  - `selectionLabel`: period → la sua `label`; category → `name`, oppure «Da classificare» se `categoryId === null`; merchant → `name`.
- [ ] **Step 2:** eseguire lo spec. Expected: FAIL (il modulo non esiste).
- [ ] **Step 3:** implementare. Lo stato è un `signal` privato esposto con `asReadonly()`, come in `AnalyticsStore`. Il commento della classe spiega perché è separata dallo store: lo store resta piccolo e la selezione è stato di vista, non un criterio dell'analisi.
- [ ] **Step 4:** eseguire lo spec. Expected: PASS.
- [ ] **Step 5:** commit `feat(analytics): la selezione di un elemento del grafico`.

### Task 4: la timeline emette il bucket, non solo l'intervallo

**Files:**
- Modify: `apps/frontend/src/app/features/analytics/analytics-timeline.ts` (output `transactionsRequested`, `openBucketTransactions`)
- Modify: `apps/frontend/src/app/features/analytics/analytics-page.ts` (`onTimelineTransactionsRequested` deve compilare: per ora passa `selection.range` a `openExplorer`; il Task 6 lo sostituisce)
- Test: `apps/frontend/src/app/features/analytics/analytics-timeline.spec.ts`, `analytics-page.spec.ts:437-455`

**Interfaces:**
- Produces: `export interface TimelineSelection { granularity: TimelineGranularity; period: string; range: DateRange; label: string }`, esportata da `analytics-timeline.ts`, e `readonly transactionsRequested = output<TimelineSelection>()`. `label` è `GRANULARITY[granularity].long(period)`.

- [ ] **Step 1:** aggiornare le tre aspettative di `transactionsRequested` nello spec della timeline:
  - settimana: `{ granularity: 'week', period: '2026-07-06', range: { from: '2026-07-06', to: '2026-07-12' }, label: <testo di long> }`, con `label` uguale a quello che il tooltip mostra in `.when`;
  - mese: `{ granularity: 'month', period: '2026-02', range: { from: '2026-02-01', to: '2026-02-28' }, … }`;
  - il terzo test, quello con la granularità cambiata e i bucket vecchi, verifica che `granularity` sia quella dei bucket mostrati.
  
  Nello spec della pagina, l'`emit` della riga 446 passa un `TimelineSelection` completo.
- [ ] **Step 2:** eseguire lo spec della timeline. Expected: FAIL.
- [ ] **Step 3:** emettere l'oggetto. La granularità è quella del passo con cui si leggono i bucket mostrati, cioè la stessa che `step()` usa per `range`.
- [ ] **Step 4:** eseguire gli spec di timeline e pagina, poi `npx ng build`. Expected: PASS.
- [ ] **Step 5:** commit `feat(analytics): il tooltip della timeline dice quale bucket ha scelto`.

### Task 5: il pannello `AnalyticsTransactions`

**Files:**
- Create: `apps/frontend/src/app/features/analytics/analytics-transactions.ts`, `.html`, `.scss`
- Test: `apps/frontend/src/app/features/analytics/analytics-transactions.spec.ts`

**Interfaces:**
- Consumes: `AnalyticsSelectionValue` e `selectionLabel` (Task 3); `TransactionsTable` con `showTotal` (Task 2); `transactionsRequest` (`../transactions/transactions.api`); `toQueryParams`, `TransactionQueryState` (`../transactions/transaction-query`); `TransactionPage` (`../transactions/transaction.model`); `TRANSACTION_TYPE_OPTIONS` (`../transactions/transaction-type-options`); `Panel`, `SectionHeader`, `ErrorRetry`, `EmptyState` (shared); `RouterLink`.
- Produces: `selector: 'app-analytics-transactions'`, `readonly selection = input.required<AnalyticsSelectionValue>()`, `readonly query = input.required<TransactionQueryState>()`, `readonly closed = output<void>()`.

- [ ] **Step 1:** test con `provideHttpClient()`, `provideHttpClientTesting()` e `provideRouter([])`. Gli input si impostano con `setInput`.
  - `it('chiede la prima pagina della selezione, per data decrescente')`: `expectOne` su `${API_BASE_URL}/transactions` con i parametri della query (per esempio `merchantIds=m-1`), senza `pageSize` e con `page` non oltre 1.
  - `it('il titolo dice cosa si sta guardando')`: per ciascun `kind`, il titolo contiene «Transazioni · » seguito dall'etichetta attesa (period → `label`, categoria `null` → «Da classificare», merchant → `name`).
  - `it('un’anteprima parziale lo dichiara e nasconde il totale')`: risposta con 25 righe e `total: 312` → testo «Mostrate 25 di 312», `tfoot` null.
  - `it('quando ci sono tutte, conta e mostra il totale')`: 3 righe e `total: 3` → «3 transazioni», `tfoot` presente. Con `total: 1` → «1 transazione».
  - `it('la tabella è in sola lettura')`: nessun `select` e nessun `input[type=checkbox]` dentro `app-transactions-table`.
  - `it('il link apre la stessa selezione in Movimenti')`: l'`href` del link contiene `/transactions` e `merchantIds=m-1`.
  - `it('mostra il caricamento, poi l’errore con riprova')`: prima della risposta c'è «Caricamento in corso…»; dopo una risposta 500 c'è `app-error-retry`; il click su riprova produce una nuova richiesta.
  - `it('senza righe lo dice')`: 0 righe → «Nessuna transazione per questa selezione.».
  - `it('il pulsante chiudi emette closed')`.
  - **Review Focus 1:** `it('cambiando selezione in volo, vince l’ultima')`. Con query A senza risposta, `setInput` passa a query B; si risponde prima a B (A risulta cancellata, `req.cancelled === true`, oppure la sua risposta non cambia il DOM) e il titolo e le righe sono quelli di B.
  - **Review Focus 5:** `it('a ogni nuova selezione porta in vista il pannello e ne mette a fuoco il titolo')`. Si fa lo spy di `Element.prototype.scrollIntoView` (jsdom non lo implementa: va definito sul prototipo nel test) e si cambia due volte la selezione: due chiamate, e `document.activeElement` è il titolo, con `tabindex="-1"`.
- [ ] **Step 2:** eseguire lo spec. Expected: FAIL (il componente non esiste).
- [ ] **Step 3:** implementare.
  - `httpResource<TransactionPage>(() => transactionsRequest(this.query()))`.
  - Il pannello mantiene le righe vecchie durante il ricaricamento (`.stale`, come in Analytics) usando `hasValue()`.
  - Scroll e focus: `effect` sulla `selection()` e poi `afterNextRender` (con l'`Injector` del componente), come fa `analytics-categories.ts` per il focus.
  - Il link: `[queryParams]="toQueryParams(query())"`.
  - Il titolo è il primo elemento proiettato nel `SectionHeader`, oppure il suo `title`. Se il `SectionHeader` non permette `tabindex`, usare un `<h2>` diretto, come il §16.1 della proposta consente.
- [ ] **Step 4:** eseguire lo spec. Expected: PASS.
- [ ] **Step 5:** commit `feat(analytics): pannello delle transazioni della selezione`.

### Task 6: la pagina Analytics apre il pannello invece di navigare

**Files:**
- Modify: `apps/frontend/src/app/features/analytics/analytics-page.ts`, `analytics-page.html`, `analytics-page.scss` (spaziatura del pannello, se serve)
- Modify: `docs/architecture/frontend-shared-components-proposal.md` (§11: la riga di Analytics cita `AnalyticsTransactions` e la tabella condivisa in readonly; la riga della dashboard non cita più `TransactionsTable`)
- Test: `apps/frontend/src/app/features/analytics/analytics-page.spec.ts`

**Interfaces:**
- Consumes: `AnalyticsSelection`, `selectionCriteria`, `isSelectionAvailable` (Task 3); `TimelineSelection` (Task 4); `AnalyticsTransactions` (Task 5).
- Produces:
  - `protected readonly panelQuery = computed<TransactionQueryState | null>(…)`: è `null` senza selezione, altrimenti `{ ...EMPTY_QUERY, from, to, types, categoryIds, merchantIds, classification, ...selectionCriteria(sel) }`;
  - i tre handler chiamano `selection.select(…)`, con `name` ricavato da `data.byCategory` o `data.byMerchant`;
  - se `openExplorer` non ha più usi, si rimuove; `explorerParams` resta per i link.

- [ ] **Step 1:** test. Riscrivere `analytics-page.spec.ts:394-455`, che oggi si aspettano la navigazione, e aggiungere i nuovi. Ognuno controlla che `router.url` non cambi e che compaia `app-analytics-transactions` con la richiesta HTTP giusta.
  - `it('una categoria apre le sue transazioni nel pannello, senza navigare')`: richiesta con `categoryIds=cat-1`, `types=EXPENSE` e il periodo dello store.
  - `it('una categoria senza nome apre le transazioni da classificare')`: `classification=unclassified`; il titolo contiene «Da classificare».
  - `it('un merchant apre le proprie transazioni')`: `merchantIds=m-1`; il titolo contiene «ESSELUNGA».
  - `it('il tooltip apre le transazioni del bucket, mantenendo i filtri attivi')`.
  - `it('il pannello sta fra categorie e merchant e i prestiti')`: confronto di posizione nel DOM, come fa `transactions-page.spec.ts:299`.
  - `it('un cambio di filtro ricarica il pannello con i nuovi criteri')`: `store.toggleType('INCOME')`, flush della nuova risposta Analytics; il pannello resta e la nuova richiesta contiene `types=INCOME`.
  - **Review Focus 2:** `it('cambiare il passo chiude la selezione di un bucket solo all’arrivo dei nuovi dati')`. Dopo una selezione period, `store.setGranularity('month')`: finché la risposta Analytics non arriva il pannello c'è; dopo il flush di una timeline `month`, non c'è più e `selection()` è `null`.
  - `it('un elemento sparito dai nuovi dati chiude il pannello')`: categoria selezionata, nuova risposta senza `cat-1` → pannello assente.
  - **Review Focus 4:** `it('con dati vuoti il pannello sparisce e la selezione si chiude')`.
  - **Review Focus 3:** `it('la selezione sopravvive all’uscita e al rientro nella pagina')`. Selezione, distruzione della fixture, nuova fixture con lo stesso `TestBed` (`AnalyticsSelection` è root). Prima della risposta Analytics `selection()` non è `null`; dopo il flush con dati che la contengono, il pannello è visibile.
  - `it('il pulsante chiudi toglie il pannello')`: `selection()` torna `null` e il focus va sul primo `h2` della pagina.
- [ ] **Step 2:** eseguire lo spec. Expected: FAIL.
- [ ] **Step 3:** implementare.
  - L'`effect` legge `data()` e `selection.selection()`. Con i dati presenti, chiama `clear()` se `isEmpty()` o se `!isSelectionAvailable(sel, data)`.
  - Il pannello va in `@if (panelQuery(); as query)`, subito dopo `.columns`, dentro il ramo non vuoto.
  - `(closed)`: `clear()`, poi focus sul primo `h2` dell'host dopo il render.
  - Aggiornare la riga del §11 nel documento della proposta.
- [ ] **Step 4:** da `apps/frontend` eseguire `npm test -- --watch=false`, `npx ng build` e `bash scripts/design-system-gate.sh`. Expected: falliscono solo i 2 test preesistenti di `analytics-filters`, la build passa, il gate stampa `controlli falliti: 0`.
- [ ] **Step 5:** commit `feat(analytics): un click sul grafico mostra le transazioni coinvolte`.
