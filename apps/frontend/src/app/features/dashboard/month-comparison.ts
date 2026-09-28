import { Component, input } from '@angular/core';
import { formatAmount, formatMonth, formatPercent } from '../../core/format';
import { Panel } from '../../shared/layout/panel';
import { Amount } from '../../shared/ui/amount';
import { MonthComparison } from './dashboard.model';

@Component({
  selector: 'app-month-comparison',
  imports: [Panel, Amount],
  templateUrl: './month-comparison.html',
  styleUrl: './month-comparison.scss'
})
export class MonthComparisonSection {
  readonly comparison = input.required<MonthComparison>();

  protected readonly formatMonth = formatMonth;

  /**
   * Con il segno esplicito: una spesa in aumento è `+`.
   *
   * `difference` (e `category.difference`, e `percentChange`) è già firmata,
   * ma non passa da `<app-amount>`: quel componente stampa il segno secondo
   * il **tono** risolto, non secondo il segno del valore
   * (`shared/ui/amount.ts:85`), perché è nato per un importo di cui il tono
   * dichiara la direzione del denaro. Una variazione è un dato diverso — il
   * tono dice «buona o cattiva notizia», il segno deve continuare a dire
   * «salita o discesa» — e imporre un tono a `Amount` qui produrrebbe due
   * segni opposti per lo stesso fatto (una spesa aumentata di 100 renderebbe
   * «−100,00» accanto a un «+25%»). Il segno resta quindi legato al valore
   * grezzo, il colore alla classe invertita `.up`/`.down` qui sotto.
   */
  protected signed(amount: number): string {
    return `${amount > 0 ? '+' : ''}${formatAmount(amount)}`;
  }

  protected signedPercent(value: number): string {
    return `${value > 0 ? '+' : ''}${formatPercent(value)}`;
  }
}
