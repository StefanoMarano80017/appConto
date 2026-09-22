# UI/UX Upgrade — documento di progettazione

> Documento di **sola progettazione**. Nessun codice è stato modificato.
> Ambito: esclusivamente `apps/frontend`. Backend, dominio, API e modello dati non sono toccati.
> Fonte di verità visiva: `./design-system` (`DESIGN_SYSTEM.md` + `design-tokens.json`).

---

## 0. Metodo e stato di partenza

L'analisi è stata condotta leggendo: `app.html/scss/ts`, `app.routes.ts`, `styles.scss`, `shared/styles/_tokens.scss`, `_mixins.scss`, tutti gli 11 componenti di `shared/`, i template delle 10 pagine e i relativi `.scss`, più `core/format.ts` e `core/theme.ts`. Le duplicazioni e i conteggi citati sotto sono **misurati** con `grep` sul codice, non stimati.

**Baseline verificata al momento della scrittura**: `npm run test:frontend` → 25 file, **232 test verdi**; `npm run build:frontend` → bundle iniziale **497 KB**.

**Precondizione**: il lavoro in corso non committato (60 file, migrazione ai componenti shared, test verdi) va committato prima della Fase 0, così che il diff del redesign resti separabile da quello della migrazione shared.

---

## 1. Current state

### 1.1 Stack

Angular 21 standalone, **zoneless**, CSR puro. Componenti a segnali (`input()`, `input.required()`, `output()`, `computed()`), sintassi `@if`/`@for`/`@let`. **Nessuna libreria UI** (niente Material, PrimeNG, Tailwind): tutto lo stile è SCSS scritto a mano. Test con Vitest + `TestBed`. Distribuzione: eseguibile Windows portable, **offline, nessuna CDN**.

### 1.2 Struttura

```
app/
├── core/        logica trasversale: theme, format, amount, period, truncate, http-error, api
├── shared/
│   ├── layout/  Panel, SectionHeader
│   ├── ui/      Badge, EmptyState, ErrorRetry, FilterChips, FormField,
│   │            SearchInput, SegmentedControl, StatCardGrid, ToggleButtonGroup
│   └── styles/  _tokens.scss (4 token geometrici), _mixins.scss (pill-button)
└── features/    analytics, cash-flow, categories, dashboard, import, loans,
                 maintenance, merchants, settings, transactions
```

Routing piatto, 10 rotte, tutte eager. Shell unica (`App`) con header orizzontale e nav a 8 voci.

### 1.3 Cosa funziona già bene — da preservare

| Aspetto | Evidenza |
|---|---|
| **Theming** | 1 solo esadecimale hardcoded in 40+ file `.scss`. Tutto passa da custom property. `data-theme` + `prefers-color-scheme` già implementati come il DS §3 richiede, con anti-flash in `index.html` |
| **Strato shared** | 11 componenti reali; `Panel` da solo è adottato in 18 file. Nessuno inietta servizi o conosce le feature |
| **Separazione core/feature** | Validazione come funzioni pure (`loan-form.ts`, `settings-form.ts`), formattazione in `core/format.ts`, stato URL in `*-query.ts` |
| **Accessibilità parziale** | `aria-sort`, `aria-describedby`, `aria-label` presenti; colori delle serie grafiche verificati contro la deuteranopia |

Il theming attuale **è già il meccanismo che il DS impone**. Il redesign ne sostituisce i valori, non l'architettura.

### 1.4 I gap misurati

| # | Gap | Misura |
|---|---|---|
| 1 | **Nessun responsive** | 1 sola `@media` in tutta l'app, ed è `prefers-reduced-motion`. Zero breakpoint di layout |
| 2 | **Nessuna scala tipografica** | 139 `font-size` hardcoded su 12 valori distinti |
| 3 | **Geometria non tokenizzata** | 25 `border-radius: 6px` scritti a mano contro 4 usi di `var(--radius-control)` |
| 4 | **Numeri finanziari senza mono** | `font-variant-numeric: tabular-nums` duplicato in 40 punti, `font-family` mono in **zero** punti |
| 5 | **Entrate distinte dal solo colore** | `transactions-table.scss:101` — `.numeric { color: var(--positive) }` senza segno `+`. Le uscite hanno il `−` da `Intl`, le entrate no |
| 6 | **`.message` duplicato** | Ridefinito in 23 file; assente da `styles.scss` |
| 7 | **4 pattern di filtro diversi** | Dashboard controlli inline · Analytics pannello collassabile · Movimenti `<details>` · Prestiti/Merchant pillole inline |
| 8 | **Valore finanziario duplicato** | 44 chiamate a `formatAmount` in 13 template, ognuna con allineamento e colore riscritti a mano |
| 9 | **Adozione shared incompleta** | Residui `<section class="panel">` in `settings-page`, `transactions-page`, `reset-panel`, `loan-detail-page` |
| 10 | **Incoerenza di collocazione** | `StatCardGrid` sta in `shared/ui/` ma è una griglia senza interazione |

---

