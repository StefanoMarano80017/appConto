# Migrazione al design system, fasi 4-7 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare le nove pagine non ancora migrate sul design system, fino a poter cancellare `_legacy-aliases.scss`.

**Architecture:** Prima si chiudono i buchi nei controlli automatici, perché ogni difetto che oggi il gate non vede verrebbe moltiplicato per nove dalle pagine successive. Poi si costruisce la rete che manca (un test che verifica la risoluzione dei token), poi si migra pagina per pagina riusando i componenti condivisi già esistenti, infine si cancella il ponte e si verifica che nulla lo stesse ancora leggendo.

**Tech Stack:** Angular 21 standalone/zoneless/signal-based, Sass con token CSS, Vitest + TestBed su jsdom, `@lucide/angular` per le icone.

**Spec:** `docs/superpowers/specs/2026-09-22-ui-ux-upgrade-design.md`

**Stato di partenza, misurato il 2026-09-28** (non stimato — rimisurare a fine piano con gli stessi comandi):

| Misura | Oggi | Obiettivo |
|---|---|---|
| Usi di alias legacy | **329** | 0 |
| `font-size` letterali fuori da `_typography.scss` | **86** | 0 |
| Raggi numerici fuori da `_semantic.scss` | **43** | 0 |
| Pannelli scritti a mano (`<section class="panel">`) | **7** | 0 |
| `class="message error"` (convenzione vecchia) | **12** in 10 file | 0 |
| Usi di `@mixin data-table` e `SortableHeader` | **0** | 5 tabelle, oppure cancellati |
| Test frontend | 309 | cresce |

I file più carichi, che sono anche i più rischiosi: `loan-detail-page.scss` (47 alias, 20 `font-size`), `loans-page.scss` (35, 8), `transactions-toolbar.scss` (23, 6), `categories-page.scss` (21), `merchants-page.scss` (20), `import-page.scss` (16, 8).

## Global Constraints

Copiati dalla specifica e dalle decisioni prese dall'utente. Valgono per ogni task senza essere ripetuti.

- **Non modificare la business logic.** Nessun cambiamento al comportamento: ordinamento, selezione, modifica in linea, invio dei moduli, errori restano identici.
- **Non modificare API o backend** salvo necessità reale e documentata. `git diff --name-only | grep -E "\.(model|api|store|query)\.ts$|apps/backend"` deve restituire zero righe a fine piano.
- **Non cambiare il modello dati.**
- **Nessuna libreria nuova** senza motivazione concreta. `@lucide/angular` è già presente ed è l'unica dipendenza non-Angular del frontend.
- **Niente interfaccia senza un dato dietro.** Decisione esplicita dell'utente: non si disegnano stati, badge o sezioni che nessun campo alimenta.
- **Mai un `font-size` letterale né un colore esadecimale** fuori da `_typography.scss` e `_primitives.scss`. Si usa `@include typography.text('<ruolo>')` e le custom property.
- **Nel codice toccato si usano i nomi nuovi** (`--color-surface`, `--color-text-muted`, `--color-border`), mai gli alias legacy: il ponte va restringendosi, non allargandosi.
- **Gli importi si rendono con `<app-amount>`**, mai formattandoli a mano: porta con sé mono, cifre tabulari e la regola del segno.
- **Un solo `<h1>` per rotta, e lo rende la shell** (`app.html`). Nessuna pagina ne aggiunge uno; `SectionHeader` rende sempre `h2`.
- **Preferire la composizione** e riusare i componenti condivisi esistenti invece di crearne di nuovi. Non creare componenti generici prematuramente né mega-componenti configurabili.
- **Italiano** per commenti, nomi dei test e testo dell'interfaccia. Apici singoli negli spec. I commenti spiegano il **perché**, non il cosa.
- **jsdom non fa layout**: nessuna misura geometrica è osservabile, `getBoundingClientRect()` vale zero. Non scrivere test che fingano di verificare posizionamento, scorrimento o eccedenza.

## Review Focus

Cinque modi di rompersi che la specifica implica ma che nessun test oggi esercita. Ogni riga ha il proprio test assegnato al task che possiede il codice.

1. **Un alias cancellato mentre un consumatore ne costruisce il nome per interpolazione Sass.** `var(--series-#{$series})` non viene trovato da nessun grep del nome completo; l'alias sparisce, il valore diventa vuoto, lo sfondo diventa trasparente e né il build né i test se ne accorgono. → Task 3.
2. **Un token definito nel tema chiaro e non in quello scuro** (o viceversa) dopo una rinomina. Il testo diventa invisibile solo in un tema, e la suite gira in uno solo. → Task 3.
3. **Una pagina migrata che riceve zero righe.** Convertendo pannelli scritti a mano in `<app-panel>` è facile spostare lo stato vuoto fuori dal ramo che lo rende, e lo si scopre solo con l'archivio vuoto. → Task 7, 9, 10, 11.
4. **Un importo a sei cifre o un nome di merchant molto lungo in una cella di tabella.** Le cinque tabelle hanno larghezze di colonna implicite; `<app-amount>` è `white-space: nowrap`. → Task 6.
5. **L'ordine di tabulazione dopo la conversione dei pannelli.** Sette `<section class="panel">` diventano `<app-panel>`, che introduce un elemento host fra il contenitore e il contenuto: l'ordine del DOM non deve cambiare. → Task 7.

---

## Fase 4 — le fondamenta

Nessuna pagina si apre prima che questa fase sia completa. Il motivo è aritmetico: i difetti esistono esattamente dove il gate non guarda, e nove pagine moltiplicano per nove tutto ciò che non vede.

### Task 1: i controlli di accettazione diventano uno script, e guardano dove non guardavano

