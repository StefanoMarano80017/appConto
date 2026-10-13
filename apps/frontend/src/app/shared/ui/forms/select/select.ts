import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  forwardRef,
  inject,
  Injector,
  input,
  linkedSignal,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { LucideCheck, LucideChevronDown, LucideDynamicIcon, LucideSearch } from '@lucide/angular';
import { ColorMarkerComponent } from '@shared/ui/data/color-marker/color-marker';
import { SelectOption } from './select.model';
import { matchOptions, placeholderItem, SelectItem, typeAheadIndex } from './select-items';
import { panelPlacement } from './select-position';

/** Contatore di modulo: rende univoci gli id di listbox e voci fra le istanze. */
let nextId = 0;

/** Oltre questo numero di opzioni `searchable: 'auto'` mostra la ricerca. */
const SEARCH_THRESHOLD = 8;
/** I controlli che prendono il fuoco da soli al click: un click fuori su di loro non riporta il fuoco al trigger. */
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex], [contenteditable]';

/**
 * Select a scelta singola con pannello proprio (pattern "select-only
 * combobox" della WAI-ARIA APG): sostituisce il `<select>` nativo, che non
 * segue il design system e non ha una ricerca.
 *
 * Il pannello è `position: fixed` e si posiziona dal `getBoundingClientRect()`
 * del trigger: così sfugge agli `overflow` delle celle di tabella e delle
 * card senza Angular CDK. Scelto al posto di `popover="manual"` (top layer)
 * perché jsdom non lo supporta e `fixed` + `z-index` basta finché il
 * pannello non sta dentro un antenato con `transform`: un antenato
 * trasformato (o con una animation su `transform` ancora in effetto)
 * sposterebbe il pannello. Per questo `route-content-enter` usa fill-mode
 * `backwards`: con `both`/`forwards` la pagina resterebbe containing block.
 *
 * Funziona con `[(value)]` e, tramite `ControlValueAccessor`, con `ngModel`.
 */
@Component({
  selector: 'app-select',
  imports: [ColorMarkerComponent, LucideCheck, LucideChevronDown, LucideDynamicIcon, LucideSearch, NgTemplateOutlet],
  templateUrl: './select.html',
  styleUrl: './select.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => Select), multi: true }],
  host: {
    '[class.field]': "appearance() === 'field'",
  },
})
export class Select<T extends string = string> implements ControlValueAccessor {
  readonly options = input.required<readonly SelectOption<T>[]>();
  readonly value = model<T | null>(null);
  readonly appearance = input<'inline' | 'field'>('inline');
  /** Voce vuota selezionabile (es. "Tutti", "— Nessuna categoria"); `null` = nessuna voce vuota. */
  readonly placeholder = input<string | null>(null);
  /** In cima quando la voce vuota vale "Tutti", in fondo quando vale "Nessuna categoria". */
  readonly placeholderPosition = input<'start' | 'end'>('start');
  /** Obbligatorio se il select non sta dentro un `<label>`. */
  readonly ariaLabel = input<string | null>(null);
  /** Inoltrati al trigger: la pagina scrive i propri attributi (proposal §16.3). */
  readonly ariaInvalid = input(false);
  readonly ariaDescribedBy = input<string | null>(null);
  readonly triggerId = input<string | null>(null);
  /** `'auto'` = ricerca solo con più di 8 opzioni. */
  readonly searchable = input<boolean | 'auto'>('auto');
  readonly searchPlaceholder = input('Cerca…');
  readonly emptyText = input('Nessun risultato');
  readonly disabled = input(false);
  /** Solo lettura: mostra il valore come testo, senza chevron né pannello. */
  readonly readonly = input(false);

