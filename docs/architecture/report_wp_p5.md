# Report WP-P5 — Windows Launcher & Application Lifecycle

Il package portatile di WP-P4 partiva già: `start.bat`, il `node.exe` incluso,
il server, l'interfaccia. Ciò che mancava è tutto quello che sta *intorno*
all'avvio, e che P4 aveva elencato come rischio residuo: una seconda istanza
sullo stesso archivio, una porta occupata, un errore che sparisce con la
finestra, una chiusura che non consolida il database, un indirizzo da digitare
a mano, una politica di backup automatici che nessuno applicava.

P5 aggiunge un processo — il **launcher** — che possiede il ciclo di vita, e
non tocca il dominio: nessun repository, nessun servizio, nessuna view-model,
nessun componente Angular è stato modificato.

---

## 1. File modificati

| file | modifica | motivazione |
|---|---|---|
| `apps/backend/src/main.ts` | usa `listenWithFallback`; espone un canale IPC su cui **dichiara la porta aperta** e **riceve la richiesta di arresto**; avvia lo scheduler; registra `configuredPort` e `actualPort` | il server deve poter ricevere una porta e una richiesta di arresto da chi lo ha avviato, e restare avviabile da solo senza nessuna delle due |
| `apps/backend/src/shutdown.ts` | ferma le attività periodiche **prima** di chiudere; timeout di sicurezza sull'intera procedura; gestisce anche `SIGHUP` | su Windows `SIGHUP` è la chiusura della finestra; uno scheduler ancora attivo potrebbe avviare un `VACUUM INTO` mentre il database si chiude; un arresto che non finisce trattiene il lock e il file |
| `apps/backend/src/config.ts` | `resolveAutoBackupHours`, `autoBackupIntervalMs`, `instanceLockFile` | la cadenza dei backup e il percorso del lock sono configurazione, e le precedenze vanno verificabili senza avviare un processo |
| `apps/backend/src/paths.ts` | `instanceLockFile` in `resolvePaths`; `autoBackupHours` fra le impostazioni riconosciute | nessun altro modulo deve dedurre una directory: è l'invariante di P4, e il lock è un percorso come gli altri |
| `scripts/build-backend.mjs` | secondo punto d'ingresso (`launcher.js`) nella stessa cartella di `server.js`; guardia sul contenuto del bundle del launcher | due bundle accanto risolvono `APP_ROOT` in modo identico; la guardia impedisce che un `import` sbagliato faccia aprire il database **prima** del lock |
| `scripts/package-windows.mjs` | copia `launcher.js`; `start.bat` riscritto per avviare il launcher e per dire se la finestra è temporanea; nuovo `stop.bat`; entrambi fra i file attesi | l'avvio passa dal launcher, e l'arresto deve essere chiedibile senza chiudere la finestra |
| `scripts/verify-package.mjs` | la porta effettiva si legge dal lock e non si assume; arresto ordinato via canale di controllo; lettura del registro; **sei casi nuovi** (K–Q) | dal momento in cui la porta può cambiare, interrogare quella configurata significa interrogare il programma che la occupa |
| `apps/backend/src/paths.test.ts` | il lock sta dentro `DATA_ROOT` e resta fuori da `app/` | il vincolo di istanza unica è sull'archivio, non sul programma |
| `apps/backend/src/shutdown.test.ts` | le attività periodiche vengono fermate prima dell'uscita; `SIGHUP` fra i segnali; una seconda richiesta non ferma niente due volte | è l'ordine a essere la garanzia, e va osservato |
| `apps/backend/src/restore.runtime.test.ts` | `apriPerScrivere`: riprova ad aprire il database dopo una terminazione brusca | **vedi §12** — difetto latente preesistente, non un adattamento di comodo |

`package.json` non è stato toccato: `npm run package` e `npm run verify:package`
esistevano già da P4 e continuano a fare la stessa cosa.

---

## 2. File creati

### Produzione

| file | righe | ruolo |
|---|---|---|
| `apps/backend/src/listen.ts` | 118 | apre il listener e, **solo se autorizzato**, ripiega su una porta libera |
| `apps/backend/src/launcher/control.ts` | 289 | il canale di controllo: dice di essere vivo, dice su quale porta è il server, riceve la richiesta di arresto |
| `apps/backend/src/launcher/instance-lock.ts` | 259 | una sola istanza per archivio, e riconoscimento di un lock abbandonato |
| `apps/backend/src/launcher/readiness.ts` | 87 | attende che l'applicazione **risponda**, non che il processo esista |
| `apps/backend/src/launcher/browser.ts` | 73 | chiede a Windows di aprire l'indirizzo, senza nominare un browser |
| `apps/backend/src/launcher/prerequisites.ts` | 60 | la copia del package è completa? |
| `apps/backend/src/launcher/presentation.ts` | 80 | cosa vede chi ha fatto doppio clic: due categorie di errore, e quando trattenere la finestra |
| `apps/backend/src/launcher/run.ts` | 398 | il ciclo di vita, con tutte le dipendenze iniettate |
| `apps/backend/src/launcher/stop.ts` | 80 | `stop.bat`: trova l'istanza dal lock e le chiede di fermarsi |
| `apps/backend/src/launcher/main.ts` | 153 | il punto d'ingresso: compone le parti reali e traduce l'esito in un messaggio e un codice di uscita |
| `apps/backend/src/modules/maintenance/backup.scheduler.ts` | 230 | quando fare il prossimo backup automatico, e il ciclo che lo fa |
| `apps/backend/src/modules/maintenance/auto-backup.ts` | 67 | il cablaggio dello scheduler con `backupService`, la configurazione e il logger |

