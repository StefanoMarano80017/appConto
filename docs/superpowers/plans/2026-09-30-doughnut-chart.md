# Grafico a ciambella condiviso — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un `<app-doughnut-chart>` condiviso (top N + «Altri») costruito sullo strato `shared/ui/chart`, e la scheda Categorie di Analytics con un toggle Grafico | Lista.

**Architecture:** `AppChart` diventa generico sul tipo (`'line' | 'doughnut'`) e resta l'unico ciclo di vita Chart.js. Accanto ai moduli della linea nascono i moduli speculari del doughnut (modello, raggruppamento puro, tema, builder di configurazione, componente). La feature vede solo `doughnut-chart` e `doughnut-chart.model`.

**Tech Stack:** Angular (standalone, signals, OnPush), Chart.js, Vitest via `ng test`, SCSS con token del design system.

**Spec:** `docs/superpowers/specs/2026-09-30-doughnut-chart-design.md`

## Global Constraints

- Chart.js si importa solo dentro `apps/frontend/src/app/shared/ui/chart/`; le feature non vedono tipi Chart.js né indici di dataset.
- Nessun esadecimale di ripiego nel layer chart: un token mancante resta stringa vuota.
- In TS stanno solo i *nomi* dei token; i valori si leggono con `getComputedStyle` sull'host in `afterRenderEffect` dipendente da `ThemeStore.theme()`.
- Le spec `line-chart.spec.ts`, `line-chart-config.spec.ts`, `line-chart-theme.spec.ts`, `line-chart.model.spec.ts`, `line-guides-plugin.spec.ts`, `value-scale.spec.ts` **non si modificano** e restano verdi.
- Commenti e testi UI in italiano, stile dei file esistenti (commenti che spiegano il *perché*).
- Testi esatti: `'Altri'`, `'Grafico'`, `'Lista'`, `'Vista delle categorie'`, `'Distribuzione delle spese per categoria'`, `'Totale spese'`, `'Nessuna spesa netta da rappresentare.'`.
- Geometria: `cutout: '68%'`, `borderWidth: 2`, `hoverOffset: 6`; `topN` default `5`.
- Comandi (da `apps/frontend`): test `npx ng test --watch=false`, singolo file `npx ng test --watch=false --include=<path>`; gate `npm run gate`; build `npx ng build`.
- Commit con messaggio convenzionale in italiano (es. `feat(chart): …`) e riga `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Committare solo i file del task: il ramo ha altre modifiche non committate dell'utente.

## Review Focus

1. **Colore `custom` non valido o `null` in una categoria** → la fetta usa `chart-neutral`, mai stringa vuota da `null`. Test in Task 6 (`color: null` → `'chart-neutral'`).
2. **`items` cambia mentre una fetta è attiva da tastiera e l'indice esce dalle fette** (es. cambio periodo con meno categorie) → `focusIndex` torna `null`, nessun errore, il centro mostra il totale. Test in Task 5.
3. **Click sul foro o fuori dalle fette** (`clicked` con lista vuota) → nessuna emissione di `sliceActivated`. Test in Task 5.
4. **Cambio tema mentre il grafico è visibile** → colori delle fette-token ririsolti; i `custom` invariati. Test in Task 5.
5. **Tutte le categorie con importo ≤ 0** → messaggio al posto della ciambella, toggle ancora presente, Lista raggiungibile. Test in Task 6.

---

### Task 1: Modello e tema condivisi fra i grafici

Estrae ciò che il doughnut condivide con la linea, senza cambiare comportamento.

**Files:**
- Create: `apps/frontend/src/app/shared/ui/chart/chart.model.ts`
- Create: `apps/frontend/src/app/shared/ui/chart/chart-theme.ts`
- Create: `apps/frontend/src/app/shared/ui/chart/chart-theme.spec.ts`
- Modify: `apps/frontend/src/app/shared/ui/chart/line-chart.model.ts`
- Modify: `apps/frontend/src/app/shared/ui/chart/line-chart-theme.ts`

**Interfaces:**
- Produces:
  - `chart.model.ts`: `CHART_SERIES_COLORS`, `type ChartSeriesColor`, `chartColorVar(color)` (spostati da `line-chart.model.ts`, stessi nomi e firme).
  - `chart-theme.ts`: `seriesColorToken(color: ChartSeriesColor): \`--color-${ChartSeriesColor}\`` (spostato) e `resolveSeriesColors(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): Readonly<Record<ChartSeriesColor, string>>`.
  - `line-chart.model.ts` riesporta `CHART_SERIES_COLORS`, `ChartSeriesColor`, `chartColorVar`; `line-chart-theme.ts` riesporta `seriesColorToken`.

