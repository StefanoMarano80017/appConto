import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsLoans } from './analytics-loans';
import { LoansSection } from './analytics.model';

const section = (): LoansSection => ({
  lent: 1000,
  transactionCount: 1,
  entries: [
    {
      id: 'l-1',
      bookingDate: '2026-07-05',
      description: 'PRESTITO A MARIO',
      merchant: 'PRESTITO A MARIO',
      amount: -1000
    }
  ]
});

describe('AnalyticsLoans', () => {
  let fixture: ComponentFixture<AnalyticsLoans>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const render = async (): Promise<void> => {
    fixture = TestBed.createComponent(AnalyticsLoans);
    fixture.componentRef.setInput('loans', section());
    fixture.componentRef.setInput('explorerParams', {});
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalyticsLoans],
      providers: [provideRouter([])]
    }).compileComponents();
  });

  // `loans().lent` (il totale in testa) passa per `outflowCents`, una
  // magnitudine positiva; `entry.amount` (la riga sotto) è il valore grezzo
  // con segno, negativo. Prima della correzione l'intestazione taceva il
  // segno (nessun tono lo forzava su un valore già positivo) mentre la riga
  // lo mostrava: stesso denaro uscito, due letture discordi nello stesso
  // pannello.
  it('il totale prestato e la riga mostrano lo stesso segno', async () => {
    await render();

    const [total, entry] = [...host().querySelectorAll('app-amount')].map(
      (el) => el.textContent?.trim() ?? ''
    );

    expect(total.startsWith('−')).toBe(true);
    expect(entry.startsWith('−')).toBe(true);
    expect(total.startsWith('+')).toBe(false);
    expect(entry.startsWith('+')).toBe(false);
  });
});
