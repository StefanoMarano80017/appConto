# Pagina categorie: griglia di tessere compatte — design

Data: 2026-10-13 · Stato: bozza da approvare

## Intento

La pagina `/categories` oggi è, nelle parole dell'utente, «una tabella molto larga con poche colonne»: non è intuitivo come modificare un nome, si scrolla molto e non c'è ordinamento. L'uso più frequente è **modificare nomi e colori** delle categorie esistenti, quindi quelle due azioni devono essere immediate e riconoscibili a colpo d'occhio.

L'utente ha scelto, fra tre mockup (griglia di tessere, elenco + pannello di modifica, tabella densa su due colonne), la **griglia di tessere compatte**.

## Obiettivi

- Ogni categoria è una **tessera** bassa: quadratino colore, nome, numero di merchant. Le tessere stanno in una **griglia responsiva**: al massimo 3 colonne su desktop (decisione dell’utente dopo la prima versione, per leggibilità), una su schermi stretti. Con le 24 categorie del seed la pagina si vede quasi tutta senza scroll.
- **Rinomina inline esplicita**: clic sul nome → la tessera diventa un campo con bordo e anello di focus evidenti.
- **Colore** dal quadratino, con `app-color-picker` (`appearance="inline"`).
- **Ricerca** e **ordinamento** nella toolbar.
- **Creazione** da un pulsante «+ Nuova categoria» nella toolbar, al posto del form sempre visibile in cima.
- Componenti shared dove esistono: `app-search-input`, `app-color-picker`, `app-empty-state`, `app-error-retry`, `app-section-header`, `app-panel`.

## Decisioni dell'utente

- **Layout A, griglia di tessere** (mockup `.superpowers/brainstorm/…/layout.html`, opzione A).
- La descrizione del comportamento riportata in chat (rinomina, colore, elimina da menu ⋯ — poi sostituito da un pulsante cestino, vedi «Dettagli risolti» —, lucchetto su «Da classificare», toolbar con ricerca / ordina / nuova categoria, tutto lato client) è stata approvata così com'è.

- **Bozza di creazione senza bordo colorato** (scelta fra tre mockup, opzione A): contorno tratteggiato `--color-border-strong`, sfondo trasparente, nessun anello di focus, segnaposto «Nome della nuova categoria».
- **Animazioni** all'entrata della bozza e della categoria appena creata (dissolvenza con leggera salita, 220ms) e all'uscita di quella eliminata (dissolvenza con leggero rimpicciolimento, 180ms). Caricamento, ricerca e riordino restano istantanei; `prefers-reduced-motion` le spegne.

## Non-obiettivi

- Toccare il backend: `GET /categories` restituisce già tutte le categorie con `merchantCount`; `POST`, `PATCH`, `DELETE /categories/:id` restano identici.
- Nuovi dati sulla tessera (spesa totale, numero di transazioni, grafici).
- Selezione multipla, eliminazione in blocco, riordino manuale con trascinamento.
- Paginazione: le categorie sono poche e arrivano tutte insieme.
- Stato della pagina nei query param dell'URL *(scelta di Claude: con ordinamento e ricerca lato client su ~25 elementi non vale la complessità; si può aggiungere dopo)*.
- Un componente «tessera» condiviso in `shared/`: la tessera vive nella feature finché non ha un secondo uso.

## Anti-obiettivi

- Che il nome non sembri modificabile: il nome è un pulsante con sfondo al passaggio del mouse e cursore testo. *(La matita della prima versione è stata tolta su richiesta dell’utente: l’unica modifica è il nome, già cliccabile.)*
- Salvare un nome per errore: si salva solo con Invio o uscendo dal campo con un valore cambiato e non vuoto; Esc annulla sempre.
- Una tessera che cambia altezza o fa saltare la griglia entrando in modifica o in conferma di eliminazione oltre lo stretto necessario.
- Colori, spaziature, raggi o font letterali: `npm run gate` deve passare senza nuovi `ds-exception`. La regola speciale del raggio da 4px della vecchia cella di rinomina sparisce insieme alla tabella.
- Regressioni sul comportamento esistente: protezione di «Da classificare», messaggio sullo spostamento dei merchant all'eliminazione, ricarica della lista dopo un salvataggio fallito.

## Il comportamento

