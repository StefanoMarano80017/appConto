import { atomically } from '../../db/client.js';
import { ValidationError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { parseOrThrow } from '../../shared/validation.js';
import { merchantResolver } from '../merchants/index.js';
import { fingerprintAll, transactionsService, type NewTransaction } from '../transactions/index.js';
import {
  bindingFromDetection,
  bindingFromMapping,
  describeBinding,
  mappedImportSchema,
  toProposal,
  type BindableField,
  type ColumnBinding,
  type ColumnMappingProposal,
} from './column-mapping.js';
import { detectColumns } from './csv-column-detector.js';
import { parseCsv, type CsvRow } from './csv-parser.js';
import { mapRowsToTransactions, type RowError } from './csv-transaction-mapper.js';
import { detectDuplicates } from './duplicate-detector.js';

/** Numero massimo di errori riportati nella risposta. */
const MAX_REPORTED_ERRORS = 50;

/** Righe mostrate nell'anteprima: servono a riconoscere una colonna, non a leggere il file. */
const SAMPLE_ROWS = 5;

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
  /** Colonne del file usate per ogni campo: `null` se assente. */
  columns: Record<BindableField, string | null>;
}

/** Che cosa contiene il file, prima di importarlo. */
export interface CsvAnalysis {
  /** Intestazioni del file, nell'ordine in cui compaiono. */
  headers: string[];
  /** Righe di dati presenti nel file, intestazione esclusa. */
  rowsRead: number;
  /** Colonne proposte dal rilevamento automatico: `null` dove non ha riconosciuto. */
  proposal: ColumnMappingProposal;
  /** Prime righe, allineate alle intestazioni: mostrano cosa contengono le colonne. */
  sample: string[][];
}

/**
 * Casi d'uso dell'importazione di un estratto conto.
 *
 * Le colonne da leggere possono arrivare da due strade — rilevate dal
 * contenuto o indicate dall'utente — e questo è l'unico punto che sa quale
 * delle due è in uso: da `mapRowsToTransactions` in avanti la pipeline è la
 * stessa, e non c'è modo di importare "a metà" con l'una o con l'altra.
 *
 * Coordina parsing, identità, riconoscimento duplicati, risoluzione del
 * merchant e persistenza, senza contenere logica di dominio né conoscere il
 * protocollo HTTP.
 */
export const importService = {
  /**
   * Legge il file e propone le colonne, senza toccare l'archivio.
   *
   * È il primo passo di entrambe le modalità: l'utente vede cosa è stato
   * riconosciuto — e su quali valori — prima di importare qualsiasi cosa.
   */
  analyzeCsv(content: string): CsvAnalysis {
    const { headers, rows } = readCsv(content);
    const detected = detectColumns(headers, rows);

    return {
      headers,
      rowsRead: rows.length,
      proposal: toProposal(detected),
      sample: rows
        .slice(0, SAMPLE_ROWS)
        .map((row) => headers.map((header) => row[header]?.trim() ?? '')),
    };
  },

  /** Importa con le colonne rilevate dal contenuto del file. */
  importCsv(content: string): ImportCsvResult {
    const { headers, rows } = readCsv(content);
    const binding = bindingFromDetection(detectColumns(headers, rows), headers);

    return runImport(binding, rows);
  },

  /**
   * Importa con le colonne indicate dall'utente.
   *
   * Il file torna insieme alla scelta: il server non conserva fra le due
   * richieste né il CSV né l'anteprima, e questa richiesta si spiega da sé.
   */
  importCsvWithMapping(request: unknown): ImportCsvResult {
    const { content, mapping } = parseOrThrow(
      mappedImportSchema,
      request,
      'Richiesta di importazione non valida.',
    );
    const { headers, rows } = readCsv(content);

    return runImport(bindingFromMapping(mapping, headers), rows);
  },
};

/** Un file senza contenuto non è un file da interpretare. */
function readCsv(content: string): { headers: string[]; rows: CsvRow[] } {
  if (content.trim().length === 0) {
    throw new ValidationError('Il file CSV è vuoto.');
  }

  return parseCsv(content);
}

function runImport(binding: ColumnBinding, rows: CsvRow[]): ImportCsvResult {
  const { transactions, errors } = mapRowsToTransactions(binding, rows);
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
    columns: describeBinding(binding),
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
    columns: result.columns,
  });

  return result;
}
