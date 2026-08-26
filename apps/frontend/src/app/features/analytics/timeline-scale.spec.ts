import { timelineScale } from './timeline-scale';

describe('timelineScale', () => {
  it('parte sempre da zero: una base diversa esagera le variazioni', () => {
    const scale = timelineScale([1200, 1500, 1800]);

    expect(scale.min).toBe(0);
    expect(scale.max).toBeGreaterThanOrEqual(1800);
  });

  it('arrotonda gli estremi a valori tondi', () => {
    expect(timelineScale([0, 1886.57]).max).toBe(2000);
    expect(timelineScale([0, 37]).max).toBe(40);
    expect(timelineScale([0, 4]).max).toBe(4);
  });

  it('le linee guida sono equidistanti e comprendono gli estremi', () => {
    const { min, max, ticks } = timelineScale([0, 1886.57]);

    expect(ticks[0]).toBe(min);
    expect(ticks.at(-1)).toBe(max);

    const passi = ticks.slice(1).map((tick, index) => tick - (ticks[index] ?? 0));
    expect(new Set(passi.map((passo) => Math.round(passo * 100))).size).toBe(1);
  });

  it('comprende lo zero anche con valori negativi', () => {
    const scale = timelineScale([-450, -120, 300]);

    expect(scale.min).toBeLessThanOrEqual(-450);
    expect(scale.max).toBeGreaterThanOrEqual(300);
    expect(scale.ticks).toContain(0);
  });

  it('tutto a zero resta una scala usabile', () => {
    expect(timelineScale([0, 0, 0])).toEqual({ min: 0, max: 1, ticks: [0, 1] });
    expect(timelineScale([])).toEqual({ min: 0, max: 1, ticks: [0, 1] });
  });

  it('produce un numero di linee guida ragionevole', () => {
    for (const massimo of [9, 87, 350, 1886.57, 12658.14, 250000]) {
      const ticks = timelineScale([0, massimo]).ticks;

      expect(ticks.length).toBeGreaterThanOrEqual(3);
      expect(ticks.length).toBeLessThanOrEqual(8);
    }
  });
});
