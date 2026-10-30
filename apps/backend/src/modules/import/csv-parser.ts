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

  // Virgolette non chiuse (`MissingQuotes`): Papa ingloba le righe successive nel campo senza avvisare, quindi
  // si rifiuta l'intero file. Gli altri errori (campi in più o in meno, delimitatore non
  // rilevabile con una sola colonna) restano ignorati: le righe incomplete le segnala l'import.
  const quoteError = result.errors.find((e) => e.code === 'MissingQuotes');
  if (quoteError) {
    // `row` di Papa non è la riga del file: si ricava dalla posizione (`index`) nel testo.
    const line = text.slice(0, quoteError.index).split('\n').length;
    throw new ValidationError(`Il file CSV ha virgolette non chiuse alla riga ${line}.`);
  }

  // Virgolette interne non raddoppiate (`InvalidQuotes`): di norma Papa legge il campo correttamente, ma se
  // l'apertura non è chiusa fonde la riga con la successiva (il campo contiene un a capo) e una riga si perde.
  // Il caso con un a capo legittimo e virgolette interne non raddoppiate non è distinguibile e si rifiuta.
  const invalidQuotes = result.errors.filter((e) => e.code === 'InvalidQuotes');
  if (invalidQuotes.length > 0) {
    // `row` di Papa conta i record del testo (intestazione e righe vuote comprese): si rilegge senza saltare nulla.
    const records = Papa.parse<string[]>(text, { delimiter: result.meta.delimiter }).data;
    const newlines = (record: string[]) => record.join('').split('\n').length - 1;
    for (const error of invalidQuotes) {
      const record = records[error.row ?? -1];
      if (record && /[\r\n]/.test(record.join(''))) {
        // La riga del file in cui inizia il record: una per record precedente più gli a capo dentro i loro campi.
        const line = records.slice(0, error.row).reduce((sum, previous) => sum + 1 + newlines(previous), 1);
        throw new ValidationError(`Il file CSV ha virgolette non chiuse alla riga ${line}.`);
      }
    }
  }

  const headers = (result.meta.fields ?? []).filter((header) => header.length > 0);
  if (headers.length === 0) {
    throw new ValidationError('Il file CSV non contiene una riga di intestazione valida.');
  }

  return { headers, rows: result.data };
}
