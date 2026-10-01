import {
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
  viewChildren
} from '@angular/core';
import { LucideDynamicIcon, LucideIconData } from '@lucide/angular';

export interface ChoiceOption<T> {
  readonly id: T;
  readonly label: string;
  /** Forma estesa, quando `label` è un'abbreviazione: alimenta `title` e il nome accessibile. */
  readonly description?: string;
  /** Icona Lucide passata come dato (es. `LucideX.icon`); si vede solo se il gruppo ha `display` diverso da `label`. */
  readonly icon?: LucideIconData;
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
  imports: [LucideDynamicIcon],
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

  /**
   * Cosa mostrare di ogni opzione: solo etichetta (default, il markup di
   * sempre), solo icona o entrambe. In `icon` l'etichetta resta come nome
   * accessibile e `title`; un'opzione senza `icon` mostra comunque il testo,
   * perché un bottone vuoto non direbbe a nessuno cosa sceglie.
   */
  readonly display = input<'label' | 'icon' | 'both'>('label');

  /** L'id su cui si è fatto clic. Che significhi "seleziona" o "inverti" lo decide il chiamante. */
  readonly selected = output<T>();

  /** Normalizza `value` in un insieme una volta sola: single e multiple si leggono allo stesso modo. */
  protected readonly active = computed<ReadonlySet<T>>(() => {
    const current = this.value();
    return new Set(Array.isArray(current) ? (current as readonly T[]) : [current as T]);
  });

  /** Almeno un'opzione è attiva: altrimenti la pillola non ha un segmento su cui stare e si nasconde. */
  protected readonly hasActive = computed(() => this.options().some((option) => this.active().has(option.id)));

  /** Vero dopo il primo posizionamento: da lì in poi la pillola può animarsi, prima deve solo comparire al suo posto. */
  protected readonly ready = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly indicator = viewChild<ElementRef<HTMLElement>>('indicator');
  private readonly segments = viewChildren<ElementRef<HTMLButtonElement>>('segment');
  private frame: number | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);

    // Dopo il rendering, così i bottoni hanno già classi e contenuto aggiornati. Con più opzioni attive
    // (modalità multipla) la pillola segue la prima: un solo indicatore non può coprirne due.
    afterRenderEffect(() => {
      this.active();
      this.options();
      this.display();
      this.segments();
      this.measure();
    });

    // Un ridimensionamento (a capo diverso, font caricato) sposta i segmenti senza toccare nessun input.
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.measure());
      observer.observe(this.host);
      destroyRef.onDestroy(() => observer.disconnect());
    }

    destroyRef.onDestroy(() => {
      if (this.frame !== null) {
        cancelAnimationFrame(this.frame);
      }
    });
  }

  /** Copia posizione e misure del bottone attivo (relative all'host) sulle variabili CSS della pillola. */
  private measure(): void {
    const indicator = this.indicator()?.nativeElement;
    const segment = this.segments()
      .map((ref) => ref.nativeElement)
      .find((button) => button.classList.contains('active'));

    if (!indicator || !segment) {
      return;
    }

    indicator.style.setProperty('--x', `${segment.offsetLeft}px`);
    indicator.style.setProperty('--y', `${segment.offsetTop}px`);
    indicator.style.setProperty('--w', `${segment.offsetWidth}px`);
    indicator.style.setProperty('--h', `${segment.offsetHeight}px`);
    indicator.style.setProperty('--pad', getComputedStyle(segment).paddingLeft);

    if (!this.ready() && this.frame === null) {
      // Un frame di attesa: la transition non deve partire dal primo posizionamento.
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.ready.set(true);
      });
    }
  }

  protected choose(id: T): void {
    if (this.mode() === 'single' && this.active().has(id)) {
      return;
    }

    this.selected.emit(id);
  }
}
