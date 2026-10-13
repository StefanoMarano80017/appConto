# Pagina categorie: griglia di tessere compatte — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La pagina `/categories` diventa una griglia responsiva di tessere compatte, con rinomina e colore immediati, ricerca, ordinamento e creazione da bozza.

**Architecture:** Filtro e ordinamento sono funzioni pure in `category-list.ts`. La tessera è una sottocomponente `app-category-tile` dentro la feature: gestisce solo la propria modifica del nome e la propria bozza, ed emette eventi. La pagina tiene la lista, i salvataggi in corso (un insieme di id), la conferma di eliminazione, la bozza di creazione e le chiamate a `CategoriesApi`, che resta invariata. Backend invariato.

**Tech Stack:** Angular 21 zoneless, componenti standalone, signals, `@lucide/angular`, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-13-categorie-griglia-design.md`. Chi implementa legge spec e piano insieme.

## Global Constraints

- Id protetto («Da classificare»): `c9bfcd74-e342-4a3f-8b0c-116f89236d51` (`FALLBACK_CATEGORY_ID`, già in `categories-page.ts`). Il nome non è rinominabile e la categoria non è eliminabile. Il colore resta modificabile.
- Colore predefinito per la bozza e per `color: null`: `#9aa3af`.
- Ordinamenti: `name-asc` (predefinito) | `name-desc` | `merchants-desc` | `merchants-asc`. A parità si ordina per nome A→Z. Confronto dei nomi con `localeCompare(b, 'it', { sensitivity: 'base' })`.
- Ricerca: sottostringa del nome, senza distinzione di maiuscole né accenti (normalizzazione NFD che toglie i segni diacritici, poi `toLowerCase`). Nessun debounce.
- Nessun colore, spaziatura, raggio o font letterale: `npm run gate --prefix apps/frontend` passa senza nuovi `ds-exception`.
- Il pannello di `app-color-picker` è `position: fixed`. Sulla tessera e sui suoi antenati non vanno `opacity`, `transform`, `filter`, `contain` né `overflow: hidden`.
- Commenti e descrizioni dei test in italiano. Nessuna nuova dipendenza.
- Testi fissati dallo spec:
  - sottotitolo «Crea, rinomina o elimina le categorie di spesa.», pulsante «Aggiorna»
  - «+ Nuova categoria», placeholder «Cerca categoria…», etichetta «Ordina»
  - voci di ordinamento «Nome A→Z», «Nome Z→A», «Più merchant», «Meno merchant»
  - conferma «N merchant verrà spostato / verranno spostati su «Da classificare». Eliminare?», pulsanti «Sì, elimina» / «Eliminazione…» / «Annulla»
  - «Nessuna categoria corrisponde alla ricerca.» con azione «Azzera ricerca»
  - «Nessuna categoria.» con azione «Crea la prima categoria»
  - `aria-label`: «Nome di X», «Colore di X», «Elimina X»

## Review Focus

1. **Nome con spazi intorno o solo spazi.** «  Casa  » salva «Casa». «   » non salva ed esce dalla modifica. Test in Task 2.
2. **Clic sul color picker della stessa tessera mentre si scrive il nome nella bozza.** La bozza non deve sparire. Test in Task 2 (`focusout` con `relatedTarget` interno).
3. **Rinomina fallita (nome duplicato, 409).** L'errore si vede, la lista si ricarica e la tessera mostra il nome salvato, non quello digitato. Test in Task 3.
4. **Due salvataggi ravvicinati su tessere diverse.** Finita la prima risposta, la seconda tessera resta attenuata finché non arriva la sua. Test in Task 3.
5. **Ricerca «caffe» o «BAR».** Deve trovare «Bar e caffè». Test in Task 1.

---

## File Structure

| File | Ruolo |
|---|---|
| `features/categories/category-list.ts` (nuovo, + `.spec.ts`) | `CategorySort`, `CATEGORY_SORT_OPTIONS`, `filterCategories`, `sortCategories` |
| `features/categories/category-tile/category-tile.{ts,html,scss}` (nuovo, + `.spec.ts`) | la tessera: riposo, modifica del nome, bozza, conferma di eliminazione |
| `features/categories/categories-page.{ts,html,scss,spec.ts}` | toolbar, griglia, stati della pagina, chiamate API |

Tutti i percorsi sono relativi a `apps/frontend/src/app/`.

---

### Task 1: Ordinamento e ricerca puri

**Files:**
- Create: `features/categories/category-list.ts`
- Test: `features/categories/category-list.spec.ts`