## 2. Design system analysis

### 2.1 Cosa impone il DS

| | Oggi | `./design-system` |
|---|---|---|
| Brand | blu `#2f6feb` / `#6b9bff` | viola `#5B55C4` (light) / `#5F5BA8` (dark) |
| Font | Segoe UI, system stack | **Geist** + **Geist Mono** |
| Body | 15px | **12.5px** |
| Numero massimo | 28px | **25px** (regola rigida, §4) |
| Superfici | 2 livelli | **6** (`background`/`panel`/`surface`/`elevated`/`hover`/`active`) |
| Token colore | ~15 | **33 per tema** |
| Scala spaziatura | nessuna | `[2,4,6,8,12,16,20,24,32,40]` |
| Raggi | 4 | 6 categorie per tipo di elemento |
| Layout | header top + nav orizzontale | **sidebar + colonna dati + toolbox destra** |

**Non è un ritocco.** È una sostituzione visiva completa che cambia anche la densità dell'informazione e l'impalcatura di navigazione.

### 2.2 Le regole non negoziabili

1. **§2** — i componenti referenziano solo il livello semantico o componente, **mai un esadecimale**. Un colore hardcoded è un punto di divergenza garantito.
2. **§4** — ogni valore numerico finanziario usa `Geist Mono` + `tabular-nums`. La gerarchia fra numeri si ottiene **per contrasto di colore, non per dimensione**: nessun numero supera 25px.
3. **§5** — entrate e uscite non si distinguono **mai** solo per colore: sempre segno `+`/`−`, triangolo, o posizione rispetto allo zero.
4. **§3** — cambiare tema tocca solo la tabella dei colori. Layout, spaziatura, raggi e dimensioni restano identici.
5. **§6** — impalcatura a tre colonne condivisa da tutte le viste; cambia il contenuto della toolbox, non la sua forma.

### 2.3 Le 13 lacune del DS

Il DS §10 dichiara di non coprire micro-interazioni, breakpoint sotto 1440px e componenti non presenti nel mockup, e chiede esplicitamente di **decidere invece di dedurre per analogia**. Confrontandolo con il codice reale, le lacune che richiedono una decisione sono 13:

| # | Lacuna | Uso reale | Decisione presa |
|---|---|---|---|
| 1 | Breakpoint <1440px | tutta l'app | **1280px** e **900px** (§5.3) |
| 2 | **Ombre** — `design-tokens.json` non contiene alcun token d'ombra | tooltip grafico, dropdown | Mantenere `--shadow-tooltip`/`--shadow-dropdown` attuali, riespressi sui nuovi neutri |
| 3 | Stati voce di navigazione | sidebar, 8 voci | hover → `surface-hover`; attivo → `primary-subtle` + barra inset 2px `primary` (stessa formula di `tableRow.selected`) |
| 4 | Stati `<select>` | tabella movimenti, toolbar | Identici a `input` |
| 5 | Checkbox / radio | selezione multipla, scelta tema | `primary` da spuntato, `focusRing` da focus |
| 6 | `<th>`, ordinamento, zebra | 5 tabelle | `text-muted` + ruolo `label`; **niente zebra** (il DS separa le righe con `row-divider`) |
| 7 | Paginazione | movimenti | Riuso di `SegmentedControl` per i numeri di pagina |
| 8 | Skeleton / loading | movimenti, analytics | `surface-elevated` pulsante |
| 9 | Bottoni secondary / ghost / danger — il DS definisce solo `primaryButton` | ~25 usi | secondary = `border` + `surface` + `text-primary`; ghost = trasparente + `text-secondary`; danger = `error` |
| 10 | Testo hover bottone primario in tema chiaro — **il DS §8 lo segnala come non verificato** | bottoni primari | Verificare il contrasto su `#625CC0`; se <4.5:1 usare `on-primary` |
| 11 | `<details>` / dropdown | toolbar movimenti | **Superata**: i filtri vanno in toolbox, i `<details>` spariscono |
| 12 | Barre di avanzamento / ripartizione | dettaglio prestito | `primary` su `surface-active`, raggio `badge` |
| 13 | Assi, griglia e tooltip del grafico | timeline | Griglia `border`, etichette `text-muted`, tooltip su `surface-elevated` |

---

## 3. UX audit

Per ogni pagina: obiettivo dell'utente, informazione primaria, e i problemi rilevati.

### Dashboard (`/`)
- **Obiettivo**: *quanto ho e come sto andando questo mese*
- **Primario**: liquidità disponibile. **Secondario**: KPI, categorie, top merchant, confronto, transazioni
- **Problemi**: il numero più importante dell'app sta nel **secondo** pannello; il primo mostra i controlli. Sei pannelli a tutta larghezza impilati: il percorso dell'occhio è lunghissimo. Selettore mese e filtro tipo sono mescolati all'intestazione dei KPI. Categorie e Top merchant sono liste della stessa forma ma impilate invece che affiancate

