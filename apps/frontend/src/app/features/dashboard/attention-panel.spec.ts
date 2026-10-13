import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { formatAmount } from '../../core/format';
import { Dashboard } from './dashboard.model';
import { AttentionPanel, attentionHasContent } from './attention-panel';

interface Inputs {
  attention: Dashboard['attention'];
  loans: Dashboard['loans'];
  lastTransactionDate: string | null;
  today: string;
}

/** Nulla da segnalare: dati freschi, nessun merchant da classificare, nessun prestito aperto. */
const quiet = (overrides: Partial<Inputs> = {}): Inputs => ({
  attention: { unclassifiedMerchants: 0 },
  loans: { remaining: 0, openCount: 0, unlinkedTransactions: 0 },
  lastTransactionDate: '2026-10-10',
  today: '2026-10-13',
  ...overrides
});

describe('AttentionPanel', () => {
  let fixture: ComponentFixture<AttentionPanel>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const normalize = (value: string | null): string => (value ?? '').replace(/\s+/g, ' ');
  const text = (): string => normalize(host().textContent);
  const link = (label: string): HTMLAnchorElement | undefined =>
    [...host().querySelectorAll('a')].find((a) => normalize(a.textContent).includes(label));

  const render = async (inputs: Inputs): Promise<void> => {
    fixture = TestBed.createComponent(AttentionPanel);
    fixture.componentRef.setInput('attention', inputs.attention);
    fixture.componentRef.setInput('loans', inputs.loans);
    fixture.componentRef.setInput('lastTransactionDate', inputs.lastTransactionDate);
    fixture.componentRef.setInput('today', inputs.today);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AttentionPanel],
      providers: [provideRouter([])]
    }).compileComponents();
  });

  it('segnala i merchant da classificare', async () => {
    await render(quiet({ attention: { unclassifiedMerchants: 17 } }));

    expect(text()).toContain('Da sistemare');
    expect(link('17 merchant da classificare →')?.getAttribute('href')).toBe(
      '/merchants?classification=unclassified'
    );
  });

  it('segnala dati più vecchi di sette giorni', async () => {
    await render(quiet({ lastTransactionDate: '2026-09-21' }));

    const anchor = link('Ultimo movimento 21/09/2026 · Importa estratto conto →');
    expect(anchor?.getAttribute('href')).toBe('/import');
  });

  it('non segnala dati recenti', async () => {
    await render(quiet({ attention: { unclassifiedMerchants: 1 }, lastTransactionDate: '2026-10-10' }));

    expect(text()).not.toContain('Ultimo movimento');
    expect(text()).not.toContain('Importa estratto conto');
  });

  it("con l'archivio vuoto invita a importare", async () => {
    await render(quiet({ lastTransactionDate: null }));

    expect(link('Nessun movimento · Importa estratto conto →')?.getAttribute('href')).toBe('/import');
  });

  it('senza prestiti aperti non mostra la sezione Prestiti', async () => {
    await render(quiet({ attention: { unclassifiedMerchants: 3 } }));

    expect(text()).not.toContain('Prestiti');
    expect(text()).not.toContain('Da ricevere');
  });

  it('mostra i prestiti aperti e la nota sui movimenti senza dettaglio', async () => {
    await render(quiet({ loans: { remaining: 1030, openCount: 2, unlinkedTransactions: 14 } }));

    expect(text()).toContain('Prestiti');
    expect(text()).not.toContain('Da sistemare');
    // Dal formatter e non scritto a mano: `it-IT` non raggruppa le migliaia sotto i 10.000.
    const remaining = formatAmount(1030).replace(/\s+/g, ' ');
    expect(link(`Da ricevere ${remaining} · 2 aperti →`)?.getAttribute('href')).toBe('/loans?status=open');
    expect(text()).toContain('14 movimenti di prestito senza dettaglio, considerati saldati');
  });

  it('senza movimenti scollegati non mostra la nota', async () => {
    await render(quiet({ loans: { remaining: 1030, openCount: 2, unlinkedTransactions: 0 } }));

    expect(text()).not.toContain('senza dettaglio');
  });

  it('con nulla da segnalare non ha contenuto', async () => {
    await render(quiet());

    expect(fixture.componentInstance.hasContent()).toBe(false);
    expect(text().trim()).toBe('');
  });
});

describe('attentionHasContent', () => {
  const has = (inputs: Inputs): boolean =>
    attentionHasContent(inputs.attention, inputs.loans, inputs.lastTransactionDate, inputs.today);

  it('è falso solo quando nessuna voce è presente', () => {
    expect(has(quiet())).toBe(false);
    expect(has(quiet({ attention: { unclassifiedMerchants: 1 } }))).toBe(true);
    expect(has(quiet({ lastTransactionDate: '2026-09-21' }))).toBe(true);
    expect(has(quiet({ lastTransactionDate: null }))).toBe(true);
    expect(has(quiet({ loans: { remaining: 10, openCount: 1, unlinkedTransactions: 0 } }))).toBe(true);
  });

  it('i movimenti scollegati da soli non bastano: sono già saldati', () => {
    expect(has(quiet({ loans: { remaining: 0, openCount: 0, unlinkedTransactions: 14 } }))).toBe(false);
  });
});
