import { Component, computed, input, output, signal } from '@angular/core';
import { formatAmount, formatBookingDate } from '../../core/format';
import { Timeline, TimelineBucket, TimelineGranularity } from './analytics.model';
import { timelineScale } from './timeline-scale';

/** Geometria del disegno, in unità del `viewBox`. */
const VIEW = { width: 760, height: 260 };
const PAD = { top: 16, right: 96, bottom: 34, left: 60 };
const PLOT = {
  width: VIEW.width - PAD.left - PAD.right,
  height: VIEW.height - PAD.top - PAD.bottom
};

/** Oltre questi punti i pallini su ogni valore diventano rumore. */
const MARKERS_MAX_POINTS = 24;

/** Quante etichette al massimo sull'asse dei tempi, prima di diradarle. */
const MAX_TIME_LABELS = 9;

/** Sotto questa distanza due etichette a fine linea si sovrappongono. */
const LABEL_COLLISION = 18;

const shortMonth = new Intl.DateTimeFormat('it-IT', { month: 'short', year: '2-digit' });
const shortDay = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit' });
const longDay = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long' });
const longMonth = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });

export type SeriesKey = 'income' | 'expenses' | 'net';

interface SeriesDefinition {
  key: SeriesKey;
  label: string;
  value: (bucket: TimelineBucket) => number;
}

/**
 * Le serie disponibili.
 *
 * Entrate e uscite sono attive di partenza; il saldo netto si aggiunge su
 * richiesta. Il colore non è qui: lo assegna il CSS per chiave, così una serie
 * nascosta non ridipinge le altre.
 */
const SERIES: readonly SeriesDefinition[] = [
  { key: 'income', label: 'Entrate', value: (bucket) => bucket.income },
  { key: 'expenses', label: 'Uscite', value: (bucket) => bucket.expenses },
  { key: 'net', label: 'Saldo netto', value: (bucket) => bucket.netMovement }
];

const GRANULARITIES: readonly { id: TimelineGranularity; label: string }[] = [
  { id: 'day', label: 'Giorno' },
  { id: 'week', label: 'Settimana' },
  { id: 'month', label: 'Mese' }
];

interface Point {
  x: number;
  y: number;
  value: number;
  partial: boolean;
  /** Un pallino su ogni punto è rumore: si disegna dove serve. */
  marked: boolean;
}

interface PlottedSeries {
  key: SeriesKey;
  label: string;
  points: Point[];
  /** Attributo `points` della spezzata. */
  path: string;
}

/**
 * Andamento nel tempo, come spezzata.
 *
 * Rappresenta lo stesso insieme filtrato di tutta la pagina: il passo cambia
 * soltanto quanto sono larghi gli intervalli, non quali movimenti entrano nel
 * conto. Gli intervalli coperti solo in parte sono segnati, perché altrimenti
 * l'ultimo punto si leggerebbe come un calo.
 */
@Component({
  selector: 'app-analytics-timeline',
  templateUrl: './analytics-timeline.html',
  styleUrl: './analytics-timeline.scss'
})
export class AnalyticsTimeline {
  readonly timeline = input.required<Timeline>();
  readonly granularity = input.required<TimelineGranularity>();

  readonly granularitySelected = output<TimelineGranularity>();

  protected readonly view = VIEW;
  protected readonly pad = PAD;
  protected readonly plot = PLOT;
  protected readonly granularities = GRANULARITIES;
  protected readonly formatAmount = formatAmount;

  protected readonly hidden = signal<ReadonlySet<SeriesKey>>(new Set(['net']));
  protected readonly hovered = signal<number | null>(null);
  protected readonly showTable = signal(false);

  protected readonly buckets = computed(() => this.timeline().buckets);

  protected readonly series = computed(() =>
    SERIES.map((definition) => ({ ...definition, visible: !this.hidden().has(definition.key) }))
  );

  private readonly visibleSeries = computed(() => this.series().filter((s) => s.visible));

  protected readonly scale = computed(() =>
    timelineScale(
      this.visibleSeries().flatMap((series) => this.buckets().map((bucket) => series.value(bucket)))
    )
  );

  protected readonly totals = computed(() =>
    this.buckets().reduce(
      (totals, bucket) => ({
        income: totals.income + bucket.income,
        expenses: totals.expenses + bucket.expenses
      }),
      { income: 0, expenses: 0 }
    )
  );

  protected readonly hasPartial = computed(() => this.buckets().some((bucket) => bucket.partial));

  /** Le linee guida orizzontali, con il valore e la quota a cui disegnarle. */
  protected readonly gridLines = computed(() =>
    this.scale().ticks.map((value) => ({ value, y: this.y(value) }))
  );

  protected readonly plotted = computed<PlottedSeries[]>(() => {
    const buckets = this.buckets();
    const showAllMarkers = buckets.length <= MARKERS_MAX_POINTS;
    const hovered = this.hovered();

    return this.visibleSeries().map((series) => {
      const points = buckets.map((bucket, index): Point => {
        const value = series.value(bucket);

        return {
          x: this.x(index),
          y: this.y(value),
          value,
          partial: bucket.partial,
          marked:
            showAllMarkers ||
            bucket.partial ||
            index === 0 ||
            index === buckets.length - 1 ||
            index === hovered
        };
      });

      return {
        key: series.key,
        label: series.label,
        points,
        path: points.map((point) => `${point.x},${point.y}`).join(' ')
      };
    });
  });

