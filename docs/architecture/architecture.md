# Software Architecture

## Overview

Personal Finance Tracker è un'applicazione web locale composta da un frontend Angular e da un backend Express.

L'architettura segue una filosofia **Domain First**: il dominio finanziario rappresenta il cuore del sistema, mentre UI, API e database sono considerati adattatori.

L'obiettivo è mantenere il dominio indipendente dalle tecnologie utilizzate.

---

# High Level Architecture

```
                    +--------------------+
                    |      Angular       |
                    |        UI          |
                    +---------+----------+
                              |
                           REST API
                              |
                    +---------v----------+
                    |      Express       |
                    |      Backend       |
                    +---------+----------+
                              |
                     Application Services
                              |
                    +---------v----------+
                    |   Finance Domain   |
                    +---------+----------+
                              |
                         Repositories
                              |
                    +---------v----------+
                    | SQLite + Drizzle   |
                    +--------------------+
```

---

# Architectural Principles

L'intero progetto segue alcuni principi fondamentali.

## Domain First

La logica di business appartiene esclusivamente al dominio.

Frontend, database e API non devono contenere regole di business.

---

## Feature Oriented

Il codice viene organizzato per funzionalità.

Esempio:

```
transactions/

categories/

import/

analytics/
```

e non

```
controllers/

services/

repositories/
```

Ogni feature contiene tutto ciò che le appartiene.

---

## Separation of Concerns

Ogni componente possiede una sola responsabilità.

Esempio:

Parser

↓

Importer

↓

Classification

↓

Persistence

↓

Analytics

Ogni passaggio può evolvere indipendentemente.

---

## Incremental Evolution

L'architettura deve permettere di introdurre nuove funzionalità senza modificare quelle esistenti.

Si preferiscono estensioni rispetto a riscritture.

---

# System Layers

Il sistema viene suddiviso in quattro livelli.

---

## Presentation Layer

Responsabilità

- visualizzazione dati
- interazione utente
- chiamate REST

Non contiene logica finanziaria.

---

## Application Layer

Coordina i casi d'uso.

Esempio

Importazione CSV

↓

Parsing

↓

Classificazione

↓

Persistenza

↓

Risposta API

Non contiene logica di dominio.

---

## Domain Layer

È il cuore dell'applicazione.

Contiene:

- Transaction
- Merchant
- Category
- servizi di classificazione
- analytics

Questo livello deve essere completamente indipendente.

---

## Infrastructure Layer

Gestisce:

- SQLite
- Drizzle
- filesystem
- parsing CSV
- Express

Il dominio non deve conoscere queste implementazioni.

---

# Feature Modules

La struttura del backend è organizzata per domini.

```
src/

modules/

    import/

    transactions/

    merchants/

    categories/

    analytics/
```

Ogni modulo contiene:

```
feature/

    routes/

    services/

    repositories/

    models/

    dto/
```

La feature è completamente autosufficiente.

---

# Import Pipeline

L'importazione rappresenta il primo workflow dell'applicazione.

```
CSV

↓

CSV Parser

↓

Column Binding          ← rilevato dal contenuto, oppure indicato dall'utente

↓

Normalized Transaction

↓

Merchant Resolver

↓

Classification

↓

Persistence

↓

Analytics
```

Ogni fase ha una responsabilità ben definita.

Il **binding delle colonne** è il solo punto con due strade: il rilevamento
guarda i valori e propone, l'utente può indicare le colonne a mano quando il
rilevamento non arriva a un campo obbligatorio o sceglie la colonna sbagliata.
Da `Normalized Transaction` in avanti la pipeline non sa quale delle due strade
è stata percorsa — riceve un binding completo — e l'identità dei movimenti non
dipende da essa.

---

# Classification Pipeline

La classificazione è indipendente dall'importazione.

```
Merchant

↓

Known Merchant

↓

Category

↓

Save
```

In futuro potranno essere introdotte ulteriori strategie.

Ad esempio:

```
Regex

↓

Rules

↓

AI

↓

Manual Override
```

senza modificare il resto dell'architettura.

---

# Analytics

Le statistiche vengono sempre calcolate.

Non vengono mai salvate.

```
Transactions

↓

Aggregation

↓

Dashboard
```

Questo evita inconsistenze tra dati e statistiche.

---

# Persistence

SQLite rappresenta l'unica fonte di verità.

Ogni modifica passa attraverso i repository.

Il dominio non accede direttamente al database.

---

# API Design

Le API sono orientate ai casi d'uso.

Esempi:

```
POST /import/csv/analysis

POST /import/csv

GET /transactions

GET /dashboard

PATCH /merchants/:id/category
```

Le API servono esclusivamente il frontend.

Non costituiscono un'API pubblica.

---

# Error Handling

Gli errori vengono gestiti centralmente.

Le feature non devono conoscere il protocollo HTTP.

Il dominio genera errori di business.

L'application layer li traduce in risposte HTTP.

---

# Logging

Le operazioni importanti vengono registrate.

Ad esempio:

- importazioni
- errori
- parsing falliti

Le operazioni di dominio non devono conoscere il sistema di logging.

---

# Future Extensions

L'architettura deve consentire l'introduzione di:

- Account
- Ledger
- Cash
- Budget
- Forecast
- Rule Engine
- AI Classification

senza modificare il dominio esistente.

---

# Architectural Rules

Le seguenti regole sono vincolanti.

## Il frontend non accede mai direttamente al database.

---

## Il parser CSV non contiene logica di classificazione.

---

## Le statistiche vengono sempre calcolate.

Mai memorizzate.

---

## Le transazioni importate sono immutabili.

---

## Il dominio non dipende da Express.

---

## Il dominio non dipende da SQLite.

---

## Le feature comunicano attraverso servizi pubblici.

Mai accedendo direttamente alle implementazioni interne.

---

# MVP Scope

La prima versione implementa solamente:

- importazione CSV
- visualizzazione transazioni
- classificazione merchant
- dashboard mensile

Ogni altra funzionalità rappresenta un'estensione futura.

---

# Architecture Philosophy

L'architettura privilegia:

- semplicità
- leggibilità
- evoluzione incrementale
- basso accoppiamento
- alta coesione

L'obiettivo non è costruire un framework, ma un software facilmente comprensibile e facilmente estendibile.