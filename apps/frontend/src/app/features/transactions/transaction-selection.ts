import { computed, Signal, signal } from '@angular/core';

export interface SelectionState {
  readonly selected: Signal<ReadonlySet<string>>;
  readonly count: Signal<number>;

  toggle(id: string): void;
  toggleMany(ids: readonly string[], select: boolean): void;
  clear(): void;
}

export function createSelectionState(): SelectionState {
  const state = signal<ReadonlySet<string>>(new Set<string>());
  const selected = computed(() => state());
  const count = computed(() => selected().size);

  function toggle(id: string): void {
    state.update((current) => {
      const next = new Set(current);

      if (!next.delete(id)) {
        next.add(id);
      }

      return next;
    });
  }

  function toggleMany(ids: readonly string[], select: boolean): void {
    state.update((current) => {
      const next = new Set(current);

      for (const id of ids) {
        if (select) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }

      return next;
    });
  }

  function clear(): void {
    state.set(new Set<string>());
  }

  return {
    selected,
    count,
    toggle,
    toggleMany,
    clear,
  };
}
