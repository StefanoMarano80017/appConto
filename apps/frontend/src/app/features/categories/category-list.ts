import type { SelectOption } from '@shared/ui/forms/select/select.model';
import type { Category, CategoryWithUsage } from './category.model';

/** Criterio di ordinamento dell'elenco delle categorie. */
export type CategorySort = 'name-asc' | 'name-desc' | 'merchants-desc' | 'merchants-asc';

/** Voci del selettore di ordinamento, nell'ordine in cui vengono mostrate. */
export const CATEGORY_SORT_OPTIONS: readonly SelectOption<CategorySort>[] = [
  { id: 'name-asc', name: 'Nome A→Z' },
  { id: 'name-desc', name: 'Nome Z→A' },
  { id: 'merchants-desc', name: 'Più merchant' },
  { id: 'merchants-asc', name: 'Meno merchant' }
];

/** Minuscole e senza accenti, così che «Caffè» corrisponda a «caffe». */
const normalize = (value: string): string =>
  value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Confronto alfabetico italiano, ignorando maiuscole e accenti. */
const byName = (a: Category, b: Category): number =>
  a.name.localeCompare(b.name, 'it', { sensitivity: 'base' });

/** Tiene le categorie il cui nome contiene la ricerca; una ricerca vuota le lascia tutte. */
export function filterCategories<T extends Category>(categories: readonly T[], search: string): T[] {
  const needle = normalize(search.trim());
  if (!needle) {
    return [...categories];
  }
  return categories.filter((category) => normalize(category.name).includes(needle));
}

/** Ordina una copia delle categorie; a parità di merchant (o di nome) si ordina per nome A→Z. */
export function sortCategories<T extends CategoryWithUsage>(categories: readonly T[], sort: CategorySort): T[] {
  const copy = [...categories];
  switch (sort) {
    case 'name-asc':
      return copy.sort(byName);
    case 'name-desc':
      return copy.sort((a, b) => byName(b, a));
    case 'merchants-desc':
      return copy.sort((a, b) => b.merchantCount - a.merchantCount || byName(a, b));
    case 'merchants-asc':
      return copy.sort((a, b) => a.merchantCount - b.merchantCount || byName(a, b));
  }
}
