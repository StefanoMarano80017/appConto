import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TransactionsTable, TransactionsTableExtraColumn } from './transactions-table';
import type {
  TransactionsTableCategory,
  TransactionsTableCategoryChange,
  TransactionsTableRow,
  TransactionsTableTypeChange,
} from './transactions-table.model';
import type { VisualSelectOption } from './visual-select';

/*
 * La tabella è di sola presentazione: nessun provider HTTP né router. Se un
 * giorno uno di questi test chiedesse di nuovo `provideHttpClient`, vorrebbe
 * dire che la tabella ha ricominciato a iniettare API — ed è proprio ciò che
 * `shared/` non deve fare.
 *
 * I tipi e le categorie sono finti e locali: `shared/` non importa le feature,
 * neppure nei test (v. scripts/design-system-gate.sh).
 */

const TYPE_OPTIONS: readonly VisualSelectOption[] = [
  { id: 'EXPENSE', name: 'Spesa', icon: 'trending-down' },
  { id: 'INCOME', name: 'Entrata', icon: 'trending-up' },
  { id: 'OTHER', name: 'Altro', icon: 'ellipsis' },
];

const CATEGORY_OPTIONS: readonly VisualSelectOption[] = [
  { id: 'cat-1', name: 'Alimentari', color: '#3f8f4f' },
  { id: 'cat-2', name: 'Casa', color: '#2f6fbf' },
];

const transaction = (id: string, amount: number): TransactionsTableRow => ({
  id,
  bookingDate: '2026-07-10',
  description: `Movimento ${id}`,
  amount,
  type: amount < 0 ? 'EXPENSE' : 'INCOME',
  merchant: null,
});

/** Un merchant con un nome scelto: `label` è ciò che la cella rende. */
const conMerchant = (
  id: string,
  amount: number,
  label: string,
  category: TransactionsTableCategory | null = null,
): TransactionsTableRow => ({
  ...transaction(id, amount),
  merchant: {
    id: `m-${id}`,
    name: label,
    displayName: null,
    label,
    category,
  },
});

const alimentari = { id: 'cat-1', name: 'Alimentari', color: '#3f8f4f' };

