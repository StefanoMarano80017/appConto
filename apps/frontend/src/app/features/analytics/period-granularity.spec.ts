import { comfortableGranularity } from './period-granularity';

describe('comfortableGranularity', () => {
  it('un solo giorno si legge per giorni', () => {
    expect(comfortableGranularity({ from: '2026-07-06', to: '2026-07-06' })).toBe('day');
  });

  it('una settimana si legge per giorni', () => {
    expect(comfortableGranularity({ from: '2026-07-06', to: '2026-07-12' })).toBe('day');
  });

  it('31 giorni sono ancora per giorni', () => {
    expect(comfortableGranularity({ from: '2026-01-01', to: '2026-01-31' })).toBe('day');
  });

  it('32 giorni passano alle settimane', () => {
    expect(comfortableGranularity({ from: '2026-01-01', to: '2026-02-01' })).toBe('week');
  });

  it('186 giorni sono ancora per settimane', () => {
    expect(comfortableGranularity({ from: '2026-01-01', to: '2026-07-05' })).toBe('week');
  });

  it('187 giorni passano ai mesi', () => {
    expect(comfortableGranularity({ from: '2026-01-01', to: '2026-07-06' })).toBe('month');
  });

  it('un anno intero si legge per mesi', () => {
    expect(comfortableGranularity({ from: '2026-01-01', to: '2026-12-31' })).toBe('month');
  });

  it('con un estremo aperto si legge per mesi', () => {
    expect(comfortableGranularity({ from: null, to: '2026-12-31' })).toBe('month');
    expect(comfortableGranularity({ from: '2026-01-01', to: null })).toBe('month');
  });
});
