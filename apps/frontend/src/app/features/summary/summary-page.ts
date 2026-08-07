import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { currentMonth, formatAmount, formatMonth } from '../../core/format';
import { toErrorMessage } from '../../core/http-error';
import { CashFlowCard } from '../cash-flow/cash-flow-card';
import { TransactionsPage } from '../transactions/transactions-page';
import { Summary } from './summary.model';
import { SummaryApi } from './summary.api';

/** Larghezza minima della barra, perché anche un importo piccolo resti visibile. */
const MIN_BAR_WIDTH = 2;

@Component({
  selector: 'app-summary-page',
  imports: [CashFlowCard, TransactionsPage],
  templateUrl: './summary-page.html',
  styleUrl: './summary-page.scss'
})
export class SummaryPage implements OnInit {
  private readonly api = inject(SummaryApi);

  /** Unico stato del mese: la card della liquidità lo riceve come input. */
  readonly month = signal(currentMonth());
  protected readonly summary = signal<Summary | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  /** L'importo più alto del mese: è il riferimento per la lunghezza delle barre. */
  private readonly maxAmount = computed(() => {
    const data = this.summary();
    if (data === null) {
      return 0;
    }

    return Math.max(
      data.uncategorized.amount,
      ...data.amountByCategory.map((category) => category.amount)
    );
  });

  protected readonly formatAmount = formatAmount;
  protected readonly formatMonth = formatMonth;

  ngOnInit(): void {
    this.load();
  }

  protected onMonthChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value === '') {
      return;
    }

    this.month.set(value);
    this.load();
  }

  protected barWidth(amount: number): number {
    const max = this.maxAmount();
    if (max <= 0) {
      return 0;
    }

    return Math.max(MIN_BAR_WIDTH, (amount / max) * 100);
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.get(this.month()).subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.summary.set(null);
        this.loading.set(false);
      }
    });
  }
}