describe('TransactionsTable', () => {
  let fixture: ComponentFixture<TransactionsTable>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const render = async (transactions: readonly TransactionsTableRow[]): Promise<void> => {
    fixture.componentRef.setInput('transactions', transactions);
    await fixture.whenStable();
  };

  /** Sceglie un valore nel `select` nativo di un `VisualSelect`, come farebbe l'utente. */
  const choose = async (select: HTMLSelectElement, value: string): Promise<void> => {
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TransactionsTable],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionsTable);
    fixture.componentRef.setInput('typeOptions', TYPE_OPTIONS);
  });

  it('la riga di totale somma gli importi delle transazioni mostrate', async () => {
    await render([transaction('1', -300), transaction('2', 500)]);

    const total = host().querySelector('tfoot .numeric app-amount') as HTMLElement;

    expect(total).not.toBeNull();
    expect(total.textContent?.trim().startsWith('+')).toBe(true);
    expect(total.textContent).toContain('200,00');
  });

  // Un totale negativo resta negativo: la riga non è un'entrata forzata, è la
  // somma con il proprio segno.
  it('la riga di totale mostra il segno meno quando le uscite superano le entrate', async () => {
    await render([transaction('1', -900), transaction('2', 300)]);

    const total = host().querySelector('tfoot .numeric app-amount') as HTMLElement;

    expect(total.textContent?.trim().startsWith('−')).toBe(true);
    expect(total.textContent).toContain('600,00');
  });

  // Il modello di transazione non ha un campo stato: niente pastiglie
  // «Completato»/«In attesa» inventate.
  it('non mostra alcuna colonna di stato: il modello non ce l’ha', async () => {
    await render([transaction('1', -300)]);

    expect(host().textContent).not.toContain('Completato');
    expect(host().querySelector('.status')).toBeNull();
  });

  it('l’etichetta del totale dichiara che è il totale del periodo mostrato', async () => {
    await render([transaction('1', -300)]);

    expect(host().querySelector('tfoot .total-label')?.textContent).toContain('periodo mostrato');
  });

  /*
   * I due test che seguono (Task 6, Step 1) non descrivono un comportamento
   * nuovo: fissano quello di oggi, prima di decidere se la tabella debba
   * adottare l'involucro condiviso `data-table`. Quel mixin porta un padding
   * diverso dall'attuale, quindi la geometria cambierà — ed è proprio quando
   * la geometria cambia che un contenuto lungo smette di starci.
   *
   * Vanno letti al contrario: se un giorno diventano rossi, il verdetto sulle
   * tabelle ha rotto qualcosa che oggi funziona.
   *
   * Quello che jsdom NON può dire, e che nessuno dei due finge di verificare:
   * se il testo esca dalla cella. Qui non c'è layout, `getBoundingClientRect()`
   * vale zero. Si verifica quindi l'unica cosa osservabile — che il contenuto
   * ci sia tutto e nella cella giusta — e il resto resta al giro visivo.
   */

  it('un importo a sei cifre arriva intero nella cella, senza troncamenti', async () => {
    await render([transaction('1', -123456.78)]);

    // `tbody`, non `tfoot`: la riga di totale ha la stessa classe di cella, e
    // senza questo ancoraggio il test misurerebbe il totale invece del dato.
    const cella = host().querySelector('tbody td.numeric');

    expect(cella?.textContent).toContain('123.456,78');
  });

  /*
   * Le intestazioni ordinabili sono `<app-sortable-header>` (Task 6, Step 3).
   * Il componente dichiara `aria-sort` da sé, e la colonna non ordinabile
   * adesso tace invece di dire `none`: i tre test che seguono fissano quel
   * cambio, perché è l'unica parte dell'adozione che si vede solo con uno
   * screen reader e che nessun altro test guardava.
   */
  const conOrdinamento = async (): Promise<void> => {
    fixture.componentRef.setInput('sortBy', 'amount');
    fixture.componentRef.setInput('sortDirection', 'asc');
    await render([transaction('1', -300)]);
  };

  it('dichiara aria-sort solo sulle colonne che si possono davvero ordinare', async () => {
    await conOrdinamento();

    const intestazioni = [...host().querySelectorAll('thead th')];

    expect(intestazioni.length).toBe(6);

    // «Descrizione» è l'unica senza `field` (v. COLUMNS): dichiarare anche lì
    // `aria-sort="none"` direbbe a uno screen reader che la colonna è
    // ordinabile e che semplicemente non lo è adesso. Non lo è affatto.
    const mute = intestazioni.filter((th) => !th.hasAttribute('aria-sort'));

    expect(mute.map((th) => th.textContent?.trim())).toEqual(['Descrizione']);
  });

  it('la colonna ordinata dichiara la direzione, non solo che è attiva', async () => {
    await conOrdinamento();

    expect(host().querySelector('thead th.numeric')?.getAttribute('aria-sort')).toBe('ascending');
  });

  // Dove la tabella è un riepilogo e non un elenco su cui agire — la
  // dashboard — `sortBy` è `null` e nessuna intestazione si clicca.
  it('senza ordinamento nessuna intestazione è un pulsante né si dichiara ordinabile', async () => {
    await render([transaction('1', -300)]);

    expect(host().querySelector('thead .sort')).toBeNull();
    expect(host().querySelector('thead th[aria-sort]')).toBeNull();
  });

  it('un nome di merchant lunghissimo resta intero e non fa sparire la cella dell’importo', async () => {
    const nome = 'Supermercato Cooperativo del Lungo Nome Che Non Finisce Mai';
    await render([conMerchant('1', -300, nome)]);

    // Il nome è reso da uno `<span class="label" appTruncate>`: la direttiva
    // accorcia a schermo, ma il testo nel DOM deve restare intero, o non
    // sarebbe più leggibile né copiabile.
    expect(host().querySelector('tbody td.merchant .label')?.textContent?.trim()).toBe(nome);
    expect(host().querySelector('tbody td.numeric')).not.toBeNull();
  });

  // Il predefinito è la sola lettura: modificare è una scelta da dichiarare,
  // perché ha bisogno di qualcuno che salvi.
  it('senza `mode` è in sola lettura', async () => {
    await render([conMerchant('1', -300, 'ESSELUNGA', alimentari)]);

    expect(host().querySelector('select')).toBeNull();
    expect(host().querySelector('tbody app-visual-select .picker.readonly')).not.toBeNull();
  });

  describe('in sola lettura', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('mode', 'readonly');
    });

    it('non offre alcun select né casella, anche se `selectable` è vero', async () => {
      fixture.componentRef.setInput('selectable', true);
      await render([conMerchant('1', -300, 'ESSELUNGA', alimentari), transaction('2', 500)]);

      expect(host().querySelector('select')).toBeNull();
      expect(host().querySelector('input[type="checkbox"]')).toBeNull();
      expect(host().querySelector('th.select, td.select')).toBeNull();
    });

    it('tipo e categoria restano visibili come picker in sola lettura', async () => {
      await render([conMerchant('1', -300, 'ESSELUNGA', alimentari)]);

      const pickers = [...host().querySelectorAll('tbody app-visual-select .picker')];

      expect(pickers.length).toBe(2);
      expect(pickers.every((picker) => picker.classList.contains('readonly'))).toBe(true);
      expect(host().querySelector('tbody td.type')?.textContent).toContain('Spesa');
    });

    // Nessun `categoryOptions` passato: la categoria mostrata è quella che il
    // merchant della riga porta con sé.
    it('mostra la categoria dal merchant della riga, senza elenco di categorie', async () => {
      await render([
        conMerchant('1', -300, 'ESSELUNGA', alimentari),
        conMerchant('2', -50, 'IKEA', { id: 'cat-2', name: 'Casa', color: null }),
        conMerchant('3', -10, 'BAR', null),
      ]);

      const categorie = [...host().querySelectorAll('tbody td.category')].map((cella) =>
        cella.textContent?.trim(),
      );

      expect(categorie).toEqual(['Alimentari', 'Casa', '—']);
    });

    it('ignora `savingId`: nessuna riga in salvataggio', async () => {
      fixture.componentRef.setInput('savingId', '1');
      await render([transaction('1', -300)]);

      expect(host().querySelector('tbody tr.saving')).toBeNull();
    });
  });

  describe('in modifica', () => {
    let typeChanges: TransactionsTableTypeChange[];
    let categoryChanges: TransactionsTableCategoryChange[];

    beforeEach(() => {
      fixture.componentRef.setInput('mode', 'edit');
      fixture.componentRef.setInput('categoryOptions', CATEGORY_OPTIONS);

      typeChanges = [];
      categoryChanges = [];
      fixture.componentInstance.typeChange.subscribe((change) => typeChanges.push(change));
      fixture.componentInstance.categoryChange.subscribe((change) => categoryChanges.push(change));
    });

    const typeSelect = (): HTMLSelectElement =>
      host().querySelector<HTMLSelectElement>('tbody td.type select')!;

    const categorySelect = (): HTMLSelectElement =>
      host().querySelector<HTMLSelectElement>('tbody td.category select')!;

    it('cambiare il tipo emette `typeChange` con la riga e il tipo scelto', async () => {
      const riga = conMerchant('1', -300, 'ESSELUNGA', alimentari);
      await render([riga]);

      await choose(typeSelect(), 'OTHER');

      expect(typeChanges).toEqual([{ row: riga, type: 'OTHER' }]);
    });

    // Lo stesso tipo di prima, o l'opzione vuota «—», non sono una modifica:
    // nessuno deve salvare nulla.
    it('non emette nulla se il tipo non cambia o si sceglie «—»', async () => {
      await render([transaction('1', -300)]);

      await choose(typeSelect(), 'EXPENSE');
      await choose(typeSelect(), '');

      expect(typeChanges).toEqual([]);
    });

    it('cambiare la categoria emette `categoryChange` con la riga e la categoria', async () => {
      const riga = conMerchant('1', -300, 'ESSELUNGA', alimentari);
      await render([riga]);

      await choose(categorySelect(), 'cat-2');
      await choose(categorySelect(), '');

      expect(categoryChanges).toEqual([
        { row: riga, categoryId: 'cat-2' },
        { row: riga, categoryId: null },
      ]);
    });

    it('non emette nulla se la categoria scelta è quella che il merchant ha già', async () => {
      await render([conMerchant('1', -300, 'ESSELUNGA', alimentari)]);

      await choose(categorySelect(), 'cat-1');

      expect(categoryChanges).toEqual([]);
    });

    it('le categorie fra cui scegliere sono quelle ricevute, non solo quella della riga', async () => {
      await render([conMerchant('1', -300, 'ESSELUNGA', alimentari)]);

      const opzioni = [...categorySelect().options].map((option) => option.textContent?.trim());

      expect(opzioni).toEqual(['—', 'Alimentari', 'Casa']);
    });

    it('senza merchant la categoria non si sceglie', async () => {
      await render([transaction('1', -300)]);

      expect(host().querySelector('tbody td.category select')).toBeNull();
      expect(host().querySelector('tbody td.category')?.textContent?.trim()).toBe('—');
    });

    it('la riga in salvataggio è marcata e i suoi controlli disabilitati', async () => {
      fixture.componentRef.setInput('savingId', '1');
      await render([conMerchant('1', -300, 'ESSELUNGA', alimentari), transaction('2', 500)]);

      const righe = [...host().querySelectorAll('tbody tr')];

      expect(righe[0].classList.contains('saving')).toBe(true);
      expect(righe[1].classList.contains('saving')).toBe(false);
      expect(typeSelect().disabled).toBe(true);
      expect(categorySelect().disabled).toBe(true);
    });

    it('mostra l’errore ricevuto sopra la tabella', async () => {
      fixture.componentRef.setInput('error', 'Salvataggio non riuscito.');
      await render([transaction('1', -300)]);

      expect(host().querySelector('.message.error')?.textContent).toContain(
        'Salvataggio non riuscito.',
      );
    });

    it('con `selectable` mostra le caselle e segnala le intenzioni di selezione', async () => {
      fixture.componentRef.setInput('selectable', true);
      fixture.componentRef.setInput('selectedIds', new Set(['1']));
      await render([transaction('1', -300), transaction('2', 500)]);

      const toggled: string[] = [];
      const all: boolean[] = [];
      fixture.componentInstance.selectionToggled.subscribe((id) => toggled.push(id));
      fixture.componentInstance.allToggled.subscribe((select) => all.push(select));

      const caselle = [...host().querySelectorAll<HTMLInputElement>('td.select input')];
      const intestazione = host().querySelector<HTMLInputElement>('th.select input')!;

      expect(caselle.map((casella) => casella.checked)).toEqual([true, false]);
      expect(intestazione.indeterminate).toBe(true);
      expect(host().querySelector('tbody tr.selected')).not.toBeNull();

      caselle[1].click();
      intestazione.click();

      expect(toggled).toEqual(['2']);
      // Non tutte erano selezionate: la casella dell'intestazione le chiede tutte.
      expect(all).toEqual([true]);
    });

    // La colonna di selezione occupa un posto prima di «Importo»: l'etichetta
    // del totale deve allungarsi di una cella, o il totale scivola sotto la
    // colonna sbagliata.
    it('con la selezione l’etichetta del totale copre anche la colonna delle caselle', async () => {
      fixture.componentRef.setInput('selectable', true);
      await render([transaction('1', -300)]);

      expect(host().querySelector('tfoot .total-label')?.getAttribute('colspan')).toBe('6');
    });
  });
});