### Struttura della pagina

```
app-page-layout
└ app-panel
  ├ app-section-header  "Categorie" · "Crea, rinomina o elimina le categorie di spesa."  [Aggiorna]
  ├ toolbar: [app-search-input] [Ordina ▾] ············· [+ Nuova categoria]
  ├ messaggio d'errore (se c'è)
  └ griglia di tessere | skeleton | stato vuoto | app-error-retry
```

- Griglia: `repeat(auto-fill, minmax(max(18rem, (100% - 2 gap) / 3), 1fr))`, gap `--space-4`: al massimo 3 colonne, meno sotto i 18rem per tessera, una su schermi stretti.
- Toolbar come in `merchants-page.scss` (`.toolbar`): flex, a capo su schermi stretti.

### La tessera

Da sinistra a destra: quadratino colore · nome (troncato con ellissi, `title` col nome completo) · lucchetto (solo per la categoria protetta) · numero di merchant (cifre tabellari, colore muted) · pulsante cestino.

Stile: sfondo `--color-surface`, bordo `--color-border`, raggio `--radius-input`, hover `--color-surface-elevated`. Altezza costante a riposo.

| Stato | Aspetto |
|---|---|
| riposo | come sopra |
| in modifica del nome | il nome diventa un `<input>`, bordo `--color-primary` e anello `--color-focus-ring` (mixin `form-control-focus`); cestino nascosto |
| salvataggio in corso | tessera attenuata (opacità 0,6, *non* sul color picker aperto: vedi il commento esistente in `categories-page.scss`), controlli disabilitati |
| conferma eliminazione | il contenuto della tessera è sostituito da: «N merchant verranno spostati su «Da classificare». Eliminare?» + [Sì, elimina] [Annulla]. La tessera può crescere in altezza solo qui |
| protetta («Da classificare») | lucchetto, nome non cliccabile, nessun cestino; il colore resta modificabile (come oggi) |

`aria-label` coerenti con l'attuale pagina: «Nome di X», «Colore di X», «Azioni per X».

### Rinomina

- Si entra in modifica con un clic sul nome (è un `<button>`, raggiungibile da tastiera, `aria-label` «Rinomina X»); il campo prende il focus con il testo selezionato.
- **Invio** o **blur** con valore cambiato e non vuoto (dopo `trim`) → `PATCH { name }`. Valore vuoto o invariato → esce dalla modifica senza salvare.
- **Esc** → esce senza salvare, ripristinando il nome.
- Una sola tessera in modifica alla volta: aprirne un'altra chiude (con salvataggio, se cambiato) la precedente tramite il blur *(scelta di Claude)*.
- Errore (es. nome duplicato): messaggio d'errore sopra la griglia, lista ricaricata come oggi (`save` → `load()`), la tessera torna al nome salvato.

### Colore

- Clic sul quadratino → `app-color-picker` inline. `(valueCommitted)` → `PATCH { color }`, come nell'attuale `recolor`.

### Eliminazione

- Un pulsante icona cestino (vedi «Dettagli risolti») avvia la conferma: a riposo nessun bottone rosso testuale per tessera.
- La conferma resta dentro la tessera (vedi stati). Logica invariata: `askDelete` / `cancelDelete` / `deleteCategory`.
- Esc nella conferma equivale ad Annulla.

### Ricerca

- `app-search-input`, placeholder «Cerca categoria…». Filtra lato client, senza debounce, per sottostringa del nome senza distinzione di maiuscole né accenti *(scelta di Claude: con `localeCompare`/normalizzazione NFD)*.
- Nessun risultato → `app-empty-state` «Nessuna categoria corrisponde alla ricerca.» con azione «Azzera ricerca».

### Ordinamento

Controllo «Ordina» con quattro voci; uso di `app-select` con `SelectOption` *(scelta di Claude: è il controllo a tendina già esistente; un `app-choice-group` a quattro voci occuperebbe troppo spazio in toolbar)*:

| Voce | Criterio |
|---|---|
| Nome A→Z (predefinito) | `localeCompare(…, 'it', { sensitivity: 'base' })` asc |
| Nome Z→A | idem desc |
| Più merchant | `merchantCount` desc |
| Meno merchant | `merchantCount` asc |

