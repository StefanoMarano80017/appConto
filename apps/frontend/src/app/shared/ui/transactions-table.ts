import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  Directive,
  TemplateRef,
  computed,
  contentChild,
  inject,
  input,
  output,
} from '@angular/core';
import { formatBookingDate } from '../../core/format';
import { Truncate } from '../../core/truncate';
import { Amount } from './amount';
import { SortableHeader } from './sortable-header';
import { VisualSelect } from './visual-select';
import type { VisualSelectOption } from './visual-select';
import type {
  TransactionsTableCategory,
  TransactionsTableCategoryChange,
  TransactionsTableExtraColumnContext,
  TransactionsTableMode,
  TransactionsTableRow,
  TransactionsTableSortDirection,
  TransactionsTableSortField,
  TransactionsTableTypeChange,
} from './transactions-table.model';

/**
 * Segna il template della colonna aggiuntiva, in coda alle altre.
 *
 * Il valore della direttiva è l'intestazione della colonna:
 *
 * ```html
 * <ng-template appTransactionsTableExtraColumn="Prestito" let-transaction>
 *   …
 * </ng-template>
 * ```
 *
 * È un template e non contenuto proiettato perché va reso una volta per riga,
 * con la riga come contesto. Serve a ciò che la tabella non deve sapere: la
 * colonna dei prestiti, con i suoi link e le sue regole, è della feature che
 * la ospita (stesso schema di `appDoughnutCenter`, v. chart/doughnut-chart.ts).
 *
 * La colonna c'è finché c'è il template: avvolto in un `@if`, chi ospita la
 * tabella decide quando mostrarla senza un input apposta.
 */
@Directive({ selector: 'ng-template[appTransactionsTableExtraColumn]' })
export class TransactionsTableExtraColumn<R extends TransactionsTableRow = TransactionsTableRow> {
  /** L'intestazione della colonna. Non è ordinabile: è un'aggiunta, non un dato del movimento. */
  readonly label = input.required<string>({ alias: 'appTransactionsTableExtraColumn' });

  readonly template = inject<TemplateRef<TransactionsTableExtraColumnContext<R>>>(TemplateRef);

  static ngTemplateContextGuard<R extends TransactionsTableRow>(
    _directive: TransactionsTableExtraColumn<R>,
    context: unknown,
  ): context is TransactionsTableExtraColumnContext<R> {
    return true;
  }
}

/** Le colonne della tabella; `field` è `null` dove non ha senso ordinare. */
const COLUMNS: readonly {
  label: string;
  field: TransactionsTableSortField | null;
  numeric: boolean;
}[] = [
  { label: 'Data', field: 'bookingDate', numeric: false },
  { label: 'Descrizione', field: null, numeric: false },
  { label: 'Merchant', field: 'merchant', numeric: false },
  { label: 'Tipo', field: 'type', numeric: false },
  { label: 'Categoria', field: 'category', numeric: false },
  { label: 'Importo', field: 'amount', numeric: true },
];

/**
 * Le categorie distinte dei merchant delle righe, nell'ordine in cui compaiono.
 *
 * In sola lettura la tabella non riceve l'elenco delle categorie: le basta
 * quella che ogni riga già porta con sé per mostrarne nome e colore. Una sola
 * lista per tutta la tabella, e non un array nuovo per riga, così `VisualSelect`
 * non ricalcola nulla a ogni giro di change detection.
 */
function categoriesOf(rows: readonly TransactionsTableRow[]): TransactionsTableCategory[] {
  const byId = new Map<string, TransactionsTableCategory>();

  for (const row of rows) {
    const category = row.merchant?.category;
    if (category && !byId.has(category.id)) {
      byId.set(category.id, category);
    }
  }

  return [...byId.values()];
}

/**
 * Tabella dei movimenti, di sola presentazione.
 *
 * Non decide cosa mostrare né salva nulla: riceve le righe già selezionate da
 * chi la ospita e ne segnala le intenzioni — ordinare, selezionare, correggere
 * un tipo o una categoria. Il salvataggio, l'errore e la riga in corso di
 * salvataggio arrivano da fuori (nella feature dei movimenti, `transaction-edits.ts`),
 * perché `shared/` non inietta API (§10 della proposta sui componenti condivisi).
 *
 * È generica sulla riga come `VisualSelect` lo è sull'opzione: gli eventi
 * restituiscono le righe col tipo di chi le ha passate, non con quello
 * strutturale di qui.
 */
@Component({
  selector: 'app-transactions-table',
  imports: [NgTemplateOutlet, Truncate, VisualSelect, Amount, SortableHeader],
  templateUrl: './transactions-table.html',
  styleUrl: './transactions-table.scss',
})
export class TransactionsTable<R extends TransactionsTableRow = TransactionsTableRow> {
  readonly transactions = input.required<readonly R[]>();

  /**
   * Predefinita a `readonly`: modificare è la scelta da dichiarare, perché è
   * quella che ha bisogno di qualcuno che salvi.
   */
  readonly mode = input<TransactionsTableMode>('readonly');

  /**
   * I tipi possibili, con etichetta e icona.
   *
   * Obbligatori anche in sola lettura: la cella mostra il nome e l'icona del
   * tipo, non il suo codice.
   */
  readonly typeOptions = input.required<readonly VisualSelectOption<R['type']>[]>();

  /**
   * Le categorie fra cui scegliere, in modifica.
   *
   * In sola lettura non servono: la categoria mostrata è quella del merchant
   * della riga (v. `categoriesOf`).
   */
  readonly categoryOptions = input<readonly VisualSelectOption[]>([]);

