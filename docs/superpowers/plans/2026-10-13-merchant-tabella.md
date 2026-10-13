# Pagina merchant: tabella ordinabile e paginata — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La pagina `/merchants` diventa una tabella ordinabile e paginata lato server, con stato nell'URL e componenti shared.

**Architecture:** `GET /merchants` diventa la collezione paginata (come `GET /transactions` e `GET /loans`): parsing in `merchant-query.ts`, calcolo in memoria in `merchantsService.search()` sopra `listSummaries()`, DTO `toMerchantPageDto`. Nel frontend la paginazione delle transazioni diventa `app-pagination` generico; la pagina merchant legge lo stato da `queryParamMap`, carica con `httpResource` e ricarica la pagina corrente dopo ogni salvataggio.

**Tech Stack:** Express + zod + `node:test` (backend, eseguito con `tsx`); Angular 21 zoneless, signals, `httpResource`, Vitest + jsdom (frontend).

**Spec:** `docs/superpowers/specs/2026-10-13-merchant-tabella-design.md` — chi implementa legge spec e piano insieme.

## Global Constraints

- Default della query: `classification=all`, `page=1`, `pageSize=25`, `sortBy=transactionCount`, `sortDirection=desc`. `pageSize` ammette solo 25, 50, 100.
- Campi di ordinamento: `name` | `category` | `transactionCount` | `totalSpent` | `lastTransactionDate`.
- Direzione al primo clic su una colonna: `name`, `category` → `asc`; `transactionCount`, `totalSpent`, `lastTransactionDate` → `desc`. Clic sulla colonna attiva inverte.
- Cambiare ordinamento, filtro, ricerca o dimensione pagina riporta a pagina 1.
- `GET /merchants/summary` resta identico (lo usano transazioni e analytics).
- Nessun colore/spaziatura/font letterale: `npm run gate --prefix apps/frontend` passa senza nuovi `ds-exception`.
- Commenti e descrizioni dei test in italiano, come nel resto del codice. Nessuna nuova dipendenza.
- Testi fissati dallo spec:
  - "Hai sistemato tutti i merchant di questa pagina." / "Ne restano N nelle pagine precedenti." / "Vai all'ultima pagina"
  - "Nessun merchant. Importa un estratto conto per iniziare."
  - "Tutti i merchant sono stati classificati."
  - "Nessun merchant corrisponde alla ricerca."
  - Etichette filtro: "Tutti (N)", "Classificati (N)", "Da classificare (N)"
  - Paginazione: "41–60 di 279 merchant"

## Review Focus

1. **Ricerca con lettere accentate o maiuscole** ("caffè", "CAFFE"): deve trovare con le stesse regole di oggi (`toLowerCase().includes` su `label` e `name`). Test in Task 2.
2. **Ordinamento per categoria o ultima transazione con valori `null`**: i `null` restano in fondo sia in `asc` sia in `desc`; un ordinamento che li porta in cima in `desc` sembra un bug. Test in Task 2.
3. **Classificare l'ultima riga dell'ultima pagina**: la pagina resta, compare lo stato "Pagina svuotata" e "Vai all'ultima pagina" porta a `totalPages`. Test in Task 5.
4. **Salvataggio in errore**: l'errore si vede, la pagina corrente viene ricaricata e la riga torna al valore salvato. Test in Task 5.
5. **URL scritti a mano** (`?sortBy=foo&pageSize=7&page=-1`): il frontend li riporta ai default senza schermata bianca e senza inviarli al backend (che risponderebbe 400). Test in Task 4.

---

## File Structure

