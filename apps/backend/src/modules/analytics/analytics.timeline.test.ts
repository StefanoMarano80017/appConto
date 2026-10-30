import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-timeline-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { closeDatabase } = await import('../../db/client.js');
const { buildTimeline, startOfWeek } = await import('./analytics.timeline.js');

after(() => {
  try {
    closeDatabase();
  } finally {
    try {
      rmSync(databaseDir, { recursive: true, force: true });
    } catch {
      // su Windows il file può restare bloccato: è comunque una cartella temporanea
    }
  }
});

const MILLISECONDI_AL_GIORNO = 86_400_000;

describe('passaggio d\'anno e anno bisestile', () => {
  it('il lunedì della settimana cade nell\'anno precedente se il 1 gennaio è un giovedì', () => {
    // Il 1 gennaio 2026 è un giovedì: la sua settimana comincia il 29 dicembre 2025.
    assert.equal(startOfWeek('2026-01-01'), '2025-12-29');
  });

  it('la settimana di un 29 febbraio bisestile comincia il lunedì precedente', () => {
    // Il 29 febbraio 2024 è un giovedì.
    assert.equal(startOfWeek('2024-02-29'), '2024-02-26');
  });

  it('la timeline mensile attraversa il capodanno senza saltare mesi', () => {
    const timeline = buildTimeline([], '2025-11-15', '2026-02-10', 'month', new Map());

    assert.equal(timeline.granularity, 'month');
    assert.deepEqual(
      timeline.buckets.map((bucket) => bucket.period),
      ['2025-11', '2025-12', '2026-01', '2026-02'],
    );
  });

  it('i mesi di estremità sono segnati come parziali, quelli interni no', () => {
    const { buckets } = buildTimeline([], '2025-11-15', '2026-02-10', 'month', new Map());

    assert.deepEqual(
      buckets.map((bucket) => bucket.partial),
      [true, false, false, true],
    );
  });

  it('la timeline settimanale attraverso il capodanno non ha settimane duplicate né mancanti', () => {
    const { granularity, buckets } = buildTimeline(
      [],
      '2025-12-15',
      '2026-01-15',
      'week',
      new Map(),
    );
    const periods = buckets.map((bucket) => bucket.period);

    assert.equal(granularity, 'week');
    assert.deepEqual(periods, ['2025-12-15', '2025-12-22', '2025-12-29', '2026-01-05', '2026-01-12']);
    assert.equal(new Set(periods).size, periods.length, 'nessuna settimana duplicata');

    for (let i = 1; i < periods.length; i += 1) {
      const giorni =
        (new Date(`${periods[i]}T00:00:00Z`).getTime() -
          new Date(`${periods[i - 1]}T00:00:00Z`).getTime()) /
        MILLISECONDI_AL_GIORNO;
      assert.equal(giorni, 7, `fra ${periods[i - 1]} e ${periods[i]}`);
    }
  });
});
