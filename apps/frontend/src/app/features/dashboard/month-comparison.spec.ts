import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MonthComparisonSection } from './month-comparison';
import { MonthComparison } from './dashboard.model';

const comparison = (overrides: Partial<MonthComparison> = {}): MonthComparison => ({
  previousMonth: '2026-06',
  currentExpenses: 500,
  previousExpenses: 400,
  difference: 100,
  percentChange: 25,
  byCategory: [],
  ...overrides
});

/**
 * Lancia con un messaggio leggibile invece di lasciare che un `querySelector`
 * mancato produca un `TypeError` a runtime su un `as HTMLElement` cieco
 * (giro di correzione 1, M4): un fallimento qui dice subito cosa non è stato
 * trovato, non "Cannot read properties of undefined".
 */
const required = <T extends Element>(element: T | null | undefined, description: string): T => {
  if (element == null) {
    throw new Error(`atteso: ${description}, trovato: niente`);
  }
  return element;
};

describe('MonthComparisonSection', () => {
  let fixture: ComponentFixture<MonthComparisonSection>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** Il riquadro `.figure` della fascia superiore la cui etichetta è `label`. */
  const figure = (label: string): HTMLElement | undefined =>
    Array.from(host().querySelectorAll<HTMLElement>('.figure')).find(
      (element) => element.querySelector('.label')?.textContent?.trim() === label
    );

  const render = async (data: MonthComparison): Promise<void> => {
    fixture.componentRef.setInput('comparison', data);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MonthComparisonSection] }).compileComponents();
    fixture = TestBed.createComponent(MonthComparisonSection);
  });

  it('le spese del mese si vedono come uscite, non come magnitudini', async () => {
    await render(comparison({ currentExpenses: 340, previousExpenses: 500, difference: -160 }));

    const correnti = required(host().querySelector('[data-test="spese-correnti"]'), 'importo delle spese correnti');

    expect(correnti.textContent).toContain('−340,00');
    expect(correnti.classList.contains('amount-negative')).toBe(true);
  });

  /**
   * Il test che l'inversione richiede: una `difference` positiva è una spesa
   * aumentata, cattiva notizia, e deve leggersi col colore delle uscite
   * (`.up`, rosso) — ma il segno stampato resta quello del valore grezzo
   * (`+100,00`), non quello di un tono imposto a `Amount`. È esattamente il
   * difetto rilevato nel giro di correzione 1 (R33/I2): un tono forzato su
   * `Amount` avrebbe stampato `−100,00` accanto a un `+25%`, due segni
   * opposti per lo stesso fatto.
   */
  it('una variazione positiva (spesa aumentata) mostra "+" e il colore delle uscite, coerente col suo stesso chip', async () => {
    await render(comparison({ difference: 100, percentChange: 25 }));

    const variazione = required(figure('Variazione'), 'la card «Variazione»');
    const value = required(variazione.querySelector('.value'), 'il valore della variazione');

    expect(value.textContent).toContain('+100,00');
    expect(value.textContent).toContain('+25');
    expect(value.classList.contains('up')).toBe(true);
    expect(value.classList.contains('down')).toBe(false);
  });

  it('una variazione negativa (spesa diminuita) mostra "-" e il colore delle entrate', async () => {
    await render(comparison({ difference: -100, percentChange: -20 }));

    const variazione = required(figure('Variazione'), 'la card «Variazione»');
    const value = required(variazione.querySelector('.value'), 'il valore della variazione');

    expect(value.textContent).toContain('-100,00');
    expect(value.textContent).toContain('-20');
    expect(value.classList.contains('down')).toBe(true);
    expect(value.classList.contains('up')).toBe(false);
  });

  /** M5: il ramo neutro di `varianceTone`, mai coperto prima. */
  it('una variazione nulla non prende né il colore delle uscite né quello delle entrate', async () => {
    await render(comparison({ difference: 0, percentChange: 0 }));

    const variazione = required(figure('Variazione'), 'la card «Variazione»');
    const value = required(variazione.querySelector('.value'), 'il valore della variazione');

    expect(value.classList.contains('up')).toBe(false);
    expect(value.classList.contains('down')).toBe(false);
  });

  /**
   * M5: il caso reale «il mese precedente non ha spese»
   * (`dashboard.model.ts:71`), dove il backend non calcola una percentuale.
   * Mostrarne una comunque (es. `0%`) sarebbe un dato falso, non assente.
   */
  it('un mese precedente senza spese non mostra una percentuale non calcolabile', async () => {
    await render(comparison({ percentChange: null }));

    const variazione = required(figure('Variazione'), 'la card «Variazione»');

    expect(variazione.querySelector('small')).toBeNull();
  });

  /**
   * M1: la colonna «mese precedente» deve restare de-enfatizzata (muted)
   * anche se la magnitudine negata la porta a un tono `auto` risolto a
   * `negative` (rosso). `Amount` dichiara il proprio colore su `:host(...)`,
   * di specificità pari a una regola scritta qui senza un antenato di
   * classe — un pareggio che si vince davvero solo nidificando sotto
   * `.figure`/`.categories` (v. commento in month-comparison.scss). Il
   * colore non risolve in questo ambiente di test (nessun `:root` iniettato,
   * v. `shared/styles/tokens.spec.ts`), ma la stringa non risolta del
   * `var()` vincitore lo è comunque: se la specificità perdesse, qui si
   * leggerebbe `var(--color-expense)`, non `var(--color-text-muted)`.
   */
  it('il muted della colonna "mese precedente" vince sul rosso di Amount, nella fascia dei totali', async () => {
    await render(comparison({ previousExpenses: 400 }));

    const variazione = required(figure('Mese precedente'), 'la card «Mese precedente»');
    const previous = required(variazione.querySelector('.previous'), 'l\'importo del mese precedente');

    expect(previous.classList.contains('amount-negative')).toBe(true);
    expect(getComputedStyle(previous).color).toBe('var(--color-text-muted)');
  });

  it('il muted della colonna "mese precedente" vince sul rosso di Amount, nelle righe di categoria', async () => {
    await render(
      comparison({
        byCategory: [
          { id: 'cat-1', name: 'Alimentari', color: null, current: 300, previous: 200, difference: 100 }
        ]
      })
    );

    const previous = required(host().querySelector('.categories .previous'), 'il "previous" di categoria');

    expect(previous.classList.contains('amount-negative')).toBe(true);
    expect(getComputedStyle(previous).color).toBe('var(--color-text-muted)');
  });

  it('una categoria con spesa in aumento mostra la differenza col colore delle uscite', async () => {
    await render(
      comparison({
        byCategory: [
          { id: 'cat-1', name: 'Alimentari', color: null, current: 300, previous: 200, difference: 100 }
        ]
      })
    );

    const difference = required(host().querySelector('.difference'), 'la differenza di categoria');

    expect(difference.classList.contains('up')).toBe(true);
    expect(difference.classList.contains('down')).toBe(false);
  });

  it('mostra il confronto per categoria quando presente', async () => {
    await render(
      comparison({
        byCategory: [
          { id: 'cat-1', name: 'Alimentari', color: null, current: 300, previous: 200, difference: 100 }
        ]
      })
    );

    expect(host().textContent).toContain('Alimentari');
  });

  it('mostra un messaggio quando non ci sono categorie da confrontare', async () => {
    await render(comparison({ byCategory: [] }));

    expect(host().textContent).toContain('Nessuna spesa in nessuno dei due mesi.');
  });
});
