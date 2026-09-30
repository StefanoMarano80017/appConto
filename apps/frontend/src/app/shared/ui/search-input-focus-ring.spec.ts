/// <reference types="node" />
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'sass';

/**
 * Rilievo 1, giro di correzione 1 del Task 5: senza `box-shadow: none` nella
 * regola annidata `.search input {}` di `search-input.scss`, la regola
 * globale `input:focus-visible` (`styles.scss`) aggiungeva il proprio anello
 * sopra quello già disegnato da `.search:focus-within` — due anelli
 * concentrici invece di uno, su ogni campo di ricerca dell'applicazione.
 *
 * GIRO DI CORREZIONE 3 — la prima versione di questo file non leggeva
 * `search-input.scss`: scriveva la propria regola locale a mano
 * (`'.search[data-ngc] input[data-ngc] { box-shadow: none; }'`), quindi
 * cancellare `box-shadow: none` dal sorgente vero non lo avrebbe mai fatto
 * fallire — verificava un fatto generale sulla cascata di jsdom, non un
 * fatto su questo codice. Confermato togliendo davvero quella riga da
 * `search-input.scss` e rieseguendo: il test **compila qui sotto**, con lo
 * stesso Sass della build reale, ANCHE `search-input.scss`, e legge il suo
 * CSS vero — non una sua riscrittura.
 *
 * Sass non aggiunge l'attributo di encapsulation (lo fa il compilatore di
 * Angular, non Sass): il selettore che esce da questa compilazione è
 * `.search input`, specificità (0,1,1), non (0,3,1) come nel componente
 * reale — un **pareggio**, non una vittoria, con `input:focus-visible`
 * globale (anch'esso (0,1,1)). Il test è quindi più debole della realtà
 * sulla specificità (in produzione (0,3,1) batte (0,1,1) senza bisogno
 * dell'ordine), ma non sull'unica cosa che deve provare: al pareggio decide
 * l'ordine di iniezione dei fogli, e qui lo si modella iniettando il CSS
 * compilato di `search-input.scss` DOPO quello di `styles.scss` — lo stesso
 * ordine con cui Angular inietta i fogli dei componenti dopo il CSS globale
 * (documentato anche nel commento del rilievo 2, in `search-input.scss`).
 *
 * Isolato in un file a sé, non dentro `form-fields.spec.ts`: verificato con
 * una prova dedicata che la "congelatura" descritta in `form-fields.spec.ts`
 * (NOTA 2 — la prima lettura di `getComputedStyle` dopo un cambio di focus
 * fissa il valore per OGNI lettura successiva, anche su un elemento diverso)
 * non resta confinata al singolo test: sopravvive fra un `it` e l'altro
 * dello stesso file, perché è la stessa `window`/`document` per l'intera
 * suite. Con più test che fanno focus+lettura nello stesso file, solo il
 * PRIMO in assoluto legge il valore vero — ogni test successivo eredita
 * quello congelato dal primo, indipendentemente dall'elemento o dalla
 * regola in gioco (provato: un secondo test dello stesso file falliva anche
 * quando il proprio CSS era corretto). Questo file esiste solo per
 * garantire che il proprio (unico) test sia la prima lettura post-focus del
 * proprio documento — motivo per cui NON contiene anche un test di
 * contrasto nello stesso file: quel contrasto è già coperto da
 * `form-fields.spec.ts` (l'input fuori da `.search`, lì, mostra il
 * box-shadow non risolto della regola globale — prova che l'ambiente sa
 * mostrare il conflitto quando la regola locale manca).
 */

const QUI = dirname(fileURLToPath(import.meta.url));
/** `src/`, tre livelli sopra `src/app/shared/ui`. */
const SRC = join(QUI, '../../..');
const cssGlobale = compile(join(SRC, 'styles.scss'), { loadPaths: [SRC] }).css;
const cssRicerca = compile(join(SRC, 'app/shared/ui/search-input.scss'), {
  loadPaths: [SRC],
}).css;

describe('anello di focus di app-search-input', () => {
  it('il campo dentro .search non porta un proprio box-shadow di focus (niente doppio anello)', () => {
    // Un documento nuovo, quello di un iframe `about:blank`, non il `document`
    // della suite: il builder esegue le spec senza isolamento, quindi
    // `document` è condiviso con i file eseguiti prima nello stesso worker, e
    // con lui la cache dei selettori di jsdom. Con quella cache già calda
    // (per esempio dopo form-fields.spec.ts, che inietta lo stesso
    // styles.scss), @asamuzakjp/dom-selector 6.8.1 restituisce per
    // `input:focus-visible, ...` l'AST dell'ultimo selettore analizzato
    // (nel caso osservato `.search.pill:hover input`, (0,3,1)), e il cascade
    // di jsdom dava alla regola globale una specificità che non ha: il test
    // falliva a caso, circa una volta su tre. Il documento dell'iframe ha
    // cache e storia del focus proprie, quindi questa è davvero la prima
    // lettura post-focus del proprio documento, come richiesto sopra.
    const cornice = document.createElement('iframe');
    document.body.append(cornice);
    const finestra = cornice.contentWindow!;
    const doc = finestra.document;

    // Ordine di iniezione deliberato: il globale prima, il foglio del
    // componente dopo — lo stesso ordine in cui Angular li inietta a
    // runtime, e l'unico che decide quando le due regole pareggiano.
    const foglioGlobale = doc.createElement('style');
    foglioGlobale.textContent = cssGlobale;
    doc.head.appendChild(foglioGlobale);

    const foglioRicerca = doc.createElement('style');
    foglioRicerca.textContent = cssRicerca;
    doc.head.appendChild(foglioRicerca);

    // Niente attributi finti: il CSS compilato da Sass seleziona `.search
    // input` per struttura, senza bisogno di simulare l'encapsulation.
    const contenitore = doc.createElement('div');
    contenitore.className = 'search';
    const campo = doc.createElement('input');
    contenitore.append(campo);
    doc.body.append(contenitore);

    campo.focus();
    expect(doc.activeElement).toBe(campo);
    expect(finestra.getComputedStyle(campo).boxShadow).toBe('none');

    cornice.remove();
  });
});
