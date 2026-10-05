# Proposta di refactoring architetturale — Frontend: Shared Components e Layout

> Documento di sola progettazione (FASE 1 + FASE 2). Nessun codice è stato modificato.
> Ambito: **esclusivamente `apps/frontend`**. Il backend Express non è stato toccato, analizzato in profondità né considerato per alcuna decisione qui contenuta.

---

## 0. Metodo

L'analisi (FASE 1) è stata condotta leggendo per intero: `app.html/scss/ts`, `app.routes.ts`, `styles.scss`, `core/theme.ts` e il resto di `core/`, e tutti i template (`.html`) e fogli di stile (`.scss`) delle 10 feature esistenti (`analytics`, `cash-flow`, `categories`, `dashboard`, `import`, `loans`, `maintenance`, `merchants`, `settings`, `transactions`), oltre a un campione dei relativi componenti TypeScript per capire l'API (`input()`/`output()`), i pattern di stato (store, query URL) e le convenzioni di test già in uso.

Ogni duplicazione citata sotto è stata verificata leggendo il file sorgente, non dedotta per analogia.

---

## 1. Stato attuale del frontend

**Stack**: Angular 21 standalone (nessun `NgModule`), componenti a segnali (`input()`, `input.required()`, `output()`, `computed()`), nuova sintassi di controllo template (`@if`/`@for`/`@else`/`@empty`/`@let`). Nessuna libreria UI (Material, PrimeNG, ecc.): tutto lo stile è CSS scritto a mano. Test con Vitest + Angular `TestBed` (`HttpTestingController` per le pagine, funzioni pure testate direttamente per la logica di dominio/validazione).

**Struttura**: organizzazione *feature-oriented*, coerente con il principio già dichiarato in [`docs/architecture/architecture.md`](architecture.md) per il backend ("Feature Oriented", "Separation of Concerns"). Ogni cartella in `src/app/features/<feature>/` contiene pagine (`*-page.ts/html/scss`), sotto-componenti di presentazione (es. `analytics-categories`, `cash-flow-card`), un modello (`*.model.ts`), un client API (`*.api.ts`) ed eventualmente uno store di stato (`*.store.ts`) o un modulo di query URL (`*-query.ts`).

**`core/` esiste già ed è un buon esempio di condivisione mirata**: `theme.ts` (store del tema, 3 stati: system/light/dark), `format.ts` (formattazione importi/date/mesi), `amount.ts` (parsing importi digitati), `period.ts` (preset di periodo condivisi fra Analytics e Movimenti), `truncate.ts` (direttiva `appTruncate` + classe globale `.truncate` in `styles.scss`), `http-error.ts` (`toErrorMessage`), `api.ts` (`API_BASE_URL`). Questo strato **non va toccato**: dimostra che il progetto sa già isolare bene la logica davvero trasversale.

**Theming**: già centralizzato molto bene. `styles.scss` definisce due mixin (`light-theme`/`dark-theme`) con circa 15 custom property (`--surface`, `--border`, `--text`, `--accent`, `--negative`, `--positive`, `--series-*`, `--shadow-*`), applicate via `:root`, `[data-theme]` e `prefers-color-scheme`. Ogni componente legge solo variabili, mai colori propri. I colori delle serie del grafico sono scelti e verificati per il daltonismo (commento esplicito in `analytics-timeline.scss` e `styles.scss`). **Questo è un punto di forza da preservare, non da riprogettare.**

**Shell applicativa**: un solo componente (`App` in `app.html/scss/ts`) con header, nav a 7 voci, toggle tema, e `<main class="app-main"><router-outlet /></main>`. Nessuna sidebar, nessun breadcrumb globale, nessuna toolbar di sistema.

**Routing**: piatto, un componente per rotta (`app.routes.ts`), niente route figlie/layout annidati.

**Forme visuali ricorrenti** (verificate leggendo ogni `.html`/`.scss`):
- Contenitore a "pannello" (`<section class="panel">`) con `background/border/border-radius/padding/margin-bottom` **identici** in ~20 file.
- Testo di stato inline (`<p class="message">`) con varianti `.error`, `.warning`, `.done`, `.saved`, `.hint`, `.note` in almeno 15 file.
- Griglia di KPI (`.cards`/`.card` con `.value.positive/.negative`) in 4 file, CSS identico.
- Gruppo di pulsanti a "pillola" con stato attivo (`.periods`/`.options`/`.filters`/`.steps`) in 6 punti diversi.
- Tabelle con intestazione ordinabile e wrapper di scorrimento orizzontale (`.scroller` + `<table>`) in 5 componenti indipendenti.
- Campo di modulo `<label><span class="field-label">…<input>…<span class="field-error">…<span class="field-hint">` in almeno 6 punti.
- Badge di stato (`.badge.open/.settled`) identico in 2 file.
- Chip di filtro attivo + "reset" (`.chips`/`.chip`/`.clear`) identico in 2 file, variante simile in un terzo.
- Stato vuoto, errore+retry, breadcrumb, link "esplora →", conferma inline di eliminazione: ognuno duplicato 2-3 volte.

**Validazione dei form**: già ben fattorizzata come **funzioni pure** separate dal componente (`loan-form.ts`, `settings-form.ts` esportano `validateXForm(value): {valid, errors}`). È un pattern riutilizzabile solido — il problema non è la logica di validazione, ma la *marcatura visuale* del campo (etichetta/errore/hint), che invece è copiata a mano ogni volta.

**Stato via URL**: `transaction-query.ts` e `loan-query.ts` implementano lo stesso concetto — criteri di ricerca serializzati nella query string, con funzioni `parse*Query`/`to*QueryParams`/`hasFilters` quasi identiche nella forma (non nel contenuto). È un pattern di stato, non un componente UI: lo segnalo in §7.C ma resta fuori dal perimetro di "shared UI/layout", che è l'oggetto di questa proposta.

**Un'osservazione architetturale non-visuale**: `TransactionsTable` (usata sia in `transactions-page` sia in `dashboard-page`) inietta direttamente `CategoriesApi`, `MerchantsApi`, `TransactionsApi` e gestisce da sé salvataggio ed errori. Funziona, ma è l'eccezione rispetto al resto dei componenti di presentazione (che ricevono dati via `input()` ed emettono `output()`). Non la tocco (comportamento da preservare), ma la cito come il pattern da **non replicare** nei nuovi componenti condivisi (regola in §13).

> **Aggiornamento**: `TransactionsTable` è poi diventata un componente condiviso di sola presentazione (`shared/ui/transactions-table`), con due modalità: `edit` nei movimenti, `readonly` nella dashboard. Non inietta più nulla: il salvataggio di tipo e categoria vive nella feature (`features/transactions/transaction-edits.ts`), e la colonna dei prestiti è un template proiettato dalla pagina dei movimenti (`appTransactionsTableExtraColumn` + `TransactionLoanCell`).

---

## 2. Problemi architetturali rilevati

Duplicazioni concrete, verificate riga per riga:

| # | Duplicazione | File coinvolti (verificati) | Costo |
|---|---|---|---|
| 1 | `.panel` (background/border/radius/padding/margin) | ~20 file `.scss`, tutte le feature | Cambiare il raggio o il padding del contenitore standard richiede 20 modifiche identiche |
| 2 | `.message` + varianti colore (error/warning/done/saved/hint/note) | 15+ file | Nessuna fonte unica per "come si mostra un messaggio di stato"; le varianti divergono leggermente (es. `warning` a volte usa `--negative`, a volte non esiste affatto) |
| 3 | `.cards`/`.card` (griglia KPI) | `analytics-page.scss`, `dashboard-page.scss`, `loan-detail-page.scss`, `analytics-loans` (via `analytics-page.scss` riusato) | CSS byte-per-byte identico in 3 file |
| 4 | `.badge.open/.settled` | `loans-page.scss`, `loan-detail-page.scss` | Stessa formula `color-mix`, stesso significato, copiata due volte |
| 5 | Gruppo pulsanti "pillola" attivo/hover (`.periods`, `.options`, `.filters`, `.steps`) | `analytics-toolbar.scss`, `merchants-page.scss`, `loans-page.scss`, `transactions-toolbar.scss`, `analytics-timeline.scss` | 6 implementazioni indipendenti dello stesso comportamento visivo |
| 6 | Chrome tabella (scroller + `border-collapse` + `th` ordinabile + allineamento numerico) | `transactions-table.scss`, `loans-page.scss`, `loan-detail-page.scss` (repayments), `merchants-page.scss`, `analytics-timeline.scss` (tabella valori) | 5 tabelle, stessa grammatica visiva, zero riuso |
| 7 | Campo di modulo (label + input + field-error + field-hint) | `loan-create-page.html`, `loan-detail-page.html` (×2 form), `settings-page.html` (×2 campi), `column-picker.html` (×4 campi), `reset-panel.html` | Markup identico ripetuto ~9 volte |
| 8 | Chip filtro attivo + reset | `analytics-toolbar.scss`, `transactions-toolbar.scss` | CSS identico |
| 9 | Stato vuoto (`.empty` + messaggio + hint) | `loans-page.html`, `transactions-page.html` | — |
| 10 | Errore + pulsante "Riprova" | `transactions-page`, `loans-page`, `loan-detail-page` | — |
| 11 | `.sr-only` | `loans-page.scss`, `loan-detail-page.scss` | Duplicata invece di stare in `styles.scss` accanto a `.truncate`, che è già globale |
| 12 | Intestazione di sezione (titolo + sottotitolo + azioni) sotto 4 nomi di classe diversi | `.header`, `.head`, `.toolbar`, `.panel-header` in file diversi | Stesso concetto, quattro implementazioni, nessuna riconoscibile come "lo stesso componente" |
| 13 | Campo di ricerca | `transactions-toolbar` (con icona), `merchants-page`, `analytics-toolbar` (ricerca merchant), `transactions-toolbar` (dropdown merchant) | 4 varianti minori dello stesso input |