### Analytics (`/analytics`)
- **Obiettivo**: *come sono andate le finanze nel periodo che scelgo*
- **Primario**: andamento nel tempo. **Secondario**: KPI, ripartizioni, prestiti
- **Problemi**: i filtri stanno in una sezione **collassabile in testa**. Aprirla spinge ogni dato sotto la piega; per cambiare un filtro si perde di vista il grafico che si stava guardando. È il problema di gerarchia più grave dell'app. In più i KPI stanno *sotto* i filtri, quindi il primo dato utile arriva dopo due pannelli di controlli

### Movimenti (`/transactions`)
- **Obiettivo**: *trovare e correggere movimenti*
- **Primario**: la tabella. **Secondario**: filtri, paginazione
- **Problemi**: cinque `<details>` sovrappongono contenuto e mostrano **un filtro alla volta**; lo stato complessivo dei filtri non è mai visibile tutto insieme. Controlli di paginazione duplicati identici sopra e sotto la tabella. Le entrate sono verdi senza segno `+` (violazione DS §5)

### Prestiti — elenco (`/loans`)
- **Obiettivo**: *chi mi deve quanto*
- **Problemi**: minori. Filtri (stato, persona) e ricerca occupano un pannello intero sopra la tabella

### Prestiti — dettaglio (`/loans/:id`)
- **Obiettivo**: *stato di questo prestito, registrare una restituzione*
- **Problemi**: 324 righe, cinque pannelli impilati. L'azione principale — registrare una restituzione — è in fondo alla pagina, dopo il movimento d'origine e la barra di ripartizione. Il modulo di modifica inline compare al posto dell'intestazione, spostando tutto il contenuto sotto

### Merchant (`/merchants`)
- **Obiettivo**: *classificare gli esercenti*
- **Problemi**: minori. I tre filtri con contatore stanno sopra la tabella e la comprimono

### Categorie (`/categories`)
- **Obiettivo**: *gestire le categorie*
- **Problemi**: il modulo di creazione sta fra l'intestazione e la tabella, quindi separa il titolo dal contenuto che descrive

### Import CSV (`/import`)
- **Obiettivo**: *importare un estratto conto*
- **Problemi**: minori. Testo esplicativo a piena larghezza (righe troppo lunghe per una lettura comoda)

### Impostazioni (`/settings`)
- **Obiettivo**: *impostare il saldo iniziale, il tema, azzerare*
- **Problemi**: due pannelli affiancati via una griglia `.row` locale a uso singolo; la zona pericolosa (reset) sta sotto senza separazione visiva proporzionata al rischio

### Crea prestito (`/loans/new`)
- **Obiettivo**: *registrare un prestito da un movimento*
- **Problemi**: nessuno rilevante. Modulo lineare, già su `FormField`

### Trasversali
- **Nessun responsive**: la finestra ridimensionata rompe ogni pagina
- **Nessuna gerarchia tipografica sistematica**: 12 dimensioni diverse usate senza regola
- **Densità bassa**: poche righe visibili per schermata su una app il cui valore è confrontare molti numeri

---

## 4. Target UX principles

1. **I dati non si spostano quando si filtra.** I controlli vivono in una colonna propria, sempre visibile. Nessun pannello di filtri che apre e chiude spingendo il contenuto.
2. **Il numero più importante è il primo che si vede.** In ogni pagina l'informazione primaria sta in alto nella colonna principale, non dopo i controlli.
3. **Un numero finanziario si legge come un numero.** Mono, `tabular-nums`, allineato a destra, segno esplicito. Sempre, ovunque, da un solo componente.
4. **Il colore non è mai l'unico canale.** Entrata/uscita portano sempre il segno. Il grafico porta sempre legenda e tabella valori.
5. **La stessa idea ha lo stesso aspetto in ogni pagina.** Un filtro è un `FilterGroup` in tutte e cinque le pagine che ne hanno.
6. **La densità serve al confronto.** Più righe a schermo significa meno scorrimento per rispondere a "dove sono finiti i soldi".
7. **Niente è raggiungibile solo in una larghezza.** A ogni breakpoint tutto il contenuto resta accessibile; cambia la disposizione, non l'inventario.

---

## 5. Target layout strategy

### 5.1 Architettura dei token

Tre livelli come impone DS §2, in `shared/styles/`:

```
_primitives.scss      livello 1 — gli esadecimali grezzi, un blocco per tema
_semantic.scss        livello 2 — --color-*, --space-*, --radius-*
_typography.scss      livello 2 — un mixin per ruolo tipografico
_mixins.scss          livello 3 — focus-ring, pill-button, data-table, field
_legacy-aliases.scss  ponte temporaneo — cancellato in Fase 7
```

**Colori**: 33 token semantici per tema, presi 1:1 da `design-tokens.json`. I 3 valori che il DS §8 marca `literal` diventano token con nome — `--color-primary-hover-border`, `--color-disabled-surface`, `--color-disabled-input` — perché un letterale scritto a mano nel CSS è esattamente il punto di divergenza che §2 vieta.

