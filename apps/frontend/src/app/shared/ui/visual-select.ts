import { Component, computed, input, output, signal } from '@angular/core';
import {
  LucideArrowLeftRight,
  LucideBanknote,
  LucideChevronDown,
  LucideEllipsis,
  LucideHandCoins,
  LucideTrendingUp,
  LucideTrendingDown,
} from '@lucide/angular';
import { ColorMarkerComponent } from './color-marker';

export type VisualSelectIcon =
  | 'trending-down'
  | 'trending-up'
  | 'banknote'
  | 'hand-coins'
  | 'arrow-left-right'
  | 'ellipsis';

export interface VisualSelectOption<T extends string = string> {
  readonly id: T;
  readonly name: string;
  readonly color?: string | null;
  readonly icon?: VisualSelectIcon;
}

@Component({
  selector: 'app-visual-select',
  imports: [
    ColorMarkerComponent,
    LucideArrowLeftRight,
    LucideBanknote,
    LucideChevronDown,
    LucideEllipsis,
    LucideHandCoins,
    LucideTrendingDown,
    LucideTrendingUp,
  ],
  templateUrl: './visual-select.html',
  styleUrl: './visual-select.scss',
})
export class VisualSelect<T extends string = string> {
  readonly options = input.required<readonly VisualSelectOption<T>[]>();
  readonly value = input<T | null>(null);
  readonly ariaLabel = input.required<string>();
  readonly disabled = input(false);
  readonly valueChange = output<T | null>();

  protected readonly selectionMade = signal(false);

  protected readonly selected = computed(
    () => this.options().find((option) => option.id === this.value()) ?? null,
  );

  protected change(event: Event): void {
    const selectedId = (event.currentTarget as HTMLSelectElement).value;
    const selected = this.options().find((option) => option.id === selectedId);
    this.selectionMade.set(true);
    this.valueChange.emit(selected?.id ?? null);
  }
}