**Interfaces:**
- Produces:
  - `type CategorySort = 'name-asc' | 'name-desc' | 'merchants-desc' | 'merchants-asc'`
  - `const CATEGORY_SORT_OPTIONS: readonly SelectOption<CategorySort>[]`, con le quattro voci nell'ordine dei Global Constraints
  - `filterCategories<T extends Category>(categories: readonly T[], search: string): T[]`
  - `sortCategories<T extends CategoryWithUsage>(categories: readonly T[], sort: CategorySort): T[]`, che non modifica l'array in ingresso

- [ ] **Step 0: Committa il lavoro in corso**, cioè il passaggio ad `app-color-picker` e la riformattazione di `select.html`. Prima esegui `npm run test:frontend` e verifica che sia verde. Poi committa con `feat(categories): color picker condiviso al posto di input type=color`, includendo `shared/ui/forms/color-picker/`, i file della pagina categorie, `select.html` e la spec del 2026-09-22 modificata. Aggiungi anche i nuovi documenti, cioè lo spec e questo piano, in un commit `docs(categories): design e piano della griglia di tessere`.
- [ ] **Step 1: Test** in `category-list.spec.ts`:
  - `filtra senza distinzione di maiuscole e accenti`: con «Bar e caffè», «Casa» e search `'CAFFE'` restituisce solo «Bar e caffè». Con `'bar'` idem.
  - `ricerca vuota o di soli spazi restituisce tutto`
  - `ordina per nome A→Z e Z→A in italiano`: «abbonamenti» (minuscolo), «Bollette», «Ålimentari» danno l'ordine `localeCompare` it, non l'ordine dei codepoint.
  - `ordina per merchant con parità risolta per nome`: `[{Casa,2},{Alimentari,2},{Bar,5}]` con `merchants-desc` dà Bar, Alimentari, Casa. Con `merchants-asc` dà Alimentari, Casa, Bar.
  - `non modifica l'array in ingresso`
- [ ] **Step 2: Esegui** `npm test --prefix apps/frontend -- --watch=false --include='**/category-list.spec.ts'`. Atteso: FAIL.
- [ ] **Step 3: Implementa** `category-list.ts`.
- [ ] **Step 4: Esegui** di nuovo. Atteso: PASS.
- [ ] **Step 5: Commit** `feat(categories): filtro e ordinamento delle categorie`

---

### Task 2: La tessera `app-category-tile`

**Files:**
- Create: `features/categories/category-tile/category-tile.{ts,html,scss}`
- Test: `features/categories/category-tile/category-tile.spec.ts`

**Interfaces:**
- Consumes: `ColorPicker` (`appearance="inline"`, `[value]`, `[ariaLabel]`, `[disabled]`, output `valueCommitted: string`), oltre a `CategoryWithUsage` e `Category`.
- Produces: il selettore `app-category-tile`, con:
  - input:
    - `category = input<CategoryWithUsage | null>(null)`: `null` significa bozza di creazione
    - `locked = input(false)`
    - `busy = input(false)`
    - `confirmingDelete = input(false)`
    - `deleting = input(false)`
  - output:
    - `renamed = output<string>()`: il nome già passato da `trim`, emesso solo se cambiato e non vuoto
    - `recolored = output<string>()`
    - `deleteAsked = output<void>()`
    - `deleteCancelled = output<void>()`
    - `deleteConfirmed = output<void>()`
    - `created = output<{ name: string; color: string }>()`: solo nella bozza
    - `draftDismissed = output<void>()`: solo nella bozza

Comportamento:
- Stato interno `editing = signal(false)`. La bozza parte in modifica e mette il focus sul campo dopo il render.
- **A riposo**, in quest'ordine:
  - color picker
  - `<button class="name">` col nome, che porta `title` col nome completo e tronca con ellissi su un `<span>` interno
  - `<button class="edit">` con `LucidePencil`, oppure `LucideLock` non interattivo se `locked`
  - il conteggio dei merchant
  - `<button class="delete">` con `LucideTrash2` e `aria-label` «Elimina X», assente se `locked`
- Se `locked`, il nome è testo e non un button.
- **In modifica** il campo `<input>` sostituisce nome, matita e cestino.
  - Invio salva, Esc annulla.
  - Su `focusout` della tessera, con `relatedTarget` fuori dalla tessera, la modifica si chiude. Se il valore è cambiato e non vuoto emette `renamed`, altrimenti esce senza emettere.
  - Nella bozza, Invio con nome non vuoto emette `created` col colore scelto (predefinito `#9aa3af`). Esc, oppure `focusout` verso l'esterno con nome vuoto, emette `draftDismissed`. Il colore della bozza è locale fino a `created`.
