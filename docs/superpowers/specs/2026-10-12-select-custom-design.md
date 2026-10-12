# Select custom (`app-select`) — design

Data: 2026-10-12 · Stato: bozza da approvare

## Intento

I select dell'app oggi aprono la tendina nativa del browser. È l'unico punto dell'interfaccia che non segue il design system: niente Geist, niente token di superficie, niente pallino colore delle categorie. Le liste lunghe, come le categorie, vanno scorse a mano. L'utente l'ha notato usando il select delle categorie nelle transazioni e vuole due cose:

1. **Estetica:** il pannello aperto deve sembrare parte dell'app, nel tema chiaro e in quello scuro.
2. **Ricerca:** dentro il pannello deve esserci un campo per filtrare le opzioni.

## Obiettivi

- Un componente condiviso unico, `app-select` in `src/app/shared/ui/`, a scelta singola. Sostituisce **tutti** i `<select>` nativi dell'app e il componente `app-visual-select`, che viene rimosso.
- Il pannello segue la **variante A** approvata nel mockup (`.superpowers/brainstorm/889-1791812337/content/dropdown-panel.html`):
  - ricerca in testa al pannello;
  - lista sotto la ricerca;
  - spunta a destra della voce selezionata;
  - voce "vuota" separata da una riga.
- Due aspetti del trigger:
  - `inline`: l'aspetto attuale di `visual-select`, senza bordo e con lo sfondo `--color-surface-hover` solo all'hover. Si usa nelle celle di tabella.
  - `field`: l'aspetto dei campi dei form (regola globale `input, select, textarea` in `src/styles.scss`). Ha bordo, padding `--space-3 --space-4`, `--radius-input`, hover, focus ring, disabled e invalid identici agli input accanto. **Decisione dell'utente:** nei form il trigger mantiene l'aspetto da campo con bordo.

## Non-obiettivi

- Selezione multipla. Ci sono già `toggle-button-group`, `toggle-list-group` e i popover `<details class="dropdown">` della toolbar, che restano come sono.
- Gerarchie e gruppi di opzioni: `Category` è una lista piatta.
- Creazione di una nuova opzione dal pannello ("crea categoria …").
- Caricamento asincrono o virtual scrolling: le liste arrivano al massimo a qualche centinaio di voci.
- `app-choice-group`, i filtri a pillole e il popover della toolbar transazioni. Non sono `<select>` e restano fuori.

## Anti-obiettivi (fallimento anche se "funziona")

- Un pannello che non usa i token: colori o ombre letterali, oppure un font diverso. `npm run gate` deve passare senza nuovi `ds-exception`.
- Peggiorare l'accessibilità rispetto al `<select>` nativo. Devono restare:
  - l'uso completo da tastiera;
  - l'annuncio dello screen reader (nome, valore, espanso/chiuso);
  - l'associazione con `<label>` e `aria-describedby` di `app-form-field`.
- Il pannello tagliato da un contenitore con `overflow: hidden/auto`. È il caso delle celle della tabella transazioni e della card prestito.
- Aggiungere una dipendenza, come Angular CDK o una libreria UI.

## Vincoli dal progetto

- Angular 21, zoneless, componenti standalone, `input()`/`output()`/`model()`/`signal()`. Non ci sono Reactive Forms; `FormsModule`/`ngModel` si usa in 5 pagine.
- Token in `src/app/shared/styles/` (`_primitives.scss`, `_semantic.scss`, `_typography.scss`). I `font-size` letterali sono ammessi solo in `_typography.scss`.
- Icone: `@lucide/angular`.
- Test: Vitest + jsdom. Lo spec sta accanto al componente, con descrizioni `it(...)` in italiano (vedi `visual-select.spec.ts`).
- `app-form-field` avvolge il controllo proiettato in un `<label>` (associazione implicita). Non legge né inietta nulla nel controllo: è la pagina a scrivere `aria-invalid` e `aria-describedby` (proposal §16.3).

## Il componente

### API

```ts
export interface SelectOption<T extends string = string> {
  readonly id: T;
  readonly name: string;
  readonly color?: string | null;   // pallino colore (app-color-marker)
  readonly icon?: LucideIconData;   // icona Lucide qualsiasi; ha precedenza su color
}

// <app-select>
options      = input.required<readonly SelectOption<T>[]>();
value        = model<T | null>(null);           // [(value)] oppure [value] + (valueChange)
appearance   = input<'inline' | 'field'>('inline');
placeholder  = input<string | null>(null);      // voce "vuota" selezionabile (es. "Tutti", "— Nessuna categoria"); null = nessuna voce vuota
ariaLabel    = input<string | null>(null);      // obbligatorio se non c'è un <label> attorno
searchable   = input<boolean | 'auto'>('auto'); // 'auto' = ricerca se options.length > 8
searchPlaceholder = input('Cerca…');
emptyText    = input('Nessun risultato');
disabled     = input(false);
readonly     = input(false);                    // solo lettura: mostra il valore, niente chevron né pannello
```

