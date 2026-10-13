import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Pagination } from './pagination';
import type { PaginationData } from './pagination.model';

describe('Pagination', () => {
  let fixture: ComponentFixture<Pagination>;

  const render = async (
    pagination: PaginationData,
    itemLabel = 'merchant',
    emptyLabel?: string,
  ) => {
    fixture = TestBed.createComponent(Pagination);
    fixture.componentRef.setInput('pagination', pagination);
    fixture.componentRef.setInput('itemLabel', itemLabel);
    if (emptyLabel !== undefined) {
      fixture.componentRef.setInput('emptyLabel', emptyLabel);
    }
    await fixture.whenStable();
  };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => host().querySelector('.range')!.textContent!.replace(/\s+/g, ' ').trim();

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Pagination] }).compileComponents();
  });

  it("mostra l'intervallo con il nome degli elementi", async () => {
    await render({ page: 3, pageSize: 20, total: 279, totalPages: 14 });

    expect(text()).toBe('41–60 di 279 merchant');
  });

  it("oltre l'ultima pagina mostra solo il totale, mai un intervallo impossibile", async () => {
    await render({ page: 4, pageSize: 25, total: 60, totalPages: 3 });

    expect(text()).toBe('60 merchant');
    expect(text()).not.toContain('76–');
  });

  it('senza risultati dice Nessun seguito dal nome', async () => {
    await render({ page: 1, pageSize: 25, total: 0, totalPages: 0 });

    expect(text()).toBe('Nessun merchant');
  });

  it("senza risultati usa l'etichetta vuota personalizzata se presente", async () => {
    await render({ page: 1, pageSize: 25, total: 0, totalPages: 0 }, 'transazioni', 'Nessuna transazione');

    expect(text()).toBe('Nessuna transazione');
  });

  it('emette la pagina scelta', async () => {
    await render({ page: 3, pageSize: 20, total: 279, totalPages: 14 });
    const emitted: number[] = [];
    fixture.componentInstance.pageSelected.subscribe((page: number) => emitted.push(page));

    host().querySelector<HTMLButtonElement>('button[aria-label="Successiva"]')!.click();

    expect(emitted).toEqual([4]);
  });
});
