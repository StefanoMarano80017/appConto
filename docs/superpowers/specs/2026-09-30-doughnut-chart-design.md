# Grafico a ciambella condiviso e vista Grafico nella scheda Categorie — design

Data: 2026-09-30 · Ramo di partenza: `feat/ui-ux-fasi-4-7`

## Obiettivo

Aggiungere allo strato `src/app/shared/ui/chart/` un grafico a ciambella (Doughnut)
che riusa l'infrastruttura esistente (`AppChart`, tema da token, interazione a un
solo indice) e mostra le prime N voci come fette, raggruppando il resto in «Altri».

Primo consumer: la scheda «Spese per categoria» di Analytics, che con un toggle
passa dalla ciambella alla lista attuale e viceversa.

## Criteri di successo

- La scheda Categorie offre un toggle Grafico | Lista; la Lista resta identica a oggi.
- La ciambella mostra al più 5 categorie più «Altri», con i colori delle categorie.
- Click (o Invio/Spazio) su una fetta filtra per quella categoria, come la riga della Lista;
  su «Altri» porta alla vista Lista.
- Le spec esistenti di `LineChart` e dei suoi builder passano **senza modifiche**.
- Chart.js resta confinato in `shared/ui/chart`; il gate lo verifica anche per i nuovi moduli.

## Fuori ambito

- Persistenza della vista scelta (si riparte sempre da Grafico).
- N scelto dall'utente dalla UI.
- Ciambella per i merchant o altri consumer.
- Legenda condivisa (la Lista fa già da legenda completa).

## Architettura

```text
Feature (AnalyticsCategories)     dominio: toggle, significato dell'attivazione, contenuto del centro, Lista
  └─ <app-doughnut-chart>         doughnut-chart.ts: tema reattivo, fetta attiva, hover/click/tastiera/focus
       ├─ builder puri            doughnut-grouping.ts (top N + Altri), doughnut-chart-config.ts (dati e opzioni)
       ├─ tema                    doughnut-chart-theme.ts (token, geometria) + chart-theme.ts (colori-serie condivisi)
       └─ <app-chart>             chart.ts: ciclo di vita dell'istanza Chart.js, ora generico sul tipo
```

### `AppChart` generico sul tipo

`AppChart` diventa `AppChart<TType extends 'line' | 'doughnut'>`: `type`, `data`,
`options` e `plugins` usano i tipi Chart.js parametrizzati su `TType`
(`ChartData<TType, number[], string>`, opzioni senza `onHover`/`onClick`,
`Plugin<TType>`). Si registrano anche `DoughnutController` e `ArcElement`.

Il ciclo di vita resta uno solo e invariato: creazione dopo la view, ricreazione se
cambiano tipo o plugin, aggiornamento dei soli elementi attivi quando dati e opzioni
sono gli stessi oggetti, `setActiveElements([])` prima di cambiare i dati,
`validActiveElements` per scartare indici fuori dai dati. `ChartDataPoint`
(`datasetIndex`, `index`) descrive già una fetta (`datasetIndex: 0`).

`ChartOptionsWithoutInteractionCallbacks` diventa generico
(`ChartOptionsWithoutInteractionCallbacks<TType = 'line'>`), così `line-chart-config.ts`
non cambia.

### Spostamenti per non duplicare

- `CHART_SERIES_COLORS`, `ChartSeriesColor` e `chartColorVar` passano in un nuovo
  `chart.model.ts`; `line-chart.model.ts` li riesporta, così nessun import esistente cambia.
- La risoluzione dei colori-serie esce da `resolveLineChartTheme` e diventa
  `resolveSeriesColors(style)` in `chart-theme.ts` (con `seriesColorToken`);
  `resolveLineChartTheme` la usa, e ne usa il risultato per `series`.

## API pubblica

Le feature importano solo `doughnut-chart` e `doughnut-chart.model` (oltre ai moduli
pubblici della linea).

### Modello (`doughnut-chart.model.ts`)

```ts
/** Token del design system, oppure un colore scelto dall'utente (es. la categoria). */
export type SliceColor = ChartSeriesColor | { readonly custom: string };

export type DoughnutSlice<T> =
  | { readonly kind: 'item'; readonly item: T; readonly value: number }
  | { readonly kind: 'others'; readonly items: readonly T[]; readonly value: number };
```