I cinque grep della specifica §11 hanno due buchi dimostrati. Primo: puntano a `--include=*.scss` sotto `src/app`, quindi non vedono né il CSS scritto dentro un `styles:` inline in un `.ts` (`shared/ui/color-marker.ts` conteneva `border-radius: 0.15em` e nessuno se n'è accorto) né `src/styles.scss`. Secondo: non esiste un grep per le spaziature, ed è l'unica famiglia di token rimasta indietro.

**Files:**
- Create: `apps/frontend/scripts/design-system-gate.sh`
- Modify: `apps/frontend/package.json` (uno script `gate`)

**Interfaces:**
- Produces: `npm run gate --workspace apps/frontend` esce con codice 0 quando tutti i controlli passano, diverso da zero altrimenti, stampando quale controllo ha fallito e le righe colpevoli.

- [ ] **Step 1: scrivere lo script con i sei controlli**

```bash
#!/usr/bin/env bash
# Sei controlli oggettivi sul design system. Zero righe = passato.
#
# Il perimetro e' `src`, non `src/app`: fuori da `src/app` vivono
# `styles.scss` e i temi, che sono CSS a tutti gli effetti.
# Le estensioni includono `.ts`: un componente con `styles:` inline
# sfuggiva a tutti e cinque i controlli precedenti.
set -u
cd "$(dirname "$0")/.." || exit 2

fallimenti=0

verifica() {
  local nome="$1"; shift
  local righe
  righe="$("$@" 2>/dev/null)"
  if [ -n "$righe" ]; then
    printf '\n[FALLITO] %s\n%s\n' "$nome" "$righe"
    fallimenti=$((fallimenti + 1))
  else
    printf '[ok] %s\n' "$nome"
  fi
}

verifica 'nessun esadecimale fuori dai primitivi' \
  bash -c "grep -rn '#[0-9a-fA-F]\{3,8\}' src --include=*.scss --include=*.ts | grep -v _primitives"

verifica 'nessuna dimensione di carattere fuori dalla scala' \
  bash -c "grep -rn 'font-size:' src --include=*.scss --include=*.ts | grep -v _typography"

verifica 'nessun raggio numerico fuori dai semantici' \
  bash -c "grep -rnE 'border-radius: *[0-9]' src --include=*.scss --include=*.ts | grep -v _semantic"

verifica 'nessuna spaziatura letterale fuori dai semantici' \
  bash -c "grep -rnE '(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left))?: *[^v;]*[0-9](rem|px)' src --include=*.scss --include=*.ts | grep -vE '_semantic|: *0(rem|px)?;'"

verifica 'shared non conosce le feature' \
  bash -c "grep -rn 'features/' src/app/shared"

verifica 'dominio intatto' \
  bash -c "git -C ../.. diff --name-only | grep -E '\.(model|api|store|query)\.ts\$|apps/backend'"

printf '\n%s\n' "controlli falliti: $fallimenti"
[ "$fallimenti" -eq 0 ]
```

- [ ] **Step 2: eseguirlo e leggere quanto è rosso oggi**

Run: `bash apps/frontend/scripts/design-system-gate.sh`
Expected: **FALLITO** su almeno quattro controlli. Annotare il numero di righe per ciascuno: è la misura di partenza contro cui i task successivi si verificano. Non correggere niente adesso.

- [ ] **Step 3: aggiungere lo script a package.json**

In `apps/frontend/package.json`, dentro `scripts`:

```json
"gate": "bash scripts/design-system-gate.sh"
```

- [ ] **Step 4: verificare che sia invocabile**

Run: `npm run gate --workspace apps/frontend`
Expected: stessa uscita dello Step 2, codice di uscita diverso da zero.

- [ ] **Step 5: commit**

```bash
git add apps/frontend/scripts/design-system-gate.sh apps/frontend/package.json
git commit -m "chore(design-system): i controlli di accettazione diventano uno script e coprono anche i .ts"
```

---

### Task 2: il controllo delle spaziature passa, nello strato condiviso

Il controllo nuovo dello Task 1 è rosso soprattutto in `shared/ui`, dove convivono due convenzioni: metà dei componenti usa i token, metà scrive `rem`. Sei valori sono **fuori scala** e vanno decisi, non sostituiti meccanicamente.

**Files:**
- Modify: `shared/ui/badge.scss`, `empty-state.scss`, `error-retry.scss`, `filter-chips.scss`, `toggle-button-group.scss`, `choice-group.scss`, `search-input.scss`, `sortable-header.scss`

La scala semantica è: `--space-1: 2px`, `--space-2: 4px`, `--space-3: 6px`, `--space-4: 8px`, `--space-5: 12px`, `--space-6: 16px`, `--space-7: 20px`, `--space-8: 24px`.

- [ ] **Step 1: censire i valori fuori scala**

Run: `bash apps/frontend/scripts/design-system-gate.sh 2>&1 | grep -A100 'spaziatura letterale' | grep 'shared/'`

Per ciascun valore trovato, scrivere in una tabella: file, riga, valore attuale in px, token più vicino, differenza. I valori noti fuori scala sono `0.4375rem` (7px), `0.875rem` (14px), `0.625rem` (10px), `0.3125rem` (5px), `0.6875rem` (11px), `0.0625rem` (1px).

- [ ] **Step 2: sostituire con il token più vicino, uno per volta**

Regola: si arrotonda al token più vicino; a parità di distanza si sceglie il più piccolo. `0.0625rem` (1px) su un bordo **non è una spaziatura**: se è un `padding` verticale di una pillola diventa `--space-1`, se sta descrivendo lo spessore di un bordo va sostituito con `var(--border-width)` e non con uno `--space-*`.

Ogni sostituzione sposta la geometria da 1 a 3px. Riportare la tabella dello Step 1 completata con la colonna «differenza applicata»: è l'elenco di cosa guardare nel giro visivo.

- [ ] **Step 3: verificare che il controllo passi per `shared/`**

Run: `bash apps/frontend/scripts/design-system-gate.sh 2>&1 | grep 'spaziatura' -A50 | grep -c 'shared/'`
Expected: `0`

- [ ] **Step 4: build e test**

Run: `npm run build:frontend && npm run test:frontend`
Expected: 309 test verdi, build pulita. Nessun test dovrebbe cambiare: se uno diventa rosso, sta misurando una geometria che in jsdom non esiste — leggilo prima di toccarlo.

- [ ] **Step 5: commit**

```bash
git add apps/frontend/src/app/shared/ui
git commit -m "fix(shared-ui): le spaziature dello strato condiviso passano alla scala semantica"
```

---

### Task 3: il test guardiano dei token

È il test che manca più di ogni altro, e la rete senza cui la Fase 7 è cieca: oggi cancellare una riga da `_legacy-aliases.scss` non fa fallire il build, non rompe nessun test, e produce un valore vuoto — cioè uno sfondo trasparente o un testo invisibile. Copre le voci 1 e 2 di **Review Focus**.

**Files:**
- Create: `apps/frontend/src/app/shared/styles/tokens.spec.ts`

**Interfaces:**
- Consumes: niente dai task precedenti.
- Produces: un test che fallisce nominando la custom property irrisolta e il tema in cui non risolve.

- [ ] **Step 1: scrivere il test che fallisce**

```ts
import { TestBed } from '@angular/core/testing';
import { App } from '../../app';

/**
 * Ogni custom property referenziata nel sorgente deve risolvere a un valore
 * non vuoto, in entrambi i temi.
 *
 * Esiste per l'operazione piu' rischiosa del piano: cancellare righe da
 * `_legacy-aliases.scss`. Un alias rimasto orfano non e' un errore che
 * qualcosa segnala — `var(--sparito)` vale la stringa vuota, quindi uno
 * sfondo diventa trasparente e un colore di testo sparisce, in silenzio.
 *
 * Il censimento legge i nomi **dal sorgente compilato**, non da un elenco
 * scritto a mano: un elenco a mano invecchia e smette di coprire proprio i
 * token aggiunti dopo.
 */
const RIFERIMENTO = /var\(\s*(--[a-z0-9-]+)/g;

function proprietaReferenziate(css: string): Set<string> {
  const nomi = new Set<string>();
  for (const trovato of css.matchAll(RIFERIMENTO)) {
    const nome = trovato[1];
    if (nome !== undefined) {
      nomi.add(nome);
    }
  }
  return nomi;
}

describe('token del design system', () => {
  for (const tema of ['light', 'dark'] as const) {
    it(`ogni custom property referenziata risolve nel tema ${tema}`, async () => {
      document.documentElement.setAttribute('data-theme', tema);
      await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
      TestBed.createComponent(App).detectChanges();

      const css = [...document.querySelectorAll('style')]
        .map((foglio) => foglio.textContent ?? '')
        .join('\n');
      const stile = getComputedStyle(document.documentElement);

      const irrisolte = [...proprietaReferenziate(css)].filter(
        (nome) => stile.getPropertyValue(nome).trim() === ''
      );

      expect(irrisolte).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: eseguirlo e capire cosa dice**

Run: `npm run test:frontend -- tokens.spec.ts`

Due esiti possibili, entrambi informativi:
- **passa**: la rete è in posa, si prosegue;
- **fallisce** nominando delle proprietà: sono token già orfani oggi, e vanno aggiunti o rimossi prima di andare avanti. Non "aggiustare" il test allentando l'asserzione.

Se jsdom non espone i fogli di stile dei componenti in `document.querySelectorAll('style')`, il test raccoglie solo i globali: in quel caso **dillo esplicitamente nel report** e restringi la promessa del test nel commento, invece di lasciar credere che copra più di quanto copre.

- [ ] **Step 3: verificare che sappia fallire**

Aggiungere temporaneamente in un foglio qualunque una regola `color: var(--token-che-non-esiste);`, rieseguire, verificare che il test fallisca **nominando** `--token-che-non-esiste`, poi togliere la regola.

Questo passo non è cerimoniale: un test che non sa fallire per il motivo per cui esiste è peggio di nessun test, perché dà fiducia senza darne la ragione.

- [ ] **Step 4: test completi**

Run: `npm run build:frontend && npm run test:frontend`
Expected: 311 test verdi (309 + 2).

- [ ] **Step 5: commit**

```bash
git add apps/frontend/src/app/shared/styles/tokens.spec.ts
git commit -m "test(design-system): un guardiano verifica che ogni token referenziato risolva nei due temi"
```

---

### Task 4: `SectionHeader` guadagna uno slot accanto al titolo, e la dimensione dell'icona smette di vivere nel chiamante

Due debiti registrati durante la Fase 3 che, se non chiusi ora, vengono copiati otto volte dalle pagine successive.

Il primo: la colonna dei filtri ha un `<h2>` scritto a mano invece di `SectionHeader`, perché serviva un badge **accanto** al titolo e `SectionHeader` prende il titolo come stringa. È la divergenza I-3 della review, e si ripresenterà in ogni toolbox.

Il secondo: l'SVG proiettato in `FilterGroup` appartiene al template del chiamante, quindi l'incapsulamento emulato impedisce a `filter-group.scss` di dimensionarlo, e la regola `svg[icon] { width: 1rem }` vive in `analytics-filters.scss`. Con nove toolbox diventa nove copie.

**Files:**
- Modify: `shared/layout/section-header.{ts,html,scss}`, `section-header.spec.ts`
- Modify: `shared/ui/filter-group.scss`
- Modify: `features/analytics/analytics-filters.{html,ts,scss}`

**Interfaces:**
- Produces: `<app-section-header title="…"><app-badge titleAdornment … /></app-section-header>` — uno slot `titleAdornment` accanto al titolo, distinto da `panelActions` che resta all'estremità destra.

- [ ] **Step 1: il test che fissa lo slot**

In `section-header.spec.ts`:

```ts
it('proietta un ornamento accanto al titolo, distinto dalle azioni', async () => {
  await render();

  const titolo = host().querySelector('.title-row');

  expect(titolo?.querySelector('[data-test="ornamento"]')).not.toBeNull();
  expect(host().querySelector('.actions [data-test="ornamento"]')).toBeNull();
});
```

Il componente ospite dello spec proietta `<span titleAdornment data-test="ornamento">3</span>` e `<span panelActions data-test="azione">x</span>`.

- [ ] **Step 2: eseguirlo e verificare che fallisca**

Run: `npm run test:frontend -- section-header.spec.ts`
Expected: FAIL — `.title-row` non esiste ancora.

- [ ] **Step 3: aggiungere lo slot**

In `section-header.html`, il titolo e il suo ornamento stanno su una riga; le azioni restano dove sono:

```html
<div class="section-header">
  <div class="title-row">
    <h2>{{ title() }}</h2>
    <ng-content select="[titleAdornment]" />
  </div>
  <ng-content select="[panelActions]" />
</div>
```

`.title-row` è un flex con `align-items: baseline` e `gap: var(--space-4)`.

- [ ] **Step 4: centralizzare la dimensione dell'icona proiettata**

In `filter-group.scss`, la regola sull'SVG proiettato non può vivere: l'elemento porta l'attributo di incapsulamento del chiamante. La si sposta sul **contenitore**, che invece appartiene a `FilterGroup`, usando proprietà che l'SVG eredita:

```scss
/*
 * L'SVG proiettato porta l'attributo di incapsulamento del chiamante, quindi
 * nessun selettore di questo foglio lo raggiunge. Lo dimensiona il
 * contenitore, che invece e' nostro: gli SVG di Lucide nascono con
 * `width="24" height="24"`, ma quegli attributi cedono a una larghezza
 * calcolata dal box, quindi fissare il contenitore basta.
 */
.icon {
  display: inline-flex;
  width: 1rem;
  height: 1rem;

  > svg {
    width: 100%;
    height: 100%;
  }
}
```

Attenzione: `> svg` qui **non** funziona per lo stesso motivo. Se la prova mostra che non si applica, la via che resta è dichiarare la regola in `styles.scss` con un nome proprio (`.filter-group-icon svg`), globale e quindi non incapsulata. **Provare prima la via locale e riportare quale delle due ha retto**, invece di scegliere a priori.

- [ ] **Step 5: la colonna dei filtri torna a `SectionHeader`**

In `analytics-filters.html`, la riga scritta a mano diventa:

```html
<app-section-header title="Filtri">
  @if (activeCount() > 0) {
    <app-badge titleAdornment [label]="activeBadgeLabel()" tone="neutral" />
  }
  @if (activeCount() > 0) {
    <button panelActions type="button" class="reset" (click)="store.resetFilters()">Azzera</button>
  }
</app-section-header>
```

La riga resta quella appiccicata in cima allo scorrimento: i margini negativi che la portano a filo del pannello restano dove sono, e **solo orizzontali se sopra di lei c'è altro**. In questo file l'errore del margine negativo superiore è già stato commesso una volta, con il riquadro che saliva di 4px sopra il titolo.

- [ ] **Step 6: test e gate**

Run: `npm run build:frontend && npm run test:frontend && npm run gate --workspace apps/frontend`
Expected: 312 test verdi. Il gate resta rosso sulle pagine non ancora migrate — è previsto.

- [ ] **Step 7: commit**

```bash
git add apps/frontend/src/app/shared apps/frontend/src/app/features/analytics
git commit -m "feat(shared-layout): SectionHeader accoglie un ornamento accanto al titolo"
```

---

### Task 5: gli stati dei campi e il `:active` dei bottoni

Mai implementati, benché i token siano stati promossi a nome proprio apposta: `--color-disabled-input` e `--color-primary-active` esistono in `_primitives.scss` e hanno **zero consumatori**. `styles.scss` copre `button` nei suoi stati predefinito, hover, focus e disabilitato, ma non `:active`; e non esiste **nessuna** regola globale per `input`, `select` e `textarea`.

Va fatto adesso, prima delle pagine, per una ragione misurabile: oggi l'unica sorgente di stili per un campo è `analytics-filters.scss:17-40`, ventiquattro righe scritte a mano per il campo data della toolbox. I Task 7, 9, 10, 11 e 12 aprono pagine piene di moduli: senza una regola globale, quelle ventiquattro righe verranno copiate cinque volte.

È però **CSS globale nuovo che tocca tutte e dieci le pagine**, cioè la forma di difetto che su questo lavoro si è già ripetuta tre volte — una regola globale cambiata guardando meno consumatori di quanti ne abbia. Per questo il censimento viene prima della regola, e non dopo.

**Files:**
- Modify: `apps/frontend/src/styles.scss`
- Modify: `features/analytics/analytics-filters.scss` (le 24 righe locali diventano ridondanti)

**Interfaces:**
- Produces: regole globali per `input`, `select`, `textarea` negli stati predefinito, hover, focus, disabilitato e non valido; `button:active`. I task delle pagine le ereditano senza dichiarare nulla.

- [ ] **Step 1: censire ogni campo dell'applicazione, prima di scrivere una riga**

```bash
grep -rn "<input\|<select\|<textarea" apps/frontend/src/app --include=*.html
grep -rnE "^\s*(input|select|textarea)[ ,{:]" apps/frontend/src/app --include=*.scss
```

Il primo comando dice quanti campi esistono e dove; il secondo, quali fogli oggi li stilano per conto proprio. Ogni regola locale trovata dal secondo è un potenziale conflitto con la regola globale che stai per scrivere: per ciascuna, dire nel report se la regola globale la sostituisce, la integra o le si scontra.

Questa tabella è il lavoro vero del task. Scriverla dopo aver scritto il CSS significa scrivere una giustificazione, non un censimento.

- [ ] **Step 2: scrivere le regole globali**

In `styles.scss`, accanto alla regola `button` esistente:

```scss
/*
 * I campi di modulo, in un posto solo.
 *
 * Prima di questa regola l'unica sorgente era il campo data della toolbox di
 * Analytics, ventiquattro righe scritte a mano: nove pagine di moduli le
 * avrebbero copiate. I token `--color-disabled-input` e
 * `--color-primary-active` esistevano gia' con un nome proprio e zero
 * consumatori — erano la regola mancante, dichiarata e non scritta.
 */
input:not([type='checkbox']):not([type='radio']),
select,
textarea {
  @include typography.text('body');

  padding: var(--space-3) var(--space-4);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-input);
  background: var(--color-surface);
  color: var(--color-text-primary);
}

