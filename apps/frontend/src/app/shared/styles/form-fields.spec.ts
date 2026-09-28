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
 * NOTA 2 — perché le asserzioni sotto non leggono mai un colore: misurato,
 * non ipotizzato. jsdom applica la cascata e riconosce gli pseudo-selettori
 * (`:disabled`, `:focus-visible` dopo una vera `.focus()`), ma il suo motore
 * CSS non risolve `var(--token)` dentro `background`/`border-color`/
 * `box-shadow`: un elemento attivo e uno disabilitato risultavano identici
 * (`rgba(0, 0, 0, 0)`, il default, per entrambi) perché l'intera dichiarazione
 * con `var()` non veniva applicata. Per una proprietà singola non composita
 * come `border-radius` il valore torna invece testuale e non risolto
 * (`"var(--radius-input)"`), MAI calcolato in pixel: utile per provare che un
 * selettore ha vinto la cascata, mai per leggere la resa finale.
 * Le uniche proprietà che tornano un valore vero sono quelle SENZA `var()`
 * dentro la dichiarazione: `cursor: not-allowed` (stato disabilitato) e
 * `outline: none` (stato focus-visible). Sono quindi la base di questo test.
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
 * Questi due stati restano verificati solo dal giro visivo (Step 5), non da
 * un'asserzione più debole spacciata per equivalente.
 */

const QUI = dirname(fileURLToPath(import.meta.url));
/** `src/`, tre livelli sopra `src/app/shared/styles` — come in `tokens.spec.ts`. */
const SRC = join(QUI, '../../..');
const cssGlobale = compile(join(SRC, 'styles.scss'), { loadPaths: [SRC] }).css;

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
    // Attenzione: NON leggere `getComputedStyle` prima di `.focus()` in
    // questo test. Verificato con una prova dedicata: in questo jsdom la
    // prima lettura di `getComputedStyle(campo)` per un elemento fissa un
    // valore che le letture successive dello stesso elemento continuano a
    // restituire, e un cambio di focus non lo invalida (a differenza di un
    // attributo come `disabled`). Leggerlo prima del focus, solo per
    // controllare lo stato "non ancora a fuoco", congela quindi '' anche
    // dopo la `.focus()` — un artefatto dell'ambiente di prova, non della
    // regola CSS. Il test verifica quindi solo lo stato dopo il focus.
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

  it('il CSS compilato contiene ancora button:active, l\'esclusione di checkbox/radio e :user-invalid', () => {
    // Stati che jsdom non permette di indurre (NOTA 3) o che dipendono da un
    // vero :active del puntatore: qui si verifica solo che la regola esista
    // nel foglio compilato, dichiarato come controllo più debole — non uno
    // spacciato per il precedente.
    expect(cssGlobale).toContain('button:active:not(:disabled)');
    expect(cssGlobale).toContain('--color-primary-active');
    expect(cssGlobale).toMatch(/input\[type=['"]checkbox['"]\]/);
    expect(cssGlobale).toContain(':user-invalid');
  });
});
