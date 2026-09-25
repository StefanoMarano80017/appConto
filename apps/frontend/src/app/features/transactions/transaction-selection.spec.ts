import { createSelectionState } from './transaction-selection';

describe('createSelectionState', () => {
  it('starts empty', () => {
    const selection = createSelectionState();

    expect([...selection.selected()]).toEqual([]);
    expect(selection.count()).toBe(0);
  });

  it('toggles an id on and off', () => {
    const selection = createSelectionState();

    selection.toggle('a');
    expect([...selection.selected()]).toEqual(['a']);

    selection.toggle('a');
    expect([...selection.selected()]).toEqual([]);
  });

  it('keeps multiple ids selected', () => {
    const selection = createSelectionState();

    selection.toggle('a');
    selection.toggle('b');

    expect([...selection.selected()].sort()).toEqual(['a', 'b']);
  });

  it('adds many ids when selecting', () => {
    const selection = createSelectionState();
    selection.toggle('a');

    selection.toggleMany(['b', 'c'], true);

    expect([...selection.selected()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('removes many ids when deselecting', () => {
    const selection = createSelectionState();
    selection.toggle('a');
    selection.toggle('b');
    selection.toggle('c');

    selection.toggleMany(['b', 'c'], false);

    expect([...selection.selected()]).toEqual(['a']);
  });

  it('preserves unrelated ids while toggling many', () => {
    const selection = createSelectionState();
    selection.toggle('a');
    selection.toggle('d');

    selection.toggleMany(['b', 'c'], true);

    expect([...selection.selected()].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('clears all ids', () => {
    const selection = createSelectionState();
    selection.toggle('a');
    selection.toggle('b');

    selection.clear();

    expect([...selection.selected()]).toEqual([]);
  });

  it('keeps the count in sync with the selected set', () => {
    const selection = createSelectionState();

    expect(selection.count()).toBe(0);

    selection.toggle('a');
    selection.toggleMany(['b', 'c'], true);
    expect(selection.count()).toBe(3);

    selection.toggleMany(['b'], false);
    expect(selection.count()).toBe(2);

    selection.clear();
    expect(selection.count()).toBe(0);
  });
});