/*
 * Caselle e radio sono escluse dalla regola sopra e non ne hanno una propria.
 *
 * Un `padding` e un `border-radius` su un `input[type="checkbox"]` lo
 * sfigurano: il controllo nativo disegna se stesso, e quelle proprieta' gli
 * si sommano invece di sostituirlo. Restilarli davvero significa
 * `appearance: none` piu' il segno di spunta ridisegnato a mano, che e' un
 * lavoro a se' e non ha ancora un caso reale in questa applicazione —
 * `accent-color: var(--color-primary)` e' l'unica cosa che vale la pena
 * dichiarare, perche' li allinea al tema senza toccarne la forma.
 */
input[type='checkbox'],
input[type='radio'] {
  accent-color: var(--color-primary);
}

input:not([type='checkbox']):not([type='radio']):hover:not(:disabled),
select:hover:not(:disabled),
textarea:hover:not(:disabled) {
  border-color: var(--color-border-strong);
  background: var(--color-surface-elevated);
}

input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  border-color: var(--color-primary);
  background: var(--color-surface-elevated);
  box-shadow: 0 0 0 3px var(--color-focus-ring);
  outline: none;
}

input:disabled,
select:disabled,
textarea:disabled {
  background: var(--color-disabled-input);
  color: var(--color-text-muted);
  cursor: not-allowed;
}