| File | Ruolo |
|---|---|
| `apps/backend/src/modules/merchants/merchant-query.ts` (nuovo) | `MerchantQuery`, costanti, `parseMerchantQuery` |
| `apps/backend/src/modules/merchants/merchant-query.test.ts` (nuovo) | test del parsing |
| `apps/backend/src/modules/merchants/merchants.service.ts` | `search(query): MerchantPage` |
| `apps/backend/src/modules/merchants/merchants.dto.ts` | `MerchantPageDto`, `toMerchantPageDto` |
| `apps/backend/src/modules/merchants/merchants.routes.ts` | `GET /` paginato |
| `apps/backend/src/modules/merchants/index.ts` | esportazioni nuove |
| `apps/backend/src/modules/merchants/merchants.search.test.ts` (nuovo) | test di `search` |
| `apps/backend/src/modules/merchants/merchants.routes.test.ts` (nuovo) | test HTTP di `GET /merchants` |
| `apps/frontend/src/app/shared/ui/data/pagination/` (spostato da `shared/transactions/transactions-pagination/`) | `app-pagination` generico |
| `apps/frontend/src/app/features/merchants/merchant-query.ts` (+ `.spec.ts`, nuovi) | stato nell'URL |
| `apps/frontend/src/app/features/merchants/merchants.api.ts`, `merchant.model.ts` | `MerchantPage`, `merchantsRequest` |
| `apps/frontend/src/app/features/merchants/merchants-page.{ts,html,scss}` (+ `.spec.ts` nuovo) | la pagina |
| `apps/frontend/src/app/features/merchants/merchant-filter.ts` (+ spec) | **eliminati** |

---

### Task 1: Backend — parsing della query merchant

**Files:**
- Create: `apps/backend/src/modules/merchants/merchant-query.ts`
- Test: `apps/backend/src/modules/merchants/merchant-query.test.ts`

**Interfaces:**
- Consumes: da `../transactions/index.js` → `CLASSIFICATION_FILTERS`, `ClassificationFilter`, `SortDirection`, `PAGE_SIZES`, `DEFAULT_PAGE_SIZE`; da `../../shared/http/query-params.js` → `toSingle`, `QueryParam`.
- Produces:
  ```ts
  export const MERCHANT_SORT_FIELDS = ['name', 'category', 'transactionCount', 'totalSpent', 'lastTransactionDate'] as const;
  export type MerchantSortField = (typeof MERCHANT_SORT_FIELDS)[number];
  export interface MerchantQuery {
    search: string | null; classification: ClassificationFilter;
    page: number; pageSize: number; sortBy: MerchantSortField; sortDirection: SortDirection;
  }
  export const DEFAULT_MERCHANT_QUERY: MerchantQuery;
  export interface MerchantQueryInput { search; classification; page; pageSize; sortBy; sortDirection: QueryParam }
  export function parseMerchantQuery(input: MerchantQueryInput): MerchantQuery;
  ```

- [ ] **Step 1: Scrivi i test (`node:test`, `assert/strict`)**

  - `un input vuoto vale DEFAULT_MERCHANT_QUERY` → `deepEqual(parse({}), { search: null, classification: 'all', page: 1, pageSize: 25, sortBy: 'transactionCount', sortDirection: 'desc' })`
  - `legge tutti i parametri` → `{ search: ' bar ', classification: 'unclassified', page: '3', pageSize: '50', sortBy: 'name', sortDirection: 'asc' }` dà `search: 'bar'`, `page: 3`, `pageSize: 50`, ecc.
  - `una ricerca di soli spazi vale null`
  - `rifiuta valori non validi` → per ciascuno di `{ sortBy: 'foo' }`, `{ sortDirection: 'up' }`, `{ classification: 'x' }`, `{ pageSize: '30' }`, `{ page: '0' }`, `{ page: 'abc' }`: `assert.throws(..., ValidationError)`

- [ ] **Step 2: Esegui** `npx tsx --test apps/backend/src/modules/merchants/merchant-query.test.ts` (dalla root). Atteso: FAIL, modulo inesistente.

- [ ] **Step 3: Implementa `merchant-query.ts`** ricalcando `parseTransactionQuery` (`transactions/transaction-query.ts:156-217`), con stessi messaggi d'errore adattati. `toPositiveInteger` è privato in quel file: duplicalo localmente (sono 10 righe) invece di esportarlo.

- [ ] **Step 4: Esegui di nuovo.** Atteso: PASS.

- [ ] **Step 5: Commit** `feat(merchants): parsing dei criteri di ricerca dei merchant`

---

### Task 2: Backend — `search`, DTO e rotta `GET /merchants`

**Files:**
- Modify: `apps/backend/src/modules/merchants/merchants.service.ts`, `merchants.dto.ts`, `merchants.routes.ts:32-35`, `index.ts`
- Test: `apps/backend/src/modules/merchants/merchants.search.test.ts`, `merchants.routes.test.ts`

