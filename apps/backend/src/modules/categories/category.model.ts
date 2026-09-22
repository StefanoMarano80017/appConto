import { randomUUID } from 'node:crypto';

/**
 * Modello di dominio.
 *
 * Una categoria rappresenta una tipologia di spesa. Non contiene logica:
 * serve solo a raggruppare i merchant.
 */
export interface Category {
  id: string;
  name: string;
  /** Colore di visualizzazione, in formato esadecimale. */
  color: string | null;
}

/** Una categoria con il numero di merchant attualmente assegnati. */
export interface CategoryWithUsage extends Category {
  merchantCount: number;
}

export type NewCategory = Omit<Category, 'id'>;

/** Una categoria nasce con un identificativo nuovo, scelto dall'applicazione. */
export function createCategory(input: NewCategory): Category {
  return { id: randomUUID(), ...input };
}
