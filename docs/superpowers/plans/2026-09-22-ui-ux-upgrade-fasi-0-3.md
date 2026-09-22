# UI/UX Upgrade — Fasi 0-3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare il frontend Angular sul design system Saldo — token, tipografia, shell a sidebar, impalcatura a tre colonne — e validare l'intero sistema migrando Analytics come pagina pilota.

**Architecture:** Il codice legge già il 100% dei colori da custom property, quindi la Fase 0 ribalta la palette dell'intera app ridefinendo un solo strato di token, senza toccare file di feature. I nomi di token attuali restano come alias temporanei verso i nuovi, e vengono sostituiti file per file nelle fasi successive: la cancellabilità di `_legacy-aliases.scss` è il criterio meccanico di completamento. Sopra questo strato si costruiscono le primitive condivise (`Amount`, `FilterGroup`, `SortableHeader`, `PageLayout`), poi la shell a sidebar, infine Analytics come pilota che stabilisce il pattern per le pagine rimanenti.

**Tech Stack:** Angular 21 standalone zoneless, SCSS, Vitest + `TestBed`, nessuna libreria UI.

**Spec:** [`docs/superpowers/specs/2026-09-22-ui-ux-upgrade-design.md`](../specs/2026-09-22-ui-ux-upgrade-design.md)

## Global Constraints

- **Ambito**: solo `apps/frontend`. Nessuna modifica a `apps/backend`, né a file `*.model.ts`, `*.api.ts`, `*.store.ts`, `*-query.ts`.
- **Nessuna nuova dipendenza npm.** I font si aggiungono come file `.woff2` committati, non come pacchetto.
- **Nessuna libreria UI esterna.**
- **Esadecimali ammessi solo in `_primitives.scss`.** Ogni altro file usa `var(--color-*)`.
- **`font-size` letterale ammesso solo in `_typography.scss`.** Ogni altro file usa `@include text(<ruolo>)`.
- **`border-radius` numerico ammesso solo in `_semantic.scss`.** Ogni altro file usa `var(--radius-*)`.
- **`shared/**` non importa mai da `features/**`**, non inietta `*Api`, `*Store`, `ThemeStore`, `Router` né `ActivatedRoute`.
- **Offline**: nessuna richiesta di rete esterna a runtime. Niente Google Fonts, niente CDN.
- **Nessun numero finanziario sopra 25px** (DS §4). Nessuna entrata/uscita distinta dal solo colore (DS §5).
- **Ogni task termina con build verde e test verdi**: `npm run build:frontend` e `npm run test:frontend`.

  Totale progressivo atteso, partendo dalla baseline di **232**:

  | Dopo il task | Test | Aggiunti da |
  |---|---|---|
  | 1, 2, 3 | 232 | — |
  | 4 | 237 | `Amount` (+5) |
  | 5 | 238 | `FilterGroup` (+1) |
  | 6 | 241 | `SortableHeader` (+3) |
  | 7 | 243 | `SectionHeader` (+2) |
  | 8, 9 | 243 | — |
  | 10 | 246 | `PageLayout` (+3) |
  | 11 → 16 | 246 | — (il Task 11 aggiorna un test esistente di `app.spec.ts`, non ne aggiunge) |
- Commenti e nomi in italiano, coerenti con il resto del codice. I commenti spiegano il *perché*, non il *cosa*.

## Review Focus

Cinque condizioni che la spec implica ma che nessun task esercitava nella prima stesura. Il test che le fissa è stato aggiunto al task che possiede il codice.

1. **`Amount` con valore zero** — `+0,00 €` non ha senso: uno zero non è né entrata né uscita. Atteso: nessun segno, nessun colore di tono. → Task 4, Step 1.
2. **`PageLayout` con slot toolbox proiettato ma vuoto** — una pagina che proietta un contenitore il cui contenuto è dietro un `@if` falso riserverebbe 300px per il nulla. Atteso: colonna singola. → Task 10, Step 1.
3. **Geist non disponibile a runtime** (file mancante o corrotto) — atteso: il fallback resta leggibile e i numeri restano allineati in colonna, perché `--font-mono` finisce su `ui-monospace` e `tabular-nums` è indipendente dalla famiglia. → Task 1, Step 4.
4. **Sidebar su viewport basso** (1280×720) — 8 voci più il toggle tema devono restare tutte raggiungibili. Atteso: la lista scorre, il toggle resta ancorato in fondo. → Task 11, Step 5.
5. **`SortableHeader` non attivo** — `aria-sort` deve valere `none`, non restare assente né ereditare la direzione di un'altra colonna. → Task 6, Step 1.

---

# FASE 0 — Fondamenta

Nessun file di feature viene toccato. Al termine l'intera applicazione è nella nuova palette e nella nuova scala tipografica.

---

### Task 1: Font Geist in bundle locale

**Files:**
- Create: `apps/frontend/public/fonts/geist-variable.woff2`
- Create: `apps/frontend/public/fonts/geist-mono-variable.woff2`
- Create: `apps/frontend/src/app/shared/styles/_fonts.scss`
- Modify: `apps/frontend/src/styles.scss`

**Interfaces:**
- Consumes: niente.
- Produces: le famiglie CSS `Geist` e `Geist Mono`, usate dai token `--font-ui` / `--font-mono` definiti nel Task 2.

- [ ] **Step 1: Scaricare i due font variabili**

Geist e Geist Mono sono distribuiti da Vercel con licenza SIL Open Font License 1.1, che ne consente la ridistribuzione insieme all'applicazione.

```bash
cd /tmp
curl -L -o geist.zip https://github.com/vercel/geist-font/releases/latest/download/Geist.zip
curl -L -o geist-mono.zip https://github.com/vercel/geist-font/releases/latest/download/GeistMono.zip
unzip -o geist.zip -d geist && unzip -o geist-mono.zip -d geist-mono
find geist geist-mono -name "*.woff2" | sort
```

Dei file elencati servono **i due variabili** (il nome contiene `Variable` o `[wght]`; sono quelli che coprono tutti i pesi in un file solo invece di uno per peso).

- [ ] **Step 2: Copiarli con nomi fissi**

I nomi nel rilascio cambiano fra versioni; rinominarli qui rende il CSS del passo successivo deterministico.

```bash
mkdir -p apps/frontend/public/fonts
cp "$(find /tmp/geist -name '*[Vv]ariable*.woff2' -o -name '*\[wght\]*.woff2' | head -1)" \
   apps/frontend/public/fonts/geist-variable.woff2
cp "$(find /tmp/geist-mono -name '*[Vv]ariable*.woff2' -o -name '*\[wght\]*.woff2' | head -1)" \
   apps/frontend/public/fonts/geist-mono-variable.woff2
ls -la apps/frontend/public/fonts/
```

Attesi: due file, ciascuno fra 50 KB e 250 KB. Se uno dei due manca o pesa 0 byte, il `find` non ha trovato il variabile — rieseguire lo Step 1 e scegliere il file a mano dall'elenco.

- [ ] **Step 3: Dichiarare le due famiglie**

Create `apps/frontend/src/app/shared/styles/_fonts.scss`:

```scss
/*
 * Le due famiglie del design system (DESIGN_SYSTEM.md §4).
 *
 * Servite dal bundle e non da una CDN: l'applicazione gira come eseguibile
 * portable, quindi a runtime non c'è rete su cui contare.
 *
 * Sono font variabili: un solo file copre tutti i pesi, e `font-weight`
 * accetta l'intero intervallo invece dei soli valori dichiarati.
 */
@font-face {
  font-family: 'Geist';
  src: url('/fonts/geist-variable.woff2') format('woff2-variations');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Geist Mono';
  src: url('/fonts/geist-mono-variable.woff2') format('woff2-variations');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
```

Aggiungere in testa a `apps/frontend/src/styles.scss`, come prima riga `@use`:

```scss
@use 'app/shared/styles/fonts';
```

- [ ] **Step 4: Verificare il caricamento e il fallback**

```bash
npm run build:frontend
```

Atteso: build verde. Poi `npm run dev:frontend` e nel browser:

1. DevTools → Network → filtro `Font`: attese **due** richieste, entrambe verso `/fonts/…`, nessuna verso un dominio esterno.
2. DevTools → Network → **Offline**, ricaricare: la pagina resta leggibile.
3. Console: `document.fonts.check('1em Geist')` → `true`.
4. **Review Focus 3** — rinominare temporaneamente `geist-variable.woff2` in `geist-variable.bak`, ricaricare: il testo resta leggibile con il fallback di sistema. Ripristinare il nome.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/public/fonts apps/frontend/src/app/shared/styles/_fonts.scss apps/frontend/src/styles.scss
git commit -m "feat(design): aggiungi Geist e Geist Mono al bundle locale

Font variabili serviti dal bundle e non da una CDN: l'app gira come
eseguibile portable e a runtime non c'e rete su cui contare.

Licenza SIL Open Font License 1.1, ridistribuzione consentita.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Strato dei token

**Files:**
- Create: `apps/frontend/src/app/shared/styles/_primitives.scss`
- Create: `apps/frontend/src/app/shared/styles/_semantic.scss`
- Create: `apps/frontend/src/app/shared/styles/_legacy-aliases.scss`
- Modify: `apps/frontend/src/styles.scss`
- Delete: `apps/frontend/src/app/shared/styles/_tokens.scss`

**Interfaces:**
- Consumes: le famiglie del Task 1.
- Produces: i token `--color-*` (33 per tema + 3 letterali + 2 ombre), `--space-1…10`, `--radius-*`, `--font-ui`, `--font-mono`, e gli alias legacy che mantengono funzionanti i 40+ file di feature non ancora migrati.

- [ ] **Step 1: Scrivere i primitivi**

Create `apps/frontend/src/app/shared/styles/_primitives.scss`. **È l'unico file dell'applicazione in cui è ammesso scrivere un esadecimale.** I valori sono presi 1:1 da `design-system/design-tokens.json`: non arrotondare, non "migliorare".

