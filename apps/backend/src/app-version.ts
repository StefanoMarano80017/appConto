import { readFileSync } from "node:fs";
import path from "node:path";
import { APP_ROOT } from "./paths.js";

const UNKNOWN_VERSION = "sconosciuta";

/**
 * Estrae la versione dal contenuto di un package.json.
 *
 * Funzione pura: non accede al filesystem e non modifica stato.
 */
function extractAppVersion(content: string): string | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  const version = (parsed as Record<string, unknown>).version;

  if (typeof version !== "string" || version.trim().length === 0) {
    return undefined;
  }

  return version.trim();
}

/**
 * La versione dell'applicazione, come dichiarata dal suo `package.json`.
 *
 * Serve a un solo scopo: finire nel manifest di un backup, così che un
 * archivio ritrovato fra un anno dica da quale versione è stato prodotto.
 * Nessuna decisione dipende da questo valore: la compatibilità la stabilisce
 * la versione dello schema, che è verificabile.
 *
 * Se il package.json non è disponibile, restituisce un valore di fallback.
 */
function readVersion(): string {
  try {
    const content = readFileSync(path.join(APP_ROOT, "package.json"), "utf8");
    return extractAppVersion(content) ?? UNKNOWN_VERSION;
  } catch {
    // Il packaging (WP-P4) potrebbe non portarsi il `package.json`: non è un
    // errore, è solo un'informazione in meno nel manifest.
    return UNKNOWN_VERSION;
  }
}

export const APP_VERSION: string = readVersion();
