# Saldo — specifica di design system

Riferimento per l'implementazione dell'interfaccia scelta (Variante A · Restrained, con tema dark e light). Questo documento accompagna `design-tokens.json`, che contiene tutti i valori numerici ed esadecimali. Qui ci sono le regole di utilizzo, la struttura dei componenti e i vincoli da rispettare per un'implementazione fedele al mockup approvato.

**Istruzione per Claude Code**: usa `design-tokens.json` come unica fonte di verità per colori, tipografia, spaziatura e raggi. Non dedurre o approssimare un valore — se un caso d'uso non è coperto da questo documento, segnalalo invece di inventare un valore plausibile.

---

## 1. Principio guida

Un solo set di regole (layout, spaziatura, raggi, tipografia, stati dei componenti) applicato a due palette di colore diverse. Il tema chiaro **non è un'inversione** del tema scuro: è una mappatura sistematica in cui ogni colore mantiene la propria tinta (hue) e cambia solo luminosità/saturazione, così una categoria o uno stato resta riconoscibile passando da un tema all'altro.

Conseguenza pratica: se per cambiare tema devi toccare altro oltre alla tabella dei colori attiva, l'implementazione si è discostata dal sistema.

## 2. Architettura dei token

Tre livelli, da non appiattire in uno solo:

1. **Primitivi** — i valori esadecimali grezzi (`design-tokens.json` → `color.dark.*` / `color.light.*`)
2. **Semantici** — il ruolo che quel colore gioca (`primary`, `income`, `text-muted`, `surface-elevated`...). Sono i nomi già usati nel JSON.
3. **Componente** — valori derivati per un elemento specifico (es. `primaryButton.hover.background`), definiti in `componentStatesReference`.

Nel codice, i componenti devono referenziare **solo** il livello semantico o componente — mai un esadecimale primitivo scritto a mano. Questo è il singolo vincolo più importante per garantire fedeltà: un colore hardcoded è un punto di divergenza garantito la prima volta che il token cambia.

## 3. I due temi

Ogni token semantico ha un valore nel set `dark` e uno nel set `light` (vedi JSON). Il meccanismo di switch deve:

- Mantenere un'unica sorgente di verità per **quale** token è attivo (es. uno stato/contesto globale `theme: 'dark' | 'light'`)
- Risolvere ogni riferimento a token attraverso quello stato, mai duplicare i componenti per tema
- Non toccare nessun valore di layout, spaziatura, raggio o font-size al cambio tema — sono identici in entrambi i set

Le superfici invertono il verso percettivo tra i due temi (nel dark la navigazione è più scura della pagina, nel light è più chiara e le card diventano bianche), ma questo emerge automaticamente dalla sostituzione dei token — non richiede logica condizionale nei componenti.

## 4. Tipografia — regola non negoziabile

Ogni valore numerico finanziario (importi, percentuali, date tabellari) usa **sempre** `Geist Mono` con `font-variant-numeric: tabular-nums`. Il resto dell'interfaccia usa `Geist`. Non è uno stile decorativo: serve ad allineare le cifre in colonna e a distinguere a colpo d'occhio dato numerico da testo descrittivo.

La gerarchia tra i numeri (saldo principale vs. importo di riga) si ottiene per **contrasto di colore**, non per dimensione — nessun numero nell'interfaccia supera 25px, nemmeno il KPI principale in dashboard.

## 5. Regola entrate/uscite

Il colore da solo non è mai sufficiente per distinguere entrata da uscita: deve sempre essere accoppiato ad almeno uno tra segno esplicito (+/−), triangolo direzionale, o posizione rispetto all'asse zero nei grafici. Questo vale per ogni vista che mostra importi (dashboard, movimenti, cash flow, analisi) ed è un requisito di accessibilità, non stilistico.

## 6. Struttura di layout

Tutte le viste condividono la stessa impalcatura a tre colonne:

- **Sidebar** di navigazione (contenuto fisso: voci di menu principali)
- **Colonna centrale** — il "posto dei dati": tabelle, grafici, liste di transazioni
- **Toolbox laterale destra** — contenuto contestuale alla vista (filtri e ordinamento in Movimenti, dimensioni e confronti in Analisi, aggregazione e proiezione in Cash flow)

La forma della toolbox non cambia tra le viste, solo il suo contenuto. Non introdurre varianti di layout per vista: se una schermata sembra richiedere una struttura diversa, il problema è nel contenuto della toolbox, non nell'impalcatura.

## 7. Ordine di costruzione dei componenti

Costruire dal basso verso l'alto, verificando la fedeltà ad ogni livello prima di salire a quello successivo:

1. **Fondamenta**: applicare i token di `design-tokens.json` come variabili/tema nel progetto
2. **Atomici**: bottone, input, badge, tag, toggle — ciascuno con tutti gli stati elencati in `componentStatesReference` (default, hover, active, focus, disabled)
3. **Compositi**: card, riga di tabella, filtro — costruiti sopra gli atomici, mai duplicando i loro stili
4. **Viste**: dashboard, movimenti, analisi, cash flow — composizione dei compositi secondo la struttura di layout (punto 6)

Un errore nel bottone primario a livello atomico si propaga in ogni vista che lo usa — per questo l'ordine importa quanto i valori stessi.

## 8. Stati dei componenti — nota sui valori "literal"

`design-tokens.json` → `componentStatesReference` marca due valori come `literal` invece che come riferimento a un token semantico: il bordo hover del bottone primario e lo sfondo disabled di bottone/input. Sono tinte intermedie verificate nel mockup ma non presenti nella tabella dei colori principali. Valori equivalenti verificati per il tema light:

| Stato | Dark (verificato) | Light (verificato) |
|---|---|---|
| bordo hover bottone primario | `#A5A1DA` | `#7B74D6` |
| sfondo disabled (bottone) | `#1A1C21` | `#F0F0ED` |
| sfondo disabled (input) | `#101216` | `#F2F2EF` |

Il testo del bottone primario in stato **hover** nel mockup dark usa `#0A0B0D` (colore di sfondo dell'app stesso, per contrasto sulla tinta più chiara). Questo valore specifico non è stato verificato per il tema light nel mockup sorgente — prima di implementarlo, controllare il contrasto testo/sfondo sul valore hover `#625CC0` (light) e regolare se necessario. È l'unico punto della specifica con questa avvertenza.

## 9. Checklist di verifica per ogni schermata

Prima di considerare una vista completa, verificare:

- [ ] Ogni spaziatura (padding/margin) corrisponde a un valore della scala `spacing.scale`, non a un numero arbitrario
- [ ] Ogni importo/percentuale/valore numerico usa `fontFamily.mono` con `tabular-nums`
- [ ] Ogni border-radius corrisponde alla categoria corretta dell'elemento (badge/controllo/input/card/pill)
- [ ] Contrasto testo minimo 4.5:1 su ogni combinazione testo/sfondo, in entrambi i temi
- [ ] Entrate/uscite non si distinguono mai solo per colore
- [ ] Tutti gli stati interattivi sono implementati (non solo default) su bottoni, input, righe di tabella
- [ ] Passando da dark a light, layout/spaziatura/tipografia restano bit-per-bit identici — cambia solo il colore

## 10. Cosa non è coperto da questa specifica

Questo documento copre i token fondamentali e gli stati dei componenti principali (bottone, input, riga di tabella). Non copre: micro-interazioni/animazioni, breakpoint responsive sotto i 1440px, e componenti di dettaglio non presenti nel mockup (es. modali, toast). Queste decisioni vanno prese esplicitamente prima dell'implementazione — non dedotte per analogia dal resto del sistema.
