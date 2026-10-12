import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsMerchants } from './analytics-merchants';
import { MerchantDistribution } from './analytics.model';

const merchant = (overrides: Partial<MerchantDistribution> = {}): MerchantDistribution => ({
  merchantId: 'm-1',
  name: 'ESSELUNGA',
  category: 'Alimentari',
  amount: 530,
  transactionCount: 4,
  percentage: 100,
  ...overrides
});

/** `n` merchant dal più al meno speso, con le quote date (le altre all'1%). */
const many = (n: number, percentages: number[] = []): MerchantDistribution[] =>
  Array.from({ length: n }, (_, i) =>
    merchant({
      merchantId: `m-${i + 1}`,
      name: `M${i + 1}`,
      amount: 1000 - i * 10,
      percentage: percentages[i] ?? 1
    })
  );

describe('AnalyticsMerchants', () => {
  let fixture: ComponentFixture<AnalyticsMerchants>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const render = async (merchants: MerchantDistribution[]): Promise<void> => {
    fixture = TestBed.createComponent(AnalyticsMerchants);
    fixture.componentRef.setInput('merchants', merchants);
    await fixture.whenStable();
  };

  /** La vista predefinita è il Grafico: i test della Lista ci passano prima. */
  const renderList = async (merchants: MerchantDistribution[]): Promise<void> => {
    await render(merchants);
    Array.from(host().querySelectorAll<HTMLButtonElement>('app-choice-group button'))
      .find((button) => button.getAttribute('aria-label') === 'Lista')
      ?.click();
    await fixture.whenStable();
  };

  const tiles = (): HTMLButtonElement[] =>
    Array.from(host().querySelectorAll<HTMLButtonElement>('app-treemap button.tile'));

  const emitted = (): string[] => {
    const values: string[] = [];
    fixture.componentInstance.merchantSelected.subscribe((id) => values.push(id));
    return values;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AnalyticsMerchants] }).compileComponents();
  });

  // Come in analytics-categories: `amount` è la magnitudine di una spesa.
  it('una spesa normale mostra il segno meno e il tono di uscita', async () => {
    await renderList([merchant({ amount: 530 })]);

    const amount = host().querySelector('app-amount');

    expect(amount?.textContent).toContain('−530,00');
    expect(amount?.classList.contains('amount-negative')).toBe(true);
    expect(amount?.classList.contains('amount-positive')).toBe(false);
  });

  it('solo la riga del merchant filtrato è premuta', async () => {
    await renderList([merchant(), merchant({ merchantId: 'm-2', name: 'COOP' })]);
    const pressed = (): Array<string | null> =>
      Array.from(host().querySelectorAll('.link')).map((link) => link.getAttribute('aria-pressed'));
    expect(pressed()).toEqual(['false', 'false']);

    fixture.componentRef.setInput('activeMerchantIds', ['m-2']);
    await fixture.whenStable();
    expect(pressed()).toEqual(['false', 'true']);
    expect(host().querySelector('.link.active')?.textContent).toBe('COOP');
  });

  it('la riga attiva ha lo stesso rientro delle altre: il testo non si sposta', async () => {
    await renderList([merchant(), merchant({ merchantId: 'm-2', name: 'COOP' })]);
    const indent = (): string[] =>
      Array.from(host().querySelectorAll<HTMLElement>('ol li')).map(
        (row) => getComputedStyle(row).paddingLeft
      );
    const before = indent();

    fixture.componentRef.setInput('activeMerchantIds', ['m-2']);
    await fixture.whenStable();

    expect(indent()).toEqual(before);
  });

  it('un rimborso netto mostra il segno più e il tono di entrata', async () => {
    await renderList([merchant({ amount: -50 })]);

    const amount = host().querySelector('app-amount');

    expect(amount?.textContent).toContain('+50,00');
    expect(amount?.classList.contains('amount-positive')).toBe(true);
    expect(amount?.classList.contains('amount-negative')).toBe(false);
  });

  it('la Lista mostra i primi 10 e allarga a richiesta, come prima', async () => {
    await renderList(many(12));

    expect(host().querySelectorAll('ol li').length).toBe(10);
    host().querySelector<HTMLButtonElement>('.more')!.click();
    await fixture.whenStable();
    expect(host().querySelectorAll('ol li').length).toBe(12);
  });

  it('la vista predefinita è il Grafico: treemap, non la lista', async () => {
    await render(many(3, [50, 30, 20]));

    expect(host().querySelector('app-treemap')).not.toBeNull();
    expect(host().querySelector('ol')).toBeNull();
    expect(tiles().length).toBe(3);
  });

  it('nessuna spesa: né scelta della vista né grafico, solo il messaggio', async () => {
    await render([]);

    expect(host().querySelector('app-choice-group')).toBeNull();
    expect(host().querySelector('app-treemap')).toBeNull();
    expect(host().textContent).toContain('Nessuna spesa nel periodo selezionato');
  });

  describe('la frase sulla concentrazione', () => {
    const sentence = (): string =>
      host().querySelector('.concentration')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    it('un solo merchant: tutte le uscite', async () => {
      await render([merchant()]);
      expect(sentence()).toBe('Un solo merchant: tutte le uscite');
    });

    it('tre merchant: i primi 3', async () => {
      await render(many(3, [50, 30, 20]));
      expect(sentence()).toBe('I primi 3 merchant fanno il 100% delle uscite');
    });

    it('dodici merchant: i primi 5, quota arrotondata', async () => {
      await render(many(12, [20, 15, 12.2, 10, 8.4]));
      expect(sentence()).toBe('I primi 5 merchant fanno il 66% delle uscite');
    });

    it('nella Lista non c’è', async () => {
      await renderList(many(3, [50, 30, 20]));
      expect(host().querySelector('.concentration')).toBeNull();
    });
  });

  it('una tessera filtra per il suo merchant', async () => {
    await render(many(3, [50, 30, 20]));
    const values = emitted();

    tiles()[1]!.click();

    expect(values).toEqual(['m-2']);
  });

  it('la tessera di un merchant senza identificativo non filtra nulla', async () => {
    await render([merchant({ merchantId: null, name: 'Senza merchant' })]);
    const values = emitted();

    tiles()[0]!.click();

    expect(values).toEqual([]);
  });

  it('i merchant filtrati risaltano, gli altri si attenuano', async () => {
    await render(many(3, [50, 30, 20]));
    fixture.componentRef.setInput('activeMerchantIds', ['m-2']);
    await fixture.whenStable();

    expect(tiles().map((tile) => tile.classList.contains('dimmed'))).toEqual([true, false, true]);
  });

  it('«Altri» apre la Lista per intero, col focus sul primo merchant raggruppato', async () => {
    await render(many(17));
    const values = emitted();

    host().querySelector<HTMLButtonElement>('app-treemap .tile.others')!.click();
    await fixture.whenStable();

    expect(values).toEqual([]);
    expect(host().querySelector('app-treemap')).toBeNull();
    expect(host().querySelectorAll('ol li').length).toBe(17);
    expect(document.activeElement?.textContent?.trim()).toBe('M16');
    expect(
      host().querySelector('app-choice-group button[aria-pressed="true"]')?.getAttribute('aria-label')
    ).toBe('Lista');
  });

  it('la tessera prende il colore della categoria del merchant; senza categoria, o ignota, è neutra', async () => {
    await render([
      merchant({ merchantId: 'm-1', name: 'ESSELUNGA', category: 'Alimentari' }),
      merchant({ merchantId: 'm-2', name: 'ENI', category: 'Carburante', amount: 300 }),
      merchant({ merchantId: 'm-3', name: 'BAR', category: null, amount: 100 })
    ]);
    fixture.componentRef.setInput('categories', [
      { id: 'cat-1', name: 'Alimentari', color: '#3f8f4f' },
      { id: 'cat-2', name: 'Svago', color: '#1f5fa8' }
    ]);
    await fixture.whenStable();

    expect(tiles().map((tile) => tile.style.getPropertyValue('--tile-color'))).toEqual([
      '#3f8f4f',
      'var(--color-chart-neutral)',
      'var(--color-chart-neutral)'
    ]);
  });
});