**Tipografia come mixin, non come custom property**: ogni ruolo della scala porta 3-5 proprietà insieme (famiglia, dimensione, peso, spaziatura, trasformazione). Spezzarle in 40 variabili renderebbe possibile usarne una senza le altre.

```scss
.amount       { @include text(financial-row); }  // mono, 12.5px, 500, tabular-nums
.panel-title  { @include text(section-title); }  // ui, 13px, 600
```

Questo chiude in un colpo tre gap: i 139 `font-size` hardcoded, i 40 `tabular-nums` duplicati e l'assenza totale di mono sui numeri.

**Spaziatura e raggi**: `--space-1…10` sulla scala DS, 6 raggi DS. `--radius-panel: 8px` diventa `--radius-card: 10px`.

**Font**: Geist e Geist Mono (licenza OFL) in `public/fonts/`, `@font-face` con `font-display: swap`, subset latin. Stima **+140 KB** sui 497 attuali — sotto il budget `initial` di 1 MB già configurato in `angular.json`.

### 5.2 Il ponte degli alias

La Fase 0 definisce i token DS **e** ridefinisce i 15 nomi attuali come alias:

```scss
--surface:  var(--color-surface);
--text:     var(--color-text-primary);
--accent:   var(--color-primary);
--negative: var(--color-expense);
--positive: var(--color-income);
```

L'app cambia palette **interamente** senza toccare un solo file di feature — possibile solo perché il codice legge già il 100% dei colori da custom property. Ogni fase successiva, aprendo un file per altri motivi, ne sostituisce i riferimenti. `_legacy-aliases.scss` si svuota progressivamente.

**Il criterio di completamento è meccanico**: se il file si può cancellare e la build passa, la migrazione dei token è finita per costruzione. Nessun giudizio soggettivo.

### 5.3 Impalcatura e breakpoint

**Shell** (`app.html`/`app.scss`): sidebar fissa 240px con le 8 voci e il toggle tema in fondo. Resta nella shell e **non** diventa un componente shared: ha un solo uso, e il progetto ha già una regola esplicita contro l'astrazione dei pezzi di shell a uso singolo.

**`PageLayout`** (`shared/layout/`): colonna principale + slot `[pageToolbox]` opzionale da 300px. Quando nessuno proietta nella toolbox la griglia diventa a colonna singola: le pagine senza filtri non dichiarano nulla e non pagano nulla.

```
≥1280px    [sidebar 240] [ main minmax(0,1fr) ] [ toolbox 300 ]

900–1279   [sidebar 240] [ main                                ]
                         [ toolbox — sotto, gruppi in riga      ]

<900px     [ topbar: nav orizzontale scrollabile               ]
           [ main ]
           [ toolbox ]
```

Sotto i 1280px la toolbox **non sparisce e non diventa collassabile**: si dispone in riga sopra il contenuto. Nessun contenuto diventa irraggiungibile a nessuna larghezza.

**Quando la toolbox si usa**: quando la pagina ha filtri persistenti o azioni contestuali ripetute. Non meccanicamente. Cinque pagine l'avranno per i filtri (Analytics, Movimenti, Dashboard, Prestiti elenco, Merchant), due per azioni contestuali (Categorie, Dettaglio prestito), tre non l'avranno (Import, Impostazioni, Crea prestito).

---

## 6. Shared component strategy

Ogni problema del redesign è passato per la scala: **shared esistente → generalizzazione → nuovo shared → specifico della feature**. Risultato: **4 componenti nuovi, 1 esteso, 1 semplificato, 1 spostato, 3 utility CSS, 2 mixin**. Tutto il resto si risolve componendo.

### 6.1 I quattro nuovi

#### `Amount` — `shared/ui/amount`

Il più importante. `formatAmount` è chiamato **44 volte in 13 template**, e ogni chiamante riscrive a mano allineamento, `tabular-nums` e classe di colore. Nessuno scrive `font-family` mono. Le entrate si distinguono solo per colore.

Un token non può risolverlo: DS §4 e §5 sono regole sul **rendering di un valore**, non su un colore.

- **Responsabilità**: rendere un valore finanziario secondo DS §4 e §5
- **Input**: `value: number` · `tone: 'auto' | 'neutral' | 'positive' | 'negative'` (def. `auto`) · `size: 'row' | 'kpi'` (def. `row`) — `row` = ruolo `financial-row` (12.5px), `kpi` = ruolo `display-kpi` (25px, il massimo che il DS §4 consente)
- **Output**: nessuno
- **Perché shared**: 44 usi; è l'unico modo per rendere **verificabile** la regola di accessibilità
- **Pagine**: tutte tranne Impostazioni e Manutenzione

Con `tone` non neutro il segno è **sempre** esplicito (`+1.647,30 €` / `−892,10 €`). Con `tone: 'neutral'` resta il segno naturale, così "Saldo iniziale 1.200,00 €" non diventa "+1.200,00 €".

**Non è una pipe**: una pipe restituisce una stringa e non può emettere insieme segno, colore e famiglia di caratteri.

