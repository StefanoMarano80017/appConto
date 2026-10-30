# Riepilogo landing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Riscrivere la pagina Riepilogo (`/`) come landing essenziale: mese e indicatori, prime 5 categorie, «Da sistemare» + Prestiti, ultimi 5 movimenti dell'archivio.

**Architecture:** Il backend `GET /dashboard` cambia forma e compone i servizi pubblici esistenti (`summary`, `transactions`, `merchants`, `loans`) senza formule nuove, salvo la finestra di confronto «1–oggi». Il frontend legge il mese da `?month=`, fa una sola chiamata con `httpResource` e mostra quattro blocchi costruiti con i componenti shared. Filtri, drill-down, top merchant e liquidità spariscono.

**Tech Stack:** Backend Node + Express 5 + Drizzle/SQLite + zod, test `node:test` via `tsx --test`. Frontend Angular (standalone, signal, `httpResource`), test Vitest via `ng test`.

**Spec:** `docs/superpowers/specs/2026-10-13-riepilogo-landing-design.md`

## Global Constraints

- Una sola chiamata HTTP per la pagina: `GET /api/dashboard[?month=YYYY-MM]`.
- Nessuna nuova dipendenza; solo componenti shared esistenti (`PageLayout`, `Panel`, `SectionHeader`, `StatCardGrid`, `Amount`, `ColorMarker`, `EmptyState`, `ErrorRetry`), token e mixin di `shared/styles`, tema chiaro e scuro.
- Entrate/uscite solo da `summarizeEntries`; spesa per categoria solo dal criterio `hasExpense`/`expenseCents` (via `lentCentsByTransaction`). Prelievi mai in nessun totale.
- L'orologio è quello del server: la risposta porta `today` (`YYYY-MM-DD`), il frontend non usa `new Date()` per mese corrente, freccia › e soglia.
- Testi UI esatti: «Entrate», «Uscite», «Risultato del mese», «Dati aggiornati al {dd/mm/yyyy}», «Prelevati in contanti {importo} · non inclusi nelle uscite», «Dove sono andati i soldi», «Analisi completa →», «Nessuna spesa in questo mese», «Da sistemare», «{n} merchant da classificare →», «Ultimo movimento {data} · Importa estratto conto →», «Nessun movimento · Importa estratto conto →», «Da ricevere {importo} · {n} aperti →», «{n} movimenti di prestito senza dettaglio, considerati saldati», «Ultimi movimenti», «Tutti i movimenti →», «Nessun movimento importato», azione «Importa estratto conto».
- Soglia «dati non aggiornati»: ultimo movimento più vecchio di **7 giorni** rispetto a `today`.
- Commenti in italiano, nello stile dei file vicini; commit in italiano con prefisso convenzionale (`feat(dashboard): …`).

## Review Focus

- Mese di gennaio: il confronto deve andare a dicembre dell'anno prima, anche nella finestra parziale.
- `today` il 31 e mese precedente di 30 (o febbraio): la finestra del mese precedente si tronca al suo ultimo giorno, senza date invalide.
- Movimento con data futura nell'archivio: il mese di default non supera mai il mese di `today`.
- Mese dominato da rimborsi (uscite ≤ 0): `percentage` è `null`, niente «NaN%» né percentuali oltre 100.
- `?month=` malformato nell'URL (es. `2026-13`, `abc`): il frontend lo ignora e chiede il default, nessuna pagina d'errore.

---

### Task 1: Backend — regole di mese e finestra di confronto

**Files:**
- Create: `apps/backend/src/modules/dashboard/dashboard.period.ts`
- Test: `apps/backend/src/modules/dashboard/dashboard.period.test.ts`

