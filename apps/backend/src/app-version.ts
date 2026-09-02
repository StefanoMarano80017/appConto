import { readFileSync } from 'node:fs';
import path from 'node:path';
import { APP_ROOT } from './paths.js';

/**
 * La versione dell'applicazione, come dichiarata dal suo `package.json`.
 *
 * Serve a un solo scopo: finire nel manifest di un backup, così che un
 * archivio ritrovato fra un anno dica da quale versione è stato prodotto.
 * Nessuna decisione dipende da questo valore — la compatibilità la stabilisce
 * la versione dello schema, che è verificabile — quindi un `package.json`
 * irraggiungibile non deve impedire nulla.
 */
function readVersion(): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      const { version } = parsed as { version: unknown };
      if (typeof version === 'string' && version.length > 0) {
        return version;
      }
    }
  } catch {
    // Il packaging (WP-P4) potrebbe non portarsi il `package.json`: non è un
    // errore, è solo un'informazione in meno nel manifest.
  }

  return 'sconosciuta';
}

export const APP_VERSION: string = readVersion();
