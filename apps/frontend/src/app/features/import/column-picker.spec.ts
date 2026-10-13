import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ColumnMappingErrors, ColumnMappingFormValue, CsvAnalysis } from './column-mapping';
import { ColumnPicker } from './column-picker';

const analysis: CsvAnalysis = {
  headers: ['Data', 'Causale', 'Importo'],
  rowsRead: 1,
  proposal: { bookingDate: null, description: null, amount: null, typeHint: null },
  sample: [['01/08/2026', 'Spesa', '-10,00']]
};

const emptyForm: ColumnMappingFormValue = {
  bookingDate: '',
  description: '',
  amountKind: 'single',
  amount: '',
  debit: '',
  credit: '',
  typeHint: ''
};

describe('ColumnPicker', () => {
  let fixture: ComponentFixture<ColumnPicker>;
  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  /** Il trigger del select con quell'id: il picker lo applica al bottone. */
  const trigger = (id: string): HTMLButtonElement =>
    root().querySelector<HTMLButtonElement>(`app-select button#${id}`) as HTMLButtonElement;

  const render = async (
    form: ColumnMappingFormValue = emptyForm,
    errors: ColumnMappingErrors = {}
  ): Promise<void> => {
    fixture = TestBed.createComponent(ColumnPicker);
    fixture.componentRef.setInput('analysis', analysis);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('errors', errors);
    await fixture.whenStable();
  };

  it('scegliere una colonna aggiorna la mappatura', async () => {
    await render();
    const emitted: ColumnMappingFormValue[] = [];
    fixture.componentInstance.changed.subscribe((value) => emitted.push(value));

    trigger('bookingDate').click();
    await fixture.whenStable();
    const option = Array.from(root().querySelectorAll<HTMLElement>('[role="option"]')).find(
      (candidate) => candidate.textContent?.trim() === 'Causale'
    );
    option?.click();
    await fixture.whenStable();

    expect(emitted).toEqual([{ ...emptyForm, bookingDate: 'Causale' }]);
  });

  it('un errore imposta aria-invalid sul trigger', async () => {
    await render(emptyForm, { bookingDate: 'Indica la colonna della data.' });

    expect(trigger('bookingDate').getAttribute('aria-invalid')).toBe('true');
    expect(trigger('description').getAttribute('aria-invalid')).not.toBe('true');
  });
});
