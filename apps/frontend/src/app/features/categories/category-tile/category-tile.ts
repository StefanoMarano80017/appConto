import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LucideCheck, LucideLock, LucideTrash2, LucideX } from '@lucide/angular';
import { ColorPicker } from '@shared/ui/forms/color-picker/color-picker';
import { CategoryWithUsage } from '../category.model';

/** Colore della bozza e delle categorie senza colore. */
const DEFAULT_COLOR = '#9aa3af';

/** Dove riportare il focus quando il controllo che lo aveva sparisce o si disabilita. */
const FOCUS_TARGETS = {
  name: 'button.name',
  picker: 'app-color-picker button',
  trash: 'button.delete',
  field: 'input.name-input',
} as const;
type FocusTarget = keyof typeof FOCUS_TARGETS;

/**
 * Tessera di una categoria: colore, nome rinominabile in linea, numero di
 * merchant e cestino con conferma. Con `category` a `null` è la bozza di
 * creazione, che parte già in modifica.
 *
 * La tessera non salva nulla da sé: emette gli output e lascia alla pagina le
 * chiamate alle API e gli stati `busy` / `confirmingDelete` / `deleting`.
 */
/** Durata della transizione del contenuto: la stessa dell'animazione in `category-tile.scss`. */
const SWAP_MS = 220;

@Component({
  selector: 'app-category-tile',
  imports: [ColorPicker, LucideCheck, LucideLock, LucideTrash2, LucideX],
  templateUrl: './category-tile.html',
  styleUrl: './category-tile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.editing]': 'editing()',
    '[class.draft]': 'isDraft()',
    '[class.busy]': 'busy()',
    '[class.confirming]': 'confirming()',
    '[class.swapping]': 'swapping()',
    '(keydown)': 'onKeydown($event)',
    '(focusout)': 'onFocusout($event)',
    '(pointerdown)': 'onPointerdown($event)',
  },
})
export class CategoryTile implements OnInit {
  readonly category = input<CategoryWithUsage | null>(null);
  readonly locked = input(false);
  readonly busy = input(false);
  readonly confirmingDelete = input(false);
  readonly deleting = input(false);

  readonly renamed = output<string>();
  readonly recolored = output<string>();
  readonly deleteAsked = output<void>();
  readonly deleteCancelled = output<void>();
  readonly deleteConfirmed = output<void>();
  readonly created = output<{ name: string; color: string }>();
  readonly draftDismissed = output<void>();

  protected readonly editing = signal(false);
  /** Testo corrente del campo nome, valido solo in modifica. */
  protected readonly draftName = signal('');
  /** Colore della bozza: resta locale finché la bozza non emette `created`. */
  protected readonly draftColor = signal(DEFAULT_COLOR);

  protected readonly isDraft = computed(() => this.category() === null);
  protected readonly confirming = computed(() => this.confirmingDelete() && !this.isDraft());
  /** Vero per la durata della transizione fra il contenuto normale e la conferma. */
  protected readonly swapping = signal(false);
  /** La frase intera della conferma, per lo screen reader e per il `title`. */
  protected readonly askText = computed(() => {
    const count = this.category()?.merchantCount ?? 0;
    const verb = count === 1 ? 'verrà spostato' : 'verranno spostati';
    return `${count} merchant ${verb} su «Da classificare». Eliminare?`;
  });
  protected readonly color = computed(() => {
    const category = this.category();
    return category ? (category.color ?? DEFAULT_COLOR) : this.draftColor();
  });
  protected readonly colorLabel = computed(() => {
    const category = this.category();
    return category ? `Colore di ${category.name}` : 'Colore nuova categoria';
  });
  protected readonly nameLabel = computed(() => {
    const category = this.category();
    return category ? `Nome di ${category.name}` : 'Nome nuova categoria';
  });

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  /** Vero fra un `pointerdown` sul color picker della tessera e la fine di quel task. */
  private pointerInside = false;
  /**
   * Controllo su cui riportare il focus appena esiste ed è abilitato. Serve
   * perché il controllo che aveva il focus sparisce (campo, cestino) o si
   * disabilita durante il salvataggio (`busy`), e il focus cadrebbe sul body.
   */
  private pendingFocus: FocusTarget | null = null;
  private wasConfirming = false;
  private wasBusy = false;

  constructor() {
    // Il cestino premuto sparisce col passaggio alla conferma e il focus
    // cadrebbe sul body, dove Esc non arriva più alla tessera: lo si porta su
    // «Annulla» (mai su «Sì, elimina», che un Invio distratto attiverebbe).
    // Alla chiusura (annullo o eliminazione fallita) torna sul cestino.
    effect(() => {
      const confirming = this.confirming();
      if (confirming === this.wasConfirming) {
        return;
      }
      this.wasConfirming = confirming;
      this.playSwap();
      if (confirming) {
        this.pendingFocus = null;
        afterNextRender(
          () => this.host.querySelector<HTMLButtonElement>('.confirm button.ghost')?.focus(),
          { injector: this.injector },
        );
      } else if (this.focusIsHereOrLost()) {
        // Se il focus è già altrove (per esempio sul cestino di un'altra
        // tessera, che apre la propria conferma) non lo si sposta.
        this.restoreFocus('trash');
      }
    });

    // Finito il salvataggio i controlli si riabilitano: è il momento di
    // riprendere il focus richiesto mentre erano disabilitati.
    effect(() => {
      const busy = this.busy();
      if (busy === this.wasBusy) {
        return;
      }
      this.wasBusy = busy;
      if (!busy && this.pendingFocus) {
        afterNextRender(() => this.flushFocus(), { injector: this.injector });
      }
    });
  }

