import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Amount } from './amount';

describe('Amount', () => {
  let fixture: ComponentFixture<Amount>;

  const render = async (
    value: number,
    tone?: 'auto' | 'neutral' | 'positive' | 'negative',
    size?: 'row' | 'kpi'
  ) => {
    fixture = TestBed.createComponent(Amount);
    fixture.componentRef.setInput('value', value);
    if (tone !== undefined) {
      fixture.componentRef.setInput('tone', tone);
    }
    if (size !== undefined) {
      fixture.componentRef.setInput('size', size);
    }
    await fixture.whenStable();
  };

  // Il componente non ha elemento interno: stile e testo stanno sull'host.
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => (el().textContent ?? '').trim();

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Amount] }).compileComponents();
  });

  it('antepone il segno piu a un importo positivo', async () => {
    await render(1647.3);

    expect(text().startsWith('+')).toBe(true);
    expect(el().classList.contains('amount-positive')).toBe(true);
  });

  it('antepone il segno meno a un importo negativo', async () => {
    await render(-892.1);

    expect(text().startsWith('−')).toBe(true);
    expect(el().classList.contains('amount-negative')).toBe(true);
    // Il meno è il nostro, non quello di Intl: un solo segno, non due.
    expect(text()).not.toContain('-');
  });

  it('non aggiunge alcun segno a un importo neutro', async () => {
    await render(1200, 'neutral');

    expect(text().startsWith('+')).toBe(false);
    expect(el().classList.contains('amount-positive')).toBe(false);
    expect(el().classList.contains('amount-negative')).toBe(false);
  });

  // Uno zero non è né entrata né uscita.
  it('non aggiunge segno ne colore a un importo pari a zero', async () => {
    await render(0);

    expect(text().startsWith('+')).toBe(false);
    expect(text().startsWith('−')).toBe(false);
    expect(el().classList.contains('amount-positive')).toBe(false);
    expect(el().classList.contains('amount-negative')).toBe(false);
  });

  it('rispetta un tono imposto dall esterno', async () => {
    await render(1500, 'negative');

    expect(el().classList.contains('amount-negative')).toBe(true);
    expect(text().startsWith('−')).toBe(true);
  });

  // Un tono forzato non può far mentire uno zero: niente segno, niente
  // classe di tono, qualunque cosa chieda il chiamante.
  it('resta neutro su uno zero anche con un tono positivo imposto', async () => {
    await render(0, 'positive');

    expect(text().startsWith('+')).toBe(false);
    expect(text().startsWith('−')).toBe(false);
    expect(el().classList.contains('amount-positive')).toBe(false);
    expect(el().classList.contains('amount-negative')).toBe(false);
  });

  it('resta neutro su uno zero anche con un tono negativo imposto', async () => {
    await render(0, 'negative');

    expect(text().startsWith('+')).toBe(false);
    expect(text().startsWith('−')).toBe(false);
    expect(el().classList.contains('amount-positive')).toBe(false);
    expect(el().classList.contains('amount-negative')).toBe(false);
  });

  // Il ramo neutro non deve ereditare il trattino ASCII di Intl: in una
  // colonna tabular-nums avrebbe una larghezza diversa dal nostro U+2212.
  it('normalizza al meno tipografico un importo negativo reso neutro', async () => {
    await render(-892.1, 'neutral');

    expect(text()).not.toContain('-');
    expect(el().classList.contains('amount-positive')).toBe(false);
    expect(el().classList.contains('amount-negative')).toBe(false);
  });

  // -0 non è né > 0 né < 0: senza normalizzazione Intl lo formatta come
  // "-0,00 €", un segno negativo su un valore che non ha direzione.
  it('non mostra un segno negativo su uno zero negativo', async () => {
    await render(-0);

    expect(text().startsWith('−')).toBe(false);
    expect(text()).not.toContain('-');
    expect(el().classList.contains('amount-negative')).toBe(false);
  });

  it('applica la classe amount-row per default', async () => {
    await render(1000);

    expect(el().classList.contains('amount-row')).toBe(true);
    expect(el().classList.contains('amount-kpi')).toBe(false);
  });

  it('applica la classe amount-kpi quando richiesta', async () => {
    await render(1000, undefined, 'kpi');

    expect(el().classList.contains('amount-kpi')).toBe(true);
    expect(el().classList.contains('amount-row')).toBe(false);
  });
});
