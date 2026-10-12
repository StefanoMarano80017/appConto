# Select custom (`app-select`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introdurre un dropdown custom `app-select` (scelta singola, ricerca, token del design system) e sostituire tutti i `<select>` nativi e `app-visual-select`.

**Architecture:**
- Il componente standalone `app-select` vive in `src/app/shared/ui/`.
- Il trigger è un `<button role="combobox">`. Il pannello è `position: fixed` e viene renderizzato **dentro l'host** del componente, non portato nel `body`: così i test lo trovano con `host().querySelector` e sfugge comunque agli `overflow` dei contenitori.
- Il filtro di ricerca è una funzione pura separata.
- Lo stile "campo" si estrae in un mixin condiviso con la regola globale degli input.
- La migrazione dei consumatori avviene in tre blocchi, poi si rimuove `visual-select`.

**Tech Stack:** Angular 21 (zoneless, standalone, signals, `model()`), `@angular/forms` (CVA), `@lucide/angular`, SCSS con token, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-12-select-custom-design.md`

Comandi, da `apps/frontend/`:
- `npx ng test --watch=false` (singolo file: `npx ng test --watch=false --include=src/app/shared/ui/select.spec.ts`)
- `npm run gate`
- `npx ng build`

## Global Constraints

- Nessuna nuova dipendenza: niente `@angular/cdk` né librerie UI.
- Solo token del design system per colori, ombre, raggi, spaziature e tipografia. I `font-size` letterali sono vietati fuori da `_typography.scss`. `npm run gate` deve passare senza nuovi `ds-exception`. Lo `z-index` letterale è ammesso, come in `transactions-toolbar.scss`.
- I componenti sono standalone e usano `input()`, `output()`, `model()`, `signal()`, `computed()`. L'app è zoneless: niente `NgZone` né `setTimeout` per forzare il change detection.
- Testi UI in italiano. Descrizioni `it(...)` in italiano. Commenti in italiano, con la densità dei file vicini.
- Ricerca automatica quando `options.length > 8`.
- Pannello:
  - larghezza minima pari al trigger, massima `20rem`, mai oltre `viewport − var(--space-4)`;
  - si apre sopra se sotto restano meno di 240px e sopra c'è più spazio;
  - lista con `max-height: 15rem`.
- Default dei testi: `searchPlaceholder` `'Cerca…'`, `emptyText` `'Nessun risultato'`.
- Animazione di apertura: opacità più `translateY(4px)` in 120ms, assente con `prefers-reduced-motion: reduce`.
- Ogni commit termina con la riga: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Prerequisito (Task 0, a cura dell'utente)

Il branch corrente `feat/analytics-merchant-treemap` ha modifiche non committate su file che questo piano tocca:
- `transactions-table.*`
- `transactions-pagination.*` (nuovo, non tracciato)
- `transactions-table-panel.*`

Prima di iniziare:
1. l'utente committa quel lavoro;
2. si crea `feat/select-custom` a partire da quel commit;
3. si committa lo spec più questo piano;
4. si aggiunge `.superpowers/` a `.gitignore` nello stesso commit.

## Review Focus

1. **Tabella con overflow orizzontale e scroll della pagina:** il pannello aperto in una cella deve restare attaccato al trigger mentre si scrolla, e non deve essere tagliato. Test in Task 3 (`riposiziona il pannello allo scroll`).
2. **Due select nella stessa pagina:** aprirne uno deve chiudere l'altro, e gli id ARIA devono essere unici. Test in Task 3 (`id della listbox univoci tra istanze`) e Task 3 (`click fuori chiude`), dove il click sull'altro trigger conta come click fuori.
3. **Il valore cambia dall'esterno mentre il pannello è aperto** (salvataggio ottimistico in tabella): il trigger mostra il nuovo nome e la spunta si sposta. Test in Task 3 (`aggiorna la spunta quando value cambia da fuori`).
4. **`value` non presente tra le `options`** (categoria eliminata o lista ancora vuota): il trigger mostra il placeholder o "—", senza errori, e nessuna voce ha la spunta. Test in Task 3 (`value sconosciuto mostra il trattino`).
5. **Ricerca con accenti e spazi** ("caffe" deve trovare "Caffè", " sp " deve trovare "Spesa"). Test in Task 1.

---

### Task 1: Filtro di ricerca puro

**Modello consigliato:** haiku

**Files:**
- Create: `src/app/shared/ui/select-search.ts`
- Test: `src/app/shared/ui/select-search.spec.ts`

**Interfaces:**
- Produces:
  - `normalizeSearch(text: string): string`: minuscole, senza diacritici (`normalize('NFD')` e rimozione di `\p{M}`), con `trim`.
  - `matchSegments(text: string, query: string): readonly { text: string; match: boolean }[] | null`: `null` se non c'è match. Con query vuota restituisce `[{ text, match: false }]`. I segmenti conservano il testo **originale**, accenti compresi, e marcano la **prima** occorrenza.

- [ ] **Step 1: Scrivere i test**

```ts
describe('normalizeSearch', () => {
  it('ignora maiuscole, accenti e spazi ai bordi', () => {
    expect(normalizeSearch('  Caffè ')).toBe('caffe');
  });
});
describe('matchSegments', () => {
  it('restituisce null se la query non compare', () => {
    expect(matchSegments('Spesa', 'xyz')).toBeNull();
  });
  it('con query vuota restituisce tutto il testo senza match', () => {
    expect(matchSegments('Spesa', '')).toEqual([{ text: 'Spesa', match: false }]);
  });
  it('marca la prima occorrenza conservando il testo originale', () => {
    expect(matchSegments('Trasporti', 'SP')).toEqual([
      { text: 'Tra', match: false }, { text: 'sp', match: true }, { text: 'orti', match: false },
    ]);
  });
  it('trova parole accentate cercando senza accento', () => {
    expect(matchSegments('Caffè', 'caffe')).toEqual([{ text: 'Caffè', match: true }]);
  });
  it('ignora gli spazi ai bordi della query', () => {
    expect(matchSegments('Spesa', ' sp ')?.[0]).toEqual({ text: 'Sp', match: true });
  });
});
```

- [ ] **Step 2: Eseguire e verificare che fallisca.** `npx ng test --watch=false --include=src/app/shared/ui/select-search.spec.ts` → FAIL (modulo inesistente).
- [ ] **Step 3: Implementare.** Gli indici del match vanno calcolati sul testo normalizzato carattere per carattere, così che `è` (NFD: 2 code unit) corrisponda a un solo carattere dell'originale. Si itera sui caratteri originali, normalizzandoli uno alla volta, e si costruisce una mappa indice-normalizzato → indice-originale.
- [ ] **Step 4: Eseguire e verificare che passi.** Stesso comando → PASS.
- [ ] **Step 5: Commit.** `feat(ui): filtro di ricerca senza accenti per app-select`

---

### Task 2: Mixin `form-control`

**Modello consigliato:** haiku

**Files:**
- Modify: `src/app/shared/styles/_mixins.scss` (nuovo mixin in fondo)
- Modify: `src/styles.scss` (regole `input, select, textarea` alle righe 261-270, 353-357, 366-372, 375-380, 394-398)

**Interfaces:**
- Produces: `@mixin form-control`. Contiene:
  - lo stile base: typography `body`, padding `--space-3 --space-4`, bordo, `--radius-input`, `--color-surface`, `--color-text-primary`;
  - `&:hover:not(:disabled)`;
  - `&:focus-visible`;
  - `&:disabled`;
  - `&[aria-invalid='true']`, con lo stesso bordo di `:user-invalid`: `--color-error`, 2px.

  `app-select` lo include sul trigger `field` (Task 3). La regola globale di `styles.scss` lo include al posto delle dichiarazioni duplicate. `:user-invalid` resta nella regola globale, perché un `<button>` non lo riceve.

- [ ] **Step 1: Estrarre il mixin** e farlo includere da `styles.scss`, mantenendo identici i selettori globali e le esclusioni (`checkbox`, `radio`, `file`). Il commento esistente sopra la regola resta lì; nel mixin va una riga che rimanda a quel commento.
- [ ] **Step 2: Verificare.** Eseguire `npx ng test --watch=false --include=src/app/shared/styles/**` (include `form-fields.spec.ts` e `tokens.spec.ts`), poi `npm run gate` e `npx ng build` → tutto verde.
- [ ] **Step 3: Commit.** `refactor(styles): mixin form-control condiviso dai campi`

---

### Task 3: `app-select` (trigger, pannello, tastiera, ricerca, ARIA)

**Modello consigliato:** opus

**Files:**
- Create:
  - `src/app/shared/ui/select.ts`, `select.html`, `select.scss`
  - `src/app/shared/ui/select.model.ts`
  - `src/app/shared/ui/select.testing.ts`
- Test: `src/app/shared/ui/select.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`matchSegments`) e Task 2 (`@mixin form-control`). Usa anche `ColorMarkerComponent` (`[color]` obbligatorio) e da `@lucide/angular` `LucideDynamicIcon` (per `LucideIconData`), `LucideChevronDown`, `LucideCheck`, `LucideSearch`.
- Produces:
  - In `select.model.ts`: `export interface SelectOption<T extends string = string> { readonly id: T; readonly name: string; readonly color?: string | null; readonly icon?: LucideIconData }`.
  - In `select.ts`: `export class Select<T extends string = string> implements ControlValueAccessor`, selettore `app-select`, provider `NG_VALUE_ACCESSOR` con `forwardRef`. Input:
    - `options` (obbligatorio)
    - `value = model<T | null>(null)`
    - `appearance: 'inline' | 'field' = 'inline'`
    - `placeholder: string | null = null`
    - `placeholderPosition: 'start' | 'end' = 'start'`
    - `ariaLabel: string | null = null`
    - `ariaInvalid: boolean = false`
    - `ariaDescribedBy: string | null = null`
    - `triggerId: string | null = null`
    - `searchable: boolean | 'auto' = 'auto'`
    - `searchPlaceholder = 'Cerca…'`
    - `emptyText = 'Nessun risultato'`
    - `disabled = false`
    - `readonly = false`

    `model()` fornisce già l'output `valueChange`.
  - In `select.testing.ts` (helper per gli spec dei consumatori):
    - `selectTrigger(root: ParentNode, scope: string): HTMLButtonElement`: trova `${scope} app-select button[role="combobox"]`.
    - `async chooseOption(fixture: ComponentFixture<unknown>, root: ParentNode, scope: string, name: string): Promise<void>`: clicca il trigger, attende `whenStable`, clicca il `[role="option"]` con quel testo, attende `whenStable`.
    - `selectedName(root: ParentNode, scope: string): string`: testo `.select-name` del trigger.
  - Classi DOM stabili su cui contano gli altri task:
    - `.select-trigger` con modificatori `.inline`, `.field`, `.readonly`, `.selection-made`;
    - `.select-name`, `.select-panel`, `.select-search` (l'input);
    - `[role="listbox"]`, `[role="option"]`;
    - `.select-empty` (nessun risultato);
    - `.select-readonly` (lo span mostrato in readonly, senza `<button>`).

Regole che il codice deve rispettare (dallo spec):
- **Id univoci.** Si usa un contatore di modulo (`let nextId = 0`) per costruire `app-select-${n}-listbox` e `app-select-${n}-option-${i}`.
- **Una sola istanza aperta.** Il click fuori si ascolta come `pointerdown` su `document` in fase capture, solo mentre il pannello è aperto, ed è rimosso alla chiusura e in `DestroyRef`. Un `pointerdown` sul trigger di un'altra istanza conta come click fuori.
- **Riposizionamento.** Mentre il pannello è aperto, `scroll` (capture, su `window`) e `resize` ricalcolano `top`/`left`/`width` del pannello da `getBoundingClientRect()` del trigger. Il pannello ha `position: fixed; z-index: 10`.
- **Fuoco.** Con la ricerca, il fuoco va sull'input all'apertura; senza ricerca resta sul trigger. Per spostarlo dopo il render si usa `afterNextRender` con l'`injector`, non `setTimeout`.
- **Valore emesso.** `valueChange` scatta solo se il nuovo id è diverso da quello corrente. In quel caso il componente chiama anche `onChange` del CVA. `writeValue` imposta `value` senza emettere.
- **Placeholder.** È l'opzione con valore `null` ed è sempre visibile anche filtrando. Per il trigger, se `value` è `null` o sconosciuto, si mostra il testo del `placeholder` in `--color-text-muted`, altrimenti `'—'`.

- [ ] **Step 1: Scrivere i test** in `select.spec.ts`. L'host di test è un componente wrapper con `[(value)]`, con 3 opzioni (`food` "Alimentari" con color, `income` "Entrata" con icon `TrendingUp`, `caffe` "Caffè"), più una variante con 12 opzioni per la ricerca. Test:
  - `mostra nome, pallino o icona del valore selezionato`
  - `value sconosciuto mostra il trattino e nessuna voce ha la spunta`
  - `il trigger espone role combobox, aria-expanded, aria-controls e aria-label`
  - `apre con click e chiude con Esc riportando il fuoco al trigger`
  - `apre con freccia giù e Invio sceglie la voce attiva`
  - `le frecce spostano aria-activedescendant e Home/End vanno agli estremi`
  - `Tab chiude senza scegliere`
  - `click fuori chiude, anche sul trigger di un altro app-select`
  - `id della listbox univoci tra istanze`
  - `click su una voce emette valueChange e chiude`
  - `non emette se si sceglie la voce già selezionata`
  - `il placeholder in fondo emette null` (`placeholderPosition="end"`)
  - `aggiorna la spunta quando value cambia da fuori a pannello aperto`
  - `senza ricerca, digitare una lettera salta alla voce che inizia così`
  - `con più di 8 opzioni mostra la ricerca e le dà il fuoco`
  - `la ricerca filtra ignorando gli accenti ed evidenzia il match` ("caffe" → una voce, con `<mark>Caffè</mark>`)
  - `la ricerca senza risultati mostra emptyText ma tiene il placeholder`
  - `la ricerca si svuota a ogni apertura`
  - `readonly mostra solo il nome, senza button né chevron`
  - `disabled disabilita il trigger`
  - `appearance field applica la classe field e inoltra aria-invalid, aria-describedby e id`
  - `riposiziona il pannello allo scroll` (mock di `getBoundingClientRect`, dispatch di `scroll` su window, verifica di `style.top`)
  - `si apre sopra se sotto non c'è spazio` (mock di `rect.bottom` vicino a `innerHeight`, verifica della classe `.above`)
  - `funziona con ngModel` (host con `FormsModule`, `[(ngModel)]`: la scelta aggiorna il modello, un cambio del modello aggiorna il trigger, `[disabled]` via form disabilita)
- [ ] **Step 2: Eseguire e verificare che fallisca.** `npx ng test --watch=false --include=src/app/shared/ui/select.spec.ts` → FAIL.
- [ ] **Step 3: Implementare** `select.model.ts`, `select.ts`, `select.html` e `select.scss`. La struttura DOM segue lo spec (§Struttura e ARIA), lo stile segue lo spec (§Stile) e il mockup A.
  - Il trigger `inline` riprende le regole di `visual-select.scss` righe 7-62.
  - Il trigger `field` fa `@include mixins.form-control` più `display: flex; width: 100%; justify-content: space-between`.
  - La voce ha `padding: var(--space-3) var(--space-4)` e typography `table-text`.
  - La voce attiva ha `--color-surface-hover`.
  - La spunta usa `--color-primary-hover`.
  - Il match evidenziato usa `mark { background: none; color: var(--color-primary-hover); font-weight: 600 }`.
- [ ] **Step 4: Scrivere `select.testing.ts`** e usarlo in almeno un test dello spec, così che compili.
- [ ] **Step 5: Eseguire e verificare che passi**, poi `npm run gate` → verde.
- [ ] **Step 6: Commit.** `feat(ui): app-select, dropdown custom con ricerca`

---

### Task 4: Migrare tabella transazioni e pagina merchant

**Modello consigliato:** sonnet

**Files:**
- Modify:
  - `src/app/features/transactions/transaction-type-options.ts`: `SelectOption<TransactionType>` con le icone Lucide `TrendingDown`, `TrendingUp`, `Banknote`, `HandCoins`, `ArrowLeftRight`, `Ellipsis` importate da `@lucide/angular`, al posto delle stringhe.
  - `src/app/shared/ui/transactions-table.model.ts`, `transactions-table.ts`, `transactions-table.html:90-108`: `<app-select>` con `[value]`, `(valueChange)`, `[readonly]`, `[disabled]` e `ariaLabel` invariati. Per la categoria aggiungere `placeholder="— Nessuna categoria"` e `placeholderPosition="end"`.
  - `src/app/features/merchants/merchants-page.html:99-105` e `merchants-page.ts`: stesso schema per la categoria.
  - Ogni altro import di `VisualSelectOption`/`VisualSelectIcon` (`grep -rn VisualSelect src/app`), tranne `visual-select.*`.
- Test:
  - `src/app/shared/ui/transactions-table.spec.ts:251-321,375`
  - `src/app/features/transactions/transactions-page.spec.ts:265,401`
  - `src/app/features/transactions/transactions-delete.spec.ts:272`
  - gli spec della pagina merchant che pilotano la categoria, se esistono

**Interfaces:**
- Consumes: da Task 3 `Select`, `SelectOption`, `chooseOption`, `selectTrigger`, `selectedName` e le classi `.select-readonly`/`.select-trigger`.

- [ ] **Step 1: Riscrivere le asserzioni degli spec** sul nuovo DOM.
  - Le query `app-visual-select select` + `dispatchEvent('change')` diventano `chooseOption(fixture, root, 'app-transactions-table .type', 'Entrata')`.
  - `.picker.readonly` diventa `app-select .select-readonly`.
  - `querySelector('select')).toBeNull()` diventa `querySelector('app-select button[role="combobox"]')).toBeNull()`.

  Il significato di ogni test resta lo stesso.
- [ ] **Step 2: Eseguire gli spec toccati** → FAIL (il DOM è ancora quello vecchio).
- [ ] **Step 3: Migrare i template e i tipi** come indicato in Files.
- [ ] **Step 4: Eseguire** `npx ng test --watch=false` (suite intera), `npm run gate` e `npx ng build` → verde.
- [ ] **Step 5: Commit.** `refactor(transactions): tabella e merchant usano app-select`

---

### Task 5: Migrare paginazione, filtro tipo della dashboard e filtro persona dei prestiti

**Modello consigliato:** sonnet

**Files:**
- Modify:
  - `src/app/shared/ui/transactions-pagination.html:44-55` e `.ts`/`.scss`:
    - `app-select appearance="field"`;
    - le opzioni sono `TRANSACTIONS_PAGE_SIZES.map(s => ({ id: String(s), name: String(s) }))`, come costante calcolata nel componente;
    - `(valueChange)="pageSizeSelected.emit(+$event!)"`;
    - `[value]="String(pageSize)"`;
    - il `<label class="size">` resta e avvolge il componente.
  - `src/app/features/dashboard/dashboard-page.html:14-23` e `.ts`:
    - `field`, `placeholder="Tutti"`;
    - opzioni da `TRANSACTION_TYPE_OPTIONS` (Task 4);
    - `(valueChange)="onTypeChange($event ?? '')"`. Se la firma di `onTypeChange` lo richiede, va adattata in modo che `null` significhi "Tutti".
  - `src/app/features/loans/loans-page.html:39-47` e `.ts`:
    - `field`, `placeholder="Tutte le persone"`;
    - opzioni `borrowers().map(b => ({ id: b, name: b }))` come `computed`;
    - `(valueChange)="apply({ borrower: $event })"`.
- Test:
  - `src/app/features/analytics/analytics-transactions.spec.ts:210`
  - `src/app/shared/ui/transactions-table-panel.spec.ts:238`
  - `src/app/features/dashboard/dashboard-page.spec.ts`
  - `src/app/features/loans/loans-page.spec.ts`

  Per gli ultimi due: aggiungere un test se il filtro oggi non è coperto, `filtra per tipo scegliendo dal select` / `filtra per persona scegliendo dal select`.

**Interfaces:**
- Consumes: Task 3 (`Select`, `chooseOption`) e Task 4 (`TRANSACTION_TYPE_OPTIONS: readonly SelectOption<TransactionType>[]`).

- [ ] **Step 1: Aggiornare o aggiungere i test** con `chooseOption`. Per esempio, la dimensione pagina: `chooseOption(fixture, el, 'app-transactions-pagination', '50')` emette `50` come numero.
- [ ] **Step 2: Eseguirli** → FAIL.
- [ ] **Step 3: Migrare i tre template.**
- [ ] **Step 4: Eseguire** la suite intera, `npm run gate` e `npx ng build` → verde.
- [ ] **Step 5: Commit.** `refactor(ui): paginazione e filtri usano app-select`

---

### Task 6: Migrare i form (movimento collegato del prestito, import CSV)

**Modello consigliato:** sonnet

**Files:**
- Modify:
  - `src/app/features/loans/loan-detail-page.html:251-264` e `.ts`:
    - `<app-select appearance="field" triggerId="repaymentTransactionId" name="repaymentTransactionId" [ngModel]=… (ngModelChange)=…>`;
    - `placeholder="Contanti — nessun movimento bancario"`;
    - opzioni come `computed`: `{ id, name: formatBookingDate · formatAmount · description }` (stesso testo di oggi);
    - `[ariaDescribedBy]="repaymentTransactionIdDescribedBy()"`.

    `null` dal componente corrisponde a `''` nel form: la conversione avviene in `updateRepaymentField`, così il form mantiene il tipo attuale.
  - `src/app/features/import/column-picker.html` (6 select, righe 3, 21, 65, 79, 91, 114) e `column-picker.ts`:
    - ognuno diventa `app-select appearance="field"`;
    - `[triggerId]` uguale all'`id` attuale;
    - `placeholder` uguale al testo dell'opzione vuota attuale;
    - `[ariaInvalid]="!!errors().X"`;
    - `[ariaDescribedBy]` invariato;
    - opzioni da un `computed` `headerOptions` (header → `{ id, name }`);
    - `(valueChange)="update('X', $event ?? '')"`.
- Test:
  - `src/app/features/loans/loan-detail-page.spec.ts`: aggiungere `collega il rimborso a un movimento scelto dal select`, se oggi non è coperto.
  - Creare `src/app/features/import/column-picker.spec.ts`, se non esiste, con:
    - `scegliere una colonna aggiorna la mappatura`;
    - `un errore imposta aria-invalid sul trigger`.

**Interfaces:**
- Consumes: Task 3 (`Select` con CVA, `triggerId`, `ariaInvalid`, `ariaDescribedBy`, `chooseOption`).

- [ ] **Step 1: Scrivere i test** sopra.
- [ ] **Step 2: Eseguirli** → FAIL.
- [ ] **Step 3: Migrare i due template.** Verificare che il click sull'etichetta di `app-form-field` apra o metta a fuoco il trigger. Il `<label>` avvolge il `<button>`, quindi funziona senza `for`.
- [ ] **Step 4: Eseguire** la suite intera, `npm run gate` e `npx ng build` → verde.
- [ ] **Step 5: Commit.** `refactor(forms): prestiti e import usano app-select`

---

### Task 7: Rimuovere `visual-select` e i resti del select nativo

**Modello consigliato:** haiku

**Files:**
- Delete: `src/app/shared/ui/visual-select.ts`, `.html`, `.scss`, `.spec.ts`
- Modify:
  - `src/styles.scss`: togliere `select` dai selettori globali, solo se `grep -rn "<select" src/app` non restituisce nulla.
  - `src/app/shared/styles/form-fields.spec.ts`: adeguarlo se verifica `select`.
  - `docs/architecture/frontend-shared-components-proposal.md`: una sezione breve "Select" che rimanda allo spec e annota la rimozione di `visual-select`.

- [ ] **Step 1: Verificare** che `grep -rn "visual-select\|VisualSelect\|<select" src/app` non restituisca nulla.
- [ ] **Step 2: Eliminare e pulire** come indicato in Files.
- [ ] **Step 3: Eseguire** `npx ng test --watch=false`, `npm run gate` e `npx ng build` → verde.
- [ ] **Step 4: Verifica manuale nell'app**, con la skill `run`:
  - tabella transazioni: categoria con ricerca, tipo con icone;
  - pagina merchant;
  - paginazione;
  - dashboard;
  - prestiti;
  - import CSV;

  in tema chiaro e scuro, da tastiera.
- [ ] **Step 5: Commit.** `chore(ui): rimuove visual-select e il select nativo`