  /** Accende per un attimo la classe che anima il contenuto appena comparso. */
  private playSwap(): void {
    this.swapping.set(true);
    setTimeout(() => this.swapping.set(false), SWAP_MS);
  }

  ngOnInit(): void {
    if (this.isDraft()) {
      this.startEditing();
    }
  }

  protected startEditing(): void {
    if (this.locked() || this.busy()) {
      return;
    }
    this.draftName.set(this.category()?.name ?? '');
    this.editing.set(true);
    afterNextRender(
      () => {
        const field = this.field()?.nativeElement;
        field?.focus();
        field?.select();
      },
      { injector: this.injector },
    );
  }

  protected onFieldInput(event: Event): void {
    this.draftName.set((event.target as HTMLInputElement).value);
  }

  protected onFieldKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    if (this.isDraft()) {
      this.create();
    } else {
      this.commitRename();
    }
  }

  protected onColor(color: string): void {
    if (this.isDraft()) {
      this.draftColor.set(color);
    } else {
      // Il picker rende il focus al proprio trigger, che `busy` disabilita subito dopo.
      this.pendingFocus = 'picker';
      this.recolored.emit(color);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }
    // Il pannello del color picker gestisce (e ferma) il proprio Esc.
    if (this.confirming()) {
      event.preventDefault();
      this.cancelDelete();
    } else if (this.editing()) {
      event.preventDefault();
      if (this.isDraft()) {
        this.draftDismissed.emit();
      } else {
        this.editing.set(false);
        this.restoreFocus('name');
      }
    }
  }

  protected cancelDelete(): void {
    // Con l'eliminazione in corso non c'è più nulla da annullare.
    if (this.deleting()) {
      return;
    }
    this.deleteCancelled.emit();
  }

  /**
   * Safari non dà il focus ai bottoni al clic: premere il trigger del color
   * picker toglie il focus al campo con `relatedTarget` null, come un'uscita.
   * Si ricorda il `pointerdown` sul picker fino alla fine del task, che comprende
   * lo spostamento del focus, per non scambiarlo per un'uscita.
   */
  protected onPointerdown(event: PointerEvent): void {
    // Solo il color picker: un clic su una parte non focalizzabile della
    // tessera (padding, spazio intorno al quadratino) toglie davvero il focus
    // al campo, e quell'uscita deve chiudere la modifica come sempre.
    if (
      !(event.target instanceof Element) ||
      !event.target.closest('app-color-picker, .draft-action')
    ) {
      return;
    }
    this.pointerInside = true;
    setTimeout(() => (this.pointerInside = false));
  }

  /**
   * Il focus che si sposta fra i controlli della stessa tessera (per esempio
   * dal campo al color picker) non chiude la modifica: conta solo l'uscita.
   */
  protected onFocusout(event: FocusEvent): void {
    if (!this.editing()) {
      return;
    }
    // Il pulsante del nome che il clic ha appena sostituito col campo: i browser
    // basati su Chromium emettono su di esso un `focusout` con `relatedTarget`
    // null mentre lo rimuovono, a modifica già attiva. Non è un'uscita dal campo.
    if (event.target instanceof Element && event.target.matches('button.name')) {
      return;
    }
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.contains(next)) {
      return;
    }
    if (next === null && this.pointerInside) {
      return;
    }
    if (this.isDraft()) {
      // Una bozza con un nome scritto resta aperta: si perde solo con Esc.
      if (this.draftName().trim() === '') {
        this.draftDismissed.emit();
      }
      return;
    }
    // Il focus se n'è andato da sé: non lo si riporta indietro.
    this.commitRename(false);
  }

  /** Il focus resta sulla tessera, o è caduto sul body perché il suo controllo è sparito. */
  private focusIsHereOrLost(): boolean {
    const active = document.activeElement;
    return active === null || active === document.body || this.host.contains(active);
  }

  private restoreFocus(target: FocusTarget): void {
    this.pendingFocus = target;
    afterNextRender(() => this.flushFocus(), { injector: this.injector });
  }

  /** Mette il focus sul controllo in attesa se c'è, è abilitato e il focus non è altrove. */
  private flushFocus(): void {
    const target = this.pendingFocus;
    if (!target) {
      return;
    }
    const element = this.host.querySelector<HTMLButtonElement | HTMLInputElement>(
      FOCUS_TARGETS[target],
    );
    if (!element || element.disabled) {
      return;
    }
    this.pendingFocus = null;
    if (this.focusIsHereOrLost()) {
      element.focus();
    }
  }

  private commitRename(keepFocus = true): void {
    const name = this.draftName().trim();
    this.editing.set(false);
    if (keepFocus) {
      // Se il salvataggio parte il nome è disabilitato: `flushFocus` riprova a fine `busy`.
      this.restoreFocus('name');
    }
    if (name !== '' && name !== this.category()?.name) {
      this.renamed.emit(name);
    }
  }

  protected create(): void {
    const name = this.draftName().trim();
    if (name === '') {
      return;
    }
    // La bozza resta in modifica: se la creazione fallisce il testo è ancora lì
    // e, finito `busy`, il campo riprende il focus.
    this.pendingFocus = 'field';
    this.created.emit({ name, color: this.draftColor() });
  }

  protected dismissDraft(): void {
    this.draftDismissed.emit();
  }
}
