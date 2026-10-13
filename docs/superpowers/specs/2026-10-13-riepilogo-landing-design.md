# Pagina Riepilogo: landing essenziale — design

Data: 2026-10-13 · Stato: bozza da approvare

## Intento

Il Riepilogo (`/`, `features/dashboard`) oggi è, nelle parole dell'utente, «confusionario, con errori grafici e un contenuto informativo che non riesco a comprendere a pieno». Deve diventare una **landing page veloce**: pochi dati utili per capire come sta andando il mese e se i numeri sono affidabili, e da lì rimandare alle pagine di approfondimento (Analytics, Movimenti, Merchant, Prestiti, Import).

Il criterio dell'utente: non vince chi mostra più informazioni, ma chi fa capire la situazione e cosa merita attenzione con il minimo rumore e la minima duplicazione delle altre pagine.

## Problemi della versione attuale (verificati sui dati reali)

- All'apertura mostra il mese di calendario: oggi (13/10) è vuoto perché l'ultimo movimento importato è del 21/09. Si vedono zeri e un «−100% vs settembre» verde.
- Due «saldi» diversi: «Saldo» (entrate − uscite) e «Disponibile» (liquidità).
- «Disponibile» non è affidabile: saldo iniziale 0 € al 01/08/2025, l'avviso «saldo non impostato» non compare perché la data c'è; a settembre il saldo di apertura risulta −1.359,68 €.
- Le uscite non dicono che i prelievi in contanti (11.265 € dal 08/2025, contro 7.060 € di spese) sono esclusi.
- Il confronto mensile mette a paragone un mese in corso con un mese intero; spese in negativo più variazioni in negativo danno doppi negativi («−42,70 → 0,00 → −42,70» in verde); la colonna variazione usa un carattere diverso dagli importi.
- «Spese per categoria» e «Confronto» ripetono lo stesso elenco; il drill-down a tre livelli di `<details>` e i filtri tipo/categoria/merchant replicano Analytics con uno stato che non è nell'URL.
- La risposta di `GET /dashboard` contiene tutte le transazioni del mese, usate solo per risolvere l'etichetta di un filtro.

## Obiettivi

La pagina ha quattro blocchi, in quest'ordine:

```
┌ ‹  Settembre 2026  › ─────────────────── Dati aggiornati al 21/09 ┐
│ ENTRATE        USCITE              RISULTATO DEL MESE              │
│ +1.780,35 €    −134,95 €           +1.645,40 €                     │
│                ↓ 84% vs agosto                                     │
│ Prelevati in contanti 0,00 € · non inclusi nelle uscite            │
└────────────────────────────────────────────────────────────────────┘
┌ Dove sono andati i soldi ──────────┐ ┌ Da sistemare ───────────────┐
│ ■ Intrattenimento  42,70 €  32% ↑  │ │ 17 merchant da classificare →│
│ ■ Carburante       30,00 €  22% ↓  │ │ Ultimo movimento 21/09       │
│ ■ Tabacco          23,20 €  17%    │ │   Importa estratto conto    →│
│ ■ Bar e caffè      15,10 €  11%    │ ├ Prestiti ───────────────────┤
│ ■ Shopping         10,60 €   8%    │ │ Da ricevere 1.030 € · 2 aperti→│
│ Analisi completa →                 │ │                              │
└────────────────────────────────────┘ └─────────────────────────────┘
┌ Ultimi movimenti ──────────────────────────────── Tutti i movimenti → ┐
│ 21/09  HOPPY ENDING NAPOLI     ■ Tempo libero             −7,00 €      │
│ … 5 righe                                                              │
└────────────────────────────────────────────────────────────────────────┘
```

Sotto ~900px le due colonne centrali si impilano (prima «Dove sono andati i soldi», poi «Da sistemare»/«Prestiti»). Il mockup è indicativo: i valori sono quelli di settembre 2026.

### 1. Testata: mese e aggiornamento dati

