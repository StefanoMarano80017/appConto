/// <reference types="node" />
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'sass';

/**
 * Il test che fissa la cascata dei campi di modulo (Task 5).
 *
 * NOTA 1 — perché non si monta un `<input>` a mano senza altro: la bozza del
 * brief creava l'elemento e ne leggeva subito `getComputedStyle`, senza
 * iniettare nulla. Provato per davvero (vedi anche `tokens.spec.ts`, che
 * documenta lo stesso problema): in questo ambiente (`@angular/build:unit-test`,
 * jsdom in Node) il foglio globale con le regole compilate da `styles.scss`
 * non finisce mai da solo nel documento — solo lo `<style>` che Angular
 * inietta a runtime per il componente montato, che referenzia i token ma non
 * li definisce. Un test così misurerebbe il nulla. La soluzione, presa in
 * prestito da `tokens.spec.ts`: compilare `styles.scss` con lo stesso Sass
 * della build reale e iniettare il CSS risultante in un `<style>` del
 * documento di test — il passo che la pipeline di test non compie da sola.
 *
 * NOTA 2 — perché le asserzioni sotto quasi mai leggono un colore: misurato,
 * non ipotizzato. jsdom applica la cascata e riconosce gli pseudo-selettori
 * (`:disabled`, `:focus-visible` dopo una vera `.focus()`), ma il suo motore
 * CSS non risolve `var(--token)` dentro `background`/`border-color`: un
 * elemento attivo e uno disabilitato risultavano identici (`rgba(0, 0, 0,
 * 0)`, il default, per entrambi) perché l'intera dichiarazione con `var()`
 * non veniva applicata. Per proprietà con un parser piu' permissivo — non
 * composite in longhand multipli, come `border-radius` e, si scopre,
 * `box-shadow` — il valore torna invece testuale e non risolto
 * (`"var(--radius-input)"`, `"0 0 0 3px var(--color-focus-ring)"`), utile per
 * provare che un selettore ha vinto la cascata (o per confrontarlo con un
 * `box-shadow: none` letterale, altrettanto leggibile), ma mai per leggere
 * la resa finale a colori.
 * Le proprietà che tornano un valore pienamente risolto sono quelle SENZA
 * `var()` dentro la dichiarazione: `cursor: not-allowed` (stato disabilitato),
 * `outline: none` (stato focus-visible), `box-shadow: none` (idem). Sono
 * quindi la base di questo test.
 *
 * NOTA 3 — due stati dichiarati nel Task 5 restano non verificabili qui, per
 * limiti di jsdom confermati con una prova diretta, non per pigrizia:
 * - `:hover` — `elemento.matches(':hover')` risulta sempre `false`: jsdom non
 *   tiene uno stato di puntamento reale e non esiste un modo per indurlo.
 * - `:user-invalid` — `elemento.matches(':user-invalid')` risulta sempre
 *   `false` anche su un campo `required` reso non valido e con `blur`
 *   simulato, mentre `:invalid` sullo stesso campo risulta `true`: il motore
 *   selettori di jsdom non implementa l'euristica "interazione dell'utente"
 *   che distingue `:user-invalid` da `:invalid`.
 * - `:focus-visible` su `input[type="file"]` — dipende dall'ORDINE dei test:
 *   risulta `true` se è il primo `.focus()` indotto nell'intero file di
 *   spec, `false` se un test precedente ha già messo a fuoco un altro
 *   elemento (lo stesso richiamo su un secondo `input[type="text"]` resta
 *   `true`: il problema è specifico del tipo `file`). Verificato con prove
 *   dirette ripetute, non è un'ipotesi. Un'asserzione sulla cascata qui
 *   dipenderebbe dall'ordine dei test, non dalla regola CSS: il controllo
 *   scende quindi a livello testuale sul sorgente compilato (vedi il test
 *   dedicato più sotto).
 * Questi stati restano verificati solo dal giro visivo (Step 5) o da un
 * controllo testuale sul sorgente, mai da un'asserzione più debole
 * spacciata per equivalente.
 */

const QUI = dirname(fileURLToPath(import.meta.url));
/** `src/`, tre livelli sopra `src/app/shared/styles` — come in `tokens.spec.ts`. */
const SRC = join(QUI, '../../..');
const cssGlobale = compile(join(SRC, 'styles.scss'), { loadPaths: [SRC] }).css;