**Interfaces:**
- Consumes: Task 1 (`MerchantQuery`, `parseMerchantQuery`, `DEFAULT_MERCHANT_QUERY`).
- Produces:
  ```ts
  // merchants.service.ts
  export interface MerchantCounts { all: number; classified: number; unclassified: number }
  export interface MerchantPage {
    summaries: MerchantSummary[]; page: number; pageSize: number;
    total: number; totalPages: number; counts: MerchantCounts;
  }
  merchantsService.search(query: MerchantQuery): MerchantPage
  // merchants.dto.ts
  export interface MerchantPageDto {
    items: MerchantSummaryDto[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
    counts: MerchantCounts;
  }
  export function toMerchantPageDto(page: MerchantPage): MerchantPageDto
  ```
  HTTP: `GET /merchants?search=&classification=&page=&pageSize=&sortBy=&sortDirection=` → `MerchantPageDto`.

- [ ] **Step 1: Test del servizio** in `merchants.search.test.ts`, con lo stesso setup di `merchants.service.test.ts` (DB temporaneo prima degli import, `importService.importCsv`, `categoriesService` per assegnare categorie). Dati: almeno 5 merchant con conteggi diversi, uno con categoria, due con lo stesso `transactionCount` per il pareggio, uno rinominato con `displayName` accentato ("Caffè Roma"), uno senza transazioni in uscita. Helper `labels(query)` = `search({...DEFAULT_MERCHANT_QUERY, ...query}).summaries.map(label)`. Test:
  - `di default ordina per numero di transazioni decrescente`
  - `a parità di valore ordina per nome crescente`
  - `ordina per nome senza distinguere maiuscole` (asc e desc)
  - `per categoria i merchant senza categoria restano in fondo in entrambe le direzioni`
  - `per ultima transazione i null restano in fondo in entrambe le direzioni`
  - `ordina per totale speso`
  - `filtra classificati e da classificare`
  - `cerca nel nome scelto e in quello della banca, senza distinguere maiuscole` → `search: 'CAFFÈ'` trova "Caffè Roma"; il nome originale della banca lo trova ancora
  - `i conteggi riguardano tutto l'archivio e ignorano ricerca e filtro` → `counts` identici con e senza `search`/`classification`
  - `pagina: total e totalPages contano i risultati filtrati` → con `pageSize: 25` e N risultati, `totalPages === Math.max(Math.ceil(N / 25), 1)`
  - `una pagina oltre l'ultima restituisce nessuna riga e la paginazione reale` → `page: 99` → `summaries: []`, `page: 99`, `total` e `totalPages` reali
  - `nessun risultato: totalPages vale 1`

- [ ] **Step 2: Test HTTP** in `merchants.routes.test.ts`, con lo stesso setup di `transactions.routes.test.ts` (`createApp(frontendDir).listen(0, config.host)`):
  - `GET /merchants restituisce items, pagination e counts` → status 200, chiavi presenti, `pagination.pageSize === 25`
  - `GET /merchants passa i criteri al servizio` → `?sortBy=name&sortDirection=asc&pageSize=50` si riflette nella risposta
  - `GET /merchants rifiuta un ordinamento non consentito` → `?sortBy=foo` → 400
  - `GET /merchants/summary resta un array` → `Array.isArray(body)`

- [ ] **Step 3: Esegui** `npx tsx --test apps/backend/src/modules/merchants/*.test.ts`. Atteso: FAIL.

- [ ] **Step 4: Implementa `merchantsService.search`.** Parte da `listSummaries()`. I `counts` si calcolano sull'intera lista. Poi filtro di classificazione e ricerca (`query.search.toLowerCase()` contenuto in `merchantLabel(merchant).toLowerCase()` o `merchant.name.toLowerCase()`). Ordinamento con un comparatore per campo; i `null` (`category`, `lastTransactionDate`) vanno in fondo **prima** di applicare la direzione; a parità `label` asc. Per i testi usa `localeCompare(b, 'it', { sensitivity: 'base' })`. Fetta `(page-1)*pageSize`. `totalPages = Math.max(Math.ceil(total / pageSize), 1)`. **Non** riportare la pagina all'ultima, a differenza di `transactionsService.search`: è una decisione dello spec. Scrivi in un commento perché.

- [ ] **Step 5: Implementa `toMerchantPageDto`** nel modello di `toTransactionPageDto`.

