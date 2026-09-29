import { Component, computed, input, output, signal } from '@angular/core';
import { formatAmount, formatBookingDate } from '../../core/format';
import { Panel } from '../../shared/layout/panel';
import { SectionHeader } from '../../shared/layout/section-header';
import { Amount } from '../../shared/ui/amount';
import { ChoiceGroup } from '../../shared/ui/choice-group';
import { Timeline, TimelineBucket, TimelineGranularity } from './analytics.model';
import { timelineScale } from './timeline-scale';

/** Geometria del disegno, in unità del `viewBox`. */
const VIEW = { width: 760, height: 260 };
const PAD_TOP = 16;
const PAD_BOTTOM = 34;
const PLOT_HEIGHT = VIEW.height - PAD_TOP - PAD_BOTTOM;

/*
 * `pad.right` riserva spazio a `.end-label` (ultimo valore di ogni serie,
 * ancorato a `pad.left + plot.width + 10`). Non è derivato come `pad.left`
 * sotto: la sua unica etichetta non riempiva le 96 unità originarie nemmeno
 * da `caption`, e passando a `financial-row` (v. `analytics-timeline.scss`)
 * resta capiente, con un margine stretto ma non al limite. Il budget di
 * testo che offre, 127 - 10 = 117 unità, va confrontato con quanto costa
 * davvero una stringa come "-12.345,67 €" — 12 caratteri, non 13 — il caso
 * più lungo che questa vista mostri oggi: 12 × `MONO_CHAR_ADVANCE` (9) =
 * 108 unità, lo stesso calcolo che `padLeft` sotto userebbe. Il margine
 * reale è quindi 117 - 108 = 9 unità, poco più di mezzo carattere.
 * Il conto vale per la stringa più lunga di oggi, non per sempre: la forma
 * durevole sarebbe derivare `PAD_RIGHT` come già fa `padLeft`, così un
 * importo a sei cifre non lo scopra in silenzio.
 * Lasciato costante perché qui, a differenza di sinistra, un margine extra
 * non nasconde nulla: l'eccedenza è verso il bordo del `viewBox`, non verso
 * il tracciato.
 *
 * Era 109 finché `financial-row` valeva 12,5px (budget 99, costo 90, stesso
 * margine di 9). Portando il ruolo a 15px il costo è salito a 108, che le 99
 * unità di allora non contenevano: è il modo in cui questa costante "si
 * scopre in silenzio", previsto dal commento sopra e puntualmente accaduto.
 */
const PAD_RIGHT = 127;
/** Distacco fisso fra il tracciato e l'inizio (sinistra) o la fine (destra) di un'etichetta. */
const LABEL_GAP = 10;

/**
 * Avanzamento di un carattere di Geist Mono, in unità di `viewBox`, al corpo
 * del ruolo `financial-row` che `.tick`/`.end-label` usano (15px — v.
 * `_typography.scss`): in un font monospaziato ogni carattere occupa la
 * stessa cella piena, punto delle migliaia, virgola, spazio e simbolo di
 * valuta compresi — circa 0,6em. Non è importabile da `_typography.scss` da
 * qui: se quel ruolo cambia corpo, questa costante va aggiornata a mano.
 *
 * È il motivo per cui `PAD_LEFT` di prima (stimato scalando per il rapporto
 * fra i corpi, 12,5/11, quando `.tick` è passato da `caption`) sottostimava
 * lo spazio: il cambiamento non era di corpo, era di famiglia — dal
 * proporzionale di `caption` al monospaziato di `financial-row`, dove ogni
 * carattere (incluse le quattro cifre "strette" di un importo) vale una
 * cella intera invece di circa metà.
 */
const MONO_CHAR_ADVANCE = 0.6 * 15;

/** Oltre questi punti i pallini su ogni valore diventano rumore. */
const MARKERS_MAX_POINTS = 24;

/** Quante etichette al massimo sull'asse dei tempi, prima di diradarle. */
const MAX_TIME_LABELS = 9;

/**
 * Sotto questa distanza due etichette a fine linea si sovrappongono.
 *
 * Scala con il corpo di `financial-row`, che le compone: era 18 a 12,5px, è 22
 * a 15px. Sbagliare per eccesso fa sparire una coppia di etichette che sarebbe
 * stata leggibile; sbagliare per difetto le fa scrivere una sopra l'altra — il
 * primo errore si nota e si corregge, il secondo sembra un bug del grafico.
 */
const LABEL_COLLISION = 22;

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
  imports: [Panel, SectionHeader, ChoiceGroup, Amount],
  templateUrl: './analytics-timeline.html',
  styleUrl: './analytics-timeline.scss'
})
export class AnalyticsTimeline {
  readonly timeline = input.required<Timeline>();
  readonly granularity = input.required<TimelineGranularity>();

  readonly granularitySelected = output<TimelineGranularity>();

  protected readonly view = VIEW;
  protected readonly granularities = GRANULARITIES;
  protected readonly formatAmount = formatAmount;