Riesporta anche `ChartSeriesColor`.

### Componente `DoughnutChart<T>` (`<app-doughnut-chart>`)

Input:

| Input | Tipo | Default |
|---|---|---|
| `items` | `readonly T[]` | richiesto |
| `value` | `(item: T) => number` | richiesto |
| `label` | `(item: T) => string` | richiesto |
| `color` | `(item: T) => SliceColor` | richiesto |
| `topN` | `number` | `5` |
| `othersLabel` | `string` | `'Altri'` |
| `ariaLabel` | `string` | richiesto |

Output: `sliceActivated: DoughnutSlice<T>`, emesso al click su una fetta e con
Invio/Spazio sulla fetta attiva. Il significato lo decide la feature.

Contenuto proiettato: un `<ng-template appDoughnutCenter let-slice>` con contesto
`{ $implicit: DoughnutSlice<T> | null }`, reso nel foro della ciambella. `null` = nessuna
fetta attiva. La direttiva `DoughnutCenter` è esportata da `doughnut-chart.ts`.

`doughnut-chart.ts` riesporta `CHART_CONSTRUCTOR`, come `line-chart.ts`.

## Raggruppamento (`doughnut-grouping.ts`)

`groupTopN<T>(items: readonly T[], value: (item: T) => number, topN: number): DoughnutSlice<T>[]`, pura:

1. Scarta le voci con valore ≤ 0 (una ciambella non ha fette negative né vuote;
   una categoria con rimborso netto resta visibile solo nella Lista).
2. Ordina per valore decrescente, stabile (a parità conserva l'ordine d'ingresso);
   non si affida all'ordine del backend.
3. Se restano al più `topN + 1` voci, le restituisce tutte come `item` senza «Altri»:
   un «Altri» con una sola voce è peggio della voce stessa.
4. Altrimenti restituisce le prime `topN` come `item` e una fetta `others` con le voci
   rimaste (in ordine) e la somma dei loro valori.

Lista vuota (o tutta ≤ 0) → `[]`.

## Resa e tema

- Canvas: solo le fette. Nessun testo sul canvas, quindi nessun font da risolvere.
- Colori: `{ custom }` passa al canvas così com'è; un token si risolve dal tema;
  «Altri» usa sempre `chart-neutral`. Nessun esadecimale di ripiego: un token mancante
  resta stringa vuota, come nella linea.
- Bordo di separazione fra fette: `--color-surface`.
- `DOUGHNUT_CHART_GEOMETRY`: `cutout: '68%'`, `borderWidth: 2`, `hoverOffset: 6`
  (applicato alla fetta attiva), `layoutPadding` sufficiente a non tagliare l'offset.
- Opzioni: `responsive`, `maintainAspectRatio: false`, `animation: false`,
  legenda e tooltip di Chart.js disattivati.
- `resolveDoughnutChartTheme(style)`: pura, legge `--color-surface` e i colori-serie
  tramite `resolveSeriesColors`.
- Risoluzione in `afterRenderEffect` dipendente da `ThemeStore.theme()`; finché il tema
  non è risolto non si disegna.
- `plugins` è una costante vuota con riferimento stabile.
- Il centro è HTML sovrapposto al foro (centrato in assoluto sul canvas), con
  `aria-live="polite"`; non intercetta il puntatore sulle fette.

## Interazione

Stato: `hover: number | null` (puntatore) e `focusIndex: number | null` (tastiera).
Fetta attiva = `hover ?? focusIndex`; passa ad `AppChart` come `activeElements` e
al template del centro come fetta (o `null`).

- Puntatore: `hovered` aggiorna `hover`; `pointerleave` sull'host lo azzera.
- Click: emette `sliceActivated` per la fetta sotto il puntatore; nessuna emissione
  se il click cade fuori dalle fette.