/* Lo stato non valido non si affida al solo colore: porta anche il bordo piu' marcato. */
input:user-invalid,
select:user-invalid,
textarea:user-invalid {
  border-color: var(--color-error);
  border-width: 2px;
}

button:active:not(:disabled) {
  background: var(--color-primary-active);
}
```

Verificare che `--radius-input`, `--color-border-strong`, `--color-focus-ring` e `--color-primary-active` esistano davvero prima di usarli:

```bash
grep -nE "radius-input|border-strong|focus-ring|primary-active|disabled-input" apps/frontend/src/app/shared/styles/_semantic.scss apps/frontend/src/app/shared/styles/_primitives.scss
```

Se uno manca, **fermarsi e dirlo**: inventare un token è il modo in cui si ottiene un valore vuoto che nessun test vede.

`:user-invalid` e non `:invalid`: `:invalid` colpisce un campo obbligatorio ancora vuoto appena la pagina si apre, e segnalare un errore prima che l'utente abbia scritto qualcosa è peggio che non segnalarlo.

- [ ] **Step 3: il test che fissa la cascata**

```ts
import { TestBed } from '@angular/core/testing';

describe('stili globali dei campi', () => {
  it('un input disabilitato prende il proprio sfondo dalla regola globale', () => {
    const campo = document.createElement('input');
    campo.disabled = true;
    document.body.append(campo);

    const sfondo = getComputedStyle(campo).backgroundColor;

    expect(sfondo).not.toBe('');
    expect(sfondo).not.toBe('rgba(0, 0, 0, 0)');

    campo.remove();
  });
});
```

Se jsdom non applica il foglio globale agli elementi creati a mano, il test non è scrivibile in questa forma: **dirlo nel report** e non sostituirlo con un test che asserisce qualcosa di diverso da ciò che serve verificare.

- [ ] **Step 4: togliere le ventiquattro righe locali**

In `analytics-filters.scss`, le dichiarazioni di `input` che la regola globale ora porta (bordo, raggio, sfondo, colore, hover, focus) si cancellano. Resta solo ciò che è specifico di quella toolbox: la disposizione.

Questo passo è la verifica che la regola globale funziona davvero: se togliendola il campo data peggiora, la regola globale non copre ciò che credi.

- [ ] **Step 5: verificare su tutte le pagine che hanno moduli**

Run: `npm run build:frontend && npm run test:frontend`

Poi, per ciascuna riga del censimento dello Step 1 marcata «si scontra», risolverla e dichiarare come.

- [ ] **Step 6: commit**

```bash
git add apps/frontend/src/styles.scss apps/frontend/src/app/features/analytics
git commit -m "feat(design-system): i campi di modulo e il :active dei bottoni hanno stati dichiarati"
```

---

## Fase 5 — le nove pagine

Ogni task di questa fase segue la stessa forma: convertire i pannelli scritti a mano, portare colori/spaziature/raggi/tipografia ai token, riusare i componenti condivisi invece di riscriverli, e non cambiare nulla di ciò che la pagina fa.

**Il pilota è il riferimento obbligatorio**: `features/analytics/` risponde a ogni domanda di forma (come si scrive un titolo di pannello, come si compone una toolbox, come si rende un importo, come si segnala uno stato vuoto). Se il pilota non risponde a una domanda, la risposta va decisa una volta e scritta nel registro, non improvvisata per pagina.

### Task 6: le cinque tabelle — adottare `data-table` e `SortableHeader`, oppure cancellarli

Sono l'unico pezzo dello strato condiviso che non ha mai incontrato un caso reale: 52 righe di mixin e quattro file, **zero usi**. Movimenti è la tabella per cui sono stati scritti. Se reggono lì, le altre quattro seguono quasi gratis; se non reggono, è meglio scoprirlo su una tabella che su cinque. **Cancellarli è un esito accettabile e va dichiarato come tale, non evitato.**

Copre la voce 4 di **Review Focus**.

**Files:**
- Modify: `features/transactions/transactions-table.{html,scss,spec.ts}`
- Modify: `shared/styles/_mixins.scss` (o cancellazione del mixin)
- Modify: `shared/ui/sortable-header.*` (o cancellazione)

**Interfaces:**
- Consumes: `@mixin data-table` da `shared/styles/_mixins.scss`; `SortableHeader` da `shared/ui/sortable-header`.
- Produces: il verdetto — adottati o cancellati — che i Task 9 e 10 erediteranno per le loro tabelle.

- [ ] **Step 1: il test che protegge il contenuto lungo**

```ts
it('un importo a sei cifre non viene troncato nella cella', async () => {
  await renderConTransazioni([transazione({ amount: -123456.78 })]);

  const cella = host().querySelector('td.amount');

  // `Amount` e' `white-space: nowrap`: se la colonna e' troppo stretta il
  // numero esce dalla cella invece di andare a capo, e in jsdom non si vede.
  // Quello che si puo' verificare e' che il numero ci sia tutto.
  expect(cella?.textContent).toContain('123.456,78');
});

