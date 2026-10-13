import { matchSegments, normalizeSearch } from './select-search';

describe('normalizeSearch', () => {
  it('ignora maiuscole, accenti e spazi ai bordi', () => {
    expect(normalizeSearch('  Caffè ')).toBe('caffe');
  });
});

describe('matchSegments', () => {
  it('restituisce null se la query non compare', () => {
    expect(matchSegments('Spesa', 'xyz')).toBeNull();
  });

  it('con query vuota restituisce tutto il testo senza match', () => {
    expect(matchSegments('Spesa', '')).toEqual([{ text: 'Spesa', match: false }]);
  });

  it('marca la prima occorrenza conservando il testo originale', () => {
    expect(matchSegments('Trasporti', 'SP')).toEqual([
      { text: 'Tra', match: false }, { text: 'sp', match: true }, { text: 'orti', match: false },
    ]);
  });

  it('trova parole accentate cercando senza accento', () => {
    expect(matchSegments('Caffè', 'caffe')).toEqual([{ text: 'Caffè', match: true }]);
  });

  it('ignora gli spazi ai bordi della query', () => {
    expect(matchSegments('Spesa', ' sp ')?.[0]).toEqual({ text: 'Sp', match: true });
  });
});