/**
 * `cssGlobale` SENZA i commenti (blocchi `/* ... *\/`, l'unica forma di
 * commento che sopravvive alla compilazione Sass — niente `//`). Ogni
 * asserzione testuale di questo file (`toContain`/`toMatch` su una stringa,
 * non una lettura di cascata via `getComputedStyle`) legge questa costante,
 * mai `cssGlobale` direttamente.
 *
 * Il motivo, misurato: Sass conserva i commenti nel CSS compilato, e una
 * riga come `expect(cssGlobale).toMatch(/input\[type=['"]checkbox['"]\]/)`
 * risultava verde per anni per il motivo sbagliato — non perché la regola
 * `input[type=checkbox]` (Sass non emette mai apici in un selettore
 * d'attributo) contenesse quel pattern, ma perché il COMMENTO sopra la
 * regola, scritto in prosa, citava `input[type="checkbox"]` con gli apici
 * per leggibilità. Quando l'utente ha riscritto quel commento (per
 * `.checkbox-control`, un lavoro indipendente da questo), l'asserzione è
 * diventata rossa senza che nessuno dei cinque selettori veri fosse
 * cambiato: segnalava una regressione inesistente, e per tre giri di
 * correzione non aveva segnalato che non stava guardando i selettori.
 *
 * La rimozione è ingenua (un solo pattern non-greedy) apposta: verificato
 * sul CSS compilato reale che nessuna dichiarazione usi `/*` dentro una
 * stringa (`content: '';` è l'unico `content:` del foglio, letterale vuoto),
 * quindi non c'è un caso che la romperebbe in questo sorgente.
 */
