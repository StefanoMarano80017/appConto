import {
  comparisonCaption,
  isStale,
  monthBounds,
  parseMonthParam,
  shiftMonth
} from './dashboard-month';

describe('dashboard-month', () => {
  it('accetta dall\'URL solo un mese valido', () => {
    expect(parseMonthParam('2026-09')).toBe('2026-09');
    expect(parseMonthParam('2026-13')).toBeNull();
    expect(parseMonthParam('abc')).toBeNull();
    expect(parseMonthParam(null)).toBeNull();
  });

  it('sposta il mese attraverso il cambio d\'anno', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('dà primo e ultimo giorno del mese', () => {
    expect(monthBounds('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('dati non aggiornati: ultimo movimento oltre 7 giorni fa, o nessuno', () => {
    expect(isStale('2026-09-21', '2026-10-13')).toBe(true);
    expect(isStale('2026-10-07', '2026-10-13')).toBe(false); // 6 giorni
    expect(isStale('2026-10-06', '2026-10-13')).toBe(false); // 7 giorni
    expect(isStale(null, '2026-10-13')).toBe(true);
  });

  it('descrive la finestra di confronto', () => {
    expect(
      comparisonCaption(
        { previousFrom: '2026-08-01', previousTo: '2026-08-31', currentTo: null, partial: false },
        '2026-08'
      )
    ).toBe('vs agosto');
    expect(
      comparisonCaption(
        { previousFrom: '2026-09-01', previousTo: '2026-09-13', currentTo: '2026-10-13', partial: true },
        '2026-09'
      )
    ).toBe('vs 1–13 set');
  });
});
