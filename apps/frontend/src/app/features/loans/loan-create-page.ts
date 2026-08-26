import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { parseAmount } from '../../core/amount';
import { formatAmount, formatBookingDate } from '../../core/format';
import { toErrorMessage } from '../../core/http-error';
import { Transaction } from '../transactions/transaction.model';
import { TRANSACTION_TYPE_LABELS } from '../transactions/transaction-type';
import { TransactionsApi } from '../transactions/transactions.api';
import { LoanFormErrors, LoanFormValue, validateLoanForm } from './loan-form';
import { LoansApi } from './loans.api';

/**
 * Creazione di un prestito a partire da un movimento.
 *
 * L'indirizzo porta con sé il movimento d'origine (`/loans/new?transactionId=…`):
 * la pagina è quindi un deep-link vero, ricaricabile e condivisibile, e non uno
 * stato nascosto passato dall'elenco dei movimenti.
 *
 * Un prestito non nasce mai da un import: qui c'è l'unico punto in cui viene
 * creato, perché è l'unico momento in cui si sa chi ha ricevuto il denaro.
 */
@Component({
  selector: 'app-loan-create-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './loan-create-page.html',
  styleUrl: './loan-detail-page.scss'
})
export class LoanCreatePage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(LoansApi);
  private readonly transactionsApi = inject(TransactionsApi);

  protected readonly transaction = signal<Transaction | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly errors = signal<LoanFormErrors>({});

  protected readonly form = signal<LoanFormValue>({
    borrowerName: '',
    description: '',
    amount: '',
    lentAt: ''
  });

  protected readonly typeLabels = TRANSACTION_TYPE_LABELS;
  protected readonly formatAmount = formatAmount;
  protected readonly formatBookingDate = formatBookingDate;

  /**
   * Il movimento indicato dall'indirizzo.
   *
   * Letto una volta: si entra in questa pagina navigando, quindi il componente
   * è nuovo ad ogni movimento diverso. Non è un segnale perché non cambia.
   */
  private readonly transactionId = this.route.snapshot.queryParamMap.get('transactionId') ?? '';

  /** Quanto del movimento è già attribuito ad altri prestiti. */
  protected readonly alreadyLent = signal(0);

  /**
   * Quanto resta da attribuire su questo movimento.
   *
   * È il tetto del nuovo prestito: lo stesso pagamento può aver anticipato
   * denaro per più persone, ma non più di quanto è uscito dal conto.
   */
  protected readonly maxAmount = computed(() => {
    const transaction = this.transaction();

    return transaction === null
      ? undefined
      : Math.abs(transaction.amount) - this.alreadyLent();
  });

  /**
   * Quanto del movimento resterebbe spesa propria con l'importo digitato.
   *
   * È la conseguenza che conta e che non si vede da nessun'altra parte: quella
   * quota entra nelle uscite del mese e nella categoria del movimento.
   */
  protected readonly ownExpense = computed(() => {
    const transaction = this.transaction();
    if (transaction === null) {
      return null;
    }

    const amount = parseAmount(this.form().amount);
    if (amount === null || amount <= 0) {
      return null;
    }

    const rest = Math.abs(transaction.amount) - this.alreadyLent() - amount;

    return rest > 0 ? rest : 0;
  });

  /** Un movimento che non è un prestito non può originarne uno. */
  protected readonly wrongType = computed(() => {
    const transaction = this.transaction();

    return transaction !== null && transaction.type !== 'LOAN';
  });

  ngOnInit(): void {
    const id = this.transactionId;
    if (id === '') {
      this.error.set('Manca il movimento da cui creare il prestito.');
      this.loading.set(false);
      return;
    }

    this.transactionsApi.get(id).subscribe({
      next: (transaction) => {
        this.transaction.set(transaction);
        this.loading.set(false);
        this.loadAlreadyLent(transaction);
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.loading.set(false);
      }
    });
  }

  /**
   * Quanto del movimento è già stato attribuito, e quindi quanto resta.
   *
   * L'importo viene precompilato con la capienza rimasta: nel caso normale —
   * nessun prestito ancora registrato — è l'intero movimento, che è già la
   * risposta giusta. Resta comunque correggibile: è la scelta di quanto è stato
   * prestato davvero.
   */
  private loadAlreadyLent(transaction: Transaction): void {
    const prefill = (lent: number): void => {
      this.alreadyLent.set(lent);
      this.form.set({
        borrowerName: '',
        description: '',
        amount: Math.max(Math.abs(transaction.amount) - lent, 0).toFixed(2),
        lentAt: transaction.bookingDate
      });
    };

    prefill(0);

    this.api.links().subscribe({
      next: ({ links }) =>
        prefill(
          links
            .filter((link) => link.transactionId === transaction.id && link.role === 'ORIGIN')
            .reduce((sum, link) => sum + link.amount, 0)
        ),
      // Senza l'indice si resta sulla capienza intera: il backend rifiuta comunque
      // un importo che non ci sta.
      error: () => prefill(0)
    });
  }

  protected update(field: keyof LoanFormValue, value: string): void {
    this.form.update((form) => ({ ...form, [field]: value }));
  }

  protected save(): void {
    const result = validateLoanForm(this.form(), this.maxAmount());
    if (!result.valid) {
      this.errors.set(result.errors);
      return;
    }

    this.errors.set({});
    this.saving.set(true);
    this.error.set(null);

    this.api.create({ ...result.loan, transactionId: this.transactionId }).subscribe({
      next: (loan) => {
        this.saving.set(false);
        void this.router.navigate(['/loans', loan.id]);
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.saving.set(false);
      }
    });
  }
}
