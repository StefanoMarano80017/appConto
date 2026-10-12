/// <reference types="node" />
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'sass';

/**
 * L'animazione d'ingresso delle pagine ha fill-mode `both`: il fotogramma
 * finale resta applicato. Se lascia un `transform` (anche `translateY(0)`)
 * la pagina diventa il containing block dei `position: fixed` al suo
 * interno, e il pannello di `app-select` finisce lontano dal trigger.
 * Controllo testuale sul CSS compilato, come in `form-fields.spec.ts`:
 * jsdom non esegue le animazioni.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const css = compile(join(SRC, 'styles.scss'), { loadPaths: [SRC] }).css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('animazione d\'ingresso delle pagine', () => {
  it('termina con transform: none', () => {
    const keyframes = /@keyframes route-content-enter\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    const finale = /\bto\s*\{([^}]*)\}/.exec(keyframes)?.[1] ?? '';

    expect(keyframes).not.toBe('');
    expect(finale).toMatch(/transform:\s*none/);
  });
});
