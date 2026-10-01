/**
 * Il contratto della tabella dei movimenti condivisa.
 *
 * I tipi sono **strutturali**: `shared/` non conosce le feature, quindi qui
 * non c'è il `Transaction` del dominio ma la sola forma che la tabella legge.
 * Il `Transaction` della feature la soddisfa così com'è, e si passa
 * direttamente senza conversioni — i campi in più (`normalizedName` del
 * merchant, per esempio) restano semplicemente ignorati.
 */

/**
 * Le due modalità della tabella.
 *
 * - `edit`: tipo e categoria si correggono in linea, e si possono selezionare
 *   le righe (se chi la ospita lo chiede con `selectable`).
 * - `readonly`: solo lettura — è un riepilogo, non un elenco su cui agire.
 *   Niente caselle, niente `select`: tipo e categoria restano visibili con la
 *   stessa resa (icona, pallino colorato), ma non si toccano.
 */
export type TransactionsTableMode = 'edit' | 'readonly';

/**
 * Le colonne per cui si può ordinare.
 *
 * Stessi letterali di `TRANSACTION_SORT_FIELDS` della feature, ripetuti qui
 * perché `shared/` non può importarli: l'unione della feature resta così
 * assegnabile a questa, e un campo che sparisse da una delle due farebbe
 * fallire la compilazione di chi le collega.
 */
export type TransactionsTableSortField =
  'bookingDate' | 'amount' | 'merchant' | 'category' | 'type';

export type TransactionsTableSortDirection = 'asc' | 'desc';

/** La categoria di un merchant, come la tabella la mostra. */
export interface TransactionsTableCategory {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
}

/** Il merchant di una riga: nome mostrato, nome della banca e categoria. */
export interface TransactionsTableMerchant {
  readonly id: string;
  /** Nome originale della banca. */
  readonly name: string;
  /** Nome scelto dall'utente; `null` se non l'ha mai rinominato. */
  readonly displayName: string | null;
  /** Il nome da mostrare. */
  readonly label: string;
  readonly category: TransactionsTableCategory | null;
}

/**
 * Una riga della tabella.
 *
 * `type` è una stringa qualunque e non un'unione chiusa: i tipi possibili, con
 * etichette e icone, arrivano da chi ospita la tabella (`typeOptions`). Chi ha
 * un'unione più stretta la ritrova negli eventi, perché la tabella è generica
 * sulla riga (v. `TransactionsTableTypeChange`).
 */
export interface TransactionsTableRow {
  readonly id: string;
  /** Data contabile in formato ISO `YYYY-MM-DD`. */
  readonly bookingDate: string;
  readonly description: string;
  /** Importo in euro: negativo = uscita, positivo = entrata. */
  readonly amount: number;
  readonly type: string;
  readonly merchant: TransactionsTableMerchant | null;
}

/**
 * Richiesta di cambiare il tipo di una riga.
 *
 * `type` è `R['type']`: per una feature che passa righe col proprio tipo
 * chiuso, l'evento arriva già con quell'unione, senza cast dal lato suo.
 */
export interface TransactionsTableTypeChange<
  R extends TransactionsTableRow = TransactionsTableRow,
> {
  readonly row: R;
  readonly type: R['type'];
}

/** Richiesta di cambiare la categoria del merchant di una riga; `null` la toglie. */
export interface TransactionsTableCategoryChange<
  R extends TransactionsTableRow = TransactionsTableRow,
> {
  readonly row: R;
  readonly categoryId: string | null;
}

/** Il contesto della colonna aggiuntiva: la riga che la cella sta rendendo. */
export interface TransactionsTableExtraColumnContext<
  R extends TransactionsTableRow = TransactionsTableRow,
> {
  readonly $implicit: R;
}
