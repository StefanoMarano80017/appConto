# Personal Finance Tracker

## Vision

Personal Finance Tracker è un'applicazione web locale progettata per analizzare gli estratti conto bancari esportati in formato CSV.

L'obiettivo principale non è sostituire un software di contabilità, ma offrire uno strumento semplice e veloce per comprendere come vengono spesi i propri soldi e monitorare nel tempo le proprie abitudini finanziarie.

L'applicazione è destinata ad un utilizzo personale e funzionerà interamente in locale.

---

# Obiettivi

La prima versione dell'applicazione deve permettere di:

- importare uno o più estratti conto in formato CSV;
- salvare le transazioni in un database locale;
- classificare automaticamente le transazioni già conosciute;
- consentire la correzione manuale delle categorie;
- mostrare un riepilogo delle spese del mese suddivise per categoria.

L'applicazione dovrà essere incrementale: ogni versione dovrà produrre un software utilizzabile.

---

# Filosofia

L'applicazione deve essere costruita seguendo alcuni principi fondamentali.

## Dominio prima della UI

Il cuore del progetto è il dominio finanziario.

La UI è solamente uno strumento di visualizzazione.

La logica di business non deve dipendere dal frontend.

---

## Semplicità

Ogni nuova funzionalità deve introdurre la minima complessità possibile.

Si preferiscono modelli semplici ma facilmente estendibili.

---

## Evoluzione incrementale

Le funzionalità verranno introdotte in piccoli Work Package.

Ogni Work Package dovrà lasciare l'applicazione in uno stato funzionante.

---

# MVP

Il Minimum Viable Product consiste nelle seguenti funzionalità.

## Importazione CSV

L'utente seleziona un file CSV esportato dalla propria banca.

Le transazioni vengono importate nel database.

---

## Elenco transazioni

L'utente può consultare tutte le transazioni importate.

---

## Classificazione

Ogni merchant può essere associato ad una categoria.

Le associazioni vengono memorizzate e riutilizzate automaticamente durante le importazioni successive.

---

## Dashboard

Per un determinato mese vengono mostrate:

- totale delle entrate
- totale delle uscite
- spesa per categoria
- principali merchant

---

# Concetti del dominio

L'applicazione ruota attorno ad alcuni concetti fondamentali.

## Transaction

Rappresenta un movimento bancario.

Una transazione possiede almeno:

- data
- descrizione
- importo

---

## Merchant

Identifica il soggetto presso il quale è stata effettuata una spesa.

Esempi:

- Esselunga
- Amazon
- Eni
- Tabacchi Rossi

Un merchant non possiede direttamente statistiche.

Serve solamente per classificare le transazioni.

---

## Category

Una categoria rappresenta una tipologia di spesa.

Esempi:

- Alimentari
- Carburante
- Casa
- Tempo libero
- Tabacco

Le categorie sono utilizzate esclusivamente per produrre analisi.

---

# Classificazione

La classificazione deve essere separata dall'importazione.

L'importazione ha il solo compito di leggere il CSV.

Successivamente interviene il motore di classificazione.

Questo permette di sostituire o migliorare il sistema di classificazione senza modificare il parser dei CSV.

---

# Architettura concettuale

CSV

↓

Importer

↓

Normalized Transaction

↓

Classification Engine

↓

Database

↓

Analytics

↓

Dashboard

---

# Fuori dallo scope iniziale

Le seguenti funzionalità NON fanno parte della prima versione.

- gestione di più conti correnti
- gestione della liquidità
- budget mensili
- forecasting
- sincronizzazione cloud
- autenticazione
- AI per classificazione
- import automatici

Saranno introdotte solamente quando emergerà una reale necessità.

---

# Principi architetturali

Il progetto seguirà alcune regole.

## Separazione delle responsabilità

Ogni componente deve avere un'unica responsabilità.

Parser, classificazione, persistenza e analytics devono essere indipendenti.

---

## Feature Oriented

Il codice sarà organizzato per funzionalità e non per layer tecnici.

Esempio:

- import
- transactions
- categories
- analytics

e non

- controllers
- services
- repositories

---

## Database locale

L'applicazione utilizza un database embedded.

L'utente non dovrà configurare alcun server.

---

## API

Il backend espone solamente le API necessarie al frontend.

Non è prevista una piattaforma multiutente.

---

# Roadmap

## M1

Importazione CSV.

## M2

Visualizzazione transazioni.

## M3

Sistema di categorie.

## M4

Dashboard.

## M5

Ottimizzazione dell'esperienza utente.

---

# Visione futura

L'architettura dovrà permettere di aggiungere facilmente:

- gestione di più conti
- ledger
- contanti
- trasferimenti
- regole di classificazione
- budget
- analisi avanzate
- forecasting
- AI locale