import { Component, computed, input, output } from '@angular/core';
import { Panel } from '../layout/panel';
import { SectionHeader } from '../layout/section-header';
import { EmptyState } from './feedback/empty-state/empty-state';
import { ErrorRetry } from './feedback/error-retry/error-retry';
import { TransactionsPagination } from './transactions-pagination';
import { TransactionsTable } from './transactions-table';
import type {
  TransactionsTableCategoryChange,
  TransactionsTableExtraColumnDef,
  TransactionsTableMode,
  TransactionsTablePage,
  TransactionsTableRow,
  TransactionsTableSortDirection,
  TransactionsTableSortField,
  TransactionsTableTypeChange,
} from './transactions-table.model';
import type { SelectOption } from './forms/select/select.model';

/** Righe finte mostrate durante il primo caricamento. */
const SKELETON_ROWS = 8;

/**
 * Il pannello completo di una tabella di transazioni paginata.
 *
 * Disegna tutto da sé — pannello, paginazione sopra e sotto, barra della
 * selezione, tabella, stati di errore, vuoto e primo caricamento — e non
 * accetta contenuto proiettato. È voluto: Movimenti e Analytics mostrano la
 * stessa tabella, e con un involucro a `ng-content` ognuna riscriveva a mano
 * la parte interna, che è proprio quella che finiva per divergere. Qui chi la
 * usa passa dati e ascolta intenzioni, e la resa è una sola.
 *
 * Come la tabella, non salva e non carica nulla: pagina, selezione,
 * eliminazione e ordinamento restano di chi la ospita, perché `shared/` non
 * inietta API (§10 della proposta sui componenti condivisi). Il pannello
 * decide solo cosa mostrare, in quest'ordine di precedenza: errore, vuoto,
 * dati, scheletro. L'errore vince su tutto perché, anche con dati precedenti
 * ancora in mano, il messaggio con «Riprova» è ciò che serve.
 *
 * È generico sulla riga come la tabella: gli eventi tornano col tipo di riga
 * di chi li ha passati.
 */
@Component({
  selector: 'app-transactions-table-panel',
  imports: [EmptyState, ErrorRetry, Panel, SectionHeader, TransactionsPagination, TransactionsTable],
  templateUrl: './transactions-table-panel.html',
  styleUrl: './transactions-table-panel.scss',
})
export class TransactionsTablePanel<R extends TransactionsTableRow = TransactionsTableRow> {
  /**
   * La pagina da mostrare; `undefined` finché i dati non sono arrivati.
   *
   * Distingue il primo caricamento (scheletro) da un elenco già mostrato che
   * si sta ricaricando (dati attenuati). Vuota vuol dire `items` vuoto.
   */
  readonly page = input<TransactionsTablePage<R> | undefined>();
  /** Con dati già presenti attenua il pannello; senza dati mostra lo scheletro. */
  readonly loading = input(false);
  /** L'errore di caricamento, non quello di salvataggio (v. `editError`). */
  readonly error = input<string | null>(null);

  /**
   * Titolo opzionale in cima al pannello, in ogni suo stato: chi lo usa come
   * sezione di una pagina più ampia (Analytics) ne ha bisogno, Movimenti no.
   */
  readonly title = input<string | undefined>(undefined);

  readonly emptyMessage = input('Nessuna transazione trovata.');
  readonly emptyHint = input<string | undefined>(undefined);
  readonly emptyActionLabel = input<string | undefined>(undefined);

  // Inoltrati alla tabella così come sono: il significato è documentato lì.
  readonly mode = input<TransactionsTableMode>('readonly');
  readonly typeOptions = input.required<readonly SelectOption<R['type']>[]>();
  readonly categoryOptions = input<readonly SelectOption[]>([]);
  readonly sortBy = input<TransactionsTableSortField | null>(null);
  readonly sortDirection = input<TransactionsTableSortDirection>('desc');
  readonly showTotal = input(true);
  readonly savingId = input<string | null>(null);
  /** L'ultimo errore di salvataggio in linea: diventa l'`error` della tabella. */
  readonly editError = input<string | null>(null);
  readonly extraColumn = input<TransactionsTableExtraColumnDef<R> | null>(null);

  /**
   * Abilita selezione e barra delle azioni. Come nella tabella, vale solo in
   * modifica: in sola lettura non c'è nulla da eliminare.
   */
  readonly selectable = input(false);
  readonly selectedIds = input<ReadonlySet<string>>(new Set<string>());
  /** Il primo «Elimina» è stato premuto: si mostra la domanda di conferma. */
  readonly confirmingDelete = input(false);
  readonly deleting = input(false);
  readonly deleteError = input<string | null>(null);
  /** L'esito dell'ultima eliminazione riuscita, da mostrare nella barra. */
  readonly deleteDone = input<string | null>(null);

  readonly retry = output<void>();
  readonly emptyAction = output<void>();
  readonly pageSelected = output<number>();
  readonly pageSizeSelected = output<number>();
  readonly sortSelected = output<TransactionsTableSortField>();
  readonly selectionToggled = output<string>();
  readonly allToggled = output<boolean>();
  readonly typeChange = output<TransactionsTableTypeChange<R>>();
  readonly categoryChange = output<TransactionsTableCategoryChange<R>>();
  /** Primo clic su «Elimina»: chi ospita chiede conferma. */
  readonly deleteRequested = output<void>();
  /** «Sì, elimina». */
  readonly deleteConfirmed = output<void>();
  /** «Annulla» sulla domanda di conferma. */
  readonly deleteCancelled = output<void>();
  /** «Deseleziona». */
  readonly selectionCleared = output<void>();

  protected readonly skeletonRows = Array.from({ length: SKELETON_ROWS });

  protected readonly selectedCount = computed(() => this.selectedIds().size);

  /**
   * La barra della selezione appare solo quando ha qualcosa da dire: una barra
   * di azioni sempre presente ma quasi sempre inerte è rumore, e sposta la
   * tabella verso il basso senza motivo. Resta anche a selezione vuota se c'è
   * un esito da leggere — l'errore o il conteggio degli eliminati.
   */
  protected readonly showSelectionBar = computed(
    () =>
      this.selectable() &&
      (this.selectedCount() > 0 || !!this.deleteError() || !!this.deleteDone()),
  );
}
