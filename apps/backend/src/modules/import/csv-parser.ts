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

  // Virgolette non chiuse: Papa ingloba le righe successive nel campo senza avvisare, quindi
  // si rifiuta l'intero file. Gli altri errori (campi in più o in meno, delimitatore non
  // rilevabile con una sola colonna) restano ignorati: le righe incomplete le segnala l'import.
  const quoteError = result.errors.find((e) => e.type === 'Quotes');
  if (quoteError) {
    // `row` di Papa non è la riga del file: si ricava dalla posizione (`index`) nel testo.
    const line = text.slice(0, quoteError.index).split('\n').length;
    throw new ValidationError(`Il file CSV ha virgolette non chiuse alla riga ${line}.`);
  }

  const headers = (result.meta.fields ?? []).filter((header) => header.length > 0);
  if (headers.length === 0) {
    throw new ValidationError('Il file CSV non contiene una riga di intestazione valida.');
  }

  return { headers, rows: result.data };
}
