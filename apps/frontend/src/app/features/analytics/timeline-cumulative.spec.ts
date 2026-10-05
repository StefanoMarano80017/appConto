import { TimelineBucket } from './analytics.model';
import { cumulativeNet } from './timeline-cumulative';

const bucket = (period: string, income: number, expenses: number): TimelineBucket => ({
  period,
  partial: false,
  income,
  expenses,
  // Prelievi, prestiti e trasferimenti muovono `netMovement`, non il risultato
  // economico: qui sono diversi da zero apposta, per provare che non entrano.
  withdrawals: -40,
  loans: -250,
  transfers: 100,
  netMovement: income - expenses - 190
});

describe('cumulativeNet', () => {
  it('la variazione è entrate meno uscite, il cumulato la somma dal primo intervallo', () => {
    const result = cumulativeNet([
      bucket('2026-07-06', 1725, 340),
      bucket('2026-07-13', 0, 880.07),
      bucket('2026-07-20', 200, 50)
    ]);

    expect(result).toEqual([
      { change: 1385, cumulative: 1385 },
      { change: -880.07, cumulative: 504.93 },
      { change: 150, cumulative: 654.93 }
    ]);
  });

  it('un cumulato può scendere sotto lo zero e risalire', () => {
    const result = cumulativeNet([
      bucket('2026-07-06', 0, 120.5),
      bucket('2026-07-13', 0, 30),
      bucket('2026-07-20', 500, 0)
    ]);

    expect(result.map((point) => point.cumulative)).toEqual([-120.5, -150.5, 349.5]);
  });

  // Un rimborso netto rende negative le uscite del bucket (magnitudine di
  // spesa, non valore con segno): sottrarle lo fa salire, come deve.
  it('uscite negative per un rimborso netto fanno salire il cumulato', () => {
    expect(cumulativeNet([bucket('2026-07-06', 200, -50)])).toEqual([
      { change: 250, cumulative: 250 }
    ]);
  });

  it('un solo intervallo: variazione e cumulato coincidono', () => {
    expect(cumulativeNet([bucket('2026-07-06', 100, 50)])).toEqual([
      { change: 50, cumulative: 50 }
    ]);
  });

  it('senza intervalli non c’è nulla da sommare', () => {
    expect(cumulativeNet([])).toEqual([]);
  });

  // In virgola mobile 0,1 + 0,2 vale 0,30000000000000004: sommando così, dopo
  // molti intervalli l'ultimo punto si scosterebbe dal KPI «Saldo netto» del
  // periodo. Si accumula in centesimi interi, quindi l'uguaglianza è esatta.
  it('l’ultimo cumulato è esattamente Σentrate − Σuscite, al centesimo', () => {
    const buckets = Array.from({ length: 30 }, (_, index) =>
      bucket(`2026-07-${String(index + 1).padStart(2, '0')}`, 0.1, index % 2 === 0 ? 0.2 : 0.07)
    );

    const result = cumulativeNet(buckets);

    // 30 × 0,10 − (15 × 0,20 + 15 × 0,07) = 3,00 − 4,05.
    expect(result.at(-1)?.cumulative).toBe(-1.05);
    expect(result[0]).toEqual({ change: -0.1, cumulative: -0.1 });
    expect(result[1]).toEqual({ change: 0.03, cumulative: -0.07 });
  });
});
