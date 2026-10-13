import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LucideLock, LucidePencil, LucideTrash2 } from '@lucide/angular';
import { ColorPicker } from '@shared/ui/forms/color-picker/color-picker';
import { CategoryWithUsage } from '../category.model';

/** Colore della bozza e delle categorie senza colore. */
const DEFAULT_COLOR = '#9aa3af';

/**
 * Tessera di una categoria: colore, nome rinominabile in linea, numero di
 * merchant e cestino con conferma. Con `category` a `null` è la bozza di
 * creazione, che parte già in modifica.
 *
 * La tessera non salva nulla da sé: emette gli output e lascia alla pagina le
 * chiamate alle API e gli stati `busy` / `confirmingDelete` / `deleting`.
 */
@Component({
  selector: 'app-category-tile',
  imports: [ColorPicker, LucideLock, LucidePencil, LucideTrash2],
  templateUrl: './category-tile.html',
  styleUrl: './category-tile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.editing]': 'editing()',
    '[class.busy]': 'busy()',
    '[class.confirming]': 'confirming()',
    '(keydown)': 'onKeydown($event)',
    '(focusout)': 'onFocusout($event)',
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
      this.deleteCancelled.emit();
    } else if (this.editing()) {
      event.preventDefault();
      if (this.isDraft()) {
        this.draftDismissed.emit();
      } else {
        this.editing.set(false);
      }
    }
  }

  /**
   * Il focus che si sposta fra i controlli della stessa tessera (per esempio
   * dal campo al color picker) non chiude la modifica: conta solo l'uscita.
   */
  protected onFocusout(event: FocusEvent): void {
    if (!this.editing()) {
      return;
    }
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.contains(next)) {
      return;
    }
    if (this.isDraft()) {
      // Una bozza con un nome scritto resta aperta: si perde solo con Esc.
      if (this.draftName().trim() === '') {
        this.draftDismissed.emit();
      }
      return;
    }
    this.commitRename();
  }

  private commitRename(): void {
    const name = this.draftName().trim();
    this.editing.set(false);
    if (name !== '' && name !== this.category()?.name) {
      this.renamed.emit(name);
    }
  }

  private create(): void {
    const name = this.draftName().trim();
    if (name === '') {
      return;
    }
    // La bozza resta in modifica: se la creazione fallisce il testo è ancora lì.
    this.created.emit({ name, color: this.draftColor() });
  }
}