**Problema di fondo**: non è la qualità del codice (che è alta — TypeScript pulito, commenti mirati al "perché", validazione già isolata in funzioni pure, temi già ben centralizzati) ma l'**assenza di un livello di presentazione condiviso**. Ogni pagina reinventa lo stesso vocabolario visivo con nomi di classe diversi, quindi non è nemmeno immediatamente visibile che si tratta delle stesse 10-12 idee ripetute.

**Rischio strutturale**: oggi non esiste alcuna directory `shared/`. Una nuova pagina non ha un posto ovvio da cui partire se non "copia il file più simile che trovi" — esattamente il meccanismo che ha prodotto le duplicazioni sopra.

---

## 3. Principi guida

Adottati per questa proposta (derivati dal brief e confermati dall'analisi):

1. **Riuso reale, non forzato**: promosso a shared solo ciò che è duplicato *oggi*, verificato leggendo il codice — non ciò che "potrebbe servire".
2. **La pagina compone, i shared presentano**: le pagine restano responsabili di caricamento dati, stato locale, orchestrazione; i componenti shared non conoscono API, router o store di feature.
3. **Layout ignorante del dominio**: un componente di layout non sa cos'è un "prestito" o una "transazione", sa solo disporre contenuto.
4. **Theming esistente esteso, non sostituito**: si costruisce sopra le custom property già presenti in `styles.scss`, aggiungendo solo i pochissimi token geometrici realmente duplicati (§8).
5. **API piccole e motivate**: ogni `input()` di un componente shared è giustificato da un uso reale già presente nel codice, non da un'ipotesi.
6. **Comportamento preservato**: la migrazione (§12) non cambia UX, wording, validazioni o chiamate API — solo la loro organizzazione nel codice.
7. **Non tutto ciò che si ripete merita un componente**: dove la ripetizione è puro CSS senza logica (`.sr-only`, `.truncate`, link "esplora →"), la risposta è una **classe di utilità globale**, non un componente Angular — esattamente come il progetto fa già con `.truncate`.

---

## 4. Architettura proposta

```
Page (orchestrazione, stato, chiamate API/store di feature)
 │
 ├── shared/layout   → struttura senza significato di dominio (Panel, griglie)
 │
 ├── shared/ui       → primitive di presentazione con una responsabilità
 │                      chiara (StatCardGrid, Badge, SegmentedControl, ...)
 │                      MAI iniettano servizi di feature
 │
 └── Feature content → composizione di shared + componenti specifici della
                        feature (che restano dove sono: analytics-timeline,
                        transactions-table, column-picker, ecc.)
```

Non introduco un terzo layer "pattern": un pattern ricorrente che vale la pena estrarre diventa un componente `shared/ui` o `shared/layout`; se non vale la pena estrarlo resta un pattern *documentato* (qui, §15) ma non codificato.

`core/` resta esattamente come oggi: contiene logica (funzioni, direttive, uno store), non presentazione. `shared/` è nuovo e contiene solo presentazione (componenti con template).

---

## 5. Struttura directory proposta

```
apps/frontend/src/app/
├── core/                         # invariato
│   ├── amount.ts
│   ├── api.ts
│   ├── format.ts
│   ├── http-error.ts
│   ├── period.ts
│   ├── theme.ts
│   └── truncate.ts
│
├── shared/
│   ├── layout/
│   │   ├── panel/                 # Panel.ts/html/scss (+ .spec.ts) — solo box
│   │   ├── section-header/        # SectionHeader.ts/html/scss — titolo/sottotitolo/azioni
│   │   └── stat-card-grid/        # StatCardGrid.ts/html/scss
│   │
│   ├── ui/
│   │   ├── badge/
│   │   ├── segmented-control/     # selezione singola (radio-like)
│   │   ├── toggle-button-group/   # selezione multipla (checkbox-like)
│   │   ├── search-input/
│   │   ├── filter-chips/
│   │   ├── form-field/
│   │   ├── empty-state/
│   │   └── error-retry/
│   │
│   └── styles/
│       ├── _tokens.scss           # i pochi token geometrici (§8)
│       └── _mixins.scss           # es. pill-button, condiviso da SegmentedControl e ToggleButtonGroup senza farli dipendere l'uno dall'altro
│
└── features/                     # invariato nella forma, migrato nel contenuto
    ├── analytics/
    ├── cash-flow/
    ├── categories/
    ├── dashboard/
    ├── import/
    ├── loans/
    ├── maintenance/
    ├── merchants/
    ├── settings/
    └── transactions/
```

Motivazione della separazione `layout/` vs `ui/`: `Panel`, `SectionHeader` e `StatCardGrid` sono pure strutture di disposizione (un contenitore, una riga di intestazione, una griglia) — non hanno interazione propria. Tutto il resto in `ui/` ha un comportamento (click, stato attivo, digitazione) o una semantica visiva parametrica (tono di un badge). È una distinzione utile a chi cerca un componente, non un dogma: se in futuro il confine risultasse artificioso, si può appiattire in un'unica cartella `shared/components/` senza impatto sulle feature (i percorsi di import cambierebbero solo lì).

Non creo `shared/pipes/`, `shared/directives/`, `shared/services/`: non c'è oggi nessuna evidenza che serva più di quanto `core/` già offre.

### 5.1 Regole di dipendenza tra livelli

Grafo delle dipendenze consentite (una freccia significa "può importare da"):

```
core            →  (solo Angular/RxJS; nessuna dipendenza interna al progetto — già vero oggi)
shared/ui       →  core
shared/layout   →  core
shared/ui       ╳  shared/layout      (nessuna dipendenza in nessuna delle due direzioni: sono pari)
features        →  core, shared/ui, shared/layout, altre features (solo per modelli/tipi o
                    riuso di un intero componente — prassi già esistente oggi, es.
                    `dashboard-page` usava `TransactionsTable` della feature transazioni; oggi
                    entrambe le pagine usano quella di `shared/ui`, v. aggiornamento in §1)
shared/*        ╳  features                (MAI, in nessun caso — regola rigida, vedi sotto)
```

**Regola rigida, senza eccezioni**: nessun file sotto `shared/ui/**` o `shared/layout/**` importa alcunché da `features/**`, né inietta un servizio `*Api`, uno `*Store` (incluso `ThemeStore`), `Router` o `ActivatedRoute`. Un componente shared riceve dati solo via `input()`/content projection ed espone solo `output()` (o, dove strettamente necessario, un membro pubblico leggibile da un riferimento di template — vedi la nota su `FormField` in §16.3). Questo non è diverso da come già si comportano oggi la maggior parte dei componenti di feature (`TransactionsToolbar`, `TransactionsPagination`): la regola lo rende esplicito e vincolante per tutto ciò che entra in `shared/`.

**Perché anche `ThemeStore` è escluso**: benché sia già condiviso e "sicuro" (`providedIn: 'root'`, nessuna chiamata HTTP), un componente shared che lo iniettasse smetterebbe di essere testabile con il solo `TestBed.createComponent()` richiesto in §10. Il tema arriva ai componenti shared solo attraverso le custom property CSS, mai attraverso un servizio — coerente con come `styles.scss` è già strutturato.

**Enforcement**: il progetto non ha oggi ESLint configurato (solo Prettier, TypeScript, Angular CLI/build — verificato in `package.json`). La regola è quindi applicata per convenzione di struttura delle cartelle e in code review, non da un tool automatico: un `import` da `../../features/...` dentro `shared/ui/**` è visivamente anomalo e facile da individuare. Aggiungere un lint di boundary (es. `eslint-plugin-boundaries`) è un miglioramento futuro possibile, non proposto ora, per non introdurre una nuova dipendenza di sviluppo senza necessità immediata (principio 5, §3).

---

## 6. Catalogo dei componenti shared

Legenda riuso: numero di punti che oggi duplicano il pattern (verificato).

| Component | Responsabilità | API principali | Varianti | Riutilizzo | Stato |
|---|---|---|---|---|---|
| **Panel** *(revisionato, §16.1)* | Solo il box visivo: sfondo/bordo/raggio/padding, un'unica area di contenuto proiettato | nessun `input()`; un solo slot di contenuto | nessuna | ~20 usi (compresi i casi senza alcuna intestazione, es. `transactions-page`, `transactions-toolbar`) | **Necessario** |
| **SectionHeader** *(nuovo, separato da Panel, §16.1)* | Riga di intestazione: titolo, sottotitolo opzionale, area azioni/contenuto a destra | `title: string`, `subtitle?: string`; slot proiettato `[panelActions]` | nessuna | 9 usi con contenuto a destra (link, pulsante, badge, KPI); usabile anche per i casi "solo titolo" (§16.1) | **Necessario** |
| **StatCardGrid** | Riga di indicatori KPI (etichetta + valore, tono opzionale) | `items: { label: string; value: string; tone?: 'positive' \| 'negative' \| 'neutral' }[]` | tono per singolo item | 4 usi identici | **Necessario** |
| **SegmentedControl** *(revisionato: solo selezione singola, §16.2)* | Gruppo di pulsanti a scelta singola, sempre un'opzione attiva (radio-like) | `options: { id: T; label: string; badge?: number }[]`, `value: T`; `output valueChange: T` | nessuna | 6 usi (preset periodo, passo del grafico, classificazione ×2, stato prestito, filtro merchant) | **Necessario** |
| **ToggleButtonGroup** *(nuovo, separato da SegmentedControl, §16.2)* | Gruppo di pulsanti a scelta multipla, zero o più opzioni attive (checkbox-like) | `options: { id: T; label: string }[]`, `value: readonly T[]`; `output valueChange: T[]` (il componente calcola internamente l'array aggiornato) | nessuna | 5 usi (tipo movimento ×2, categoria ×2, merchant) | **Necessario** |
| **FormField** *(API accessibilità precisata, §16.3)* | Involucro di un campo: etichetta (associazione implicita via wrapping), proiezione del controllo reale, errore, hint con id stabili per `aria-describedby` | `id: string` (richiesto — stessa stringa già usata in `name`), `label: string`, `error?: string \| null`, `hint?: string \| null`; proietta l'`<input>`/`<select>`; espone gli helper puri `formFieldErrorId`/`formFieldHintId`/`formFieldDescribedBy` per il wiring lato pagina | nessuna | 9 usi | **Necessario** |
| **Badge** | Pillola di stato testuale | `label: string`, `tone: 'positive' \| 'negative' \| 'neutral'` | tono | 2 usi identici + potenziale riuso per i contatori nei filtri (§6, nota) | **Consigliato** |
| **SearchInput** | Campo di ricerca con icona opzionale | `value: string`, `placeholder: string`; `output valueChange` | con/senza icona | 4 usi simili | **Consigliato** |
| **FilterChips** | Riga di filtri attivi rimovibili + pulsante reset | `chips: { key: string; label: string }[]`; `output removed`, `output cleared` | nessuna | 2 usi identici + 1 simile (dashboard) | **Consigliato** |
| **EmptyState** | Messaggio "nessun risultato" con hint e azione opzionale | `message: string`, `hint?: string`, `actionLabel?: string`; `output action` | con/senza azione | 2 usi | **Consigliato** |
| **ErrorRetry** | Messaggio d'errore con pulsante "Riprova" | `message: string`; `output retry` | nessuna | 3 usi | **Consigliato** |
| **StatusMessage** *(utility CSS, non componente)* | Colori/varianti di `.message` | classi `.message`, `.message--error/warning/done/saved/hint/note` in `styles.scss` | — | 15+ usi | **Necessario**, ma come CSS, non come componente Angular (vedi §9) |
| SubmitButton | Pulsante submit con etichetta che cambia in stato di salvataggio | `loading: boolean`, `label`, `loadingLabel` | — | 6 usi simili (`{{ saving() ? 'Salvataggio…' : 'Salva' }}`) | **Opzionale/futuro** — vantaggio marginale rispetto a un semplice `<button [disabled]>` |
| ConfirmInline | "Eliminare? Sì / Annulla" inline | `question`, `confirmLabel`; `output confirmed`, `output cancelled` | — | 2 usi, markup circostante diverso | **Opzionale/futuro** — attendere una terza occorrenza prima di astrarre |
| ProgressBar / Meter | Barra di riempimento percentuale | `value: number`, `max: number` | — | 3 usi concettualmente simili ma visivamente diversi (barra categoria, avanzamento prestito, ripartizione prestito/spesa) | **Opzionale/futuro** |
| SortableColumnHeader | `<th>` con pulsante di ordinamento + freccia + `aria-sort` | `label`, `field`, `active: boolean`, `direction` | — | 3 usi (`transactions-table`, `loans-page`, opzionale `analytics-timeline`) | **Consigliato**, ma solo come micro-componente per il singolo `<th>`, non come tabella generica (vedi §14) |

**Nota su Badge**: le "pillole con contatore" nei pulsanti filtro (`analytics-toolbar` badge attivi, `merchants-page` contatori `.badge`) e i badge di stato prestito condividono lo stesso CSS (`border-radius: 999px`, sfondo accentato). Non li unifico in un solo componente obbligatorio: il badge-contatore vive dentro `SegmentedControl` (proprietà `badge?: number` dell'opzione), il badge di stato è `Badge` standalone. Stessa origine visiva, due usi diversi — evita di forzare un'unica API per due significati.

---

## 7. Catalogo dei layout

### Panel *(revisionato: separato da SectionHeader, motivazione in §16.1)*
- **Responsabilità**: unico contenitore visivo per una sezione di contenuto (bordo, sfondo, padding, spaziatura fra sezioni). Sostituisce `<section class="panel">` scritto a mano. Non sa nulla di titoli, sottotitoli o azioni.
- **Struttura**: host = `<section class="panel">` con un solo `<ng-content>`. Nessuna condizione nel template.
- **Pagine che lo usano**: tutte (ogni `<section class="panel">` esistente diventa `<app-panel>`), inclusi i casi che oggi non hanno alcuna intestazione (`transactions-page`, `transactions-toolbar`), che restano semplicissimi da esprimere.
- **Punti di personalizzazione**: proiezione libera del corpo; una classe host opzionale per le rare eccezioni dimensionali (es. `cash-flow-card`/`settings-page` con `max-width` locale) — override CSS sul selettore host, non una nuova variante del componente.
- **Rapporto con shared/ui**: è il contenitore più esterno; `SectionHeader`, `StatCardGrid`, `SegmentedControl`/`ToggleButtonGroup`, tabelle, form vivono quasi sempre come primo/successivo contenuto proiettato dentro un `Panel`.

### SectionHeader *(nuovo, §16.1)*
- **Responsabilità**: riga di intestazione con titolo, sottotitolo opzionale e area a destra per contenuto variabile (pulsante, link, badge, cifre). Normalizza i quattro nomi di classe oggi usati per lo stesso concetto (`.header`/`.head`/`.toolbar`/`.panel-header`) e, dichiarando il proprio `<h2>` nel proprio template, risolve anche la tipografia del titolo oggi ripetuta quasi identica in ~10 file (es. `h2 { margin: 0 0 1.25rem; font-size: 1.125rem }`).
- **Struttura**: `<div class="section-header"><div><h2>{{ title }}</h2>@if(subtitle){<p class="subtitle">}</div><div class="actions"><ng-content select="[panelActions]" /></div></div>`.
- **Pagine che lo usano**: come primo elemento proiettato dentro `Panel`, nei 9 punti con contenuto a destra (Analytics, Prestiti/dettaglio ×2, Dashboard toolbar e sezione transazioni, Top merchant, Merchant, Andamento nel tempo). Per i pannelli con solo un titolo semplice (Impostazioni, Manutenzione, liste di Analytics, Confronto mensile) resta preferibile un `<h2>` diretto: usare `SectionHeader` anche lì per uniformità tipografica è un'opzione legittima ma non obbligatoria (vedi §16.1 per il criterio di scelta).
- **Punti di personalizzazione**: `subtitle` opzionale; proiezione libera per l'area azioni (copre pulsante, link singolo, badge di stato, blocco di cifre — tutti i casi osservati).
- **Rapporto con shared/ui**: non dipende da `Panel` né viceversa (regola dei pari, §5.1); una pagina li compone insieme perché è così che appaiono oggi, non perché uno "contenga" l'altro nel codice.

### StatCardGrid
- **Responsabilità**: disporre N indicatori in una griglia responsive (`repeat(auto-fit, minmax(...))`, il valore osservato è già identico nei 3 usi).
- **Struttura**: `<div class="cards"><div class="card" *per item>`.
- **Pagine che lo usano**: Analytics (KPI periodo), Dashboard (riepilogo mensile — oggi dentro il toolbar), Prestiti/dettaglio (importo/restituito/residuo), Analytics → sezione prestiti.
- **Punti di personalizzazione**: solo `tone` per singolo valore (già l'unica variazione osservata).
- **Rapporto con shared/ui**: tipicamente proiettato dentro un `Panel` (dopo un eventuale `SectionHeader`).

Non propongo un `AppShell`/`TwoColumnRow`/`Toolbar` generico come layout riutilizzabile: vedi §15 per la motivazione puntuale di ciascuno.

---

## 8. Theming

**Nessun nuovo sistema**: si resta sulle custom property CSS già definite in `styles.scss`. È già la soluzione "centralizzata, semplice, coerente con lo stack, facilmente modificabile" richiesta dal brief — costruirne una seconda sarebbe la ridondanza che si vuole eliminare altrove.

**Estensione minima e motivata**: oggi solo i colori sono tokenizzati; geometria e spaziatura sono valori letterali ripetuti identici ovunque (`border-radius: 8px` in ogni `.panel`, `999px` in ogni pillola/chip/badge, `padding: 1.5rem` in ogni pannello). Propongo di aggiungere **solo i valori che sono già, oggi, copiati identici**, non una scala completa:

```scss
:root {
  --radius-panel: 8px;   /* .panel, oggi ripetuto in ~20 file */
  --radius-pill: 999px;  /* pillole, chip, badge — oggi ripetuto in ~10 file */
  --radius-control: 6px; /* input, select, bottoni secondari */
  --space-panel: 1.5rem; /* padding standard di un pannello */
}
```

Nessuna scala 4/8/12/16/24/32, nessun sistema di elevazione a livelli, nessuna tipografia a step numerati: non c'è evidenza nel codice attuale di più di 2-3 dimensioni di font ricorrenti, e introdurne una tassonomia completa sarebbe complessità non richiesta da nulla di osservato.

**Verifica puntuale dei quattro token (round di revisione, dettaglio in §16.4)**: tutti e quattro restano giustificati da duplicazioni reali, con due eccezioni preesistenti da preservare (non da "correggere" silenziosamente durante la migrazione, per non alterare il comportamento visivo attuale):
- `loans-page.scss` definisce `.panel` **senza** `padding` (unico caso su ~20). `Panel` applicherà `--space-panel` di default: la pagina Prestiti va verificata con attenzione particolare nel PoC/migrazione (rischio di introdurre un padding oggi assente).
- `--radius-control: 6px` copre la maggioranza dei controlli di modulo, ma le celle editabili inline di `merchants-page.scss` (`.name input`, `.category select`) e `transactions-table.scss` (`.category select`, `.type select`) usano **4px**. Non unifico questo valore nel token: resta un letterale locale a quei due file, invariato.
- Non introduco un quinto token per `margin-bottom: 1.5rem` (spaziatura fra pannelli): è lo stesso valore numerico di `--space-panel`, quindi si riusa quella variabile invece di duplicarne il significato.

**Come vengono consumati**: i nuovi componenti `shared/` leggono queste variabili esattamente come oggi leggono `--surface`/`--border`/`--accent`. Le pagine che non sono ancora migrate continuano a funzionare invariate (i valori letterali restano validi finché non vengono sostituiti pagina per pagina).

**Estensione futura** (es. un secondo tema "alto contrasto" o un tema per la stampa): si aggiunge un terzo mixin in `styles.scss`, esattamente come oggi si aggiungerebbe `dark-theme`. Nessun componente shared richiede modifiche, perché nessuno conosce un colore per nome proprio — leggono solo variabili.

---

## 9. Strategia di personalizzazione

- **`input()` mirati**: ogni variante è un signal input con un tipo unione stretto (es. `tone: 'positive' | 'negative' | 'neutral'`), mai una stringa libera o un oggetto di configurazione aperto.
- **Content projection** per ciò che varia in contenuto, non in struttura: il corpo di `Panel`, le azioni di testata di `SectionHeader`, il controllo reale dentro `FormField`.
- **Classe host come valvola di sfogo**: dove una pagina ha bisogno di un aggiustamento puramente dimensionale isolato (il `max-width` di `cash-flow-card` o del pannello impostazioni), resta un override CSS nel foglio di stile della pagina ospitante sul selettore del componente shared, invece di aggiungere un `input()` "larghezza" usato una volta sola.
- **`StatusMessage` non è un componente**: è testo con una classe. Un wrapper Angular per `<p class="message">{{ text }}</p>` aggiungerebbe un livello di indirection (un altro selettore, un altro file, un altro test) per zero logica. Resta una convenzione CSS globale in `styles.scss`, come già lo è `.truncate`.
- **Niente proprietà "per ogni evenienza"**: ogni `input()` proposto in §6 corrisponde a un uso reale già presente nel codice — non ne esiste uno introdotto "perché potrebbe servire".

---

## 10. Considerazioni sulla testabilità

Regola architetturale per tutto `shared/`: **nessun componente shared inietta servizi, store o `Router`**. Riceve dati via `input()`, comunica intenzioni via `output()`. Questo è già lo stile della maggioranza dei componenti di feature (`TransactionsToolbar`, `TransactionsPagination`) — la regola lo rende esplicito e vincolante per `shared/`, e vale anche per `TransactionsTable`, che era l'eccezione feature-specific con le API iniettate e oggi è in `shared/ui` come componente di presentazione (§1).

Conseguenza pratica: ogni componente shared è testabile con `TestBed.createComponent` e nessun `provideHttpClientTesting`/mock di store, in linea con la configurazione Vitest già presente nel progetto.

Esempi (nessun test scritto in questa fase, solo indicazione):
- **Panel**: il contenuto proiettato appare sempre; nessun altro stato da verificare (template non condizionale).
- **SectionHeader**: renderizza `title`/`subtitle` quando presenti, omette il `<p>` del sottotitolo quando assente; il contenuto proiettato in `[panelActions]` appare sempre.
- **SegmentedControl**: dato un `value`, la sola opzione corrispondente ha la classe attiva; un click su un'opzione emette `valueChange` con l'id corretto.
- **ToggleButtonGroup**: dato un `value` (array), le opzioni corrispondenti hanno la classe attiva; un click su un'opzione emette `valueChange` con l'array aggiornato (aggiunto o rimosso l'id), senza mutare l'array ricevuto in input.
- **FormField**: lo `<span class="field-error">` compare (con l'id corretto) solo se `error` è impostato, idem per l'hint; `formFieldDescribedBy` restituisce `null` quando né errore né hint sono presenti; `aria-invalid` sul controllo proiettato resta responsabilità della pagina (il wrapper non lo genera da sé, per non duplicare una decisione che il form già prende).
- **StatCardGrid**: dato un array di 3 item con toni diversi, applica la classe di tono corretta a ciascuno.
- **EmptyState**: il pulsante azione compare solo se `actionLabel` è passato; il click emette `action`.

---

## 11. Mappatura pagina → componenti/layout

| Pagina | Panel/SectionHeader | StatCardGrid | SegmentedControl | ToggleButtonGroup | FormField | SearchInput | FilterChips | EmptyState/ErrorRetry | Resta feature-specific |
|---|---|---|---|---|---|---|---|---|---|
| **Dashboard** (`dashboard-page`) | ✅ (ogni sezione) | ✅ (5 card riepilogo) | — | — | — | — | ✅ (chip filtro dashboard) | — | `CashFlowCard`, `CategoryBreakdownSection`, `TopMerchantsSection`, `MonthComparisonSection` |
| **Analytics** (`analytics-page` + sotto-componenti) | ✅ | ✅ (KPI periodo, KPI prestiti) | ✅ (preset periodo, classificazione) | ✅ (tipo, categoria, merchant) | — | ✅ (ricerca merchant nei filtri) | ✅ | ✅ EmptyState, ✅ ErrorRetry (nel pannello delle transazioni) | `AnalyticsTimeline` (usa shared `<app-line-chart>`, feature mantiene dominio: serie, bucket, significato della selezione, tooltip, legenda, tabella), `AnalyticsCategories` (lista o `<app-doughnut-chart>`, a scelta con toggle), `AnalyticsMerchants` (lista con barra, gerarchia propria), `AnalyticsTransactions` (sempre sotto l’andamento: le transazioni dei soli filtri di `AnalyticsStore`; un click sui grafici — bucket, categoria, merchant — modifica i filtri, non apre una selezione a parte; usa la `TransactionsTable` shared in modalità `readonly`) |
| **Movimenti** (`transactions-page` + toolbar/tabella/paginazione) | ✅ | — | ✅ (dropdown classificazione) | ✅ (dropdown tipo/categoria) | — | ✅ | ✅ | ✅ EmptyState, ✅ ErrorRetry | `TransactionEdits` (salvataggio tipo/categoria per la `TransactionsTable` shared in modalità `edit`), `TransactionLoanCell` (colonna prestiti proiettata), `TransactionsPagination` (logica pagine), selezione multipla + conferma eliminazione |
| **Prestiti — elenco** (`loans-page`) | ✅ | ✅ (KPI) | ✅ (stato) | — | — | ✅ | — | ✅ EmptyState, ✅ ErrorRetry | Tabella prestiti (contenuto colonne specifico), badge stato → `Badge` |
| **Prestiti — dettaglio** (`loan-detail-page`) | ✅ | ✅ (importo/restituito/residuo) | — | — | ✅ (form modifica, form restituzione) | — | — | ✅ ErrorRetry | Breadcrumb (CSS utility, non componente), progress bar, split bar, tabella restituzioni, `Badge` di stato |
| **Prestiti — crea** (`loan-create-page`) | ✅ | — | — | — | ✅ (4 campi) | — | — | — | Breadcrumb (CSS), riepilogo movimento d'origine |
| **Merchant** (`merchants-page`) | ✅ | — | ✅ (filtro classificazione) | — | — | ✅ | — | — | Tabella editabile inline (select categoria, input rinomina) |
| **Import CSV** (`import-page` + `column-picker`) | ✅ | — | — | — | ✅ (mapping colonne, 4+ campi) | — | — | — | Logica di analisi/preview CSV, riepilogo import |
| **Impostazioni** (`settings-page`) | ✅ (×2 pannelli) | — | — | — | ✅ (2 campi) | — | — | — | Scelta tema (radio, già minimale) — `TwoColumnRow` **non** astratto (unico uso, vedi §15) |
| **Manutenzione** (`reset-panel`) | ✅ | — | — | — | ✅ (campo conferma) | — | — | — | Flusso di conferma a due fasi, specifico e pericoloso quanto basta da non generalizzare |

---

## 12. Piano di migrazione incrementale

Ordine pensato per **minimizzare il rischio a parità di valore**: prima le estrazioni puramente strutturali (nessuna logica di interazione), poi quelle con stato interno, infine quelle che toccano i form (dove un errore di trascrizione avrebbe l'impatto peggiore: validazioni e submit).

### Fase 0 — Fondamenta (rischio: nullo)
Creare `shared/layout/`, `shared/ui/`, `shared/styles/_tokens.scss`; aggiungere i token geometrici (§8); spostare `.sr-only`, il pattern "esplora →" e il breadcrumb in `styles.scss` come classi globali (puro spostamento CSS, zero comportamento). Nessuna pagina viene toccata nel markup.

### Fase 0.5 — Proof of Concept mirato (nuova, §16.6) — **da fare prima di qualunque rollout massivo**
Migrare **un solo utilizzo reale** per ciascuno dei componenti architetturalmente più significativi, verificare build e comportamento, e solo dopo procedere alle fasi successive. Poiché §16.1 e §16.2 dividono rispettivamente PanelSection e SegmentedControl in due componenti ciascuno, il PoC copre entrambe le metà di ogni divisione — altrimenti la validazione sarebbe parziale:

| Componente | Utilizzo scelto per il PoC | Perché questo e non un altro | Verifica |
|---|---|---|---|
| `Panel` + `SectionHeader` | `top-merchants.html` (sezione Dashboard) | Componente foglia, isolato, usato in un solo punto: perimetro di rischio minimo; esercita comunque titolo + link in testata, cioè il caso più ricco di `SectionHeader` | `ng build`; nessuno spec dedicato esiste oggi (verificato: non c'è `top-merchants.spec.ts`) → verifica manuale nel dev server (confronto visivo prima/dopo) |
| `SegmentedControl` | Passo dell'andamento in `analytics-timeline` (day/week/month) | Selezione singola più semplice possibile (3 opzioni fisse, nessun badge), non tocca stato URL/query | `ng build` + `ng test` (esiste già `analytics-timeline.spec.ts`) + verifica manuale |
| `ToggleButtonGroup` | "Tipo di movimento" in `analytics-toolbar` | Selezione multipla più semplice fra quelle osservate, non tocca `TransactionQueryState`/URL (passa da `AnalyticsFilterStore`, più isolato di `transactions-toolbar`) | `ng build` + verifica manuale (nessuno spec di rendering esiste oggi per `analytics-toolbar`) |
| `FormField` | Form di `settings-page` (2 campi) | Il form più semplice esistente, non su un percorso critico come la creazione di un prestito | `ng build`; nessuno spec di rendering esiste oggi per `settings-page` (solo `settings-form.spec.ts`, che copre la sola validazione) → verifica manuale con tastiera/screen reader del collegamento label/errore/hint |

**Condizione di uscita dal PoC**: tutti e quattro i punti sopra costruiscono senza errori, non introducono differenze visive non motivate (fatta salva l'eccezione nota di `loans-page` per il padding, che qui non è coinvolta) e il comportamento (click, tab, focus, submit dove applicabile) resta identico. Solo a questo punto si procede con le fasi seguenti, che propagano il pattern già validato al resto dell'applicazione.

### Fase 1 — Panel e SectionHeader (rischio: basso, superficie ampia)
Dopo il PoC, sostituire `<section class="panel">` con `<app-panel>` (+ `<app-section-header>` dove serve una testata) pagina per pagina. Meccanico ma tocca ~20 file: farlo per feature (una PR/commit per feature), verificando visivamente ogni pagina dopo la sostituzione. Attenzione particolare a `loans-page` (unico `.panel` oggi senza `padding`, §16.4) e alla scelta, pannello per pannello, fra `SectionHeader` e un `<h2>` diretto per i casi senza contenuto a destra (§16.1).
- **Rischio**: minimo — nessuna interazione coinvolta, a parte la verifica del caso `loans-page`.
- **Difficoltà**: bassa ma ripetitiva.

### Fase 2 — StatCardGrid e Badge (rischio: basso)
4 punti per StatCardGrid, 2 per Badge. Isolati, senza dipendenze da altre estrazioni.
- **Rischio**: basso.
- **Difficoltà**: bassa.

### Fase 3 — SegmentedControl e ToggleButtonGroup (rischio: medio)
I pattern col maggior numero di usi complessivi (6 selezione singola + 5 selezione multipla) e gli unici con logica di stato-attivo da preservare esattamente. Dopo il PoC (Fase 0.5) già avvenuto su un caso di ciascuno, migrare gli usi restanti uno alla volta, dal più semplice al più complesso (`merchants-page`/`loans-page` prima, filtri multipli di `analytics-toolbar`/`transactions-toolbar` per ultimi). Per `ToggleButtonGroup`, verificare in particolare che accentrare il calcolo dell'array aggiornato nel componente (invece che nel metodo `toggleX` di ogni toolbar, oggi duplicato) non cambi l'ordine o il contenuto dei filtri emessi.
- **Rischio**: medio — un errore nella logica multi-select altererebbe i filtri applicati.
- **Difficoltà**: media.

### Fase 4 — FormField (rischio: medio-alto)
Il punto più delicato: 9 campi in form che hanno anche validazione, `aria-invalid`, `ngModel`. Migrare un form alla volta (`settings-page` prima, essendo il più semplice con 2 campi; `loan-create-page`/`loan-detail-page` dopo, essendo i più numerosi). Verificare dopo ogni form che submit, errori e hint restino identici.
- **Rischio**: medio-alto — coinvolge input utente e validazione.
- **Difficoltà**: medio-alta.

### Fase 5 — SearchInput, FilterChips, EmptyState, ErrorRetry (rischio: basso)
Estrazioni indipendenti fra loro, da fare in qualsiasi ordine dopo la Fase 3 (FilterChips condivide idealmente lo stile con SegmentedControl ma non ne dipende funzionalmente).

### Fase 6 — Opzionali (solo se emerge una terza occorrenza reale)
`ConfirmInline`, `ProgressBar`, `SubmitButton`: non pianificati ora. Si valutano quando (e se) un nuovo caso d'uso li renderà una duplicazione a 3 occorrenze anziché 2.

**Vincolo trasversale a ogni fase**: l'applicazione resta funzionante e distribuibile al termine di ogni singolo commit — coerente con "Incremental Evolution", principio già scritto in [`docs/architecture/project-context.md`](project-context.md) per il progetto nel suo complesso.

---

## 13. Decisioni architetturali

- **`shared/layout` vs `shared/ui` come due cartelle, non una**: separare "dispone" da "si comporta" aiuta a capire dove cercare un componente. Se in futuro il confine si rivelasse artificioso, l'appiattimento è un cambio di percorso di import, non una riscrittura.
- **`shared/` non inietta mai servizi/store/router** (§10): è la regola che rende i componenti shared testabili senza infrastruttura e riutilizzabili in qualunque pagina futura senza sapere nulla del dominio. `TransactionsTable`, che ne era l'eccezione storica, oggi la rispetta (§1).
- **`StatusMessage` come CSS, non come componente** (§9): zero logica → zero beneficio da un wrapper Angular, un costo (un file, un selettore, un test) in più. Coerente con come il progetto già tratta `.truncate`.
- **Nessuna libreria UI esterna** (Material/PrimeNG/Spectrum): il progetto ha già un intero linguaggio visivo custom, coerente e funzionante (temi, tipografia, colori verificati per accessibilità). Introdurre una libreria significherebbe o riscrivere quel linguaggio o conviverci accanto in conflitto — sproporzionato per ~10 pagine.
- **Nessun `<app-data-table>` generico** (§14): il costo di un'API a celle configurabili (content projection per colonna, o `TemplateRef` per cella) supera il beneficio, perché le 5 tabelle esistenti differiscono nel contenuto delle celle (select inline, link a prestiti, input di rinomina) più che nel loro involucro.
- **Token geometrici minimi, non una scala completa** (§8): si tokenizza solo ciò che è *già* duplicato identico nel codice, non una previsione di necessità future.
- **Migrazione per fasi ordinate per rischio, non per pagina** (§12): permette di validare il componente più rischioso (`FormField`) per ultimo nel rollout di massa, quando il pattern di migrazione è già rodato sui casi più semplici — con un PoC anticipato (Fase 0.5) su tutti i componenti architetturalmente significativi prima di qualunque rollout.
- **`Panel` e `SectionHeader` separati, non un `PanelSection` unico** (§16.1): il "box senza testata" è un caso reale e non marginale (2 pagine), non un caso limite del "box con testata"; separare mantiene entrambi i template non condizionali e testabili con un solo scenario ciascuno.
- **`SegmentedControl` e `ToggleButtonGroup` separati, non un componente unico con flag `multi`** (§16.2): il contratto input/output cambia forma (valore singolo vs. array) in un modo che un flag booleano non rende sicuro a livello di tipi; la distribuzione degli usi (6 vs 5) non giustifica trattare l'uno come variante marginale dell'altro.

---

## 14. Alternative considerate e motivazione della scelta

| Alternativa | Perché scartata |
|---|---|
| Libreria UI esterna (Angular Material, PrimeNG, Spectrum, Tailwind) | Il progetto ha già un design system implicito coerente e funzionante (colori verificati per accessibilità, temi chiaro/scuro). Adottare una libreria richiederebbe restyling massiccio di ogni pagina per un beneficio che il codice attuale già ottiene con CSS semplice. |
| `<app-data-table>` generico configurabile via colonne/celle | Le 5 tabelle esistenti hanno contenuti di cella troppo eterogenei (select inline con `ngModel`, link a prestiti con più righe, input di rinomina, barra di progresso). Un'API abbastanza flessibile da coprirli tutti diventerebbe il `GenericComponent` sconsigliato dal brief. Si estrae invece solo l'involucro comune (§8 token, `.scroller`, eventualmente `SortableColumnHeader`) e si lascia il resto specifico. |
| Sistema di design token completo (scala spaziatura 4/8/12/16/24/32, tipografia a livelli, elevazioni multiple) | Nessuna evidenza nel codice attuale di più di 2-3 dimensioni di font ricorrenti o più di 2 livelli d'ombra (`--shadow-tooltip`, `--shadow-dropdown`, già esistenti). Costruire una scala completa sarebbe complessità non richiesta da nulla di osservato. |
| `AppShell` generico riusabile (header/sidebar/footer parametrici) | Esiste un solo shell (`App`), un solo uso. Non c'è un secondo caso d'uso oggi da cui astrarre un'API sensata; generalizzare ora significherebbe indovinare requisiti futuri (principio 1, §3). |
| `Toolbar` generico che racchiude ricerca+filtri+chip | Il contenuto di ogni toolbar (Dashboard, Movimenti, Analytics, Merchant, Prestiti) è per lo più criteri di filtro specifici della feature, non solo chrome visivo. Estrarre l'involucro obbligherebbe a un'API con troppi slot opzionali. Si estraggono invece i pezzi realmente comuni (`SearchInput`, `SegmentedControl`, `FilterChips`) e ogni toolbar li compone a modo suo — mantenendo la pagina responsabile della composizione (principio 2, §3). |
| `ConfirmInline` come componente già ora | Solo 2 occorrenze, con markup circostante diverso (una dentro un pulsante singolo, una dentro una barra di selezione multipla). Astrarre da 2 casi rischia di produrre un'API sbagliata alla prima terza occorrenza reale. Si rimanda (§6, riga "Opzionale/futuro"). |
| `PanelSection` unico (box + testata in un solo componente, round 1) | Il "box senza alcuna testata" è un caso reale (`transactions-page`, `transactions-toolbar`), non un'eccezione. Un componente unico avrebbe dovuto gestire titolo/sottotitolo/azioni come input opzionali interagenti, con più rami nel template di quanti ne servano ai due terzi degli usi. Scartata in revisione (§16.1) a favore di `Panel` + `SectionHeader` separati e composti per proiezione. |
| `SegmentedControl` con `value: T \| T[]` e flag `multi?: boolean` (round 1) | Il tipo unione del `value` non è verificabile dal compilatore in base al flag sorella; i due casi (6 usi singola scelta, 5 usi scelta multipla) sono ugualmente frequenti, non l'uno una variante minore dell'altro. Scartata in revisione (§16.2) a favore di `SegmentedControl` (singola) e `ToggleButtonGroup` (multipla) separati, con lo stile visivo condiviso via mixin. |

---

## 15. Elementi volutamente NON astratti

Applicando la domanda del brief ("sposto codice o rappresento un concetto riutilizzabile?") a ogni candidato scartato:

- **`App` (shell applicativa)**: un solo utilizzo esistente. Non c'è nulla da cui generalizzare un'API — sarebbe un'astrazione a priori.
- **Toolbar per intero (Dashboard/Movimenti/Analytics/Merchant/Prestiti)**: il contenuto varia più di quanto vari il contenitore. Astrarre l'intera toolbar sposterebbe complessità di feature dentro `shared/`, violando il principio 2 (§3).
- **`<app-data-table>` generico**: vedi §14 — il contenuto delle celle è la parte che varia, non l'involucro.
- **`TwoColumnRow` di `settings-page`**: un solo utilizzo oggi (i due pannelli affiancati di Impostazioni). Resta una griglia CSS locale alla pagina; se un secondo layout a due colonne comparirà altrove, sarà il momento di estrarla.
- **`ConfirmInline`**: 2 occorrenze con forma circostante diversa — si attende una terza prima di fissare un'API (§6, §14).
- **Barra di riempimento (`ProgressBar`/"bar" di categoria/split prestito)**: 3 usi concettualmente imparentati ma visivamente e semanticamente distinti (percentuale di spesa per categoria, avanzamento restituzione prestito, ripartizione prestito/spesa propria). Nessuna vera duplicazione di codice oggi, solo somiglianza d'idea — non abbastanza per un componente.
- **`SubmitButton`**: il guadagno (evitare `{{ saving() ? '…' : '…' }}` ripetuto 6 volte) è reale ma piccolo, e un `<button [disabled]>` nativo è già leggibile e testabile com'è. Rimandato a quando (se) emergerà altra logica condivisa sul pulsante di submit (es. spinner).
- **`.sr-only`, `.truncate` (già esistente), link "esplora →", breadcrumb**: zero logica, quindi zero motivo per un componente Angular — restano classi CSS globali in `styles.scss`, coerenti con come `.truncate` è già trattata oggi.
- **`StatusMessage`**: stessa ragione — vedi §9 e §13.
- **Pattern di stato via URL (`transaction-query.ts`/`loan-query.ts`)**: sono funzioni quasi gemelle (`parse*Query`/`to*QueryParams`/`hasFilters`) ma non sono componenti UI — sono logica di stato di feature. Non rientrano nel perimetro "shared UI/layout/theming" di questa proposta; se in futuro si volesse fattorizzarle, l'estrazione (es. `core/query-params.ts` con gli helper `text()`/`list()`/`param()` oggi duplicati) sarebbe una decisione separata, di logica applicativa non di presentazione, e va valutata a parte.

---

## 16. Revisione critica (round 2)

Round di revisione richiesto dopo l'approvazione della direzione architetturale generale. Non ripete l'analisi: verifica criticamente 5 decisioni puntuali e aggiunge un PoC al piano di migrazione. Le conclusioni sono già riportate nei paragrafi corrispondenti sopra (§5.1, §6, §7, §8, §12); qui sta il ragionamento completo.

### 16.1 — Panel e SectionHeader: uno o due componenti?

**Verifica sugli utilizzi reali.** Ho riclassificato tutti i pannelli osservati in FASE 1 per forma della testata:
- **Nessuna testata**, contenuto diretto: `transactions-page` (pannello risultati), `transactions-toolbar` (il pannello inizia con la ricerca) — il box è usato *senza* alcun concetto di titolo.
- **Solo `<h2>`**, nessun sottotitolo, nessun contenuto a destra: `analytics-categories`, `analytics-merchants`, `month-comparison`, `settings-page` (×2), `reset-panel`, `import-page`, pannello KPI di `loans-page` — 8 casi.
- **Titolo + sottotitolo impilati**, nessun contenuto a destra: `cash-flow-card` — 1 caso.
- **Titolo + contenuto a destra** (riga con `justify-content: space-between`): `analytics-page`, `analytics-loans`, `analytics-timeline`, `dashboard-page` (toolbar e sezione transazioni), `top-merchants`, `merchants-page`, `loan-detail-page` (×2) — 9 casi, sotto **quattro nomi di classe diversi** (`.header`, `.head`, `.toolbar`, `.panel-header`) ma con CSS flex/gap identico.

**Decisione: separare `Panel` da `SectionHeader`.** Motivazione, in ordine di peso:
1. **Panel-senza-testata è un caso reale e non marginale** (2 pagine, incluso il pannello dei risultati di Movimenti — non un dettaglio periferico). Questo dimostra che il "box" è un concetto indipendente dal "titolo", non un caso limite dell'altro. Se fosse il contrario — testata sempre presente, box mai usato da solo — combinare sarebbe stato difendibile.
2. **Contratti a bassa interferenza reciproca.** `Panel` non deve mai decidere se renderizzare una riga flessibile con titolo/sottotitolo/slot; il suo template resta un'unica riga (`<section class="panel"><ng-content /></section>`), zero rami condizionali, zero stati combinatori da testare. `SectionHeader` non deve mai sapere di bordi o sfondo. Ognuno dei due si testa con un solo scenario di rendering, non con la matrice di combinazioni "titolo presente/assente × sottotitolo presente/assente × azioni presenti/assenti" che un componente unico dovrebbe gestire.
3. **La tipografia del titolo era comunque duplicata anche nei casi "solo `<h2>`.** Circa 10 file ripetono `h2 { margin: 0 0 1.25rem; font-size: 1.125rem }` (con lievi varianti in `reset-panel`/`import-page`) dentro il proprio `.panel`. Questo NON è un argomento a favore della fusione: sia un `Panel` con `title` opzionale sia un `SectionHeader` separato risolvono ugualmente questa duplicazione, perché in entrambi i casi l'`<h2>` finirebbe comunque dichiarato nel template del componente condiviso (mai in quello della pagina). È quindi un argomento neutro fra le due opzioni, non decisivo.
4. **Nessuna astrazione speculativa**: `SectionHeader` non è mai usato oggi fuori da un `Panel`, ma non ha bisogno di esserlo per essere un concetto legittimo — la domanda del brief ("rappresenta un concetto riutilizzabile o sto solo spostando codice?") riguarda la *ripetizione del concetto* (9 occorrenze verificate, identiche nella struttura, diverse solo nel nome della classe), non la sua indipendenza da altri componenti.

**Conseguenza pratica**: per i pannelli con "solo `<h2>`" (8 casi), resta legittimo scrivere `<h2>` direttamente dentro `<app-panel>` senza usare `SectionHeader` — non c'è alcuna riga da normalizzare. Usare comunque `SectionHeader` anche lì è un'opzione (uniforma la tipografia del titolo), non un obbligo: lo si valuta pannello per pannello durante la Fase 1 (§12), non a tavolino ora.

### 16.2 — SegmentedControl: selezione singola e multipla sono lo stesso componente?

**Verifica sugli utilizzi reali.** Ho riclassificato i 6+5 casi:

*Selezione singola (radio-like — sempre esattamente un'opzione attiva, click sostituisce il valore, mai deselezionabile):* preset di periodo (`analytics-toolbar`), passo dell'andamento (`analytics-timeline`), classificazione (`analytics-toolbar` **e** dropdown di `transactions-toolbar`), stato del prestito (`loans-page`), filtro classificazione merchant (`merchants-page`).

*Selezione multipla (checkbox-like — zero o più opzioni attive, click alterna l'appartenenza a un array):* tipo di movimento (`analytics-toolbar` **e** dropdown di `transactions-toolbar`), categoria (idem ×2), merchant (`analytics-toolbar`).

**Decisione: due componenti, non uno con flag `multi`.** Motivazione:
1. **Il contratto input/output cambia forma, non solo comportamento.** Singola: `value: T`, l'evento emette il nuovo valore sostitutivo. Multipla: `value: T[]`, l'evento emette (o richiede di calcolare) un array. Un `input()` tipizzato `T | T[]` scelto in base a un `input()` sorella booleana (`multi`) non è verificabile dal compilatore: nulla impedisce a un consumatore di passare `value: T[]` dimenticando `multi=true`, con esito visibile solo a runtime. È esattamente l'ambiguità che l'API a "decine di proprietà" del brief mette in guardia, qui in miniatura ma reale.
2. **Non è un caso 6 contro 1**: la distribuzione è 6 singole / 5 multiple, entrambe frequenti quanto l'altra — non c'è un caso "principale" di cui l'altro sia una variante minore.
3. **La semantica di interazione differisce**, non solo la cardinalità: nella selezione singola non esiste "clic sull'opzione attiva per deselezionarla" in nessun punto del codice osservato (è sempre un vero gruppo radio); nella multipla lo zero-stato è normale (nessun filtro attivo = nessun filtro). Un componente unico dovrebbe comunque biforcare questa logica internamente, quindi la fusione non elimina la biforcazione: la sposta dentro il componente invece di renderla esplicita a livello di scelta del componente.
4. **Lo stile visivo resta condiviso** (pillola, stato attivo/hover identici in entrambi i casi): per questo non duplico il CSS, ma lo metto in un mixin comune (`shared/styles/_mixins.scss`, `@include pill-button-group`) incluso da entrambi i componenti — la duplicazione visiva ha una risposta (mixin condiviso), quella comportamentale ne ha un'altra (due componenti). Non sono la stessa domanda.

**Bonus emerso dall'analisi, non richiesto ma degno di nota**: oggi ogni toolbar con filtri multipli (`analytics-toolbar`, `transactions-toolbar`) ha un proprio metodo `toggleType`/`toggleCategory`/`toggleMerchant` che calcola l'array aggiornato — logica quasi identica ripetuta ~6 volte nei file `.ts`. Facendo emettere a `ToggleButtonGroup` l'array già aggiornato (invece del solo id cliccato), questa logica si accentra nel componente e quei metodi nelle toolbar diventano superflui. È un beneficio reale ma va verificato con attenzione durante la Fase 3 (§12): non è un puro spostamento di markup, è un piccolo refactor di comportamento, quindi richiede un confronto esplicito "filtri prima/dopo" pagina per pagina.

### 16.3 — FormField: accessibilità

Verificato **il codice attuale, non solo l'API proposta**: in nessuno dei form letti (`loan-create-page`, `loan-detail-page` ×2, `settings-page`, `column-picker`, `reset-panel`) esiste oggi un `aria-describedby`. L'associazione fra etichetta e controllo è invece già corretta: avviene per **wrapping implicito** (`<label><span>Testo</span><input></label>`), valido in HTML/ARIA senza bisogno di una coppia esplicita `for`/`id`.

**Il vincolo tecnico da rispettare**: `FormField` riceve il controllo reale (`<input>`/`<select>`) via content projection, cioè quell'elemento è dichiarato nel template della *pagina*, non del componente. Angular non offre un modo pulito per un componente di leggere o scrivere attributi su contenuto proiettato senza `@ContentChild` — e usarlo qui significherebbe introdurre riflessione implicita dentro il template proprio dove il documento originale (§10) chiede "poca logica implicita nel template" e "dipendenze esplicite". Va quindi escluso.

**Soluzione minima corretta, in tre parti:**
1. **Label**: `FormField` continua a usare il wrapping implicito (`<label><span class="field-label">{{ label() }}</span><ng-content /></label>`) — nessun `for`/`id` necessario per l'associazione, comportamento già corretto oggi e preservato.
2. **Id stabili per errore/hint**: `FormField` richiede un `input id: string` (la stessa stringa già presente come `name` sul controllo in quasi tutti i form odierni — nessun nuovo identificativo da inventare) e lo usa per assegnare `id="${id}-error"`/`id="${id}-hint"` agli span di errore/hint che *lui stesso* renderizza. Genera questi suffissi tramite due funzioni pure ed esportate (`formFieldErrorId(id)`, `formFieldHintId(id)`), non tramite logica privata duplicabile altrove.
3. **`aria-invalid` e `aria-describedby` restano scritti dalla pagina** sul proprio `<input>`/`<select>` — è l'unico posto che conosce davvero quale elemento nativo sta descrivendo. Per evitare che la pagina reinventi la convenzione dei suffissi, importa la terza funzione pura `formFieldDescribedBy(id, { error, hint })`, che restituisce la stringa già pronta (o `null` se non c'è né errore né hint, cosa che rimuove correttamente l'attributo).

   ```html
   <app-form-field id="borrowerName" label="Persona" [error]="errors().borrowerName">
     <input
       id="borrowerName"
       [ngModel]="form().borrowerName"
       (ngModelChange)="update('borrowerName', $event)"
       [attr.aria-invalid]="errors().borrowerName ? 'true' : null"
       [attr.aria-describedby]="describedBy()"
     />
   </app-form-field>
   ```

**Perché non `exportAs` + variabile di riferimento nel template** (alternativa considerata): avrebbe evitato l'`input id`, generando un identificatore interno automaticamente. Scartata perché (a) introduce un pattern — riferimento di template + membro pubblico letto dalla pagina — assente altrove nel codice attuale, che oggi comunica sempre solo per `input()`/`output()`; (b) le tre funzioni pure sono singolarmente testabili senza `TestBed`, mentre un getter esposto via `exportAs` richiederebbe comunque render del componente per essere verificato. La responsabilità non risulta né persa né duplicata: la convenzione del suffisso vive in un solo file (`form-field.ids.ts`), importata da entrambe le parti; `FormField` decide *quali* id esistono (in base a `error`/`hint`), la pagina decide *dove* applicarli (sul proprio controllo nativo, che solo lei conosce).

### 16.4 — Verifica dei quattro token geometrici

Confermati tutti e quattro come giustificati da duplicazione reale (non introdotti preventivamente); dettaglio e le due eccezioni preesistenti trovate (`loans-page.scss` senza `padding`; raggio `4px` nelle celle editabili di `merchants-page`/`transactions-table` invece di `6px`) sono riportati in §8. Nessun quinto token aggiunto: la spaziatura fra pannelli riusa `--space-panel`, già uguale in valore al padding.

### 16.5 — Regole di dipendenza

Formalizzate in §5.1: `shared/ui` e `shared/layout` dipendono solo da `core`, sono pari fra loro (nessuna dipendenza incrociata), e **mai** da `features/**` — né tramite `import`, né tramite injection di `*Api`/`*Store`/`Router`/`ActivatedRoute` (incluso `ThemeStore`, escluso esplicitamente per non compromettere la testabilità con solo `TestBed.createComponent()`). Enforcement oggi per convenzione/code review, non tramite tool automatico (il progetto non ha ESLint configurato).

### 16.6 — PoC nel piano di migrazione

Aggiunta la **Fase 0.5** (§12): un solo utilizzo migrato per `Panel`+`SectionHeader`, `SegmentedControl`, `ToggleButtonGroup` e `FormField`, scelto ogni volta fra il caso più semplice e isolato disponibile, con verifica di build (`ng build`) ed eventuali test esistenti (presenti solo per `analytics-timeline`; per gli altri tre la verifica in questa fase resta manuale, essendo l'unica disponibile oggi). Nessuna fase successiva del piano parte prima che la Fase 0.5 sia conclusa senza scostamenti non motivati.

### 16.7 - Regole extra 
Un componente viene promosso a shared/ solo se, al momento dell'estrazione, esistono almeno due utilizzi concreti oppure un utilizzo concreto accompagnato da una responsabilità chiaramente trasversale già stabilita. Non si creano componenti shared per anticipare possibili esigenze future.

---

## Riepilogo per l'approvazione

- **Necessari**: `Panel`, `SectionHeader`, `StatCardGrid`, `SegmentedControl`, `ToggleButtonGroup`, `FormField` (con gli helper puri `formFieldErrorId`/`formFieldHintId`/`formFieldDescribedBy`), più le classi CSS globali (`StatusMessage`, `.sr-only`, breadcrumb, esplora-link, token geometrici) e il mixin condiviso `pill-button-group`.
- **Consigliati**: `Badge`, `SearchInput`, `FilterChips`, `EmptyState`, `ErrorRetry`, `SortableColumnHeader`.
- **Opzionali/futuri**: `ConfirmInline`, `ProgressBar`, `SubmitButton` — non implementati finché non emerge una terza occorrenza.
- **Nessuna libreria esterna**, nessun `DataTable` generico, nessun `AppShell` generalizzato, nessuna scala di token completa.
- **Regola di dipendenza rigida** (§5.1): `shared/*` non importa mai da `features/**` e non inietta mai servizi/store/router.
- **Migrazione in 7 fasi** (§12: Fondamenta → **PoC mirato (nuova)** → Panel/SectionHeader → StatCardGrid/Badge → SegmentedControl/ToggleButtonGroup → FormField → resto), a rischio crescente, ognuna behavior-preserving e con l'app funzionante al termine di ogni commit. Nessuna fase di rollout di massa parte prima che il PoC (Fase 0.5) abbia validato build e comportamento su un caso reale per ciascun componente architetturalmente significativo.

Revisione critica di round 2 completata (§16): decisioni confermate o corrette dove l'evidenza nel codice lo richiedeva (Panel/SectionHeader separati, SegmentedControl/ToggleButtonGroup separati, accessibilità di FormField precisata, token confermati con due eccezioni preesistenti da preservare, dipendenze formalizzate, PoC aggiunto al piano). Nessun codice è stato modificato in questa fase. In attesa di una nuova approvazione prima di procedere all'implementazione.

---

## 17. Grafici a linee condivisi

Il grafico dell'andamento nel tempo non è più un SVG della feature: vive in `src/app/shared/ui/chart/`, a strati, e Chart.js non ne esce.

```text
Feature (AnalyticsTimeline)      dominio: serie, bucket, significato della selezione, tooltip, legenda, tabella
  └─ <app-line-chart>            line-chart.ts: tema reattivo, guide, hover/click/tastiera/focus come un solo indice
       ├─ builder puri           line-chart-config.ts (dati e opzioni), line-guides-plugin.ts, value-scale.ts
       ├─ tema                   line-chart-theme.ts (nomi dei token, geometria, risoluzione)
       └─ <app-chart>            chart.ts: ciclo di vita dell'istanza Chart.js
```

**API pubblica** (le feature importano solo `line-chart` e `line-chart.model`): `LineChart<T>` riceve le righe di dominio `points: T[]`, le serie da disegnare `LineSeries<T>[]` (`key`, `label`, `color: ChartSeriesColor`, `value(point)`), `xLabel(point)`, `marker(point)` (`'auto' | 'hollow'`), `valueAxis` (`'amount'`) e `ariaLabel`; la selezione è un `model` `selectedIndex`, e il tooltip della feature si proietta dentro l'host. Le serie sono funzioni sulle stesse righe delle etichette: lunghezze incoerenti non sono rappresentabili, e le feature non vedono mai tipi Chart.js né indici di dataset. `chartColorVar(color)` dà lo stesso colore alle legende HTML.

**Tema**: il canvas non legge `var()`. In TS stanno solo i *nomi* dei token (`--color-text-muted`, `--color-border`, `--color-surface`, `--color-primary`, `--color-chart-*`); i valori si leggono con `getComputedStyle` sull'host in un `afterRenderEffect` che dipende da `ThemeStore.theme()`, quindi si risolvono di nuovo a ogni cambio di tema. La tipografia passa dal mixin `role-properties` di `_typography.scss`: `caption` per le etichette dell'asse X, `financial-row` per i valori dell'asse Y (§4). La geometria (tratti, raggi dei punti, tratteggi, soglia di densità dei marcatori) non cambia col tema e sta in `LINE_CHART_GEOMETRY`. Nessun esadecimale di ripiego.

**Dove si estende**: un asse percentuale è un letterale in `LineChartValueAxis` più una voce in `VALUE_AXES`; un marcatore nascosto è `'hidden'` in `LinePointMarker`; un asse temporale vero è un nuovo input `xAxis` più la registrazione dell'adapter in `chart.ts`; una legenda condivisa diventa un componente a sé quando esiste un secondo consumer. Non si espone `ChartOptions`: ogni capacità nuova entra con un nome.

**Gate**: il controllo «Chart.js resta dentro shared/ui/chart» fallisce se un `.ts` fuori da quella cartella (spec escluse) importa `chart.js`, o se una feature importa i moduli interni (`chart`, `chart-theme`, `line-chart-config`, `line-chart-theme`, `line-guides-plugin`, `doughnut-chart-config`, `doughnut-chart-theme`, `doughnut-grouping`). I moduli pubblici sono `line-chart`, `line-chart.model`, `doughnut-chart`, `doughnut-chart.model` e `chart.model`. Il controllo «dominio intatto» ignora i soli `*.model.ts` sotto `shared/ui/`: sono modelli di presentazione, non di dominio; un `*.api`, `*.store` o `*.query.ts` lì resta segnalato.

### Grafico a ciambella

Lo stesso strato ospita `<app-doughnut-chart>`; `AppChart` è generico sul tipo (`'line' | 'doughnut'`) e ha un solo ciclo di vita per entrambi.

```text
Feature (AnalyticsCategories)     dominio: toggle, significato dell'attivazione, contenuto del centro, Lista
  └─ <app-doughnut-chart>         doughnut-chart.ts: tema reattivo, fetta attiva, hover/click/tastiera/focus
       ├─ builder puri            doughnut-grouping.ts (top N + Altri), doughnut-chart-config.ts (dati e opzioni)
       ├─ tema                    doughnut-chart-theme.ts (token, geometria) + chart-theme.ts (colori-serie condivisi)
       └─ <app-chart>             chart.ts: ciclo di vita dell'istanza Chart.js
```

**API pubblica** (le feature importano solo `doughnut-chart` e `doughnut-chart.model`): `DoughnutChart<T>` riceve `items: readonly T[]`, `value(item)`, `label(item)`, `color(item): SliceColor`, `topN` (default 5), `othersLabel` (default `'Altri'`) e `ariaLabel`. Le voci oltre le prime `topN` confluiscono in una sola fetta «Altri» (`DoughnutSlice` di tipo `others`, con le voci raggruppate); valori ≤ 0 sono scartati. L'output `sliceActivated: DoughnutSlice<T>` parte al click su una fetta e con Invio/Spazio sulla fetta attiva; il significato lo decide la feature. Il centro è un `<ng-template appDoughnutCenter let-slice>` con contesto `{ $implicit: DoughnutSlice<T> | null }` (`null` = nessuna fetta attiva), reso in HTML sovrapposto al foro con `aria-live="polite"`.

**Colori**: `SliceColor` è un token del design system (`ChartSeriesColor`) oppure `{ custom: string }`. Il `custom` (es. il colore scelto per la categoria) passa al canvas così com'è; un token si risolve dal tema; «Altri» usa sempre `chart-neutral`. Nessun esadecimale di ripiego.

**Limite noto**: Angular non può dedurre `T` per `DoughnutCenter` (la direttiva non ha input), quindi la fetta nel template del centro è tipata in modo lasco. Le feature calcolano il contenuto del centro in un metodo tipato del componente, come fa `AnalyticsCategories`.
