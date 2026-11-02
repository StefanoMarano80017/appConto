/**
 * Preload dei test (`--import`): isola i dati di ogni processo di test.
 *
 * Senza di esso un test che importa il client del database aprirebbe
 * `data/database.sqlite`, cioè l'archivio vero. Qui si punta invece a una
 * cartella nuova in `os.tmpdir()`. Le variabili già impostate non si toccano:
 * i test che scelgono i propri percorsi (e i processi figli dei test runtime)
 * restano padroni delle proprie.
 */
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Si imposta solo `DATABASE_FILE`, mai `MYFINANCE_DATA`: `paths.ts` fa seguire
// la radice dati al file del database, mentre `MYFINANCE_DATA` avrebbe la
// precedenza e romperebbe i test che poi impostano da soli `DATABASE_FILE`.
// Se l'ambiente sceglie già una radice dati, il database sta sotto di essa.
if (!process.env.MYFINANCE_DATA && !process.env.DATABASE_FILE) {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'appconto-test-'));
  process.env.DATABASE_FILE = path.join(dataRoot, 'database.sqlite');
}
