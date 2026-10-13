import { CategoryWithUsage } from './category.model';
import { CATEGORY_SORT_OPTIONS, filterCategories, sortCategories } from './category-list';

/** Costruisce una categoria con il numero di merchant assegnati. */
const category = (name: string, merchantCount = 0): CategoryWithUsage => ({
  id: name,
  name,
  color: null,
  merchantCount
});

const names = (items: readonly { name: string }[]): string[] => items.map((item) => item.name);

describe('filterCategories', () => {
  it('filtra senza distinzione di maiuscole e accenti', () => {
    const categories = [category('Bar e caffè'), category('Casa')];

    expect(names(filterCategories(categories, 'CAFFE'))).toEqual(['Bar e caffè']);
    expect(names(filterCategories(categories, 'bar'))).toEqual(['Bar e caffè']);
  });

  it('una ricerca vuota o di soli spazi restituisce tutto', () => {
    const categories = [category('Bar e caffè'), category('Casa')];

    expect(names(filterCategories(categories, ''))).toEqual(['Bar e caffè', 'Casa']);
    expect(names(filterCategories(categories, '   '))).toEqual(['Bar e caffè', 'Casa']);
  });
});

describe('sortCategories', () => {
  it('ordina per nome A→Z e Z→A in italiano, non per codepoint', () => {
    const categories = [category('Bollette'), category('abbonamenti'), category('Ålimentari')];

    expect(names(sortCategories(categories, 'name-asc'))).toEqual([
      'abbonamenti',
      'Ålimentari',
      'Bollette'
    ]);
    expect(names(sortCategories(categories, 'name-desc'))).toEqual([
      'Bollette',
      'Ålimentari',
      'abbonamenti'
    ]);
  });

  it('ordina per merchant con parità risolta per nome', () => {
    const categories = [category('Casa', 2), category('Alimentari', 2), category('Bar', 5)];

    expect(names(sortCategories(categories, 'merchants-desc'))).toEqual(['Bar', 'Alimentari', 'Casa']);
    expect(names(sortCategories(categories, 'merchants-asc'))).toEqual(['Alimentari', 'Casa', 'Bar']);
  });

  it('non modifica l\'array in ingresso', () => {
    const categories = [category('Casa', 2), category('Bar', 5)];
    const snapshot = [...categories];

    const sorted = sortCategories(categories, 'merchants-desc');

    expect(sorted).not.toBe(categories);
    expect(categories).toEqual(snapshot);
  });
});

describe('CATEGORY_SORT_OPTIONS', () => {
  it('elenca le quattro voci nell\'ordine previsto, con le etichette in italiano', () => {
    expect(CATEGORY_SORT_OPTIONS.map((option) => [option.id, option.name])).toEqual([
      ['name-asc', 'Nome A→Z'],
      ['name-desc', 'Nome Z→A'],
      ['merchants-desc', 'Più merchant'],
      ['merchants-asc', 'Meno merchant']
    ]);
  });
});
