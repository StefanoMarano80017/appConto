import { matchOptions, placeholderItem, SelectItem, typeAheadIndex } from './select-items';

const OPTIONS = [
  { id: 'a', name: 'Affitto', color: '#ff0000' },
  { id: 'b', name: 'Bollette' },
  { id: 'c', name: 'Caffè' },
];

const item = (name: string, placeholder = false): SelectItem<string> => ({
  id: placeholder ? null : name,
  name,
  segments: [{ text: name, match: false }],
  placeholder,
});

describe('matchOptions', () => {
  it('con query vuota restituisce tutte le opzioni in ordine, con un solo segmento non marcato', () => {
    const result = matchOptions(OPTIONS, '');

    expect(result.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(result[1].segments).toEqual([{ text: 'Bollette', match: false }]);
    expect(result.every((entry) => !entry.placeholder)).toBe(true);
  });

  it('conserva colore e icona', () => {
    const icon = [] as never;
    const result = matchOptions([{ id: 'x', name: 'Uno', color: '#00f', icon }], '');

    expect(result[0].color).toBe('#00f');
    expect(result[0].icon).toBe(icon);
  });

  it('con una query filtra e marca la parte che corrisponde', () => {
    const result = matchOptions(OPTIONS, 'oll');

    expect(result.map((entry) => entry.id)).toEqual(['b']);
    expect(result[0].segments).toEqual([
      { text: 'B', match: false },
      { text: 'oll', match: true },
      { text: 'ette', match: false },
    ]);
  });

  it('ignora maiuscole e accenti', () => {
    const result = matchOptions(OPTIONS, 'CAFFE');

    expect(result.map((entry) => entry.id)).toEqual(['c']);
    expect(result[0].segments).toEqual([{ text: 'Caffè', match: true }]);
  });

  it('senza risultati restituisce una lista vuota', () => {
    expect(matchOptions(OPTIONS, 'zzz')).toEqual([]);
  });
});

describe('placeholderItem', () => {
  it('senza nome è null', () => {
    expect(placeholderItem(null)).toBeNull();
  });

  it('con un nome crea la voce vuota con id null', () => {
    expect(placeholderItem('Tutti')).toEqual({
      id: null,
      name: 'Tutti',
      segments: [{ text: 'Tutti', match: false }],
      placeholder: true,
    });
  });
});

describe('typeAheadIndex', () => {
  const items = [item('Tutti', true), item('Affitto'), item('Bollette'), item('Àlbero'), item('Caffè')];

  it('trova la prossima voce che comincia con la lettera, dopo `from`', () => {
    expect(typeAheadIndex(items, 0, 'b')).toBe(2);
    expect(typeAheadIndex(items, 1, 'a')).toBe(3);
  });

  it('riparte dall\'inizio se in coda non c\'è niente', () => {
    expect(typeAheadIndex(items, 3, 'a')).toBe(1);
  });

  it('salta la voce vuota', () => {
    expect(typeAheadIndex(items, 4, 't')).toBe(-1);
  });

  it('ignora maiuscole e accenti', () => {
    expect(typeAheadIndex(items, 0, 'C')).toBe(4);
    expect(typeAheadIndex(items, 2, 'À')).toBe(3);
    expect(typeAheadIndex(items, 0, 'a')).toBe(1);
  });

  it('restituisce -1 se nessuna voce corrisponde', () => {
    expect(typeAheadIndex(items, 0, 'z')).toBe(-1);
  });

  it('restituisce -1 se il tasto è uno spazio', () => {
    expect(typeAheadIndex(items, 0, ' ')).toBe(-1);
  });

  it('funziona partendo dall\'ultimo indice', () => {
    expect(typeAheadIndex(items, 4, 'b')).toBe(2);
    expect(typeAheadIndex(items, 4, 'c')).toBe(4);
  });
});