- Navigazione a frecce ‹ › fra i mesi, con il nome del mese al centro. Il mese sta nell'URL: `/?month=YYYY-MM`. Ricaricare o tornare indietro dal browser non perde il mese.
- **Senza `month` nell'URL** la pagina mostra il **mese dell'ultimo movimento importato** (decisione dell'utente), limitato al mese di calendario corrente se ci fossero movimenti con data futura. Se l'archivio è vuoto, il mese di calendario.
- Un `month` non valido nell'URL si ignora, come se mancasse. Un mese futuro è riportato al mese di calendario corrente.
- La freccia › è disabilitata sul mese di calendario corrente; non si va nel futuro. La freccia ‹ non ha limite.
- **L'orologio è quello del backend:** la risposta include `today` (YYYY-MM-DD) e il frontend ne deriva mese corrente, freccia › e soglia dei 7 giorni, senza leggere la data del browser.
- A destra: «Dati aggiornati al {data dell'ultimo movimento}». Se non ci sono movimenti, la scritta non c'è.
- Il titolo «Riepilogo» resta solo nella fascia della shell, come oggi.

### 2. Indicatori del mese

- Tre card con `app-stat-card-grid`: **Entrate**, **Uscite**, **Risultato del mese** (oggi «Saldo»; rinominata per non confonderla con la liquidità). Valori da `summarizeEntries`, che resta l'unica definizione di entrate e uscite.
- Spariscono le card «Transazioni» e «Merchant».
- La card Uscite porta la variazione rispetto al mese precedente (`StatCardDelta`, tono invertito come oggi: spesa in aumento = negativo).
  - **Mese chiuso** (precedente al mese di calendario): mese intero contro mese precedente intero. Didascalia «vs agosto».
  - **Mese in corso** (il mese di calendario): dal giorno 1 a oggi contro lo stesso intervallo del mese precedente, troncato all'ultimo giorno di quel mese (decisione dell'utente). Didascalia «vs 1–13 set».
  - Nessuna variazione se il periodo di confronto non ha spese (come oggi: `percentChange: null`).
- Sotto le card, una riga di testo secondario: «Prelevati in contanti {importo} · non inclusi nelle uscite». Somma dei movimenti `WITHDRAWAL` del mese, in valore assoluto. **Compare solo se l'importo è > 0.** Non entra in nessun totale: serve a spiegare perché le uscite possono sembrare basse, senza contare due volte il denaro.

### 3. Dove sono andati i soldi

- Le **prime 5 categorie di spesa** del mese, ordinate per importo decrescente. Stesso criterio di spesa di oggi (`expensesOnly`: spese e quota propria dei prestiti; prelievi e trasferimenti esclusi). La voce «Senza categoria» compare se è fra le prime 5.
- Per ogni riga: pallino colore (`app-color-marker`), nome, importo (`app-amount`, negato e con tono dedotto come nel resto dell'app), percentuale sulle uscite del mese, e la variazione rispetto al mese precedente come **freccia + importo senza segno** (es. «↑ 12,30 €»), colorata: aumento = tono negativo, calo = tono positivo. Niente doppi negativi. La variazione usa la stessa finestra di confronto degli indicatori (mese intero o 1–oggi). Se la categoria non c'era il mese prima, la variazione è l'intero importo in aumento.
- La percentuale è calcolata sul **totale delle uscite del mese** (non sulla somma delle 5 righe), quindi le righe possono sommare meno del 100%. Non si mostra se le uscite del mese sono ≤ 0 (mese dominato da rimborsi).
- Con variazione esattamente 0 la freccia non si mostra.
- Ogni riga è un link a Movimenti filtrato su quella categoria, sul mese e sui tipi che fanno spesa: `/transactions?categoryIds={id}&types=EXPENSE,LOAN&from={primo}&to={ultimo}`; per «Senza categoria» `/transactions?classification=unclassified&types=EXPENSE,LOAN&from=…&to=…`. Il filtro sui tipi esiste già in Movimenti. Resta una differenza accettata: per un prestito la riga conta solo la quota di spesa propria, mentre Movimenti mostra l'intero movimento.
- Piè del pannello: «Analisi completa →» verso `/analytics` (Analytics non accetta parametri: si apre con i suoi filtri di default).
- Mese senza spese: `app-empty-state` «Nessuna spesa in questo mese».

### 4. Da sistemare

Elenco di attività concrete, ognuna un link. **Il pannello sparisce se non c'è nessuna voce.**

- **Merchant da classificare**: «{n} merchant da classificare →» verso `/merchants?classification=unclassified`. Conteggio sull'intero archivio, lo stesso di `merchantsService.search(...).counts.unclassified`. Voce presente solo se n > 0.
- **Dati non aggiornati**: «Ultimo movimento {data} · Importa estratto conto →» verso `/import`. Presente solo se l'ultimo movimento è più vecchio di **7 giorni** rispetto a oggi, o se l'archivio è vuoto («Nessun movimento · Importa estratto conto →»).

### 5. Prestiti

- Una riga sola: «Da ricevere {importo} · {n} aperti →» verso `/loans?status=open`. Valori da `loansService.list(...)` → `totals.remaining` e `totals.openCount`, senza filtri: i prestiti saldati hanno residuo 0, quindi `remaining` coincide con quanto mostra `/loans?status=open`. Riguarda l'intero archivio, non il mese. Il blocco compare solo se `openCount > 0`.
- I movimenti di tipo Prestito senza un prestito collegato sono **già saldati** per l'utente (e il backend già non li conta come spesa): non sono un'anomalia e non vanno in «Da sistemare». Se ce ne sono, sotto la riga compare una nota secondaria non cliccabile: «{n} movimenti di prestito senza dettaglio, considerati saldati».
- «Prestiti» e «Da sistemare» stanno nella stessa colonna, uno sotto l'altro. Se nessuno dei due ha contenuto, «Dove sono andati i soldi» prende tutta la larghezza.

### 6. Ultimi movimenti

- I **5 movimenti più recenti dell'intero archivio** (data decrescente), di qualunque tipo, **indipendenti dal mese mostrato** (decisione dell'utente: se il mese corrente non è ancora caricato si vedono comunque gli ultimi del mese precedente). Riga: data, merchant (etichetta calcolata nel backend con `merchantLabel`, già usata dalla dashboard; la descrizione se manca il merchant), categoria con pallino (o «Senza categoria»), importo con segno (`app-amount`).
- Elenco compatto in sola lettura, scritto nel template della dashboard. Non si usa `TransactionsTablePanel`: ha 6 colonne fisse, paginazione e totale.
- Righe non cliccabili. Intestazione: «Tutti i movimenti →» verso `/transactions` (senza filtri: l'ordinamento di default è per data decrescente).
- Archivio vuoto: `app-empty-state` «Nessun movimento importato», con azione «Importa estratto conto» verso `/import`.

### Stati della pagina

- Caricamento: come le altre pagine (skeleton o «Caricamento in corso…»). Cambiando mese, il contenuto precedente resta visibile finché arriva il nuovo.
- Errore: `app-error-retry`.

## Backend: nuova forma di `GET /dashboard`

`GET /dashboard?month=YYYY-MM`. Il parametro `month` diventa **facoltativo**: senza, il servizio usa il mese dell'ultimo movimento (limitato al mese di calendario; il mese di calendario se l'archivio è vuoto) e lo restituisce in `month`. Un `month` malformato dà 400 come oggi (`requireMonth`); un mese futuro è riportato al mese di calendario. I parametri `type`, `categoryId`, `merchantId` spariscono.

Forma indicativa della risposta (i nomi esatti sono lasciati al builder):

```ts
interface DashboardViewModel {
  month: string;                         // YYYY-MM effettivamente mostrato
  today: string;                         // YYYY-MM-DD secondo il server
  lastTransactionDate: string | null;    // MAX(booking_date) dell'archivio, tutti i tipi
  summary: { income: number; expenses: number; balance: number; withdrawals: number };
  comparison: {
    previousExpenses: number;
    percentChange: number | null;
    window: { previousFrom: string; previousTo: string; partial: boolean }; // partial = mese in corso
  };
  topCategories: {
    id: string | null; name: string; color: string | null;
    amount: number; percentage: number | null; difference: number;
  }[];                                   // max 5
  recentTransactions: {
    id: string; bookingDate: string; label: string; type: TransactionType;
    category: { id: string; name: string; color: string | null } | null;
    amount: number;
  }[];                                   // max 5, intero archivio, non dipende da `month`
  attention: { unclassifiedMerchants: number };
  loans: { remaining: number; openCount: number; unlinkedTransactions: number };
}
```

- Tutto si compone dai servizi pubblici esistenti (`transactions`, `summary`, `merchants`, `loans`), senza formule nuove. L'unica regola nuova è la finestra di confronto «1–oggi» per il mese in corso.
- «Oggi» deve essere iniettabile (parametro o clock) per poter testare la finestra parziale e la soglia dei 7 giorni.
- `unlinkedTransactions` = movimenti `LOAN` senza alcuna allocazione in `loansService.allocations()`.
- La soglia dei 7 giorni può vivere nel frontend (riceve `lastTransactionDate`) oppure nel backend: scelta del builder, purché ci sia un solo posto.

## Cosa si elimina

- Frontend, in `features/dashboard/`: `category-breakdown.*`, `top-merchants.*`, `month-comparison.*` (con lo spec), `dashboard-filter.store.*` (con lo spec): il mese passa all'URL.
- Frontend, `features/cash-flow/` (`cash-flow-card.*`, `cash-flow.model.ts`): era usata solo dal Riepilogo. **Decisione dell'utente:** la liquidità esce dalla dashboard.
- Backend: `dashboard-filters.ts` e il campo `cashFlow` nella risposta. **Il modulo backend `cash-flow` e l'endpoint `GET /cash-flow` restano** (non sono usati dal frontend, ma eliminarli è fuori scope).
- Aggiornare i test che usano la vecchia forma: `dashboard.service.test.ts`, `dashboard-page.spec.ts` e `loans/loans.partial-expense.test.ts` (legge `dashboard.categories` e `dashboard.topMerchants`: diventano `topCategories`; la parte top merchant va tolta o sostituita).

## Non-obiettivi

- Grafici di andamento, top merchant, ripartizione per tipo, filtri per tipo/categoria/merchant: vivono in Analytics.
- Liquidità, saldo disponibile, variazione del patrimonio.
- Link diretti ad Analytics con periodo o categoria preimpostati (richiede di leggere i query param in Analytics: lavoro separato).
- Aprire o evidenziare un singolo movimento in Movimenti (manca un parametro per id: lavoro separato).
- Registro degli import: la freschezza si deduce dalla data dell'ultimo movimento.
- Toccare `GET /summary`, `GET /analytics`, le pagine Movimenti, Merchant, Prestiti, Impostazioni.

## Anti-obiettivi

- Una seconda pagina Analytics: niente drill-down, niente filtri oltre al mese.
- Numeri che si contraddicono fra blocchi: entrate, uscite, categorie e confronto derivano dallo stesso insieme e dalla stessa ripartizione spesa/credito.
- Mostrare un numero di liquidità non verificabile.
- Contare i prelievi come spesa.
- Una pagina vuota all'apertura quando i dati ci sono.

## Vincoli

- Componenti shared esistenti: `PageLayout`, `Panel`, `SectionHeader`, `StatCardGrid`, `Amount`, `ColorMarker`, `EmptyState`, `ErrorRetry`. Nessuna nuova dipendenza.
- Token e mixin del design system (`shared/styles`), tema chiaro e scuro, importi in carattere mono come nel resto dell'app.
- Una sola chiamata HTTP per la pagina, come oggi.
- Convenzioni del progetto: commenti in italiano, signal, componenti standalone, test backend con `tsx --test`, frontend con gli spec esistenti.

## Lasciato al builder

- Nomi esatti dei campi e dei componenti; se le sezioni restano componenti separati o stanno nel template della pagina.
- Stile delle frecce del mese e della riga dei prelievi, nel rispetto del design system.
- Breakpoint esatto delle due colonne.
- Formato della didascalia «vs 1–13 set».

## Scelte mie (da verificare in lettura)

- Le frecce non vanno oltre il mese di calendario corrente.
- Soglia di 7 giorni per l'avviso «Importa estratto conto».
- L'orologio di riferimento è quello del server (`today` nella risposta).
- I link delle categorie filtrano anche `types=EXPENSE,LOAN`.
- `month` non valido o futuro: ignorato o riportato al mese corrente, mai una pagina d'errore.
- Riga dei prelievi solo se > 0; blocco Prestiti solo con prestiti aperti; pannello «Da sistemare» nascosto se vuoto.
- La nota sui prestiti senza dettaglio è informativa, non un'attività.
- Eliminazione del codice frontend di cash-flow; il modulo backend resta.
