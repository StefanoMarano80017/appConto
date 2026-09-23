import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Amount } from './amount';

describe('Amount', () => {
  let fixture: ComponentFixture<Amount>;

  const render = async (value: number, tone?: 'auto' | 'neutral' | 'positive' | 'negative') => {
    fixture = TestBed.createComponent(Amount);
    fixture.componentRef.setInput('value', value);
    if (tone !== undefined) {
      fixture.componentRef.setInput('tone', tone);
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
    expect(el().classList.contains('positive')).toBe(true);
  });

  it('antepone il segno meno a un importo negativo', async () => {
    await render(-892.1);

    expect(text().startsWith('−')).toBe(true);
    expect(el().classList.contains('negative')).toBe(true);
    // Il meno e' il nostro, non quello di Intl: un solo segno, non due.
    expect(text()).not.toContain('-');
  });

  it('non aggiunge alcun segno a un importo neutro', async () => {
    await render(1200, 'neutral');

    expect(text().startsWith('+')).toBe(false);
    expect(el().classList.contains('positive')).toBe(false);
    expect(el().classList.contains('negative')).toBe(false);
  });

  // Review Focus 1: uno zero non e' ne' entrata ne' uscita.
  it('non aggiunge segno ne colore a un importo pari a zero', async () => {
    await render(0);

    expect(text().startsWith('+')).toBe(false);
    expect(text().startsWith('−')).toBe(false);
    expect(el().classList.contains('positive')).toBe(false);
    expect(el().classList.contains('negative')).toBe(false);
  });

  it('rispetta un tono imposto dall esterno', async () => {
    await render(1500, 'negative');

    expect(el().classList.contains('negative')).toBe(true);
    expect(text().startsWith('−')).toBe(true);
  });
});