- [ ] **Step 1: Write the failing test** `chart-theme.spec.ts`

```ts
describe('resolveSeriesColors', () => {
  it('legge ogni colore-serie dal proprio token, ripulito', () => {
    const style = fakeStyle({ '--color-chart-1': ' #111 ', '--color-chart-neutral': '#999' });
    const colors = resolveSeriesColors(style);
    expect(colors['chart-1']).toBe('#111');
    expect(colors['chart-neutral']).toBe('#999');
  });
  it('un token mancante resta stringa vuota', () => {
    expect(resolveSeriesColors(fakeStyle({}))['chart-7']).toBe('');
  });
  it('copre esattamente CHART_SERIES_COLORS', () => {
    expect(Object.keys(resolveSeriesColors(fakeStyle({}))).sort()).toEqual([...CHART_SERIES_COLORS].sort());
  });
});
it('seriesColorToken antepone --color-', () => {
  expect(seriesColorToken('chart-3')).toBe('--color-chart-3');
});
```
(`fakeStyle` come in `line-chart-theme.spec.ts`; importare da `./chart-theme` e `./chart.model`.)

- [ ] **Step 2: Run** `npx ng test --watch=false --include=src/app/shared/ui/chart/chart-theme.spec.ts` — Expected: FAIL (modulo `./chart-theme` inesistente).

- [ ] **Step 3: Implement** — spostare le tre definizioni in `chart.model.ts`; spostare `seriesColorToken` e il letterale `series: {...}` (resta un letterale, non un ciclo, per il motivo già commentato) in `resolveSeriesColors`; `resolveLineChartTheme` usa `series: resolveSeriesColors(style)`. Aggiungere le riesportazioni.

- [ ] **Step 4: Run** `npx ng test --watch=false --include=src/app/shared/ui/chart` — Expected: PASS, spec della linea incluse e non toccate.

- [ ] **Step 5: Commit** i cinque file: `refactor(chart): colori-serie e loro risoluzione diventano comuni ai grafici`.

---

### Task 2: `AppChart` generico sul tipo

**Files:**
- Modify: `apps/frontend/src/app/shared/ui/chart/chart.ts`
- Modify: `apps/frontend/src/app/shared/ui/chart/chart.spec.ts`

**Interfaces:**
- Produces:
  - `export type AppChartType = 'line' | 'doughnut';`
  - `export type ChartOptionsWithoutInteractionCallbacks<TType extends AppChartType = 'line'> = Omit<ChartOptions<TType>, 'onHover' | 'onClick'>;`
  - `AppChart<TType extends AppChartType>` con `type = input.required<TType>()`, `data = input.required<ChartData<TType, number[], string>>()`, `options = input<ChartOptionsWithoutInteractionCallbacks<TType>>({})`, `plugins = input<readonly Plugin<TType>[]>([])`; resto dell'API invariato (`activeElements`, `ariaLabel`, `role`, `tabIndex`, output `hovered`/`clicked`/`keyDown`/`focused`/`blurred`).
  - Registrazione aggiuntiva: `DoughnutController`, `ArcElement`.

