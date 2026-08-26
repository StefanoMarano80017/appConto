import type { AnalyticsQuery } from './analytics.query.js';

/**
 * Analisi di un periodo.
 *
 * Non è un'entità e non viene mai persistita: è una proiezione delle
 * transazioni, dei merchant e delle categorie esistenti, ricalcolata ad ogni
 * richiesta. Cambiare la categoria di un merchant cambia questa risposta senza
 * che nulla debba essere aggiornato.
 */

/** Il passo dell'andamento nel tempo. La settimana comincia il lunedì. */
export type TimelineGranularity = 'day' | 'week' | 'month';

export interface AnalyticsPeriod {
  /** Estremi richiesti; `null` quando non è stato posto alcun limite. */
  from: string | null;
  to: string | null;
  /** Estremi effettivamente coperti dai movimenti selezionati. */
  firstTransactionDate: string | null;
  lastTransactionDate: string | null;
}

/**
 * Totali per natura del movimento.
 *
 * `income` ed `expenses` sono magnitudini positive, come nel riepilogo mensile.
 * Gli altri tipi conservano il segno: un trasferimento o un movimento "altro"
 * può andare in entrambe le direzioni e appiattirlo in valore assoluto
 * racconterebbe il falso.
 */
export interface AnalyticsOverview {
  /** Somma dei movimenti `INCOME`. */
  income: number;
  /** Somma dei movimenti `EXPENSE`, in valore assoluto. */
  expenses: number;
  /** `income - expenses`: quanto è stato messo da parte al netto delle sole spese. */
  balance: number;
  /** Somma con segno dei movimenti `WITHDRAWAL`. */
  withdrawals: number;
  /** Somma con segno dei movimenti `LOAN`. */
  loans: number;
  /** Somma con segno dei movimenti `TRANSFER`. */
  transfers: number;
  /** Somma con segno dei movimenti `OTHER`. */
  other: number;
  /** Somma con segno di tutti i movimenti selezionati. */
  netMovement: number;
}

export interface AnalyticsCounts {
  transactions: number;
  /** Merchant distinti presenti nel periodo. */
  merchants: number;
  /** Categorie distinte presenti nel periodo. */
  categories: number;
}

export interface CategoryDistribution {
  /** `null` per le spese di merchant non ancora classificati. */
  categoryId: string | null;
  name: string;
  color: string | null;
  /** Totale delle spese della categoria, in valore assoluto. */
  amount: number;
  transactionCount: number;
  /** Quota sul totale delle spese del periodo, in percentuale. */
  percentage: number;
}

export interface MerchantDistribution {
  /** `null` per le transazioni importate prima dell'introduzione dei merchant. */
  merchantId: string | null;
  name: string;
  /** Nome della categoria assegnata al merchant. */
  category: string | null;
  amount: number;
  transactionCount: number;
  percentage: number;
}

export interface TimelineBucket {
  /**
   * `YYYY-MM-DD` con passo giornaliero, il lunedì della settimana con passo
   * settimanale, `YYYY-MM` con passo mensile.
   */
  period: string;
  /**
   * L'intervallo è coperto solo in parte dai movimenti osservati: il primo e
   * l'ultimo punto di una serie settimanale o mensile quasi sempre lo sono, e
   * senza saperlo si leggerebbe un calo dove c'è solo un intervallo incompleto.
   */
  partial: boolean;
  income: number;
  expenses: number;
  withdrawals: number;
  loans: number;
  transfers: number;
  netMovement: number;
}

export interface Timeline {
  granularity: TimelineGranularity;
  /**
   * Intervalli consecutivi dal primo all'ultimo movimento osservato.
   *
   * Gli intervalli vuoti *interni* restano: un mese senza spese è
   * un'informazione. Oltre gli estremi non si va: un periodo richiesto ma non
   * ancora coperto dall'archivio non è "zero speso", è "non lo sappiamo".
   */
  buckets: TimelineBucket[];
}

export interface LoanEntry {
  id: string;
  bookingDate: string;
  description: string;
  merchant: string | null;
  /** Importo con segno: negativo quando il denaro è uscito. */
  amount: number;
}

/**
 * Prestiti del periodo.
 *
 * Il dominio dei prestiti non esiste ancora: qui c'è solo ciò che il tipo
 * `LOAN` permette di affermare, cioè quanto denaro è uscito a titolo di
 * prestito. Restituzioni e credito residuo richiederanno un dominio dedicato.
 */
export interface LoansSection {
  /** Denaro uscito come prestito, in valore assoluto. */
  lent: number;
  transactionCount: number;
  entries: LoanEntry[];
}

export interface AnalyticsViewModel {
  period: AnalyticsPeriod;
  /** I criteri applicati, così com'è stati interpretati dal backend. */
  query: AnalyticsQuery;
  overview: AnalyticsOverview;
  counts: AnalyticsCounts;
  /** Spese per categoria, dalla più alta. */
  byCategory: CategoryDistribution[];
  /** Spese per merchant, dalla più alta. */
  byMerchant: MerchantDistribution[];
  timeline: Timeline;
  loans: LoansSection;
}
