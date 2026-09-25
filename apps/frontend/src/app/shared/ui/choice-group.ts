import { Component, computed, input, output } from '@angular/core';

export interface ChoiceOption<T> {
  readonly id: T;
  readonly label: string;
  /** Forma estesa, quando `label` è un'abbreviazione: alimenta `title` e il nome accessibile. */
  readonly description?: string;
}

/**
 * Un blocco unico di scelte: bordo e angoli attorno a tutti i segmenti, con
 * una pillola incassata su quello attivo.
 *
 * **Quando usarlo, e quando usare `ToggleButtonGroup`.** La forma dice il
 * significato, ed è l'unica regola da ricordare: un blocco saldato comunica
 * «scegline una», pillole separate comunicano «scegline quante vuoi». Qui
 * stanno periodo, classificazione e granularità; i filtri per tipo, categoria
 * e merchant restano pillole.
 *
 * Questa distinzione è stata imparata provando. I due componenti erano nati
 * separati perché «il contratto di value/evento cambia forma, non solo
 * comportamento» (docs/architecture/frontend-shared-components-proposal.md,
 * §16.2); li abbiamo uniti in questo, perché quel motivo non regge più — ogni
 * store di filtro lavora un id alla volta, quindi un solo componente può
 * accettare entrambe le forme di `value` senza che nessun chiamante avvolga o
 * spacchetti array. Poi, guardando il risultato a schermo, è emerso che la
 * ragione della separazione era un'altra e nessuno l'aveva scritta: non il
 * tipo, la grammatica visiva. Un blocco saldato che permette due selezioni
 * insieme si legge come un errore.
 *
 * Resta quindi capace di entrambe le cardinalità (`mode`), ma oggi nessun
 * punto di chiamata usa quella multipla: se non ne comparirà uno, questo
 * componente può semplificarsi accettando solo un id.
 */
@Component({
  selector: 'app-choice-group',
  templateUrl: './choice-group.html',
  styleUrl: './choice-group.scss',
  host: {
    role: 'group',
    '[attr.aria-label]': 'ariaLabel()'
  }
})
export class ChoiceGroup<T> {
  readonly options = input.required<readonly ChoiceOption<T>[]>();
  /** Un id in modalità esclusiva, l'elenco degli id attivi in quella multipla. */
  readonly value = input.required<T | readonly T[]>();

  /**
   * Esclusiva o multipla. Cambia una cosa sola, ma reale: in `single` un clic
   * sull'opzione già attiva non emette niente.
   *
   * In un gruppo esclusivo qualcosa è sempre selezionato, quindi "togliere la
   * selezione" non è un'operazione che esiste: riemettere lo stesso id
   * farebbe riscrivere allo store un valore identico — per il periodo,
   * ricalcolare l'intervallo e rilanciare la richiesta di rete per niente. In
   * `multiple` invece il clic su un'opzione attiva significa "toglila" ed è
   * l'unico modo di deselezionarla, quindi deve emettere.
   *
   * Non cambia il markup: bottoni con `aria-pressed` in entrambi i casi, mai
   * `role="radiogroup"` — quel ruolo obbligherebbe alla navigazione con le
   * frecce, e dichiararlo senza implementarla peggiora l'esperienza di chi usa
   * uno screen reader invece di migliorarla.
   */
  readonly mode = input<'single' | 'multiple'>('single');

  readonly ariaLabel = input.required<string>();

  /** L'id su cui si è fatto clic. Che significhi "seleziona" o "inverti" lo decide il chiamante. */
  readonly selected = output<T>();

  /** Normalizza `value` in un insieme una volta sola: single e multiple si leggono allo stesso modo. */
  protected readonly active = computed<ReadonlySet<T>>(() => {
    const current = this.value();
    return new Set(Array.isArray(current) ? (current as readonly T[]) : [current as T]);
  });

  protected choose(id: T): void {
    if (this.mode() === 'single' && this.active().has(id)) {
      return;
    }

    this.selected.emit(id);
  }
}
