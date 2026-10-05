import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { formatBookingDate } from '../../core/format';
import { DateRange } from '../../core/period';
import { Panel } from '../../shared/layout/panel';
import { SectionHeader } from '../../shared/layout/section-header';
import { Amount } from '../../shared/ui/amount';
import { LineChart } from '../../shared/ui/chart/line-chart';
import {
  chartColorVar,
  type LinePointMarker,
  type LineSeries,
} from '../../shared/ui/chart/line-chart.model';
import { ChoiceGroup } from '../../shared/ui/choice-group';
import { Timeline, TimelineBucket, TimelineGranularity } from './analytics.model';

const shortMonth = new Intl.DateTimeFormat('it-IT', { month: 'short', year: '2-digit' });
const shortDay = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit' });
const longDay = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long' });
const longMonth = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });

/** L'ordine è anche l'ordine della legenda, del grafico e delle colonne in tabella. */
const SERIES_KEYS = ['income', 'expenses', 'net'] as const;

export type SeriesKey = (typeof SERIES_KEYS)[number];

type SeriesSpec = Omit<LineSeries<TimelineBucket, SeriesKey>, 'key'> & {
  /**
   * Segno della resa testuale (tooltip e tabella).
   *
   * `expenses` è una magnitudine di spesa (v. analytics.service, `hasExpense`
   * corto-circuita a vero per ogni `EXPENSE`, rimborsi inclusi), non un
   * valore con segno: un rimborso netto la rende negativa senza che quello
   * significhi un'entrata. Negarla è ciò che permette al tono `'auto'` di
   * `<app-amount>` di dedurre il segno giusto in entrambi i casi. `income` e
   * `net` sono già nella forma corretta e restano invariati.
   *
   * Il grafico conserva la magnitudine grezza; tooltip e tabella passano da
   * `rows`, così un rimborso netto mantiene lo stesso segno in entrambi.
   */
  readonly sign: 1 | -1;
  /** La colonna ha il totale in fondo alla tabella; il saldo netto no, come prima. */
  readonly total: boolean;
};

/**
 * Le serie disponibili.
 *
 * Entrate e uscite sono attive di partenza; il saldo netto si aggiunge su
 * richiesta. L'ordine di legenda e grafico lo dà `SERIES_KEYS`.
 */
const SERIES = {
  income: {
    label: 'Entrate',
    color: 'chart-1',
    value: (bucket) => bucket.income,
    sign: 1,
    total: true,
  },
  expenses: {
    label: 'Uscite',
    color: 'chart-5',
    value: (bucket) => bucket.expenses,
    sign: -1,
    total: true,
  },
  net: {
    label: 'Saldo netto',
    color: 'chart-3',
    value: (bucket) => bucket.netMovement,
    sign: 1,
    total: false,
  },
} satisfies Record<SeriesKey, SeriesSpec>;

function addUtcDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/** Tutto ciò che dipende dal passo: come si legge `bucket.period` e che intervallo copre. */
interface GranularitySpec {
  readonly label: string;
  /** Il nome dell'intervallo nel sottotitolo. */
  readonly unit: string;
  readonly short: (period: string) => string;
  readonly long: (period: string) => string;
  readonly range: (period: string) => DateRange;
}

const GRANULARITY: Record<TimelineGranularity, GranularitySpec> = {
  day: {
    label: 'Giorno',
    unit: 'giorno',
    short: (period) => shortDay.format(new Date(`${period}T00:00:00`)),
    long: (period) => formatBookingDate(period),
    range: (period) => ({ from: period, to: period }),
  },
  week: {
    label: 'Settimana',
    unit: 'settimana',
    short: (period) => shortDay.format(new Date(`${period}T00:00:00`)),
    long: (period) => `settimana del ${longDay.format(new Date(`${period}T00:00:00`))}`,
    range: (period) => ({ from: period, to: addUtcDays(period, 6) }),
  },
  month: {
    label: 'Mese',
    unit: 'mese',
    short: (period) => shortMonth.format(new Date(`${period}-01T00:00:00`)),
    long: (period) => longMonth.format(new Date(`${period}-01T00:00:00`)),
    range: (period) => {
      const [year, month] = period.split('-').map(Number) as [number, number];
      return {
        from: `${period}-01`,
        to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
      };
    },
  },
};

/** L'ordine è quello della scelta del passo. */
const GRANULARITIES: readonly { id: TimelineGranularity; label: string }[] = (
  ['day', 'week', 'month'] as const
).map((id) => ({ id, label: GRANULARITY[id].label }));

/** Un intervallo coperto solo in parte ha sempre il punto vuoto, qualunque sia la densità. */
function partialMarker(bucket: TimelineBucket): LinePointMarker {
  return bucket.partial ? 'hollow' : 'auto';
}

/** Una riga di tabella e di riquadro, con i valori già nel segno della resa testuale. */
interface TimelineRow {
  readonly bucket: TimelineBucket;
  readonly label: string;
  /** Allineati a `SERIES_KEYS`. */
  readonly values: readonly number[];
}

/**
 * Il bucket scelto sul grafico: il passo con cui si leggono i bucket mostrati,
 * il suo periodo, l'intervallo che copre e l'etichetta che lo racconta.
 */
export interface TimelineSelection {
  readonly granularity: TimelineGranularity;
  readonly period: string;
  readonly range: DateRange;
  readonly label: string;
}

