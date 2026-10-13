import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StatCardGrid, StatCardItem } from './stat-card-grid';

describe('StatCardGrid', () => {
  let fixture: ComponentFixture<StatCardGrid>;

  const render = async (items: readonly StatCardItem[]) => {
    fixture = TestBed.createComponent(StatCardGrid);
    fixture.componentRef.setInput('items', items);
    await fixture.whenStable();
  };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StatCardGrid] }).compileComponents();
  });

  it('rende una card amount negativa come app-amount con il segno meno e il tono negativo', async () => {
    await render([{ kind: 'amount', label: 'Uscite', value: -530 }]);

    const amount = host().querySelector('app-amount') as HTMLElement;

    expect(amount).not.toBeNull();
    expect(amount.textContent?.trim().startsWith('−')).toBe(true);
    expect(amount.classList.contains('amount-negative')).toBe(true);
    // La dimensione `kpi` è la ragione stessa del task (far uscire quel
    // ramo di `Amount` dal suo stato di ramo morto): senza questa riga
    // `size="kpi"` potrebbe smettere di arrivare al componente e nessun
    // altro assert se ne accorgerebbe.
    expect(amount.classList.contains('amount-kpi')).toBe(true);
  });

  it('rende la stessa card con valore positivo con il segno più e il tono positivo', async () => {
    await render([{ kind: 'amount', label: 'Entrate', value: 530 }]);

    const amount = host().querySelector('app-amount') as HTMLElement;

    expect(amount.textContent?.trim().startsWith('+')).toBe(true);
    expect(amount.classList.contains('amount-positive')).toBe(true);
  });

  // Il terzo test protegge i conteggi: senza, il prossimo che tocca il
  // componente può far passare tutto da `Amount` e trasformare «42
  // transazioni» in «+42».
  it('rende una card text come stringa così com è, senza segno e senza Amount', async () => {
    await render([{ kind: 'text', label: 'Transazioni', value: '42' }]);

    expect(host().querySelector('app-amount')).toBeNull();

    const value = host().querySelector('.value') as HTMLElement;
    expect(value.textContent?.trim()).toBe('42');
  });

  // Senza questo test, togliere `[tone]="item.tone ?? 'auto'"` dal template
  // lascerebbe verdi gli altri: un valore negativo con tono `neutral`
  // dichiarato deve restare neutro, non ricadere sul segno che `auto`
  // dedurrebbe da sé. È esattamente il caso delle card dei prestiti
  // (Prestato/Restituito/Da ricevere), che passano sempre `tone: 'neutral'`
  // su magnitudini che possono essere negative solo per un refuso a monte.
  it('passa il tono dichiarato ad Amount invece di lasciarlo dedurre da auto', async () => {
    await render([{ kind: 'amount', label: 'Da ricevere', value: -530, tone: 'neutral' }]);

    const amount = host().querySelector('app-amount') as HTMLElement;

    expect(amount.classList.contains('amount-neutral')).toBe(true);
    expect(amount.classList.contains('amount-negative')).toBe(false);
  });

  it('una card amount con delta mostra il chip col segno e il tono dichiarati', async () => {
    await render([
      {
        kind: 'amount',
        label: 'Uscite',
        value: -500,
        delta: { percent: 12, caption: 'vs agosto', tone: 'negative' }
      }
    ]);

    const chip = host().querySelector('.delta') as HTMLElement;

    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('+12');
    expect(chip.textContent).toContain('vs agosto');
    expect(chip.classList.contains('delta-negative')).toBe(true);
  });

  it('una card amount senza delta non mostra alcun chip', async () => {
    await render([{ kind: 'amount', label: 'Entrate', value: 500 }]);

    expect(host().querySelector('.delta')).toBeNull();
  });

  // È il test che protegge la regola del brief: il tono del chip è quello
  // dichiarato dal chiamante, non quello che il segno di `percent`
  // suggerirebbe. Una percentuale positiva con tono `negative` deve restare
  // negativa: per le uscite crescere è una cattiva notizia, non una buona.
  it('il tono del chip non segue il segno della percentuale', async () => {
    await render([
      {
        kind: 'amount',
        label: 'Uscite',
        value: -500,
        delta: { percent: 12, caption: 'vs agosto', tone: 'negative' }
      }
    ]);

    const chip = host().querySelector('.delta') as HTMLElement;

    expect(chip.classList.contains('delta-negative')).toBe(true);
    expect(chip.classList.contains('delta-positive')).toBe(false);
  });
});
