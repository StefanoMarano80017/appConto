import { DestroyRef, Directive, ElementRef, afterNextRender, inject, signal } from '@angular/core';

/**
 * Testo che tronca invece di allargare ciò che lo contiene.
 *
 * Il dato resta intero: a tagliare è il CSS — la classe `.truncate` di
 * `styles.scss`, che la direttiva applica da sé — e il tooltip nativo
 * restituisce ciò che l'ellissi nasconde.
 *
 * Il tooltip compare **solo** dove il testo è davvero tagliato: un `title`
 * sempre presente ripeterebbe ciò che si legge già, e su venticinque righe
 * sarebbe rumore a ogni passaggio del puntatore.
 *
 * Il testo completo non va passato: è quello che l'elemento già mostra.
 *
 * ```html
 * <td class="description" appTruncate>{{ transaction.description }}</td>
 * ```
 *
 * Quanto larga possa essere la colonna non lo decide la direttiva: è layout, e
 * resta nel foglio di stile di chi la usa — un `max-width` sulla cella.
 */
@Directive({
  selector: '[appTruncate]',
  host: {
    class: 'truncate',
    '[attr.title]': 'tooltip()',
    '(mouseenter)': 'measure()'
  }
})
export class Truncate {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  /** Il testo intero quando una parte è nascosta; `null` toglie l'attributo. */
  protected readonly tooltip = signal<string | null>(null);

  constructor() {
    // Misurare prima che il browser abbia impaginato non direbbe niente:
    // `scrollWidth` e `clientWidth` sarebbero entrambi zero.
    afterNextRender(() => this.observe());
  }

  /**
   * Rimisura quando cambia lo spazio disponibile.
   *
   * La stessa cella tronca o non tronca secondo la larghezza che le tocca, e
   * quella cambia senza che i dati cambino: finestra ridimensionata, colonne
   * che si ridistribuiscono, tabella che finisce nello scorrimento
   * orizzontale. Anche la prima misura arriva da qui, perché `observe`
   * richiama subito con la dimensione attuale.
   */
  private observe(): void {
    if (typeof ResizeObserver === 'undefined') {
      this.measure();
      return;
    }

    const observer = new ResizeObserver(() => this.measure());
    observer.observe(this.element.nativeElement);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  /**
   * Confronta il testo con lo spazio che ha.
   *
   * Anche all'arrivo del puntatore, non solo quando l'elemento cambia
   * dimensione: un contenuto nuovo a parità di larghezza — la stessa riga che
   * mostra un altro movimento — non sveglierebbe il `ResizeObserver`, e il
   * tooltip resterebbe quello di prima proprio nell'istante in cui serve.
   */
  protected measure(): void {
    const element = this.element.nativeElement;
    // Un pixel di tolleranza: gli arrotondamenti sub-pixel del browser
    // farebbero comparire il tooltip su testi che si leggono per intero.
    const truncated = element.scrollWidth - element.clientWidth > 1;

    this.tooltip.set(truncated ? readableText(element) : null);
  }
}

/** Il testo come lo si legge: gli spazi del template non sono contenuto. */
function readableText(element: HTMLElement): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}