#### `PageLayout` — `shared/layout/page-layout`

- **Responsabilità**: la griglia di pagina (principale + toolbox opzionale)
- **Input**: nessuno — la presenza della toolbox è determinata dalla proiezione
- **Pagine**: tutte e 10

#### `FilterGroup` — `shared/ui/filter-group`

Il mattone che rende le toolbox identiche fra viste, come DS §6 richiede. Oggi lo stesso concetto esiste in 3 forme: `.group > h3` in Analytics, `<details><summary>` in Movimenti, inline in Dashboard/Prestiti/Merchant.

- **Input**: `label: string`
- **Contenuto**: il controllo proiettato
- **Riuso**: ~18 usi su 5 pagine

#### `SortableHeader` — `shared/ui/sortable-header`

`<th>` con pulsante di ordinamento, freccia e `aria-sort`. 3 usi. Già marcato "Consigliato" nella proposta precedente e mai realizzato; il redesign tocca tutte le tabelle.

- **Input**: `label: string` · `active: boolean` · `direction: 'asc' | 'desc'`
- **Output**: `sorted`

### 6.2 Cosa **non** creo

**Nessun componente `Toolbox`.** Sarebbe `Panel` + `SectionHeader` + N × `FilterGroup` + `FilterChips`, tutti già esistenti. La pagina li compone. Un contenitore con 4 slot opzionali per risparmiare 5 righe di template è il mega-componente configurabile da evitare.

**Nessun `DataTable` generico.** Confermata la decisione precedente: le 5 tabelle differiscono nel **contenuto** delle celle (select inline, link a prestiti, input di rinomina, barra di avanzamento), non nell'involucro. Si condivide l'involucro come `@mixin data-table` — scroller, `border-collapse`, `row-divider`, hover, allineamento numerico.

**Nessun `StatusMessage` componente.** Resta utility CSS, ma va **effettivamente realizzata**: oggi `.message` è ridefinita in 23 file e in `styles.scss` non c'è.

**Nessun `AppSidebar` shared.** Uso singolo.

### 6.3 Correzioni sull'esistente

| Componente | Problema | Azione |
|---|---|---|
| `SectionHeader` | Usato sia per titolo pagina sia per titolo sezione; il DS li distingue (15px vs 13px) | `level: 'page' \| 'section'` (def. `section`). Il contratto non cambia forma, cambia solo la tipografia: un input, non un secondo componente |
| `SearchInput` | `icon: boolean` duplica l'intero template in `@if/@else` | Con il DS l'icona è standard: rimuovere flag e ramo |
| `StatCardGrid` | In `shared/ui/` ma è una griglia senza interazione | Spostare in `shared/layout/` |
| `Badge` | `tone` limitato a positive/negative | Estendere ai toni semantici DS solo dove un uso reale lo richiede |
| `Panel` | `--radius-panel: 8px`, `padding: 1.5rem` | `--radius-card: 10px`, `--space-7: 20px`. Il DS dice 14px dentro la card; 20px è il valore che regge il contenuto reale — da verificare in Fase 3 |
| `.message` · `.sr-only` · `.breadcrumb` | Duplicate in 23, 2 e 2 file | Utility globali in `styles.scss`, accanto a `.truncate` |

**Bilancio**: 11 componenti shared → **15**. Nessuno con più di 4 input. Nessuno che inietta servizi. La regola resta: `shared/**` non importa mai da `features/**`.

---

## 7. Page-by-page strategy

### Analytics — pagina pilota

```
OGGI                              TARGET
┌──────────────────────────┐      ┌───────────────────┬─────────┐
│ Analytics    [Filtri ▾]  │      │ Analytics         │ PERIODO │
│ [7g][30g][90g][anno]     │      │ ┌───┐┌───┐┌───┐   │ [preset]│
│ dal __ al __             │      │ │KPI││KPI││KPI│   │ dal/al  │
│ ┌──────────────────────┐ │      │ └───┘└───┘└───┘   │ TIPO    │
│ │ Tipo · Categ ·       │ │      │ ┌───────────────┐ │ ▪▪▪     │
│ │ Merch · Classif      │ │      │ │   timeline    │ │ CATEG.  │
│ └──────────────────────┘ │      │ └───────────────┘ │ ▪▪▪▪▪   │
│ ┌───┐┌───┐┌───┐          │      │ ┌──────┐┌──────┐ │ MERCH.  │
│ │KPI││KPI││KPI│  ← i dati│      │ │Categ.││Merch.│ │ [cerca] │
│ └───┘└───┘└───┘  sono qui│      │ └──────┘└──────┘ │ CLASSIF │
│ timeline…                │      │ ┌───────────────┐ │ ▪▪▪     │
│                          │      │ │   prestiti    │ │ ─────── │
└──────────────────────────┘      └───────────────────┴─ Reset ─┘
```

