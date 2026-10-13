import { niceScale } from './value-scale';

describe('niceScale', () => {
  it('parte sempre da zero: una base diversa esagera le variazioni', () => {
    const scale = niceScale([1200, 1500, 1800]);

    expect(scale.min).toBe(0);
    expect(scale.max).toBeGreaterThanOrEqual(1800);
  });

  it('arrotonda gli estremi a valori tondi', () => {
    expect(niceScale([0, 1886.57]).max).toBe(2000);
    expect(niceScale([0, 37]).max).toBe(40);
    expect(niceScale([0, 4]).max).toBe(4);
  });

  it('le linee guida sono equidistanti e comprendono gli estremi', () => {
    const { min, max, ticks } = niceScale([0, 1886.57]);

    expect(ticks[0]).toBe(min);
    expect(ticks.at(-1)).toBe(max);

    const passi = ticks.slice(1).map((tick, index) => tick - (ticks[index] ?? 0));
    expect(new Set(passi.map((passo) => Math.round(passo * 100))).size).toBe(1);
  });

  it('comprende lo zero anche con valori negativi', () => {
    const scale = niceScale([-450, -120, 300]);

    expect(scale.min).toBeLessThanOrEqual(-450);
    expect(scale.max).toBeGreaterThanOrEqual(300);
    expect(scale.ticks).toContain(0);
  });

  it('tutto a zero resta una scala usabile', () => {
    expect(niceScale([0, 0, 0])).toEqual({ min: 0, max: 1, ticks: [0, 1] });
    expect(niceScale([])).toEqual({ min: 0, max: 1, ticks: [0, 1] });
  });

  it('produce un numero di linee guida ragionevole', () => {
    for (const massimo of [9, 87, 350, 1886.57, 12658.14, 250000]) {
      const ticks = niceScale([0, massimo]).ticks;

      expect(ticks.length).toBeGreaterThanOrEqual(3);
      expect(ticks.length).toBeLessThanOrEqual(8);
    }
  });

  it('non allunga l’asse fino al tick tondo se i dati ne restano lontani', () => {
    const scale = niceScale([-69, 4000, 9830]);

    // Prima il minimo diventava -5000: un terzo dell'altezza sprecato.
    expect(scale.min).toBeGreaterThanOrEqual(-600);
    expect(scale.min).toBeLessThan(-69);
    expect(scale.max).toBeGreaterThanOrEqual(9830);
    expect(scale.ticks).toEqual([0, 2500, 5000, 7500, 10000]);
  });

  it('con soli valori non negativi il minimo resta zero', () => {
    expect(niceScale([0, 120, 480]).min).toBe(0);
    expect(niceScale([300, 900]).min).toBe(0);
  });

  it('le linee guida cadono dentro l’intervallo dell’asse', () => {
    const { min, max, ticks } = niceScale([-69, 9830]);

    for (const tick of ticks) {
      expect(tick).toBeGreaterThanOrEqual(min);
      expect(tick).toBeLessThanOrEqual(max);
    }
  });
});
