import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SortableHeader } from './sortable-header';

describe('SortableHeader', () => {
  let fixture: ComponentFixture<SortableHeader>;

  const render = async (active: boolean, direction: 'asc' | 'desc' = 'asc') => {
    // `inferTagName`: senza, TestBed userebbe `div` come host invece di `th`,
    // vanificando proprio ciò che il selettore d'attributo esiste a garantire.
    fixture = TestBed.createComponent(SortableHeader, { inferTagName: true });
    fixture.componentRef.setInput('label', 'Data');
    fixture.componentRef.setInput('active', active);
    fixture.componentRef.setInput('direction', direction);
    await fixture.whenStable();
  };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SortableHeader] }).compileComponents();
  });

  // Review Focus 5: una colonna non ordinata dichiara `none`, non tace.
  it('dichiara aria-sort none quando non è la colonna attiva', async () => {
    await render(false);

    expect(host().getAttribute('aria-sort')).toBe('none');
    expect(host().tagName).toBe('TH');
    expect(host().getAttribute('scope')).toBe('col');
  });

  it('dichiara la direzione quando è la colonna attiva', async () => {
    await render(true, 'asc');
    expect(host().getAttribute('aria-sort')).toBe('ascending');

    await render(true, 'desc');
    expect(host().getAttribute('aria-sort')).toBe('descending');
  });

  it('emette sorted al clic', async () => {
    await render(false);

    let emesso = 0;
    fixture.componentInstance.sorted.subscribe(() => (emesso += 1));
    host().querySelector('button')?.click();

    expect(emesso).toBe(1);
  });
});