```scss
/*
 * Livello 1 dei token (DESIGN_SYSTEM.md §2): i valori grezzi, un blocco per
 * tema.
 *
 * design-tokens.json organizza gia' i colori per ruolo (`neutral.background`,
 * `brand.primary`, `semantic.income`), quindi non esiste una tavolozza
 * primitiva separata da nominare: il livello 1 e' "quali esadecimali valgono
 * in questo tema", il livello 2 e' il nome. Questo file e' il primo, i nomi
 * sono gia' quelli del secondo.
 *
 * I tre valori che DESIGN_SYSTEM.md §8 marca `literal` sono qui promossi a
 * token con un nome: un letterale scritto a mano dentro un componente e' il
 * punto di divergenza che §2 vieta.
 */
@mixin dark-palette {
  --color-background: #0a0b0d;
  --color-panel: #0d0f12;
  --color-surface: #121418;
  --color-surface-elevated: #171a1f;
  --color-surface-hover: #1d2026;
  --color-surface-active: #23272e;
  --color-border: #24272e;
  --color-border-strong: #343941;
  --color-row-divider: #16191d;
  --color-text-primary: #e8eaed;
  --color-text-secondary: #a5acb8;
  --color-text-muted: #777e8b;
  --color-disabled: #4c525c;

  --color-primary: #5f5ba8;
  --color-primary-hover: #8a86c9;
  --color-primary-active: #4f4b95;
  --color-primary-subtle: rgb(95 91 168 / 14%);
  --color-primary-border: rgb(95 91 168 / 34%);
  --color-on-primary: #f2f1fa;
  --color-focus-ring: rgb(95 91 168 / 22%);

  --color-income: #61b08d;
  --color-expense: #cb8b93;
  --color-warning: #b3924f;
  --color-error: #f0555f;
  --color-info: #7793b8;

  --color-chart-1: #7090b4;
  --color-chart-2: #96a66e;
  --color-chart-3: #5f968f;
  --color-chart-4: #b08290;
  --color-chart-5: #b3924f;
  --color-chart-6: #8a86c9;
  --color-chart-7: #a28bb2;
  --color-chart-neutral: #4c525c;

  /* I tre `literal` di DESIGN_SYSTEM.md §8. */
  --color-primary-hover-border: #a5a1da;
  --color-disabled-surface: #1a1c21;
  --color-disabled-input: #101216;

  /*
   * Ombre: design-tokens.json non ne contiene alcuna (lacuna §2.3 n.2 della
   * spec). Si conservano i due valori gia' in uso, che su fondo scuro devono
   * essere piu' dense per restare visibili.
   */
  --shadow-tooltip: 0 4px 14px rgb(0 0 0 / 55%);
  --shadow-dropdown: 0 6px 20px rgb(0 0 0 / 65%);

  color-scheme: dark;
}

@mixin light-palette {
  --color-background: #f3f3f1;
  --color-panel: #ebebe8;
  --color-surface: #ffffff;
  --color-surface-elevated: #f7f7f4;
  --color-surface-hover: #efefec;
  --color-surface-active: #e4e4e0;
  --color-border: #e3e3df;
  --color-border-strong: #c6c6c0;
  --color-row-divider: #f0f0ed;
  --color-text-primary: #1a1b19;
  --color-text-secondary: #4e5359;
  --color-text-muted: #6b7077;
  --color-disabled: #8b939b;

  --color-primary: #5b55c4;
  --color-primary-hover: #625cc0;
  --color-primary-active: #4a44a8;
  --color-primary-subtle: rgb(91 85 196 / 14%);
  --color-primary-border: rgb(91 85 196 / 34%);
  --color-on-primary: #f2f1fa;
  --color-focus-ring: rgb(91 85 196 / 22%);

  --color-income: #17794f;
  --color-expense: #ae3f51;
  --color-warning: #8a6a15;
  --color-error: #c22b33;
  --color-info: #2d6394;

  --color-chart-1: #3d6b99;
  --color-chart-2: #5f7a33;
  --color-chart-3: #2f6e68;
  --color-chart-4: #97505f;
  --color-chart-5: #8a6a15;
  --color-chart-6: #625cc0;
  --color-chart-7: #7a5f8c;
  --color-chart-neutral: #8b939b;

  --color-primary-hover-border: #7b74d6;
  --color-disabled-surface: #f0f0ed;
  --color-disabled-input: #f2f2ef;

  --shadow-tooltip: 0 4px 14px rgb(0 0 0 / 12%);
  --shadow-dropdown: 0 6px 20px rgb(0 0 0 / 18%);

  color-scheme: light;
}
```

- [ ] **Step 2: Scrivere i semantici indipendenti dal tema**

Create `apps/frontend/src/app/shared/styles/_semantic.scss`:

```scss
/*
 * I token che non dipendono dal tema (DESIGN_SYSTEM.md §3: al cambio tema
 * cambiano solo i colori, mai geometria o tipografia).
 *
 * E' l'unico file in cui e' ammesso scrivere un `border-radius` numerico.
 */
:root {
  --font-ui: 'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, 'Cascadia Mono', monospace;

  /* La scala di design-tokens.json: [2,4,6,8,12,16,20,24,32,40]. */
  --space-1: 2px;
  --space-2: 4px;
  --space-3: 6px;
  --space-4: 8px;
  --space-5: 12px;
  --space-6: 16px;
  --space-7: 20px;
  --space-8: 24px;
  --space-9: 32px;
  --space-10: 40px;

  /* Un raggio per categoria di elemento, non uno per dimensione. */
  --radius-badge: 4px;
  --radius-control: 6px;
  --radius-input: 7px;
  --radius-button: 7px;
  --radius-card: 10px;
  /* Riservato a tag e filtri: mai come default di bottoni o card. */
  --radius-pill: 999px;

  /* DESIGN_SYSTEM.md: sempre 1px, mai 0 ne' piu' di 1. */
  --border-width: 1px;
}
```

- [ ] **Step 3: Scrivere il ponte degli alias**

Create `apps/frontend/src/app/shared/styles/_legacy-aliases.scss`:

```scss
/*
 * Ponte temporaneo fra i nomi di token precedenti e quelli del design system.
 *
 * Esiste solo per non dover riscrivere in un unico commit i 40+ file di
 * feature che usano ancora i nomi vecchi. Ogni fase successiva, aprendo un
 * file per altri motivi, ne sostituisce i riferimenti e cancella da qui le
 * righe rimaste senza utilizzatori.
 *
 * QUANDO QUESTO FILE E' VUOTO, LA MIGRAZIONE DEI TOKEN E' COMPLETA: e' il
 * criterio di uscita della Fase 7, e non richiede alcun giudizio.
 */
:root {
  --background: var(--color-background);
  --surface: var(--color-surface);
  --border: var(--color-border);
  --text: var(--color-text-primary);
  --text-muted: var(--color-text-muted);
  --accent: var(--color-primary);
  --accent-text: var(--color-on-primary);
  --on-accent: var(--color-on-primary);
  --negative: var(--color-expense);
  --positive: var(--color-income);

  /*
   * Le tre serie del grafico. La mappatura conserva le relazioni di tinta
   * gia' verificate contro la deuteranopia (blu / caldo / acqua): il verde e
   * il rosso degli importi restano esclusi dalle linee.
   */
  --series-income: var(--color-chart-1);
  --series-expenses: var(--color-chart-5);
  --series-net: var(--color-chart-3);

  /* Geometria: i nomi di _tokens.scss, che questo file sostituisce. */
  --radius-panel: var(--radius-card);
  --space-panel: var(--space-7);
}
```

- [ ] **Step 4: Riscrivere `styles.scss`**

Sostituire l'intero contenuto di `apps/frontend/src/styles.scss` con:

```scss
@use 'app/shared/styles/fonts';
@use 'app/shared/styles/semantic';
@use 'app/shared/styles/primitives';
@use 'app/shared/styles/legacy-aliases';

/*
 * Tema chiaro e modalita' notte.
 *
 * Il tema scuro non e' un'inversione di quello chiaro: ogni colore mantiene la
 * propria tinta e cambia solo luminosita', cosi' una categoria o uno stato
 * resta riconoscibile passando da un tema all'altro (DESIGN_SYSTEM.md §1).
 *
 * `data-theme` sull'elemento radice e' la scelta esplicita dell'utente; se non
 * ha scelto, l'attributo non c'e' e decide `prefers-color-scheme`.
 *
 * Qui si sostituisce solo la tabella dei colori: layout, spaziatura, raggi e
 * dimensioni sono identici nei due temi (§3).
 */
:root {
  @include primitives.light-palette;
}

:root[data-theme='dark'] {
  @include primitives.dark-palette;
}

@media (prefers-color-scheme: dark) {
  /* `:not` perche' la scelta esplicita del tema chiaro vince sul sistema. */
  :root:not([data-theme='light']) {
    @include primitives.dark-palette;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--color-background);
  color: var(--color-text-primary);
  font-family: var(--font-ui);
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.5;
}

button {
  font: inherit;
  padding: var(--space-4) var(--space-6);
  border: var(--border-width) solid transparent;
  border-radius: var(--radius-button);
  background: var(--color-primary);
  color: var(--color-on-primary);
  cursor: pointer;
}

button:disabled {
  background: var(--color-disabled-surface);
  border-color: var(--color-border);
  color: var(--color-disabled);
  cursor: not-allowed;
}

/*
 * Il testo che non deve allargare cio' che lo contiene.
 *
 * La applica la direttiva `appTruncate` (`app/core/truncate.ts`), che sul solo
 * testo tagliato aggiunge il tooltip col contenuto intero. Sta fra gli stili
 * globali perche' troncare non e' il problema di una schermata sola, e perche'
 * l'attributo di scoping di un componente non arriverebbe alla direttiva.
 */
.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 5: Eliminare il file di token precedente**

`_tokens.scss` definiva quattro token geometrici ora coperti da `_semantic.scss` e dagli alias.

```bash
git rm apps/frontend/src/app/shared/styles/_tokens.scss
grep -rn "styles/tokens" apps/frontend/src
```

Atteso dal `grep`: **zero righe**. Se ne compare una, sostituirla con `@use '../styles/semantic';`.

- [ ] **Step 6: Verificare**

```bash
npm run build:frontend && npm run test:frontend
```

Attesi: build verde, 232 test verdi.

```bash
grep -rn "#[0-9a-fA-F]\{3,8\}" apps/frontend/src --include=*.scss | grep -v _primitives
```

Atteso: **zero righe**. Se compare `categories-page.scss` con `var(--on-accent, #fff)`, rimuovere il fallback: l'alias `--on-accent` ora esiste sempre.

Poi `npm run dev:frontend` e aprire tutte e dieci le rotte (`/`, `/analytics`, `/transactions`, `/loans`, `/loans/new`, un `/loans/:id`, `/merchants`, `/categories`, `/import`, `/settings`) in entrambi i temi. Atteso: nessuna pagina illeggibile, nessun testo dello stesso colore del proprio sfondo.

> La spaziatura resta quella vecchia in questa fase: i `padding` in `rem` dei file di feature non sono ancora stati migrati. L'app appare più densa nel testo ma non ancora nei margini — è previsto, e si chiude nelle fasi 1-3.

- [ ] **Step 7: Misurare il contrasto del bottone primario in tema chiaro**

DESIGN_SYSTEM.md §8 segnala questo come l'unico valore non verificato della specifica. Nel browser, in tema chiaro, con un bottone primario sotto il puntatore:

```js
// In console, sullo sfondo hover #625CC0 con testo #0A0B0D
// Rapporto di contrasto atteso: calcolarlo e confrontarlo con 4.5
```

Usare un qualsiasi calcolatore di contrasto su `#0A0B0D` su `#625CC0`. Se il rapporto è **< 4.5:1**, il testo hover in tema chiaro usa `var(--color-on-primary)` invece del letterale scuro. Annotare il risultato nel messaggio di commit.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/app/shared/styles apps/frontend/src/styles.scss
git commit -m "feat(design): sostituisci lo strato di token con quello del design system

33 token di colore per tema piu' i tre valori che DESIGN_SYSTEM.md §8 marca
literal, la scala di spaziatura, i sei raggi e le due famiglie.

I nomi precedenti restano come alias in _legacy-aliases.scss: l'app cambia
palette senza toccare un solo file di feature, possibile solo perche' il
codice legge gia' tutti i colori da custom property. La cancellabilita' di
quel file e' il criterio di completamento della migrazione.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Scala tipografica

**Files:**
- Create: `apps/frontend/src/app/shared/styles/_typography.scss`
- Modify: `apps/frontend/src/app/shared/layout/section-header.scss`
- Modify: `apps/frontend/src/app/shared/ui/stat-card-grid.scss`

**Interfaces:**
- Consumes: `--font-ui` / `--font-mono` dal Task 2.
- Produces: il mixin `text($role)` con i nove ruoli della scala DS. Ogni file `.scss` dell'applicazione lo userà al posto di `font-size`.

- [ ] **Step 1: Scrivere il mixin**

Create `apps/frontend/src/app/shared/styles/_typography.scss`:

```scss
@use 'sass:map';

/*
 * I nove ruoli tipografici del design system (design-tokens.json →
 * typography.scale).
 *
 * Sono mixin e non custom property perche' ogni ruolo porta con se' tre o
 * cinque proprieta' insieme: spezzarle in quaranta variabili renderebbe
 * possibile usare la dimensione senza la famiglia, che e' precisamente
 * l'errore che la regola sui numeri finanziari (§4) vieta.
 *
 * E' l'unico file in cui e' ammesso scrivere un `font-size` letterale.
 */
$roles: (
  'display-kpi': (family: mono, size: 25px, weight: 600, spacing: -0.02em, tabular: true),
  'page-title': (family: ui, size: 15px, weight: 600, spacing: -0.01em),
  'section-title': (family: ui, size: 13px, weight: 600),
  'body': (family: ui, size: 12.5px, weight: 500),
  'secondary': (family: ui, size: 12px, weight: 400, color: text-secondary),
  'label': (family: ui, size: 10px, weight: 600, spacing: 0.08em, upper: true, color: text-muted),
  'caption': (family: ui, size: 11px, weight: 400, color: text-muted),
  'table-text': (family: ui, size: 12px, weight: 400, color: text-secondary),
  'financial-row': (family: mono, size: 12.5px, weight: 500, tabular: true)
);

@mixin text($role) {
  $spec: map.get($roles, $role);

  @if $spec == null {
    @error "Ruolo tipografico sconosciuto: #{$role}. Ammessi: #{map.keys($roles)}.";
  }

  font-family: var(--font-#{map.get($spec, family)});
  font-size: map.get($spec, size);
  font-weight: map.get($spec, weight);

  @if map.has-key($spec, spacing) {
    letter-spacing: map.get($spec, spacing);
  }
  @if map.has-key($spec, upper) {
    text-transform: uppercase;
  }
  @if map.has-key($spec, color) {
    color: var(--color-#{map.get($spec, color)});
  }
  @if map.has-key($spec, tabular) {
    font-variant-numeric: tabular-nums;
  }
}
```

- [ ] **Step 2: Verificare che un ruolo inesistente fallisca la build**

Aggiungere temporaneamente in fondo a `section-header.scss`:

```scss
.prova-ruolo-inesistente { @include typography.text('non-esiste'); }
```

Run: `npm run build:frontend`
Expected: **FAIL** con `Ruolo tipografico sconosciuto: non-esiste`. Rimuovere la riga di prova.

Questo è il passo che rende il mixin una rete e non solo una comodità: un refuso in un nome di ruolo ferma la build invece di produrre silenziosamente testo senza stile.

- [ ] **Step 3: Applicarlo ai due componenti shared che hanno dimensioni proprie**

In `apps/frontend/src/app/shared/layout/section-header.scss`, sostituire l'intero contenuto:

```scss
@use '../styles/typography';

.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-6);
  margin-bottom: var(--space-6);

  h2 {
    @include typography.text('section-title');

    margin: 0;
  }
}

.subtitle {
  @include typography.text('secondary');

  margin: var(--space-1) 0 0;
}
```

In `apps/frontend/src/app/shared/ui/stat-card-grid.scss`, sostituire l'intero contenuto:

```scss
@use '../styles/typography';

:host {
  display: block;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
  gap: var(--space-8);
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);

  .label {
    @include typography.text('label');
  }

  /*
   * Il KPI e' l'unico numero che puo' arrivare a 25px, ed e' il massimo che
   * DESIGN_SYSTEM.md §4 consente: la gerarchia fra i numeri si ottiene per
   * contrasto di colore, non aumentando la dimensione.
   */
  .value {
    @include typography.text('display-kpi');
  }

  .value.positive {
    color: var(--color-income);
  }

  .value.negative {
    color: var(--color-expense);
  }
}
```

- [ ] **Step 4: Verificare**

```bash
npm run build:frontend && npm run test:frontend
```

Attesi: build verde, 232 test verdi.

Nel browser, su `/` e `/analytics`: le etichette dei KPI sono in maiuscoletto spaziato, i valori in Geist Mono a 25px, i titoli di sezione a 13px.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/shared
git commit -m "feat(design): aggiungi la scala tipografica come mixin

Nove ruoli da design-tokens.json. Mixin e non custom property perche' ogni
ruolo porta famiglia, dimensione, peso e varianti insieme: separarli
renderebbe possibile prendere la dimensione senza la famiglia, che e'
l'errore che la regola sui numeri finanziari vieta.

Un ruolo inesistente ferma la build invece di produrre testo senza stile.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

# FASE 1 — Primitive condivise

Nuovo codice in `shared/`. Nessuna pagina viene ancora migrata.

---

### Task 4: `Amount`

Il componente più importante del piano: `formatAmount` è chiamato 44 volte in 13 template e ogni chiamante riscrive a mano allineamento, `tabular-nums` e classe di colore. Nessuno scrive la famiglia mono, e le entrate si distinguono dal solo colore — che DS §5 vieta.

**Files:**
- Create: `apps/frontend/src/app/shared/ui/amount.ts`
- Create: `apps/frontend/src/app/shared/ui/amount.html`
- Create: `apps/frontend/src/app/shared/ui/amount.scss`
- Create: `apps/frontend/src/app/shared/ui/amount.spec.ts`

**Interfaces:**
- Consumes: `formatAmount` da `core/format.ts`; il mixin `text` dal Task 3.
- Produces: `<app-amount [value]="n" [tone]="'auto'|'neutral'|'positive'|'negative'" [size]="'row'|'kpi'" />`. Selettore `app-amount`, classe esportata `Amount`. Usato dai Task 15 e da tutte le pagine delle fasi successive.

- [ ] **Step 1: Scrivere i test falliti**

Create `apps/frontend/src/app/shared/ui/amount.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Amount } from './amount';

describe('Amount', () => {
  let fixture: ComponentFixture<Amount>;

  const render = async (value: number, tone?: 'auto' | 'neutral' | 'positive' | 'negative') => {
    fixture = TestBed.createComponent(Amount);
    fixture.componentRef.setInput('value', value);
    if (tone !== undefined) {
      fixture.componentRef.setInput('tone', tone);
    }
    await fixture.whenStable();
  };

  // Il componente non ha elemento interno: stile e testo stanno sull'host.
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => (el().textContent ?? '').trim();

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Amount] }).compileComponents();
  });

  it('antepone il segno piu a un importo positivo', async () => {
    await render(1647.3);

    expect(text().startsWith('+')).toBe(true);
    expect(el().classList.contains('positive')).toBe(true);
  });

  it('antepone il segno meno a un importo negativo', async () => {
    await render(-892.1);

    expect(text().startsWith('−')).toBe(true);
    expect(el().classList.contains('negative')).toBe(true);
    // Il meno e' il nostro, non quello di Intl: un solo segno, non due.
    expect(text()).not.toContain('-');
  });

  it('non aggiunge alcun segno a un importo neutro', async () => {
    await render(1200, 'neutral');

    expect(text().startsWith('+')).toBe(false);
    expect(el().classList.contains('positive')).toBe(false);
    expect(el().classList.contains('negative')).toBe(false);
  });

  // Review Focus 1: uno zero non e' ne' entrata ne' uscita.
  it('non aggiunge segno ne colore a un importo pari a zero', async () => {
    await render(0);

    expect(text().startsWith('+')).toBe(false);
    expect(text().startsWith('−')).toBe(false);
    expect(el().classList.contains('positive')).toBe(false);
    expect(el().classList.contains('negative')).toBe(false);
  });

  it('rispetta un tono imposto dall esterno', async () => {
    await render(1500, 'negative');

    expect(el().classList.contains('negative')).toBe(true);
    expect(text().startsWith('−')).toBe(true);
  });
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `npm test --prefix apps/frontend -- --watch=false amount`
Expected: FAIL — `Cannot find module './amount'`.

- [ ] **Step 3: Implementare**

Create `apps/frontend/src/app/shared/ui/amount.ts`:

```ts
import { Component, computed, input } from '@angular/core';
import { formatAmount } from '../../core/format';

/** Il tono: `auto` lo deduce dal segno del valore. */
export type AmountTone = 'auto' | 'neutral' | 'positive' | 'negative';

/**
 * Un valore finanziario.
 *
 * Esiste per due regole del design system che nessun token puo' far
 * rispettare, perche' riguardano il modo di rendere un valore e non un colore:
 *
 * - §4: ogni importo usa la famiglia mono con `tabular-nums`, cosi' le cifre
 *   restano allineate in colonna;
 * - §5: entrata e uscita non si distinguono MAI dal solo colore, quindi il
 *   segno e' sempre esplicito.
 *
 * Il segno lo scriviamo noi sul valore assoluto invece di lasciarlo a `Intl`:
 * serve il piu' sulle entrate, che `Intl` non mette, e serve un solo carattere
 * di meno anziche' due quando il tono e' negativo.
 *
 * Lo stile sta sull'host e non su uno `<span>` interno: chi la usa applica le
 * proprie classi direttamente sul tag (`<app-amount class="value">`), e con un
 * elemento interno quelle classi non governerebbero nulla.
 */
@Component({
  selector: 'app-amount',
  templateUrl: './amount.html',
  styleUrl: './amount.scss',
  host: {
    class: 'amount',
    '[class.positive]': "resolvedTone() === 'positive'",
    '[class.negative]': "resolvedTone() === 'negative'",
    '[class.neutral]': "resolvedTone() === 'neutral'",
    '[class.kpi]': "size() === 'kpi'",
    '[class.row]': "size() === 'row'"
  }
})
export class Amount {
  readonly value = input.required<number>();
  readonly tone = input<AmountTone>('auto');
  readonly size = input<'row' | 'kpi'>('row');

  /**
   * Il tono effettivo.
   *
   * Uno zero resta neutro anche in `auto`: non e' ne' un'entrata ne' un'uscita,
   * e `+0,00 €` non vorrebbe dire niente.
   */
  protected readonly resolvedTone = computed<Exclude<AmountTone, 'auto'>>(() => {
    const tone = this.tone();
    if (tone !== 'auto') {
      return tone;
    }

    const value = this.value();

    return value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
  });

  protected readonly text = computed(() => {
    const value = this.value();

    if (this.resolvedTone() === 'neutral' || value === 0) {
      return formatAmount(value);
    }

    // U+2212 MINUS SIGN: e' il meno tipografico, non il trattino.
    return `${value < 0 ? '−' : '+'}${formatAmount(Math.abs(value))}`;
  });
}
```

Create `apps/frontend/src/app/shared/ui/amount.html` — una riga sola, perché il testo sta direttamente sull'host:

```html
{{ text() }}
```

Create `apps/frontend/src/app/shared/ui/amount.scss`:

```scss
@use '../styles/typography';

:host {
  display: inline;
  white-space: nowrap;
}

:host(.row) {
  @include typography.text('financial-row');
}

/* Il massimo consentito da DESIGN_SYSTEM.md §4: nessun numero supera 25px. */
:host(.kpi) {
  @include typography.text('display-kpi');
}

:host(.positive) {
  color: var(--color-income);
}

:host(.negative) {
  color: var(--color-expense);
}

:host(.neutral) {
  color: var(--color-text-primary);
}
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

Run: `npm test --prefix apps/frontend -- --watch=false amount`
Expected: PASS, 5 test.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/shared/ui/amount.ts apps/frontend/src/app/shared/ui/amount.html apps/frontend/src/app/shared/ui/amount.scss apps/frontend/src/app/shared/ui/amount.spec.ts
git commit -m "feat(shared): aggiungi il componente Amount

Rende un valore finanziario secondo le due regole del design system che
nessun token puo' far rispettare: famiglia mono con tabular-nums (§4) e
segno sempre esplicito, perche' entrata e uscita non si distinguono mai dal
solo colore (§5).

Uno zero resta neutro: non e' ne' entrata ne' uscita.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `FilterGroup`

**Files:**
- Create: `apps/frontend/src/app/shared/ui/filter-group.ts`
- Create: `apps/frontend/src/app/shared/ui/filter-group.html`
- Create: `apps/frontend/src/app/shared/ui/filter-group.scss`
- Create: `apps/frontend/src/app/shared/ui/filter-group.spec.ts`

**Interfaces:**
- Consumes: il mixin `text` dal Task 3.
- Produces: `<app-filter-group label="Periodo"><!-- controllo --></app-filter-group>`. Selettore `app-filter-group`, classe `FilterGroup`. Usato dal Task 13 e dalle toolbox delle fasi successive.

- [ ] **Step 1: Scrivere i test falliti**

Create `apps/frontend/src/app/shared/ui/filter-group.spec.ts`:

```ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FilterGroup } from './filter-group';

@Component({
  imports: [FilterGroup],
  template: `<app-filter-group label="Periodo"><button>ultimi 30 giorni</button></app-filter-group>`
})
class Ospite {}

describe('FilterGroup', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Ospite] }).compileComponents();
  });

  it('mostra l etichetta e proietta il controllo', async () => {
    const fixture = TestBed.createComponent(Ospite);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.label')?.textContent?.trim()).toBe('Periodo');
    expect(host.querySelector('button')?.textContent?.trim()).toBe('ultimi 30 giorni');
  });
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `npm test --prefix apps/frontend -- --watch=false filter-group`
Expected: FAIL — `Cannot find module './filter-group'`.

- [ ] **Step 3: Implementare**

Create `apps/frontend/src/app/shared/ui/filter-group.ts`:

```ts
import { Component, input } from '@angular/core';

/**
 * Un criterio nella toolbox: etichetta piu' il controllo che lo governa.
 *
 * E' il mattone che rende le toolbox identiche fra viste, come
 * DESIGN_SYSTEM.md §6 richiede: cambia il contenuto, non la forma. Oggi lo
 * stesso concetto esiste in tre forme diverse (un `h3` in Analytics, un
 * `<details>` in Movimenti, niente affatto in Dashboard).
 *
 * Non sa cosa sia il controllo che contiene: lo proietta e basta.
 */
@Component({
  selector: 'app-filter-group',
  templateUrl: './filter-group.html',
  styleUrl: './filter-group.scss'
})
export class FilterGroup {
  readonly label = input.required<string>();
}
```

Create `apps/frontend/src/app/shared/ui/filter-group.html`:

```html
<div class="filter-group">
  <p class="label">{{ label() }}</p>
  <ng-content />
</div>
```

Create `apps/frontend/src/app/shared/ui/filter-group.scss`:

```scss
@use '../styles/typography';

:host {
  display: block;
}

.filter-group + .filter-group,
:host + :host .filter-group {
  margin-top: var(--space-7);
}

.label {
  @include typography.text('label');

  margin: 0 0 var(--space-3);
}
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

Run: `npm test --prefix apps/frontend -- --watch=false filter-group`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/shared/ui/filter-group.*
git commit -m "feat(shared): aggiungi FilterGroup

Il mattone che rende le toolbox identiche fra viste: etichetta piu'
controllo proiettato. Oggi lo stesso concetto esiste in tre forme diverse.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `SortableHeader`

**Files:**
- Create: `apps/frontend/src/app/shared/ui/sortable-header.ts`
- Create: `apps/frontend/src/app/shared/ui/sortable-header.html`
- Create: `apps/frontend/src/app/shared/ui/sortable-header.scss`
- Create: `apps/frontend/src/app/shared/ui/sortable-header.spec.ts`

**Interfaces:**
- Consumes: il mixin `text` dal Task 3.
- Produces: `<th appSortableHeader …>` — **no**: è un componente con selettore di attributo su `th`. Firma: `<th app-sortable-header [label]="'Data'" [active]="true" [direction]="'asc'" (sorted)="…" />`. Classe `SortableHeader`. Usato dalle tabelle delle fasi successive.

- [ ] **Step 1: Scrivere i test falliti**

Create `apps/frontend/src/app/shared/ui/sortable-header.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SortableHeader } from './sortable-header';

describe('SortableHeader', () => {
  let fixture: ComponentFixture<SortableHeader>;

  const render = async (active: boolean, direction: 'asc' | 'desc' = 'asc') => {
    fixture = TestBed.createComponent(SortableHeader);
    fixture.componentRef.setInput('label', 'Data');
    fixture.componentRef.setInput('active', active);
    fixture.componentRef.setInput('direction', direction);
    await fixture.whenStable();
  };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SortableHeader] }).compileComponents();
  });

  // Review Focus 5: una colonna non ordinata dichiara `none`, non tace.
  it('dichiara aria-sort none quando non e la colonna attiva', async () => {
    await render(false);

    expect(host().getAttribute('aria-sort')).toBe('none');
  });

  it('dichiara la direzione quando e la colonna attiva', async () => {
    await render(true, 'asc');
    expect(host().getAttribute('aria-sort')).toBe('ascending');

    await render(true, 'desc');
    expect(host().getAttribute('aria-sort')).toBe('descending');
  });

  it('emette sorted al clic', async () => {
    await render(false);

    let emesso = 0;
    fixture.componentInstance.sorted.subscribe(() => (emesso += 1));
    host().querySelector('button')?.click();

    expect(emesso).toBe(1);
  });
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `npm test --prefix apps/frontend -- --watch=false sortable-header`
Expected: FAIL — `Cannot find module './sortable-header'`.

- [ ] **Step 3: Implementare**

Create `apps/frontend/src/app/shared/ui/sortable-header.ts`:

```ts
import { Component, computed, input, output } from '@angular/core';

/**
 * L'intestazione ordinabile di una colonna.
 *
 * Il selettore e' `th[app-sortable-header]` perche' una cella d'intestazione
 * deve restare un `<th>` nel DOM della tabella: avvolgerla in un elemento
 * custom romperebbe la relazione fra intestazione e celle su cui si reggono
 * gli screen reader.
 *
 * `aria-sort` vale sempre qualcosa, anche `none`: una colonna che tace non
 * dice "non ordinata", dice "non ordinabile".
 */
@Component({
  selector: 'th[app-sortable-header]',
  templateUrl: './sortable-header.html',
  styleUrl: './sortable-header.scss',
  host: {
    scope: 'col',
    '[attr.aria-sort]': 'ariaSort()'
  }
})
export class SortableHeader {
  readonly label = input.required<string>();
  readonly active = input.required<boolean>();
  readonly direction = input<'asc' | 'desc'>('asc');

  readonly sorted = output<void>();

  protected readonly ariaSort = computed(() => {
    if (!this.active()) {
      return 'none';
    }

    return this.direction() === 'asc' ? 'ascending' : 'descending';
  });
}
```

Create `apps/frontend/src/app/shared/ui/sortable-header.html`:

```html
<button type="button" class="sort" (click)="sorted.emit()">
  {{ label() }}
  @if (active()) {
    <span class="arrow" aria-hidden="true">{{ direction() === 'asc' ? '↑' : '↓' }}</span>
  }
</button>
```

Create `apps/frontend/src/app/shared/ui/sortable-header.scss`:

```scss
@use '../styles/typography';

.sort {
  @include typography.text('label');

  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;

  &:hover {
    color: var(--color-text-primary);
  }

  &:focus-visible {
    outline: var(--border-width) solid var(--color-primary);
    outline-offset: 2px;
  }
}

.arrow {
  color: var(--color-primary);
}
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

Run: `npm test --prefix apps/frontend -- --watch=false sortable-header`
Expected: PASS, 3 test.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/shared/ui/sortable-header.*
git commit -m "feat(shared): aggiungi SortableHeader

Selettore di attributo su th: la cella deve restare un th nel DOM della
tabella, altrimenti si rompe la relazione intestazione/celle su cui si
reggono gli screen reader.

aria-sort vale sempre qualcosa, anche none: una colonna che tace non dice
non ordinata, dice non ordinabile.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `SectionHeader` con due livelli

**Files:**
- Modify: `apps/frontend/src/app/shared/layout/section-header.ts`
- Modify: `apps/frontend/src/app/shared/layout/section-header.html`
- Modify: `apps/frontend/src/app/shared/layout/section-header.scss`
- Create: `apps/frontend/src/app/shared/layout/section-header.spec.ts`

**Interfaces:**
- Consumes: il mixin `text` dal Task 3.
- Produces: `<app-section-header title="…" [subtitle]="…" [level]="'page'|'section'">` — `level` è nuovo, default `'section'`, quindi i nove usi esistenti non cambiano. Con `level="page"` rende un `<h1>`, con `section` un `<h2>`.

- [ ] **Step 1: Scrivere i test falliti**

Create `apps/frontend/src/app/shared/layout/section-header.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SectionHeader } from './section-header';

describe('SectionHeader', () => {
  let fixture: ComponentFixture<SectionHeader>;

  const render = async (level?: 'page' | 'section') => {
    fixture = TestBed.createComponent(SectionHeader);
    fixture.componentRef.setInput('title', 'Analytics');
    if (level !== undefined) {
      fixture.componentRef.setInput('level', level);
    }
    await fixture.whenStable();
  };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SectionHeader] }).compileComponents();
  });

  it('rende un h2 per default, senza cambiare i nove usi esistenti', async () => {
    await render();

    expect(host().querySelector('h2')?.textContent?.trim()).toBe('Analytics');
    expect(host().querySelector('h1')).toBeNull();
  });

  it('rende un h1 quando e il titolo della pagina', async () => {
    await render('page');

    expect(host().querySelector('h1')?.textContent?.trim()).toBe('Analytics');
    expect(host().querySelector('h2')).toBeNull();
  });
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `npm test --prefix apps/frontend -- --watch=false section-header`
Expected: FAIL sul secondo test — nessun `h1` è reso.

- [ ] **Step 3: Implementare**

In `section-header.ts`, aggiungere l'input dopo `subtitle`:

```ts
  /**
   * Il livello del titolo.
   *
   * Non e' solo tipografia: DESIGN_SYSTEM.md distingue `page-title` (15px) da
   * `section-title` (13px), e la pagina deve avere un `h1` solo. Il default
   * resta `section`, cosi' i nove usi esistenti non cambiano.
   */
  readonly level = input<'page' | 'section'>('section');
```

Sostituire l'intero `section-header.html`:

```html
<div class="section-header" [class]="level()">
  <div>
    @if (level() === 'page') {
      <h1>{{ title() }}</h1>
    } @else {
      <h2>{{ title() }}</h2>
    }
    @if (subtitle(); as text) {
      <p class="subtitle">{{ text }}</p>
    }
  </div>
  <div class="actions">
    <ng-content select="[panelActions]" />
  </div>
</div>
```

Sostituire l'intero `section-header.scss`:

```scss
@use '../styles/typography';

.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-6);
  margin-bottom: var(--space-6);

  h1 {
    @include typography.text('page-title');

    margin: 0;
  }

  h2 {
    @include typography.text('section-title');

    margin: 0;
  }
}

