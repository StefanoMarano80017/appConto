import { ValidationError } from '../errors.js';

/**
 * Lettura dei parametri di query string.
 *
 * Express restituisce stringhe, elenchi o valori annidati: qui si riduce tutto
 * alle due forme che le API accettano, senza che ogni rotta lo rifaccia.
 */

/** Un parametro può arrivare ripetuto oppure come elenco separato da virgole. */
export type QueryParam = string | readonly string[] | undefined;

/** Riduce il valore grezzo di Express ad un parametro, o solleva un errore. */
export function queryParam(value: unknown, name: string): QueryParam {
  if (value === undefined || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }

  throw new ValidationError(`Parametro "${name}" non valido.`);
}

/** Da `a,b` oppure `['a', 'b,c']` ad un elenco di valori distinti e non vuoti. */
export function toList(value: QueryParam): string[] {
  if (value === undefined) {
    return [];
  }

  const parts = (Array.isArray(value) ? value : [value as string])
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return [...new Set(parts)];
}

/**
 * Il primo valore utile, oppure `null`.
 *
 * A differenza di `toList` non spezza sulle virgole: un importo come `99,50` o
 * una ricerca come `bar, ristorante` sono un valore solo.
 */
export function toSingle(value: QueryParam): string | null {
  const first = Array.isArray(value) ? value[0] : (value as string | undefined);
  const trimmed = first?.trim() ?? '';

  return trimmed.length === 0 ? null : trimmed;
}
