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
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { LucideChevronDown } from '@lucide/angular';
import { panelPlacement } from '../select/select-position';

const DEFAULT_COLOR = '#9aa3af';
type RgbChannel = 'red' | 'green' | 'blue';

interface RgbChannelOption {
  readonly key: RgbChannel;
  readonly name: string;
  readonly color: string;
}

interface RgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

function parseHexColor(color: string): RgbColor {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  const hex = match?.[1] ?? DEFAULT_COLOR.slice(1);
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function toHexColor({ red, green, blue }: RgbColor): string {
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

const COLORS = [
  { name: 'Rosso', value: '#d66f6f' },
  { name: 'Arancione', value: '#d98755' },
  { name: 'Giallo', value: '#d1a84b' },
  { name: 'Verde oliva', value: '#88a94a' },
  { name: 'Verde', value: '#4f9b68' },
  { name: 'Turchese', value: '#3f8f8c' },
  { name: 'Azzurro', value: '#4e91b5' },
  { name: 'Blu', value: '#5572b8' },
  { name: 'Viola', value: '#8063b2' },
  { name: 'Rosa', value: '#ad6597' },
  { name: 'Marrone', value: '#a76f58' },
  { name: 'Grigio', value: DEFAULT_COLOR },
] as const;

let nextId = 0;

@Component({
  selector: 'app-color-picker',
  imports: [LucideChevronDown],
  templateUrl: './color-picker.html',
  styleUrl: './color-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => ColorPicker), multi: true },
  ],
  host: {
    '[class.field]': "appearance() === 'field'",
  },
})
export class ColorPicker implements ControlValueAccessor {
  readonly value = model<string>(DEFAULT_COLOR);
  readonly valueCommitted = output<string>();
  readonly ariaLabel = input('Seleziona colore');
  readonly appearance = input<'inline' | 'field'>('inline');
  readonly disabled = input(false);

  protected readonly colors = COLORS;
  protected readonly rgbChannels: readonly RgbChannelOption[] = [
    { key: 'red', name: 'Rosso', color: 'var(--color-error)' },
    { key: 'green', name: 'Verde', color: 'var(--color-income)' },
    { key: 'blue', name: 'Blu', color: 'var(--color-info)' },
  ];
  protected readonly open = signal(false);
  protected readonly activeIndex = signal(0);
  // Bozza del colore: slider e campo HEX la modificano, `confirmColor` la
  // applica. Mentre il pannello è aperto un `value` esterno non la sovrascrive.
  protected readonly currentColor = linkedSignal<string, string>({
    source: this.value,
    computation: (value, previous) =>
      previous && untracked(this.open) ? previous.value : value,
  });
  protected readonly customColorDraft = linkedSignal(() => this.currentColor());
  protected readonly customColorIsValid = computed(() =>
    /^#[0-9a-f]{6}$/i.test(this.customColorDraft()),
  );
  protected readonly rgb = computed(() => parseHexColor(this.currentColor()));
  private readonly formDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.formDisabled());
  protected readonly selectedIndex = computed(() =>
    COLORS.findIndex((color) => color.value.toLowerCase() === this.currentColor().toLowerCase()),
  );

  private readonly baseId = `app-color-picker-${nextId++}`;
  protected readonly panelId = `${this.baseId}-panel`;
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  private readonly closeOnOutside = (event: Event): void => {
    if (event.target instanceof Node && !this.host.contains(event.target)) {
      this.close();
    }
  };

  private readonly reposition = (): void => this.position();

  constructor() {
    effect((onCleanup) => {
      if (!this.open()) {
        return;
      }
      document.addEventListener('pointerdown', this.closeOnOutside);
      window.addEventListener('resize', this.reposition);
      window.addEventListener('scroll', this.reposition, true);
      onCleanup(() => {
        document.removeEventListener('pointerdown', this.closeOnOutside);
        window.removeEventListener('resize', this.reposition);
        window.removeEventListener('scroll', this.reposition, true);
      });
    });
  }

  protected toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    if (this.isDisabled()) {
      return;
    }
    this.activeIndex.set(Math.max(this.selectedIndex(), 0));
    this.open.set(true);
    afterNextRender(
      () => {
        this.position();
        this.focusActiveColor();
      },
      { injector: this.injector },
    );
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      this.toggle();
    }
  }

  protected onPanelKeydown(event: KeyboardEvent): void {
    const confirmButton =
      event.target instanceof HTMLButtonElement && event.target.hasAttribute('data-confirm');
    const paletteOption =
      event.target instanceof HTMLButtonElement && event.target.hasAttribute('data-color-index');

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        if (!paletteOption) {
          return;
        }
        event.preventDefault();
        this.moveActiveColor(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        if (!paletteOption) {
          return;
        }
        event.preventDefault();
        this.moveActiveColor(-1);
        break;
      case 'Home':
        if (!paletteOption) {
          return;
        }
        event.preventDefault();
        this.setActiveColor(0);
        break;
      case 'End':
        if (!paletteOption) {
          return;
        }
        event.preventDefault();
        this.setActiveColor(COLORS.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.close();
        this.focusTrigger();
        break;
      case 'Tab':
        if (event.shiftKey ? paletteOption : confirmButton) {
          this.close();
        }
        break;
    }
  }

  protected chooseColor(color: string): void {
    this.applyColor(color);
    this.close();
    this.focusTrigger();
  }

  protected confirmColor(): void {
    this.applyColor(this.currentColor());
    this.close();
    this.focusTrigger();
  }

  protected setCustomColor(event: Event): void {
    const color = (event.target as HTMLInputElement).value.trim();
    this.customColorDraft.set(color);
    if (!this.customColorIsValid()) {
      return;
    }
    this.currentColor.set(color.toLowerCase());
  }

  protected setRgbChannel(channel: RgbChannel, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.currentColor.set(toHexColor({ ...this.rgb(), [channel]: value }));
  }

  protected onTriggerBlur(): void {
    if (!this.open()) {
      this.onTouched();
    }
  }

  writeValue(value: string | null): void {
    this.value.set(value ?? DEFAULT_COLOR);
    this.currentColor.set(value ?? DEFAULT_COLOR);
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }

  /** Chiude il pannello scartando la bozza non confermata. */
  private close(): void {
    if (this.open()) {
      this.open.set(false);
      this.currentColor.set(this.value());
      this.onTouched();
    }
  }

  private applyColor(color: string): void {
    if (color === this.value()) {
      return;
    }
    this.value.set(color);
    this.onChange(color);
    this.valueCommitted.emit(color);
  }

  private moveActiveColor(offset: number): void {
    this.setActiveColor((this.activeIndex() + offset + COLORS.length) % COLORS.length);
  }

  private setActiveColor(index: number): void {
    this.activeIndex.set(index);
    afterNextRender(() => this.focusActiveColor(), { injector: this.injector });
  }

  private focusActiveColor(): void {
    const color = this.panel()?.nativeElement.querySelector<HTMLButtonElement>(
      `[data-color-index="${this.activeIndex()}"]`,
    );
    color?.focus();
  }

  private focusTrigger(): void {
    this.trigger()?.nativeElement.focus();
  }

  private position(): void {
    const panel = this.panel()?.nativeElement;
    const trigger = this.trigger()?.nativeElement;
    if (!panel || !trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const placement = panelPlacement(
      rect,
      { width: panel.offsetWidth, height: panel.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    panel.classList.toggle('above', placement.above);
    panel.style.top = placement.top === null ? '' : `${placement.top}px`;
    panel.style.bottom = placement.bottom === null ? '' : `${placement.bottom}px`;
    panel.style.left = `${placement.left}px`;
  }
}