**Interfaces:**
- Produces:
  - `defaultMonth(lastTransactionDate: string | null, today: string): string` — mese (`YYYY-MM`) di `lastTransactionDate`, limitato a `today.slice(0,7)`; il mese di `today` se `null`.
  - `clampMonth(month: string, today: string): string` — riporta un mese futuro al mese di `today`, altrimenti invariato.
  - `interface ComparisonWindow { previousFrom: string; previousTo: string; currentTo: string | null; partial: boolean }` — date `YYYY-MM-DD` incluse; `currentTo` è `null` per un mese chiuso (mese intero).
  - `comparisonWindow(month: string, today: string): ComparisonWindow`
  - `monthBounds(month: string): { from: string; to: string }`
  - `previousMonth` resta in `dashboard.service.ts` ed è riusata qui (spostala in questo file e riesportala da `index.ts` se serve evitare un import circolare).

- [ ] **Step 1: Write the failing tests** (`describe('dashboard.period')`)

```ts
it('defaultMonth usa il mese dell\'ultimo movimento', () =>
  assert.equal(defaultMonth('2026-09-21', '2026-10-13'), '2026-09'));
it('defaultMonth non va oltre il mese di oggi', () =>
  assert.equal(defaultMonth('2026-12-01', '2026-10-13'), '2026-10'));
it('defaultMonth senza movimenti è il mese di oggi', () =>
  assert.equal(defaultMonth(null, '2026-10-13'), '2026-10'));
it('clampMonth riporta un mese futuro a oggi', () => {
  assert.equal(clampMonth('2027-01', '2026-10-13'), '2026-10');
  assert.equal(clampMonth('2026-08', '2026-10-13'), '2026-08');
});
it('mese chiuso: mese precedente intero', () =>
  assert.deepEqual(comparisonWindow('2026-09', '2026-10-13'),
    { previousFrom: '2026-08-01', previousTo: '2026-08-31', currentTo: null, partial: false }));
it('mese in corso: 1–oggi contro lo stesso intervallo', () =>
  assert.deepEqual(comparisonWindow('2026-10', '2026-10-13'),
    { previousFrom: '2026-09-01', previousTo: '2026-09-13', currentTo: '2026-10-13', partial: true }));
it('mese in corso il 31: il mese precedente si tronca al suo ultimo giorno', () =>
  assert.deepEqual(comparisonWindow('2026-03', '2026-03-31'),
    { previousFrom: '2026-02-01', previousTo: '2026-02-28', currentTo: '2026-03-31', partial: true }));
it('gennaio si confronta con dicembre dell\'anno prima', () =>
  assert.equal(comparisonWindow('2027-01', '2027-01-10').previousTo, '2026-12-10'));
it('monthBounds', () =>
  assert.deepEqual(monthBounds('2024-02'), { from: '2024-02-01', to: '2024-02-29' }));
```

- [ ] **Step 2: Run to verify failure** — `npx tsx --test apps/backend/src/modules/dashboard/dashboard.period.test.ts` → FAIL (modulo inesistente).
- [ ] **Step 3: Implement** le funzioni in `dashboard.period.ts` come funzioni pure su stringhe (nessun `Date` locale: calcola i giorni del mese con `new Date(Date.UTC(y, m, 0)).getUTCDate()`).
- [ ] **Step 4: Run to verify pass** — stesso comando → PASS.
- [ ] **Step 5: Commit** — `feat(dashboard): regole del mese mostrato e della finestra di confronto`

---

### Task 2: Backend — nuova risposta di `GET /dashboard`

**Files:**
- Modify: `apps/backend/src/modules/dashboard/dashboard.view-model.ts` (riscrittura)
- Modify: `apps/backend/src/modules/dashboard/dashboard.service.ts` (riscrittura)
- Modify: `apps/backend/src/modules/dashboard/dashboard.routes.ts`
- Modify: `apps/backend/src/modules/dashboard/index.ts`
- Delete: `apps/backend/src/modules/dashboard/dashboard-filters.ts`
- Test: `apps/backend/src/modules/dashboard/dashboard.service.test.ts` (riscrittura), `apps/backend/src/modules/loans/loans.partial-expense.test.ts` (adeguamento)

