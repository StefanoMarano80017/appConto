/**
 * Lettura di un importo digitato a mano.
 *
 * Vive fuori dalle feature perché ogni modulo che chiede un importo affronta lo
 * stesso problema: chi scrive `1.234,56` e chi scrive `1234.56` intendono la
 * stessa cifra, e nessuno dei due dovrebbe vedere un errore.
 */

/** Accetta sia `1234.56` sia `1.234,56`, con o senza simbolo di valuta. */
export function parseAmount(raw: string): number | null {
  const value = raw.trim().replace(/[€\s]/g, '');
  if (value === '') {
    return null;
  }

  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // Il separatore decimale è quello più a destra; l'altro divide le migliaia.
    const [decimal, thousands] = lastComma > lastDot ? [',', '.'] : ['.', ','];
    normalized = value.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    normalized = value.replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(value)) {
    normalized = value.split('.').join('');
  } else {
    normalized = value;
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}