/**
 * Un ospite che proietta la colonna aggiuntiva, accesa o spenta da un segnale:
 * è lo stesso schema della pagina dei movimenti, dove la colonna dei prestiti
 * resta nascosta finché i legami non sono arrivati.
 */
@Component({
  imports: [TransactionsTable, TransactionsTableExtraColumn],
  template: `
    <app-transactions-table [transactions]="rows" [typeOptions]="types">
      @if (showExtra()) {
        <ng-template appTransactionsTableExtraColumn="Extra" let-row>
          <span class="probe">{{ row.id }} · {{ row.description }}</span>
        </ng-template>
      }
    </app-transactions-table>
  `,
})
class ExtraColumnHost {
  readonly rows = [transaction('1', -300), transaction('2', 500)];
  readonly types = TYPE_OPTIONS;
  readonly showExtra = signal(true);
}

describe('TransactionsTable — colonna aggiuntiva', () => {
  let fixture: ComponentFixture<ExtraColumnHost>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ExtraColumnHost] }).compileComponents();

    fixture = TestBed.createComponent(ExtraColumnHost);
    await fixture.whenStable();
  });

  it('aggiunge in coda l’intestazione col nome dato, senza ordinamento', () => {
    const intestazioni = [...host().querySelectorAll('thead th')];

    expect(intestazioni.length).toBe(7);
    expect(intestazioni.at(-1)?.textContent?.trim()).toBe('Extra');
    expect(intestazioni.at(-1)?.hasAttribute('aria-sort')).toBe(false);
  });

  it('rende il template in ogni riga, con la riga come contesto', () => {
    const celle = [...host().querySelectorAll('tbody td.extra')];

    expect(celle.map((cella) => cella.textContent?.trim())).toEqual([
      '1 · Movimento 1',
      '2 · Movimento 2',
    ]);
  });

  // Senza la cella vuota in fondo, la riga di totale avrebbe una colonna in
  // meno delle altre e il bordo superiore si interromperebbe prima della fine.
  it('aggiunge una cella vuota alla riga di totale', () => {
    const celle = [...host().querySelectorAll('tfoot tr.total td')];

    expect(celle.length).toBe(3);
    expect(celle.at(-1)?.textContent?.trim()).toBe('');
  });

  // È ciò che fa la pagina dei movimenti: un `@if` intorno al template, e la
  // colonna compare e scompare con lui.
  it('segue l’`@if` che avvolge il template', async () => {
    fixture.componentInstance.showExtra.set(false);
    await fixture.whenStable();

    expect(host().querySelectorAll('thead th').length).toBe(6);
    expect(host().querySelector('tbody td.extra')).toBeNull();
    expect(host().querySelectorAll('tfoot tr.total td').length).toBe(2);

    fixture.componentInstance.showExtra.set(true);
    await fixture.whenStable();

    expect(host().querySelectorAll('tbody td.extra').length).toBe(2);
  });
});

describe('TransactionsTable — senza colonna aggiuntiva', () => {
  it('non aggiunge né intestazione né celle se nessun template è proiettato', async () => {
    await TestBed.configureTestingModule({ imports: [TransactionsTable] }).compileComponents();

    const fixture = TestBed.createComponent(TransactionsTable);
    fixture.componentRef.setInput('typeOptions', TYPE_OPTIONS);
    fixture.componentRef.setInput('transactions', [transaction('1', -300)]);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('thead th').length).toBe(6);
    expect(host.querySelector('.extra')).toBeNull();
    expect(host.querySelectorAll('tfoot tr.total td').length).toBe(2);
  });
});
