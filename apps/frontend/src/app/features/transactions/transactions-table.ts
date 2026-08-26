import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { formatAmount, formatBookingDate } from '../../core/format';
import { toErrorMessage } from '../../core/http-error';
import { CategoriesApi } from '../categories/categories.api';
import { Category } from '../categories/category.model';
import { LoanLink, indexLinksByTransaction } from '../loans/loan.model';
import { MerchantsApi } from '../merchants/merchants.api';
import { SortDirection, TransactionSortField } from './transaction-query';
import {
  TRANSACTION_TYPES,
  TRANSACTION_TYPE_LABELS,
  TransactionType
} from './transaction-type';
import { Transaction } from './transaction.model';
import { TransactionsApi } from './transactions.api';

/** Le colonne della tabella; `field` è `null` dove non ha senso ordinare. */
const COLUMNS: readonly { label: string; field: TransactionSortField | null; numeric: boolean }[] = [
  { label: 'Data', field: 'bookingDate', numeric: false },
  { label: 'Descrizione', field: null, numeric: false },
  { label: 'Merchant', field: 'merchant', numeric: false },
  { label: 'Tipo', field: 'type', numeric: false },
  { label: 'Categoria', field: 'category', numeric: false },
  { label: 'Importo', field: 'amount', numeric: true }
];

/** La colonna dei prestiti: non si ordina, è un'azione. */
const LOAN_COLUMN = { label: 'Prestito', field: null, numeric: false } as const;

/**
 * Ciò che la colonna dei prestiti mostra per un movimento.
 *
 * I tre casi non si escludono: un movimento può aver originato un prestito e
 * poterne originare un altro.
 */
interface LoanCell {
  /** I prestiti nati da questo movimento. */
  origins: LoanLink[];
  /** I prestiti che questo movimento ha contribuito a restituire. */
  repayments: LoanLink[];
  /** Da questo movimento si può creare un prestito. */
  creatable: boolean;
  /**
   * Quanto del movimento non è credito di nessuno.
   *
   * È spesa propria, e come tale entra nelle uscite del mese: senza dirlo, un
   * pagamento di 1.920 € con un prestito da 1.030 sembrerebbe tutto prestato.
   */
  ownExpense: number;
}

/**
 * Tabella delle transazioni.
 *
 * Non decide cosa mostrare: riceve le transazioni già selezionate da chi la
 * ospita. Quando l'utente corregge un tipo o una categoria segnala la modifica,
 * così chi la ospita può ricaricare senza perdere il proprio contesto.
 */
@Component({
  selector: 'app-transactions-table',
  imports: [FormsModule, RouterLink],
  templateUrl: './transactions-table.html',
  styleUrl: './transactions-table.scss'
})
export class TransactionsTable implements OnInit {
  private readonly api = inject(TransactionsApi);
  private readonly categoriesApi = inject(CategoriesApi);
  private readonly merchantsApi = inject(MerchantsApi);

  readonly transactions = input.required<Transaction[]>();
  /** Colonna ordinata; `null` rende le intestazioni non cliccabili. */
  readonly sortBy = input<TransactionSortField | null>(null);
  readonly sortDirection = input<SortDirection>('desc');
  /**
   * I legami fra movimenti e prestiti.
   *
   * `null` nasconde del tutto la colonna: la tabella è usata anche dove i
   * prestiti non c'entrano. Un elenco vuoto invece la mostra, perché lì
   * l'azione «crea prestito» ha senso anche se nessun prestito esiste ancora.
   */
  readonly loanLinks = input<LoanLink[] | null>(null);

  /** Segnala che i dati sono cambiati e vanno ricaricati. */
  readonly changed = output<void>();
  /** Richiesta di ordinare per una colonna. */
  readonly sortSelected = output<TransactionSortField>();

  protected readonly showLoans = computed(() => this.loanLinks() !== null);

  protected readonly columns = computed(() =>
    this.showLoans() ? [...COLUMNS, LOAN_COLUMN] : COLUMNS
  );

  private readonly linksByTransaction = computed(() =>
    indexLinksByTransaction(this.loanLinks() ?? [])
  );

  /** Ciò che la colonna dei prestiti mostra per una riga. */
  protected loanCell(transaction: Transaction): LoanCell {
    const links = this.linksByTransaction().get(transaction.id) ?? [];
    const origins = links.filter((link) => link.role === 'ORIGIN');
    const lent = origins.reduce((sum, link) => sum + link.amount, 0);

    return {
      origins,
      repayments: links.filter((link) => link.role === 'REPAYMENT'),
      // Un movimento di tipo prestito resta creabile anche se un prestito
      // c'è già: lo stesso pagamento può aver anticipato denaro per più
      // persone, e il backend controlla che la somma ci stia dentro.
      creatable: transaction.type === 'LOAN',
      ownExpense:
        transaction.type === 'LOAN' && origins.length > 0
          ? Math.max(Math.abs(transaction.amount) - lent, 0)
          : 0
    };
  }

  protected readonly categories = signal<Category[]>([]);
  protected readonly error = signal<string | null>(null);
  /** Riga con una modifica in corso. */
  protected readonly savingId = signal<string | null>(null);

  protected readonly transactionTypes = TRANSACTION_TYPES;
  protected readonly typeLabels = TRANSACTION_TYPE_LABELS;
  protected readonly formatAmount = formatAmount;
  protected readonly formatBookingDate = formatBookingDate;

  /** Il valore di `aria-sort` della colonna, per chi usa uno screen reader. */
  protected ariaSort(field: TransactionSortField | null): 'ascending' | 'descending' | 'none' {
    if (field === null || this.sortBy() !== field) {
      return 'none';
    }

    return this.sortDirection() === 'asc' ? 'ascending' : 'descending';
  }

  ngOnInit(): void {
    this.categoriesApi.list().subscribe({
      next: (categories) => this.categories.set(categories),
      error: (error: unknown) => this.error.set(toErrorMessage(error))
    });
  }

  /** Corregge la natura del movimento: riguarda la singola transazione. */
  protected changeType(transaction: Transaction, type: TransactionType): void {
    if (transaction.type === type) {
      return;
    }

    this.save(transaction.id, this.api.updateType(transaction.id, type));
  }

  /**
   * Cambia la categoria del merchant: tutte le transazioni dello stesso
   * esercente la ereditano.
   */
  protected changeCategory(transaction: Transaction, selectedId: string): void {
    const merchant = transaction.merchant;
    if (merchant === null) {
      return;
    }

    const categoryId = selectedId === '' ? null : selectedId;
    if ((merchant.category?.id ?? null) === categoryId) {
      return;
    }

    this.save(transaction.id, this.merchantsApi.updateCategory(merchant.id, categoryId));
  }

  private save(transactionId: string, request: Observable<unknown>): void {
    this.savingId.set(transactionId);
    this.error.set(null);

    request.subscribe({
      next: () => {
        this.savingId.set(null);
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.savingId.set(null);
        this.changed.emit(); // ripristina lo stato mostrato a video
      }
    });
  }
}