- [ ] **Step 1: Update the failing tests** in `chart.spec.ts`
  - Il test di registrazione diventa «registra esattamente i componenti dei grafici a linee e a ciambella»: `controllers` → `['doughnut', 'line']`, `elements` → `['arc', 'line', 'point']`, `scales` e `plugins` invariati.
  - Nuovo test «con type doughnut crea il grafico di quel tipo e ne applica gli elementi attivi»: `setInput('type', 'doughnut')`, dati `{ labels: ['A', 'B'], datasets: [{ data: [4, 6] }] }`, `activeElements: [{ datasetIndex: 0, index: 1 }]` → `chart().config.type === 'doughnut'` e `setActiveElements` chiamato con `[{ datasetIndex: 0, index: 1 }]`; poi nuovi dati con una sola fetta → l'elemento attivo con `index: 1` è scartato (`setActiveElements` ultima chiamata senza di esso).

- [ ] **Step 2: Run** `npx ng test --watch=false --include=src/app/shared/ui/chart/chart.spec.ts` — Expected: FAIL sulla registrazione.

- [ ] **Step 3: Implement** — parametrizzare classe, campi privati (`chart?: ChartJS<TType, number[], string>`, `configuredType?: TType`, …) e `optionsWithEvents(): ChartOptions<TType>`; registrare i due componenti. Se il costruttore generico richiede un cast per il `config`, farlo in un solo punto con un commento che dica perché.

- [ ] **Step 4: Run** `npx ng test --watch=false --include=src/app/shared/ui/chart` e `npx ng build` — Expected: PASS; build senza errori di template (in `line-chart.html` `type="line"` inferisce `TType`).

- [ ] **Step 5: Commit** `feat(chart): AppChart disegna anche le ciambelle`.

---

### Task 3: Modello e raggruppamento top N

**Files:**
- Create: `apps/frontend/src/app/shared/ui/chart/doughnut-chart.model.ts`
- Create: `apps/frontend/src/app/shared/ui/chart/doughnut-grouping.ts`
- Create: `apps/frontend/src/app/shared/ui/chart/doughnut-grouping.spec.ts`

**Interfaces:**
- Consumes: `ChartSeriesColor` da `chart.model.ts` (Task 1).
- Produces:
  - `doughnut-chart.model.ts`: `type SliceColor = ChartSeriesColor | { readonly custom: string }`; `type DoughnutSlice<T>` (union `kind: 'item'` con `item`, `value` / `kind: 'others'` con `items`, `value`, come da spec); riesporta `type ChartSeriesColor`.
  - `groupTopN<T>(items: readonly T[], value: (item: T) => number, topN: number): DoughnutSlice<T>[]`.

- [ ] **Step 1: Write the failing tests** (voci `{ id: string; v: number }`, `value = x => x.v`)
  - `topN = 2`, 3 voci → 3 fette `item`, nessuna `others`.
  - `topN = 2`, 4 voci `[a:10, b:40, c:5, d:20]` → `item b(40)`, `item d(20)`, `others { items: [a, c], value: 15 }`.
  - voci con `v` `0` e `-5` sono scartate prima del conteggio (con `topN = 1`, `[a:3, z:0, n:-5, b:2]` → due `item`, nessuna `others`).
  - parità: `[a:5, b:5, c:5]`, `topN = 5` → ordine `a, b, c`.
  - `[]` → `[]`; `[z:0, n:-1]` → `[]`.

- [ ] **Step 2: Run** `npx ng test --watch=false --include=src/app/shared/ui/chart/doughnut-grouping.spec.ts` — Expected: FAIL (modulo inesistente).

- [ ] **Step 3: Implement** — filtro `> 0`, `toSorted` decrescente (stabile), soglia `length <= topN + 1`; le voci di `others` restano nell'ordine ordinato.

- [ ] **Step 4: Run** lo stesso comando — Expected: PASS.

- [ ] **Step 5: Commit** `feat(chart): le prime N voci e le altre in una fetta sola`.

---

### Task 4: Tema e configurazione del doughnut

**Files:**
- Create: `apps/frontend/src/app/shared/ui/chart/doughnut-chart-theme.ts`
- Create: `apps/frontend/src/app/shared/ui/chart/doughnut-chart-theme.spec.ts`
- Create: `apps/frontend/src/app/shared/ui/chart/doughnut-chart-config.ts`
- Create: `apps/frontend/src/app/shared/ui/chart/doughnut-chart-config.spec.ts`

