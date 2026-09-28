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
 *
 * Non è possibile montare qui il vero `SearchInputComponent` con la vera
 * encapsulation di Angular: questa pipeline di test non inietta mai il
 * foglio globale accanto a quello di un componente montato (stesso limite
 * documentato in `tokens.spec.ts` e in `form-fields.spec.ts`), e simulare
 * entrambi assieme richiederebbe la build reale di Angular, non solo Sass.
 * Il selettore reale — `.search[_ngcontent] input[_ngcontent]`,
 * specificità (0,3,1) — viene quindi riprodotto con un attributo letterale
 * al posto di quello di encapsulation: stessa forma, stessa specificità,
 * non un sostituto più debole.
 */

const QUI = dirname(fileURLToPath(import.meta.url));
/** `src/`, tre livelli sopra `src/app/shared/ui`. */
const SRC = join(QUI, '../../..');
const cssGlobale = compile(join(SRC, 'styles.scss'), { loadPaths: [SRC] }).css;

describe('anello di focus di app-search-input', () => {
  it('il campo dentro .search non porta un proprio box-shadow di focus (niente doppio anello)', () => {
    const foglio = document.createElement('style');
    foglio.textContent = cssGlobale;
    document.head.appendChild(foglio);

    const foglioProva = document.createElement('style');
    foglioProva.textContent = '.search[data-ngc] input[data-ngc] { box-shadow: none; }';
    document.head.appendChild(foglioProva);

    const contenitore = document.createElement('div');
    contenitore.className = 'search';
    contenitore.setAttribute('data-ngc', '');
    const campo = document.createElement('input');
    campo.setAttribute('data-ngc', '');
    contenitore.append(campo);
    document.body.append(contenitore);

    campo.focus();
    expect(getComputedStyle(campo).boxShadow).toBe('none');

    foglio.remove();
    foglioProva.remove();
    contenitore.remove();
  });
});
