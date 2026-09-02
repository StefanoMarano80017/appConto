import Database from 'better-sqlite3';
import { NATIVE_BINDING_FILE } from '../paths.js';

/**
 * L'unico modo di aprire un file SQLite.
 *
 * Non è un involucro di cortesia: nel package `better-sqlite3` è inlinato nel
 * bundle e il suo binario nativo sta in `native/`, accanto ad esso. La
 * libreria, lasciata a sé, lo cercherebbe dentro il proprio `node_modules` —
 * che nel package non esiste — e fallirebbe. Il percorso va quindi indicato, e
 * indicato **ovunque**: la connessione dell'applicazione non è il solo
 * database che si apre, perché backup, verifiche e ripristini aprono i propri.
 *
 * È esistito un momento in cui questo modulo non c'era e il percorso veniva
 * passato solo dove si apre la connessione principale: nel package
 * funzionavano le query e falliva ogni backup. Da qui la regola: nessun
 * `new Database(...)` altrove.
 *
 * In sviluppo `NATIVE_BINDING_FILE` è `null` e non viene imposto nulla, quindi
 * la libreria continua a risolversi da sé come ha sempre fatto.
 */
export function openSqlite(file: string, options: Database.Options = {}): Database.Database {
  return new Database(
    file,
    NATIVE_BINDING_FILE === null ? options : { ...options, nativeBinding: NATIVE_BINDING_FILE },
  );
}