Il componente implementa anche `ControlValueAccessor`, così `[(ngModel)]`/`[ngModel]` funzionano nel dettaglio prestito. Il `disabled` impostato dal CVA si combina in OR con l'input `disabled`.

**Mia scelta, non decisa dall'utente.** Per gli attributi ARIA della pagina:
- `aria-invalid` e `aria-describedby` si passano come input (`ariaInvalid`, `ariaDescribedBy`) e il componente li inoltra al trigger.
- Il componente accetta un `id` da applicare al trigger.

Così la pagina continua a scrivere i propri attributi, come vuole la proposal §16.3.

`VisualSelectOption`/`VisualSelectIcon` spariscono:
- `transaction-type-options.ts` passa a `SelectOption<TransactionType>` con le icone Lucide come `LucideIconData`;
- `transactions-table.model.ts` e gli altri consumatori si aggiornano.

### Struttura e ARIA (pattern "select-only combobox" + listbox, WAI-ARIA APG)

- Il trigger è un `<button type="button" role="combobox">` con questi attributi:
  - `aria-haspopup="listbox"`
  - `aria-expanded`
  - `aria-controls` → id della listbox
  - `aria-activedescendant` quando il pannello è aperto senza ricerca
- Il trigger mostra, in quest'ordine:
  - icona, oppure pallino colore, oppure niente;
  - il nome troncato con `title`;
  - un chevron `LucideChevronDown`.

  Un `<button>` dentro il `<label>` di `app-form-field` riceve sia il nome accessibile sia il click sull'etichetta.
- Pannello con ricerca:
  - `<input type="search" role="combobox" aria-autocomplete="list" aria-controls aria-activedescendant>`;
  - sotto, `<ul role="listbox">` con `<li role="option" aria-selected>`.
- Pannello senza ricerca: il fuoco resta sul trigger e la navigazione passa da `aria-activedescendant`.
- La voce vuota (`placeholder`) è un'opzione vera con valore `null`.
  - Ha testo muted ed è separata da un divisore.
  - Sta in cima quando funge da "Tutti" e in fondo quando è "Nessuna categoria".

  **Mia scelta:** un solo input `placeholderPosition: 'start' | 'end'`, default `'start'`.

### Comportamento

- **Apertura:**
  - click sul trigger;
  - `Invio`, `Spazio`, `↓` o `↑` sul trigger;
  - `Alt+↓`.

  All'apertura l'opzione attiva è quella selezionata, oppure la prima.
- **Ricerca:**
  - Riceve il fuoco all'apertura.
  - Filtra per *contiene*, ignorando maiuscole e accenti (`normalize('NFD')` senza diacritici).
  - La parte che corrisponde è evidenziata con `<mark>`.
  - Viene svuotata a ogni apertura.
  - La voce vuota resta sempre visibile.
  - Se nessuna voce corrisponde compare il messaggio `emptyText`.
- **Tastiera nel pannello:**
  - `↑`/`↓` spostano l'opzione attiva, `Home`/`End` vanno al primo e all'ultimo elemento. La lista scorre per tenere visibile l'opzione attiva.
  - `Invio` seleziona e chiude.
  - `Esc` chiude senza selezionare e riporta il fuoco al trigger.
  - `Tab` chiude senza selezionare e lascia avanzare il fuoco.
- **Senza ricerca:** digitando un carattere si salta alla prossima voce che comincia con quella lettera (type-ahead semplice).
- **Mouse:** l'hover rende attiva la voce, il click seleziona e chiude. Il click fuori chiude.
- **Dopo la selezione:**
  - emette `valueChange` solo se il valore è cambiato;
  - riporta il fuoco al trigger senza mostrare il focus ring fino al blur, come fa oggi `selectionMade`.
- **`readonly`:** mostra icona o pallino e il nome. Non mostra il chevron e non è interattivo; `readonly` non è un `<button>`, è testo.
- **`disabled`:** il trigger è disabilitato. Lo stile è quello di oggi: opacità 0.5 per `inline`, `--color-disabled-input` per `field`.

### Posizionamento

- Il pannello è `position: fixed` e la sua posizione si calcola da `getBoundingClientRect()` del trigger. In questo modo sfugge agli `overflow` dei contenitori senza CDK.
- Si apre sotto il trigger. Si apre sopra se sotto ci sono meno di ~240px e sopra ce n'è di più.
- Larghezza: minimo quella del trigger, massimo `20rem`, e comunque non oltre il viewport meno `--space-4`.
- Si riposiziona su `scroll` (capture) e su `resize` mentre è aperto.