- A parità si ordina per nome A→Z.
- «Da classificare» segue l'ordinamento come le altre *(scelta di Claude: tenerla fissa in cima aggiungerebbe un'eccezione senza un bisogno espresso)*.
- Un salvataggio che cambia il nome riposiziona la tessera secondo l'ordinamento corrente.
- La scelta non persiste fra una visita e l'altra *(scelta di Claude)*.

### Creazione

- «+ Nuova categoria» inserisce **in cima alla griglia**, fuori dall'ordinamento, una tessera di bozza già in modifica: quadratino colore (grigio predefinito `#9aa3af`, modificabile prima di salvare) + campo nome con focus.
- Invio con nome non vuoto → `POST { name, color }`; la categoria creata entra nella griglia al suo posto secondo l'ordinamento e la bozza sparisce. Esc o blur con nome vuoto → la bozza sparisce.
- Durante la creazione il pulsante è disabilitato; un errore (`createError`) appare sopra la griglia e la bozza resta aperta col testo inserito.
- Se c'è una ricerca attiva la bozza compare comunque *(scelta di Claude)*.

### Caricamento, errori, vuoto

- Primo caricamento: skeleton di tessere (griglia di rettangoli pulsanti, come lo skeleton di righe in `merchants-page.scss`, `prefers-reduced-motion` rispettato).
- Errore di caricamento: `app-error-retry` con «Riprova» → `load()`.
- Errore di salvataggio/eliminazione: paragrafo `role="alert"` sopra la griglia (come `.save-error` in merchant).
- Nessuna categoria: `app-empty-state` «Nessuna categoria.» con azione «Crea la prima categoria».

## Vincoli tecnici

- Angular standalone, signals, controllo flusso `@if`/`@for`, come il resto delle feature. Lista filtrata e ordinata in un `computed`.
- Le modifiche non committate attuali (passaggio da `<input type="color">` ad `app-color-picker`, nuova cartella `shared/ui/forms/color-picker/`, riformattazione di `select.html`) sono il punto di partenza: vanno committate prima o insieme a questo lavoro, non scartate.
- Icone da `@lucide/angular` (es. `LucidePencil`, `LucideLock`, `LucideEllipsis`, `LucidePlus`), come nel resto dell'app.
- Test: aggiornare `categories-page.spec.ts` per coprire rinomina (Invio, blur, Esc, vuoto), ordinamento, ricerca, creazione da bozza, eliminazione con conferma, categoria protetta.
- `npm run gate` verde.

## Dettagli risolti dopo la revisione *(scelte di Claude)*

- **Quadratino colore = trigger di `app-color-picker` così com'è** (`appearance="inline"`, chevron compreso). Nessuna modifica al componente shared in questo lavoro.
- **Pannello del picker `position: fixed`** (`color-picker.scss`): sulla tessera e sui suoi antenati niente `opacity`, `transform`, `filter`, `contain` o `overflow: hidden`. L'attenuazione del salvataggio si applica ai singoli figli tranne il picker, come nel commento attuale; l'ellissi del nome sta su un elemento interno.
- **Blur e controlli della stessa tessera**: il salvataggio/annullo al blur scatta su `focusout` solo se `relatedTarget` è fuori dalla tessera. Nella bozza di creazione, aprire il color picker non la chiude; la bozza sparisce solo con Esc o con il focus che lascia la tessera a nome vuoto. Cliccare un'altra tessera salva la modifica in corso (se il valore è cambiato e non vuoto).
- **Salvataggi concorrenti**: `savingId` diventa un insieme di id in corso (`signal<ReadonlySet<string>>`), così due salvataggi ravvicinati su tessere diverse non si sovrascrivono lo stato.
- **⋯ → pulsante icona cestino** (`LucideTrash2`, colore muted, rosso al hover), non un menu: nessun dropdown nuovo da costruire.
- **Bozza e stati vuoti**: la bozza compare sopra qualunque stato (anche con «nessun risultato» o lista vuota); «Crea la prima categoria» apre la stessa bozza del pulsante in toolbar.

## Lasciato al builder

- Larghezza minima delle tessere, gap esatti, dimensione del quadratino e delle icone (entro i token).
- Struttura interna del componente: tutto nella pagina o una sottocomponente `category-tile` dentro `features/categories/`.
