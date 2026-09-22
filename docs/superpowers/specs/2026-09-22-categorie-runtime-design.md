# Categorie gestibili a runtime: fonte di verità unica

Data: 2026-09-22

## Contesto e motivazione

Oggi le categorie iniziali vivono in due file che devono restare sincronizzati manualmente:

- `apps/backend/drizzle/0003_seed_categories.sql` — la migrazione applicata una sola volta al primo avvio
- `apps/backend/src/modules/categories/categories.seed.ts` — usato esclusivamente dall'operazione di azzeramento archivio (`resetService.run()`) per ripristinare il set fisso di categorie

Un test (`categories.seed.test.ts`) verifica che i due elenchi coincidano. Questo è un sintomo: aggiungere una categoria richiede di ricordarsi di toccare due file, e dimenticarne uno produce un comportamento silenziosamente sbagliato (scoperto solo usando l'app, come già successo).

La causa root è che le categorie sono trattate come un elenco statico compilato nel codice, quando invece l'utente vuole poterle gestire (creare, modificare, eliminare) mentre l'applicazione è in esecuzione, senza rebuild né riavvio.

## Decisioni chiave (concordate con l'utente)

1. **Reset dell'archivio**: le categorie (incluse quelle create dall'utente) **non vengono più azzerate**. L'azzeramento resta un'operazione sui dati transazionali (transazioni, merchant, prestiti, impostazioni); le categorie diventano configurazione stabile, non dato da ripristinare.
2. **Eliminazione di una categoria in uso**: i merchant assegnati alla categoria eliminata vengono **riassegnati automaticamente** a "Da classificare", in una transazione atomica con la cancellazione.
3. **"Da classificare" è protetta**: non può essere rinominata né eliminata (è il fallback strutturale del punto 2). Il suo colore resta modificabile. Tutte le altre 23 categorie del seed iniziale sono invece trattate come qualunque categoria creata dall'utente: rinominabili ed eliminabili.
4. **Scope**: backend (API CRUD) e frontend (pagina di gestione) in un unico lavoro.
5. **Alert di eliminazione**: il frontend deve poter avvisare l'utente, **prima** che confermi l'eliminazione, di quanti merchant verranno riassegnati.

## Architettura generale: la nuova fonte di verità

Una volta che il reset non tocca più le categorie e che queste sono gestibili via CRUD, l'unica fonte di verità naturale è **il database**:

- La migrazione SQL resta responsabile solo del **bootstrap iniziale** (database vuoto al primo avvio) — nessun cambiamento a `0003_seed_categories.sql` in questo lavoro, oltre a quanto già allineato in precedenza (24 categorie, incluse "Regali" e "Rimborso").
- `categories.seed.ts` e `categories.seed.test.ts` **vengono eliminati**: non c'è più un secondo elenco da mantenere, quindi non c'è più nulla da testare per sincronia.

Non è necessaria alcuna migrazione dello schema `categories` (`id`, `name` univoco, `color`).

## Backend

### Categoria protetta

