import type { LucideIconData } from '@lucide/angular';

/** Una voce di `app-select`. */
export interface SelectOption<T extends string = string> {
  readonly id: T;
  readonly name: string;
  /** Pallino colore (`app-color-marker`). */
  readonly color?: string | null;
  /** Icona Lucide passata come dato (es. `LucideTrendingUp.icon`); ha precedenza su `color`. */
  readonly icon?: LucideIconData;
}