.subtitle {
  @include typography.text('secondary');

  margin: var(--space-1) 0 0;
}
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

Run: `npm test --prefix apps/frontend -- --watch=false section-header`
Expected: PASS, 2 test.

```bash
npm run build:frontend && npm run test:frontend
```

Attesi: build verde, **243** test verdi. I nove usi esistenti non passano `level`, quindi restano `h2`.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/shared/layout/section-header.*
git commit -m "feat(shared): aggiungi il livello del titolo a SectionHeader

Il design system distingue page-title (15px) da section-title (13px), e la
pagina deve avere un h1 solo. Default section: i nove usi esistenti non
cambiano.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Semplificare `SearchInput` e spostare `StatCardGrid`

**Files:**
- Modify: `apps/frontend/src/app/shared/ui/search-input.html`
- Modify: `apps/frontend/src/app/shared/ui/search-input.ts`
- Modify: `apps/frontend/src/app/shared/ui/search-input.scss`
- Modify: `apps/frontend/src/app/features/transactions/transactions-toolbar.html` (rimuove `[icon]="true"`)
- Move: `apps/frontend/src/app/shared/ui/stat-card-grid.*` → `apps/frontend/src/app/shared/layout/stat-card-grid.*`
- Modify: i quattro file che importano `StatCardGrid`

