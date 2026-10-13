import { Component, TemplateRef, computed, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideTrendingDown, LucideTrendingUp } from '@lucide/angular';
import { TransactionsTablePanel } from './transactions-table-panel';
import type {
  TransactionsTableExtraColumnContext,
  TransactionsTableExtraColumnDef,
  TransactionsTableMode,
  TransactionsTablePage,
  TransactionsTableRow,
} from '@shared/transactions/transactions-table/transactions-table.model';
import type { SelectOption } from '@shared/ui/forms/select/select.model';
import { chooseOption } from '@shared/ui/forms/select/select.testing';

/*
 * Come per la tabella: righe e tipi finti e locali, nessun provider. Il
 * pannello non carica nulla, quindi i test non hanno bisogno di HTTP.
 */

const TYPE_OPTIONS: readonly SelectOption[] = [
  { id: 'EXPENSE', name: 'Spesa', icon: LucideTrendingDown.icon },
  { id: 'INCOME', name: 'Entrata', icon: LucideTrendingUp.icon },
];

const row = (id: string): TransactionsTableRow => ({
  id,
  bookingDate: '2026-07-10',
  description: `Movimento ${id}`,
  amount: -10,
  type: 'EXPENSE',
  merchant: null,
});

const PAGE: TransactionsTablePage = {
  items: [row('1'), row('2')],
  pagination: { page: 2, pageSize: 25, total: 60, totalPages: 3 },
};

const EMPTY_PAGE: TransactionsTablePage = {
  items: [],
  pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 },
};

@Component({
  imports: [TransactionsTablePanel],
  template: `
    <ng-template #extra let-row>
      <span class="probe">{{ row.id }}</span>
    </ng-template>

    <app-transactions-table-panel
      [page]="page()"
      [loading]="loading()"
      [error]="error()"
      [title]="title()"
      [emptyHint]="emptyHint()"
      [emptyActionLabel]="emptyActionLabel()"
      [mode]="mode()"
      [typeOptions]="types"
      [extraColumn]="column()"
      [selectable]="selectable()"
      [selectedIds]="selectedIds()"
      [confirmingDelete]="confirmingDelete()"
      [deleteError]="deleteError()"
      [deleteDone]="deleteDone()"
      (retry)="log('retry')"
      (emptyAction)="log('emptyAction')"
      (pageSelected)="selectedPage = $event"
      (pageSizeSelected)="selectedPageSize = $event"
      (deleteRequested)="log('deleteRequested')"
      (deleteConfirmed)="log('deleteConfirmed')"
      (deleteCancelled)="log('deleteCancelled')"
      (selectionCleared)="log('selectionCleared')"
    />
  `,
})
class TestHost {
  readonly types = TYPE_OPTIONS;
  readonly page = signal<TransactionsTablePage | undefined>(PAGE);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly title = signal<string | undefined>(undefined);
  readonly emptyHint = signal<string | undefined>(undefined);
  readonly emptyActionLabel = signal<string | undefined>(undefined);
  readonly mode = signal<TransactionsTableMode>('edit');
  readonly showExtra = signal(false);
  readonly selectable = signal(false);
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  readonly confirmingDelete = signal(false);
  readonly deleteError = signal<string | null>(null);
  readonly deleteDone = signal<string | null>(null);

  private readonly extra =
    viewChild.required<TemplateRef<TransactionsTableExtraColumnContext>>('extra');

  readonly column = computed<TransactionsTableExtraColumnDef | null>(() =>
    this.showExtra() ? { label: 'Extra', template: this.extra() } : null,
  );

  readonly events: string[] = [];
  selectedPage = 0;
  selectedPageSize = 0;

  log(event: string): void {
    this.events.push(event);
  }
}

