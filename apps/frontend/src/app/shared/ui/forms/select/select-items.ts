import { SelectOption } from './select.model';
import { matchSegments, normalizeSearch, SearchSegment } from './select-search';

/** Una voce del pannello: un'opzione oppure la voce vuota (`placeholder`), che vale `null`. */
export interface SelectItem<T extends string> {
  readonly id: T | null;
  readonly name: string;
  readonly color?: string | null;
  readonly icon?: SelectOption<T>['icon'];
  readonly segments: readonly SearchSegment[];
  readonly placeholder: boolean;
}

/** Le opzioni che corrispondono a `query` (vuota = tutte), con i segmenti per `<mark>`. */
export function matchOptions<T extends string>(
  options: readonly SelectOption<T>[],
  query: string,
): readonly SelectItem<T>[] {
  const matches: SelectItem<T>[] = [];
  for (const option of options) {
    const segments = matchSegments(option.name, query);
    if (segments) {
      matches.push({ ...option, segments, placeholder: false });
    }
  }
  return matches;
}

/** La voce vuota con il nome dato, o `null` se il select non ne ha una. */
export function placeholderItem<T extends string>(name: string | null): SelectItem<T> | null {
  return name === null ? null : { id: null, name, segments: [{ text: name, match: false }], placeholder: true };
}

/**
 * Indice della prossima voce (dopo `from`, con giro completo) il cui nome comincia
 * per `key`, ignorando maiuscole e accenti; salta la voce vuota. `-1` se non c'è.
 */
export function typeAheadIndex<T extends string>(items: readonly SelectItem<T>[], from: number, key: string): number {
  const letter = normalizeSearch(key);
  if (letter === '') {
    return -1;
  }
  for (let step = 1; step <= items.length; step++) {
    const index = (from + step) % items.length;
    const item = items[index];
    if (!item.placeholder && normalizeSearch(item.name).startsWith(letter)) {
      return index;
    }
  }
  return -1;
}
