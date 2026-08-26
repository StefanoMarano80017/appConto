import { Component, input } from '@angular/core';
import { formatAmount, formatMonth, formatPercent } from '../../core/format';
import { MonthComparison } from './dashboard.model';

@Component({
  selector: 'app-month-comparison',
  templateUrl: './month-comparison.html',
  styleUrl: './month-comparison.scss'
})
export class MonthComparisonSection {
  readonly comparison = input.required<MonthComparison>();

  protected readonly formatAmount = formatAmount;
  protected readonly formatMonth = formatMonth;

  /** Con il segno esplicito: una spesa in aumento è `+`. */
  protected signed(amount: number): string {
    return `${amount > 0 ? '+' : ''}${formatAmount(amount)}`;
  }

  protected signedPercent(value: number): string {
    return `${value > 0 ? '+' : ''}${formatPercent(value)}`;
  }
}