it('un nome di merchant molto lungo non spinge fuori la colonna importo', async () => {
  const nome = 'Supermercato Cooperativo del Lungo Nome Che Non Finisce Mai';
  await renderConTransazioni([transazione({ merchantName: nome })]);

  expect(host().querySelector('td.merchant')?.textContent?.trim()).toBe(nome);
  expect(host().querySelector('td.amount')).not.toBeNull();
});
```

- [ ] **Step 2: eseguirli**

Run: `npm run test:frontend -- transactions-table.spec.ts`
Expected: passano già oggi (descrivono il comportamento attuale, che va conservato). Se uno fallisce, **hai trovato un difetto preesistente**: annotalo e non cambiarlo in questo task.

- [ ] **Step 3: provare `data-table` su Movimenti**

Includere il mixin in `transactions-table.scss` al posto dell'involucro scritto a mano, e sostituire le intestazioni ordinabili con `<app-sortable-header>`.

Il mixin ha un padding (`--space-3 --space-4` per le celle, `--space-4` per le intestazioni) diverso da quello attuale della tabella: **la geometria cambierà**. È atteso — è il senso di avere un involucro condiviso.

- [ ] **Step 4: il verdetto**

Rieseguire i test. Poi rispondere per iscritto, nel report, a tre domande:
1. Il mixin ha coperto l'involucro senza che la tabella debba ridichiarare padding o bordi?
2. `SortableHeader` ha sostituito le intestazioni ordinabili senza cambiare il comportamento dell'ordinamento?
3. Quanto delle 52 righe del mixin è servito davvero?

Se la risposta a 1 e 2 è sì, sono adottati e i Task 8 e 9 li useranno. Se è no, **cancellarli** — mixin, i quattro file di `SortableHeader` e il suo spec — e dichiararlo: quattro file non usati costano meno morti che vivi e sbagliati.

- [ ] **Step 5: test, gate, commit**

```bash
npm run build:frontend && npm run test:frontend
git add apps/frontend/src/app
git commit -m "refactor(transactions): la tabella dei movimenti adotta l'involucro condiviso"
```

---

### Task 7: Movimenti — i pannelli, la toolbar, la paginazione

La pagina con più superficie: tre `<section class="panel">` scritti a mano, 15 alias in `transactions-page.scss`, 23 in `transactions-toolbar.scss`, 13 in `transactions-pagination.scss`.

Copre le voci 3 e 5 di **Review Focus**.

**Files:**
- Modify: `features/transactions/transactions-page.{html,ts,scss}`
- Modify: `features/transactions/transactions-toolbar.{html,scss}`
- Modify: `features/transactions/transactions-pagination.{html,scss}`
- Modify: `features/transactions/transactions-page.spec.ts` (se esiste)

- [ ] **Step 1: i due test che proteggono ciò che è facile perdere**

```ts
it('con zero movimenti mostra lo stato vuoto e non la tabella', async () => {
  await renderConMovimenti([]);

  expect(host().querySelector('app-empty-state')).not.toBeNull();
  expect(host().querySelector('table')).toBeNull();
});

