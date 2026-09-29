import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VisualSelect, VisualSelectOption } from './visual-select';

describe('VisualSelect', () => {
  let fixture: ComponentFixture<VisualSelect<string>>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [VisualSelect] }).compileComponents();
    fixture = TestBed.createComponent(VisualSelect<string>);
    const options: readonly VisualSelectOption<string>[] = [
      { id: 'food', name: 'Alimentari', color: '#d44' },
      { id: 'income', name: 'Entrata', icon: 'trending-up' },
    ];
    fixture.componentRef.setInput('options', options);
    fixture.componentRef.setInput('value', 'food');
    fixture.componentRef.setInput('ariaLabel', 'Categoria o tipo');
  });

  it('mostra il valore selezionato e assegna un nome accessibile al select', async () => {
    await fixture.whenStable();

    const select = host().querySelector('select');

    expect(host().querySelector('.name')?.textContent?.trim()).toBe('Alimentari');
    expect(host().querySelector('app-color-marker')).not.toBeNull();
    expect(select?.value).toBe('food');
    expect(select?.getAttribute('aria-label')).toBe('Categoria o tipo');
    expect(host().querySelectorAll('option')).toHaveLength(3);
  });

  it('mostra l’icona specificata per il valore selezionato', async () => {
    fixture.componentRef.setInput('value', 'income');
    await fixture.whenStable();

    expect(host().querySelector('svg[lucideTrendingUp]')).not.toBeNull();
    expect(host().querySelector('app-color-marker')).toBeNull();
  });

  it('emette l’id della voce scelta e nasconde il focus ring fino al blur', async () => {
    await fixture.whenStable();
    const selected = vi.fn();
    fixture.componentInstance.valueChange.subscribe(selected);
    const select = host().querySelector('select')!;

    select.value = 'income';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(selected).toHaveBeenCalledWith('income');
    expect(host().querySelector('.picker')?.classList.contains('selection-made')).toBe(true);

    select.dispatchEvent(new Event('blur'));
    await fixture.whenStable();

    expect(host().querySelector('.picker')?.classList.contains('selection-made')).toBe(false);
  });

  it('emette null quando si sceglie di non assegnare una voce', async () => {
    await fixture.whenStable();
    const selected = vi.fn();
    fixture.componentInstance.valueChange.subscribe(selected);
    const select = host().querySelector('select')!;

    select.value = '';
    select.dispatchEvent(new Event('change'));

    expect(selected).toHaveBeenCalledWith(null);
  });

  it('disabilita sia il select sia la sua superficie visiva', async () => {
    fixture.componentRef.setInput('disabled', true);
    await fixture.whenStable();

    expect(host().querySelector('select')?.disabled).toBe(true);
    expect(host().querySelector('.picker')?.classList.contains('disabled')).toBe(true);
  });
});