- [ ] **Step 6: Sostituisci `GET /`** in `merchants.routes.ts`. Commento `// GET /merchants?search=&classification=&page=&pageSize=&sortBy=&sortDirection=`, `parseMerchantQuery({ x: queryParam(req.query.x, 'x'), … })`, poi `res.json(toMerchantPageDto(merchantsService.search(query)))`. `listAllWithCategory` resta nel service. Esporta da `index.ts` `MerchantPage`, `MerchantCounts`, `MerchantPageDto` e `toMerchantPageDto`.

- [ ] **Step 7: Esegui** i test di Step 3, poi `npm run test:backend` e `npm run typecheck:backend`. Atteso: tutto PASS.

- [ ] **Step 8: Commit** `feat(merchants): GET /merchants paginato, ordinabile e filtrabile`

---

### Task 3: Frontend — paginazione generica `app-pagination`

**Files:**
- Move: `apps/frontend/src/app/shared/transactions/transactions-pagination/*` → `apps/frontend/src/app/shared/ui/data/pagination/pagination.{ts,html,scss,model.ts}` (con `git mv`)
- Modify: `shared/transactions/transactions-table-panel/transactions-table-panel.{ts,html,spec.ts}`, `shared/transactions/transactions-table/transactions-table.model.ts:2,134`, `features/transactions/transaction-query.ts:3,34`, `features/transactions/transactions-page.spec.ts`, `features/analytics/analytics-transactions.spec.ts`
- Test: `apps/frontend/src/app/shared/ui/data/pagination/pagination.spec.ts` (nuovo)

**Interfaces:**
- Produces:
  ```ts
  // pagination.model.ts
  export const PAGE_SIZES = [25, 50, 100] as const;
  export interface PaginationData { readonly page: number; readonly pageSize: number; readonly total: number; readonly totalPages: number }
  // pagination.ts — selector 'app-pagination', class Pagination
  readonly pagination = input.required<PaginationData>();
  readonly itemLabel = input.required<string>();   // plurale: 'transazioni', 'merchant'
  readonly pageSelected = output<number>();
  readonly pageSizeSelected = output<number>();
  ```
  Il modello si chiama `PaginationData` e non `Pagination` come nello spec, per non scontrarsi con il nome del componente.

- [ ] **Step 1: Test** in `pagination.spec.ts`:
  - `mostra l'intervallo con il nome degli elementi` → `{page: 3, pageSize: 20, total: 279, totalPages: 14}` con `itemLabel: 'merchant'` dà il testo "41–60 di 279 merchant"
  - `senza risultati dice Nessun seguito dal nome` → "Nessun merchant"
  - `emette la pagina scelta` → clic su "Successiva" emette `page + 1`

- [ ] **Step 2: Esegui** `npm test --prefix apps/frontend -- --watch=false --include='**/pagination.spec.ts'`. Atteso: FAIL.

- [ ] **Step 3: Sposta e rinomina.** Il template usa `{{ itemLabel() }}` in "… di T {{ itemLabel() }}" e "Nessun {{ itemLabel() }}". Aggiorna gli import. In `transactions-table-panel.html` passa `itemLabel="transazioni"` a entrambe le istanze. Nei due spec di feature sostituisci il selettore `app-transactions-pagination` con `app-pagination`. Elimina la cartella vecchia.

- [ ] **Step 4: Esegui** `npm run test:frontend` e `npm run gate --prefix apps/frontend`. Atteso: PASS, testo delle transazioni invariato.

- [ ] **Step 5: Commit** `refactor(shared): paginazione generica app-pagination in ui/data`

---

### Task 4: Frontend — stato nell'URL e richiesta della pagina merchant

**Files:**
- Create: `apps/frontend/src/app/features/merchants/merchant-query.ts`, `merchant-query.spec.ts`
- Modify: `merchant.model.ts`, `merchants.api.ts`