**Interfaces:**
- Consumes: il mixin `text` dal Task 3.
- Produces: `SearchInput` senza l'input `icon` (l'icona è sempre presente). `StatCardGrid` importabile da `../../shared/layout/stat-card-grid`.

- [ ] **Step 1: Togliere il ramo dell'icona**

In `search-input.ts`, eliminare la riga `readonly icon = input(false);`.

Sostituire l'intero `search-input.html`:

```html
<label class="search">
  <span class="icon" aria-hidden="true">🔎</span>
  <input
    type="search"
    [placeholder]="placeholder()"
    [attr.aria-label]="ariaLabel() ?? null"
    [value]="value()"
    (input)="valueChange.emit($any($event.target).value)"
  />
</label>
```

Sostituire l'intero `search-input.scss`:

```scss
@use '../styles/typography';

:host {
  display: block;
}

.search {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-input);
  background: var(--color-surface);

  &:hover {
    border-color: var(--color-border-strong);
    background: var(--color-surface-elevated);
  }

  &:focus-within {
    border-color: var(--color-primary);
    background: var(--color-surface-elevated);
    box-shadow: 0 0 0 3px var(--color-focus-ring);
  }
}

.icon {
  color: var(--color-text-muted);
}

input {
  @include typography.text('body');

  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-text-primary);
  outline: none;
}
```

- [ ] **Step 2: Rimuovere l'unico passaggio di `[icon]`**

```bash
grep -rn "\[icon\]" apps/frontend/src
```

Atteso: una sola riga, in `transactions-toolbar.html`. Eliminarla dal tag `<app-search-input>`.

Rieseguire il `grep`: atteso **zero righe**.

- [ ] **Step 3: Spostare `StatCardGrid`**

È una griglia senza interazione: appartiene a `layout/`, non a `ui/`.

```bash
cd apps/frontend/src/app/shared
git mv ui/stat-card-grid.ts layout/stat-card-grid.ts
git mv ui/stat-card-grid.html layout/stat-card-grid.html
git mv ui/stat-card-grid.scss layout/stat-card-grid.scss
cd -
grep -rln "ui/stat-card-grid" apps/frontend/src
```

Il `grep` elenca i file da correggere. In ciascuno sostituire `shared/ui/stat-card-grid` con `shared/layout/stat-card-grid`:

```bash
grep -rl "ui/stat-card-grid" apps/frontend/src | xargs sed -i "s|shared/ui/stat-card-grid|shared/layout/stat-card-grid|g"
grep -rn "ui/stat-card-grid" apps/frontend/src
```

Atteso dal secondo `grep`: **zero righe**.

Nel file spostato, correggere il percorso del `@use` in `stat-card-grid.scss`: resta `@use '../styles/typography';` perché `layout/` e `ui/` sono allo stesso livello.

- [ ] **Step 4: Verificare**

```bash
npm run build:frontend && npm run test:frontend
```

Attesi: build verde, 243 test verdi.

Nel browser, su `/transactions` e `/merchants`: il campo di ricerca ha l'icona e il bordo cambia al passaggio del puntatore e al focus.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src
git commit -m "refactor(shared): semplifica SearchInput e sposta StatCardGrid

Con il design system l'icona del campo di ricerca e' standard: il flag
duplicava l'intero template in un if/else per un solo chiamante.

StatCardGrid e' una griglia senza interazione: appartiene a layout/.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Utility globali e mixin delle tabelle

**Files:**
- Modify: `apps/frontend/src/styles.scss`
- Modify: `apps/frontend/src/app/shared/styles/_mixins.scss`

**Interfaces:**
- Consumes: i token dei Task 2 e 3.
- Produces: le classi globali `.message` (con `--error`/`--warning`/`--done`/`--hint`), `.sr-only`, `.breadcrumb`; il mixin `data-table`. Le fasi successive li useranno al posto delle 23 + 2 + 2 duplicazioni attuali.

- [ ] **Step 1: Aggiungere le utility globali**

Prima cosa, aggiungere `typography` al **blocco `@use` in cima** a `apps/frontend/src/styles.scss`, accanto agli altri quattro. In Sass le regole `@use` devono precedere qualsiasi altra regola del file: metterla in fondo fa fallire la build con `@use rules must be written before any other rules`.

```scss
@use 'app/shared/styles/fonts';
@use 'app/shared/styles/semantic';
@use 'app/shared/styles/primitives';
@use 'app/shared/styles/typography';
@use 'app/shared/styles/legacy-aliases';
```

Poi aggiungere **in fondo** allo stesso file le regole:

```scss
/*
 * Messaggio di stato inline.
 *
 * Zero logica, quindi zero motivo per un componente Angular: e' una classe,
 * come `.truncate`. Oggi lo stesso CSS e' ridefinito in ventitre' file, con
 * varianti che sono gia' divergenti fra loro.
 */
.message {
  @include typography.text('secondary');

  margin: 0;
}

.message--error {
  color: var(--color-error);
}

.message--warning {
  color: var(--color-warning);
}

.message--done {
  color: var(--color-income);
}

.message--hint {
  @include typography.text('caption');
}

/* Visibile agli screen reader, non agli occhi. */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.breadcrumb {
  @include typography.text('caption');

  margin: 0 0 var(--space-5);

  a {
    color: var(--color-text-secondary);
    text-decoration: none;
  }

  a:hover {
    color: var(--color-text-primary);
    text-decoration: underline;
  }
}

/*
 * Le tre varianti di bottone oltre al primario.
 *
 * design-tokens.json definisce solo `primaryButton` (lacuna §2.3 n.9 della
 * spec): queste sono derivate dai token semantici secondo la decisione presa
 * li'. Sono globali e non per-componente perche' le stesse tre classi sono
 * gia' scritte a mano in una ventina di punti.
 *
 * Gli stili di componente vincono per specificita' su queste regole globali,
 * quindi le definizioni locali esistenti continuano a funzionare finche' le
 * pagine non le cancellano, una alla volta.
 */
button.secondary {
  border-color: var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-primary);
}

button.secondary:hover {
  border-color: var(--color-border-strong);
  background: var(--color-surface-elevated);
}

button.ghost {
  border-color: transparent;
  background: transparent;
  color: var(--color-text-secondary);
}

button.ghost:hover {
  background: var(--color-surface-hover);
  color: var(--color-text-primary);
}

button.danger {
  border-color: var(--color-error);
  background: transparent;
  color: var(--color-error);
}

button.danger:hover {
  background: var(--color-error);
  color: var(--color-on-primary);
}

button:focus-visible {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-focus-ring);
  outline: none;
}
```

- [ ] **Step 2: Aggiungere il mixin delle tabelle**

In `apps/frontend/src/app/shared/styles/_mixins.scss`, aggiungere `@use 'typography';` come **prima riga del file**, prima del commento di intestazione esistente — stessa regola Sass dello step precedente. Poi aggiungere in fondo:

```scss
/*
 * L'involucro condiviso dalle cinque tabelle dell'applicazione.
 *
 * Solo l'involucro: le celle restano specifiche, perche' e' li' che le cinque
 * tabelle differiscono davvero (select in riga, link ai prestiti, campo di
 * rinomina, barra di avanzamento). Un `<app-data-table>` configurabile
 * abbastanza da coprirle tutte sarebbe il componente generico da evitare.
 *
 * Si applica al contenitore che avvolge la `<table>`.
 */
@mixin data-table {
  overflow-x: auto;

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th {
    @include typography.text('label');

    padding: var(--space-3) var(--space-4);
    text-align: left;
    border-bottom: var(--border-width) solid var(--color-border);
  }

  td {
    @include typography.text('table-text');

    padding: var(--space-4);
    border-bottom: var(--border-width) solid var(--color-row-divider);
  }

  tbody tr:hover {
    background: var(--color-surface-elevated);
  }

  /*
   * La riga selezionata porta anche una barra a sinistra: il solo cambio di
   * sfondo non basta a chi distingue male i colori.
   */
  tbody tr.selected {
    background: var(--color-primary-subtle);
    box-shadow: inset 2px 0 0 var(--color-primary);
  }

  /* I numeri stanno a destra e non allargano la colonna. */
  .numeric {
    text-align: right;
    white-space: nowrap;
  }
}
```

- [ ] **Step 3: Verificare**

```bash
npm run build:frontend && npm run test:frontend
```

Attesi: build verde, 243 test verdi. Nessuna pagina cambia aspetto: le utility sono definite ma non ancora usate — le adotteranno le pagine, una alla volta.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/styles.scss apps/frontend/src/app/shared/styles/_mixins.scss
git commit -m "feat(shared): aggiungi le utility globali e il mixin data-table

.message, .sr-only e .breadcrumb come classi e non come componenti: zero
logica, quindi zero beneficio da un wrapper Angular. Oggi sono duplicate in
ventitre', due e due file.

data-table condivide solo l'involucro: le celle restano specifiche, perche'
e' li' che le cinque tabelle differiscono davvero.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

# FASE 2 — Shell e impalcatura

---

### Task 10: `PageLayout`

