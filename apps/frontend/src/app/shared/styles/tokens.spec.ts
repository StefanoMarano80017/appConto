/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, compileString } from 'sass';

/**
 * Il guardiano dei token del design system.
 *
 * Esiste per l'operazione più rischiosa del piano: cancellare righe da
 * `_legacy-aliases.scss`. Un alias rimasto orfano non è un errore che
 * qualcosa segnala — `var(--sparito)` vale la stringa vuota, quindi uno
 * sfondo diventa trasparente e un colore di testo sparisce, in silenzio.
 * Oggi cancellare una riga da lì non fa fallire il build e non rompe nessun
 * test: questo file è l'unico che se ne accorgerebbe.
 *
 * NOTA SU UNA SCELTA DIVERSA DA QUELLA ABBOZZATA NEL BRIEF: la prima idea era
 * montare `<App>` con `TestBed` e leggere `document.querySelectorAll('style')`.
 * Provato per davvero: in questo ambiente (`@angular/build:unit-test`,
 * runner Vitest, nessun `browsers` in `angular.json` → jsdom in Node, non un
 * browser vero) il builder passa `index: false` e `browser: undefined` alla
 * build di test, quindi il foglio globale con le definizioni `:root` non
 * viene mai iniettato nel documento — solo lo `<style>` che Angular inietta
 * a runtime per il componente istanziato, che referenzia i token ma non li
 * definisce mai. Misurato: un solo `<style>`, 19 proprietà referenziate,
 * 19 irrisolte, sempre — un test così avrebbe fallito per il motivo
 * sbagliato e sarebbe stato il primo ad essere cancellato.
 *
 * La soluzione sotto non monta nulla: separa CENSIMENTO (quali `var(--x)`
 * sono referenziate) da RISOLUZIONE (se risolvono davvero), e per il secondo
 * compila da sé, con lo stesso Sass della build reale, il foglio che
 * `angular.json` dichiara come stile globale, iniettandolo in un `<style>`
 * del documento di test — il passo che la pipeline di test non compie da
 * sola qui.
 *
 * GIRO DI REVIEW 1 — perché il censimento non legge il solo testo sorgente:
 * un primo tentativo scandagliava il testo grezzo dei `.scss` con un regex,
 * scartando i nomi incompleti prodotti da un'interpolazione Sass non ancora
 * risolta. Verificato che era sbagliato: per cinque nomi reali del progetto
 * (`--font-ui`, `--font-mono`, `--color-chart-1`, `--color-chart-3`,
 * `--color-chart-5`) l'UNICA occorrenza in tutto il sorgente è dentro
 * un'interpolazione — non esiste da nessuna parte un `var(--font-ui)`
 * scritto alla lettera. Scartarli come falsi positivi li faceva sparire dal
 * censimento per sempre: cancellare `--font-ui` da `_semantic.scss` avrebbe
 * svuotato il `font-family` di tutta l'app, in silenzio, con questo test
 * verde. I tre siti che costruiscono nomi per interpolazione sono
 * `_typography.scss:49` (famiglia), `_typography.scss:60` (colore) e
 * `analytics-timeline.scss:67` (indice della serie). Nessuno dei due
 * `_typography.scss` emette CSS da solo (è un partial, i nomi si
 * materializzano solo dove il mixin viene incluso): perciò il censimento
 * non legge il testo dei `.scss`, compila ogni foglio non-partial con lo
 * stesso compilatore Sass e legge i nomi dal CSS che ne esce — lì
 * l'interpolazione è già risolta in un nome letterale, sempre.
 */