### Test

| file | righe |
|---|---|
| `apps/backend/src/listen.test.ts` | 165 |
| `apps/backend/src/config.test.ts` | 80 |
| `apps/backend/src/launcher/control.test.ts` | 227 |
| `apps/backend/src/launcher/instance-lock.test.ts` | 416 |
| `apps/backend/src/launcher/readiness.test.ts` | 189 |
| `apps/backend/src/launcher/browser.test.ts` | 99 |
| `apps/backend/src/launcher/prerequisites.test.ts` | 79 |
| `apps/backend/src/launcher/presentation.test.ts` | 73 |
| `apps/backend/src/launcher/run.test.ts` | 417 |
| `apps/backend/src/launcher/stop.test.ts` | 141 |
| `apps/backend/src/modules/maintenance/backup.scheduler.test.ts` | 422 |

### Documenti

`docs/architecture/report_wp_p5.md` (questo file).

---

## 3. Architettura del launcher

```
                    doppio clic su start.bat
                              │
              cmd rileva se la finestra è temporanea
                              │
              runtime\node.exe app\backend\launcher.js
                              │
                    ┌─────────┴─────────┐
                    │     LAUNCHER      │
                    └─────────┬─────────┘
                              │
        1. prerequisiti       server.js? binario SQLite? interfaccia?
                              │          migrazioni?
                              │          ── manca qualcosa → messaggio, uscita 2
                              │
        2. canale di controllo   bind 127.0.0.1:0     ← prima del lock,
                              │                        perché il lock ne
                              │                        contiene la porta
        3. istanza unica      instance.lock in DATA_ROOT, creato con "wx"
                              │
                              ├── già presente e chi lo tiene RISPONDE
                              │      → apre il browser su quella istanza,
                              │        messaggio, uscita 0
                              │
                              └── assente, o chi lo teneva NON risponde
                                     → lo prende
                              │
        4. processo server    runtime\node.exe app\backend\server.js
                              │   MYFINANCE_DATA   = la radice appena bloccata
                              │   MYFINANCE_PORT   = quella configurata
                              │   MYFINANCE_PORT_FALLBACK = 1
                              │   stdio: pipe + IPC
                              │
                              │        ┌──────────────────────────┐
                              │        │        SERVER            │
                              │        │  ripristino differito    │
                              │        │  apertura database       │
                              │        │  guardia schema          │
                              │        │  backup pre-migrazione   │
                              │        │  migrazioni              │
                              │        │  listen (porta o ripiego)│
                              │        │  scheduler backup        │
                              │        └────────────┬─────────────┘
                              │                     │
        5. porta effettiva    ←──── IPC "ready" ────┘
                              │
        6. pronto             GET /api/health finché non risponde ok
                              │      ── processo morto → messaggio, uscita ≠ 0
                              │      ── scaduto        → messaggio, uscita ≠ 0
                              │
        7. lock aggiornato    serverPort scritta: un secondo avvio sa dove
                              │                   mandare il browser
        8. browser            cmd /c start "" http://127.0.0.1:<porta>/
                              │
        ══════════════ IN ESECUZIONE ══════════════
                              │
        9. richiesta di arresto
              ├── finestra chiusa      → SIGHUP
              ├── Ctrl+C               → SIGINT
              └── stop.bat             → canale di controllo + token
                              │
                              ├─ IPC "shutdown" ─→ scheduler fermo
                              │                    HTTP chiuso
                              │                    WAL consolidato
                              │                    database chiuso
                              │                    uscita 0
                              │
                              │   ── non risponde entro 20 s → terminazione
                              │      forzata, registrata come errore
                              │
       10. lock rilasciato, canale chiuso, uscita con il codice del server
```

Il launcher è un **processo separato**, e non per simmetria: il server deve
restare avviabile da solo — `npm start`, i test, uno smoke test — e nessun
modulo applicativo sa che esista un launcher. Ciò che il launcher fa, il server
non saprebbe fare su sé stesso: sopravvivere al proprio avvio fallito per
raccontarlo, e chiedere un arresto ordinato su una piattaforma che non consegna
segnali.

### Dove sta il launcher, e perché lì

`launcher.js` è confezionato **accanto** a `server.js`, in `app/backend/`, non
in una cartella propria. `paths.ts` deduce `APP_ROOT` dai due segmenti finali
del percorso del proprio modulo: due bundle nella stessa cartella risolvono le
due radici in modo **identico**, e non esistono due deduzioni che possano
divergere. Un launcher in `app/launcher/` avrebbe dedotto un `APP_ROOT`
diverso — cioè esattamente la divergenza che `paths.ts` esiste per rendere
impossibile.

---

## 4. Single-instance

### Cosa protegge

SQLite regge più connessioni, ma questa applicazione è costruita su un assunto
più forte: **uno scrittore solo**. Il WAL viene consolidato alla chiusura, un
ripristino differito sostituisce il file all'apertura, un backup prende uno
snapshot senza fermare nessuno. Due processi che aprono lo stesso archivio non
lo corrompono, ma trasformano quelle tre operazioni in altrettante corse — il
secondo può applicare un ripristino sotto i piedi del primo, o migrare uno
schema che il primo sta usando.

Il vincolo è quindi sull'**archivio**, non sul programma.

### Tecnologia, e perché non un mutex

| candidato | perché no |
|---|---|
| mutex Win32 con nome | richiede codice nativo o un `ffi`: una dipendenza nuova per una funzione che si può ottenere senza |
| `if (esiste il file)` | ha una finestra fra la domanda e la risposta, ed è il difetto che il piano segnala esplicitamente |
| solo file di lock | un file sopravvive a chi l'ha scritto: dopo un crash bloccherebbe l'applicazione per sempre |
| solo `pid` registrato | i numeri di processo vengono riciclati: un pid riassegnato a un programma qualsiasi bloccherebbe l'applicazione per sempre |