describe('TransactionsTablePanel', () => {
  let fixture: ComponentFixture<TestHost>;
  let host: TestHost;
  let el: HTMLElement;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const button = (label: string): HTMLButtonElement | undefined =>
    [...el.querySelectorAll<HTMLButtonElement>('.selection button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TestHost] }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('mostra il messaggio d’errore e inoltra «Riprova»', async () => {
    host.error.set('Server non raggiungibile');
    await settle();

    expect(el.textContent).toContain('Server non raggiungibile');
    // L'errore vince anche sui dati già in mano.
    expect(el.querySelector('app-transactions-table')).toBeNull();

    (el.querySelector('app-error-retry button') as HTMLButtonElement).click();
    expect(host.events).toEqual(['retry']);
  });

  it('senza dati e in caricamento mostra lo scheletro occupato', async () => {
    host.page.set(undefined);
    host.loading.set(true);
    await settle();

    expect(el.querySelector('app-panel[aria-busy="true"]')).not.toBeNull();
    expect(el.textContent).toContain('Caricamento in corso');
    expect(el.querySelectorAll('.skeleton .line')).toHaveLength(8);
    expect(el.querySelector('app-transactions-table')).toBeNull();
  });

  it('senza dati e senza caricamento non mostra nulla', async () => {
    host.page.set(undefined);
    await settle();

    expect(el.querySelector('app-panel')).toBeNull();
  });

  it('con elenco vuoto mostra messaggio e hint, senza azione se manca l’etichetta', async () => {
    host.page.set(EMPTY_PAGE);
    host.emptyHint.set('Prova a modificare i filtri.');
    await settle();

    expect(el.textContent).toContain('Nessuna transazione trovata.');
    expect(el.textContent).toContain('Prova a modificare i filtri.');
    expect(el.querySelector('.empty button')).toBeNull();
    expect(el.querySelector('app-transactions-table')).toBeNull();
    expect(el.querySelector('app-transactions-pagination')).toBeNull();
  });

  it('con elenco vuoto mostra l’azione se richiesta e la inoltra', async () => {
    host.page.set(EMPTY_PAGE);
    host.emptyActionLabel.set('Reset filtri');
    await settle();

    const action = el.querySelector('.empty button') as HTMLButtonElement;
    expect(action.textContent).toContain('Reset filtri');

    action.click();
    expect(host.events).toEqual(['emptyAction']);
  });

  it('dispone la tabella nel pannello fra due barre di paginazione', () => {
    const panel = el.querySelector('app-panel') as HTMLElement;
    const children = [...panel.querySelectorAll('app-transactions-pagination, app-transactions-table')];

    expect(children.map((child) => child.tagName.toLowerCase())).toEqual([
      'app-transactions-pagination',
      'app-transactions-table',
      'app-transactions-pagination',
    ]);
    expect(panel.querySelectorAll('app-transactions-table tbody tr')).toHaveLength(2);
  });

  it('senza titolo non disegna intestazioni; col titolo lo mette in cima al pannello', async () => {
    expect(el.querySelector('app-section-header')).toBeNull();

    host.title.set('Transazioni del periodo');
    await settle();

    const panel = el.querySelector('app-panel') as HTMLElement;
    expect(panel.querySelector('h2')?.textContent?.trim()).toBe('Transazioni del periodo');
    expect(panel.querySelector('section')?.firstElementChild?.tagName.toLowerCase()).toBe(
      'app-section-header',
    );
  });

  it('il titolo resta anche durante il primo caricamento e in errore', async () => {
    host.title.set('Transazioni del periodo');
    host.page.set(undefined);
    host.loading.set(true);
    await settle();
    expect(el.querySelector('h2')?.textContent?.trim()).toBe('Transazioni del periodo');

    host.error.set('Guasto');
    await settle();
    expect(el.querySelector('h2')?.textContent?.trim()).toBe('Transazioni del periodo');
  });

  it('attenua il pannello dei dati mentre ricarica', async () => {
    const panel = el.querySelector('app-panel') as HTMLElement;
    expect(panel.classList.contains('stale')).toBe(false);
    expect(panel.hasAttribute('aria-busy')).toBe(false);

    host.loading.set(true);
    await settle();

    expect(panel.classList.contains('stale')).toBe(true);
    expect(panel.getAttribute('aria-busy')).toBe('true');
  });

  it('propaga la pagina richiesta e la dimensione selezionata', async () => {
    const pages = el.querySelectorAll(
      'app-transactions-pagination .page:not(.current)',
    ) as NodeListOf<HTMLButtonElement>;

    pages[0].click();
    await chooseOption(fixture, el, 'app-transactions-pagination', '50');

    expect(host.selectedPage).toBe(1);
    expect(host.selectedPageSize).toBe(50);
  });

  describe('barra della selezione', () => {
    it('non compare se il pannello non è selezionabile, anche con righe scelte', async () => {
      host.selectedIds.set(new Set(['1']));
      await settle();

      expect(el.querySelector('.selection')).toBeNull();
    });

    it('non compare se selezionabile ma senza nulla di scelto né esiti', async () => {
      host.selectable.set(true);
      await settle();

      expect(el.querySelector('.selection')).toBeNull();
    });

    it('mostra il conteggio e inoltra «Elimina» e «Deseleziona»', async () => {
      host.selectable.set(true);
      host.selectedIds.set(new Set(['1', '2']));
      await settle();

      expect(el.querySelector('.selection .count')?.textContent).toContain('2');
      expect(el.querySelector('.selection .count')?.textContent).toContain('movimenti selezionati');

      button('Elimina')!.click();
      button('Deseleziona')!.click();

      expect(host.events).toEqual(['deleteRequested', 'selectionCleared']);
    });

    it('al singolare con un solo movimento', async () => {
      host.selectable.set(true);
      host.selectedIds.set(new Set(['1']));
      await settle();

      expect(el.querySelector('.selection .count')?.textContent).toContain('movimento selezionato');
    });

    it('in conferma chiede e inoltra «Sì, elimina» e «Annulla»', async () => {
      host.selectable.set(true);
      host.selectedIds.set(new Set(['1']));
      host.confirmingDelete.set(true);
      await settle();

      expect(el.querySelector('.selection .ask')?.textContent).toContain('Eliminare definitivamente?');
      expect(button('Elimina')).toBeUndefined();

      button('Sì, elimina')!.click();
      button('Annulla')!.click();

      expect(host.events).toEqual(['deleteConfirmed', 'deleteCancelled']);
    });

    it('resta per mostrare un esito anche a selezione vuota', async () => {
      host.selectable.set(true);
      host.deleteDone.set('2 movimenti eliminati.');
      await settle();

      expect(el.querySelector('.selection .message.done')?.textContent).toContain(
        '2 movimenti eliminati.',
      );
      expect(el.querySelector('.selection .count')).toBeNull();

      host.deleteDone.set(null);
      host.deleteError.set('Rifiutato');
      await settle();

      expect(el.querySelector('.selection .message.error')?.textContent).toContain('Rifiutato');
    });
  });

  it('inoltra la colonna aggiuntiva alla tabella', async () => {
    expect(el.querySelector('app-transactions-table th.extra')).toBeNull();

    host.showExtra.set(true);
    await settle();

    expect(el.querySelector('app-transactions-table th.extra')?.textContent?.trim()).toBe('Extra');
    expect([...el.querySelectorAll('td.extra .probe')].map((cell) => cell.textContent)).toEqual([
      '1',
      '2',
    ]);
  });
});