**Interfaces:**
- Consumes: `resolveSeriesColors` (Task 1), `ChartOptionsWithoutInteractionCallbacks<'doughnut'>` (Task 2), `DoughnutSlice`, `SliceColor` (Task 3).
- Produces:
  - `DOUGHNUT_CHART_TOKENS = { sliceBorder: '--color-surface' } as const`
  - `DOUGHNUT_CHART_GEOMETRY = { cutout: '68%', borderWidth: 2, hoverOffset: 6, layoutPadding: 6 } as const` (`layoutPadding` = `hoverOffset`, così la fetta sollevata non si taglia)
  - `interface DoughnutChartTheme { readonly sliceBorder: string; readonly series: Readonly<Record<ChartSeriesColor, string>> }`
  - `resolveDoughnutChartTheme(style): DoughnutChartTheme`
  - `doughnutChartData<T>(slices: readonly DoughnutSlice<T>[], label: (item: T) => string, color: (item: T) => SliceColor, othersLabel: string, theme: DoughnutChartTheme): ChartData<'doughnut', number[], string>`
  - `doughnutChartOptions(): ChartOptionsWithoutInteractionCallbacks<'doughnut'>`

- [ ] **Step 1: Write the failing tests**
  - tema: `--color-surface` e un colore-serie letti; token mancanti → `''`; test «ogni token usato è dichiarato in entrambe le palette» sullo stesso modello di `line-chart-theme.spec.ts` (legge `_primitives.scss`) per `DOUGHNUT_CHART_TOKENS`.
  - dati: con fette `[item A (custom '#123456'), item B ('chart-2'), others]` → `labels` `['A', 'B', 'Altri']` (passando `othersLabel = 'Altri'`), un dataset con `data` `[valori]`, `backgroundColor` `['#123456', theme.series['chart-2'], theme.series['chart-neutral']]`, `borderColor` `theme.sliceBorder`, `borderWidth` 2, `hoverOffset` 6.
  - opzioni: `cutout` `'68%'`, `animation` `false`, `maintainAspectRatio` `false`, `plugins.legend.display` e `plugins.tooltip.enabled` `false`, `layout.padding` 6.

