import { httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { formatAmount, formatBookingDate } from '../../core/format';
import { toErrorMessage } from '../../core/http-error';
import { EMPTY_QUERY } from '../transactions/transaction-query';
import { Transaction } from '../transactions/transaction.model';
import { TRANSACTION_TYPE_LABELS } from '../transactions/transaction-type';
import { TransactionsApi } from '../transactions/transactions.api';
import {
  LoanFormErrors,
  LoanFormValue,
  RepaymentFormErrors,
  RepaymentFormValue,
  validateLoanForm,
  validateRepaymentForm
} from './loan-form';
import { LOAN_STATUS_LABELS, LoanDetail } from './loan.model';
import { LoansApi, loanRequest } from './loans.api';

/** Il giorno corrente in formato `YYYY-MM-DD`: la data più probabile per una restituzione. */
function today(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');

  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const EMPTY_REPAYMENT: RepaymentFormValue = {
  amount: '',
  repaymentDate: '',
  note: '',
  transactionId: ''
};

/**
 * Quanti movimenti in entrata proporre come collegamento.
 *
 * Un elenco più lungo di così non si scorre: se il bonifico giusto non c'è, si
 * registra la restituzione e si collega dopo.
 */
const CANDIDATE_PAGE_SIZE = 100;

/**
 * Dettaglio di un prestito.
 *
 * Il credito residuo non viene mai calcolato qui: ogni operazione restituisce
 * il prestito ricalcolato dal backend, che è l'unico a sapere quanto resta.
 * Così ciò che si vede dopo aver registrato una restituzione è già la verità,
 * non una stima locale in attesa di conferma.
 */
@Component({
  selector: 'app-loan-detail-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './loan-detail-page.html',
  styleUrl: './loan-detail-page.scss'
})
export class LoanDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(LoansApi);
  private readonly transactionsApi = inject(TransactionsApi);

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap
  });

  protected readonly loanId = computed(() => this.params().get('id') ?? '');

  protected readonly loan = httpResource<LoanDetail>(() => loanRequest(this.loanId()));

  protected readonly data = computed<LoanDetail | undefined>(() =>
    this.loan.hasValue() ? this.loan.value() : undefined
  );

  protected readonly loadError = computed(() => {
    const error = this.loan.error();

    return error === undefined ? null : toErrorMessage(error);
  });

  /** Errore di un'operazione, distinto da quello del caricamento. */
  protected readonly actionError = signal<string | null>(null);
  protected readonly saving = signal(false);

  /** Il modulo della restituzione è chiuso finché non serve. */
  protected readonly addingRepayment = signal(false);
  protected readonly repaymentForm = signal<RepaymentFormValue>(EMPTY_REPAYMENT);
  protected readonly repaymentErrors = signal<RepaymentFormErrors>({});
  /** I movimenti in entrata a cui la restituzione può essere collegata. */
  protected readonly repaymentCandidates = signal<Transaction[]>([]);

  protected readonly editing = signal(false);
  protected readonly loanForm = signal<LoanFormValue>({
    borrowerName: '',
    description: '',
    amount: '',
    lentAt: ''
  });
  protected readonly loanErrors = signal<LoanFormErrors>({});

  /** L'eliminazione chiede una conferma sul posto, senza finestre di sistema. */
  protected readonly confirmingDelete = signal(false);

  protected readonly statusLabels = LOAN_STATUS_LABELS;
  protected readonly typeLabels = TRANSACTION_TYPE_LABELS;
  protected readonly formatAmount = formatAmount;
  protected readonly formatBookingDate = formatBookingDate;

  /** Quanto del movimento d'origine è credito: la barra della ripartizione. */
  protected readonly lentPercent = computed(() => {
    const split = this.data()?.originSplit;
    if (split === undefined || split === null || split.amount === 0) {
      return 0;
    }

    return Math.min(Math.round((split.lent / split.amount) * 100), 100);
  });

  /** Quanto è stato restituito, in quota sul prestato: la barra del residuo. */
  protected readonly repaidPercent = computed(() => {
    const loan = this.data();
    if (loan === undefined || loan.amount === 0) {
      return 0;
    }

    return Math.min(Math.round((loan.repaidAmount / loan.amount) * 100), 100);
  });

  protected openRepayment(): void {
    const loan = this.data();

    this.repaymentForm.set({
      ...EMPTY_REPAYMENT,
      // Il residuo è la restituzione più probabile: chiude il prestito.
      amount: loan === undefined ? '' : loan.remainingAmount.toFixed(2),
      repaymentDate: today()
    });
    this.repaymentErrors.set({});
    this.addingRepayment.set(true);

    if (loan !== undefined) {
      this.loadCandidates(loan.lentAt);
    }
  }

  /**
   * I movimenti in entrata a partire dalla data del prestito.
   *
   * Il denaro può tornare solo dopo essere uscito, quindi non serve guardare
   * prima. Il collegamento si sceglie da un elenco con date e importi: un
   * identificativo da incollare non direbbe nulla a nessuno.
   */
  private loadCandidates(from: string): void {
    this.transactionsApi
      .search({ ...EMPTY_QUERY, from, pageSize: CANDIDATE_PAGE_SIZE })
      .subscribe({
        next: (page) =>
          this.repaymentCandidates.set(page.items.filter((item) => item.amount > 0)),
        error: () => this.repaymentCandidates.set([])
      });
  }

  protected closeRepayment(): void {
    this.addingRepayment.set(false);
    this.repaymentErrors.set({});
  }

  protected updateRepaymentField(field: keyof RepaymentFormValue, value: string): void {
    this.repaymentForm.update((form) => ({ ...form, [field]: value }));
  }

  protected saveRepayment(): void {
    const loan = this.data();
    if (loan === undefined) {
      return;
    }

    const result = validateRepaymentForm(this.repaymentForm(), loan.remainingAmount);
    if (!result.valid) {
      this.repaymentErrors.set(result.errors);
      return;
    }

    this.repaymentErrors.set({});
    this.run(this.api.addRepayment(loan.id, result.repayment), () =>
      this.addingRepayment.set(false)
    );
  }

  protected removeRepayment(repaymentId: string): void {
    this.run(this.api.removeRepayment(this.loanId(), repaymentId));
  }

  protected openEdit(): void {
    const loan = this.data();
    if (loan === undefined) {
      return;
    }

    this.loanForm.set({
      borrowerName: loan.borrowerName,
      description: loan.description ?? '',
      amount: loan.amount.toFixed(2),
      lentAt: loan.lentAt
    });
    this.loanErrors.set({});
    this.editing.set(true);
  }

  protected closeEdit(): void {
    this.editing.set(false);
    this.loanErrors.set({});
  }

  protected updateLoanField(field: keyof LoanFormValue, value: string): void {
    this.loanForm.update((form) => ({ ...form, [field]: value }));
  }

  protected saveLoan(): void {
    const loan = this.data();
    if (loan === undefined) {
      return;
    }

    const result = validateLoanForm(this.loanForm());
    if (!result.valid) {
      this.loanErrors.set(result.errors);
      return;
    }

    this.loanErrors.set({});
    this.run(this.api.update(loan.id, result.loan), () => this.editing.set(false));
  }

  protected deleteLoan(): void {
    this.saving.set(true);
    this.actionError.set(null);

    this.api.remove(this.loanId()).subscribe({
      next: () => {
        this.saving.set(false);
        void this.router.navigate(['/loans']);
      },
      error: (error: unknown) => {
        this.actionError.set(toErrorMessage(error));
        this.saving.set(false);
        this.confirmingDelete.set(false);
      }
    });
  }

  /**
   * Esegue un'operazione e adotta il prestito che il backend restituisce.
   *
   * Non c'è un secondo giro di richieste: la risposta è già il dettaglio
   * ricalcolato, residuo e stato compresi.
   */
  private run(request: Observable<LoanDetail>, onSuccess?: () => void): void {
    this.saving.set(true);
    this.actionError.set(null);

    request.subscribe({
      next: (loan) => {
        this.loan.set(loan);
        this.saving.set(false);
        onSuccess?.();
      },
      error: (error: unknown) => {
        this.actionError.set(toErrorMessage(error));
        this.saving.set(false);
      }
    });
  }
}