it('l\'ordine di tabulazione segue l\'ordine visivo dopo la conversione dei pannelli', async () => {
  await render();

  const focusabili = [...host().querySelectorAll<HTMLElement>('a[href], button, input, select')];
  const posizioni = focusabili.map((elemento) =>
    [...host().querySelectorAll('*')].indexOf(elemento)
  );

  // `app-panel` introduce un host fra contenitore e contenuto: l'ordine del
  // DOM non deve cambiare, o il fuoco da tastiera salta avanti e indietro.
  expect(posizioni).toEqual([...posizioni].sort((a, b) => a - b));
});
```

- [ ] **Step 2: eseguirli, verificare che passino oggi**

Run: `npm run test:frontend -- transactions-page.spec.ts`
Expected: PASS. Descrivono il comportamento attuale: servono a dimostrare che la migrazione non lo cambia.

- [ ] **Step 3: convertire i tre pannelli**

`<section class="panel">` → `<app-panel>`. Il terzo (riga 90) ha `aria-busy="true"`: l'attributo va sull'`<app-panel>`, non perso. Il secondo ha `[class.updating]`: diventa `[class.stale]`, che è la convenzione che `Panel` già gestisce (`panel.scss`).

Togliere dal foglio le regole `.panel` locali che `Panel` ora porta: bordo, sfondo, raggio, padding, margine inferiore.

- [ ] **Step 4: portare colori, spaziature, raggi e tipografia ai token**

Nei tre fogli. Ogni `var(--surface)` → `var(--color-surface)`, `var(--border)` → `var(--color-border)`, `var(--text-muted)` → `var(--color-text-muted)`, e così via. Ogni `font-size` letterale → `@include typography.text('<ruolo>')` scegliendo il ruolo dal significato, non dal numero più vicino.

- [ ] **Step 5: verificare**

Run: `npm run build:frontend && npm run test:frontend`
Expected: tutti verdi, i due test dello Step 1 compresi.

Run: `bash apps/frontend/scripts/design-system-gate.sh 2>&1 | grep -c 'transactions'`
Expected: `0`

- [ ] **Step 6: commit**

```bash
git add apps/frontend/src/app/features/transactions
git commit -m "refactor(transactions): la pagina Movimenti passa ai token del design system"
```

---

### Task 8: Prestiti — tre pagine, un foglio condiviso, più il badge di stato

Il gruppo più carico: `loan-detail-page.scss` ha 47 alias e 20 `font-size`, `loans-page.scss` altri 35 e 8. E `loan-create-page` **non ha un foglio proprio**: usa lo `styleUrl` di `loan-detail-page`, quindi ogni modifica a quel foglio serve due pagine.

Include la **decisione 3 già approvata dall'utente**: le quattro card dei prestiti («Restituito», «Da ricevere», «Residuo») hanno perso il colore di stato nella Fase 3. Il numero neutro è corretto — il design system vieta di distinguere entrate e uscite col solo colore — ma il segnale perso non è un guadagno. `Badge` è il veicolo per rimetterlo senza colorare la cifra.

**Files:**
- Modify: `features/loans/loans-page.{html,ts,scss}`
- Modify: `features/loans/loan-detail-page.{html,scss}`
- Modify: `features/loans/loan-create-page.html`
- Modify: `features/loans/loans-page.spec.ts` (se esiste, altrimenti crearlo)

- [ ] **Step 1: il test del badge di stato**

```ts
it('una card di prestito porta lo stato in un badge, non nel colore del numero', async () => {
  await renderConPrestito({ restituito: 500, residuo: 0 });

  const card = host().querySelector('.loan-card');

  expect(card?.querySelector('app-badge')?.textContent?.trim()).toBe('Chiuso');
  // Il numero resta neutro: il design system vieta di affidare al solo
  // colore la distinzione fra entrata e uscita (DS §5).
  expect(card?.querySelector('app-amount')?.classList.contains('amount-positive')).toBe(false);
});
```

- [ ] **Step 2: eseguirlo, verificare che fallisca**

Run: `npm run test:frontend -- loans-page.spec.ts`
Expected: FAIL — nessun `app-badge` nella card.

- [ ] **Step 3: aggiungere il badge**

`Badge` ha `tone: 'positive' | 'negative' | 'neutral'`. Un prestito chiuso è `positive`, uno con residuo è `neutral`, uno scaduto — se il concetto esiste nei dati, **verificarlo prima** — è `negative`. Se non esiste, due toni bastano: non inventare uno stato.

- [ ] **Step 4: leggere entrambe le pagine prima di toccare il foglio condiviso**

Aprire `loan-detail-page.html` e `loan-create-page.html` insieme. Per ogni selettore di `loan-detail-page.scss` che si modifica, verificare quale delle due lo usa. Dichiarare nel report i selettori che servono entrambe.

- [ ] **Step 5: migrare i tre fogli ai token**

47 + 35 alias, 28 `font-size`. È il volume maggiore del piano: procedere per blocchi, ricompilando spesso.

- [ ] **Step 6: verificare**

Run: `npm run build:frontend && npm run test:frontend`
Run: `bash apps/frontend/scripts/design-system-gate.sh 2>&1 | grep -c 'loans'`
Expected: `0`

- [ ] **Step 7: commit**

```bash
git add apps/frontend/src/app/features/loans
git commit -m "refactor(loans): le tre pagine dei prestiti passano ai token e recuperano lo stato in un badge"
```

---

### Task 9: Categorie

21 alias. Una tabella, un modulo di creazione nella toolbox, celle modificabili in linea.

Copre la voce 3 di **Review Focus**.

**Files:**
- Modify: `features/categories/categories-page.{html,scss}`
- Modify: `features/categories/categories-page.spec.ts` (se esiste)

- [ ] **Step 1: il test dello stato vuoto**

```ts
it('senza categorie mostra lo stato vuoto e non la tabella', async () => {
  await renderConCategorie([]);

  expect(host().querySelector('app-empty-state')).not.toBeNull();
  expect(host().querySelector('table')).toBeNull();
});
```

- [ ] **Step 2: eseguirlo**

Run: `npm run test:frontend -- categories-page.spec.ts`
Expected: PASS oggi. Se fallisce, lo stato vuoto non c'è ed è una lacuna da annotare.

- [ ] **Step 3: migrare**

Token, tipografia, pannelli. La tabella segue il verdetto del Task 6: se `data-table` è stato adottato, si include; se è stato cancellato, si porta l'involucro ai token e basta.

Le celle modificabili in linea usano `--radius-control` a 4px invece dei 6px del token (è una eccezione preesistente dichiarata nella specifica §16.4): **conservarla**, non "correggerla".

- [ ] **Step 4: verificare**

Run: `npm run build:frontend && npm run test:frontend`
Run: `bash apps/frontend/scripts/design-system-gate.sh 2>&1 | grep -c 'categories'`
Expected: `0`

- [ ] **Step 5: commit**

```bash
git add apps/frontend/src/app/features/categories
git commit -m "refactor(categories): la pagina Categorie passa ai token del design system"
```

---

### Task 10: Merchant

20 alias. Struttura simile a Categorie: tabella, ricerca, rinomina in linea.

Copre la voce 3 di **Review Focus**.

**Files:**
- Modify: `features/merchants/merchants-page.{html,scss}`
- Modify: `features/merchants/merchants-page.spec.ts` (se esiste)

- [ ] **Step 1: il test dello stato vuoto con ricerca attiva**

```ts
it('con una ricerca che non trova nulla distingue "nessun risultato" da "nessun merchant"', async () => {
  await renderConMerchant([], { ricerca: 'zzz' });

  // I due stati vuoti non sono lo stesso: uno suggerisce di cambiare la
  // ricerca, l'altro di importare dei movimenti.
  expect(host().textContent).toContain('ricerca');
});
```

- [ ] **Step 2: eseguirlo**

Run: `npm run test:frontend -- merchants-page.spec.ts`
Expected: se fallisce, i due stati vuoti oggi coincidono: **è una lacuna reale**, correggerla fa parte di questo task.

- [ ] **Step 3: migrare ai token**

Colori, spaziature, raggi e tipografia in `merchants-page.scss`: ogni `var(--surface)` diventa `var(--color-surface)`, `var(--border)` diventa `var(--color-border)`, `var(--text-muted)` diventa `var(--color-text-muted)`, e ogni `font-size` letterale diventa `@include typography.text('<ruolo>')`, scegliendo il ruolo dal significato del testo e non dal numero più vicino.

I pannelli scritti a mano diventano `<app-panel>`, togliendo dal foglio le regole `.panel` locali che `Panel` ora porta: bordo, sfondo, raggio, padding, margine inferiore.

La tabella segue il verdetto del Task 6: se `data-table` è stato adottato, si include il mixin; se è stato cancellato, si porta l'involucro ai token e basta.

**L'eccezione da conservare, non da correggere**: le celle modificabili in linea di questa pagina (`.name input`, `.category select`) usano un raggio di **4px** invece dei 6px di `--radius-control`. È una divergenza preesistente dichiarata nella specifica §16.4 e va lasciata: "correggerla" cambierebbe l'aspetto di una modifica in linea che oggi funziona.

- [ ] **Step 4: verificare**

Run: `npm run build:frontend && npm run test:frontend`
Run: `bash apps/frontend/scripts/design-system-gate.sh 2>&1 | grep -c 'merchants'`
Expected: `0`

- [ ] **Step 5: commit**

```bash
git add apps/frontend/src/app/features/merchants
git commit -m "refactor(merchants): la pagina Merchant passa ai token del design system"
```

---

### Task 11: Import CSV

16 alias, 8 `font-size`, più `column-picker.scss`. È la pagina con più stati: caricamento, anteprima, scelta delle colonne, errori di validazione, esito.

Copre la voce 3 di **Review Focus**.

**Files:**
- Modify: `features/import/import-page.{html,scss}`
- Modify: `features/import/column-picker.{html,scss}`

- [ ] **Step 1: censire gli stati prima di toccarli**

Elencare, leggendo il template, ogni ramo `@if`/`@else` della pagina e cosa rende. È il task in cui è più facile spostare uno stato fuori dal suo ramo senza accorgersene, perché gli stati sono tanti e mutuamente esclusivi. La tabella va nel report.

- [ ] **Step 2: migrare ai token**

`column-picker` ha cinque `— scegli la colonna —` come testo di opzione: sono **testo**, non segnaposto da sostituire con un'icona.

- [ ] **Step 3: verificare che ogni stato renda ancora**

Per ciascun ramo censito allo Step 1, verificare a mano nel template che la condizione e il contenuto siano invariati. Riportare la tabella con una colonna «invariato: sì/no».

- [ ] **Step 4: verificare**

Run: `npm run build:frontend && npm run test:frontend`
Run: `bash apps/frontend/scripts/design-system-gate.sh 2>&1 | grep -c 'import'`
Expected: `0`

- [ ] **Step 5: commit**

```bash
git add apps/frontend/src/app/features/import
git commit -m "refactor(import): la pagina Import CSV passa ai token del design system"
```

---

### Task 12: Impostazioni e manutenzione

12 alias in `settings-page.scss`, 14 in `reset-panel.scss`. Due `<section class="panel">` scritti a mano, di cui uno è la «zona pericolosa» del pannello di reset.

**Files:**
- Modify: `features/settings/settings-page.{html,scss}`
- Modify: `features/maintenance/reset-panel.{html,scss}`

- [ ] **Step 1: convertire i pannelli**

`<section class="panel">` → `<app-panel>`. `<section class="panel danger-zone">` diventa `<app-panel class="danger-zone">`: la classe resta sull'host, la regola locale che la stila continua a funzionare perché seleziona l'host, non il `.panel` interno.

- [ ] **Step 2: il colore della zona pericolosa**

`reset-panel.scss` usa `--negative` per il bordo e il titolo della zona pericolosa. `--negative` è `--color-expense`, il colore **finanziario** delle uscite. Cancellare un archivio non è denaro che esce: va a `--color-error`, come `ErrorRetry` nella Fase 3.

È lo stesso ragionamento già applicato una volta e registrato: un colore finanziario non descrive uno stato di sistema.

- [ ] **Step 3: migrare ai token**

- [ ] **Step 4: verificare**

Run: `npm run build:frontend && npm run test:frontend`
Run: `bash apps/frontend/scripts/design-system-gate.sh 2>&1 | grep -cE 'settings|maintenance'`
Expected: `0`

- [ ] **Step 5: commit**

```bash
git add apps/frontend/src/app/features/settings apps/frontend/src/app/features/maintenance
git commit -m "refactor(settings): Impostazioni e manutenzione passano ai token del design system"
```

---

### Task 13: i quattro componenti della Dashboard rimasti

`cash-flow-card.scss` (14 alias, 6 `font-size`), `category-breakdown.scss`, `top-merchants.scss`, `month-comparison.scss` (4 `font-size` ciascuno).

`cash-flow-card` ha anche un `max-width: 26rem` che, ora che `.content` non ha più un tetto, la lascia visibilmente stretta in mezzo allo spazio nuovo: **è una decisione di layout da prendere guardando la pagina**, non da rimuovere d'ufficio. Riportarla nel report come punto per il giro visivo.

**Files:**
- Modify: `features/cash-flow/cash-flow-card.{html,scss}`
- Modify: `features/dashboard/category-breakdown.{html,scss}`, `top-merchants.{html,scss}`, `month-comparison.{html,scss}`

- [ ] **Step 1: gli importi passano a `<app-amount>`**

`month-comparison.html` formatta gli importi a mano con `formatAmount` e li colora con `.up`/`.down`. Sono numerali finanziari: vanno resi con `<app-amount>`, che porta mono, cifre tabulari e la regola del segno.

**Attenzione al segno**: `difference` è già firmata; `currentExpenses` e `previousExpenses` sono magnitudini di spesa. Negarle al punto di chiamata e lasciare che `Amount` deduca, senza forzare il tono — è lo stesso errore già commesso due volte su questo branch (dedurre la semantica dal nome di un campo).

- [ ] **Step 2: il test del segno**

```ts
it('le spese del mese si vedono come uscite, non come magnitudini', async () => {
  await renderConConfronto({ currentExpenses: 340, previousExpenses: 500, difference: -160 });

  const correnti = host().querySelector('[data-test="spese-correnti"]');

  expect(correnti?.textContent).toContain('−340,00');
});
```

- [ ] **Step 3: migrare i quattro fogli ai token**

- [ ] **Step 4: verificare**

Run: `npm run build:frontend && npm run test:frontend`
Run: `bash apps/frontend/scripts/design-system-gate.sh 2>&1 | grep -cE 'dashboard|cash-flow'`
Expected: `0`

- [ ] **Step 5: commit**

```bash
git add apps/frontend/src/app/features/dashboard apps/frontend/src/app/features/cash-flow
git commit -m "refactor(dashboard): i quattro componenti rimasti passano ai token"
```

---

### Task 14: il colore degli errori, su tutte le pagine in un colpo

**Decisione 4, già approvata dall'utente.** Oggi 12 regole `.message.error` in 10 file usano `var(--negative)` → `--color-expense` (`#ae3f51` chiaro), mentre l'utility globale `.message--error` usa `--color-error` (`#c22b33`). Sono colori diversi, e l'unico consumatore dell'utility nuova — il messaggio d'errore di Analytics — è già oggi di un rosso diverso da ogni altro errore dell'app.

