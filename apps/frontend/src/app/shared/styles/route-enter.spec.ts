/// <reference types="node" />
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'sass';

/**
 * L'animazione d'ingresso delle pagine non deve restare in effetto dopo la
 * fine: con fill-mode `both`/`forwards` l'animation su `transform` resta
 * attiva (anche con valore `none`) e la pagina diventa il containing block
 * dei `position: fixed` al suo interno, quindi il pannello di `app-select`
 * finisce lontano dal trigger. Serve fill-mode `backwards`.
 * Controllo testuale sul CSS compilato, come in `form-fields.spec.ts`:
 * jsdom non esegue le animazioni.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const css = compile(join(SRC, 'styles.scss'), { loadPaths: [SRC] }).css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('animazione d\'ingresso delle pagine', () => {
  it('non usa fill-mode both/forwards, così non resta in effetto dopo la fine', () => {
    const regola = /\.content > router-outlet \+ \*\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const animation = /animation:\s*([^;]*);/.exec(regola)?.[1] ?? '';

    expect(animation).toContain('route-content-enter');
    expect(animation).toMatch(/\bbackwards\b/);
    expect(animation).not.toMatch(/\b(both|forwards)\b/);
  });
});