**Interfaces:**
- Consumes: `PAGE_SIZES`, `PaginationData` da Task 3. Contratto HTTP da Task 2.
- Produces:
  ```ts
  // merchant-query.ts
  export type ClassificationFilter = 'all' | 'classified' | 'unclassified';
  export const MERCHANT_SORT_FIELDS = ['name', 'category', 'transactionCount', 'totalSpent', 'lastTransactionDate'] as const;
  export type MerchantSortField = (typeof MERCHANT_SORT_FIELDS)[number];
  export type SortDirection = 'asc' | 'desc';
  /** La direzione con cui parte una colonna appena scelta. */
  export const FIRST_SORT_DIRECTION: Record<MerchantSortField, SortDirection>;
  export interface MerchantQueryState { classification; search: string; page; pageSize; sortBy; sortDirection }
  export const EMPTY_MERCHANT_QUERY: MerchantQueryState;
  export function parseMerchantQuery(params: ParamMap): MerchantQueryState;
  export function toMerchantQueryParams(state: MerchantQueryState): Params; // i default diventano null
  // merchant.model.ts
  export interface MerchantCounts { all: number; classified: number; unclassified: number }
  export interface MerchantPage { items: MerchantSummary[]; pagination: PaginationData; counts: MerchantCounts }
  // merchants.api.ts
  export function merchantsRequest(state: MerchantQueryState): HttpResourceRequest; // url `${API_BASE_URL}/merchants`
  ```
  `MerchantsApi.summary()`, `updateCategory()` e `updateDisplayName()` restano invariati.

- [ ] **Step 1: Test** in `merchant-query.spec.ts`, sul modello di `loans/loan-query.spec.ts`:
  - `un URL senza parametri vale la ricerca predefinita` → `EMPTY_MERCHANT_QUERY` = `{classification: 'all', search: '', page: 1, pageSize: 25, sortBy: 'transactionCount', sortDirection: 'desc'}`
  - `legge tutti i parametri`
  - `valori non riconosciuti tornano ai predefiniti` → `{sortBy: 'foo', sortDirection: 'up', classification: 'x', pageSize: '7', page: '-1'}` dà `EMPTY_MERCHANT_QUERY`
  - `i valori predefiniti non finiscono nell'URL` → `toMerchantQueryParams(EMPTY_MERCHANT_QUERY)` ha solo valori `null`
  - `testi in crescente, numeri e date in decrescente` → `FIRST_SORT_DIRECTION` per i 5 campi
  - `merchantsRequest porta solo i parametri non predefiniti` → con `{...EMPTY, sortBy: 'name', page: 2}` i params sono esattamente `sortBy=name&page=2`

- [ ] **Step 2: Esegui** lo spec. Atteso: FAIL.

- [ ] **Step 3: Implementa**, ricalcando `transactions/transaction-query.ts` (parsing tollerante, `param()` per i default) e `transactions.api.ts:15-25` per `merchantsRequest`.

- [ ] **Step 4: Esegui.** Atteso: PASS.

- [ ] **Step 5: Commit** `feat(merchants): stato della pagina merchant nell'URL`

---

### Task 5: Frontend — la pagina merchant

**Files:**
- Modify: `apps/frontend/src/app/features/merchants/merchants-page.{ts,html,scss}`
- Delete: `merchant-filter.ts`, `merchant-filter.spec.ts`
- Test: `apps/frontend/src/app/features/merchants/merchants-page.spec.ts` (nuovo)

**Interfaces:**
- Consumes: Task 3 (`Pagination`, `itemLabel="merchant"`), Task 4 (`parseMerchantQuery`, `toMerchantQueryParams`, `FIRST_SORT_DIRECTION`, `merchantsRequest`, `MerchantPage`). Componenti shared: `ChoiceGroup` (`options: ChoiceOption<ClassificationFilter>[]` con `label` "Tutti (N)", ecc.; `value`; `ariaLabel`; output `selected`), `SortableHeader` (`label`, `active`, `direction`, output `sorted`), `EmptyState`, `ErrorRetry`, `Amount`, `SearchInput`, `Select`, oltre a quelli di layout già usati.