const cssSenzaCommenti = cssGlobale.replace(/\/\*[\s\S]*?\*\//g, '');

describe('stili globali dei campi di modulo', () => {
  let foglio: HTMLStyleElement;
  const elementiDiProva: HTMLElement[] = [];

  beforeEach(() => {
    foglio = document.createElement('style');
    foglio.textContent = cssGlobale;
    document.head.appendChild(foglio);
  });

  afterEach(() => {
    foglio.remove();
    for (const elemento of elementiDiProva) {
      elemento.remove();
    }
    elementiDiProva.length = 0;
  });

  function creaCampo(tipo: string): HTMLInputElement {
    const campo = document.createElement('input');
    campo.type = tipo;
    document.body.append(campo);
    elementiDiProva.push(campo);
    return campo;
  }

  it('un input disabilitato prende il cursore "not-allowed" che solo la regola :disabled dichiara', () => {
    const attivo = creaCampo('text');
    const disabilitato = creaCampo('text');
    disabilitato.disabled = true;

    // Il campo attivo non ha alcuna regola che tocchi `cursor`: deve restare
    // al valore iniziale (stringa vuota in jsdom), non "not-allowed".
    expect(getComputedStyle(attivo).cursor).not.toBe('not-allowed');
    expect(getComputedStyle(disabilitato).cursor).toBe('not-allowed');
  });

  it('un input a fuoco (:focus-visible) azzera l\'outline dichiarato dalla regola globale', () => {
    // Attenzione: al massimo UNA lettura di `getComputedStyle` per test dopo
    // un cambio di focus, e mai una lettura precedente al `.focus()`.
    // Verificato con prove dedicate, ripetute: in questo jsdom la prima
    // lettura di `getComputedStyle` dopo un cambio di focus fissa un valore
    // che OGNI lettura successiva continua a restituire — non solo sullo
    // stesso elemento, ma anche su un elemento diverso letto subito dopo, e
    // un nuovo cambio di focus non la invalida. Leggerlo prima del focus,
    // solo per controllare lo stato "non ancora a fuoco", congela quindi ''
    // anche dopo la `.focus()`; leggerlo due volte in un solo test (anche su
    // due elementi distinti) fa sì che la seconda lettura restituisca il
    // valore della prima — un artefatto dell'ambiente di prova, non della
    // regola CSS. Il test verifica quindi solo lo stato dopo il focus, con
    // una sola lettura (lo stesso vincolo vale per `search-input-focus-ring.
    // spec.ts`, isolato in un file a se' per la stessa ragione).
    const campo = creaCampo('text');

    campo.focus();
    // In jsdom `:focus-visible` matcha dopo una `.focus()` reale: verificato,
    // non assunto (vedi NOTA 2).
    expect(campo.matches(':focus-visible')).toBe(true);
    expect(getComputedStyle(campo).outline).toBe('none');
  });

  it('una casella di controllo resta esclusa dalla regola generica (niente border-radius)', () => {
    const campoDiTesto = creaCampo('text');
    const casella = creaCampo('checkbox');

    // Sul campo di testo il selettore generico ha vinto la cascata: il valore
    // torna testuale e non risolto (NOTA 2), ma la sua sola presenza prova che
    // la regola è stata applicata.
    expect(getComputedStyle(campoDiTesto).borderRadius).toBe('var(--radius-input)');

    // Sulla casella `:not([type='checkbox'])` esclude il match: nessuna
    // regola di questo foglio dichiara un border-radius per lei, quindi il
    // valore resta quello iniziale.
    expect(getComputedStyle(casella).borderRadius).toBe('');
  });

  it('un campo file resta escluso dal bordo generico (regola di base)', () => {
    // Deciso dal coordinatore dopo la consegna iniziale: `input[type="file"]`
    // rende un bottone nativo ("Scegli file") e bordo/padding/sfondo intorno
    // producono un riquadro dentro un riquadro — stessa famiglia di
    // checkbox/radio, quindi stessa esclusione dalla regola generica.
    const campoFile = creaCampo('file');

    // Escluso dalla regola di base: nessun border-radius dichiarato per lui.
    expect(getComputedStyle(campoFile).borderRadius).toBe('');
  });

  it('il focus-visible su un campo file NON è verificabile via cascata in jsdom: controllo testuale sul sorgente', () => {
    // Provato per davvero, non assunto: `campoFile.matches(':focus-visible')`
    // dopo una `.focus()` reale risulta `true` se è il PRIMO focus indotto in
    // tutto il file di test, ma `false` se un test precedente ha già chiamato
    // `.focus()` su un altro elemento — un artefatto dell'euristica interna di
    // jsdom specifico per `input[type="file"]` (lo stesso richiamo su un
    // secondo `input[type="text"]` resta `true`). Un'asserzione così
    // dipenderebbe dall'ordine dei test, non dalla regola CSS: qui si
    // verifica quindi solo che il sorgente NON escluda `[type="file"]` dal
    // selettore `:focus-visible` (a differenza di base/hover/disabled/
    // user-invalid, che lo escludono tutti).
    const blocco = cssSenzaCommenti.match(/input:focus-visible[^{]*\{[^}]*\}/)?.[0] ?? '';
    expect(blocco).not.toBe('');
    expect(blocco).not.toMatch(/:not\(\[type=file\]\)/);
  });

  // Il test sul doppio anello di `.search` (rilievo 1, giro di correzione 1)
  // vive in un file a se': `search-input-focus-ring.spec.ts`, non qui.
  // Verificato con una prova dedicata: la "congelatura" di NOTA 2 (la prima
  // lettura di `getComputedStyle` dopo un cambio di focus fissa il valore
  // per OGNI lettura successiva, anche su un elemento diverso) non resta
  // confinata al singolo test — sopravvive fra un `it` e l'altro dello
  // stesso file, perche' e' la stessa `window`/`document` per l'intera
  // suite. Il test sull'outline qui sopra e' gia' la prima lettura
  // post-focus di questo file: un secondo test con una propria lettura
  // post-focus, più sotto nello stesso file, avrebbe ereditato quel valore
  // congelato indipendentemente dall'elemento o dalla regola in gioco (e
  // difatti falliva, provato). Isolarlo in un file proprio è l'unico modo
  // di garantire che sia la prima lettura post-focus del suo documento.

  it('il CSS compilato contiene ancora button:active, l\'esclusione di checkbox/radio/file e :user-invalid', () => {
    // Stati che jsdom non permette di indurre (NOTA 3) o che dipendono da un
    // vero :active del puntatore: qui si verifica solo che la regola esista
    // nel foglio compilato, dichiarato come controllo più debole — non uno
    // spacciato per il precedente. Su `cssSenzaCommenti`, non su `cssGlobale`:
    // un commento in prosa non deve poter soddisfare nessuna di queste cinque.
    expect(cssSenzaCommenti).toContain('button:active:not(:disabled)');
    expect(cssSenzaCommenti).toContain('--color-primary-active');
    // Sass non emette mai apici in un selettore d'attributo: `[type=checkbox]`,
    // non `[type='checkbox']` o `[type="checkbox"]` — misurato sul CSS
    // compilato, non assunto.
    expect(cssSenzaCommenti).toMatch(/input\[type=checkbox\]/);
    expect(cssSenzaCommenti).toMatch(/:not\(\[type=file\]\)/);
    expect(cssSenzaCommenti).toContain(':user-invalid');
  });
});
