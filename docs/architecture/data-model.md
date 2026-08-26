# Data Model

## Introduzione

Questo documento descrive il modello dati della prima versione dell'applicazione.

Il modello è volutamente minimale e contiene solamente le entità necessarie per importare transazioni bancarie, classificarle e produrre statistiche.

Ogni futura evoluzione dovrà estendere questo modello senza modificarne i concetti fondamentali.

---

# Modello concettuale

```
CSV

↓

Transaction

↓

Merchant

↓

Category

↓

Analytics
```

Le Analytics non rappresentano un'entità persistente ma una vista calcolata a partire dalle transazioni.

---

# Entità

## Transaction

Una transazione rappresenta un singolo movimento importato da un estratto conto.

### Campi

| Campo | Tipo | Note |
|--------|------|------|
| id | UUID | Identificativo univoco |
| bookingDate | Date | Data contabile |
| valueDate | Date? | Data valuta (opzionale) |
| description | string | Descrizione originale della banca |
| amount | number | Importo della transazione |
| merchantId | UUID? | Merchant associato |
| createdAt | Date | Data di importazione |

### Note

La descrizione originale non deve mai essere modificata.

---

## Merchant

Un merchant rappresenta un esercente.

Più transazioni possono appartenere allo stesso merchant.

### Campi

| Campo             | Tipo |
|--------           |------|
| id                | UUID |
| name              | string |
| normalizedName    | string |
| categoryId        | UUID? |
| createdAt         | date  |
| updatedAt         | date  |

### Note

Il merchant viene creato automaticamente durante l'importazione se non esiste.

---

## Category

Una categoria identifica una tipologia di spesa.

### Campi

| Campo | Tipo |
|--------|------|
| id | UUID |
| name | string |
| color | string? |

### Categorie iniziali

- Alimentari
- Casa
- Shopping
- Carburante
- Salute
- Tempo libero
- Trasporti
- Tabacco
- Altro
- Da classificare

---

## Loan

Un prestito rappresenta il **credito economico** nato da un movimento bancario.

Non è un'altra forma di Transaction: la Transaction dice cosa è successo sul
conto, il Loan dice quanto denaro si attende indietro.

### Campi

| Campo | Tipo | Note |
|--------|------|------|
| id | UUID | |
| transactionId | UUID | La Transaction che lo ha originato. Deve essere di tipo `LOAN` |
| borrowerName | string | Nome della persona, come lo scrive l'utente |
| description | string? | |
| amountCents | integer | Sempre positivo |
| lentAt | Date | |
| createdAt | Date | |

### Note

Non esiste un'entità `Person`: il nome è una stringa. Normalizzarlo
trasformerebbe un workspace per prestiti in un sistema anagrafico, e non serve
ancora.

`amountCents` **non** è una copia dell'importo della Transaction: è l'importo
del prestito, che può esserne una parte. È un dato descrittivo della posizione
di credito, non una seconda contabilità.

---

## LoanRepayment

Una restituzione riduce il credito.

### Campi

| Campo | Tipo | Note |
|--------|------|------|
| id | UUID | |
| loanId | UUID | |
| transactionId | UUID? | `null` per una restituzione in contanti |
| amountCents | integer | Sempre positivo |
| repaymentDate | Date | |
| note | string? | |
| createdAt | Date | |

### Note

`transactionId` è opzionale perché una restituzione può avvenire senza che il
conto se ne accorga. In quel caso **non** viene creata una Transaction
artificiale: il credito scende, la liquidità no.

Quando invece la restituzione è collegata ad una Transaction, quella Transaction
resta ciò che è — tipicamente una `INCOME`. Il collegamento aggiunge significato
al movimento, non lo trasforma.

---

# Relazioni

```
Category

1

↓

N

Merchant

1

↓

N

Transaction

1

↓

N

Loan

1

↓

N

LoanRepayment
```

Una categoria può contenere molti merchant.

Un merchant può contenere molte transazioni.

Una Transaction `LOAN` può originare più prestiti: un pagamento che copre
l'assicurazione di due persone crea due crediti distinti. La somma degli importi
dei prestiti nati da uno stesso movimento non può superare l'importo di quel
movimento.

Un prestito può avere molte restituzioni.

---

# Flusso di importazione

Durante l'importazione avvengono i seguenti passaggi.

## 1

Parsing CSV.

↓

## 2

Creazione della Transaction.

↓

## 3

Ricerca del Merchant.

↓

## 4

Se il Merchant non esiste viene creato.

↓

## 5

La Transaction viene associata al Merchant.

↓

## 6

La categoria viene ereditata automaticamente dal Merchant.

---

# Regole

## Transaction

Una Transaction è immutabile.

Una volta importata non deve essere modificata.

L'unica informazione derivata è il Merchant associato.

---

## Merchant

Il Merchant rappresenta la conoscenza accumulata dal sistema.

Quando l'utente corregge una categoria viene aggiornato il Merchant.