  protected readonly subtitle = computed(() => {
    const unit =
      this.granularity() === 'day' ? 'giorno' : this.granularity() === 'week' ? 'settimana' : 'mese';
    return `Stessi movimenti del resto della pagina, raggruppati per ${unit}.`;
  });

  protected readonly hidden = signal<ReadonlySet<SeriesKey>>(new Set(['net']));
  protected readonly hovered = signal<number | null>(null);
  protected readonly showTable = signal(false);

  protected readonly buckets = computed(() => this.timeline().buckets);

  protected readonly series = computed(() =>
    SERIES.map((definition) => ({ ...definition, visible: !this.hidden().has(definition.key) }))
  );

  private readonly visibleSeries = computed(() =>
    this.series().filter(
      (series) =>
        series.visible && this.buckets().some((bucket) => series.value(bucket) !== 0)
    )
  );

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

  /**
   * Larghezza riservata all'etichetta più larga fra le linee guida, in
   * unità di `viewBox`, più il distacco fisso dal tracciato.
   *
   * Dipende da `gridLines()`, non da `pad`/`plot`: se dipendesse da questi
   * ultimi (che a loro volta dipendono da questo valore) sarebbe un ciclo.
   * `y()` per lo stesso motivo non legge `pad`/`plot`: usa le costanti
   * `PAD_TOP`/`PLOT_HEIGHT`, che non dipendono da `padLeft`.
   */
  private readonly padLeft = computed(() => {
    const widest = Math.max(
      0,
      ...this.gridLines().map((line) => formatAmount(line.value).length)
    );

    return Math.ceil(widest * MONO_CHAR_ADVANCE + LABEL_GAP);
  });

  protected readonly pad = computed(() => ({
    top: PAD_TOP,
    right: PAD_RIGHT,
    bottom: PAD_BOTTOM,
    left: this.padLeft()
  }));

  protected readonly plot = computed(() => ({
    width: VIEW.width - this.padLeft() - PAD_RIGHT,
    height: PLOT_HEIGHT
  }));

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

      return last === undefined
        ? []
        : [
            {
              key: series.key,
              label: series.label,
              y: last.y,
              value: this.toDisplaySign(series.key, last.value)
            }
          ];
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
    const plot = this.plot();
    const band = buckets.length <= 1 ? plot.width : plot.width / (buckets.length - 1);
    const inView = (event.offsetX / width) * VIEW.width;
    const index = Math.round((inView - this.pad().left) / band);

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
    const pad = this.pad();
    const plot = this.plot();
    if (buckets.length <= 1) {
      return pad.left + plot.width / 2;
    }

    return pad.left + (index * plot.width) / (buckets.length - 1);
  }

  /**
   * Non legge `pad`/`plot`: userebbe `padLeft`, che dipende da `gridLines()`,
   * che chiama proprio questo metodo. `PAD_TOP`/`PLOT_HEIGHT` non dipendono
   * da `padLeft`, quindi restano le costanti di modulo.
   */
  protected y(value: number): number {
    const { min, max } = this.scale();
    const span = max - min || 1;

    return PAD_TOP + PLOT_HEIGHT * (1 - (value - min) / span);
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

  /**
   * Corregge il segno di una serie per la resa testuale (tooltip, tabella ed
   * etichette di fine linea).
   *
   * `expenses` è una magnitudine di spesa (v. analytics.service, `hasExpense`
   * corto-circuita a vero per ogni `EXPENSE`, rimborsi inclusi), non un
   * valore con segno: un rimborso netto la rende negativa senza che quello
   * significhi un'entrata. Negarla è ciò che permette al tono `'auto'` di
   * `<app-amount>` di dedurre il segno giusto in entrambi i casi. `income` e
   * `net` sono già nella forma corretta e restano invariati.
   *
   * Un solo punto per tooltip, tabella ed `endLabels`, così i tre non possono
   * più mostrare segni diversi per lo stesso valore — come accadeva quando
   * `.end-label` leggeva `series.value` grezzo mentre il tooltip, sullo
   * stesso bucket, passava già da qui: "546,00 €" nell'etichetta e
   * "−546,00 €" nel riquadro, due segni per lo stesso importo.
   *
   * La regola è unica, non un'eccezione per il tooltip: la geometria del
   * grafico (`plotted`/`scale`/`gridLines`, e la `y` di `endLabels`) resta a
   * magnitudini grezze — negarla ribalterebbe la linea "Uscite" sotto lo
   * zero, cambiando la forma del grafico — mentre ogni valore che diventa
   * testo passa da `toDisplaySign`, `endLabels` compreso.
   */
  private toDisplaySign(key: 'income' | 'expenses' | 'net', raw: number): number {
    return key === 'expenses' ? -raw : raw;
  }

  protected value(key: SeriesKey, bucket: TimelineBucket): number {
    const raw = SERIES.find((series) => series.key === key)?.value(bucket) ?? 0;
    return this.toDisplaySign(key, raw);
  }

  /** Gli stessi due totali della tabella, con la stessa correzione di segno di `value()`. */
  protected totalValue(key: 'income' | 'expenses'): number {
    return this.toDisplaySign(key, this.totals()[key]);
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
