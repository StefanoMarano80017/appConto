import { parsedTransactionSchema, type ParsedTransaction } from '../transactions/index.js';
import type { AmountBinding, ColumnBinding } from './column-mapping.js';
import type { CsvRow } from './csv-parser.js';
import { parseCsvAmount, parseCsvDate } from './csv-values.js';
import { resolveTransactionType } from './transaction-type-resolver.js';

/**
 * Converte le righe grezze del CSV in transazioni di dominio.
 *
 * Riceve il binding già deciso — rilevato dal contenuto o indicato dall'utente
 * — e non sa quale delle due strade lo ha prodotto: qui resta la sola
 * conversione riga per riga.
 */

export interface RowError {
  /** Riga del file, intestazione inclusa. */
  line: number;
  message: string;
}

export interface MappingResult {
  transactions: ParsedTransaction[];
  errors: RowError[];
}

/** Primo valore non vuoto tra le colonne candidate. */
function firstValue(row: CsvRow, columns: string[]): string {
  for (const column of columns) {
    const value = row[column]?.trim() ?? '';
    if (value.length > 0) {
      return value;
    }
  }

  return '';
}

/**
 * Importo della riga, col segno del dominio: negativo = uscita.
 *
 * Con le colonne dare/avere il segno lo dà la colonna in cui compare il
 * valore, non il valore stesso: molte banche scrivono le uscite in positivo.
 */
function amountOf(row: CsvRow, binding: AmountBinding): { raw: string; value: number | null } {
  if (binding.kind === 'single') {
    const raw = firstValue(row, binding.columns);
    return { raw, value: parseCsvAmount(raw) };
  }

  const credit = firstValue(row, [binding.credit]);
  const creditValue = parseCsvAmount(credit);
  if (creditValue !== null && creditValue !== 0) {
    return { raw: credit, value: Math.abs(creditValue) };
  }

  const debit = firstValue(row, [binding.debit]);
  const debitValue = parseCsvAmount(debit);
  if (debitValue !== null && debitValue !== 0) {
    return { raw: debit, value: -Math.abs(debitValue) };
  }

  return { raw: credit.length > 0 ? credit : debit, value: creditValue ?? debitValue };
}

export function mapRowsToTransactions(binding: ColumnBinding, rows: CsvRow[]): MappingResult {
  const transactions: ParsedTransaction[] = [];
  const errors: RowError[] = [];

  rows.forEach((row, index) => {
    const line = index + 2; // la riga 1 è l'intestazione
    const rawDate = firstValue(row, binding.bookingDate);
    const { raw: rawAmount, value: amount } = amountOf(row, binding.amount);

    const bookingDate = parseCsvDate(rawDate);

    if (bookingDate === null) {
      errors.push({ line, message: `Data non riconosciuta: "${rawDate}"` });
      return;
    }
    if (amount === null) {
      errors.push({ line, message: `Importo non riconosciuto: "${rawAmount}"` });
      return;
    }

    const result = parsedTransactionSchema.safeParse({
      bookingDate,
      description: firstValue(row, binding.description),
      amount,
      type: resolveTransactionType(firstValue(row, binding.typeHint), amount),
    });

    if (result.success) {
      transactions.push(result.data);
    } else {
      errors.push({ line, message: result.error.issues.map((issue) => issue.message).join('; ') });
    }
  });

  return { transactions, errors };
}
