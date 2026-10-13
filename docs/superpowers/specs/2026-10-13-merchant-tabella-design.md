# Pagina merchant: tabella ordinabile e paginata — design

Data: 2026-10-13 · Stato: bozza da approvare

## Intento

La pagina `/merchants` oggi è, nelle parole dell'utente, «una lista infinita che non posso ordinare in nessun modo». L'uso più frequente è **controllare i merchant ancora da classificare** e assegnare loro una categoria. L'obiettivo è una pagina più semplice da navigare e gestire, costruita con i componenti shared come le altre pagine.

## Obiettivi

- Tabella **ordinabile** cliccando l'intestazione di ogni colonna, con `th[app-sortable-header]` (`shared/ui/data/sortable-header/`).
- Tabella **paginata** con lo stesso componente di paginazione delle transazioni, reso generico (vedi sotto).
- Stato della pagina (filtro, ricerca, ordinamento, pagina, dimensione pagina) nei **query param dell'URL**, come in `features/transactions/transaction-query.ts`: ricaricare o tornare indietro non perde il punto.
- Componenti shared al posto del codice scritto a mano:
  - filtro Tutti / Classificati / Da classificare → `app-choice-group` (lo stesso usato per la classificazione in analytics);
  - errore → `app-error-retry`;
  - nessun merchant / nessun risultato / tutto classificato → `app-empty-state`;
  - caricamento → skeleton di righe, come in `transactions-table-panel`;
  - totale speso → `app-amount`.
- Rinomina inline e cambio categoria nella riga restano come oggi (`PATCH /merchants/:id`, `PATCH /merchants/:id/category`).

## Decisioni dell'utente

- **Filtro di partenza: "Tutti".** Senza query param la pagina mostra tutti i merchant.
- **Una riga che non soddisfa più il filtro sparisce subito.** Su "Da classificare", assegnare una categoria toglie il merchant dalla lista e le righe sotto risalgono. Vale anche al contrario: su "Classificati", togliere la categoria fa sparire la riga.
- Ordinamento iniziale proposto e accettato: **numero di transazioni decrescente**, così si sistemano prima i merchant che pesano di più.
- **Ordinamento, filtro, ricerca e paginazione si fanno sul backend.** L'utente preferisce farlo ora, finché il codice è semplice.
- **Se una pagina resta vuota dopo un salvataggio si resta sulla pagina** e si mostra uno stato vuoto dedicato (vedi "Pagina svuotata").

## Non-obiettivi

- Cambiare `GET /merchants/summary`: lo usano anche transazioni e analytics per le opzioni dei filtri, e resta identico.
- Azioni nuove: eliminazione, unione di merchant, classificazione in blocco, selezione multipla.
- KPI o grafici in testa alla pagina.
- Un componente tabella generico condiviso: la tabella resta nel template della pagina, usando mixin `data-table` e `app-sortable-header`.
- Toccare la pagina prestiti, che ha gli stessi bottoni filtro scritti a mano: è un lavoro a parte.

## Anti-obiettivi

- Perdere la posizione mentre si classifica: dopo un salvataggio la pagina corrente, l'ordinamento e la ricerca restano quelli di prima (salvo il caso della pagina svuotata, sotto).
- Mostrare lo skeleton o far lampeggiare la tabella quando, dopo un salvataggio, si ricarica la pagina corrente.
- Regressioni sulle transazioni e su analytics dovute alla generalizzazione della paginazione.
- Colori, spaziature o font letterali: `npm run gate` deve passare senza nuovi `ds-exception`.

## Il comportamento

### Colonne e ordinamento

| Colonna | Campo | Ordinamento | Primo clic |
|---|---|---|---|
| Nome | `label` | alfabetico, `localeCompare` it, senza distinzione maiuscole | asc |
| Categoria | `category.name` | alfabetico; i merchant senza categoria vanno in fondo in entrambe le direzioni | asc |
| Transazioni | `transactionCount` | numerico | desc |
| Totale speso | `totalSpent` | numerico | desc |
| Ultima transazione | `lastTransactionDate` | data; `null` in fondo | desc |

- Clic sulla colonna attiva: inverte la direzione. Clic su un'altra colonna: la attiva con la direzione del "primo clic" della tabella *(scelta di Claude: testi in asc e numeri/date in desc è ciò che ci si aspetta; le transazioni partono sempre da desc perché hanno solo colonne data/importo)*.
- A parità di valore si ordina per `label` asc, così l'ordine è stabile tra un caricamento e l'altro.
- Cambiare ordinamento, filtro, ricerca o dimensione pagina riporta a pagina 1.

