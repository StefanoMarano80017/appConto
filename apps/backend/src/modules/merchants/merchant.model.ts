import { randomUUID } from 'node:crypto';

/**
 * Modello di dominio.
 *
 * Un merchant identifica l'esercente presso il quale è stata effettuata
 * un'operazione. Non conosce Express né SQLite.
 */
export interface Merchant {
  id: string;
  /** Nome così come compare nell'estratto conto: non viene mai modificato. */
  name: string;
  /** Chiave stabile usata per riconoscere lo stesso esercente. */
  normalizedName: string;
  /** Categoria assegnata dall'utente. Null finché non viene classificato. */
  categoryId: string | null;
  /** Nome scelto dall'utente. Null finché non viene rinominato. */
  displayName: string | null;
}

export type NewMerchant = Omit<Merchant, 'id' | 'categoryId' | 'displayName'>;

/**
 * Un merchant nasce senza categoria e senza nome personalizzato:
 * entrambi sono scelte dell'utente.
 */
export function createMerchant(input: NewMerchant): Merchant {
  return { id: randomUUID(), ...input, categoryId: null, displayName: null };
}

/** Il nome da mostrare: quello scelto dall'utente, altrimenti quello della banca. */
export function merchantLabel(merchant: Merchant): string {
  return merchant.displayName ?? merchant.name;
}
