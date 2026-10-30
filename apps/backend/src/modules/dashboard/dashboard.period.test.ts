import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clampMonth,
  comparisonWindow,
  defaultMonth,
  monthBounds,
  previousMonth,
} from './dashboard.period.js';

describe('dashboard.period', () => {
  it('previousMonth passa all\'anno prima da gennaio', () => {
    assert.equal(previousMonth('2033-03'), '2033-02');
    assert.equal(previousMonth('2033-01'), '2032-12');
    assert.equal(previousMonth('2033-10'), '2033-09');
  });
  it('defaultMonth usa il mese dell\'ultimo movimento', () =>
    assert.equal(defaultMonth('2026-09-21', '2026-10-13'), '2026-09'));
  it('defaultMonth non va oltre il mese di oggi', () =>
    assert.equal(defaultMonth('2026-12-01', '2026-10-13'), '2026-10'));
  it('defaultMonth senza movimenti è il mese di oggi', () =>
    assert.equal(defaultMonth(null, '2026-10-13'), '2026-10'));
  it('clampMonth riporta un mese futuro a oggi', () => {
    assert.equal(clampMonth('2027-01', '2026-10-13'), '2026-10');
    assert.equal(clampMonth('2026-08', '2026-10-13'), '2026-08');
  });
  it('mese chiuso: mese precedente intero', () =>
    assert.deepEqual(comparisonWindow('2026-09', '2026-10-13'), {
      previousFrom: '2026-08-01',
      previousTo: '2026-08-31',
      currentTo: null,
      partial: false,
    }));
  it('mese in corso: 1–oggi contro lo stesso intervallo', () =>
    assert.deepEqual(comparisonWindow('2026-10', '2026-10-13'), {
      previousFrom: '2026-09-01',
      previousTo: '2026-09-13',
      currentTo: '2026-10-13',
      partial: true,
    }));
  it('mese in corso il 31: il mese precedente si tronca al suo ultimo giorno', () =>
    assert.deepEqual(comparisonWindow('2026-03', '2026-03-31'), {
      previousFrom: '2026-02-01',
      previousTo: '2026-02-28',
      currentTo: '2026-03-31',
      partial: true,
    }));
  it('gennaio si confronta con dicembre dell\'anno prima', () =>
    assert.equal(comparisonWindow('2027-01', '2027-01-10').previousTo, '2026-12-10'));
  it('monthBounds', () =>
    assert.deepEqual(monthBounds('2024-02'), { from: '2024-02-01', to: '2024-02-29' }));
});
