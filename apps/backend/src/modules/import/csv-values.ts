/**
 * Interpretazione dei valori grezzi di una cella CSV.
 *
 * Sono le uniche funzioni che conoscono i formati con cui le banche scrivono
 * date e importi. Servono due volte: per riconoscere che *tipo* di dato
 * contiene una colonna (`csv-column-binder`) e per convertirlo in dominio
 * (`csv-transaction-mapper`).
 */

/**
 * Accetta `31/12/2025`, `31-12-2025`, `31.12.2025` e `2025-12-31`, con un
 * eventuale orario finale (`31/12/2025 10:30`, `2025-12-31T10:30:00`).
 * Gli anni a due cifre: 00-69 diventano 2000-2069, 70-99 diventano 1970-1999.
 */
export function parseCsvDate(raw: string): string | null {
  const value = raw.trim();

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(value);
  if (isoMatch) {
    return toIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const localMatch = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(value);
  if (localMatch) {
    const year = Number(localMatch[3]);
    return toIsoDate(year < 70 ? 2000 + year : year < 100 ? 1900 + year : year, Number(localMatch[2]), Number(localMatch[1]));
  }

  return null;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;

  return isRealDate ? date.toISOString().slice(0, 10) : null;
}

/** Accetta `-1.234,56`, `1234.56`, `€ 12,00`, `1.234,56-`. Negativo = uscita. */
export function parseCsvAmount(raw: string): number | null {
  let value = raw.trim().replace(/EUR|[€$\s]/gi, '');
  if (value.length === 0) {
    return null;
  }

  // Alcuni estratti conto scrivono il segno dopo l'importo (`120,00-`).
  let trailingSign = 1;
  if (value.endsWith('-') || value.endsWith('+')) {
    // Un segno prima e uno dopo (`-120,00-`) è ambiguo: meglio rifiutare.
    if (/^[+-]/.test(value)) {
      return null;
    }
    trailingSign = value.endsWith('-') ? -1 : 1;
    value = value.slice(0, -1);
  }

  if (!/^[+-]?[\d.,]+$/.test(value)) {
    return null;
  }

  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // Il separatore che compare per ultimo è quello decimale.
    const [decimalSeparator, thousandsSeparator] = lastComma > lastDot ? [',', '.'] : ['.', ','];
    normalized = value.split(thousandsSeparator).join('').replace(decimalSeparator, '.');
  } else if (/^[+-]?\d{1,3}(,\d{3}){2,}$/.test(value)) {
    // Più virgole a gruppi di tre cifre: migliaia in formato inglese.
    normalized = value.split(',').join('');
  } else if (lastComma >= 0) {
    normalized = value.replace(',', '.');
  } else if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(value)) {
    // Solo punti a gruppi di tre cifre: separatore delle migliaia (formato italiano).
    normalized = value.split('.').join('');
  } else {
    normalized = value;
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount * trailingSign : null;
}