La soluzione usa **due primitive, ognuna per ciò che sa fare**:

1. **`writeFileSync(lock, …, { flag: 'wx' })`** — «crea, e falliscimi se
   esiste». Una singola chiamata di sistema che riesce a **uno solo** dei
   concorrenti: è quello il punto di mutua esclusione, non un controllo di
   esistenza.
2. **un socket in ascolto su `127.0.0.1`**, la cui porta è scritta nel lock —
   perché un socket è una proprietà del processo: quando il processo muore, il
   sistema operativo lo chiude, **sempre**, anche se è stato terminato di
   forza. Non esiste un «socket stale».

### Chiave del lock

Il file sta **dentro `DATA_ROOT`**:

```
<DATA_ROOT>\instance.lock
```

Il percorso del file *è* la chiave. Nessun hash del percorso, nessuna
normalizzazione, nessuna possibilità che due forme dello stesso percorso —
maiuscole diverse, un collegamento, un percorso UNC — producano due chiavi
distinte per la stessa cartella. Ne consegue direttamente il comportamento
richiesto:

```
package A + DATA_ROOT X   +   package B + DATA_ROOT X   →  la seconda rinuncia
package A + DATA_ROOT X   +   package B + DATA_ROOT Y   →  entrambe girano
```

### Contenuto

```json
{
  "protocol": "myfinance/instance/1",
  "pid": 22288,
  "startedAt": "2026-09-02T10:34:20.995Z",
  "appRoot": "…\\MyFinance",
  "dataRoot": "…\\UserData",
  "controlPort": 50762,
  "token": "a537279a…",
  "serverPort": 47311
}
```

Il `token` è nuovo a ogni avvio e autorizza l'arresto: sta dentro `DATA_ROOT`,
quindi chi può leggerlo può già leggere l'archivio. Il `pid` è registrato **per
la diagnosi e non viene usato per decidere**, per la ragione detta sopra.
`serverPort` è `null` fino a quando l'applicazione non è pronta: un secondo
avvio che lo trova `null` dice «l'istanza attiva sta ancora partendo».

### Lock abbandonato

```
il file esiste
      │
      ├── non si interpreta ──→ si concede un attimo (può essere una scrittura
      │                          a metà: creare e scrivere non sono un'unica
      │                          operazione) e si rilegge. Ancora illeggibile:
      │                          è spazzatura → si sostituisce
      │
      └── si interpreta → si interroga la porta di controllo
                                │
                                ├── risponde questo protocollo E dichiara
                                │   QUESTA radice dati  →  è vivo: si rinuncia
                                │
                                └── silenzio, o risponde altro, o dichiara
                                    un'altra radice  →  abbandonato: si prende
```

Le due condizioni della risposta sono entrambe necessarie: la porta di un
processo morto può essere stata riassegnata dal sistema a un programma
qualsiasi.

Un lock illeggibile non viene rispettato: rispettarlo significherebbe poter
bloccare l'applicazione scrivendo spazzatura in un file.

### Rilascio

Il rilascio avviene su **ogni** uscita — normale, per avvio fallito, per
eccezione — attraverso un'unica funzione, perché tre elenchi separati
divergerebbero al primo ramo aggiunto, e un lock non rilasciato impedisce
all'utente di riavviare l'applicazione. Prima di rimuovere il file si controlla
che il token sia il proprio: se un altro lo ha già preso, cancellarlo
significherebbe togliergli il lock.

### Dopo un crash

Nessun intervento. Il file resta, la sua porta di controllo non risponde, e
l'avvio successivo lo prende. Verificato sul package reale (**caso N**) e in
quattro varianti in-process (**§19 caso D**), compreso il caso del pid vivo.

### Un rafforzamento gratuito

Il ripristino differito di WP-P3 — che sostituisce il file del database
all'apertura della connessione — ora avviene **sotto la garanzia di istanza
unica**, perché il server viene avviato dal launcher che tiene il lock. In P3
quella sostituzione poggiava sull'assunto dello scrittore singolo; adesso
l'assunto è imposto.

---

## 5. Porta

### Configurazione

Invariata rispetto a P4:

```
MYFINANCE_PORT  →  config/settings.json .port  →  3000
```

### Ripiego

```
la porta configurata è libera   →  si usa quella
la porta configurata è occupata →  il kernel ne assegna una libera
```

Il ripiego **non è il comportamento predefinito**: è concesso solo da chi avvia
il processo, tramite `MYFINANCE_PORT_FALLBACK=1`, che il launcher impone perché
ha un browser da aprire. `npm start` e i test non lo impongono, e per una
ragione: in sviluppo una porta diversa da quella richiesta è un modo di non
accorgersi di avere due server accesi. Su `npm start` una porta occupata resta
quindi il messaggio leggibile introdotto da P4.

### Corsa

Il piano chiede esplicitamente che la decisione finale appartenga al processo
che apre il listener. È così:

```
launcher              «vorrei la 3000, e accetto un ripiego»
server                listen(3000)
                          └── EADDRINUSE → listen(0)
kernel                assegna una porta libera NELL'ATTO di occuparla
server                «sono sulla 53379»          ─── IPC ──→ launcher
launcher              apre il browser sulla 53379
```

Chiunque altro potrebbe soltanto *guardare* se una porta è libera e riferirlo,
e fra quell'istante e l'apposizione del listener un altro programma può
prendersela. `listen(0)` non ha quell'intervallo. Il launcher non sonda nessuna
porta.