**Interfaces:**
- Consumes: Task 1 (`defaultMonth`, `clampMonth`, `comparisonWindow`, `monthBounds`, `previousMonth`); `summarizeEntries`, `requireMonth` (summary); `transactionsService.listByMonthWithMerchant`, `transactionsService.search(DEFAULT_QUERY)`, `hasExpense`, `expenseCents`, `toAmountCents` (transactions); `merchantLabel`, `merchantsService.search(DEFAULT_MERCHANT_QUERY).counts.unclassified` (merchants); `loansService.list(DEFAULT_LOAN_QUERY).totals`, `loansService.allocations()`, `loansService.lentCentsByTransaction()` (loans).
- Produces (view-model, consumato da Task 3):

```ts
export interface DashboardCategory {
  id: string | null; name: string; color: string | null;
  amount: number;              // spesa del mese, positiva
  percentage: number | null;   // su summary.expenses, 1 decimale; null se expenses <= 0
  difference: number;          // amount nella finestra corrente − previous nella finestra, con segno
}
export interface RecentTransaction {
  id: string; bookingDate: string; label: string; type: TransactionType;
  category: { id: string; name: string; color: string | null } | null;
  amount: number;              // con segno, come in banca
}
export interface DashboardViewModel {
  month: string; today: string; lastTransactionDate: string | null;
  summary: { income: number; expenses: number; balance: number; withdrawals: number };
  comparison: { previousExpenses: number; percentChange: number | null } & ComparisonWindow;
  topCategories: DashboardCategory[];        // max 5, amount decrescente
  recentTransactions: RecentTransaction[];   // max 5, archivio intero, data decrescente
  attention: { unclassifiedMerchants: number };
  loans: { remaining: number; openCount: number; unlinkedTransactions: number };
}
```
- `dashboardService.getDashboard(month: string | undefined, today: string): DashboardViewModel`
- Route: `GET /dashboard?month=` — `month` assente → `undefined`; presente ma non stringa o malformato → 400 (`requireMonth`). `today` = data locale del server in `YYYY-MM-DD`.

Regole di calcolo (le uniche decisioni non deducibili dalle firme):
- `month` effettivo = `month === undefined ? defaultMonth(last, today) : clampMonth(requireMonth(month), today)`.
- `lastTransactionDate` = `bookingDate` della prima riga di `transactionsService.search(DEFAULT_QUERY)` (ordinata per data decrescente), `null` se vuota. `recentTransactions` = le prime 5 righe della stessa ricerca; `label` = `merchantLabel(merchant)` o la descrizione se manca il merchant.
- `withdrawals` = somma in valore assoluto dei `WITHDRAWAL` del mese.
- Confronto: le spese correnti per categoria e il totale `currentExpenses` per la variazione si filtrano a `bookingDate <= currentTo` quando `currentTo !== null`; le precedenti si leggono con `listByMonthWithMerchant(previousMonth(month))` filtrate a `previousFrom..previousTo`. `percentChange` = come oggi (1 decimale, `null` se previous = 0). `amount` e `percentage` delle categorie usano invece l'intero mese mostrato.
- `unlinkedTransactions` = numero di transazioni `LOAN` dell'archivio il cui id non compare in `loansService.allocations()`. Usa `transactionsService.search({ ...DEFAULT_QUERY, types: ['LOAN'], pageSize: 25 }).total` meno i transaction id distinti presenti nelle allocazioni (le allocazioni riguardano solo movimenti LOAN).