**Files:**
- Create: `apps/frontend/src/app/shared/layout/page-layout.ts`
- Create: `apps/frontend/src/app/shared/layout/page-layout.html`
- Create: `apps/frontend/src/app/shared/layout/page-layout.scss`
- Create: `apps/frontend/src/app/shared/layout/page-layout.spec.ts`

**Interfaces:**
- Consumes: i token del Task 2.
- Produces: `<app-page-layout>` con contenuto principale di default e slot `[pageToolbox]` opzionale. Classe `PageLayout`. Usato dai Task 12, 14 e da tutte le pagine delle fasi successive.

- [ ] **Step 1: Scrivere i test falliti**

Create `apps/frontend/src/app/shared/layout/page-layout.spec.ts`:

```ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PageLayout } from './page-layout';

@Component({
  imports: [PageLayout],
  template: `<app-page-layout><p>dati</p></app-page-layout>`
})
class SenzaToolbox {}

@Component({
  imports: [PageLayout],
  template: `<app-page-layout>
    <p>dati</p>
    <aside pageToolbox><button>filtro</button></aside>
  </app-page-layout>`
})
class ConToolbox {}

describe('PageLayout', () => {
  const rendi = async (tipo: typeof SenzaToolbox | typeof ConToolbox) => {
    const fixture = TestBed.createComponent(tipo);
    await fixture.whenStable();

    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SenzaToolbox, ConToolbox] }).compileComponents();
  });

  it('mostra sempre il contenuto principale', async () => {
    const host = await rendi(SenzaToolbox);

    expect(host.querySelector('.main')?.textContent?.trim()).toBe('dati');
  });

  // Review Focus 2: una toolbox senza contenuto non deve riservare una colonna.
  it('lascia la colonna della toolbox vuota quando nessuno proietta', async () => {
    const host = await rendi(SenzaToolbox);
    const toolbox = host.querySelector('.toolbox') as HTMLElement;

    expect(toolbox.children.length).toBe(0);
  });

  it('accoglie il contenuto proiettato nella toolbox', async () => {
    const host = await rendi(ConToolbox);
    const toolbox = host.querySelector('.toolbox') as HTMLElement;

    expect(toolbox.children.length).toBe(1);
    expect(toolbox.querySelector('button')?.textContent?.trim()).toBe('filtro');
  });
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `npm test --prefix apps/frontend -- --watch=false page-layout`
Expected: FAIL — `Cannot find module './page-layout'`.

- [ ] **Step 3: Implementare**

Create `apps/frontend/src/app/shared/layout/page-layout.ts`:

```ts
import { Component } from '@angular/core';

/**
 * L'impalcatura di una pagina: la colonna dei dati piu' la toolbox laterale.
 *
 * La toolbox non ha un input che la accenda: c'e' se qualcuno ci proietta
 * qualcosa, e la griglia se ne accorge da sola con `:has`. Una pagina senza
 * filtri non dichiara nulla e non paga nulla.
 *
 * ATTENZIONE per chi la usa: l'attributo `pageToolbox` va messo sull'elemento
 * che esiste sempre. Metterlo su un contenitore il cui contenuto sta dietro un
 * `@if` falso lascerebbe comunque un figlio nella colonna, e la griglia
 * riserverebbe 300px per il nulla.
 */
@Component({
  selector: 'app-page-layout',
  templateUrl: './page-layout.html',
  styleUrl: './page-layout.scss'
})
export class PageLayout {}
```

Create `apps/frontend/src/app/shared/layout/page-layout.html`:

```html
<div class="page">
  <div class="main">
    <ng-content />
  </div>
  <div class="toolbox">
    <ng-content select="[pageToolbox]" />
  </div>
</div>
```

Create `apps/frontend/src/app/shared/layout/page-layout.scss`:

```scss
:host {
  display: block;
}

.page {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-8);
  align-items: start;
}

/*
 * La seconda colonna compare solo se qualcuno ha proiettato nella toolbox.
 * `minmax(0, 1fr)` e non `1fr`: senza il minimo a zero una tabella larga
 * allargherebbe la colonna invece di scorrere al proprio interno.
 */
.page:has(.toolbox > *) {
  grid-template-columns: minmax(0, 1fr) 18.75rem;
}

/*
 * Sotto i 1280px la toolbox non sparisce e non diventa collassabile: passa
 * sopra il contenuto, in riga. Nessun criterio diventa irraggiungibile a
 * nessuna larghezza.
 */
@media (width < 80rem) {
  .page:has(.toolbox > *) {
    grid-template-columns: minmax(0, 1fr);
  }

  .toolbox {
    order: -1;
  }
}
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

Run: `npm test --prefix apps/frontend -- --watch=false page-layout`
Expected: PASS, 3 test.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/shared/layout/page-layout.*
git commit -m "feat(shared): aggiungi PageLayout

Colonna dei dati piu' toolbox laterale opzionale. La toolbox non ha un input
che la accenda: c'e' se qualcuno ci proietta qualcosa, e la griglia se ne
accorge con :has. Una pagina senza filtri non dichiara e non paga nulla.

Sotto i 1280px la toolbox passa sopra il contenuto invece di sparire.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Shell a sidebar

**Files:**
- Modify: `apps/frontend/src/app/app.html`
- Modify: `apps/frontend/src/app/app.scss`
- Modify: `apps/frontend/src/app/app.spec.ts`

**Interfaces:**
- Consumes: i token dei Task 2 e 3.
- Produces: la shell a due colonne (sidebar + area contenuto) dentro cui ogni pagina viene resa. Nessuna API per le pagine.

- [ ] **Step 1: Leggere il test esistente della shell**

```bash
cat apps/frontend/src/app/app.spec.ts
```

Va mantenuto verde: se asserisce sul titolo `<h1>Personal Finance Tracker</h1>`, il passo 3 lo cambia in un elemento non-heading e il test va aggiornato di conseguenza nello Step 4.

- [ ] **Step 2: Scrivere il markup della shell**

Sostituire l'intero `apps/frontend/src/app/app.html`:

```html
<div class="shell">
  <nav class="sidebar" aria-label="Navigazione principale">
    <p class="brand">Saldo</p>

    <ul class="nav">
      <li><a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Riepilogo</a></li>
      <li><a routerLink="/analytics" routerLinkActive="active">Analytics</a></li>
      <li><a routerLink="/transactions" routerLinkActive="active">Movimenti</a></li>
      <li><a routerLink="/loans" routerLinkActive="active">Prestiti</a></li>
      <li><a routerLink="/merchants" routerLinkActive="active">Merchant</a></li>
      <li><a routerLink="/categories" routerLinkActive="active">Categorie</a></li>
      <li><a routerLink="/import" routerLinkActive="active">Import CSV</a></li>
      <li><a routerLink="/settings" routerLinkActive="active">Impostazioni</a></li>
    </ul>

    <button type="button" class="theme-toggle" (click)="toggleTheme()">
      <span class="glyph" aria-hidden="true">{{ theme() === 'dark' ? '☀' : '☾' }}</span>
      {{ themeAction() }}
    </button>
  </nav>

  <main class="content">
    <router-outlet />
  </main>
</div>
```

> `brand` è un `<p>` e non un `<h1>`: l'unico `h1` della pagina è il titolo della pagina, reso da `SectionHeader[level=page]` (Task 7).

- [ ] **Step 3: Scrivere lo stile della shell**

Sostituire l'intero `apps/frontend/src/app/app.scss`:

```scss
@use 'shared/styles/typography';

.shell {
  display: grid;
  grid-template-columns: 15rem minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-7) var(--space-5);
  border-right: var(--border-width) solid var(--color-border);
  background: var(--color-panel);
  /* Resta ferma mentre la colonna dei dati scorre. */
  position: sticky;
  top: 0;
  height: 100vh;
}

.brand {
  @include typography.text('page-title');

  margin: 0 var(--space-3);
  color: var(--color-text-primary);
}

/*
 * Review Focus 4: su viewport basso le otto voci piu' il toggle devono
 * restare tutte raggiungibili. La lista scorre, il toggle resta in fondo.
 */
.nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}

.nav a {
  @include typography.text('body');

  display: block;
  position: relative;
  padding: var(--space-4) var(--space-3);
  border-radius: var(--radius-control);
  color: var(--color-text-secondary);
  text-decoration: none;
}

.nav a:hover {
  background: var(--color-surface-hover);
  color: var(--color-text-primary);
}

/*
 * La voce attiva porta anche una barra a sinistra: lo sfondo tenue da solo
 * non basta a distinguerla (stessa formula di tableRow.selected).
 */
.nav a.active {
  background: var(--color-primary-subtle);
  box-shadow: inset 2px 0 0 var(--color-primary);
  color: var(--color-text-primary);
}

.nav a:focus-visible {
  outline: var(--border-width) solid var(--color-primary);
  outline-offset: -1px;
}

.theme-toggle {
  @include typography.text('secondary');

  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex: none;
  padding: var(--space-4) var(--space-3);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--color-text-secondary);

  &:hover {
    background: var(--color-surface-hover);
    color: var(--color-text-primary);
  }

  .glyph {
    font-size: 1rem;
    line-height: 1;
  }
}

.content {
  padding: var(--space-8);
  min-width: 0;
}

/*
 * Sotto i 900px la sidebar diventa una barra orizzontale scorrevole: una
 * colonna da 240px su uno schermo da 900 si mangerebbe un quarto dei dati.
 */
@media (width < 56.25rem) {
  .shell {
    grid-template-columns: minmax(0, 1fr);
  }

  .sidebar {
    position: static;
    height: auto;
    flex-direction: row;
    align-items: center;
    gap: var(--space-5);
    border-right: 0;
    border-bottom: var(--border-width) solid var(--color-border);
  }

  .nav {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
  }

  .nav a {
    white-space: nowrap;
  }

  .theme-toggle {
    margin-left: auto;
  }

  .content {
    padding: var(--space-6);
  }
}
```

> Il `font-size: 1rem` sul glifo è deliberato e non viola il vincolo: `1rem` non è un letterale di dimensione della scala, è "grande quanto il testo radice" per un simbolo decorativo. Se il controllo con `grep` lo segnala, sostituirlo con `font-size: 16px` in `_typography.scss` non avrebbe senso — annotarlo come eccezione unica.

- [ ] **Step 4: Aggiornare il test della shell**

Se `app.spec.ts` asserisce sul titolo, aggiornarlo:

```ts
  it('mostra il nome dell applicazione e le otto voci di navigazione', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.brand')?.textContent?.trim()).toBe('Saldo');
    expect(host.querySelectorAll('.nav a').length).toBe(8);
  });
```

- [ ] **Step 5: Verificare**

```bash
npm run build:frontend && npm run test:frontend
```

Attesi: build verde, 246 test verdi.

Nel browser:
1. Le otto voci sono raggiungibili con `Tab`, nell'ordine in cui compaiono.
2. La voce della pagina corrente è evidenziata con sfondo **e** barra laterale.
3. **Review Focus 4** — ridimensionare la finestra a 1280×720: tutte e otto le voci più il toggle restano raggiungibili (la lista scorre se serve).
4. A 800px di larghezza la navigazione diventa una barra orizzontale scorrevole.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/app/app.html apps/frontend/src/app/app.scss apps/frontend/src/app/app.spec.ts
git commit -m "feat(shell): sostituisci l'header orizzontale con la sidebar

