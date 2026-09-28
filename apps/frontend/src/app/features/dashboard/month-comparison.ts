import { Component, computed, input } from '@angular/core';
import { formatMonth } from '../../core/format';
import { Panel } from '../../shared/layout/panel';
import { Amount, AmountTone } from '../../shared/ui/amount';
import { StatCardGrid, StatCardItem } from '../../shared/layout/stat-card-grid';
import { MonthComparison } from './dashboard.model';

@Component({
  selector: 'app-month-comparison',
  imports: [Panel, Amount, StatCardGrid],
  templateUrl: './month-comparison.html',
  styleUrl: './month-comparison.scss'
})
export class MonthComparisonSection {
  readonly comparison = input.required<MonthComparison>();

  protected readonly formatMonth = formatMonth;

  /**
   * Le tre card della fascia superiore, come `summaryCards` in
   * dashboard-page.ts: `currentExpenses`/`previousExpenses` sono magnitudini
   * di spesa (si negano, il tono resta `auto`), `difference` è già firmata ma
   * il segno dice «la spesa è salita o scesa», non «denaro entrato o
   * uscito» — stesso `expensesDelta` di dashboard-page.ts, qui applicato
   * anche al valore principale della card e non solo al chip.
   */
  protected readonly totals = computed<StatCardItem[]>(() => {
    const { currentExpenses, previousExpenses, difference, percentChange, previousMonth } =
      this.comparison();

    return [
      { kind: 'amount', label: 'Spese del mese', value: -currentExpenses, icon: 'uscite' },
      { kind: 'amount', label: 'Mese precedente', value: -previousExpenses, icon: 'uscite' },
      {
        kind: 'amount',
        label: 'Variazione',
        value: difference,
        tone: this.varianceTone(difference),
        delta:
          percentChange === null
            ? undefined
            : {
                percent: percentChange,
                caption: `vs ${this.formatMonth(previousMonth)}`,
                tone: this.varianceTone(percentChange)
              }
      }
    ];
  });

  /**
   * `difference` (e `category.difference`, e `percentChange`) è già firmata,
   * ma il segno dice «la spesa è salita o scesa», non «denaro entrato o
   * uscito»: una variazione positiva è una spesa aumentata, cioè una cattiva
   * notizia, e prende il tono delle uscite. Un tono `auto` leggerebbe invece
   * il segno grezzo e mostrerebbe verde proprio quando si è speso di più —
   * lo stesso errore, per la quarta volta su questo lavoro, di dedurre la
   * semantica finanziaria da un segno invece che dal significato del campo.
   */
  protected varianceTone(value: number): Exclude<AmountTone, 'auto'> {
    return value > 0 ? 'negative' : value < 0 ? 'positive' : 'neutral';
  }
}
