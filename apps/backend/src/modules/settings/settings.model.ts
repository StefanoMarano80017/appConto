/**
 * Impostazioni dell'applicazione.
 *
 * Sono un'unica riga: l'app è personale e locale, non esiste un concetto
 * di utente. Servono a dare un punto di partenza noto alla liquidità.
 */
export interface Settings {
  /** Saldo del conto alla data indicata. */
  initialBalance: number;
  /** Data del saldo noto, in formato ISO `YYYY-MM-DD`. Null = dall'inizio. */
  balanceDate: string | null;
}
