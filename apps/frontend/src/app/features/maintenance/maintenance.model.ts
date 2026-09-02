/** L'esito di un azzeramento, così come lo riporta il backend. */
export interface ResetOutcome {
  /**
   * La copia creata prima di procedere.
   *
   * È l'informazione più importante della risposta: è da lì che si torna
   * indietro, e il nome è ciò che serve per ritrovarla fra i backup.
   */
  backupName: string;
  /** Quante righe sono state eliminate, per tabella. */
  removed: Record<string, number>;
  seededCategories: number;
  message: string;
}

/** La parola che il backend pretende per procedere. */
export const RESET_CONFIRMATION = 'AZZERA';