  /** Colonna ordinata; `null` rende le intestazioni non cliccabili. */
  readonly sortBy = input<TransactionsTableSortField | null>(null);
  readonly sortDirection = input<TransactionsTableSortDirection>('desc');

  /**
   * Mostra la colonna di selezione. Vale solo in modifica.
   *
   * Predefinito a `false`: selezionare ha senso solo dove sulle righe si
   * agisce, e anche in modifica resta una scelta di chi ospita la tabella.
   */
  readonly selectable = input(false);

  /**
   * Gli identificativi selezionati.
   *
   * La selezione **non** vive qui: la tabella la riceve e segnala le
   * intenzioni. Chi la ospita è l'unico che può conservarla attraverso un
   * ricaricamento dei dati o un cambio di pagina, e la tabella non sa nulla
   * di nessuno dei due.
   */
  readonly selectedIds = input<ReadonlySet<string>>(new Set<string>());

  /**
   * Mostra la riga di totale in fondo alla tabella.
   *
   * Chi mostra solo una parte delle righe (un'anteprima) la nasconde: il
   * totale di un'anteprima sarebbe fuorviante, perché non è quello dei
   * movimenti che esistono davvero.
   */
  readonly showTotal = input(true);

  /** La riga con un salvataggio in corso: i suoi controlli restano disabilitati. */
  readonly savingId = input<string | null>(null);

  /** L'ultimo errore di salvataggio, mostrato sopra la tabella. */
  readonly error = input<string | null>(null);

  /** Richiesta di ordinare per una colonna. */
  readonly sortSelected = output<TransactionsTableSortField>();
  /** Richiesta di invertire la selezione di una riga. */
  readonly selectionToggled = output<string>();
  /** Richiesta di selezionare o deselezionare tutte le righe mostrate. */
  readonly allToggled = output<boolean>();
  /** Richiesta di correggere la natura del movimento: riguarda la singola riga. */
  readonly typeChange = output<TransactionsTableTypeChange<R>>();
  /**
   * Richiesta di cambiare la categoria del merchant della riga: chi salva sa
   * che la ereditano tutti i movimenti dello stesso esercente.
   */
  readonly categoryChange = output<TransactionsTableCategoryChange<R>>();

  protected readonly extraColumn = contentChild<TransactionsTableExtraColumn<R>>(
    TransactionsTableExtraColumn,
  );

  protected readonly editable = computed(() => this.mode() === 'edit');

  /** La colonna di selezione c'è solo dove si modifica, anche se `selectable` è vero. */
  protected readonly showSelection = computed(() => this.editable() && this.selectable());

  protected readonly columns = COLUMNS;

  /** Le categorie che le celle offrono (in modifica) o mostrano (in sola lettura). */
  protected readonly categories = computed<readonly VisualSelectOption[]>(() =>
    this.editable() ? this.categoryOptions() : categoriesOf(this.transactions()),
  );

  /**
   * Dove sta la colonna «Importo» dentro `COLUMNS`, per la riga di totale.
   *
   * Calcolato una sola volta su una costante di modulo, non un `computed`:
   * `COLUMNS` non cambia mai a runtime.
   */
  protected readonly amountColumnIndex = COLUMNS.findIndex((column) => column.field === 'amount');

  /**
   * Il totale delle transazioni mostrate, non dell'intero archivio.
   *
   * Somma esattamente le righe che la tabella sta rendendo (`transactions()`
   * è già filtrata da chi la ospita): un cambio di mese o di filtro cambia
   * l'input, e questo totale li segue senza bisogno di saperne nulla.
   */
  protected readonly totalAmount = computed(() =>
    this.transactions().reduce((sum, transaction) => sum + transaction.amount, 0),
  );

  protected readonly formatBookingDate = formatBookingDate;

  /** Se la riga è selezionata. */
  protected isSelected(transaction: R): boolean {
    return this.selectedIds().has(transaction.id);
  }

  /** Se la riga ha un salvataggio in corso; in sola lettura non succede mai. */
  protected isSaving(transaction: R): boolean {
    return this.editable() && this.savingId() === transaction.id;
  }

  /** Tutte le righe mostrate sono selezionate. */
  protected readonly allSelected = computed(() => {
    const righe = this.transactions();

    return righe.length > 0 && righe.every((riga) => this.selectedIds().has(riga.id));
  });

  /**
   * Alcune sì e altre no.
   *
   * Serve alla casella dell'intestazione: uno stato indeterminato dice «una
   * parte», che è diverso sia da «nessuna» sia da «tutte».
   */
  protected readonly someSelected = computed(() => {
    const righe = this.transactions();
    const selezionate = righe.filter((riga) => this.selectedIds().has(riga.id)).length;

    return selezionate > 0 && selezionate < righe.length;
  });

  /**
   * Segnala un cambio di tipo, ma solo se è davvero un cambio.
   *
   * L'opzione vuota («—») non è un tipo: un movimento ne ha sempre uno, e
   * sceglierla non chiede nulla a nessuno. Lo stesso tipo di prima neppure.
   */
  protected changeType(transaction: R, type: R['type'] | null): void {
    if (type === null || transaction.type === type) {
      return;
    }

    this.typeChange.emit({ row: transaction, type });
  }

  /**
   * Segnala un cambio di categoria del merchant, se c'è un merchant e se la
   * categoria scelta è diversa da quella che ha già.
   */
  protected changeCategory(transaction: R, categoryId: string | null): void {
    const merchant = transaction.merchant;
    if (merchant === null) {
      return;
    }

    if ((merchant.category?.id ?? null) === categoryId) {
      return;
    }

    this.categoryChange.emit({ row: transaction, categoryId });
  }
}
