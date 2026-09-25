import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChoiceGroup, ChoiceOption } from './choice-group';

interface OpzioneTest {
  id: string;
  value: string | readonly string[];
}

@Component({
  imports: [ChoiceGroup],
  template: `
    <app-choice-group
      [options]="options()"
      [value]="value()"
      [mode]="mode()"
      ariaLabel="Periodo"
      (selected)="ultimoSelezionato = $event"
    />
  `
})
class Ospite {
  readonly options = input<readonly ChoiceOption<string>[]>([
    { id: 'this-month', label: '1M', description: 'Questo mese' },
    { id: 'previous-month', label: 'M−1' },
    { id: 'all', label: 'Tutto' }
  ]);
  readonly value = input<string | readonly string[]>('this-month');
  readonly mode = input<'single' | 'multiple'>('single');

  ultimoSelezionato: string | null = null;
}

describe('ChoiceGroup', () => {
  let fixture: ComponentFixture<Ospite>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const bottoni = (): HTMLButtonElement[] => [...host().querySelectorAll<HTMLButtonElement>('button')];
  const bottone = (label: string): HTMLButtonElement | undefined =>
    bottoni().find((candidate) => candidate.textContent?.trim() === label);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Ospite] }).compileComponents();
    fixture = TestBed.createComponent(Ospite);
    await fixture.whenStable();
  });

  it('in modalità esclusiva solo il segmento corrispondente a value ha aria-pressed a true', async () => {
    fixture.componentRef.setInput('value', 'previous-month');
    await fixture.whenStable();

    expect(bottone('1M')?.getAttribute('aria-pressed')).toBe('false');
    expect(bottone('M−1')?.getAttribute('aria-pressed')).toBe('true');
    expect(bottone('Tutto')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('in modalità multipla tutti i segmenti presenti in value hanno aria-pressed a true', async () => {
    fixture.componentRef.setInput('mode', 'multiple');
    fixture.componentRef.setInput('value', ['previous-month', 'all']);
    await fixture.whenStable();

    expect(bottone('1M')?.getAttribute('aria-pressed')).toBe('false');
    expect(bottone('M−1')?.getAttribute('aria-pressed')).toBe('true');
    expect(bottone('Tutto')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('il clic emette l\'id del segmento in modalità esclusiva', async () => {
    bottone('Tutto')?.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.ultimoSelezionato).toBe('all');
  });

  it('il clic emette l\'id del segmento in modalità multipla', async () => {
    fixture.componentRef.setInput('mode', 'multiple');
    fixture.componentRef.setInput('value', ['this-month']);
    await fixture.whenStable();

    bottone('M−1')?.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.ultimoSelezionato).toBe('previous-month');
  });

  it('in modalità esclusiva il clic sul segmento già attivo non emette niente', async () => {
    bottone('1M')?.click();
    await fixture.whenStable();

    // In un gruppo esclusivo qualcosa è sempre selezionato: riemettere lo
    // stesso id farebbe riscrivere allo store un valore identico, e per il
    // periodo significherebbe ricalcolare l'intervallo e rifare la richiesta.
    expect(fixture.componentInstance.ultimoSelezionato).toBeNull();
  });

  it('in modalità multipla il clic sul segmento già attivo emette: è il modo di toglierlo', async () => {
    fixture.componentRef.setInput('mode', 'multiple');
    fixture.componentRef.setInput('value', ['this-month']);
    await fixture.whenStable();

    bottone('1M')?.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.ultimoSelezionato).toBe('this-month');
  });

  it('un\'opzione con description produce un nome accessibile che inizia con l\'etichetta visibile', async () => {
    const segmento = bottone('1M');

    expect(segmento?.getAttribute('title')).toBe('Questo mese');
    expect(segmento?.getAttribute('aria-label')).toBe('1M, Questo mese');
    expect(segmento?.getAttribute('aria-label')?.startsWith('1M')).toBe(true);
  });

  it('un\'opzione senza description non aggiunge né title né aria-label', async () => {
    const segmento = bottone('M−1');

    expect(segmento?.hasAttribute('title')).toBe(false);
    expect(segmento?.hasAttribute('aria-label')).toBe(false);
  });
});