### Comunicazione launcher ↔ server

Un canale **IPC**, non lo stdout analizzato con espressioni regolari e non un
file. Serve a due cose che su Windows non si ottengono altrimenti:

- il server dice quale porta ha aperto, perché è lui a saperlo;
- il launcher gli chiede di fermarsi, perché `process.kill` su Windows
  *termina* il processo invece di avvisarlo.

Il canale esiste solo se il processo è stato avviato con esso: `npm start` non
ce l'ha, e il codice se ne accorge senza saperlo (`typeof process.send`).

Il launcher passa anche `MYFINANCE_DATA` **esplicitamente**, con il valore
sulla cui cartella ha preso il lock. Non è ridondanza: ricalcolarla sarebbe la
stessa deduzione fatta due volte, e due deduzioni possono divergere — basta un
`settings.json` riscritto nel frattempo. Così il lock e il database sono la
stessa cartella per costruzione.

### Registrazione

```
[info] Avvio { …, configuredPort: 53403, portFallback: true, … }
[info] La porta 53377 era occupata: il server usa la 53379
       { configuredPort: 53377, actualPort: 53379 }
[info] Backend in ascolto su http://127.0.0.1:53379
       { configuredPort: 53377, actualPort: 53379 }
```

---

## 6. Shutdown

### Come viene richiesto

Tre sorgenti, tutte necessarie su Windows:

| sorgente | come arriva |
|---|---|
| la finestra viene chiusa | Node sintetizza `SIGHUP` e Windows concede pochi secondi: consolidare il WAL ne richiede una frazione |
| Ctrl+C in un terminale | `SIGINT` |
| `stop.bat` | canale di controllo + token letti dal lock |

Le tre convergono in una sola funzione, e l'arresto avviene **una volta sola**:
non è cortesia, è necessità — le sorgenti sono indipendenti e possono arrivare
insieme.

### Come viene propagato

```
launcher   riceve la richiesta
           │
           ├─ child.send({ type: 'shutdown' })      ← si CHIEDE, non si uccide
           │
           └─ arma un timeout di 20 s
                    │
server              riceve il messaggio
                    ├─ 1. scheduler fermato          ← prima di tutto il resto
                    ├─ 2. server.close()
                    ├─ 3. connessioni inattive chiuse subito
                    ├─ 4. dopo 5 s le restanti chiuse comunque
                    ├─ 5. PRAGMA wal_checkpoint(TRUNCATE)
                    ├─ 6. sqlite.close()
                    └─ 7. exit(0)
                    │
                    └─ se l'intera procedura non finisce entro 15 s:
                       si registra cosa non si è chiuso e si esce con 1
           │
launcher   il figlio è uscito → lock rilasciato, canale chiuso, uscita
           │
           └─ se non è uscito entro 20 s: terminazione forzata, REGISTRATA
              COME ERRORE, perché significa che il WAL non è consolidato
```

I due timeout sono annidati per costruzione: il server rinuncia a 15 s, il
launcher a 20 s, quindi la terminazione forzata è davvero l'ultima risorsa.

### Il WAL

Non viene toccato a mano. Il consolidamento è `PRAGMA wal_checkpoint(TRUNCATE)`
seguito da `close()`, già introdotto in WP-P2 e invariato: nessun file SQLite
viene manipolato direttamente, e nessun `-wal` viene cancellato. L'esito è
osservabile — `busy` dice se il consolidamento è avvenuto — e finisce nel
registro:

```
[info] Database chiuso, WAL consolidato
       { checkpointed: true, walPages: 0, movedPages: 0, alreadyClosed: false }
[info] Arresto completato
```

Misurato sul package reale (**caso M**): 121 kB di WAL prima dell'arresto,
**0 byte** dopo. Il database torna a essere un file singolo e copiabile — che è
il requisito su cui poggia l'intera portabilità.

### Il lock

Rilasciato dal launcher dopo l'uscita del figlio, dalla stessa funzione che
chiude il canale e smonta i gestori dei segnali.

---

## 7. Backup automatici

### Perché ora, e cosa era già deciso

WP-P3 ha scritto e provato la politica di ritenzione del tipo `auto` — sette
slot giornalieri **unione** quattro settimanali — ma nessuna parte del sistema
creava quei backup: la politica esisteva senza nulla da conservare. Il codice è
stato riletto prima di scrivere qualcosa: P3 definisce la **ritenzione**, non
una frequenza.

### Frequenza

**Ventiquattro ore**, e non è una scelta nuova: la ritenzione conserva il più
recente di ciascuno degli ultimi sette giorni, quindi un secondo backup nello
stesso giorno finirebbe nello stesso slot — sarebbe lavoro buttato. La cadenza
giornaliera è quella che quella politica già implicava.

### Configurazione

```
MYFINANCE_AUTO_BACKUP_HOURS  →  config/settings.json .autoBackupHours  →  24
```

`0` disattiva. Sono ammessi valori frazionari, che servono ai test — che non
possono attendere un giorno. Una variabile d'ambiente **vuota** significa «non
indicato» e non «zero»: `Number('')` vale `0`, e senza quel controllo una
variabile dichiarata e lasciata vuota avrebbe spento la funzione in silenzio
(difetto trovato dal test, non dal codice).

### L'attesa non parte dall'avvio

Un'applicazione da scrivania non è un servizio: può restare accesa dieci minuti
al giorno. Un timer di ventiquattro ore contato dall'avvio **non scatterebbe
mai**, e la copertura giornaliera promessa dalla ritenzione non esisterebbe. La
prima attesa si misura dal backup automatico **più recente presente su disco**:

```
nessun backup auto        →  margine di avvio
backup di 6 ore fa        →  18 ore
backup di 3 giorni fa     →  margine di avvio
backup datato nel futuro  →  un intervallo pieno   (orologio spostato indietro,
                                                    o archivio da un'altra macchina)
```

Il margine di avvio è 30 secondi — tiene il primo backup fuori dalla finestra
in cui si migra, si riempie il fingerprint e il browser chiede la prima
schermata — **limitato all'intervallo**: con una cadenza più corta del margine,
il margine diventerebbe la cadenza.

### Concorrenza

Due backup sovrapposti non sono improbabili: sono **impossibili**, e non per
una guardia che si potrebbe dimenticare di aggiornare, ma per la forma del
ciclo. `backupService.create` è sincrona — tutto l'accesso a SQLite in questa
applicazione lo è — e il timer successivo viene armato **dopo** che è
ritornata. `setTimeout` riarmato e non `setInterval`, che accumulerebbe
scadenze se una creazione durasse più dell'intervallo.

### Nessuna logica duplicata

Lo scheduler chiama esattamente ciò che chiama l'endpoint HTTP:
`backupService.create('auto')`. `VACUUM INTO`, la verifica e la ritenzione
esistono una volta sola, in `backupService`. Non è stato introdotto un secondo
`VACUUM INTO`.

### Fallimenti

Un backup fallito non ferma lo scheduler: `backupService` non lascia file a
metà, si registra l'errore e al prossimo intervallo si riprova. Rinunciare al
primo errore significherebbe non riprovare più.

### Durante l'arresto

Lo scheduler è parte del ciclo di vita e viene fermato **prima** di tutto il
resto (§6). Il timer è `unref`: il processo non resta vivo perché esiste un
backup programmato — ciò che tiene vivo il server è il server.

---

## 8. Test

```
backend tests:     579   (era 475 in P4;  +104, in 11 file nuovi;  40 file in totale)
frontend tests:    169   (invariati: P5 non tocca l'interfaccia)
package tests:      16   casi, tutti superati
typecheck:        PASS   (tsc --noEmit sul backend)
build:            PASS   (npm run build → frontend + backend)
verify:package:   PASS   16/16
```

La suite backend è stata eseguita **tre volte di fila** con 579/579, dopo aver
chiuso l'instabilità descritta in §12.

Il piano elenca `npm run typecheck` fra i comandi da verificare: nel repository
lo script equivalente è `typecheck:backend`, e i tipi del frontend sono
verificati dalla sua build (`npm run build:frontend`). Entrambi verdi.

### Copertura per requisito

| requisito | dove |
|---|---|
| §19 A — due istanze, stessa radice | `instance-lock.test.ts`, `run.test.ts`, caso **K** |
| §19 B — due istanze, radici diverse | `instance-lock.test.ts`, caso **K** |
| §19 C — rilascio e riavvio | `instance-lock.test.ts` (×2), `run.test.ts`, caso **M** |
| §19 D — dopo un crash | `instance-lock.test.ts` (×4: canale muto, pid vivo, lock illeggibile, altra radice), caso **N** |
| §20 — porta libera / occupata | `listen.test.ts` (×5), `run.test.ts`, caso **L** |
| §21 — pronto prima del browser | `readiness.test.ts` (×9), `run.test.ts`, caso **P** |
| §22 — arresto ordinato | `shutdown.test.ts`, `run.test.ts` (×2), caso **M** |
| §23 — backup automatici | `backup.scheduler.test.ts` (×21), caso **O** |
| §24 — dodici scenari Windows | §9 di questo report |
| §25 — aggiornamento | caso **Q** |

Tutti i test che avviano l'applicazione usano `mkdtempSync` per la radice dati.
I test del launcher **non aprono nessun database**, ed è il punto: il lock deve
venire prima.

### Il server finto

`run.test.ts` avvia un server finto che parla il protocollo del launcher. Non è
una scorciatoia: è ciò che permette di provocare a comando le condizioni che
contano e che sul server vero non si possono ottenere — un processo che muore
all'avvio con un codice preciso, uno che si mette in ascolto e non risponde
alla salute, uno che **ignora** la richiesta di arresto. Il server vero,
avviato dal launcher vero, è provato dal package in `verify:package`.

---

## 9. Test Windows

Eseguiti sul package reale, copiato **fuori dal repository**, con `PATH`
ridotto alle cartelle di sistema (`where node` → non trovato) e la radice dati
sempre temporanea.

I dodici scenari richiesti dal §24:

| n. | scenario | caso | esito |
|---|---|---|---|
| 1 | directory ASCII | A/C/I | ok |
| 2 | percorso con spazi | E/G/J — `…\Portable Apps\…\My Finance\` | ok |
| 3 | percorso con accenti | E/G/J — `…\Applicazioni Portàtili\…` | ok |
| 4 | annidamento profondo | E/G/J — cinque livelli | ok |
| 5 | `DATA_ROOT` esterno | F — `…\Archivio Utente` | ok |
| 6 | package spostato | E/G/J | ok |
| 7 | seconda istanza | **K** | ok |
| 8 | porta occupata | **L** | ok |
| 9 | startup failure | «start.bat propaga il codice di uscita» | ok |
| 10 | shutdown | **M** | ok |
| 11 | riavvio dopo shutdown | **M** | ok |
| 12 | riavvio dopo terminazione anomala | **N** | ok |

E i casi aggiunti da P5, con ciò che hanno misurato:

| caso | misura |
|---|---|
| **K** istanza unica | stesso archivio: rinuncia con uscita **0** e messaggio che indica `127.0.0.1:53364`; archivi diversi: 53364 e 53371 **entrambe attive**; il lock del primo non viene alterato |
| **L** porta occupata | configurata 53377 (occupata da un processo di test), effettiva 53379, `/api/health` risponde `ok`, il presidio resta al suo posto |
| **M** arresto ordinato | `stop.bat` → uscita 0; WAL **121 kB → 0**; lock rilasciato; porta libera; riavvio: 2 transazioni ritrovate |
| **N** terminazione brusca | lock residuo del processo 15000 con canale muto → nuova istanza sul canale 60230; 1 transazione ritrovata (WAL recuperato) |
| **O** backup automatici | 2 backup creati con cadenza di due secondi; nella cartella ne resta **1**, come vuole la ritenzione; verificato via API: `completo`, 1 transazione; scheduler fermato con l'applicazione, nessun backup e **nessun timer** dopo |
| **P** ordine dell'avvio | `Server avviato` → `Backend in ascolto` → `Server pronto` → decisione sul browser, in quest'ordine nel registro |
| **Q** aggiornamento | arresto ordinato → `app/`, `runtime/`, `start.bat`, `stop.bat` rimossi e ricopiati da capo → 3 transazioni, 1 backup dell'utente e 22 categorie ritrovati, migrazioni non riapplicate, nessuna `data/` comparsa nel package |

### Doppio clic

Provato a mano sul package: la finestra di `cmd` resta aperta per la durata
dell'applicazione — **è** la finestra dell'applicazione — e chiuderla avvia
l'arresto ordinato tramite `SIGHUP`. In caso di errore la finestra viene
trattenuta con un messaggio, e solo in quel caso (§11, deviazione 6).

---

## 10. Database reale

```
REAL DATABASE TOUCHED: NO
```

Non assunto: **dimostrato**, e in questo WP con una prova più stretta dei
precedenti.

### Prima e dopo

| misura | prima (2026-09-02 12:15) | dopo (2026-09-02 13:31) |
|---|---|---|
| SHA-256 | `b68a8bf4323a65fc41892382ee8261496495aeaf471a55ffca76ebf42fe6d829` | **identico** |
| dimensione | 507 904 byte | 507 904 byte |
| `integrity_check` | ok | ok |
| transazioni | 931 | 931 |
| merchants | 452 | 452 |
| categories | 22 | 22 |
| loans / loan_repayments | 2 / 1 | 2 / 1 |
| settings | 1 | 1 |
| `__drizzle_migrations` | 9 | 9 |
| `data/backups/` | vuota | vuota |
| `data/tmp/` | vuota | vuota |
| `restore-pending.json` | assente | assente |
| `instance.lock` | assente | **assente** |
| `database.sqlite-wal` | 0 byte | 0 byte |
| ultimo log reale | 2026-09-01 15:28:22 | 2026-09-01 15:28:22 |

### La prova più stretta

I conteggi sono stati letti su una **copia** del file, non sull'originale: il
database reale è stato toccato soltanto come sequenza di byte (`sha256sum`,
`cp`). Ne consegue una verifica che i WP precedenti non potevano fare:

```
database.sqlite-shm   prima:  2026-09-02 11:41:38.721111400
                      dopo:   2026-09-02 11:41:38.721111400