  /**
   * Il valore mostrato. Segue `value`, ma `writeValue` (ngModel) lo scrive
   * direttamente: impostare il `model` emetterebbe `valueChange`, e il CVA non
   * deve emettere.
   */
  protected readonly selectedId = linkedSignal<T | null>(() => this.value());
  /** Il `disabled` impostato dal form, in OR con l'input. */
  private readonly formDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.formDisabled());

  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly activeIndex = signal(0);
  /** Vero dopo una scelta: nasconde il focus ring del trigger fino al blur. */
  protected readonly selectionMade = signal(false);

  private readonly baseId = `app-select-${nextId++}`;
  protected readonly listboxId = `${this.baseId}-listbox`;
  protected readonly searchId = `${this.baseId}-search`;
  /** Il trigger ha sempre un id: listbox e ricerca ne prendono il nome con `aria-labelledby`. */
  protected readonly buttonId = computed(() => this.triggerId() ?? `${this.baseId}-trigger`);

  protected readonly selected = computed(
    () => this.options().find((option) => option.id === this.selectedId()) ?? null,
  );

  protected readonly searchEnabled = computed(() => {
    const searchable = this.searchable();
    return searchable === 'auto' ? this.options().length > SEARCH_THRESHOLD : searchable;
  });

  /** Le opzioni che corrispondono alla ricerca, con i segmenti per `<mark>`. */
  protected readonly matches = computed(() =>
    matchOptions(this.options(), this.searchEnabled() ? this.query() : ''),
  );

  /** La voce vuota: sempre visibile, anche filtrando. */
  protected readonly placeholderItem = computed(() => placeholderItem<T>(this.placeholder()));

  /** Le voci nell'ordine del pannello: è l'indice qui dentro che `activeIndex` usa. */
  protected readonly items = computed<readonly SelectItem<T>[]>(() => {
    const empty = this.placeholderItem();
    if (!empty) {
      return this.matches();
    }
    return this.placeholderPosition() === 'start' ? [empty, ...this.matches()] : [...this.matches(), empty];
  });

  /** Indice della prima opzione in `items` (dopo la voce vuota, se sta in cima); lo usa anche il template per numerare le righe. */
  protected readonly matchOffset = computed(() =>
    this.placeholderItem() && this.placeholderPosition() === 'start' ? 1 : 0,
  );

  protected readonly activeId = computed(() =>
    this.open() && this.items()[this.activeIndex()] ? this.optionId(this.activeIndex()) : null,
  );

  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  private onChange: (value: T | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  /**
   * Un `pointerdown` fuori dall'host (anche sul trigger di un altro select)
   * chiude il pannello. Se il fuoco era nella ricerca, sparirebbe con il
   * pannello e finirebbe su `<body>`: torna al trigger, a meno che il click
   * non cada su un controllo che il fuoco lo prende da sé.
   */
  private readonly closeOnOutside = (event: Event): void => {
    const target = event.target as Node;
    if (this.host.contains(target)) {
      return;
    }
    const focusInPanel = this.panel()?.nativeElement.contains(document.activeElement) ?? false;
    this.close();
    if (focusInPanel && !(target instanceof Element && target.closest(FOCUSABLE))) {
      // Dopo il `mousedown`, che altrimenti sposterebbe di nuovo il fuoco su `<body>`.
      setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) {
          this.focusTrigger();
        }
      });
    }
  };
  /** Lo scroll della lista dentro il pannello non lo sposta: conta solo quello della pagina. */
  private readonly reposition = (event: Event): void => {
    if (event.target instanceof Node && this.panel()?.nativeElement.contains(event.target)) {
      return;
    }
    this.position();
  };

  constructor() {
    // I listener globali vivono esattamente quanto il pannello aperto: li toglie il cleanup, anche alla distruzione.
    effect((onCleanup) => {
      if (!this.open()) {
        return;
      }
      document.addEventListener('pointerdown', this.closeOnOutside, true);
      window.addEventListener('scroll', this.reposition, true);
      window.addEventListener('resize', this.reposition);
      onCleanup(() => {
        document.removeEventListener('pointerdown', this.closeOnOutside, true);
        window.removeEventListener('scroll', this.reposition, true);
        window.removeEventListener('resize', this.reposition);
      });
    });

    // Un select disabilitato o reso readonly a pannello aperto non deve restare aperto.
    effect(() => {
      if (this.isDisabled() || this.readonly()) {
        untracked(() => this.close());
      }
    });
  }

  protected optionId(index: number): string {
    return `${this.baseId}-option-${index}`;
  }

  protected toggle(): void {
    if (this.open()) {
      this.close();
    } else {
      this.openPanel();
    }
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    if (this.open()) {
      this.onPanelKeydown(event);
      return;
    }
    // Invio e Spazio sono gestiti qui (non dal click nativo) per aprire in modo uniforme anche in jsdom.
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      this.openPanel();
    }
  }

  protected onTriggerBlur(): void {
    this.selectionMade.set(false);
    this.onTouched();
  }

  /** Tastiera a pannello aperto: arriva dal trigger (senza ricerca) o dall'input di ricerca. */
  protected onPanelKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.moveTo(this.activeIndex() + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (event.altKey) {
          this.chooseActive();
        } else {
          this.moveTo(this.activeIndex() - 1);
        }
        break;
      case 'Home':
        event.preventDefault();
        this.moveTo(0);
        break;
      case 'End':
        event.preventDefault();
        this.moveTo(this.items().length - 1);
        break;
      case 'Enter':
        event.preventDefault();
        this.chooseActive();
        break;
      case ' ':
        // Nella ricerca lo spazio si scrive; senza, sceglie come Invio.
        if (!this.searchEnabled()) {
          event.preventDefault();
          this.chooseActive();
        }
        break;
      case 'Escape':
        // Fermato qui: un Esc che chiude il pannello non deve chiudere anche un dialogo attorno.
        event.preventDefault();
        event.stopPropagation();
        this.close();
        this.focusTrigger();
        break;
      case 'Tab':
        // Niente preventDefault: il fuoco avanza normalmente.
        this.close();
        break;
      default:
        if (!this.searchEnabled()) {
          this.typeAhead(event);
        }
    }
  }

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    // L'opzione attiva diventa la prima che corrisponde, non la voce vuota.
    this.activeIndex.set(this.matches().length > 0 ? this.matchOffset() : 0);
  }

  /**
   * Nei form il select sta dentro un `<label>`: un click nel pannello ne
   * attiverebbe il comportamento, cioè un click sintetico sul trigger che
   * riaprirebbe (o chiuderebbe) il pannello. Annullare il click salta
   * l'attivazione, `stopPropagation` no. La ricerca è esclusa: è un controllo
   * interattivo, che il label ignora già, e il suo pulsante "cancella" vive
   * del click.
   */
  protected cancelLabelActivation(event: MouseEvent): void {
    if (event.target !== this.searchInput()?.nativeElement) {
      event.preventDefault();
    }
  }

  /** Il pannello non prende il fuoco al click: resta sul trigger o sulla ricerca. */
  protected keepFocus(event: MouseEvent): void {
    if (event.target !== this.searchInput()?.nativeElement) {
      event.preventDefault();
    }
  }

  protected choose(item: SelectItem<T>): void {
    const id = item.id;
    if (id !== this.selectedId()) {
      this.selectedId.set(id);
      this.value.set(id);
      this.onChange(id);
    }
    this.focusTrigger();
    this.selectionMade.set(true);
    this.close();
  }

  writeValue(value: T | null): void {
    this.selectedId.set(value ?? null);
  }

  registerOnChange(fn: (value: T | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }

  private openPanel(): void {
    if (this.open() || this.isDisabled() || this.readonly()) {
      return;
    }
    this.query.set('');
    const selectedIndex = this.items().findIndex((item) => item.id === this.selectedId());
    this.activeIndex.set(Math.max(selectedIndex, 0));
    this.open.set(true);

    afterNextRender(
      () => {
        this.fixWidth();
        this.position();
        if (this.searchEnabled()) {
          this.searchInput()?.nativeElement.focus();
        }
        this.scrollActiveIntoView();
      },
      { injector: this.injector },
    );
  }

  private close(): void {
    if (!this.open()) {
      return;
    }
    this.open.set(false);
  }

  private chooseActive(): void {
    const item = this.items()[this.activeIndex()];
    if (item) {
      this.choose(item);
    }
  }

  private moveTo(index: number): void {
    const last = this.items().length - 1;
    if (last < 0) {
      return;
    }
    this.activeIndex.set(Math.min(Math.max(index, 0), last));
    afterNextRender(() => this.scrollActiveIntoView(), { injector: this.injector });
  }

  /** Senza ricerca: un carattere salta alla prossima voce che comincia così, ripartendo dall'inizio. */
  private typeAhead(event: KeyboardEvent): void {
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const index = typeAheadIndex(this.items(), this.activeIndex(), event.key);
    if (index !== -1) {
      event.preventDefault();
      this.moveTo(index);
    }
  }

  private focusTrigger(): void {
    this.trigger()?.nativeElement.focus();
  }

  private scrollActiveIntoView(): void {
    const active = this.panel()?.nativeElement.querySelector<HTMLElement>('.select-option.active');
    // jsdom non implementa scrollIntoView.
    active?.scrollIntoView?.({ block: 'nearest' });
  }

  /**
   * Fissa la larghezza del pannello all'apertura (almeno quella del trigger):
   * filtrando non si restringe e `left`, calcolato sulla larghezza, resta
   * valido. Il tetto resta il `max-width` del CSS.
   */
  private fixWidth(): void {
    const panel = this.panel()?.nativeElement;
    const trigger = this.trigger()?.nativeElement;
    if (!panel || !trigger) {
      return;
    }
    // Misurato a `left: 0`, dove la larghezza naturale non è stretta dal bordo destro.
    panel.style.left = '0px';
    panel.style.width = '';
    panel.style.width = `${Math.max(panel.offsetWidth, trigger.getBoundingClientRect().width)}px`;
  }

  /**
   * Misura trigger, pannello e viewport e applica `panelPlacement`. Scrive
   * direttamente sullo stile, senza passare dai signal: così scroll e resize
   * non richiedono un giro di change detection.
   */
  private position(): void {
    const panel = this.panel()?.nativeElement;
    const trigger = this.trigger()?.nativeElement;
    if (!panel || !trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const height = panel.offsetHeight;
    // La larghezza si misura col `min-width` del trigger attuale: uno vecchio e più
    // largo (trigger ristretto da un resize) sposterebbe il pannello troppo a sinistra.
    panel.style.minWidth = `${rect.width}px`;
    const placement = panelPlacement(
      rect,
      { width: panel.offsetWidth, height },
      { width: window.innerWidth, height: window.innerHeight },
    );

    panel.classList.toggle('above', placement.above);
    panel.style.top = placement.top === null ? '' : `${placement.top}px`;
    panel.style.bottom = placement.bottom === null ? '' : `${placement.bottom}px`;
    panel.style.left = `${placement.left}px`;
  }
}
