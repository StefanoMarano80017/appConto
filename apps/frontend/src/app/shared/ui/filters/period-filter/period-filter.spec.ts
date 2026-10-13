import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PeriodFilter } from './period-filter';

describe('PeriodFilter', () => {
  let fixture: ComponentFixture<PeriodFilter>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PeriodFilter] }).compileComponents();
    fixture = TestBed.createComponent(PeriodFilter);
    fixture.componentRef.setInput('preset', 'this-month');
  });

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const dateInputs = (): HTMLInputElement[] =>
    [...host().querySelectorAll<HTMLInputElement>('input[type="date"]')];

  it('mostra i preset rapidi e seleziona quello ricevuto', async () => {
    await fixture.whenStable();

    const buttons = [...host().querySelectorAll<HTMLButtonElement>('app-choice-group button')];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['1M', '3M', '6M', '12M', 'Tutto']);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');

    let selected: string | undefined;
    fixture.componentInstance.presetSelected.subscribe((value) => (selected = value));
    buttons[1].click();
    await fixture.whenStable();

    expect(selected).toBe('last-3-months');
  });

  it('mostra gli estremi ricevuti ed emette i cambiamenti normalizzando il vuoto', async () => {
    fixture.componentRef.setInput('from', '2026-09-01');
    fixture.componentRef.setInput('to', '2026-09-30');
    await fixture.whenStable();

    expect(dateInputs().map((input) => input.value)).toEqual(['2026-09-01', '2026-09-30']);

    let changedFrom: string | null | undefined;
    let changedTo: string | null | undefined;
    fixture.componentInstance.fromChange.subscribe((value) => (changedFrom = value));
    fixture.componentInstance.toChange.subscribe((value) => (changedTo = value));

    dateInputs()[0].value = '2026-09-02';
    dateInputs()[0].dispatchEvent(new Event('change'));
    dateInputs()[1].value = '';
    dateInputs()[1].dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(changedFrom).toBe('2026-09-02');
    expect(changedTo).toBeNull();
  });
});