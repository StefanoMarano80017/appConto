/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'sass';

/**
 * Il guardiano dei token del design system.
 *
 * Esiste per l'operazione più rischiosa del piano: cancellare righe da
 * `_legacy-aliases.scss`. Un alias rimasto orfano non è un errore che
 * qualcosa segnala — `var(--sparito)` vale la stringa vuota, quindi uno
 * sfondo diventa trasparente e un colore di testo sparisce, in silenzio.
 * Oggi cancellare una riga da lì non fa fallire il build e non rompe nessun
 * test: questo è l'unico test che se ne accorgerebbe.
 *
 * NOTA SU UNA SCELTA DIVERSA DA QUELLA ABBOZZATA NEL BRIEF: la prima idea era
 * montare `<App>` con `TestBed` e leggere `document.querySelectorAll('style')`
 * per raccogliere sia il CSS globale sia quello (iniettato a runtime da
 * Angular) dei componenti. Provato per davvero, in questo ambiente
 * (`@angular/build:unit-test`, runner vitest, nessun `browsers` configurato
 * in `angular.json` → jsdom in Node, non un browser vero) succede questo:
 * il builder passa `index: false` e `browser: undefined` alla build di test,
 * quindi il foglio globale (`styles.css`, quello con TUTTE le definizioni
 * `:root`) non viene mai iniettato nel documento — viene aggiunto solo via
 * `transformIndexHtml` di Vite, un passo che esiste solo per la modalità
 * browser di Vitest. Il solo `<style>` che compare davvero è quello che
 * Angular inietta a runtime per il componente istanziato (qui, `App`), che
 * *referenzia* i token ma non li *definisce* mai. Risultato misurato:
 * un solo `<style>`, 19 proprietà referenziate, **19 irrisolte** — non
 * perché un alias sia orfano, ma perché il foglio con le definizioni non è
 * mai stato caricato. Un test così avrebbe sempre fallito, per il motivo
 * sbagliato, e sarebbe stato il primo ad essere silenziato.
 *
 * La soluzione qui sotto smonta il problema in due metà indipendenti, niente
 * affatto legate al montaggio di un componente:
 *
 * 1. CENSIMENTO — quali `var(--x)` sono referenziate nel progetto: si legge
 *    il testo sorgente di ogni file `.scss` sotto `src/`, non un elenco
 *    scritto a mano (che invecchierebbe e smetterebbe di coprire proprio i
 *    token aggiunti dopo). Si scandagliano TUTTI i file, non solo il foglio
 *    globale: gli undici alias sono definiti in `_legacy-aliases.scss`, ma i
 *    loro consumatori (`var(--accent)`, `var(--border)`, `var(--negative)`,
 *    ...) vivono sparsi in oltre venti file di feature. Un censimento che
 *    guardasse solo il foglio globale non li vedrebbe mai sparire.
 *
 * 2. RISOLUZIONE — se ogni nome censito risolve davvero: si compila
 *    `styles.scss` (lo stesso foglio che `angular.json` dichiara come
 *    stile globale dell'app, con lo stesso `loadPaths`) con lo stesso
 *    compilatore Sass che usa la build reale, e si inietta il CSS
 *    risultante in un `<style>` del documento di test — cosa che, come
 *    appena spiegato, la pipeline di test non fa da sola. Da lì
 *    `getComputedStyle(document.documentElement)` legge i valori reali,
 *    nei due temi (`data-theme='light'|'dark'`), esattamente come farebbe un
 *    browser vero: tutte le custom property del progetto sono definite su
 *    `:root` (mai su un `:host` di componente), quindi questo lettore non
 *    produce falsi positivi da proprietà con scope ristretto.
 */

/**
 * Un riferimento `var(--nome)`, seguito da spazi opzionali.
 *
 * `_typography.scss` costruisce alcuni nomi con l'interpolazione Sass
 * `var(--color-#{map.get($spec, color)})`: sul sorgente non compilato quella
 * riga non è ancora un nome di proprietà, e il regex ne matcherebbe solo il
 * prefisso (`--color-`), un falso positivo che finirebbe censito come token
 * a sé. Si scarta filtrando i nomi che finiscono con un trattino: i nomi
 * reali che quell'interpolazione produce (`--color-text-secondary`,
 * `--color-text-muted`, ...) sono comunque scritti alla lettera altrove,
 * ovunque il ruolo tipografico corrispondente sia invocato, quindi restano
 * censiti lo stesso.
 */
const RIFERIMENTO = /var\(\s*(--[a-z0-9-]+)/g;

function proprietaReferenziate(css: string): Set<string> {
  const nomi = new Set<string>();
  for (const trovato of css.matchAll(RIFERIMENTO)) {
    const nome = trovato[1];
    if (nome !== undefined && !nome.endsWith('-')) {
      nomi.add(nome);
    }
  }
  return nomi;
}

/** Ogni file `.scss` sotto una radice, ricorsivamente. */
function trovaFileScss(radice: string): string[] {
  const trovati: string[] = [];
  for (const voce of readdirSync(radice, { withFileTypes: true })) {
    const percorso = join(radice, voce.name);
    if (voce.isDirectory()) {
      trovati.push(...trovaFileScss(percorso));
    } else if (voce.name.endsWith('.scss')) {
      trovati.push(percorso);
    }
  }
  return trovati;
}

const QUI = dirname(fileURLToPath(import.meta.url));
/** `src/`, tre livelli sopra `src/app/shared/styles`. */
const SRC = join(QUI, '../../..');

const proprieta = (() => {
  const nomi = new Set<string>();
  for (const file of trovaFileScss(SRC)) {
    const testo = readFileSync(file, 'utf8');
    for (const nome of proprietaReferenziate(testo)) {
      nomi.add(nome);
    }
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

describe('token del design system', () => {
  let foglio: HTMLStyleElement | undefined;

  afterEach(() => {
    foglio?.remove();
    foglio = undefined;
    document.documentElement.removeAttribute('data-theme');
  });

  for (const tema of ['light', 'dark'] as const) {
    it(`ogni custom property referenziata risolve nel tema ${tema}`, () => {
      document.documentElement.setAttribute('data-theme', tema);
      foglio = document.createElement('style');
      foglio.textContent = cssGlobale;
      document.head.appendChild(foglio);

      const stile = getComputedStyle(document.documentElement);

      // Il pavimento dimostra che il censimento ha davvero letto qualcosa:
      // se tornasse vuoto (o quasi), l'asserzione sull'elenco vuoto più
      // sotto passerebbe comunque, ma senza aver verificato niente — è
      // esattamente il modo peggiore in cui questo test può fallire. Il
      // sorgente ne referenzia oltre cinquanta; venti è un pavimento
      // prudente, non una misura.
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
});