- [ ] **Step 1: Test della pagina** in `merchants-page.spec.ts`, con lo stesso impianto di `loans/loans-page.spec.ts` (`RouterTestingHarness`, `HttpTestingController`, helper `flush` che risponde a `${API_BASE_URL}/merchants` qualunque query string). Rispondi anche a `/categories`. Test:
  - `chiede la prima pagina con i criteri predefiniti` → la richiesta non ha parametri
  - `mostra righe, conteggi nei filtri e intervallo` → "Da classificare (3)" e "1–2 di 2 merchant" nel testo
  - `clic su Nome ordina in crescente e torna a pagina 1` → partendo da `?page=3`, l'URL diventa `sortBy=name&sortDirection=asc`, senza `page`
  - `clic sulla colonna attiva inverte la direzione` → su Transazioni, `sortDirection=asc`
  - `scegliere un filtro aggiorna l'URL e torna a pagina 1`
  - `dopo aver assegnato una categoria ricarica la pagina corrente` → `PATCH /merchants/m-1/category`, poi una nuova `GET /merchants` con la stessa query; durante la ricarica le righe restano visibili (nessuno skeleton)
  - `pagina oltre l'ultima con risultati: resta sulla pagina e lo dice` → risposta `items: []`, `pagination: {page: 4, totalPages: 3, total: 60, pageSize: 25}`: compaiono "Hai sistemato tutti i merchant di questa pagina." e "Ne restano 60 nelle pagine precedenti.". "Vai all'ultima pagina" porta a `page=3`. L'URL non cambia da solo
  - `tutto classificato` → `?classification=unclassified`, `total: 0`, `counts.all > 0`: "Tutti i merchant sono stati classificati."
  - `nessun merchant` → `counts.all === 0`: "Nessun merchant. Importa un estratto conto per iniziare."
  - `nessun risultato per la ricerca` → "Nessun merchant corrisponde alla ricerca."; l'azione azzera ricerca e filtro
  - `errore nel salvataggio: lo mostra e ricarica la pagina` → PATCH 500, messaggio visibile, nuova `GET`
  - `errore nel caricamento: Riprova rilancia la richiesta`

- [ ] **Step 2: Esegui** lo spec. Atteso: FAIL.

- [ ] **Step 3: Riscrivi `merchants-page.ts`.**
  - Togli `OnInit` e `subscribe` di caricamento.
  - `params = toSignal(route.queryParamMap, { initialValue: … })`, `query = computed(parseMerchantQuery)`, `merchants = httpResource<MerchantPage>(() => merchantsRequest(query()))`, `categories = httpResource<Category[]>` su `/categories`.
  - `apply(patch, replaceUrl = false)`: ogni patch che non sia la sola `page` azzera `page` a 1, poi `router.navigate([], { queryParams: toMerchantQueryParams({...query(), ...patch}), replaceUrl })`.
  - `sortBy(field)`: colonna attiva → inverte; altrimenti `FIRST_SORT_DIRECTION[field]`.
  - Ricerca con debounce di 300 ms e `replaceUrl`, come `loans-page.ts:183-196`.
  - `save()` resta con `savingId` e `subscribe` sulla PATCH. Successo → `merchants.reload()`. Errore → `saveError.set(...)` e `merchants.reload()`.
  - `emptyPage = computed(...)` vero quando `items.length === 0 && pagination.total > 0`.

- [ ] **Step 4: Riscrivi il template.** Struttura:
  - intestazione con "Aggiorna" (`merchants.reload()`);
  - toolbar con `app-search-input` e `app-choice-group`;
  - errore di salvataggio sopra la tabella;
  - tabella nel `.scroller` con 5 `th app-sortable-header`; Totale speso con `<app-amount tone="neutral">`;
  - `app-pagination itemLabel="merchant"` sotto;
  - gli stati della tabella "Stati della pagina" dello spec.

  Lo skeleton compare solo quando `merchants.isLoading()` e non c'è ancora un valore: con `reload()` il valore resta e le righe non lampeggiano. Verifica il comportamento di `httpResource` durante il cambio di query e, se il valore si azzera, mantieni l'ultimo `MerchantPage` in un `linkedSignal`.

- [ ] **Step 5: SCSS.** Rimuovi `.filters`, `.message`, `.count`. Lo skeleton ricalca `transactions-table-panel.scss:23-51`, compreso `prefers-reduced-motion`. Elimina `merchant-filter.ts` e il suo spec.

- [ ] **Step 6: Esegui** `npm run test:frontend`, `npm run gate --prefix apps/frontend` e `npm run build:frontend`. Atteso: tutto PASS.

- [ ] **Step 7: Verifica a mano** con `npm run dev:backend` + `npm run dev:frontend`:
  - ordina ogni colonna;
  - classifica da "Da classificare" e controlla che la riga sparisca e che la successiva risalga;
  - classifica l'ultima riga dell'ultima pagina;
  - ricarica la pagina con filtri attivi.

- [ ] **Step 8: Commit** `feat(merchants): tabella ordinabile e paginata con componenti shared`
