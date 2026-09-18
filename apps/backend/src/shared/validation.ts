import type { ZodType } from 'zod';
import { ValidationError } from './errors.js';

/**
 * Valida un input che arriva da fuori, o rifiuta la richiesta.
 *
 * Dei problemi trovati riporta il primo: a chi deve correggere serve sapere
 * cosa sistemare adesso, non l'elenco completo di quel che non torna.
 */
export function parseOrThrow<T>(schema: ZodType<T>, value: unknown, fallback: string): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? fallback);
  }

  return parsed.data;
}