### Paginazione

- Dimensioni 25 / 50 / 100, default 25, come nelle transazioni.
- Barra di paginazione **sotto** la tabella *(scelta di Claude; le transazioni la hanno sopra e sotto, qui una sola basta)*. Mostra "41–60 di 279 merchant".
- Dopo un salvataggio riuscito si ricarica **la pagina corrente** dal server, mantenendo a video le righe attuali finché arriva la risposta. Così la riga che non soddisfa più il filtro sparisce e la prima riga della pagina successiva risale al suo posto.

### Pagina svuotata

Si ha quando la pagina richiesta è oltre l'ultima ma ci sono ancora risultati (`items` vuoto, `total > 0`). Capita classificando l'ultima riga dell'ultima pagina, oppure aprendo un URL con una `page` troppo alta. La pagina **non cambia** da sola. Al posto della tabella compare `app-empty-state`:

- messaggio: "Hai sistemato tutti i merchant di questa pagina." *(testo di Claude)*;
- suggerimento: "Ne restano N nelle pagine precedenti.";
- azione: "Vai all'ultima pagina", che porta a `totalPages`.

La barra di paginazione resta visibile, così si può anche scegliere un'altra pagina.

### Filtro e ricerca

- `app-choice-group` con tre voci, il conteggio nell'etichetta: "Tutti (312)", "Classificati (280)", "Da classificare (32)" *(scelta di Claude)*. I conteggi arrivano dal backend e sono sull'intero archivio, non sulla ricerca.
- La ricerca si fa sul backend con le regole di oggi (`label` o `name`, senza distinzione maiuscole) e finisce nell'URL come `search`. Aggiorna l'URL con `replaceUrl` per non riempire la cronologia a ogni tasto *(scelta di Claude)*.

### Stati della pagina

| Situazione | Cosa si vede |
|---|---|
| Caricamento iniziale | skeleton di righe al posto della tabella |
| Errore nel caricamento | `app-error-retry` con "Riprova" che rilancia la richiesta |
| Nessun merchant | `app-empty-state`: "Nessun merchant. Importa un estratto conto per iniziare." |
| Filtro "Da classificare", ricerca vuota, zero risultati | `app-empty-state`: "Tutti i merchant sono stati classificati." |
| Altri zero risultati | `app-empty-state`: "Nessun merchant corrisponde alla ricerca." con azione per azzerare ricerca e filtro |
| Pagina oltre l'ultima, con risultati | stato vuoto dedicato (vedi "Pagina svuotata") |
| Errore su un salvataggio | messaggio d'errore sopra la tabella; si ricarica la pagina corrente, così la riga torna al valore salvato |

Il bottone "Aggiorna" nell'intestazione resta.

## Struttura del codice

### Backend

**`GET /merchants?search=&classification=&page=&pageSize=&sortBy=&sortDirection=`**, uniforme al resto dell'API. **Decisione dell'utente:** restare uniformi alle rotte esistenti.

Convenzione già in uso:

- `GET /transactions` e `GET /loans` sono la collezione stessa, con i criteri in query string. Non c'è una sotto-rotta come `/page` o `/search`.
- La rotta ha sopra un commento con l'elenco dei parametri (`// GET /loans?status=…&sortBy=&sortDirection=`).
- Passa ogni parametro grezzo con `queryParam(req.query.x, 'x')` a una funzione `parse<Entità>Query` nel file `<entità>-query.ts` del modulo (`transactions/transaction-query.ts`, `loans/loan-query.ts`). Poi chiama il service (`transactionsService.search(query)`) e il DTO di pagina (`toTransactionPageDto`).

Quindi:

- **Sostituisce la risposta di `GET /merchants`.** Oggi restituisce l'elenco completo con categoria, ma nessun client la chiama: il frontend usa solo `/merchants/summary` e le due `PATCH`. `listAllWithCategory()` resta nel service, perché la usano transazioni e test.
- **Nuovo `merchants/merchant-query.ts`** con `MerchantQuery`, `MERCHANT_SORT_FIELDS` (`name` | `category` | `transactionCount` | `totalSpent` | `lastTransactionDate`), `DEFAULT_MERCHANT_QUERY` e `parseMerchantQuery(input)`. Il file:
  - riusa da `transactions/index.ts` `ClassificationFilter`, `CLASSIFICATION_FILTERS`, `SortDirection`, `PAGE_SIZES` e `DEFAULT_PAGE_SIZE`, invece di ridefinirli. Il modulo `merchants` dipende già da `transactions`;
  - segue `parseTransactionQuery` per le regole di validazione. I valori non validi danno `ValidationError` (400).