Nessuna colonna nuova nello schema per un singolo caso: si riusa il pattern già presente nel progetto per `SETTINGS_ID` — una costante esportata (es. `FALLBACK_CATEGORY_ID`, valorizzata con l'id fisso di "Da classificare", `c9bfcd74-e342-4a3f-8b0c-116f89236d51`) referenziata dal service.

### `categories.service.ts` — nuove operazioni

- **`create({ name, color })`**
  - Valida che `name` non sia vuoto (Zod a livello route + controllo service).
  - L'unicità del nome è garantita dal vincolo `UNIQUE` del DB; la violazione viene tradotta in `ConflictError` ("Esiste già una categoria con questo nome").
- **`update(id, { name?, color? })`**
  - Se `id === FALLBACK_CATEGORY_ID` e la richiesta include `name` → `ConflictError` ("«Da classificare» non può essere rinominata").
  - Il colore è sempre modificabile, "Da classificare" inclusa.
  - `id` inesistente → `NotFoundError`.
- **`remove(id)`**
  - Se `id === FALLBACK_CATEGORY_ID` → `ConflictError` ("«Da classificare» non può essere eliminata").
  - `id` inesistente → `NotFoundError`.
  - Altrimenti, in un'unica transazione atomica (pattern `atomically()` già usato in `reset.service.ts`):
    1. `UPDATE merchants SET category_id = FALLBACK_CATEGORY_ID WHERE category_id = :id`
    2. `DELETE FROM categories WHERE id = :id`
  - Nessuna modifica allo schema/FK richiesta: la riassegnazione precede sempre la cancellazione, quindi il vincolo referenziale non viene mai violato.
- **`usage(id)`**
  - Restituisce quanti merchant sono attualmente assegnati alla categoria (per l'endpoint dedicato, vedi sotto).

### `categories.repository.ts` — nuovi metodi

- `insert(category)`, `update(id, patch)`, `remove(id)`
- `countMerchantsByCategory()` — query aggregata (`GROUP BY category_id`) usata per arricchire `findAll()` con `merchantCount`
- `countMerchantsForCategory(id)` — usata dall'endpoint `/usage`
- `reassignMerchants(fromId, toId)` — l'`UPDATE` della transazione di `remove`

### `categories.routes.ts` — nuove route

Stile coerente con `merchants.routes.ts` (Zod per il body, `json()` middleware, eccezioni di dominio catturate dall'error handler globale):

- `GET /categories` — invariata nel path, il DTO ora include `merchantCount` per categoria
- `GET /categories/:id/usage` — `{ merchantCount: number }`, endpoint dedicato (non consumato dal frontend in questo lavoro, disponibile per usi futuri)
- `POST /categories` — body `{ name: string, color?: string | null }` → 201 con la categoria creata
- `PATCH /categories/:id` — body `{ name?: string, color?: string | null }` → 200 con la categoria aggiornata
- `DELETE /categories/:id` — 204, nessun corpo (il conteggio è già stato mostrato al frontend prima della conferma, tramite `merchantCount` da `GET /categories`)

### `reset.service.ts` — cosa cambia

- `userTables()` esclude esplicitamente `categories` (unica eccezione manuale alla regola "chiedi al DB, non elencare a mano" — motivata dal fatto che le categorie non sono più dato utente azzerabile).
- Il blocco che re-inserisce `CATEGORY_SEED` dopo lo svuotamento viene rimosso.
- `ResetOutcome.seededCategories` viene rimosso dall'interfaccia e dalla risposta dell'endpoint `/maintenance/reset`.
- I commenti del file che descrivono il comportamento attuale ("le ventidue categorie iniziali... vengono reinserite") vengono riscritti per riflettere che le categorie sopravvivono al reset.

## Frontend

### `categories.api.ts`

Estensione con lo stesso pattern di `merchants.api.ts` (HttpClient diretto, `Observable`, un service per dominio):

- `list()` — DTO arricchito con `merchantCount`
- `create({ name, color })`
- `update(id, { name?, color? })`
- `delete(id)`

L'endpoint `/usage` non viene wrappato lato frontend in questo lavoro (nessun consumatore).

### Nuova pagina `features/categories/`

- `categories-page.ts` / `.html` / `.scss`, standalone, stato via `signal()`/`computed()` (nessun form reattivo, coerente col resto del progetto)
- Lista categorie: nome, swatch colore, conteggio merchant assegnati
- Creazione: form con nome (input testo) e colore (`<input type="color">` nativo — non esiste un color-picker nel progetto, non se ne introduce uno per YAGNI)
- Modifica inline di nome/colore per riga
- Eliminazione con **pattern a due passi** identico a quello di `transactions-page.ts` (signal `confirmingDelete`, primo click mostra l'avviso con il conteggio merchant preso da `merchantCount`, secondo click esegue)
  - Messaggio: *"Questa categoria è assegnata a N merchant. Eliminandola, verranno spostati su «Da classificare». Eliminare definitivamente?"*
- Riga "Da classificare": bottoni di rinomina ed eliminazione disabilitati/nascosti (identificata via costante `FALLBACK_CATEGORY_ID`, duplicata lato frontend come già avviene per altre costanti di dominio)
- Errori (es. nome duplicato) mostrati con il pattern `toErrorMessage` già in uso

### Routing

- Nuova route `categories` in `app.routes.ts`, posizionata tra `merchants` e `import`
- Nuovo link `<a routerLink="/categories">` in `app.html`

## Testing

- `categories.service.test.ts` (nuovo): create, update (incluso blocco rename su "Da classificare"), remove (blocco delete su "Da classificare", riassegnazione merchant, atomicità — un fallimento a metà non deve lasciare merchant orfani)
- `categories.routes.test.ts` (nuovo): POST/PATCH/DELETE/usage, inclusi i casi di errore (409 su nome duplicato, 409 su modifica/eliminazione della categoria protetta, 404 su id inesistente)
- `reset.service.test.ts` (aggiornato): l'asserzione "le categorie tornano al seed" diventa "le categorie, incluse quelle custom, non cambiano durante il reset"
- `maintenance.routes.test.ts` (aggiornato): rimossa l'asserzione su `seededCategories`
- **Eliminati**: `categories.seed.ts`, `categories.seed.test.ts`
- Frontend: nuovo `categories-page.spec.ts` seguendo il pattern degli spec esistenti

## Impatto e rischi

- Nessuna migrazione di schema: `categories` resta invariata.
- Punto più delicato: l'atomicità di `remove()` (riassegnazione + delete nella stessa transazione) — deve essere testata esplicitamente.
- Il resto è additivo (nuovi endpoint, nuova pagina) e non tocca flussi esistenti, salvo il comportamento del reset, cambiato intenzionalmente e concordato.
