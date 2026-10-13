import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideCalendar, LucideX } from '@lucide/angular';
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
      [display]="display()"
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
  readonly display = input<'label' | 'icon' | 'both'>('label');

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

  describe('icone', () => {
    const conIcone: readonly ChoiceOption<string>[] = [
      { id: 'this-month', label: '1M', description: 'Questo mese', icon: LucideCalendar.icon },
      { id: 'previous-month', label: 'M−1', icon: LucideX.icon },
      { id: 'all', label: 'Tutto' }
    ];
    const icone = (): SVGElement[] => [...host().querySelectorAll<SVGElement>('button svg')];

    it('senza `icon` valorizzata non compare nessuna icona, in nessuna modalità di display', async () => {
      for (const display of ['label', 'icon', 'both']) {
        fixture.componentRef.setInput('display', display);
        await fixture.whenStable();

        expect(icone().length).toBe(0);
      }
    });

    it('in `label` le icone passate non si vedono e il markup resta quello di sempre', async () => {
      fixture.componentRef.setInput('options', conIcone);
      await fixture.whenStable();

      expect(icone().length).toBe(0);
      expect(bottone('1M')).toBeDefined();
      expect(bottone('M−1')?.hasAttribute('title')).toBe(false);
      expect(bottone('M−1')?.hasAttribute('aria-label')).toBe(false);
      expect(bottone('M−1')?.classList.contains('icon-only')).toBe(false);
    });

    it('in `both` l\'icona precede il testo ed è nascosta agli screen reader', async () => {
      fixture.componentRef.setInput('options', conIcone);
      fixture.componentRef.setInput('display', 'both');
      await fixture.whenStable();

      expect(icone().length).toBe(2);
      expect(icone().every((icona) => icona.getAttribute('aria-hidden') === 'true')).toBe(true);
      expect(bottone('1M')?.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    });

    it('in `icon` il testo sparisce ma restano aria-label e title', async () => {
      fixture.componentRef.setInput('options', conIcone);
      fixture.componentRef.setInput('display', 'icon');
      await fixture.whenStable();

      const [primo, secondo] = bottoni();

      expect(icone().length).toBe(2);
      expect(primo.textContent?.trim()).toBe('');
      expect(primo.getAttribute('aria-label')).toBe('1M, Questo mese');
      expect(primo.getAttribute('title')).toBe('Questo mese');
      expect(secondo.textContent?.trim()).toBe('');
      expect(secondo.getAttribute('aria-label')).toBe('M−1');
      expect(secondo.getAttribute('title')).toBe('M−1');
    });

    it('in `icon` un\'opzione senza icona mostra comunque il testo', async () => {
      fixture.componentRef.setInput('options', conIcone);
      fixture.componentRef.setInput('display', 'icon');
      await fixture.whenStable();

      const senzaIcona = bottone('Tutto');

      expect(senzaIcona).toBeDefined();
      expect(senzaIcona?.querySelector('svg')).toBeNull();
      expect(senzaIcona?.classList.contains('icon-only')).toBe(false);
    });
  });

  describe('pillola scorrevole', () => {
    const indicatore = (): HTMLElement | null => host().querySelector<HTMLElement>('.indicator');

    it('l\'indicatore esiste, è nascosto agli screen reader e precede i bottoni', () => {
      expect(indicatore()).not.toBeNull();
      expect(indicatore()?.getAttribute('aria-hidden')).toBe('true');
      expect(indicatore()?.nextElementSibling?.tagName.toLowerCase()).toBe('button');
    });

    it('è visibile quando un\'opzione è attiva e nascosto quando value non è fra le options', async () => {
      expect(indicatore()?.classList.contains('visible')).toBe(true);

      fixture.componentRef.setInput('value', 'inesistente');
      await fixture.whenStable();

      expect(indicatore()?.classList.contains('visible')).toBe(false);
    });

    describe('misure', () => {
      // jsdom non fa layout e restituisce sempre 0: simuliamo bottoni larghi 40px affiancati,
      // per verificare che la logica copi le misure del bottone attivo, non i pixel reali.
      const proprieta = ['offsetLeft', 'offsetWidth'] as const;
      const originali = new Map(proprieta.map((nome) => [nome, Object.getOwnPropertyDescriptor(HTMLElement.prototype, nome)]));

      beforeEach(() => {
        Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
          configurable: true,
          get(this: HTMLElement) {
            return this.tagName === 'BUTTON' ? [...(this.parentElement?.querySelectorAll('button') ?? [])].indexOf(this as HTMLButtonElement) * 40 : 0;
          }
        });
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
          configurable: true,
          get(this: HTMLElement) {
            return this.tagName === 'BUTTON' ? 40 : 0;
          }
        });
      });

      afterEach(() => {
        for (const [nome, descrittore] of originali) {
          if (descrittore) {
            Object.defineProperty(HTMLElement.prototype, nome, descrittore);
          }
        }
      });

      it('al cambio di value le variabili seguono il nuovo bottone attivo', async () => {
        fixture.componentRef.setInput('value', 'previous-month');
        await fixture.whenStable();

        expect(indicatore()?.style.getPropertyValue('--x')).toBe('40px');
        expect(indicatore()?.style.getPropertyValue('--w')).toBe('40px');

        fixture.componentRef.setInput('value', 'all');
        await fixture.whenStable();

        expect(indicatore()?.style.getPropertyValue('--x')).toBe('80px');
      });

      it('l\'animazione si abilita solo dopo il primo posizionamento', async () => {
        fixture.componentRef.setInput('value', 'previous-month');
        await fixture.whenStable();

        await new Promise((resolve) => setTimeout(resolve, 50));
        await fixture.whenStable();

        expect(indicatore()?.classList.contains('ready')).toBe(true);
      });
    });
  });
});