- **Default:** `classification=all`, `page=1`, `pageSize=25`, `sortBy=transactionCount`, `sortDirection=desc`.
- **Service e DTO:** `merchantsService.search(query)` → `MerchantPage`, convertito da `toMerchantPageDto` in `merchants.dto.ts`.
- **Risposta:**

  ```ts
  interface MerchantPageDto {
    items: MerchantSummaryDto[];
    pagination: { page; pageSize; total; totalPages };  // stessa forma di TransactionPageDto
    counts: { all; classified; unclassified };          // sull'intero archivio, ignorano search
  }
  ```

  - `total` e `totalPages` contano i risultati dopo ricerca e filtro.
  - Una `page` oltre l'ultima restituisce `items: []` con la `pagination` reale: è il frontend a mostrare lo stato "Pagina svuotata".
- **Calcolo:** nel service, sopra `listSummaries()`: filtro, ricerca, ordinamento con le regole della tabella "Colonne e ordinamento", poi la fetta della pagina *(scelta di Claude)*. Le statistiche arrivano dal modulo `transactions` tramite `transactionsService.statsByMerchant()`. Una query SQL unica dovrebbe unire tabelle di due moduli e scavalcare il confine fra feature; con qualche centinaio di merchant il calcolo in memoria non pesa. Il contratto HTTP resta quello anche se un giorno si passa a SQL.
- **Test:** `node:test` come `merchants.service.test.ts` e `transactions.routes.test.ts`. Coprono ordinamento per ogni colonna e direzione (con i `null` in fondo e il pareggio su `label`), filtro, ricerca, paginazione, `counts`, pagina oltre l'ultima e parametri non validi.

### Paginazione generica

`shared/transactions/transactions-pagination/` diventa `shared/ui/data/pagination/` con selettore `app-pagination` *(scelta di Claude)*:

- modello `Pagination { page, pageSize, total, totalPages }` e `PAGE_SIZES = [25, 50, 100]`;
- nuovo input `itemLabel` (plurale, es. `'transazioni'`, `'merchant'`) usato in "N–M di T …" e "Nessun …"; obbligatorio, così ogni chiamante dice cosa sta contando;
- logica (`range`, `slots`) invariata.

Si aggiornano tutti gli usi: `transactions-table-panel`, `transaction-query.ts` (import di `PAGE_SIZES`) e gli spec che cercano `app-transactions-pagination` (`transactions-page.spec.ts`, `analytics-transactions.spec.ts`). Il comportamento per le transazioni non cambia.

### Frontend: stato nell'URL

In `features/merchants/`:

- `merchant-query.ts`: stato `{ classification, search, sortBy, sortDirection, page, pageSize }`, `parseMerchantQuery(ParamMap)` tollerante come `parseTransactionQuery` del frontend (valori sconosciuti → default), la serializzazione verso query param che omette i default e la costruzione della richiesta per `httpResource`.
- `MerchantsApi` ottiene il tipo `MerchantPage`. `summary()` resta per analytics e transazioni.
- `merchant-filter.ts` e il suo spec si eliminano: filtro e ricerca passano al backend.

Spec Vitest per `merchant-query.ts`, con descrizioni in italiano.

### La pagina

- Stato da `toSignal(route.queryParamMap)` → `computed(parseMerchantQuery)`; le azioni chiamano `router.navigate` con i nuovi parametri.
- Caricamento con `httpResource(() => merchantPageRequest(query()))`, come transazioni e prestiti. Dopo un salvataggio, `reload()`.
- La tabella usa il mixin `data-table` e `th[app-sortable-header]` per ogni colonna.
- Si eliminano gli stili `.filters`, `.message` e `.count` che diventano inutili.

## Lasciato a chi implementa

- Numero di righe dello skeleton e il markup esatto.
- Se la ricerca debounce l'aggiornamento dell'URL.
- Come la riga in salvataggio viene segnalata (oggi `savingId` disabilita i controlli).