- [ ] **Step 1: Rewrite the failing tests** in `dashboard.service.test.ts`, mantenendo il setup esistente (DB temporaneo, `importService.importCsv`, `classify`, `setType`). Dati: febbraio 2033 (ESSELUNGA −100, BENZINAIO −50, CINEMA −20) e marzo 2033 (ESSELUNGA −60 il 05/03, ESSELUNGA −40 il 20/03, BENZINAIO −80 il 08/03, STIPENDIO +2000 il 01/03, PRELIEVO BANCOMAT −200 il 12/03 impostato `WITHDRAWAL`, NEGOZIO NUOVO −10 il 15/03 non classificato). ESSELUNGA→Alimentari, BENZINAIO→Carburante, CINEMA→Intrattenimento. In più, **in mesi precedenti** perché non disturbino gli «ultimi movimenti»: maggio 2032 RIMBORSO +30 impostato `EXPENSE`, giugno 2032 BONIFICO AMICO −500 impostato `LOAN` (estendi l'unione di `setType` a `'WITHDRAWAL' | 'TRANSFER' | 'EXPENSE' | 'LOAN'`). Tutti i dati si importano in testa al file. Test:

```ts
it('senza mese usa il mese dell\'ultimo movimento', () =>
  assert.equal(dashboardService.getDashboard(undefined, '2033-04-10').month, '2033-03'));
it('un mese futuro è riportato al mese di oggi', () =>
  assert.equal(dashboardService.getDashboard('2034-01', '2033-04-10').month, '2033-04'));
it('indicatori del mese: prelievi a parte, non nelle uscite', () => {
  const { summary } = dashboardService.getDashboard('2033-03', '2033-04-10');
  assert.deepEqual(summary, { income: 2000, expenses: 190, balance: 1810, withdrawals: 200 });
});
it('mese chiuso: confronto sul mese precedente intero', () => {
  const { comparison } = dashboardService.getDashboard('2033-03', '2033-04-10');
  assert.equal(comparison.previousExpenses, 170);
  assert.equal(comparison.partial, false);
  assert.equal(comparison.percentChange, 11.8);
});
it('mese in corso: confronto a parità di giorni', () => {
  const { comparison } = dashboardService.getDashboard('2033-03', '2033-03-10');
  // correnti fino al 10/03: 60 + 80 = 140; precedenti 01–10/02: 100 + 50 = 150
  assert.equal(comparison.partial, true);
  assert.equal(comparison.previousTo, '2033-02-10');
  assert.equal(comparison.previousExpenses, 150);
  assert.equal(comparison.percentChange, -6.7);
});
it('prime categorie con percentuale e variazione', () => {
  const { topCategories } = dashboardService.getDashboard('2033-03', '2033-04-10');
  assert.deepEqual(topCategories.map((c) => [c.name, c.amount, c.percentage, c.difference]), [
    ['Alimentari', 100, 52.6, 0],
    ['Carburante', 80, 42.1, 30],
    ['Senza categoria', 10, 5.3, 10],
  ]);
  // Intrattenimento (spesa 0 a marzo) non compare: `topCategories` elenca solo le categorie con spesa nel mese.
});
```

Altri test:

```ts
it('ultimi movimenti dell\'archivio, indipendenti dal mese', () => {
  const { recentTransactions } = dashboardService.getDashboard('2033-02', '2033-04-10');
  assert.equal(recentTransactions.length, 5);
  assert.equal(recentTransactions[0]?.bookingDate, '2033-03-20');
  assert.equal(recentTransactions[0]?.label, 'ESSELUNGA');
});
it('ultimo movimento e merchant da classificare', () => {
  const view = dashboardService.getDashboard('2033-03', '2033-04-10');
  assert.equal(view.lastTransactionDate, '2033-03-20');
  // STIPENDIO, PRELIEVO BANCOMAT, NEGOZIO NUOVO, RIMBORSO, BONIFICO AMICO
  assert.equal(view.attention.unclassifiedMerchants, 5);
});
it('un movimento prestito senza prestito registrato è contato come non collegato', () =>
  assert.deepEqual(dashboardService.getDashboard('2033-03', '2033-04-10').loans,
    { remaining: 0, openCount: 0, unlinkedTransactions: 1 }));
it('mese dominato da rimborsi: nessuna percentuale', () => {
  const { topCategories } = dashboardService.getDashboard('2032-05', '2033-04-10');
  assert.ok(topCategories.every((c) => c.percentage === null));
});
```

Se la normalizzazione dei nomi dell'import producesse un conteggio diverso da 5, verifica con `merchantsService.listAll()` e correggi il valore atteso nel test, non l'implementazione.

- [ ] **Step 2: Adegua `loans.partial-expense.test.ts`**: chiama `getDashboard(MONTH, '2099-12-31')` (o una data dopo i dati del test) e sostituisci `dashboard.categories.find(...)` con `dashboard.topCategories.find(...)`; elimina la proprietà `dashboardTopMerchant` dall'oggetto confrontato e dal valore atteso.
- [ ] **Step 3: Run to verify failure** — `npx tsx --test apps/backend/src/modules/dashboard/*.test.ts apps/backend/src/modules/loans/loans.partial-expense.test.ts` → FAIL.
- [ ] **Step 4: Implement** view-model, service, route e `index.ts` secondo le firme sopra. Elimina `dashboard-filters.ts`, `buildCategoryBreakdown`, `buildTopMerchants` e il campo `cashFlow`; togli dall'indice gli export non più esistenti.
- [ ] **Step 5: Run** — `npm run test:backend` e `npm run typecheck:backend` → tutto PASS, nessun errore.
- [ ] **Step 6: Commit** — `feat(dashboard): risposta essenziale per la landing del riepilogo`

---

### Task 3: Frontend — modello, API, pagina con testata e indicatori

**Files:**
- Modify: `apps/frontend/src/app/features/dashboard/dashboard.model.ts` (riscrittura: specchio del view-model di Task 2, `ComparisonWindow` incluso)
- Modify: `apps/frontend/src/app/features/dashboard/dashboard.api.ts` → sostituito da una funzione request per `httpResource`
- Create: `apps/frontend/src/app/features/dashboard/dashboard-month.ts` (+ `dashboard-month.spec.ts`)
- Modify: `dashboard-page.ts`, `dashboard-page.html`, `dashboard-page.scss`, `dashboard-page.spec.ts` (riscritture)
- Delete: `category-breakdown.*`, `top-merchants.*`, `month-comparison.*` (spec inclusa), `dashboard-filter.store.*` (spec inclusa), l'intera cartella `features/cash-flow/`

**Interfaces:**
- Consumes: `GET /api/dashboard` di Task 2.
- Produces:
  - `dashboardRequest(month: string | null): HttpResourceRequest` in `dashboard.api.ts` (`params: { month }` solo se non `null`).
  - In `dashboard-month.ts`: `parseMonthParam(value: string | null): string | null` (accetta solo `/^\d{4}-(0[1-9]|1[0-2])$/`), `shiftMonth(month: string, delta: number): string`, `monthBounds(month: string): { from: string; to: string }`, `isStale(lastTransactionDate: string | null, today: string, days = 7): boolean` (`true` anche con `null`), `comparisonCaption(window: ComparisonWindow, previousMonth: string): string` → `'vs agosto'` per mese chiuso, `'vs 1–13 set'` per finestra parziale (mese abbreviato in minuscolo, `it-IT`).
  - `DashboardPage` espone al template (usati da Task 4): `data: Signal<Dashboard | undefined>` (ultimo valore valido, resta visibile durante il caricamento successivo), `monthRange: Signal<{ from: string; to: string }>`.

- [ ] **Step 1: Write failing tests** `dashboard-month.spec.ts`:

```ts
expect(parseMonthParam('2026-09')).toBe('2026-09');
expect(parseMonthParam('2026-13')).toBeNull();
expect(parseMonthParam('abc')).toBeNull();
expect(shiftMonth('2026-01', -1)).toBe('2025-12');
expect(shiftMonth('2026-12', 1)).toBe('2027-01');
expect(monthBounds('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
expect(isStale('2026-09-21', '2026-10-13')).toBe(true);
expect(isStale('2026-10-07', '2026-10-13')).toBe(false);   // 6 giorni
expect(isStale(null, '2026-10-13')).toBe(true);
expect(comparisonCaption({ previousFrom: '2026-08-01', previousTo: '2026-08-31', currentTo: null, partial: false }, '2026-08')).toBe('vs agosto');
expect(comparisonCaption({ previousFrom: '2026-09-01', previousTo: '2026-09-13', currentTo: '2026-10-13', partial: true }, '2026-09')).toBe('vs 1–13 set');
```

E in `dashboard-page.spec.ts` (con `provideRouter`, `HttpTestingController`, fixture `dashboard()` riscritta sulla nuova forma):
- senza query param la richiesta è `GET /api/dashboard` senza `month`; con `?month=2026-08` porta `month=2026-08`; con `?month=2026-13` nessun `month`.
- mostra le tre card «Entrate», «Uscite», «Risultato del mese» e **non** «Transazioni» né «Merchant»; la card Uscite ha la didascalia `vs agosto`.
- «Prelevati in contanti» presente con `withdrawals: 200`, assente con `0`.
- «Dati aggiornati al 21/09/2026» con `lastTransactionDate: '2026-09-21'`.
- la freccia › è `disabled` quando `month` è il mese di `today`; cliccare ‹ naviga a `?month=` del mese precedente.

- [ ] **Step 2: Run to verify failure** — `npm run test:frontend` → FAIL.
- [ ] **Step 3: Implement**:
  - Il mese dall'URL come in `transactions-page.ts` (`toSignal(route.queryParamMap)` + `parseMonthParam`); risorsa con `httpResource(() => dashboardRequest(month()))`; frecce che fanno `router.navigate([], { queryParams: { month } })`.
  - Testata in un `app-panel`: frecce ‹ › (pulsanti con `aria-label` «Mese precedente»/«Mese successivo») attorno a `formatMonth(data.month)`, a destra «Dati aggiornati al …» (`formatBookingDate`).
  - Sotto: `app-stat-card-grid` con le tre card (Uscite: valore `-expenses`, `delta` con tono invertito e `caption: comparisonCaption(...)`, assente se `percentChange === null`) e la riga dei prelievi come testo secondario.
  - Errore: `app-error-retry` con `reload()` della risorsa; primo caricamento: «Caricamento in corso…».
  - Elimina i file elencati in **Delete**; nessun altro file importa `features/cash-flow` (verifica con una ricerca).
- [ ] **Step 4: Run** — `npm run test:frontend` e `npm run build:frontend` → PASS, build senza errori.
- [ ] **Step 5: Commit** — `feat(dashboard): testata con mese nell'URL e indicatori essenziali`

---

### Task 4: Frontend — categorie, Da sistemare + Prestiti, ultimi movimenti

**Files:**
- Create: `apps/frontend/src/app/features/dashboard/top-categories.{ts,html,scss,spec.ts}`
- Create: `apps/frontend/src/app/features/dashboard/attention-panel.{ts,html,scss,spec.ts}` (contiene sia «Da sistemare» sia «Prestiti»)
- Create: `apps/frontend/src/app/features/dashboard/recent-transactions.{ts,html,scss,spec.ts}`
- Modify: `dashboard-page.html`, `dashboard-page.scss`, `dashboard-page.ts` (imports)

**Interfaces:**
- Consumes: modello e `dashboard-month.ts` di Task 3.
- Produces (selettori e input):
  - `app-top-categories`: `categories = input.required<DashboardCategory[]>()`, `range = input.required<{ from: string; to: string }>()`.
  - `app-attention-panel`: `attention`, `loans`, `lastTransactionDate`, `today` (tutti `input.required`); `hasContent = computed<boolean>()` pubblico, usato dalla pagina per il layout.
  - `app-recent-transactions`: `transactions = input.required<RecentTransaction[]>()`.

Comportamento (dalla spec, sezioni 3–6):
- **Top categorie** — riga = link `routerLink="/transactions"` con `queryParams`: `{ categoryIds: id, types: 'EXPENSE,LOAN', from, to }`, oppure `{ classification: 'unclassified', types: 'EXPENSE,LOAN', from, to }` se `id === null`. Mostra `app-color-marker`, nome, `app-amount [value]="-amount"`, `formatPercent(percentage)` se non `null`, variazione «↑ 12,30 €»/«↓ 12,30 €» con `formatAmount(Math.abs(difference))`, classe di tono negativo per ↑ e positivo per ↓, nessuna freccia se `difference === 0`. Piè: «Analisi completa →» verso `/analytics`. Vuoto: `app-empty-state` «Nessuna spesa in questo mese».
- **Attention panel** — sezione «Da sistemare» con le voci: merchant (se `unclassifiedMerchants > 0`, link `/merchants?classification=unclassified`), import (se `isStale(lastTransactionDate, today)`, link `/import`, testo con data o «Nessun movimento · …»). Sezione «Prestiti» se `openCount > 0`: link `/loans?status=open`; nota secondaria se `unlinkedTransactions > 0`. Ogni sezione assente se vuota; `hasContent` falso se entrambe assenti.
- **Ultimi movimenti** — intestazione con link «Tutti i movimenti →» a `/transactions`; righe con `formatBookingDate`, `label`, marker + nome categoria o «Senza categoria», `app-amount [value]="amount"`. Vuoto: `app-empty-state` «Nessun movimento importato» con azione «Importa estratto conto» che naviga a `/import`.
- **Layout pagina** — griglia a due colonne (categorie | attention) che va a una colonna sotto 900px; se `attention.hasContent()` è falso le categorie occupano tutta la riga. Ultimi movimenti a tutta larghezza in fondo.

- [ ] **Step 1: Write failing specs** per i tre componenti, con queste asserzioni:
  - top-categories: il link della riga «Alimentari» ha `href` contenente `categoryIds=cat-1`, `types=EXPENSE,LOAN`, `from=2026-09-01`, `to=2026-09-30`; la riga «Senza categoria» contiene `classification=unclassified`; `difference: 30` mostra «↑» con classe di tono negativo, `difference: -5` mostra «↓», `difference: 0` nessuna freccia; `percentage: null` non mostra «%»; lista vuota mostra «Nessuna spesa in questo mese».
  - attention-panel: con `unclassifiedMerchants: 17` mostra «17 merchant da classificare»; con `lastTransactionDate: '2026-09-21'`, `today: '2026-10-13'` mostra «Ultimo movimento 21/09/2026»; con `'2026-10-10'` non lo mostra; con `openCount: 0` nessuna sezione Prestiti; con `unlinkedTransactions: 14` e `openCount: 2` mostra «14 movimenti di prestito senza dettaglio, considerati saldati»; tutto a zero e dati freschi → `hasContent()` falso.
  - recent-transactions: 5 righe nell'ordine ricevuto; categoria `null` → «Senza categoria»; lista vuota → «Nessun movimento importato».
- [ ] **Step 2: Run to verify failure** — `npm run test:frontend` → FAIL.
- [ ] **Step 3: Implement** i tre componenti e collegali nella pagina.
- [ ] **Step 4: Run** — `npm run test:frontend` e `npm run build:frontend` → PASS.
- [ ] **Step 5: Commit** — `feat(dashboard): categorie principali, attività da sistemare e ultimi movimenti`

---

### Task 5: Verifica nell'app reale

**Files:** nessuno (solo correzioni se emergono difetti).

- [ ] **Step 1:** Con backend (`npm run dev`) e frontend (`npm run dev:frontend`) avviati, screenshot headless a 1440px e 390px di `http://localhost:4200/`, `/?month=2026-08`, `/?month=2026-10`, in tema scuro e chiaro.
- [ ] **Step 2:** Controlla sugli screenshot: all'apertura il mese è settembre 2026 con dati; nessun doppio negativo; carattere mono uniforme sugli importi; nessuno scroll orizzontale a 390px; su ottobre 2026 «Ultimi movimenti» mostra comunque i movimenti di settembre e «Da sistemare» propone l'import.
- [ ] **Step 3:** `npm test` → tutto PASS.
- [ ] **Step 4: Commit** delle eventuali correzioni — `fix(dashboard): …`
