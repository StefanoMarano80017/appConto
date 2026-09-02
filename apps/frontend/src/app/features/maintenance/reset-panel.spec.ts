import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../core/api';
import { ResetPanel } from './reset-panel';

/**
 * Il pannello di azzeramento.
 *
 * La protezione che conta è che **la parola vada scritta**: un pulsante, per
 * quanto rosso, si preme per sbaglio. Qui si prova che senza la parola non
 * parte nulla, che con la parola sbagliata il pulsante resta inerte, e che il
 * pannello dica dove è finita la copia di sicurezza — che è la sola
 * informazione utile a chi si è pentito.
 */

describe('ResetPanel', () => {
  let fixture: ComponentFixture<ResetPanel>;
  let http: HttpTestingController;

  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => element().textContent ?? '';

  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(element().querySelectorAll<HTMLButtonElement>('button')).find((candidate) =>
      (candidate.textContent ?? '').includes(label)
    );

  const click = async (label: string): Promise<void> => {
    button(label)?.click();
    await settle();
  };

  const input = (): HTMLInputElement | null => element().querySelector('input[name="conferma"]');

  const scrivi = async (valore: string): Promise<void> => {
    const casella = input();
    expect(casella).not.toBeNull();
    casella!.value = valore;
    casella!.dispatchEvent(new Event('input'));
    await settle();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });

    fixture = TestBed.createComponent(ResetPanel);
    http = TestBed.inject(HttpTestingController);
    await settle();
  });

  afterEach(() => http.verify());

  it('chiuso, dice cosa fa e cosa NON tocca', () => {
    expect(text()).toContain('Ricomincia da zero');
    // È l'informazione che rende la decisione possibile: chi non sa che i
    // backup restano, non azzera.
    expect(text()).toContain('I backup restano tutti');
    expect(text()).toContain("l'archivio non viene toccato");
    // Nessuna casella finché non si apre: il pannello non invita a premere.
    expect(input()).toBeNull();
  });

  it('aperto, chiede di scrivere la parola e tiene il pulsante inerte', async () => {
    await click('Ricomincia da zero…');

    expect(input()).not.toBeNull();
    expect(text()).toContain('AZZERA');

    const azzera = button('Azzera adesso');
    expect(azzera).toBeDefined();
    expect(azzera!.disabled).toBe(true);
  });

  it('una parola sbagliata non abilita niente', async () => {
    await click('Ricomincia da zero…');

    for (const sbagliata of ['azzera', 'AZZER', 'AZZERAA', 'sì', '']) {
      await scrivi(sbagliata);
      expect(button('Azzera adesso')?.disabled).toBe(true);
    }

    http.expectNone(`${API_BASE_URL}/reset`);
  });

  it('con la parola esatta azzera, e dice dove è la copia di sicurezza', async () => {
    await click('Ricomincia da zero…');
    await scrivi('AZZERA');

    expect(button('Azzera adesso')?.disabled).toBe(false);
    await click('Azzera adesso');

    const [richiesta] = http.match(`${API_BASE_URL}/reset`);
    expect(richiesta).toBeDefined();
    expect(richiesta!.request.method).toBe('POST');
    // La parola viaggia nel corpo: il backend la pretende, quindi non è una
    // formalità dell'interfaccia.
    expect(richiesta!.request.body).toEqual({ confirm: 'AZZERA' });

    richiesta!.flush({
      backupName: 'pre-reset-20260902-150000.sqlite',
      removed: { transactions: 931, merchants: 452, categories: 22 },
      seededCategories: 22,
      message: 'Archivio azzerato.'
    });
    await settle();

    expect(text()).toContain('1405 righe eliminate');
    expect(text()).toContain('pre-reset-20260902-150000.sqlite');
    // La casella sparisce: non c'è più niente da confermare.
    expect(input()).toBeNull();
  });

  it('spazi intorno alla parola non contano', async () => {
    await click('Ricomincia da zero…');
    await scrivi('  AZZERA  ');

    expect(button('Azzera adesso')?.disabled).toBe(false);
  });

  it('un rifiuto mostra il motivo e lascia il pannello pronto a riprovare', async () => {
    await click('Ricomincia da zero…');
    await scrivi('AZZERA');
    await click('Azzera adesso');

    const [richiesta] = http.match(`${API_BASE_URL}/reset`);
    richiesta!.flush(
      { error: "C'è un ripristino in attesa del prossimo avvio" },
      { status: 409, statusText: 'Conflict' }
    );
    await settle();

    expect(text()).toContain('ripristino in attesa');
    /*
     * Il pannello resta aperto: il motivo è rimediabile — si annulla il
     * ripristino — e chiudere tutto costringerebbe a ricominciare.
     */
    expect(input()).not.toBeNull();
  });

  it('annullare chiude il pannello e dimentica la parola', async () => {
    await click('Ricomincia da zero…');
    await scrivi('AZZERA');
    await click('Annulla');

    expect(input()).toBeNull();

    await click('Ricomincia da zero…');
    // Riaprendo, la parola va riscritta: la conferma non si eredita.
    expect(input()?.value).toBe('');
    expect(button('Azzera adesso')?.disabled).toBe(true);
  });

  it('il singolare segue il conteggio', async () => {
    await click('Ricomincia da zero…');
    await scrivi('AZZERA');
    await click('Azzera adesso');

    const [richiesta] = http.match(`${API_BASE_URL}/reset`);
    richiesta!.flush({
      backupName: 'pre-reset-20260902-150000.sqlite',
      removed: { transactions: 1 },
      seededCategories: 22,
      message: 'Archivio azzerato.'
    });
    await settle();

    expect(text()).toContain('1 riga eliminata');
  });
});