- **In conferma di eliminazione** (`confirmingDelete`) il contenuto della tessera è sostituito dal testo e dai due pulsanti. Esc equivale ad Annulla.
- **Se `busy`**, tutti i controlli sono `disabled`. L'attenuazione al 60% si applica ai figli diretti tranne `app-color-picker`.

- [ ] **Step 1: Test** in `category-tile.spec.ts`, con un host di test che fa da contenitore e registra gli output:
  - `mostra colore, nome, matita e numero di merchant`
  - `clic sul nome apre il campo col nome selezionato e il focus`
  - `Invio emette il nome ripulito dagli spazi`: «  Casa nuova  » emette `'Casa nuova'`
  - `Invio con nome vuoto o invariato non emette ed esce dalla modifica`
  - `Esc annulla e ripristina il nome`
  - `focusout verso l'esterno salva`: dispatch di `FocusEvent('focusout', { relatedTarget: document.body, bubbles: true })`
  - `focusout verso un controllo della stessa tessera non chiude la modifica`
  - `categoria bloccata: lucchetto, niente matita né cestino, nome non modificabile`
  - `cestino emette deleteAsked; in conferma mostra il testo al singolare e al plurale`: con 1 merchant «1 merchant verrà spostato su «Da classificare». Eliminare?», con 3 «verranno spostati»
  - `bozza: parte in modifica; Invio emette created con il colore predefinito #9aa3af`
  - `bozza: focusout verso il color picker della bozza non la chiude; Esc emette draftDismissed`
  - `busy disabilita i controlli`
- [ ] **Step 2: Esegui** `npm test --prefix apps/frontend -- --watch=false --include='**/category-tile.spec.ts'`. Atteso: FAIL.
- [ ] **Step 3: Implementa** il componente con `ChangeDetectionStrategy.OnPush`, come `ColorPicker`.
- [ ] **Step 4: SCSS** della tessera:
  - aspetto: `display: flex`, `gap: var(--space-4)`, sfondo `--color-surface`, bordo `--color-border` da `--border-width`, raggio `--radius-input`, hover `--color-surface-elevated`
  - in modifica: bordo `--color-primary` e `box-shadow: 0 0 0 3px var(--color-focus-ring)`
  - l'altezza a riposo e in modifica è la stessa
  - il conteggio usa i token muted e `tabular-nums`
  - il cestino è muted e diventa `--color-error` all'hover
  - i bottoni di conferma ricalcano `.actions button.danger` e `.ghost` dell'attuale `categories-page.scss`
- [ ] **Step 5: Esegui** di nuovo, poi `npm run gate --prefix apps/frontend`. Atteso: PASS.
- [ ] **Step 6: Commit** `feat(categories): tessera categoria con rinomina, colore ed eliminazione`

---

### Task 3: La pagina a griglia

**Files:**
- Modify: `features/categories/categories-page.{ts,html,scss}`
- Test: `features/categories/categories-page.spec.ts`, da riscrivere tenendo l'impianto esistente (helper `category()` e `load()`, `HttpTestingController`)

**Interfaces:**
- Consumes:
  - Task 1: `CategorySort`, `CATEGORY_SORT_OPTIONS`, `filterCategories`, `sortCategories`
  - Task 2: `app-category-tile` e i suoi input e output
  - `SearchInput` (`value`, `placeholder`, output `valueChange`)
  - `Select` (`options`, `[value]`, `ariaLabel`, output `valueChange`)
  - `EmptyState`, `ErrorRetry`, `CategoriesApi` (invariata)

Stato della pagina:
- `categories = signal<CategoryWithUsage[]>([])`, `loading`, `loadError`
- `actionError = signal<string | null>(null)`: errori di salvataggio, creazione ed eliminazione, mostrati con `role="alert"` sopra la griglia
- `search = signal('')`, `sort = signal<CategorySort>('name-asc')`
- `visible = computed(() => sortCategories(filterCategories(categories(), search()), sort()))`
- `savingIds = signal<ReadonlySet<string>>(new Set())`: aggiunta e rimozione sempre creando un nuovo `Set`
- `confirmingDeleteId`, `deleting`
- `drafting = signal(false)`, `creating = signal(false)`