Impalcatura di DESIGN_SYSTEM.md §6. Le otto voci stanno comode in verticale
mentre in orizzontale andavano gia' a capo.

Il nome dell'app non e' piu' un h1: l'unico h1 della pagina e' il titolo
della pagina. Sotto i 900px la sidebar torna una barra orizzontale.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Avvolgere le dieci pagine in `PageLayout`

**Files:**
- Modify: i dieci template di pagina e i rispettivi `.ts` (per l'import)

**Interfaces:**
- Consumes: `PageLayout` dal Task 10.
- Produces: ogni pagina resa dentro `<app-page-layout>`, a colonna singola. Nessuna toolbox è ancora popolata — lo farà il Task 14 per Analytics e le fasi successive per le altre.

- [ ] **Step 1: Elencare le pagine da modificare**

```bash
ls apps/frontend/src/app/features/*/*-page.html
```

Attesi dieci file: `analytics-page`, `categories-page`, `dashboard-page`, `import-page`, `loan-create-page`, `loan-detail-page`, `loans-page`, `merchants-page`, `settings-page`, `transactions-page`.

- [ ] **Step 2: Avvolgere il contenuto di ciascuna**

Per ogni pagina, avvolgere l'intero contenuto attuale del template:

```html
<app-page-layout>
  <!-- tutto il contenuto esistente, invariato -->
</app-page-layout>
```

E nel `.ts` corrispondente aggiungere l'import:

```ts
import { PageLayout } from '../../shared/layout/page-layout';
```

aggiungendo `PageLayout` all'array `imports` del decoratore `@Component`.

> Nessun'altra modifica in questo task: niente riordino, niente toolbox, niente sostituzione di classi. È deliberato — così la revisione di questo commit è "il contenuto è lo stesso, solo avvolto".

- [ ] **Step 3: Verificare**

```bash
npm run build:frontend && npm run test:frontend
```

Attesi: build verde, 246 test verdi.

```bash
grep -rLn "app-page-layout" apps/frontend/src/app/features/*/*-page.html
```

Atteso: **zero file elencati** (l'opzione `-L` elenca i file *senza* corrispondenza).

Nel browser, aprire tutte e dieci le rotte: ogni pagina mostra esattamente lo stesso contenuto di prima.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/app/features
git commit -m "refactor(pages): avvolgi le dieci pagine in PageLayout

Solo l'involucro: nessun riordino, nessuna toolbox, nessuna sostituzione di
classi, cosi' la revisione di questo commit e' 'il contenuto e' lo stesso'.

Le toolbox arrivano pagina per pagina a partire dal pilota Analytics.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

# FASE 3 — Pilota: Analytics

Stabilisce il pattern che ogni pagina delle fasi successive copierà.

---

### Task 13: I filtri di Analytics diventano una toolbox

**Files:**
- Move: `analytics-toolbar.{ts,html,scss}` → `analytics-filters.{ts,html,scss}`
- Modify: `apps/frontend/src/app/features/analytics/analytics-page.ts`

**Interfaces:**
- Consumes: `FilterGroup` (Task 5), `SectionHeader` (Task 7), `SearchInput` (Task 8), `Panel`, `SegmentedControl`, `ToggleButtonGroup`, `FilterChips`.
- Produces: `<app-analytics-filters [categories]="…" [merchants]="…" />`, classe `AnalyticsFilters`, pensata per essere proiettata nello slot `[pageToolbox]`. **`AnalyticsStore` non cambia di una riga.**

- [ ] **Step 1: Rinominare il componente**

```bash
cd apps/frontend/src/app/features/analytics
git mv analytics-toolbar.ts analytics-filters.ts
git mv analytics-toolbar.html analytics-filters.html
git mv analytics-toolbar.scss analytics-filters.scss
cd -
```

In `analytics-filters.ts`:
- rinominare la classe `AnalyticsToolbar` → `AnalyticsFilters`
- `selector: 'app-analytics-toolbar'` → `'app-analytics-filters'`
- `templateUrl`/`styleUrl` → `./analytics-filters.html` / `./analytics-filters.scss`

In `analytics-page.ts`: sostituire l'import e la voce in `imports`.

```bash
grep -rn "AnalyticsToolbar\|analytics-toolbar" apps/frontend/src
```

Atteso: **zero righe**.

- [ ] **Step 2: Eliminare il segnale `showFilters`**

In `analytics-filters.ts`, eliminare:

```ts
  /** I filtri sono aperti solo su richiesta: su schermi stretti occupano molto. */
  protected readonly showFilters = signal(false);
```

e rimuovere `signal` dall'import di `@angular/core` **solo se** non è più usato altrove nel file (`merchantSearch` lo usa, quindi resta).

> È il cuore del miglioramento: un filtro che vive in una colonna propria è sempre visibile, quindi non ha bisogno di essere mostrato. Sparisce anche il pulsante che lo mostrava.

- [ ] **Step 3: Riscrivere il template**

Sostituire l'intero `analytics-filters.html`:

```html
<app-panel>
  <app-section-header title="Filtri" />

  <app-filter-group label="Periodo">
    <app-segmented-control
      [options]="presets"
      [value]="store.preset()"
      ariaLabel="Periodo"
      (valueChange)="store.selectPreset($event)"
    />
    <div class="custom">
      <label>
        <span>Dal</span>
        <input
          type="date"
          [value]="store.dateRange().from ?? ''"
          (change)="onFromChange($any($event.target).value)"
        />
      </label>
      <label>
        <span>Al</span>
        <input
          type="date"
          [value]="store.dateRange().to ?? ''"
          (change)="onToChange($any($event.target).value)"
        />
      </label>
    </div>
    <p class="selected">{{ store.selectedPeriodLabel() }}</p>
  </app-filter-group>

  <app-filter-group label="Tipo di movimento">
    <app-toggle-button-group
      [options]="transactionTypeOptions"
      [value]="store.filters().types"
      (toggled)="store.toggleType($event)"
    />
  </app-filter-group>

  <app-filter-group label="Categoria">
    <app-toggle-button-group
      [options]="categoryOptions()"
      [value]="store.filters().categoryIds"
      (toggled)="store.toggleCategory($event)"
    />
  </app-filter-group>

  <app-filter-group label="Merchant">
    <app-search-input
      [value]="merchantSearch()"
      placeholder="Cerca un merchant…"
      ariaLabel="Cerca un merchant"
      (valueChange)="merchantSearch.set($event)"
    />
    @if (merchantOptions().length === 0) {
      <p class="message">Nessun merchant corrisponde alla ricerca.</p>
    } @else {
      <app-toggle-button-group
        [options]="merchantOptions()"
        [value]="store.filters().merchantIds"
        (toggled)="store.toggleMerchant($event)"
      />
    }
  </app-filter-group>

  <app-filter-group label="Classificazione">
    <app-segmented-control
      [options]="classifications"
      [value]="store.filters().classification"
      ariaLabel="Classificazione"
      (valueChange)="store.setClassification($event)"
    />
  </app-filter-group>

  @if (activeFilters().length > 0) {
    <app-filter-chips
      class="chips"
      [chips]="activeFilters()"
      (removed)="removeFilter($event)"
      (cleared)="store.resetFilters()"
    />
  }
</app-panel>
```

Aggiornare l'array `imports` in `analytics-filters.ts` aggiungendo `FilterGroup`:

```ts
import { FilterGroup } from '../../shared/ui/filter-group';
```

```ts
  imports: [
    FilterChips,
    FilterGroup,
    Panel,
    SearchInput,
    SectionHeader,
    SegmentedControl,
    ToggleButtonGroup
  ],
```

- [ ] **Step 4: Riscrivere lo stile**

Sostituire l'intero `analytics-filters.scss`:

```scss
@use '../../shared/styles/typography';

.custom {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-top: var(--space-5);

  label {
    @include typography.text('secondary');

    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  input {
    @include typography.text('body');

    padding: var(--space-3) var(--space-4);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-input);
    background: var(--color-surface);
    color: var(--color-text-primary);
  }

  input:hover {
    border-color: var(--color-border-strong);
    background: var(--color-surface-elevated);
  }

  input:focus {
    border-color: var(--color-primary);
    background: var(--color-surface-elevated);
    box-shadow: 0 0 0 3px var(--color-focus-ring);
    outline: none;
  }
}

.selected {
  @include typography.text('caption');

  margin: var(--space-3) 0 0;
}

app-search-input {
  margin-bottom: var(--space-3);
}

.message {
  @include typography.text('caption');

  margin: 0;
}

.chips {
  margin-top: var(--space-7);
  padding-top: var(--space-5);
  border-top: var(--border-width) solid var(--color-border);
}
```

- [ ] **Step 5: Verificare**

```bash
npm run build:frontend && npm run test:frontend
```

Attesi: build verde, 246 test verdi. `analytics.store.spec.ts` deve essere **invariato** e verde: nessuna logica di stato è stata toccata.

```bash
git diff --name-only HEAD | grep -E "\.(model|api|store|query)\.ts$"
```

Atteso: **zero righe**.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/app/features/analytics
git commit -m "feat(analytics): i filtri diventano una toolbox sempre visibile

I criteri stavano in una sezione collassabile in testa alla pagina: aprirla
spingeva ogni dato sotto la piega, e per cambiare un filtro si perdeva di
vista il grafico che si stava guardando.

Ora vivono in una colonna propria, quindi il segnale showFilters e il
pulsante che li mostrava non servono piu'.

AnalyticsStore non cambia di una riga.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: La pagina Analytics adotta l'impalcatura

**Files:**
- Modify: `apps/frontend/src/app/features/analytics/analytics-page.html`
- Modify: `apps/frontend/src/app/features/analytics/analytics-page.scss`
- Modify: `apps/frontend/src/app/features/analytics/analytics-page.ts`

**Interfaces:**
- Consumes: `PageLayout` (Task 10), `AnalyticsFilters` (Task 13), `SectionHeader[level=page]` (Task 7).
- Produces: il pattern di pagina che le fasi successive copieranno — titolo di pagina, dati nella colonna principale, criteri nella toolbox.

- [ ] **Step 1: Riscrivere il template**

Sostituire l'intero `analytics-page.html`:

```html
<app-page-layout>
  <app-section-header
    level="page"
    title="Analytics"
    subtitle="Come sono andate le mie finanze nel periodo che scelgo."
  />

  @if (error(); as message) {
    <app-panel>
      <p class="message message--error">{{ message }}</p>
    </app-panel>
  }

  @if (data(); as data) {
    <app-panel>
      <app-stat-card-grid [items]="kpis()" />
      @if (analytics.isLoading()) {
        <p class="message">Aggiornamento in corso…</p>
      }
    </app-panel>

    @if (isEmpty()) {
      <app-panel>
        <p class="message">Nessun dato disponibile per il periodo selezionato.</p>
        <p class="message message--hint">Prova ad allargare il periodo o a togliere qualche filtro.</p>
      </app-panel>
    } @else {
      <app-analytics-timeline
        [timeline]="data.timeline"
        [granularity]="store.granularity()"
        (granularitySelected)="store.setGranularity($event)"
      />

      <div class="columns">
        <app-analytics-categories
          [categories]="data.byCategory"
          (categorySelected)="onCategorySelected($event)"
        />
        <app-analytics-merchants
          [merchants]="data.byMerchant"
          (merchantSelected)="onMerchantSelected($event)"
        />
      </div>

      <app-analytics-loans
        [loans]="data.loans"
        [explorerParams]="explorerParams({ types: ['LOAN'] })"
      />

      <p class="explore">
        <a routerLink="/transactions" [queryParams]="explorerParams()">
          Vedi le {{ data.counts.transactions }} transazioni del periodo →
        </a>
      </p>
    }
  } @else if (analytics.isLoading()) {
    <app-panel>
      <p class="message">Caricamento in corso…</p>
    </app-panel>
  }

  <app-analytics-filters pageToolbox [categories]="categories()" [merchants]="merchants()" />
</app-page-layout>
```

> `pageToolbox` sta sul componente stesso, che esiste sempre: è la regola d'uso documentata nel commento di `PageLayout`. Metterlo su un `<div>` condizionale lascerebbe la colonna riservata anche da vuota.

- [ ] **Step 2: Aggiornare l'ordine degli import nel componente**

In `analytics-page.ts`, l'array `imports` diventa:

```ts
  imports: [
    AnalyticsCategories,
    AnalyticsFilters,
    AnalyticsLoans,
    AnalyticsMerchants,
    AnalyticsTimeline,
    PageLayout,
    Panel,
    RouterLink,
    SectionHeader,
    StatCardGrid
  ],
```

con gli import corrispondenti:

```ts
import { PageLayout } from '../../shared/layout/page-layout';
import { SectionHeader } from '../../shared/layout/section-header';
import { StatCardGrid } from '../../shared/layout/stat-card-grid';
```

- [ ] **Step 3: Ripulire lo stile della pagina**

Sostituire l'intero `analytics-page.scss`:

```scss
@use '../../shared/styles/typography';

/* Categorie e merchant affiancati: sono liste della stessa forma. */
.columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: var(--space-6);
}

/* Il passaggio dall'analisi all'elenco dei movimenti. */
.explore {
  @include typography.text('secondary');

  margin: 0 0 var(--space-6);
  text-align: right;

  a {
    color: var(--color-primary);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }
}
```

Le regole `.message`, `.message.error` e `.hint` sono state eliminate: ora vengono dalle utility globali del Task 9.

- [ ] **Step 4: Verificare**

```bash
npm run build:frontend && npm run test:frontend
```

Attesi: build verde, 246 test verdi.

Nel browser su `/analytics`, a 1440px:
1. I filtri stanno nella colonna destra, sempre visibili.
2. **Cambiare un filtro non sposta il grafico**: è il criterio di accettazione della Fase 3.
3. I KPI sono il primo dato che si incontra, subito sotto il titolo.
4. La pagina ha esattamente un `h1` (`document.querySelectorAll('h1').length` → `1`).
5. A 1100px la toolbox passa sopra il contenuto; a 800px la sidebar diventa orizzontale.

- [ ] **Step 5: Verificare il padding di `Panel`**

La spec (decisione aperta n. 9) propone 20px contro i 14px che il design system indica per l'interno delle card. Con Analytics ora completa, guardare i pannelli e decidere:

- se 20px regge, lasciare `--space-panel: var(--space-7)` in `_legacy-aliases.scss`;
- se 14px basta, cambiarlo in un valore della scala (non esiste 14px: la scala ha 12 e 16 — scegliere `--space-6` e annotarlo).

Annotare la decisione nel commit.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/app/features/analytics
git commit -m "feat(analytics): adotta l'impalcatura a due colonne

Titolo di pagina come unico h1, KPI come primo dato dopo il titolo, criteri
nella toolbox. E' il pattern che le pagine rimanenti copieranno.

Le classi .message locali sono sostituite dalle utility globali.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: `Amount` e token grafici nelle sezioni di Analytics

**Files:**
- Modify: `analytics-categories.{html,ts,scss}`
- Modify: `analytics-merchants.{html,ts,scss}`
- Modify: `analytics-loans.{html,ts,scss}`
- Modify: `analytics-timeline.scss`

**Interfaces:**
- Consumes: `Amount` (Task 4), il mixin `text` (Task 3), i token grafico (Task 2).
- Produces: nessuna nuova API. È l'ultimo task della fase: al termine Analytics non contiene più `formatAmount` nei template né `font-size` letterali.

- [ ] **Step 1: Sostituire `formatAmount` con `<app-amount>`**

```bash
grep -n "formatAmount" apps/frontend/src/app/features/analytics/*.html
```

In ciascuna occorrenza sostituire `{{ formatAmount(x) }}` con `<app-amount [value]="x" />`, scegliendo il tono:

- importi che sono **entrate o uscite** → nessun `tone` (il default `auto` deduce dal segno)
- totali e saldi che **non sono né l'una né l'altra** (es. l'importo di un prestito) → `[tone]="'neutral'"`

Esempio concreto, in `analytics-categories.html`:

```html
<!-- prima -->
<span class="amount">{{ formatAmount(category.total) }}</span>

<!-- dopo: e' una spesa, quindi il tono lo deduce dal segno -->
<app-amount class="amount" [value]="category.total" />
```

e in `analytics-loans.html`, dove l'importo prestato non è né entrata né uscita del periodo:

```html
<!-- prima -->
<span class="value">{{ formatAmount(loan.amount) }}</span>

<!-- dopo -->
<app-amount class="value" [value]="loan.amount" [tone]="'neutral'" />
```

Nei `.ts` corrispondenti: aggiungere `Amount` agli `imports`, e rimuovere `formatAmount` dagli import e dai membri `protected` **solo se** non è più usato nel `.ts` (alcuni lo usano per costruire stringhe, non per il template).

```ts
import { Amount } from '../../shared/ui/amount';
```

- [ ] **Step 2: Sostituire i `font-size` e i `tabular-nums` rimasti**

```bash
grep -n "font-size\|font-variant-numeric" apps/frontend/src/app/features/analytics/*.scss
```

Per ogni riga: sostituire con `@include typography.text('<ruolo>')`, aggiungendo `@use '../../shared/styles/typography';` in testa al file. I `font-variant-numeric` su elementi ora resi da `<app-amount>` si eliminano — il componente li porta con sé.

Scelta del ruolo: `label` per le etichette in maiuscoletto, `secondary` per i metadati, `caption` per le didascalie, `table-text` per le celle non numeriche, `section-title` per gli `h3`.

- [ ] **Step 3: Passare i token grafico alle serie**

In `analytics-timeline.scss`, sostituire l'intestazione del file:

```scss
/*
 * Colori delle serie.
 *
 * Sono i token grafico del design system, applicati senza una nuova verifica
 * per il daltonismo: e' una scelta esplicita, documentata come rischio
 * accettato nella spec (§12).
 *
 * La mappatura conserva le relazioni di tinta che la versione precedente
 * aveva verificato — blu, caldo, acqua — e tiene fuori dalle linee il verde e
 * il rosso degli importi, che in deuteranopia cadevano a DeltaE 4,2. Il
 * grafico continua a portare legenda e tabella valori, quindi il colore non e'
 * mai l'unico canale.
 */
```

I riferimenti `var(--series-#{$series})` restano invariati: gli alias del Task 2 li portano già sui token grafico corretti.

Sostituire nello stesso file la griglia e le etichette degli assi con i token DS: `stroke: var(--color-border)` per le linee di griglia, `fill: var(--color-text-muted)` per le etichette.

- [ ] **Step 4: Verificare**

```bash
npm run build:frontend && npm run test:frontend
```

Attesi: build verde, 246 test verdi — compreso `analytics-timeline.spec.ts`, che asserisce sulla struttura SVG e non sui colori.

```bash
grep -n "formatAmount" apps/frontend/src/app/features/analytics/*.html
grep -n "font-size" apps/frontend/src/app/features/analytics/*.scss
```

Attesi: **zero righe** da entrambi.

Nel browser su `/analytics`:
1. Ogni importo è in Geist Mono, allineato a destra, con il segno esplicito.
2. Le entrate mostrano `+`, le uscite `−`.
3. Le tre serie del grafico sono blu, ocra e acqua; legenda e tabella valori sono presenti.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/features/analytics
git commit -m "feat(analytics): adotta Amount e i token grafico

Ogni importo passa dal componente condiviso: mono, tabular-nums e segno
esplicito, quindi entrate e uscite non si distinguono piu' dal solo colore.

I colori delle serie sono i token del design system. La mappatura conserva
le relazioni di tinta gia' verificate contro la deuteranopia e tiene fuori
dalle linee il verde e il rosso degli importi.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Verifica di fine fase

**Files:** nessuno modificato, salvo correzioni emerse.

- [ ] **Step 1: Eseguire i cinque controlli meccanici**

```bash
cd /c/Users/stefa/Desktop/appConto

grep -rn "#[0-9a-fA-F]\{3,8\}" apps/frontend/src --include=*.scss | grep -v _primitives
grep -rn "font-size:" apps/frontend/src/app --include=*.scss | grep -v _typography
grep -rn "border-radius: *[0-9]" apps/frontend/src/app --include=*.scss | grep -v _semantic
grep -rn "features/" apps/frontend/src/app/shared
git diff --name-only master | grep -E "\.(model|api|store|query)\.ts$|apps/backend"
```

Attesi: **zero righe** da tutti e cinque, con **una sola eccezione ammessa** — il `font-size: 1rem` del glifo del tema in `app.scss`, documentata nel Task 11.

I file non ancora migrati (le nove pagine oltre Analytics) faranno emergere righe dal secondo e terzo controllo: è atteso in questa fase. Registrare il conteggio come punto di partenza del Piano 2.

```bash
grep -rc "font-size:" apps/frontend/src/app --include=*.scss | grep -v ":0" | awk -F: '{s+=$2} END {print "font-size residui:", s}'
```

- [ ] **Step 2: Eseguire build e test completi**

```bash
npm run build:frontend && npm run test:frontend
```

Attesi: build verde, 246 test verdi, budget `anyComponentStyle` non superato.

Registrare la dimensione del bundle: attesa intorno a 640 KB (497 di partenza più i font), comunque sotto il budget `initial` di 1 MB.

- [ ] **Step 3: Verifica visiva delle dieci rotte**

Con `npm run dev:frontend`, per ciascuna delle dieci rotte e in **entrambi i temi**:

- [ ] la pagina si apre e nessun testo è dello stesso colore del proprio sfondo
- [ ] la sidebar evidenzia la voce corrente
- [ ] non c'è scorrimento orizzontale della pagina
- [ ] a 1280, 1100 e 900px nessun contenuto diventa irraggiungibile

- [ ] **Step 4: Commit di eventuali correzioni**

Se i passi precedenti hanno richiesto correzioni:

```bash
git add apps/frontend/src
git commit -m "fix(design): correzioni emerse dalla verifica di fine Fase 3

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Stato al termine

- **Fatto**: token DS, tipografia, font, shell a sidebar, `PageLayout`, quattro primitive condivise, utility globali, Analytics interamente migrata.
- **Da fare (Piano 2, fasi 4-7)**: le nove pagine rimanenti, il responsive rifinito, la cancellazione di `_legacy-aliases.scss`.
- **Il Piano 2 si scrive dopo questo**, quando Analytics esiste come riferimento concreto da copiare invece che da immaginare.
