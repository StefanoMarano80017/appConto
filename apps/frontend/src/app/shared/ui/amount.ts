import { Component, computed, input } from '@angular/core';
import { formatAmount } from '../../core/format';

/** Il tono: `auto` lo deduce dal segno del valore. */
export type AmountTone = 'auto' | 'neutral' | 'positive' | 'negative';

/**
 * Un valore finanziario.
 *
 * Esiste per due regole del design system che nessun token può far
 * rispettare, perché riguardano il modo di rendere un valore e non un colore:
 *
 * - §4: ogni importo usa la famiglia mono con `tabular-nums`, così le cifre
 *   restano allineate in colonna;
 * - §5: entrata e uscita non si distinguono MAI dal solo colore, quindi il
 *   segno è sempre esplicito.
 *
 * Il segno lo scriviamo noi sul valore assoluto invece di lasciarlo a `Intl`:
 * serve il più sulle entrate, che `Intl` non mette, e serve un solo carattere
 * di meno anziché due quando il tono è negativo.
 *
 * Lo stile sta sull'host e non su uno `<span>` interno: chi la usa applica le
 * proprie classi direttamente sul tag (`<app-amount class="value">`), e con un
 * elemento interno quelle classi non governerebbero nulla.
 */
@Component({
  selector: 'app-amount',
  templateUrl: './amount.html',
  styleUrl: './amount.scss',
  host: {
    '[class.positive]': "resolvedTone() === 'positive'",
    '[class.negative]': "resolvedTone() === 'negative'",
    '[class.neutral]': "resolvedTone() === 'neutral'",
    '[class.kpi]': "size() === 'kpi'",
    '[class.row]': "size() === 'row'"
  }
})
export class Amount {
  readonly value = input.required<number>();
  readonly tone = input<AmountTone>('auto');
  readonly size = input<'row' | 'kpi'>('row');

  /**
   * Il tono effettivo.
   *
   * Uno zero resta neutro anche con un tono imposto dall'esterno: non è né
   * un'entrata né un'uscita, e «−0,00 €» su un residuo azzerato sarebbe
   * un'affermazione falsa quanto «+0,00 €».
   */
  protected readonly resolvedTone = computed<Exclude<AmountTone, 'auto'>>(() => {
    const value = this.value();

    if (value === 0) {
      return 'neutral';
    }

    const tone = this.tone();
    if (tone !== 'auto') {
      return tone;
    }

    return value > 0 ? 'positive' : 'negative';
  });

  protected readonly text = computed(() => {
    const tone = this.resolvedTone();
    const value = this.value();

    if (tone === 'neutral') {
      // `Intl` usa il trattino ASCII e segna anche lo zero negativo (`-0,00
      // €`): normalizziamo entrambi, o in colonna il suo meno non si allinea
      // col nostro U+2212.
      return formatAmount(value === 0 ? 0 : value).replace('-', '−');
    }

    // Il segno segue il tono risolto, non il segno grezzo di value: un tono
    // imposto dall'esterno deve poter ribaltare il segno mostrato.
    // U+2212 MINUS SIGN: è il meno tipografico, non il trattino.
    return `${tone === 'negative' ? '−' : '+'}${formatAmount(Math.abs(value))}`;
  });
}
