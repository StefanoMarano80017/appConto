/**
 * Scala verticale della spezzata.
 *
 * Gli estremi arrotondati a valori "tondi" e i valori delle linee guida sono una
 * funzione pura dei dati: stanno qui per poter essere verificati senza montare
 * il grafico.
 */

export interface TimelineScale {
  min: number;
  max: number;
  /** Valori delle linee guida, dal basso verso l'alto. */
  ticks: number[];
}

/** Il passo "tondo" più vicino: 1, 2, 2,5 o 5 per una potenza di dieci. */
function niceStep(rough: number): number {
  const exponent = Math.floor(Math.log10(rough));
  const power = 10 ** exponent;
  const fraction = rough / power;

  if (fraction <= 1) {
    return power;
  }
  if (fraction <= 2) {
    return 2 * power;
  }
  if (fraction <= 2.5) {
    return 2.5 * power;
  }
  if (fraction <= 5) {
    return 5 * power;
  }

  return 10 * power;
}

/**
 * La scala che contiene i valori indicati.
 *
 * Lo zero è sempre compreso: su una serie di importi nel tempo una base che non
 * parte da zero esagera le variazioni.
 */
export function timelineScale(values: readonly number[], targetTicks = 4): TimelineScale {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);

  if (min === 0 && max === 0) {
    return { min: 0, max: 1, ticks: [0, 1] };
  }

  const step = niceStep((max - min) / Math.max(targetTicks, 1));
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  // Il confronto con mezzo passo di margine tiene fuori gli errori di virgola mobile.
  for (let tick = niceMin; tick <= niceMax + step / 2; tick += step) {
    ticks.push(Math.round(tick * 100) / 100);
  }

  return { min: niceMin, max: niceMax, ticks };
}
