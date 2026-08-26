import { PERIOD_PRESETS, matchingPreset, resolvePeriod } from './period';

/** Un mercoledì di metà anno: nessun estremo di mese o di anno. */
const oggi = new Date(2026, 6, 15);

describe('resolvePeriod', () => {
  it('copre il mese corrente per intero', () => {
    expect(resolvePeriod('this-month', oggi)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('copre il mese precedente per intero', () => {
    expect(resolvePeriod('previous-month', oggi)).toEqual({
      from: '2026-06-01',
      to: '2026-06-30'
    });
  });

  it('gli ultimi mesi comprendono quello corrente', () => {
    expect(resolvePeriod('last-3-months', oggi)).toEqual({ from: '2026-05-01', to: '2026-07-31' });
    expect(resolvePeriod('last-6-months', oggi)).toEqual({ from: '2026-02-01', to: '2026-07-31' });
  });

  it('attraversa il capodanno', () => {
    const gennaio = new Date(2026, 0, 10);

    expect(resolvePeriod('previous-month', gennaio)).toEqual({
      from: '2025-12-01',
      to: '2025-12-31'
    });
    expect(resolvePeriod('last-3-months', gennaio)).toEqual({
      from: '2025-11-01',
      to: '2026-01-31'
    });
  });

  it('gestisce febbraio di un anno bisestile', () => {
    expect(resolvePeriod('this-month', new Date(2028, 1, 3))).toEqual({
      from: '2028-02-01',
      to: '2028-02-29'
    });
  });

  it('copre gli anni per intero', () => {
    expect(resolvePeriod('this-year', oggi)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(resolvePeriod('previous-year', oggi)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('"tutto" non pone limiti', () => {
    expect(resolvePeriod('all', oggi)).toEqual({ from: null, to: null });
  });

  it('ogni periodo rapido ha un\'etichetta ed è risolvibile', () => {
    for (const preset of PERIOD_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(() => resolvePeriod(preset.id, oggi)).not.toThrow();
    }
  });
});

describe('matchingPreset', () => {
  it('riconosce il periodo rapido corrispondente a due date', () => {
    for (const preset of PERIOD_PRESETS) {
      expect(matchingPreset(resolvePeriod(preset.id, oggi), oggi)).toBe(preset.id);
    }
  });

  it('due date qualsiasi restano un periodo personalizzato', () => {
    expect(matchingPreset({ from: '2026-03-14', to: '2026-04-02' }, oggi)).toBe('custom');
  });

  it('un solo estremo è un periodo personalizzato', () => {
    expect(matchingPreset({ from: '2026-01-01', to: null }, oggi)).toBe('custom');
  });
});
