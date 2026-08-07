import Papa from 'papaparse';
import { ValidationError } from '../../shared/errors.js';

/** Riga grezza del CSV: intestazione -> valore, nessuna interpretazione. */
export type CsvRow = Record<string, string | undefined>;

export interface ParsedCsv {
  headers: string[];
  rows: CsvRow[];
}

/** Rimuove il BOM eventualmente presente nei CSV esportati da Excel. */
function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/**
 * Legge il contenuto di un CSV e restituisce righe grezze.
 *
 * Non conosce il dominio, né la persistenza: sa solo leggere un CSV.
 * Il delimitatore (`,` oppure `;`) viene riconosciuto automaticamente.
 */
export function parseCsv(content: string): ParsedCsv {
  const result = Papa.parse<CsvRow>(stripBom(content), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  const headers = (result.meta.fields ?? []).filter((header) => header.length > 0);
  if (headers.length === 0) {
    throw new ValidationError('Il file CSV non contiene una riga di intestazione valida.');
  }

  return { headers, rows: result.data };
}