**Mia scelta.** Valuto `popover="manual"` (top layer) per evitare problemi di `z-index`. Se in jsdom o nei browser supportati dà problemi, si ripiega su `fixed` + `z-index` alto. La decisione la prende chi implementa, documentandola.

### Stile (token)

- **Pannello:**
  - `background: var(--color-surface-elevated)`;
  - `border: var(--border-width) solid var(--color-border)`;
  - `border-radius: var(--radius-card)`;
  - `box-shadow: var(--shadow-dropdown)`.
- **Ricerca:**
  - riga senza bordo, separata dalla lista da `--color-border`;
  - icona `LucideSearch` muted;
  - typography `body`.
- **Lista:**
  - padding `--space-2`;
  - `max-height` di circa 15rem, con scroll.
- **Voce:**
  - padding `--space-3 --space-4`, `--radius-control`, typography `table-text` o `body` (secondo il mockup), gap `--space-4`;
  - voce attiva: `--color-surface-hover`;
  - voce selezionata: `LucideCheck` a destra in `--color-primary-hover`;
  - match evidenziato: `--color-primary-hover`, peso 600.
- **Trigger `field`:** riusa esattamente la regola globale. Le regole globali in `styles.scss` per `select` si estendono a `.select-trigger.field`, oppure diventano un mixin condiviso.

  **Mia scelta:** un mixin `form-control` in `_mixins.scss`, usato sia dalla regola globale sia dal trigger, per non duplicare.
- **Trigger `inline`:** le regole attuali di `visual-select.scss`, spostate.
- **Animazione:** solo all'apertura, con fade e un `translateY` di 4px in 120ms. È disattivata con `prefers-reduced-motion`.

## Migrazione dei consumatori

| Dove | Oggi | Dopo |
|---|---|---|
| `shared/ui/transactions-table.html` (tipo, categoria) | `app-visual-select` | `app-select appearance="inline"`. Per la categoria `placeholder="— Nessuna categoria"` in fondo. |
| `features/merchants/merchants-page.html` (categoria) | `app-visual-select` | idem |
| `shared/ui/transactions-pagination.html` (per pagina) | `<select>` nativo | `app-select appearance="field"`, 3 opzioni, niente ricerca |
| `features/dashboard/dashboard-page.html` (tipo) | `<select>` nativo | `field`, `placeholder="Tutti"`, icone del tipo |
| `features/loans/loans-page.html` (persona) | `<select>` nativo | `field`, `placeholder="Tutte le persone"`, ricerca auto |
| `features/loans/loan-detail-page.html` (movimento collegato) | `<select>` + `ngModel` | `app-select` + `ngModel`, `placeholder="Contanti — nessun movimento bancario"`, ricerca auto |
| `features/import/column-picker.html` (6 select) | `<select>` nativo + `aria-invalid` | `field`, `placeholder="— scegli la colonna —"`, `ariaInvalid`/`ariaDescribedBy` inoltrati |

Gli `id` numerici, come la dimensione pagina, vengono convertiti in stringa all'ingresso e in numero all'uscita dal consumatore.

Vanno rimossi:
- `visual-select.ts`, `.html`, `.scss` e `.spec.ts`;
- le regole `select`/`option` ormai inutilizzate in `styles.scss`, solo se nessun `<select>` resta nell'app;
- `form-fields.spec.ts`, se le verifica, va aggiornato.

## Test

- `select.spec.ts`, nuovo, deve coprire:
  - render del valore, con icona, pallino e placeholder;
  - apertura e chiusura (click, tastiera, Esc, Tab, click fuori);
  - navigazione con le frecce;
  - selezione da click e da Invio;
  - `valueChange` emesso solo al cambio;
  - ricerca: filtro, accenti, nessun risultato, soglia `auto`;
  - `readonly`/`disabled`;
  - attributi ARIA;
  - integrazione `ngModel` (host di test con `FormsModule`).
- Gli spec esistenti che cercano `app-visual-select select` vanno riscritti sul nuovo DOM (trigger, poi opzione):
  - `transactions-page.spec.ts:265` e `:401`;
  - `transactions-delete.spec.ts:272`;
  - `transactions-table.spec.ts:252` e `:272`.

  Lo stesso vale per gli spec di paginazione, dashboard, prestiti e import che pilotano `<select>`.
- `npm run gate`, `ng test` e `ng build` devono passare.

## Lasciato a chi implementa

- La scelta tra `popover` e `fixed` per il pannello (vedi sopra).
- Il dettaglio dei pixel entro i token: typography della voce e larghezza massima.
- Se estrarre il filtro senza accenti in una funzione pura condivisa con `toggle-list-group`, che ha già una ricerca.
- L'ordine dei commit e della migrazione. Suggerisco: componente, poi tabella e merchant, poi form, poi rimozione di `visual-select`.