**Non è una rinomina di classi: è un cambiamento di colore visibile su nove pagine.** L'utente lo ha approvato sapendolo.

**Files:**
- Modify: i template e i fogli di `cash-flow-card`, `categories-page`, `dashboard-page`, `import-page`, `loan-detail-page`, `loans-page`, `reset-panel`, `merchants-page`, `settings-page`, `transactions-page`, `transactions-table`

- [ ] **Step 1: il censimento, prima di toccare**

Run: `grep -rn "message error" apps/frontend/src --include=*.html`
Run: `grep -rn "\.message\.error" apps/frontend/src --include=*.scss`

Le due liste devono corrispondere file per file. Uno scarto significa che esiste una regola senza template o un template senza regola: annotarlo.

- [ ] **Step 2: sostituire nei template**

`class="message error"` → `class="message message--error"`, ovunque.

- [ ] **Step 3: cancellare le regole locali**

Le 12 regole `.message.error { color: var(--negative) }` si cancellano: il colore lo porta l'utility globale. **Non sostituirle con `.message.message--error`**: quella forma ha specificità 0,2,0 e vincerebbe ancora sull'utility, che è 0,1,0 — è esattamente il tranello già incontrato in `error-retry.scss`.

Se togliendo il colore la regola resta vuota, togliere anche la regola.

