import { Component, input } from '@angular/core';
import { formatAmount, formatMonth, signedPercent, typographicMinus } from '../../core/format';
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
   *
   * `typographicMinus` per lo stesso motivo per cui lo usa `Amount`: le due
   * cifre accanto a questa (spese del mese, mese precedente) passano di lì e
   * mostrano U+2212. Senza, la fascia porterebbe due glifi di meno diversi a
   * tre centimetri l'uno dall'altro — un difetto che non esisteva prima,
   * perché prima tutta la fascia passava da `formatAmount` e sbagliava
   * uniformemente.
   */
  protected signed(amount: number): string {
    return `${amount > 0 ? '+' : ''}${typographicMinus(formatAmount(amount))}`;
  }

  /**
   * Stessa convenzione di segno di `signed()`: sta fra parentesi accanto a
   * lei. Esposta al template, non reimplementata — v. `core/format.ts`.
   */
  protected readonly signedPercent = signedPercent;
}