```

La marca temporale è **identica al nanosecondo**. Aprire un database in
modalità WAL — anche in sola lettura — aggiorna quel file; il fatto che non sia
cambiato dimostra che durante l'intero WP il database reale **non è stato
aperto nemmeno una volta**, in nessuna modalità. Quell'orario, 11:41, precede
l'inizio di P5 (12:15) ed è la verifica finale di WP-P4.

Il registro reale ha l'ultima scrittura del **1 settembre**: nessun processo di
P5 ha usato la radice dati reale, perché il primo atto di ogni avvio è scrivere
lì i percorsi che sta usando.

### Come è stato ottenuto

- Ogni test che avvia l'applicazione riceve una radice dati da `mkdtempSync`.
- `verify:package` legge **dal registro del processo figlio** quale `DATA_ROOT`
  ha effettivamente aperto, e si ferma con
  `ISOLAMENTO NON DIMOSTRATO — verifica interrotta` se non è quella
  temporanea, se non è sotto la cartella temporanea del sistema, se coincide
  con una delle due radici reali, o se `APP_ROOT` non sta dentro il package in
  prova. Il controllo gira **prima** di qualunque richiesta che scriva.
- La verifica di §17 (`npm start` intatto) è stata eseguita con
  `MYFINANCE_DATA` temporanea, e l'isolamento letto dal log del processo.
- Nessuna prova ha usato la porta 3000.

### Un difetto di isolamento trovato e corretto

Alla prima esecuzione, quattro casi su sedici sono falliti (D, E/G/J, F, N).
Causa: dopo una terminazione brusca il lock resta su disco **completo della
porta del server morto**, e il mio strumento di verifica la leggeva come se
descrivesse il processo appena avviato — interrogando una porta chiusa.

È la stessa classe di difetto trovata in WP-P4 (leggere la *prima* riga di
avvio da un log condiviso fra esecuzioni): **un controllo che verifica il
processo sbagliato**, che è peggio di nessun controllo. Corretto attendendo un
lock con un **token diverso** da quello presente prima dell'avvio: il token
nasce con l'istanza.

---

## 11. Deviazioni

| n. | deviazione | motivazione |
|---|---|---|
| 1 | **`stop.bat` aggiunto** al package, che l'albero del §2 non elencava | §22 chiede di richiedere l'arresto «tramite il meccanismo del launcher». Senza uno strumento utilizzabile, quel meccanismo sarebbe raggiungibile solo da chi sa parlare il protocollo del canale. L'albero è dichiarato «equivalente», e l'aggiunta non tocca nulla |
| 2 | `--stop` è un argomento del launcher, non un terzo artefatto | il percorso per trovare l'istanza — il lock dentro `DATA_ROOT` — dipende dalla stessa risoluzione dei percorsi. Un secondo programma la dedurrebbe una seconda volta |
| 3 | `launcher.js` **accanto** a `server.js`, non in `app/launcher/` | è ciò che fa risolvere `APP_ROOT` in modo identico ai due bundle (§3). Una cartella propria avrebbe introdotto la divergenza che `paths.ts` esiste per impedire |
| 4 | single-instance con lock atomico + socket, **non** un mutex Win32 | il mutex richiede codice nativo, cioè una dipendenza nuova. La combinazione scelta è atomica come un mutex e, in più, non lascia stato residuo dopo un crash (§4) |
| 5 | «già in esecuzione» esce con **0**, non con un codice d'errore | l'utente voleva vedere l'applicazione, e l'applicazione c'è: gli si apre quella. Un codice d'errore su un doppio clic mostrerebbe un errore per qualcosa che non lo è |
| 6 | nessuna modalità senza finestra: la console **è** la finestra dell'applicazione | §10 chiede la soluzione più semplice che dia errori visibili, un codice di uscita significativo e un arresto controllato. La console li dà tutti e tre, e chiuderla è un arresto ordinato (`SIGHUP`). Nasconderla richiederebbe un secondo meccanismo per mostrare gli errori e uno per fermare l'applicazione |
| 7 | il ripiego di porta è **concesso**, non predefinito | in sviluppo una porta diversa da quella richiesta nasconde due server accesi. Il launcher lo concede perché ha un browser da aprire (§5) |
| 8 | margine di avvio dello scheduler = `min(30 s, intervallo)` | rende lo scheduler osservabile in un test **senza un valore riservato ai test**, e con la cadenza reale il minimo non entra in gioco |
| 9 | `autoBackupHours` è una configurazione nuova | §13 vieta di inventarne una senza aver prima verificato codice e documentazione. Verificato: P3 definisce la ritenzione e nessuna frequenza. Il valore predefinito è **derivato** dalla ritenzione, non scelto (§7) |
| 10 | `npm run typecheck` non esiste nel repository | lo script equivalente è `typecheck:backend`; i tipi del frontend li verifica la sua build. §27 ammette «gli script equivalenti già presenti» |
| 11 | `restore.runtime.test.ts` modificato | non per comodità: vedi §12. Nessun test è stato rimosso o indebolito |
| 12 | il lock lo prende il **launcher**, quindi `npm start` non ha istanza unica | limite dichiarato: vedi §12 |

---

## 12. Debiti tecnici

### Nuovi, introdotti da questo WP

**`npm start` non ha la protezione di istanza unica.** Il lock lo acquisisce il
launcher, quindi due `npm start` sulla stessa radice dati aprirebbero due
connessioni. Perché non è nel server: il riconoscimento di un lock abbandonato
richiede di **mettersi in ascolto su un socket**, che è un'operazione
asincrona, e l'apertura del database avviene nella valutazione sincrona dei
moduli (`db/client.ts`), dove un `await` non può stare. Spostarla vorrebbe dire
riscrivere l'ordine di avvio che WP-P3 ha costruito deliberatamente in modo
non invertibile. Mitigazione parziale già presente: fuori dal launcher **non
c'è ripiego di porta**, quindi due `npm start` sulla porta predefinita
falliscono il secondo con un messaggio chiaro. Non è un lock sull'archivio, e
non lo si spaccia per tale.

**La finestra della console è la finestra dell'applicazione.** Chiuderla è un
arresto ordinato, ma resta una finestra di testo davanti a chi usa
un'applicazione con interfaccia web. Renderla invisibile richiede un secondo
meccanismo per gli errori e uno per l'arresto: è una scelta di prodotto, non un
difetto da correggere di nascosto.

**`start.bat` dipende da `find.exe`** per capire se la finestra è temporanea.
Trovato durante le prove: su una macchina con Git o MSYS nel `PATH`, `find` è
quello di Unix, non conosce `/i` e stampa un errore. Corretto invocandolo per
**percorso assoluto** (`%SystemRoot%\System32\find.exe`, con ripiego su
`C:\Windows` se `SystemRoot` non è definita) — la stessa disciplina già usata
per `cmd.exe` via `COMSPEC`. Il guasto era comunque benigno: la variabile non
veniva impostata e l'avvio proseguiva.

**Un `!` nel percorso del package** interagisce con l'espansione ritardata usata
per quella rilevazione. L'espansione ritardata è attiva solo per le due righe
del controllo e viene chiusa con `endlocal` prima della riga di avvio, quindi
il lancio non ne è interessato; resta che con un `!` nel nome della cartella la
rilevazione della finestra temporanea può sbagliare. `&` e le parentesi — i
casi realistici — sono coperti.

**Se il server ignora la richiesta di arresto** viene terminato di forza dopo
20 secondi e il WAL non viene consolidato. È registrato come **errore**, non
come nota, perché chi legge il registro deve sapere che il database in quel
momento non è un file singolo. Provato (`run.test.ts`).

### Scoperti e non risolti

**Su Windows l'uscita di un processo non implica il rilascio immediato dei suoi
file.** Un test di WP-P3 (`restore.runtime.test.ts`) termina il processo di
proposito e poi apre il database in scrittura: il recupero del WAL — che tronca
il file — può incontrare l'handle del processo che sta morendo e fallire con
`SQLITE_IOERR_TRUNCATE`. Il difetto era **latente da P3** ed è emerso ora
perché gli undici file di test nuovi hanno aumentato il carico in parallelo.
Non è correggibile dall'applicazione: è la conseguenza di una terminazione
brusca, che è esattamente ciò che quel test provoca. Corretto
nell'**armatura di test**, che ora riprova invece di assumere; la suite è stata
poi eseguita tre volte con 579/579. Il difetto è comunque un promemoria: dopo
un `taskkill`, il file non è subito disponibile.

**La suite di test lascia le proprie cartelle temporanee su disco.** Ogni
esecuzione di `npm run test:backend` crea una quarantina di cartelle
`%TEMP%\appconto-*`, e su Windows la rimozione finale non sempre riesce perché
il file del database resta bloccato dal processo che sta uscendo — la stessa
causa del punto precedente. Comportamento preesistente (i test di P1–P3 lo
hanno sempre avuto), notato ora perché la suite è stata eseguita molte volte in
una giornata: si erano accumulati 513 residui per circa 969 MB, rimossi. Non
tocca l'applicazione e non falsa nessun test; sarebbe da chiudere con una
pulizia in coda alla suite, in un WP di manutenzione insieme a `escapeLike`.

### Preesistenti, invariati

- **`escapeLike()`** — non corretto, come il piano richiede esplicitamente. Il
  fix è di una riga in `apps/backend/src/shared/sql.ts` e merita un WP di
  manutenzione.
- **`cors` e `@types/cors`** dichiarati e non usati, residuo di WP-P1. Non
  finiscono nel package: il bundle include solo ciò che è raggiungibile dagli
  import.
- **Nessuna interfaccia per backup e ripristino**: la funzione è solo API. Ora
  che i backup automatici esistono, l'assenza si sente di più — l'utente non
  ha modo di *vedere* che vengono creati, se non aprendo la cartella.
- **Il package è solo `win32-x64`**, e il 95% dei 90 MB è `node.exe`.
- **`fs.cpSync` verso percorsi non ASCII** copia zero file senza segnalare
  nulla (scoperto in P4): mitigato in `scripts/copy-tree.mjs`, resta un debito
  verso l'esterno.

---

## 13. Criterio di completamento

```
doppio clic
    ↓