/**
 * Andamento nel tempo, come grafico a linee.
 *
 * Rappresenta lo stesso insieme filtrato di tutta la pagina: il passo cambia
 * soltanto quanto sono larghi gli intervalli, non quali movimenti entrano nel
 * conto. Gli intervalli coperti solo in parte sono segnati, perché altrimenti
 * l'ultimo punto si leggerebbe come un calo.
 *
 * Disegno e interazione stanno in `<app-line-chart>`; qui resta il dominio:
 * quali serie, che cosa vuol dire il punto selezionato e il riquadro che lo
 * racconta.
 *
 * I bucket si leggono sempre col passo di `timeline().granularity`, non con
 * l'input `granularity`: la pagina cambia il passo subito ma tiene i dati
 * vecchi finché arrivano i nuovi, e un `YYYY-MM` letto come giorno è una data
 * non valida. L'input guida soltanto la scelta mostrata e il sottotitolo.
 */
@Component({
  selector: 'app-analytics-timeline',
  imports: [Panel, SectionHeader, ChoiceGroup, Amount, LineChart],
  templateUrl: './analytics-timeline.html',
  styleUrl: './analytics-timeline.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsTimeline {
  readonly timeline = input.required<Timeline>();
  readonly granularity = input.required<TimelineGranularity>();

  readonly granularitySelected = output<TimelineGranularity>();
  /** «Filtra su questo periodo»: chi usa il grafico porta il periodo dell'analisi sul bucket. */
  readonly periodSelected = output<TimelineSelection>();

  protected readonly granularities = GRANULARITIES;
  protected readonly partialMarker = partialMarker;
  protected readonly chartColor = chartColorVar;

  protected readonly subtitle = computed(
    () =>
      `Stessi movimenti del resto della pagina, raggruppati per ${GRANULARITY[this.granularity()].unit}.`,
  );

  protected readonly hidden = signal<ReadonlySet<SeriesKey>>(new Set(['net']));
  protected readonly selectedIndex = signal<number | null>(null);
  protected readonly showTable = signal(false);

  protected readonly buckets = computed(() => this.timeline().buckets);

  /** Il passo con cui sono stati calcolati i bucket. */
  private readonly step = computed(() => GRANULARITY[this.timeline().granularity]);

  protected readonly series = computed(() =>
    SERIES_KEYS.map((key) => ({
      key,
      ...SERIES[key],
      visible: !this.hidden().has(key),
    })),
  );

  /** Le serie con almeno un valore: dipende solo dai bucket, non da che cosa è acceso. */
  private readonly nonEmptyKeys = computed(
    () =>
      new Set(
        SERIES_KEYS.filter((key) =>
          this.buckets().some((bucket) => SERIES[key].value(bucket) !== 0),
        ),
      ),
  );

  /** Le serie accese e con almeno un valore: una linea piatta sullo zero non dice nulla. */
  protected readonly drawnSeries = computed(() =>
    this.series().filter((series) => series.visible && this.nonEmptyKeys().has(series.key)),
  );

  /** Una funzione nuova a ogni cambio di passo: così il grafico rilegge le etichette. */
  protected readonly xAxisLabel = computed(() => {
    const short = this.step().short;
    return (bucket: TimelineBucket) => short(bucket.period);
  });

  protected readonly ariaLabel = computed(
    () =>
      `Andamento nel tempo su ${this.buckets().length} intervalli. I valori sono disponibili anche nella tabella.`,
  );

  /** Un solo punto per tabella e riquadro: stessa etichetta, stesso segno. */
  protected readonly rows = computed<readonly TimelineRow[]>(() => {
    const long = this.step().long;
    return this.buckets().map((bucket) => ({
      bucket,
      label: long(bucket.period),
      values: SERIES_KEYS.map((key) => SERIES[key].sign * SERIES[key].value(bucket)),
    }));
  });

  /** Allineati a `SERIES_KEYS`, già col segno; `null` dove la colonna non ha totale. */
  protected readonly totals = computed<readonly (number | null)[]>(() =>
    SERIES_KEYS.map((key, index) =>
      SERIES[key].total
        ? this.rows().reduce((sum, row) => sum + (row.values[index] ?? 0), 0)
        : null,
    ),
  );

  protected readonly hasPartial = computed(() => this.buckets().some((bucket) => bucket.partial));

  protected readonly selectedRow = computed(() => {
    const index = this.selectedIndex();
    return index === null ? null : (this.rows()[index] ?? null);
  });

  protected readonly tooltipPosition = computed(() => {
    const lastIndex = this.buckets().length - 1;

    if (lastIndex <= 0) {
      return { left: 50, side: 'right' as const };
    }

    const ratio = (this.selectedIndex() ?? 0) / lastIndex;

    return {
      left: ratio * 100,
      side: ratio > 0.55 ? ('left' as const) : ('right' as const),
    };
  });

  protected closeTooltip(): void {
    this.selectedIndex.set(null);
  }

  protected selectBucketPeriod(bucket: TimelineBucket): void {
    const granularity = this.timeline().granularity;
    const step = this.step();
    this.periodSelected.emit({
      granularity,
      period: bucket.period,
      range: step.range(bucket.period),
      label: step.long(bucket.period),
    });
  }

  /** L'ultima serie visibile non si nasconde: un grafico vuoto non dice nulla. */
  protected toggleSeries(key: SeriesKey): void {
    const hidden = new Set(this.hidden());
    if (hidden.has(key)) {
      hidden.delete(key);
    } else if (this.drawnSeries().length > 1) {
      hidden.add(key);
    }

    this.hidden.set(hidden);
  }
}