/** Un riferimento `var(--nome)`, seguito da spazi opzionali. */
const RIFERIMENTO = /var\(\s*(--[a-z0-9-]+)/g;

/** Una dichiarazione `--nome: ...` dentro un blocco di regola. */
const DICHIARAZIONE = /(--[a-z0-9-]+)\s*:/g;

function nomiDaRegex(testo: string, regex: RegExp): Set<string> {
  const nomi = new Set<string>();
  for (const trovato of testo.matchAll(regex)) {
    const nome = trovato[1];
    if (nome !== undefined) {
      nomi.add(nome);
    }
  }
  return nomi;
}

/**
 * Il contenuto fra graffe di ogni occorrenza di un selettore che apre un
 * blocco — qui non serve gestire l'annidamento (le regole `:root` non ne
 * hanno), ma contare le graffe è comunque la via che non si rompe se un
 * commento nel CSS ne contenesse una spaiata.
 */
function blocchi(css: string, apertura: RegExp): string[] {
  const risultati: string[] = [];
  const regex = new RegExp(apertura.source, 'g');
  let trovato: RegExpExecArray | null;
  while ((trovato = regex.exec(css))) {
    let profondita = 1;
    let indice = trovato.index + trovato[0].length;
    const inizio = indice;
    while (profondita > 0 && indice < css.length) {
      if (css[indice] === '{') profondita++;
      else if (css[indice] === '}') profondita--;
      indice++;
    }
    risultati.push(css.slice(inizio, indice - 1));
  }
  return risultati;
}

function dichiarateInBlocchi(css: string, apertura: RegExp): Set<string> {
  const nomi = new Set<string>();
  for (const blocco of blocchi(css, apertura)) {
    for (const nome of nomiDaRegex(blocco, DICHIARAZIONE)) {
      nomi.add(nome);
    }
  }
  return nomi;
}

/**
 * Ogni file con l'estensione data, sotto una radice, ricorsivamente.
 * `soloNonPartial` esclude i file `_nome.scss`: da soli non emettono CSS
 * (si materializzano solo dove chi li `@use`sa li invoca), quindi compilarli
 * in isolamento non direbbe nulla sui nomi reali.
 */
function trovaFile(radice: string, estensione: string, soloNonPartial: boolean): string[] {
  const trovati: string[] = [];
  for (const voce of readdirSync(radice, { withFileTypes: true })) {
    const percorso = join(radice, voce.name);
    if (voce.isDirectory()) {
      trovati.push(...trovaFile(percorso, estensione, soloNonPartial));
    } else if (voce.name.endsWith(estensione)) {
      if (soloNonPartial && voce.name.startsWith('_')) {
        continue;
      }
      trovati.push(percorso);
    }
  }
  return trovati;
}

const QUI = dirname(fileURLToPath(import.meta.url));
/** `src/`, tre livelli sopra `src/app/shared/styles`. */
const SRC = join(QUI, '../../..');

/**
 * Il censimento: unione di due fonti, nessuna delle due un elenco scritto a
 * mano (che invecchierebbe e smetterebbe di coprire proprio i token
 * aggiunti dopo).
 *
 * 1. Ogni foglio `.scss` non-partial, COMPILATO (non il testo grezzo — vedi
 *    la nota sopra sull'interpolazione).
 * 2. Ogni template `.html`, testo grezzo: un binding di stile può citare un
 *    token alla lettera fuori da qualunque foglio di stile (qui succede
 *    davvero, due volte, con `'var(--text-muted)'` come sfondo di
 *    ripiego quando una categoria non ha un colore proprio). Un censimento
 *    che guardasse solo i `.scss` non se ne accorgerebbe — e sarebbe
 *    proprio nel momento in cui sparisse l'ultimo consumatore `.scss` di un
 *    alias (il criterio di uscita della Fase 7: `_legacy-aliases.scss`
 *    vuoto) che l'alias verrebbe cancellato mentre un template lo usa
 *    ancora. Non si estende ai `.ts`: oggi nessuno vi scrive un
 *    `var(--nome)` letterale (i grafici lo compongono a runtime
 *    concatenando stringhe, che non è un riferimento censibile da testo), e
 *    includerli avvelenerebbe il censimento con questo stesso file, che ne
 *    cita uno dentro un commento.
 */
const proprieta = (() => {
  const nomi = new Set<string>();
  /*
   * Le proprietà che un foglio di componente dichiara da sé (`--padding-inline`
   * di ChoiceGroup, le variabili di posizione della sua pillola) sono locali:
   * le risolve il componente, non `:root`, e non c'è nulla da cercare nel foglio
   * globale. `styles.scss` è escluso, perché lì la dichiarazione È il token.
   */
  const locali = new Set<string>();
  const globale = join(SRC, 'styles.scss');

  for (const file of trovaFile(SRC, '.scss', true)) {
    /*
     * `style: 'compressed'` per una ragione sola, e non è la dimensione:
     * toglie i commenti. Sass conserva i commenti a blocco nel CSS
     * compilato, quindi senza questo il censimento conta come riferimento
     * anche una property che un commento si limita a NOMINARE — e un
     * `var(--x)` dentro un commento non dipinge niente.
     *
     * Non è teoria: alla cancellazione di `_legacy-aliases.scss` questo test
     * ha dichiarato `--negative` orfana. L'unica occorrenza rimasta era la
     * prosa di `error-retry.scss`, che racconta quale regola c'era prima e
     * perché è stata tolta — storia vera, che non va riscritta per far
     * tacere un censimento.
     *
     * La nota qui sopra sui `.ts` diceva già che un riferimento dentro un
     * commento avvelena il censimento, e li escludeva per questo. Lo stesso
     * ragionamento non era stato applicato ai `.scss`: qui lo è.
     */
    const css = compile(file, { loadPaths: [SRC], style: 'compressed' }).css;
    for (const nome of nomiDaRegex(css, RIFERIMENTO)) {
      nomi.add(nome);
    }
    if (file !== globale) {
      for (const nome of nomiDaRegex(css, DICHIARAZIONE)) {
        locali.add(nome);
      }
    }
  }

  for (const file of trovaFile(SRC, '.html', false)) {
    const testo = readFileSync(file, 'utf8');
    for (const nome of nomiDaRegex(testo, RIFERIMENTO)) {
      nomi.add(nome);
    }
  }

  for (const nome of locali) {
    nomi.delete(nome);
  }

  return nomi;
})();

/**
 * Il foglio globale compilato una sola volta: è lo stesso per i due temi,
 * perché contiene già entrambe le regole (`:root` e
 * `:root[data-theme='dark']`) — cambia solo l'attributo sull'elemento
 * quando lo si legge.
 */
const cssGlobale = compile(join(SRC, 'styles.scss'), { loadPaths: [SRC] }).css;

/**
 * GIRO DI REVIEW 1, rilievo 2 — perché non basta che nulla risolva vuoto.
 *
 * `styles.scss` stratifica il tema scuro come sovrascrittura: prima
 * `:root { palette chiara }`, poi `:root[data-theme='dark'] { palette
 * scura }`. Una proprietà dichiarata solo nella palette chiara, e mai in
 * quella scura, non risulta mai vuota in tema scuro: legge semplicemente il
 * valore chiaro (la cascata la fa risalire al primo blocco). Il criterio
 * "stringa vuota" non può quindi accorgersi di un token perso solo dal lato
 * scuro — servirebbe un tema scuro rotto (es. uno sfondo bianco dentro un
 * tema notte) senza che questo file, da solo, se ne accorga.
 *
 * Si compilano quindi in isolamento le due sole regole che devono restare
 * simmetriche — i mixin `light-palette`/`dark-palette` di `_primitives.scss`
 * (il livello 1 dei token, quello dove ogni colore ha "la stessa chiave nei
 * due temi" per costruzione, DESIGN_SYSTEM.md §1) — e si confrontano i nomi
 * dichiarati nei due blocchi. Compilarli da soli invece che leggerli dentro
 * `cssGlobale` evita di confondere questo confronto con i token di
 * geometria e tipografia (spaziature, raggi, alias) che by design vivono
 * solo nel blocco chiaro, perché non cambiano con il tema.
 */
const cssPalette = compileString(
  `
    @use 'app/shared/styles/primitives' as p;
    :root { @include p.light-palette; }
    :root[data-theme='dark'] { @include p.dark-palette; }
  `,
  { loadPaths: [SRC] }
).css;
const paletteChiara = dichiarateInBlocchi(cssPalette, /:root\s*\{/);
const paletteScura = dichiarateInBlocchi(cssPalette, /:root\[data-theme=['"]?dark['"]?\]\s*\{/);

describe('token del design system', () => {
  let foglio: HTMLStyleElement | undefined;

  afterEach(() => {
    foglio?.remove();
    foglio = undefined;
    document.documentElement.removeAttribute('data-theme');
  });

  for (const tema of ['light', 'dark'] as const) {
    it(`ogni custom property referenziata nei fogli compilati e nei template risolve nel tema ${tema}`, () => {
      document.documentElement.setAttribute('data-theme', tema);
      foglio = document.createElement('style');
      foglio.textContent = cssGlobale;
      document.head.appendChild(foglio);

      const stile = getComputedStyle(document.documentElement);

      // Il pavimento dimostra che il censimento ha davvero letto qualcosa:
      // se tornasse vuoto (o quasi), l'asserzione sull'elenco vuoto più
      // sotto passerebbe comunque, ma senza aver verificato niente — è
      // esattamente il modo peggiore in cui questo test può fallire. Il
      // sorgente ne referenzia 56; venti è un pavimento prudente, non una
      // misura.
      expect(proprieta.size).toBeGreaterThanOrEqual(20);

      // Il pavimento sul conteggio da solo garantisce quantità, non
      // qualità: un censimento pieno di nomi tutti irrisolti lo
      // supererebbe comunque. Un token noto e molto usato dev'essere
      // davvero fra i censiti e risolvere per davvero, prima di fidarsi
      // dell'elenco vuoto qui sotto.
      expect(proprieta.has('--color-surface')).toBe(true);
      expect(stile.getPropertyValue('--color-surface').trim()).not.toBe('');

      // Solo ora, con la certezza che il censimento ha guardato qualcosa
      // di reale, il giudizio sull'elenco vuoto ha senso: nessuna delle
      // proprietà referenziate nel sorgente deve risolvere a stringa vuota.
      const irrisolte = [...proprieta].filter(
        (nome) => stile.getPropertyValue(nome).trim() === ''
      );
      expect(irrisolte).toEqual([]);
    });
  }

  it('le proprietà dichiarate nella palette chiara e in quella scura coincidono', () => {
    // Non "nessuna vuota": qui il guasto che si cerca non produce mai una
    // stringa vuota (vedi il commento sopra `cssPalette`), quindi il
    // confronto è direttamente sui due insiemi di nomi, e nomina la
    // differenza — da che lato manca — quando non coincidono.
    const soloChiaro = [...paletteChiara].filter((nome) => !paletteScura.has(nome));
    const soloScuro = [...paletteScura].filter((nome) => !paletteChiara.has(nome));

    expect({ soloChiaro, soloScuro }).toEqual({ soloChiaro: [], soloScuro: [] });
  });
});
