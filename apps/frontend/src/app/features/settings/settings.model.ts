/** Impostazioni dell'applicazione, così come esposte dalle API del backend. */
export interface Settings {
  /** Saldo del conto alla data indicata. */
  initialBalance: number;
  /** Data del saldo noto, in formato ISO `YYYY-MM-DD`. */
  balanceDate: string | null;
}