MyFinance
    ↓
server locale
    ↓
browser
```

**Sì**, e per ciascuna delle sei condizioni richieste:

| condizione | come è soddisfatta | dove è dimostrata |
|---|---|---|
| una sola istanza per `DATA_ROOT` | lock atomico dentro la radice dati, la cui validità è attestata da un socket in ascolto — non da un file che sopravvive a chi l'ha scritto | caso **K**, `instance-lock.test.ts` (13 test), `run.test.ts` |
| porta gestita automaticamente | il launcher chiede quella configurata e concede il ripiego; a scegliere è il kernel, nell'atto di occupare la porta; il browser segue quella vera | caso **L**, `listen.test.ts` (5 test) |
| errori leggibili | due categorie — ciò che l'utente può correggere, e ciò che va diagnosticato dal registro — e la finestra trattenuta **solo** quando sparirebbe portandosi via il messaggio | `presentation.test.ts` (7 test), `run.test.ts`, caso «codice di uscita» |
| shutdown ordinato | si **chiede** al server di fermarsi, e si attende; su Windows non esiste altro modo, perché terminare un processo non consegna nessun segnale | caso **M** (WAL 121 kB → 0), `shutdown.test.ts` |
| dati persistenti | sopravvivono all'arresto ordinato, alla terminazione brusca e alla sostituzione del programma | casi **M**, **N**, **Q** |
| package aggiornabile senza perdita dati | `app/`, `runtime/` e i due `.bat` rimossi e ricopiati da capo: `config/` e `data/` non vengono sfiorate | caso **Q** |

In più, non richiesto dal criterio ma richiesto dal piano: i backup automatici
esistono, hanno la cadenza che la ritenzione di P3 già implicava, non possono
sovrapporsi, e si fermano con l'applicazione (caso **O**).

Restano fuori due cose, dichiarate e non nascoste: `npm start` non ha
l'istanza unica, e la finestra della console è la finestra
dell'applicazione (§12).

---

## Appendice — il package

```
MyFinance/                                  33 file, 90,2 MB
├── start.bat                               avvia il launcher
├── stop.bat                                chiede l'arresto ordinato
├── runtime/
│   └── node.exe                            v24.11.1 win32-x64, versione fissata
├── config/
│   └── settings.example.json               port, dataRoot, autoBackupHours
└── app/
    ├── VERSION · RUNTIME.json
    ├── backend/
    │   ├── launcher.js                     33 kB   ciclo di vita
    │   ├── server.js                     2 067 kB   applicazione
    │   ├── package.json                             {"type":"module"}
    │   └── native/better_sqlite3.node    1 943 kB
    ├── frontend/                                    build Angular di produzione
    └── drizzle/                                     le migrazioni
```

`launcher.js` non contiene l'applicazione, e non è un'aspirazione: la build
fallisce se quel bundle arriva a contenere un modulo CommonJS — che nel
launcher potrebbe essere solo un addon nativo — o il codice di `express`,
`papaparse` o `drizzle-orm`. La guardia è stata **provata reintroducendo il
difetto**: un `import` di `db/client.js` nel launcher la fa scattare con il
motivo esatto.

Se quel controllo non ci fosse, un `import` sbagliato farebbe aprire il
database al launcher **prima** che il lock esista — cioè proprio ciò che il
lock esiste per impedire — e lo farebbe in silenzio, perché funzionerebbe.
