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

describe('MonthComparisonSection', () => {
  let fixture: ComponentFixture<MonthComparisonSection>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** La card della fascia superiore il cui titolo corrisponde a `label`. */
  const card = (label: string): HTMLElement | undefined =>
    Array.from(host().querySelectorAll<HTMLElement>('.card')).find(
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

    const amount = card('Spese del mese')?.querySelector('app-amount') as HTMLElement;

    expect(amount.textContent).toContain('−340,00');
    expect(amount.classList.contains('amount-negative')).toBe(true);
  });

  /**
   * Il test che l'inversione richiede: una `difference` positiva è una spesa
   * aumentata, cattiva notizia, e deve rendere col tono delle uscite
   * (`amount-negative`, rosso) — non con quello delle entrate che un tono
   * `auto` dedurrebbe leggendo il segno grezzo. Verificare solo il testo
   * (`−100,00`) non basterebbe: passerebbe identico anche se il tono fosse
   * quello sbagliato, perché il segno mostrato segue comunque il tono
   * risolto e non il segno grezzo del valore (v. amount.ts).
   */
  it('una variazione positiva (spesa aumentata) prende il tono delle uscite, non delle entrate', async () => {
    await render(comparison({ difference: 100, percentChange: 25 }));

    const amount = card('Variazione')?.querySelector('app-amount') as HTMLElement;

    expect(amount.classList.contains('amount-negative')).toBe(true);
    expect(amount.classList.contains('amount-positive')).toBe(false);
  });

  it('una variazione negativa (spesa diminuita) prende il tono delle entrate', async () => {
    await render(comparison({ difference: -100, percentChange: -20 }));

    const amount = card('Variazione')?.querySelector('app-amount') as HTMLElement;

    expect(amount.classList.contains('amount-positive')).toBe(true);
    expect(amount.classList.contains('amount-negative')).toBe(false);
  });

  it('il chip della variazione segue la stessa inversione, non il segno della percentuale', async () => {
    await render(comparison({ difference: 100, percentChange: 25 }));

    const chip = card('Variazione')?.querySelector('.delta') as HTMLElement;

    expect(chip.classList.contains('delta-negative')).toBe(true);
    expect(chip.textContent).toContain('+25');
  });

  it('una categoria con spesa in aumento mostra la differenza col tono delle uscite', async () => {
    await render(
      comparison({
        byCategory: [
          { id: 'cat-1', name: 'Alimentari', color: null, current: 300, previous: 200, difference: 100 }
        ]
      })
    );

    const difference = host().querySelector('.difference') as HTMLElement;

    expect(difference.classList.contains('amount-negative')).toBe(true);
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