- [ ] **Step 4: verificare che nessuna regola sopravviva**

Run: `grep -rn "message error\|\.message\.error\|\.message\.message--error" apps/frontend/src`
Expected: vuoto.

- [ ] **Step 5: test**

Run: `npm run build:frontend && npm run test:frontend`

Se uno spec asseriva la classe `error`, aggiornarlo — ma prima chiedersi se stia segnalando una funzione persa invece di un selettore cambiato.

- [ ] **Step 6: commit**

```bash
git add apps/frontend/src/app
git commit -m "fix(ui): i messaggi d'errore usano il colore d'errore, non quello delle uscite"
```

---

## Fase 6 — responsive

### Task 15: 1280, 1100 e 900px

La fase che la specifica aveva previsto e che non è mai stata eseguita: oggi esistono due `@media` in tutta l'applicazione. Il criterio della specifica è: a 1280, 1100 e 900px nessuna eccedenza orizzontale e nessun contenuto irraggiungibile.

**jsdom non fa layout**, quindi questa fase **non è verificabile dai test** e nessun test va scritto per fingere che lo sia. La verifica è il giro visivo, e va eseguita dall'utente.

**Files:**
- Modify: `app.scss`, `shared/layout/page-layout.scss`, e i fogli delle pagine che lo richiedono

- [ ] **Step 1: censire dove il layout può rompersi**

Elencare ogni larghezza fissa e ogni griglia a colonne fisse nel sorgente:

```bash
grep -rnE "width: *[0-9]+(rem|px)|grid-template-columns:" apps/frontend/src/app --include=*.scss
```

Per ciascuna, dire a quale delle tre larghezze diventa un problema. La tabella va nel report: è l'elenco di lavoro dei passi successivi.

- [ ] **Step 2: la colonna della toolbox sotto i 1280px**

La specifica §5.3 prevedeva «gruppi in riga» sotto quella soglia, e non è mai stato implementato: oggi la toolbox passa sotto il contenuto a colonna piena. Con gli accordion, cinque sezioni impilate a piena larghezza sono molto alte. Disporre i gruppi in riga quando c'è spazio.

- [ ] **Step 3: le cinque tabelle a 900px**

Una tabella a sei colonne non entra in 900px. Le vie sono due, e vanno scelte una volta per tutte e cinque: scorrimento orizzontale del solo involucro (`overflow-x: auto` sul contenitore, mai sulla pagina), oppure colonne che si nascondono per priorità. Decidere, scrivere la decisione, applicarla ovunque.

- [ ] **Step 4: la sidebar sotto i 900px**

Esiste già: diventa una barra orizzontale scorrevole. Verificare che con i gruppi etichettati introdotti nella Fase 3 continui a funzionare — le etichette di gruppo in una barra orizzontale non hanno senso e vanno nascoste visivamente, restando nel DOM per chi usa uno screen reader.

- [ ] **Step 5: verificare**

Run: `npm run build:frontend && npm run test:frontend`

Poi **il giro visivo, che spetta all'utente**: aprire le dieci rotte a 1280, 1100 e 900px, in entrambi i temi, e verificare che non ci sia eccedenza orizzontale né contenuto irraggiungibile. Riportare l'elenco delle rotte con l'esito.

- [ ] **Step 6: commit**

```bash
git add apps/frontend/src/app
git commit -m "feat(layout): il layout regge a 1280, 1100 e 900px"
```

---

## Fase 7 — la chiusura

### Task 16: cancellare `_legacy-aliases.scss`

L'atto conclusivo, e l'operazione più rischiosa del piano: un alias cancellato mentre un consumatore sopravvive non produce nessun errore — né in compilazione né nei test — solo un valore vuoto.

**Files:**
- Delete: `shared/styles/_legacy-aliases.scss`
- Modify: `src/styles.scss` (togliere il `@use`)

- [ ] **Step 1: il censimento, con la trappola dell'interpolazione**

```bash
grep -rn "var(--" apps/frontend/src --include=*.scss --include=*.ts | grep -oE "var\(--[a-z-]+" | sort -u
```

E, separatamente, la forma che un grep del nome completo **non trova**:

```bash
grep -rn "var(--[a-z-]*#{" apps/frontend/src --include=*.scss
```

Il secondo comando è il motivo per cui questo task non è meccanico. Nella Fase 3 tre alias sembravano morti a un grep del nome completo ed erano letti quattro volte come `var(--series-#{$series})`. Ogni risultato del secondo comando va risolto a mano, espandendo mentalmente l'interpolazione.

- [ ] **Step 2: verificare che il conteggio sia a zero**

Run: `bash apps/frontend/scripts/design-system-gate.sh`
Expected: tutti e sei i controlli `[ok]`.

Se il conteggio degli alias non è zero, **fermarsi**: manca una pagina, e cancellare adesso rompe qualcosa in silenzio.

- [ ] **Step 3: cancellare**

```bash
git rm apps/frontend/src/app/shared/styles/_legacy-aliases.scss
```

E togliere `@use 'app/shared/styles/legacy-aliases';` da `src/styles.scss`.

- [ ] **Step 4: il guardiano dei token dice se è andata bene**

Run: `npm run test:frontend -- tokens.spec.ts`
Expected: PASS in entrambi i temi.

**Questo è il momento per cui il Task 3 esiste.** Se fallisce, nomina esattamente le proprietà rimaste orfane: non allentare il test, ripristina l'alias mancante o migra il consumatore.

- [ ] **Step 5: verifica completa**

```bash
npm run build:frontend && npm run test:frontend && npm run test:backend
bash apps/frontend/scripts/design-system-gate.sh
git diff --name-only master | grep -E "\.(model|api|store|query)\.ts$|apps/backend" || echo "dominio intatto"
```

Rimisurare le cinque righe della tabella di apertura con gli stessi comandi, e riportarle accanto ai valori di partenza.

- [ ] **Step 6: commit**

```bash
git add -A
git commit -m "chore(design-system): il ponte degli alias legacy viene cancellato"
```

---

## Cosa resta fuori da questo piano, di proposito

- **Le funzioni nuove del mockup** — budget, conti multi-saldo, notifiche, ricerca globale, esportazione. Richiedono modello dati e backend, cioè esattamente i due vincoli che questo lavoro rispetta. Sono un progetto a sé.
- **La rivalidazione della palette dei grafici** per il daltonismo: rischio accettato esplicitamente dall'utente, mitigato da legenda e tabella valori.
- **La formattazione Prettier** dei file fuori configurazione: preesistente, e riformattare dentro i task di migrazione renderebbe illeggibile il diff di entrambe le cose.
- **`ChoiceGroup` in modalità multipla**: oggi nessun chiamante la usa. Se a fine piano è ancora così, il componente può semplificarsi accettando solo un id.
