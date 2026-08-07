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

    const result: ImportCsvResult = {
      rowsRead: rows.length,
      imported: toPersist.length,
      duplicates,
      failed: errors.length,
      merchantsCreated: merchants.created,
      errors: errors.slice(0, MAX_REPORTED_ERRORS),
    };

    logger.info('Import CSV completato', result);

    return result;
  },
};