- [ ] **Step 2: Run** `npx ng test --watch=false --include=src/app/shared/ui/chart/doughnut-chart-*.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** i due moduli (puri, senza DOM).

- [ ] **Step 4: Run** lo stesso comando — Expected: PASS.

- [ ] **Step 5: Commit** `feat(chart): tema e configurazione della ciambella`.

---

### Task 5: Componente `DoughnutChart<T>`

**Files:**
- Create: `apps/frontend/src/app/shared/ui/chart/doughnut-chart.ts`, `doughnut-chart.html`, `doughnut-chart.scss`, `doughnut-chart.spec.ts`

**Interfaces:**
- Consumes: Task 2 (`AppChart`, `ChartDataPoint`, `CHART_CONSTRUCTOR`), Task 3 (`groupTopN`, tipi), Task 4 (tema, config), `ThemeStore` da `core/theme`.
- Produces:
  - `@Directive({ selector: 'ng-template[appDoughnutCenter]' }) export class DoughnutCenter<T>` con `readonly template = inject(TemplateRef<{ $implicit: DoughnutSlice<T> | null }>)` e `static ngTemplateContextGuard`.
  - `@Component({ selector: 'app-doughnut-chart' }) export class DoughnutChart<T>`: input `items`, `value`, `label`, `color`, `topN` (5), `othersLabel` ('Altri'), `ariaLabel`; output `sliceActivated = output<DoughnutSlice<T>>()`; `contentChild(DoughnutCenter)`.
  - Riesporta `CHART_CONSTRUCTOR`.

Comportamento (dalla spec, sezione Interazione): `slices = computed(groupTopN(...))`; `hover` e `focusIndex` signal; attiva = `hover ?? focusIndex`, valida solo se `< slices().length`; `activeElements = [{ datasetIndex: 0, index }]`; `data` non legge l'hover. Un `effect` riporta `focusIndex` a `null` quando esce dalle fette. Host: `(pointerleave)` → `hover.set(null)`. SCSS: host `position: relative`, `height: 100%`; `.center` assoluto e centrato, `pointer-events: none`, `text-align: center`, larghezza entro il foro (~55%). Template: `@if` tema risolto → `<app-chart type="doughnut" … [tabIndex]="0">`; poi `<div class="center" aria-live="polite">` con `ngTemplateOutlet` e contesto `{ $implicit: activeSlice() }`. `plugins` = costante modulo `[]` tipizzata `readonly Plugin<'doughnut'>[]`.

- [ ] **Step 1: Write the failing tests** (host di prova con 7 voci e `topN` 5, mock Chart e `ThemeStore` come in `line-chart.spec.ts`; template centro che scrive `slice?.kind` / etichetta o `'nessuna'`)
  - disegna 6 fette (5 + «Altri»), canvas con `tabindex="0"`, `role="img"`, `aria-label`.
  - senza tema risolto non crea il grafico (nessuna istanza prima del render).
  - `onHover` sulla fetta 2 → `activeElements` `[{datasetIndex:0,index:2}]` e centro con la sua etichetta; `pointerleave` sull'host → centro `'nessuna'`.
  - `onClick` sulla fetta 1 → `sliceActivated` con `kind: 'item'` e l'`item` giusto; su «Altri» → `kind: 'others'` con le 2 voci; `onClick` con `[]` → nessuna emissione (Review Focus 3).
  - focus → fetta 0 attiva; `ArrowRight` ×6 torna a 0 (cerchio); `ArrowLeft` da 0 → 5; `Home`/`End`; `ArrowUp`/`ArrowDown` come sinistra/destra; `Enter` e `' '` emettono la fetta attiva con `defaultPrevented`; `Escape` → nessuna attiva; blur → nessuna attiva.
  - con `focusIndex` 5, `items` ridotti a 2 voci → centro `'nessuna'`, nessun errore (Review Focus 2).
  - cambio `ThemeStore.theme()` → dati ricreati con il nuovo colore-token; il colore `custom` resta identico (Review Focus 4).
  - senza voci positive: nessun tasto emette o cambia stato.

- [ ] **Step 2: Run** `npx ng test --watch=false --include=src/app/shared/ui/chart/doughnut-chart.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** i quattro file. Commento di classe sullo stile di `LineChart`: cosa sta qui (tema, fetta attiva, interazione) e cosa resta alla feature (significato dell'attivazione, contenuto del centro).

- [ ] **Step 4: Run** `npx ng test --watch=false --include=src/app/shared/ui/chart` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(chart): il grafico a ciambella condiviso`.

---

### Task 6: Toggle Grafico | Lista nella scheda Categorie

**Files:**
- Modify: `apps/frontend/src/app/features/analytics/analytics-categories.ts`, `.html`, `.scss`, `.spec.ts`
- Modify: `apps/frontend/src/app/features/analytics/analytics-page.spec.ts` (righe ~384 e ~408: passare alla Lista prima di cliccare `.row`)

**Interfaces:**
- Consumes: `DoughnutChart`, `DoughnutCenter`, `CHART_CONSTRUCTOR` da `shared/ui/chart/doughnut-chart`; `DoughnutSlice`, `SliceColor` da `shared/ui/chart/doughnut-chart.model`; `ChoiceGroup`, `ChoiceOption` da `shared/ui/choice-group`.
- Produces: nessuna API nuova; `categorySelected` invariato.

Dettagli dalla spec, sezione «Integrazione»: `view = signal<'chart' | 'list'>('chart')`; opzioni `[{ id: 'chart', label: 'Grafico' }, { id: 'list', label: 'Lista' }]`; `ChoiceGroup` in `panelActions` solo con `categories().length > 0`; `color = c => c.color ? { custom: c.color } : 'chart-neutral'`; centro: `item` → nome, `<app-amount [value]="-amount">`, `formatPercent(percentage)`; `others` → `'Altri'`, somma importi, somma `percentage`; `null` → `'Totale spese'` e somma degli importi positivi. `sliceActivated`: `item` → `categorySelected.emit(item.categoryId)`, `others` → `view.set('list')`. Nessun importo positivo → `<p class="message">Nessuna spesa netta da rappresentare.</p>`. Il contenitore della ciambella ha un'altezza fissa da token di spaziatura esistenti (niente px nuovi se esiste un token adatto).

- [ ] **Step 1: Write/adjust the failing tests** in `analytics-categories.spec.ts` (aggiungere mock Chart + `getContext` come `analytics-timeline.spec.ts`)
  - i due test esistenti sull'`app-amount` cliccano prima «Lista» e cercano `app-amount` dentro la lista (`ul app-amount`).
  - di default è attivo «Grafico» (`aria-pressed="true"`) e c'è `app-doughnut-chart`; clic su «Lista» → `ul` con le righe, nessuna ciambella; di nuovo «Grafico» → ciambella.
  - con 7 categorie, `onClick` sulla fetta 0 → `categorySelected` emette il `categoryId` della maggiore; su «Altri» → la vista diventa Lista.
  - categoria con `color: null` → `backgroundColor` della sua fetta = colore risolto di `chart-neutral` (Review Focus 1).
  - senza fetta attiva il centro mostra `'Totale spese'`.
  - zero categorie → nessun `app-choice-group`, messaggio attuale.
  - solo categorie con `amount <= 0` → testo `'Nessuna spesa netta da rappresentare.'`, toggle presente, «Lista» mostra le righe (Review Focus 5).
  - `analytics-page.spec.ts`: prima di `click('app-analytics-categories .row')` cliccare il bottone «Lista» di quella scheda; asserzioni invariate.

- [ ] **Step 2: Run** `npx ng test --watch=false --include=src/app/features/analytics` — Expected: FAIL sui nuovi casi.

- [ ] **Step 3: Implement** le modifiche al componente. Aggiornare il commento di classe: perché due viste e perché «Altri» porta alla Lista.

- [ ] **Step 4: Run** `npx ng test --watch=false` (intera suite) — Expected: PASS.

- [ ] **Step 5: Commit** `feat(analytics): le categorie si leggono anche a ciambella`.

---

### Task 7: Gate e documentazione di architettura

**Files:**
- Modify: `apps/frontend/scripts/design-system-gate.sh:108-112`
- Modify: `docs/architecture/frontend-shared-components-proposal.md` (riga ~298 e sezione da ~498)

**Interfaces:** nessuna.

- [ ] **Step 1: Verify the gate catches a violation** — in un file temporaneo `src/app/features/analytics/__gate-probe.ts` scrivere `import { groupTopN } from '../../shared/ui/chart/doughnut-grouping';`, run `npm run gate` — Expected oggi: il controllo «Chart.js resta dentro shared/ui/chart» passa (buco).

- [ ] **Step 2: Implement** — la regex dei moduli interni diventa `\(chart\|chart-theme\|line-chart-config\|line-chart-theme\|line-guides-plugin\|doughnut-chart-config\|doughnut-chart-theme\|doughnut-grouping\)`; il commento elenca i moduli pubblici `line-chart`, `line-chart.model`, `doughnut-chart`, `doughnut-chart.model`, `chart.model`.

- [ ] **Step 3: Run** `npm run gate` con la sonda — Expected: quel controllo FAIL; eliminare `__gate-probe.ts`, rilanciare — Expected: tutto `[ok]`.

- [ ] **Step 4: Update docs** come da spec, sezione «Gate e documentazione»: albero a strati con il ramo doughnut, paragrafo API pubblica del Doughnut (input, `sliceActivated`, `appDoughnutCenter`, `SliceColor` con la regola dei colori `custom`), elenco dei moduli nel paragrafo Gate, riga Analytics della tabella.

- [ ] **Step 5: Final verification** — `npx ng test --watch=false`, `npx ng build`, `npm run gate`: tutti verdi.

- [ ] **Step 6: Commit** i due file: `docs(chart): la ciambella nello strato dei grafici e nel gate`.
