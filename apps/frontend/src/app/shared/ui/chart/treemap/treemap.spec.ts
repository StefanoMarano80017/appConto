import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { groupedTileLabel, Treemap } from './treemap';
import type { TileColor, TreemapActivation } from './treemap.model';

interface Entry {
  readonly name: string;
  readonly amount: number;
  readonly color: TileColor;
}

const entry = (name: string, amount: number, color: TileColor = 'chart-1'): Entry => ({
  name,
  amount,
  color
});

// Diciassette voci con topN 15: le ultime due finiscono in «Altri 2 merchant».
const SEVENTEEN: readonly Entry[] = Array.from({ length: 17 }, (_, i) =>
  entry(`M${i + 1}`, 170 - i * 10)
);

@Component({
  imports: [Treemap],
  template: `
    <app-treemap
      [items]="items()"
      [value]="value"
      [label]="label"
      [color]="color"
      [topN]="topN()"
      othersNoun="merchant"
      [highlighted]="highlighted()"
      ariaLabel="Treemap di prova"
      (tileActivated)="activated.push($event)"
    />
  `
})
class Host {
  readonly items = signal<readonly Entry[]>(SEVENTEEN);
  readonly topN = signal(15);
  readonly highlighted = signal<((item: Entry) => boolean) | undefined>(undefined);
  readonly activated: TreemapActivation<Entry>[] = [];
  readonly value = (item: Entry): number => item.amount;
  readonly label = (item: Entry): string => item.name;
  readonly color = (item: Entry): TileColor => item.color;
}

describe('Treemap', () => {
  let fixture: ComponentFixture<Host>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const tiles = (): HTMLButtonElement[] =>
    Array.from(host().querySelectorAll<HTMLButtonElement>('button.tile'));
  const names = (): string[] => tiles().map((tile) => tile.querySelector('.name')?.textContent?.trim() ?? '');

  const render = async (items: readonly Entry[] = SEVENTEEN): Promise<void> => {
    fixture = TestBed.createComponent(Host);
    fixture.componentInstance.items.set(items);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  it('tiene le prime topN voci e raccoglie le altre in una tessera «Altri»', async () => {
    await render();

    expect(tiles().length).toBe(16);
    expect(tiles().at(-1)?.classList.contains('others')).toBe(true);
    expect(tiles().at(-1)?.getAttribute('aria-label')).toContain('Altri 2 merchant');
  });

  it('l’etichetta del gruppo ha il singolare', () => {
    expect(groupedTileLabel(1, 'merchant')).toBe('1 altro merchant');
    expect(groupedTileLabel(4, 'merchant')).toBe('Altri 4 merchant');
  });

  it('una sola voce in eccesso resta una tessera normale: il gruppo non risparmierebbe nulla', async () => {
    await render(SEVENTEEN.slice(0, 16));

    expect(tiles().length).toBe(16);
    expect(host().querySelector('.tile.others')).toBeNull();
  });

  it('le tessere seguono il valore decrescente: è l’ordine del tab', async () => {
    await render([entry('Piccolo', 10), entry('Grande', 300), entry('Medio', 90)]);

    expect(tiles().map((tile) => tile.title.split(':')[0])).toEqual(['Grande', 'Medio', 'Piccolo']);
  });

  it('valori nulli o negativi non hanno una tessera', async () => {
    await render([entry('Spesa', 100), entry('Zero', 0), entry('Rimborso', -40)]);

    expect(tiles().map((tile) => tile.title.split(':')[0])).toEqual(['Spesa']);
  });

  it('il nome accessibile e il title danno nome, importo e quota anche se la tessera tace', async () => {
    await render([entry('ESSELUNGA', 530), entry('COOP', 470)]);

    const first = tiles()[0]!;
    expect(first.getAttribute('aria-label')).toContain('ESSELUNGA');
    expect(first.getAttribute('aria-label')).toContain('530,00');
    expect(first.getAttribute('aria-label')).toContain('53%');
    expect(first.title).toBe(first.getAttribute('aria-label'));
    expect(host().querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Treemap di prova');
  });

  it('una tessera grande mostra nome, importo e quota; una minuscola nessun testo', async () => {
    await render([entry('Grande', 1000), entry('Minuscolo', 1)]);

    const [big, tiny] = tiles();
    expect(big?.dataset['size']).toBe('full');
    expect(big?.querySelector('.name')?.textContent).toContain('Grande');
    expect(big?.querySelector('.amount')?.textContent).toContain('1000,00');
    expect(big?.querySelector('.share')?.textContent).toContain('99,9%');
    expect(tiny?.dataset['size']).toBe('none');
    expect(tiny?.textContent?.trim()).toBe('');
    expect(tiny?.getAttribute('aria-label')).toContain('Minuscolo');
  });

  it('il click su una voce la emette; quello su «Altri» emette le voci raggruppate', async () => {
    await render();

    tiles()[0]!.click();
    tiles().at(-1)!.click();

    const [item, others] = fixture.componentInstance.activated;
    expect(item).toEqual({ kind: 'item', item: SEVENTEEN[0] });
    expect(others).toEqual({ kind: 'others', items: SEVENTEEN.slice(15) });
  });

  it('le tessere sono bottoni nativi: Invio e Spazio le attivano senza altro codice', async () => {
    await render();

    expect(tiles().every((tile) => tile.type === 'button')).toBe(true);
  });

  it('con voci in risalto le altre si attenuano; «Altri» risalta se una sua voce risalta', async () => {
    await render();
    expect(host().querySelectorAll('.tile.dimmed').length).toBe(0);

    fixture.componentInstance.highlighted.set((item) => item.name === 'M2' || item.name === 'M17');
    await fixture.whenStable();

    const dimmed = tiles().map((tile) => tile.classList.contains('dimmed'));
    expect(dimmed[1]).toBe(false);
    expect(dimmed.at(-1)).toBe(false);
    expect(dimmed.filter(Boolean).length).toBe(14);
  });

  it('nessuna corrispondenza: nessuna tessera attenuata', async () => {
    await render();

    fixture.componentInstance.highlighted.set(() => false);
    await fixture.whenStable();

    expect(host().querySelectorAll('.tile.dimmed').length).toBe(0);
  });

  it('il colore della voce arriva alla tessera; il gruppo è neutro', async () => {
    await render([
      entry('Custom', 300, { custom: 'rgb(1, 2, 3)' }),
      entry('Serie', 200, 'chart-2'),
      ...SEVENTEEN.slice(0, 16)
    ]);

    const color = (tile: HTMLElement | undefined): string =>
      tile?.style.getPropertyValue('--tile-color') ?? '';
    expect(color(tiles()[0])).toBe('rgb(1, 2, 3)');
    expect(color(tiles().find((tile) => tile.title.startsWith('Serie')))).toBe('var(--color-chart-2)');
    expect(color(host().querySelector<HTMLElement>('.tile.others') ?? undefined)).toBe(
      'var(--color-chart-neutral)'
    );
  });

  it('le tessere sono posizionate in percentuale: seguono il contenitore', async () => {
    await render([entry('Solo', 10)]);

    const style = tiles()[0]!.style;
    expect([style.left, style.top, style.width, style.height]).toEqual(['0%', '0%', '100%', '100%']);
    expect(names()).toEqual(['Solo']);
  });
});
