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
  const text = stripBom(content);
  const result = Papa.parse<CsvRow>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  // Un file malformato si rifiuta per intero: Papa altrimenti ingloba o scarta righe in silenzio.
  // Si ignora `UndetectableDelimiter` (normale con una sola colonna).
  const error = result.errors.find((e) => e.type === 'Quotes' || e.type === 'FieldMismatch');
  if (error) {
    // `index` è la posizione nel testo; `row` è l'indice 0-based delle righe di dati (+2 = riga del file).
    const line =
      error.type === 'Quotes' && error.index !== undefined
        ? text.slice(0, error.index).split('\n').length
        : (error.row ?? 0) + 2;
    throw new ValidationError(`Il file CSV è malformato alla riga ${line}: ${error.message}.`);
  }

  const headers = (result.meta.fields ?? []).filter((header) => header.length > 0);
  if (headers.length === 0) {
    throw new ValidationError('Il file CSV non contiene una riga di intestazione valida.');
  }

  return { headers, rows: result.data };
}