- **Layout**: `PageLayout` con toolbox
- **Riusa**: Panel, SectionHeader, StatCardGrid, SegmentedControl, ToggleButtonGroup, SearchInput, FilterChips
- **Crea l'uso di**: PageLayout, FilterGroup, Amount
- **Modifica**: `analytics-toolbar` → `analytics-filters`, proiettato in toolbox
- **UX**: il segnale `showFilters` e il pulsante "Filtri" **spariscono** — un filtro sempre visibile non ha bisogno di essere mostrato. I KPI risalgono in cima
- **Non tocca**: `AnalyticsStore`, `analytics.api.ts`, `analytics.model.ts`, `timeline-scale.ts`
- **Rischio**: medio — stabilisce il pattern di ogni pagina successiva

### Dashboard

- **Layout**: toolbox = mese + tipo + chip attivi
- **Colonna principale**: **Liquidità promossa in testa** con il numero in `display-kpi` → riga KPI → Categorie e Top merchant **affiancati** (liste della stessa forma, oggi impilate) → confronto mensile → transazioni
- **UX**: il numero più importante dell'app smette di essere il secondo pannello
- **Rischio**: condivide `TransactionsTable` con Movimenti → **non parallelizzabile** con essa

### Movimenti

- **Layout**: toolbox = periodo, tipo, categoria, merchant, classificazione. Ricerca in testa alla colonna principale (è un'azione, non un filtro)
- **UX**: i cinque `<details>` **spariscono**. Paginazione: in alto resta il solo conteggio ("142 movimenti · pagina 2 di 8"), in basso il pager completo — oggi i controlli sono duplicati identici
- **Tabella**: `@mixin data-table` + `SortableHeader` + `Amount` (che risolve la violazione DS §5)
- **Non tocca**: `transaction-query.ts`, `transactions.api.ts`
- **Rischio**: medio — è la pagina con più stato (query URL, selezione multipla, eliminazione a conferma)

### Prestiti — elenco

- **Layout**: toolbox = stato + persona. Ricerca in testa. KPI + tabella in colonna principale
- **Rischio**: basso

### Prestiti — dettaglio

- **Layout**: toolbox = **azioni contestuali** — modulo "Registra restituzione", modifica, elimina
- **Colonna principale**: intestazione con avanzamento → movimento d'origine con barra di ripartizione → tabella restituzioni
- **UX**: l'azione principale smette di essere in fondo alla pagina
- **Rischio: il più alto del piano.** 324 righe, 5 pannelli, modulo di modifica inline. Ultima della Fase 4. Rete: `loan-detail-page.spec.ts` esistente

### Merchant

- **Layout**: toolbox = classificazione con contatori. Ricerca in testa. Tabella editabile inline invariata nel comportamento
- **Rischio**: basso

### Categorie

- **Layout**: toolbox = modulo di creazione (azione contestuale). Colonna principale: sola tabella con rinomina/ricolora inline
- **UX**: titolo e tabella tornano adiacenti
- **Rischio**: basso

### Import CSV

- **Layout**: colonna singola, nessuna toolbox, `max-width` per la leggibilità del testo esplicativo
- **Rischio**: basso — sola ristilatura

### Impostazioni + Manutenzione

- **Layout**: colonna singola con `max-width`; tre pannelli impilati (impostazioni, tema, zona pericolosa). La griglia `.row` locale **sparisce**
- **UX**: la zona pericolosa riceve il tono `error` e una separazione proporzionata al rischio
- **Rischio**: basso

### Crea prestito

- **Layout**: colonna singola, `max-width`. Sola ristilatura
- **Rischio**: basso

---

## 8. Component mapping

| Design concept | Componente esistente | Componente proposto | Azione |
|---|---|---|---|
| Card / pannello | `Panel` | `Panel` | **riusa** (token aggiornati) |
| Titolo pagina | `SectionHeader` | `SectionHeader[level=page]` | **generalizza** |
| Titolo sezione | `SectionHeader` | `SectionHeader` | **riusa** |
| Valore finanziario | — (44 duplicazioni) | `Amount` | **crea shared** |
| KPI / metrica | `StatCardGrid` (in `ui/`) | `StatCardGrid` (in `layout/`) | **sposta + riusa** |
| Impalcatura 3 colonne | — | `PageLayout` | **crea shared** |
| Navigazione | `app.html` inline | `app.html` inline | **ridisegna in loco** (uso singolo) |
| Gruppo di filtro | 3 forme diverse | `FilterGroup` | **crea shared** |
| Contenitore toolbox | — | *nessuno* | **componi** `Panel`+`SectionHeader` |
| Filtri attivi | `FilterChips` | `FilterChips` | **riusa** |
| Scelta singola | `SegmentedControl` | `SegmentedControl` | **riusa** |
| Scelta multipla | `ToggleButtonGroup` | `ToggleButtonGroup` | **riusa** |
| Ricerca | `SearchInput` | `SearchInput` | **semplifica** |
| Tabella dati | 5 implementazioni | `@mixin data-table` | **CSS condiviso** |
| Intestazione ordinabile | 3 duplicazioni | `SortableHeader` | **crea shared** |
| Campo di form | `FormField` | `FormField` | **riusa** |
| Badge di stato | `Badge` | `Badge` | **riusa** |
| Stato vuoto | `EmptyState` | `EmptyState` | **riusa** |
| Errore + retry | `ErrorRetry` | `ErrorRetry` | **riusa** |
| Messaggio di stato | 23 duplicazioni | `.message` globale | **utility CSS** |
| Paginazione | `TransactionsPagination` | resta feature | **ristila** |
| Grafico timeline | `AnalyticsTimeline` | resta feature | **ristila** |

---

## 9. Incremental implementation plan

| Fase | Contenuto | File toccati | Rischio |
|---|---|---|---|
| **0 — Fondamenta** | `_primitives`/`_semantic`/`_typography`/`_mixins`/`_legacy-aliases`, font Geist in `public/fonts/`, `styles.scss` riscritto | 7 nuovi + 1 | **Nullo** — zero file di feature |
| **1 — Primitive shared** | `Amount`, `FilterGroup`, `SortableHeader` · `SectionHeader.level` · `SearchInput` semplificato · `StatCardGrid` spostato · `.message`/`.sr-only`/`.breadcrumb` globali · `@mixin data-table` | ~14 in `shared/` | **Basso** — nuovo codice, nessuna pagina migrata |
| **2 — Shell e PageLayout** | Sidebar in `app.html/scss`, `PageLayout`, tutte le pagine avvolte a colonna singola | 1 shell + 1 shared + 10 pagine | **Medio** — cambia la navigazione |
| **3 — Pilota: Analytics** | Toolbox reale, `Amount`, `FilterGroup`, rimozione di `showFilters` | 8 | **Medio** — stabilisce il pattern |
| **4 — Pagine con toolbox** | Movimenti → Dashboard · Prestiti elenco ∥ Merchant ∥ Categorie · Dettaglio prestito | ~30 | **Medio-alto** sul dettaglio prestito |
| **5 — Pagine senza toolbox** | Import ∥ Impostazioni+Manutenzione ∥ Crea prestito | ~12 | **Basso** |
| **6 — Responsive** | Breakpoint 1280 e 900, verificati pagina per pagina | ~4 file di layout | **Basso** |
| **7 — Cleanup** | Cancellare `_legacy-aliases.scss`, residui `.panel`/`.message`, checklist DS §9 su ogni schermata | sweep | **Nullo** |

**Perché quest'ordine e non un altro**: la Fase 0 ribalta la palette dell'intera app con un diff da ~60 righe, sfruttando il fatto che il codice legge già tutto da custom property. Questo rende il rischio visivo **visibile subito**, prima che sia stato fatto lavoro strutturale: se la densità a 12.5px non convince, si cambia un valore in `_typography.scss` invece di rifare dieci pagine.

Ogni fase lascia l'app funzionante e distribuibile — vincolo già scritto in `docs/architecture/project-context.md`.

---

## 10. Subagent strategy

| Tipo di task | Fasi | Come |
|---|---|---|
| **Ragionamento architetturale, continuità di contesto** | 0, 1, 2, 3 | Sessione principale, sequenziali. La Fase 3 produce il pattern che ogni pagina successiva copia: delegarla significherebbe delegare la decisione, non l'esecuzione |
| **Parallelizzabili, modello potente** | 4 — Movimenti, Dettaglio prestito | Un subagent ciascuno. Template grandi, stato complesso, alto rischio di regressione |
| **Parallelizzabili, modello leggero** | 4 — Merchant, Categorie · 5 — Import, Impostazioni, Crea prestito | Un subagent ciascuno. Migrazione meccanica su pattern già fissato dal pilota |
| **Sguardo d'insieme** | 6 | Sessione principale: il responsive si verifica confrontando le pagine fra loro |
| **Verifica meccanica** | 7 | Subagent con checklist e grep verificabili |

**Vincoli di parallelismo**
- Dashboard **dopo** Movimenti (condividono `TransactionsTable`)
- Analytics (Fase 3) **prima** di tutta la Fase 4
- Dettaglio prestito **ultimo** della Fase 4

**Contratto di ogni subagent**: riceve la pagina, il file della pagina pilota come riferimento obbligatorio, i criteri di accettazione, e il **divieto di toccare `shared/`**. Se ritiene che serva un componente shared nuovo, **lo segnala e si ferma**. È l'unico modo per evitare che cinque agenti in parallelo inventino cinque versioni dello stesso componente.

---

## 11. Acceptance criteria

### Per ogni fase, senza eccezioni

```bash
npm run build:frontend    # passa; budget anyComponentStyle (6 KB warn / 8 KB error) non superato
npm run test:frontend     # >= 232 test verdi
```

### Verificabili con grep — nessun giudizio soggettivo

Tutti e cinque devono restituire **zero righe**:

```bash
# nessun esadecimale fuori dai primitivi
grep -rn "#[0-9a-fA-F]\{3,8\}" apps/frontend/src --include=*.scss | grep -v _primitives

# nessuna dimensione di carattere fuori dalla scala
grep -rn "font-size:" apps/frontend/src/app --include=*.scss | grep -v _typography

# nessun raggio numerico fuori dai semantici
grep -rn "border-radius: *[0-9]" apps/frontend/src/app --include=*.scss | grep -v _semantic

# shared non conosce le feature
grep -rn "features/" apps/frontend/src/app/shared

# dominio intatto
git diff --name-only | grep -E "\.(model|api|store|query)\.ts$|apps/backend"
```

### Per fase, in aggiunta

| Fase | Criterio |
|---|---|
| **0** | Le 10 pagine si aprono e sono leggibili in entrambi i temi. Geist caricato **senza richieste di rete esterne** (verificabile in DevTools offline) |
| **1** | Ogni nuovo componente ha uno spec che lo istanzia con `TestBed.createComponent()` senza infrastruttura. `Amount` verificato su: positivo con `+`, negativo con `−`, neutro senza segno aggiunto |
| **2** | Le 8 voci raggiungibili da tastiera, `routerLinkActive` corretto, nessuna pagina perde contenuto |
| **3** | Il filtro si applica **senza che i dati si spostino**. `analytics.store.spec.ts` invariato e verde |
| **4 / 5** | Comportamento identico: ordinamento, selezione, modifica inline, submit, errori. Nessuna chiamata API cambiata |
| **6** | A 1280, 1100 e 900px: nessun overflow orizzontale, nessun contenuto irraggiungibile |
| **7** | `_legacy-aliases.scss` **cancellabile**. Checklist DS §9 verificata su ogni schermata. Contrasto >= 4.5:1 su testo in entrambi i temi |

---

## 12. Open questions / decisioni che richiedono approvazione

### Già decise

| # | Decisione | Scelta |
|---|---|---|
| 1 | Scope responsive | Desktop-first, tablet come minimo. Breakpoint 1280 e 900. Sotto i 900 degrado dignitoso, non target |
| 2 | Densità | **Fedeltà piena al DS**: body 12.5px, nessun numero oltre 25px, gerarchia per colore |
| 3 | Font | **Geist + Geist Mono in bundle locale** (`public/fonts/`). +140 KB |
| 4 | Navigazione | **Sidebar fissa 240px**, non collassabile |
| 5 | Palette grafici | **Token DS applicati senza fase di rivalidazione** — scelta esplicita dell'utente, rischio accettato (vedi sotto) |
| 6 | Trattamento del WIP | Committare prima, poi partire da albero pulito |
| 7 | Strategia di migrazione dei token | Approccio A con ponte di alias, rename distribuito nelle fasi successive |

### Rischio accettato e documentato

**Palette dei grafici.** I colori attuali delle 3 serie (blu / arancio / acqua) sono stati scelti e verificati con un validatore per il daltonismo: la coppia verde/rosso cade a ΔE 4,2 in deuteranopia e due linee sovrapposte diventerebbero indistinguibili (commento in `analytics-timeline.scss:1-12`). I token grafico del DS non dichiarano alcuna verifica equivalente.

Per scelta esplicita dell'utente si applicano comunque i token DS, senza una fase di rivalidazione. **Mitigazione**: la mappatura scelta conserva le relazioni di tinta già verificate — entrate → `chart-1` (blu), uscite → `chart-5` (ocra), netto → `chart-3` (acqua) — e il grafico continua a portare **legenda e tabella valori**, quindi il colore non è mai l'unico canale informativo.

### Da approvare con il documento

| # | Decisione | Proposta |
|---|---|---|
| 8 | Le **13 lacune del DS** (§2.3) | Adottare i default proposti in tabella |
| 9 | Padding di `Panel` | 20px (`--space-7`) invece dei 14px indicati dal DS per l'interno card: 14px non regge il contenuto reale dei pannelli dell'app. **Da verificare visivamente in Fase 3** e correggere se il DS ha ragione |
| 10 | Paginazione di Movimenti | Sopra solo il conteggio, sotto il pager completo, invece dei controlli duplicati identici |
| 11 | Promozione della Liquidità in Dashboard | Il numero passa dal secondo pannello alla testa della colonna principale |
| 12 | Toolbox per azioni contestuali | Categorie (modulo di creazione) e Dettaglio prestito (registra restituzione) usano la toolbox per azioni, non per filtri — estensione del pattern DS §6, che parla solo di filtri |

### Aperte, da decidere in corso d'opera

| # | Questione | Quando si decide |
|---|---|---|
| 13 | Il testo hover del bottone primario in tema chiaro (DS §8 lo dichiara non verificato) | Fase 0, misurando il contrasto su `#625CC0` |
| 14 | Se 12.5px risulti troppo piccolo in uso reale | Fase 0, che lo rende visibile su tutta l'app prima di qualunque lavoro strutturale |
| 15 | Se `SortableHeader` debba coprire anche `analytics-timeline` (tabella valori) | Fase 4, quando si conoscerà il costo reale |
