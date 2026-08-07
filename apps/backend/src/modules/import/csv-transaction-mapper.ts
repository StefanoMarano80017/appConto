import { ValidationError } from '../../shared/errors.js';
import { parsedTransactionSchema, type ParsedTransaction } from '../transactions/index.js';
import type { CsvRow } from './csv-parser.js';
import { resolveTransactionType } from './transaction-type-resolver.js';

/**
 * Converte le righe grezze del CSV in transazioni di dominio.
 *
 * È l'unico punto che conosce i formati bancari (date italiane, importi con
 * virgola, nomi di colonna alternativi). Non conosce HTTP né la persistenza.
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

type TransactionField = 'bookingDate' | 'description' | 'amount';
/** Colonna facoltativa: se manca, il tipo si deduce dal segno dell'importo. */
type OptionalField = 'typeHint';

/**
 * Nomi di colonna accettati, in ordine di preferenza.
 *
 * Se il CSV contiene più colonne compatibili con lo stesso campo, per ogni riga
 * viene usato il primo valore non vuoto (es. `Descrizione` vuota -> `Nome`).
 */
const COLUMN_ALIASES: Record<TransactionField | OptionalField, string[]> = {
  bookingDate: ['data contabile', 'data operazione', 'data', 'booking date', 'date', 'data valuta'],
  description: [
    'descrizione',
    'descrizione operazione',
    'causale',
    'description',
    'dettagli',
    'nome',
    'tipologia',
  ],
  amount: ['importo', 'amount', 'valore'],
  typeHint: ['tipologia', 'tipo operazione', 'tipo movimento', 'tipo', 'type'],
};

const REQUIRED_FIELDS: TransactionField[] = ['bookingDate', 'description', 'amount'];

const FIELD_LABELS: Record<TransactionField, string> = {
  bookingDate: 'data',
  description: 'descrizione',
  amount: 'importo',
};

/**
 * Rende confrontabile un'intestazione: minuscole, spazi normalizzati e
 * suffissi di valuta rimossi (`Importo ( € )` e `Importo (EUR)` -> `importo`).
 */
function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[€$]/g, '')
    .replace(/\((?:\s|eur|euro)*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Associa ad ogni campo del dominio le colonne utilizzabili, in ordine di preferenza. */
function resolveColumns(headers: string[]): Record<TransactionField | OptionalField, string[]> {
  const byNormalizedName = new Map(headers.map((header) => [normalizeHeader(header), header]));
  const resolved = {} as Record<TransactionField | OptionalField, string[]>;
  const missing: TransactionField[] = [];

  for (const field of Object.keys(COLUMN_ALIASES) as (TransactionField | OptionalField)[]) {
    const columns = COLUMN_ALIASES[field]
      .map((alias) => byNormalizedName.get(alias))
      .filter((column): column is string => column !== undefined);

    if (columns.length === 0 && REQUIRED_FIELDS.includes(field as TransactionField)) {
      missing.push(field as TransactionField);
    }
    resolved[field] = columns;
  }

  if (missing.length > 0) {
    const required = missing.map((field) => FIELD_LABELS[field]).join(', ');
    throw new ValidationError(
      `Colonne obbligatorie non trovate nel CSV: ${required}. Intestazioni presenti: ${headers.join(', ')}.`,
    );
  }

  return resolved;
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

/** Accetta `31/12/2025`, `31-12-2025`, `31.12.2025` e `2025-12-31`. */
function parseDate(raw: string): string | null {
  const value = raw.trim();

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (isoMatch) {
    return toIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const localMatch = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(value);
  if (localMatch) {
    const year = Number(localMatch[3]);
    return toIsoDate(year < 100 ? 2000 + year : year, Number(localMatch[2]), Number(localMatch[1]));
  }

  return null;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;

  return isRealDate ? date.toISOString().slice(0, 10) : null;
}

/** Accetta `-1.234,56`, `1234.56`, `€ 12,00`. Negativo = uscita. */
function parseAmount(raw: string): number | null {
  const value = raw.trim().replace(/[€$\s]/g, '');
  if (value.length === 0) {
    return null;
  }

  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // Il separatore che compare per ultimo è quello decimale.
    const [decimalSeparator, thousandsSeparator] = lastComma > lastDot ? [',', '.'] : ['.', ','];
    normalized = value.split(thousandsSeparator).join('').replace(decimalSeparator, '.');
  } else if (lastComma >= 0) {
    normalized = value.replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(value)) {
    // Solo punti a gruppi di tre cifre: separatore delle migliaia (formato italiano).
    normalized = value.split('.').join('');
  } else {
    normalized = value;
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

export function mapRowsToTransactions(headers: string[], rows: CsvRow[]): MappingResult {
  const columns = resolveColumns(headers);
  const transactions: ParsedTransaction[] = [];
  const errors: RowError[] = [];

  rows.forEach((row, index) => {
    const line = index + 2; // la riga 1 è l'intestazione
    const rawDate = firstValue(row, columns.bookingDate);
    const rawAmount = firstValue(row, columns.amount);

    const bookingDate = parseDate(rawDate);
    const amount = parseAmount(rawAmount);

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
      description: firstValue(row, columns.description),
      amount,
      type: resolveTransactionType(firstValue(row, columns.typeHint), amount),
    });

    if (result.success) {
      transactions.push(result.data);
    } else {
      errors.push({ line, message: result.error.issues.map((issue) => issue.message).join('; ') });
    }
  });

  return { transactions, errors };
}