- Tastiera (un solo punto di tabulazione, `tabIndex` 0):
  - focus → `focusIndex = 0` se nullo;
  - ←/↑ precedente, →/↓ successiva, **in cerchio**; Home prima, End ultima;
  - Invio/Spazio → `sliceActivated` della fetta attiva, con `preventDefault`;
  - Esc → azzera `focusIndex` e `hover`;
  - blur → azzera `hover` e `focusIndex`.
  - Senza fette nessun tasto fa niente.
- Se `items` cambia e l'indice attivo esce dalle fette, si scarta (`AppChart` già
  filtra gli indici non validi; il componente riporta `focusIndex` a `null`).

## Integrazione nella scheda Categorie

`AnalyticsCategories`:

- Stato locale `view = signal<'chart' | 'list'>('chart')`.
- `ChoiceGroup` (`mode="single"`) nello slot `panelActions` di `SectionHeader`, opzioni
  `{ id: 'chart', label: 'Grafico' }` e `{ id: 'list', label: 'Lista' }`,
  `ariaLabel="Vista delle categorie"`. Il toggle compare solo con almeno una categoria;
  con zero categorie resta il messaggio attuale.
- Vista Grafico:
  - `items = categories()`, `value = c => c.amount`, `label = c => c.name`,
    `color = c => c.color ? { custom: c.color } : 'chart-neutral'`,
    `ariaLabel="Distribuzione delle spese per categoria"`.
  - Centro: con fetta `item` → nome, `Amount` (`-amount`, stessa convenzione della Lista)
    e `formatPercent(percentage)` del backend; con `others` → `othersLabel`, somma degli
    importi e somma delle `percentage`; con `null` → «Totale spese» e somma degli importi
    positivi disegnati.
  - `sliceActivated`: `item` → `categorySelected.emit(item.categoryId)`;
    `others` → `view.set('list')`.
  - Se ci sono categorie ma nessuna con importo positivo: messaggio
    «Nessuna spesa netta da rappresentare.» al posto della ciambella; il toggle resta.
- Vista Lista: invariata.
- `analytics-page` non cambia.

## Test (TDD, Vitest)

- `doughnut-grouping.spec.ts`: `topN+1` voci senza «Altri»; `topN+2` con «Altri» (voci e
  somma); scarto dei ≤ 0; ordinamento decrescente stabile; lista vuota e tutta ≤ 0.
- `chart-theme.spec.ts`: `resolveSeriesColors` e `seriesColorToken`.
- `doughnut-chart-theme.spec.ts`: lettura dei token, stringa vuota se mancano.
- `doughnut-chart-config.spec.ts`: colori `custom` vs token, «Altri» neutro, etichette,
  geometria, legenda/tooltip spenti.
- `chart.spec.ts`: un caso `type="doughnut"` (creazione, elementi attivi, aggiornamento dati).
- `doughnut-chart.spec.ts` (finto `CHART_CONSTRUCTOR`): hover, `pointerleave`, click su
  fetta e fuori, frecce in cerchio, Home/End, Invio/Spazio, Esc, focus/blur, contesto del
  template centrale, nessun disegno senza tema.
- `analytics-categories.spec.ts`: default Grafico, toggle verso Lista e ritorno; `item` →
  `categorySelected`; `others` → Lista; toggle assente senza categorie; messaggio con soli
  rimborsi netti.
- Le spec di `line-chart*`, `line-guides-plugin` e `value-scale` non si modificano.

## Gate e documentazione

- `scripts/design-system-gate.sh`, controllo «Chart.js resta dentro shared/ui/chart»:
  l'elenco dei moduli interni vietati alle feature diventa `chart`, `chart-theme`,
  `line-chart-config`, `line-chart-theme`, `line-guides-plugin`, `doughnut-chart-config`,
  `doughnut-chart-theme`, `doughnut-grouping`. Il commento elenca i moduli pubblici
  (`line-chart`, `line-chart.model`, `doughnut-chart`, `doughnut-chart.model`, `chart.model`).
- `docs/architecture/frontend-shared-components-proposal.md`, sezione del grafico:
  albero a strati con il ramo doughnut, API pubblica del Doughnut, regola dei colori
  `custom`, nuovi moduli nel gate. Tabella di copertura: `AnalyticsCategories` diventa
  «lista o `<app-doughnut-chart>`, a scelta con toggle».
