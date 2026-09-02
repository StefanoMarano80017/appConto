import { atomically } from '../../db/client.js';
import { ValidationError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { merchantResolver } from '../merchants/index.js';
import { fingerprintAll, transactionsService, type NewTransaction } from '../transactions/index.js';
import { parseCsv } from './csv-parser.js';
import { mapRowsToTransactions, type RowError } from './csv-transaction-mapper.js';
import { detectDuplicates } from './duplicate-detector.js';

/** Numero massimo di errori riportati nella risposta. */
const MAX_REPORTED_ERRORS = 50;

/** Riepilogo dell'importazione. */
export interface ImportCsvResult {
  /** Righe di dati presenti nel file, intestazione esclusa. */
  rowsRead: number;
  /** Transazioni nuove, effettivamente archiviate. */
  imported: number;
  /** Transazioni già presenti in archivio, non reinserite. */
  duplicates: number;
  /** Righe scartate perché non convertibili. */
  failed: number;
  /** Merchant creati durante questa importazione. */
  merchantsCreated: number;
  /** Dettaglio delle prime righe scartate. */
  errors: RowError[];
}

/**
 * Caso d'uso "importa un estratto conto".
 *
 * Coordina la pipeline — parsing, identità, riconoscimento duplicati,
 * risoluzione del merchant, persistenza — senza contenere logica di dominio
 * né conoscere il protocollo HTTP.
 */
export const importService = {
  importCsv(content: string): ImportCsvResult {
    if (content.trim().length === 0) {
      throw new ValidationError('Il file CSV è vuoto.');
    }

    const { headers, rows } = parseCsv(content);
    const { transactions, errors } = mapRowsToTransactions(headers, rows);

    const fingerprinted = fingerprintAll(transactions);

    /*
     * Da qui in avanti si tocca l'archivio, e lo si fa in una sola transazione.
     *
     * Non perché le singole scritture non siano già atomiche — lo sono — ma
     * perché sono **due**: prima nascono i merchant, poi le transazioni che li
     * citano. Separate, un guasto fra le due lascerebbe in archivio degli
     * esercenti senza alcun movimento: nessun errore visibile, un elenco
     * sporco per sempre. Insieme, o si importa tutto o non è successo niente.
     *
     * Nella transazione entra anche il riconoscimento dei duplicati: decide
     * cosa inserire in base a cosa c'è già, quindi deve guardare lo stesso
     * archivio su cui poi scrive.
     */
    const persisted = atomically(() => {
      const { toImport, duplicates } = detectDuplicates(fingerprinted);

      // La descrizione della banca è, per ora, il nome dell'esercente.
      const merchants = merchantResolver.resolveAll(
        toImport.map((transaction) => transaction.description),
      );

      const toPersist: NewTransaction[] = toImport.map((transaction) => {
        const merchant = merchants.byName.get(transaction.description);
        if (merchant === undefined) {
          throw new Error(`Merchant non risolto per la transazione "${transaction.description}".`);
        }

        return { ...transaction, merchantId: merchant.id };
      });

      transactionsService.saveAll(toPersist);

      return { imported: toPersist.length, duplicates, merchantsCreated: merchants.created };
    });

    const result: ImportCsvResult = {
      rowsRead: rows.length,
      imported: persisted.imported,
      duplicates: persisted.duplicates,
      failed: errors.length,
      merchantsCreated: persisted.merchantsCreated,
      errors: errors.slice(0, MAX_REPORTED_ERRORS),
    };

    // Nel log finiscono i soli conteggi: i messaggi in `errors` riportano i
    // valori grezzi della riga scartata — importi compresi — e appartengono
    // alla risposta per l'utente, non a un file su disco.
    logger.info('Import CSV completato', {
      rowsRead: result.rowsRead,
      imported: result.imported,
      duplicates: result.duplicates,
      failed: result.failed,
      merchantsCreated: result.merchantsCreated,
    });

    return result;
  },
};
