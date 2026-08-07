/**
 * Riduce il nome di un esercente ad una chiave stabile.
 *
 * Implementazione volutamente minima: minuscole, spazi esterni rimossi,
 * spazi multipli compattati. Non riconosce forme societarie né località.
 *
 * È l'unico punto che decide quando due descrizioni rappresentano lo stesso
 * merchant: potrà essere sostituito con una strategia più evoluta senza
 * modificare il resto della pipeline.
 */
export function normalizeMerchantName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}