Le transazioni esistenti erediteranno automaticamente la nuova categoria.

---

## Category

Le categorie sono poche e stabili.

L'utente può aggiungerne di nuove.

Non devono contenere logica.

---

## Loan

Il credito residuo **non** è una colonna.

```
remainingAmount = amountCents - SUM(repayments.amountCents)
```

Lo stato è una lettura del residuo, non un dato a sé:

```
OPEN      remainingAmount > 0
SETTLED   remainingAmount = 0
```

Una restituzione superiore al residuo viene rifiutata: il residuo non può
diventare negativo.

Il prestito **non** viene creato dall'importazione. L'import produce Transaction,
e non sa chi ha ricevuto il denaro, se il movimento è davvero un prestito, né
quale descrizione dargli. Il Loan nasce da un gesto esplicito dell'utente a
partire da una Transaction `LOAN`.

Reimportare la Transaction d'origine non crea un secondo prestito né una seconda
restituzione: il fingerprint della Transaction resta invariato e non contiene
nulla del dominio dei prestiti.

---

# Ripartizione di un movimento

Il tipo è una sola etichetta, ma un movimento può essere due cose insieme: un
pagamento di 1.920 € in cui 890 € sono spesa propria e 1.030 € sono stati
anticipati per un'altra persona.

La regola:

```
quota di credito = somma dei prestiti nati dal movimento
quota di spesa   = importo del movimento - quota di credito
```

Finché nessun prestito è registrato la ripartizione non è nota, e il movimento
si considera **tutto** credito: è l'ipotesi prudente, perché contare come spesa
denaro che si attende indietro sarebbe un errore peggiore.

Le due funzioni che la applicano — `expenseCents` e `netWorthCents` — vivono
nella feature `transactions`, l'unica a definire cosa sia una spesa, e ricevono
la quota prestata come parametro. Il valore lo fornisce `loans`, che è l'unica a
saperlo. Così la regola esiste in un solo posto e la dipendenza resta in un solo
verso: `loans → transactions`, mai il contrario.

Conseguenze:

- la **liquidità** non è toccata dalla ripartizione: dal conto è uscito l'intero
  importo, e continua a uscire;
- le **uscite del mese**, le **categorie** e il **patrimonio** vedono la sola
  quota di spesa;
- la voce *prestiti* di Analytics vede la sola quota di credito;
- se il tipo del movimento viene corretto a `EXPENSE`, il tipo ha la precedenza
  e l'intero importo è spesa: la quota non viene sommata due volte;
- incassare una restituzione non cambia la quota di spesa. Quel denaro è già
  stato speso.

---

# Liquidità e credito

Sono due domande diverse, e non devono essere confuse.

```
Cash Flow  = cosa è successo al conto
Loan       = quanto denaro devo ancora ricevere
```

Un movimento `LOAN` di 80 € sposta il saldo del conto di −80 €, e continua a
farlo per sempre: è un fatto accaduto. Il credito di 80 € che ne nasce, invece,
si riduce ad ogni restituzione fino a chiudersi.

Perché il denaro non venga contato due volte:

- la **Transaction** appartiene al Cash Flow;
- la **LoanRepayment** appartiene al calcolo del credito residuo.

Una restituzione in contanti non ha Transaction, quindi la liquidità non si
muove. Una restituzione bancaria è collegata ad una Transaction che il Cash Flow
contava già: il collegamento non la conta una seconda volta, le aggiunge solo un
significato.

---

# Analytics

Le statistiche non vengono salvate.

Sono sempre calcolate interrogando il database.

Esempi:

- spese per categoria
- spese mensili
- totale uscite
- totale entrate
- top merchant

---

# Evoluzioni previste

Le seguenti entità verranno introdotte solo quando necessarie.

## Person

Normalizzerebbe i debitori, oggi un semplice `borrowerName`. Serve solo quando
emergerà un bisogno reale — vedere tutti i prestiti di una persona nel tempo,
unire due nomi scritti in modo diverso — e non prima: un'anagrafica introdotta
per completezza è peso senza valore.

---

## Account

Permetterà la gestione di più conti correnti.

---

## LedgerEntry

Permetterà di rappresentare trasferimenti e movimenti interni.

---

## CashAccount

Permetterà di gestire la liquidità.

---

## ClassificationRule

Consentirà di classificare automaticamente nuovi merchant.

---

## Budget

Permetterà di definire limiti di spesa.

---

## Forecast

Permetterà di costruire previsioni finanziarie.

---

# Principi

## Nessuna duplicazione

Le informazioni devono esistere in un solo punto.

La categoria appartiene al Merchant.

Non alla Transaction.

---

## Dati originali

I dati importati dal CSV non devono essere alterati.

---

## Modello incrementale

Nuove entità dovranno essere introdotte solo quando saranno realmente necessarie.

L'MVP privilegia semplicità e chiarezza rispetto alla completezza.