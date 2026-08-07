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
```

Una categoria può contenere molti merchant.

Un merchant può contenere molte transazioni.

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