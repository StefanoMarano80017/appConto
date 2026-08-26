/**
 * Dettagli SQL condivisi dai repository.
 *
 * Non è logica di dominio: sono le accortezze che servono a tradurre in SQL
 * ciò che il dominio chiede, e che sarebbe sbagliato riscrivere in ogni feature.
 */

/**
 * I caratteri jolly di `LIKE` cercati alla lettera.
 *
 * Senza questo `100%` varrebbe come "100 qualsiasi cosa" e `_` come "un
 * carattere qualunque": una ricerca restituirebbe più di quanto è stato chiesto.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\%_]/g, (character) => `\${character}`);
}