Template:
- `app-section-header` con «Aggiorna»
- `.toolbar`, come in `merchants-page.scss`: `app-search-input`, l'etichetta «Ordina» con `app-select` e, spinto a destra, «+ Nuova categoria» (disabilitato se `drafting()` o `creating()`)
- poi l'alert
- poi, nell'ordine:
  - con `loading()` e lista vuota, lo skeleton: 12 rettangoli nella stessa griglia, pulsanti come `.skeleton .line` di `merchants-page.scss`, con `prefers-reduced-motion`
  - con `loadError()`, `app-error-retry`
  - altrimenti `.grid` con la tessera bozza in testa (se `drafting()`) e le tessere di `visible()`, `track category.id`. Se la lista è vuota compare l'empty-state appropriato, sotto la bozza se c'è.
- Griglia: `grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr))`, `gap: var(--space-4)`.

Azioni:
- `renamed`: `PATCH { name }`. `recolored`: `PATCH { color }`.
- Successo: sostituisce la categoria e la tessera si riposiziona da sola tramite `visible`.
- Errore: `actionError` e poi `load()`, come l'attuale `save()`.
- `created`:
  - `POST`, con `creating` attivo durante la richiesta
  - successo: aggiunge `{ ...created, merchantCount: 0 }` e `drafting.set(false)`
  - errore: `actionError`, e la bozza resta con il testo digitato. Per questo `created` non chiude la bozza da sé: la chiude la pagina.
- Eliminazione: logica invariata (`askDelete`, `cancelDelete`, `deleteCategory`), passando `confirmingDelete` e `deleting` alla tessera interessata.

- [ ] **Step 1: Test** in `categories-page.spec.ts`. Tieni quelli ancora validi su caricamento ed errore e sostituisci quelli legati a `input.rename` e `input[name="newName"]`:
  - `mostra una tessera per categoria, in ordine alfabetico`: risposta [Casa, Alimentari], tessere nell'ordine Alimentari, Casa
  - `ordina per più merchant dal selettore Ordina`
  - `la ricerca filtra le tessere; senza risultati mostra lo stato vuoto e Azzera ricerca ripristina`
  - `rinomina: PATCH con il nuovo nome e la tessera si riposiziona`
  - `rinomina fallita: mostra l'errore, ricarica e la tessera mostra il nome salvato`: PATCH 409, poi una nuova `GET /categories`
  - `due salvataggi concorrenti: la seconda tessera resta occupata finché non risponde`: due PATCH aperte, flush della prima, la seconda tessera ha ancora i controlli disabilitati
  - `cambio colore: PATCH con il colore`
  - `Nuova categoria apre la bozza in testa; Invio crea e la tessera entra in ordine`: `POST` con `{ name: 'Regali', color: '#9aa3af' }`
  - `creazione fallita: errore visibile e bozza ancora aperta col testo`
  - `eliminazione: conferma nella tessera, DELETE, la tessera sparisce`
  - `Da classificare non ha cestino né rinomina`
  - `nessuna categoria: Crea la prima categoria apre la bozza`
  - `errore di caricamento: Riprova rilancia la GET`
- [ ] **Step 2: Esegui** `npm test --prefix apps/frontend -- --watch=false --include='**/categories-page.spec.ts'`. Atteso: FAIL.
- [ ] **Step 3: Riscrivi** `categories-page.ts` e `categories-page.html` secondo lo stato e il template descritti sopra. Togli `FormsModule` se non serve più.
- [ ] **Step 4: Riscrivi** `categories-page.scss`. Elimina `.create-form`, `.scroller`, `.categories` e il commento sul raggio da 4px. Restano `.toolbar`, `.grid`, l'alert, `.skeleton` e `.empty`.
- [ ] **Step 5: Esegui** `npm run test:frontend`, `npm run gate --prefix apps/frontend` e `npm run build:frontend`. Atteso: tutto PASS.
- [ ] **Step 6: Verifica a mano** con `npm run dev:backend` e `npm run dev:frontend`:
  - a 1280px ci sono almeno 3 colonne; a 400px una
  - rinomina con Invio, con clic fuori e con Esc
  - cambia colore e verifica che il pannello non sia attenuato né tagliato
  - crea scegliendo prima il colore e poi il nome
  - elimina una categoria con merchant
  - la ricerca «caffe» trova «Bar e caffè»
  - prova ogni voce di ordinamento
- [ ] **Step 7: Commit** `feat(categories): griglia di tessere con ricerca e ordinamento`