  /**
   * Le etichette a fine linea.
   *
   * Quando due linee arrivano vicine le etichette si sovrappongono: invece di
   * scostarle — staccandole dalla propria linea — si rinuncia, e a dire chi è
   * chi restano la legenda e il riquadro al passaggio del mouse.
   */
  protected readonly endLabels = computed(() => {
    const labels = this.plotted().flatMap((series) => {
      const last = series.points.at(-1);

      return last === undefined ? [] : [{ key: series.key, label: series.label, y: last.y, value: last.value }];
    });

    const sorted = [...labels].sort((a, b) => a.y - b.y);
    const collide = sorted.some(
      (label, index) => index > 0 && label.y - (sorted[index - 1]?.y ?? 0) < LABEL_COLLISION
    );

    return collide ? [] : labels;
  });

  /** Etichette dell'asse dei tempi, diradate quanto serve per non sovrapporsi. */
  protected readonly timeLabels = computed(() => {
    const buckets = this.buckets();
    const step = Math.max(Math.ceil(buckets.length / MAX_TIME_LABELS), 1);
    const last = buckets.length - 1;

    const indices: number[] = [];
    for (let index = 0; index < buckets.length; index += step) {
      indices.push(index);
    }

    /*
     * L'ultimo intervallo merita l'etichetta, ma se cade a ridosso di quella
     * prima le due si scrivono una sopra l'altra: in quel caso la sostituisce.
     */
    const previous = indices.at(-1) ?? 0;
    if (previous !== last) {
      if (last - previous < step / 2) {
        indices[indices.length - 1] = last;
      } else {
        indices.push(last);
      }
    }

    return indices.flatMap((index) => {
      const bucket = buckets[index];

      return bucket === undefined
        ? []
        : [{ x: this.x(index), label: this.shortLabel(bucket) }];
    });
  });

  protected readonly hoveredBucket = computed(() => {
    const index = this.hovered();

    return index === null ? null : (this.buckets()[index] ?? null);
  });

  /**
   * L'intervallo più vicino alla posizione del puntatore.
   *
   * La mira è l'intervallo, non la linea: chi guarda punta una data, non due
   * pixel di tratto.
   */
  protected onPointerMove(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    const width = target.clientWidth;
    if (width === 0) {
      return;
    }

    const buckets = this.buckets();
    const band = buckets.length <= 1 ? PLOT.width : PLOT.width / (buckets.length - 1);
    const inView = (event.offsetX / width) * VIEW.width;
    const index = Math.round((inView - PAD.left) / band);

    this.hovered.set(Math.min(Math.max(index, 0), buckets.length - 1));
  }

  /** Da tastiera si scorre con le freccie: un solo punto di tabulazione, non uno per punto. */
  protected onKeyDown(event: KeyboardEvent): void {
    const last = this.buckets().length - 1;
    const current = this.hovered() ?? 0;

    const next = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: last
    }[event.key];

    if (next === undefined) {
      return;
    }

    event.preventDefault();
    this.hovered.set(Math.min(Math.max(next, 0), last));
  }

  protected x(index: number): number {
    const buckets = this.buckets();
    if (buckets.length <= 1) {
      return PAD.left + PLOT.width / 2;
    }

    return PAD.left + (index * PLOT.width) / (buckets.length - 1);
  }

  protected y(value: number): number {
    const { min, max } = this.scale();
    const span = max - min || 1;

    return PAD.top + PLOT.height * (1 - (value - min) / span);
  }

  /** `06/07` a giorni e settimane, `lug 26` a mesi. */
  protected shortLabel(bucket: TimelineBucket): string {
    return this.granularity() === 'month'
      ? shortMonth.format(new Date(`${bucket.period}-01T00:00:00`))
      : shortDay.format(new Date(`${bucket.period}T00:00:00`));
  }

  /** L'intervallo per esteso: `settimana del 6 luglio`, `luglio 2026`, `06/07/2026`. */
  protected longLabel(bucket: TimelineBucket): string {
    if (this.granularity() === 'month') {
      return longMonth.format(new Date(`${bucket.period}-01T00:00:00`));
    }
    if (this.granularity() === 'week') {
      return `settimana del ${longDay.format(new Date(`${bucket.period}T00:00:00`))}`;
    }

    return formatBookingDate(bucket.period);
  }

  protected value(key: SeriesKey, bucket: TimelineBucket): number {
    return SERIES.find((series) => series.key === key)?.value(bucket) ?? 0;
  }

  /** L'ultima serie visibile non si nasconde: un grafico vuoto non dice nulla. */
  protected toggleSeries(key: SeriesKey): void {
    const hidden = new Set(this.hidden());
    if (hidden.has(key)) {
      hidden.delete(key);
    } else if (this.visibleSeries().length > 1) {
      hidden.add(key);
    }

    this.hidden.set(hidden);
  }
}
