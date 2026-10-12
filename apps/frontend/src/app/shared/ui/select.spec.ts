import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule, NgModel } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { LucideTrendingUp } from '@lucide/angular';
import { Select } from './select';
import { SelectOption } from './select.model';
import { chooseOption, selectedName, selectTrigger } from './select.testing';

const OPTIONS: readonly SelectOption[] = [
  { id: 'food', name: 'Alimentari', color: '#d44' },
  { id: 'income', name: 'Entrata', icon: LucideTrendingUp.icon },
  { id: 'caffe', name: 'Caffè' },
];

const MANY: readonly SelectOption[] = [
  'Affitto',
  'Alimentari',
  'Assicurazioni',
  'Bollette',
  'Caffè',
  'Cinema',
  'Libri',
  'Palestra',
  'Regali',
  'Ristoranti',
  'Trasporti',
  'Viaggi',
].map((name) => ({ id: name.toLowerCase(), name }));

@Component({
  selector: 'app-select-host',
  imports: [Select],
  template: `
    <div class="primo">
      <app-select
        [options]="options()"
        [(value)]="value"
        [ariaLabel]="ariaLabel()"
        [appearance]="appearance()"
        [placeholder]="placeholder()"
        [placeholderPosition]="placeholderPosition()"
        [ariaInvalid]="ariaInvalid()"
        [ariaDescribedBy]="describedBy()"
        [triggerId]="triggerId()"
        [searchable]="searchable()"
        [disabled]="disabled()"
        [readonly]="readonly()"
      />
    </div>
    <div class="secondo">
      <app-select [options]="options()" ariaLabel="Altro" />
    </div>
  `,
})
class Host {
  readonly options = signal<readonly SelectOption[]>(OPTIONS);
  readonly value = signal<string | null>('food');
  readonly ariaLabel = signal<string | null>('Categoria');
  readonly appearance = signal<'inline' | 'field'>('inline');
  readonly placeholder = signal<string | null>(null);
  readonly placeholderPosition = signal<'start' | 'end'>('start');
  readonly ariaInvalid = signal(false);
  readonly describedBy = signal<string | null>(null);
  readonly triggerId = signal<string | null>(null);
  readonly searchable = signal<boolean | 'auto'>('auto');
  readonly disabled = signal(false);
  readonly readonly = signal(false);
}

@Component({
  selector: 'app-select-ng-model-host',
  imports: [Select, FormsModule],
  template: `<div class="modulo"><app-select [options]="options" [(ngModel)]="model" ariaLabel="Categoria" /></div>`,
})
class NgModelHost {
  readonly options = OPTIONS;
  readonly model = signal<string | null>('food');
}

describe('Select', () => {
  let fixture: ComponentFixture<Host>;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const trigger = (): HTMLButtonElement => selectTrigger(root(), '.primo');
  const panel = (): HTMLElement | null => root().querySelector('.primo .select-panel');
  const options = (): HTMLElement[] => [...root().querySelectorAll<HTMLElement>('.primo [role="option"]')];
  const option = (name: string): HTMLElement | undefined =>
    options().find((candidate) => candidate.textContent?.trim() === name);
  const search = (): HTMLInputElement | null => root().querySelector('.primo .select-search');
  const select = (): Select => fixture.debugElement.query(By.directive(Select)).componentInstance as Select;
  const key = (target: HTMLElement, name: string, init: KeyboardEventInit = {}): void => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
  };
  const open = async (): Promise<void> => {
    trigger().click();
    await fixture.whenStable();
  };
  const type = async (text: string): Promise<void> => {
    const input = search()!;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('mostra nome, pallino o icona del valore selezionato', async () => {
    expect(selectedName(root(), '.primo')).toBe('Alimentari');
    expect(trigger().querySelector('app-color-marker')).not.toBeNull();
    expect(trigger().querySelector('.select-icon')).toBeNull();

    fixture.componentInstance.value.set('income');
    await fixture.whenStable();

    expect(selectedName(root(), '.primo')).toBe('Entrata');
    expect(trigger().querySelector('.select-icon')).not.toBeNull();
    expect(trigger().querySelector('app-color-marker')).toBeNull();

    fixture.componentInstance.value.set('caffe');
    await fixture.whenStable();

    expect(selectedName(root(), '.primo')).toBe('Caffè');
    expect(trigger().querySelector('.select-icon')).toBeNull();
    expect(trigger().querySelector('app-color-marker')).toBeNull();
    expect(trigger().querySelector('.select-name')?.getAttribute('title')).toBe('Caffè');
  });

  it('value sconosciuto mostra il trattino e nessuna voce ha la spunta', async () => {
    fixture.componentInstance.value.set('sconosciuto');
    await fixture.whenStable();

    expect(selectedName(root(), '.primo')).toBe('—');

    await open();

    expect(options().every((item) => item.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(root().querySelector('.primo .select-check')).toBeNull();
  });

  it('senza valore mostra il placeholder come testo muted', async () => {
    fixture.componentInstance.placeholder.set('Tutti');
    fixture.componentInstance.value.set(null);
    await fixture.whenStable();

    expect(selectedName(root(), '.primo')).toBe('Tutti');
    expect(trigger().querySelector('.select-name')?.classList.contains('muted')).toBe(true);
  });

  it('il trigger espone role combobox, aria-expanded, aria-controls e aria-label', async () => {
    expect(trigger().getAttribute('type')).toBe('button');
    expect(trigger().getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('aria-label')).toBe('Categoria');

    await open();

    const listbox = root().querySelector('.primo [role="listbox"]');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(listbox?.id);
    expect(trigger().getAttribute('aria-activedescendant')).toBe(options()[0].id);
  });

  it('apre con click e chiude con Esc riportando il fuoco al trigger', async () => {
    await open();
    expect(panel()).not.toBeNull();

    key(trigger(), 'Escape');
    await fixture.whenStable();

    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('apre con freccia giù e Invio sceglie la voce attiva', async () => {
    const changes = vi.fn();
    select().value.subscribe(changes);

    key(trigger(), 'ArrowDown');
    await fixture.whenStable();
    expect(panel()).not.toBeNull();
    // All'apertura l'opzione attiva è quella selezionata.
    expect(trigger().getAttribute('aria-activedescendant')).toBe(option('Alimentari')?.id);

    key(trigger(), 'ArrowDown');
    await fixture.whenStable();
    key(trigger(), 'Enter');
    await fixture.whenStable();

    expect(panel()).toBeNull();
    expect(changes).toHaveBeenCalledWith('income');
    expect(fixture.componentInstance.value()).toBe('income');
    expect(trigger().classList.contains('selection-made')).toBe(true);

    trigger().dispatchEvent(new FocusEvent('blur'));
    await fixture.whenStable();
    expect(trigger().classList.contains('selection-made')).toBe(false);
  });

  it('le frecce spostano aria-activedescendant e Home/End vanno agli estremi', async () => {
    await open();
    const ids = options().map((item) => item.id);
    const active = (): string | null => trigger().getAttribute('aria-activedescendant');

    key(trigger(), 'ArrowDown');
    await fixture.whenStable();
    expect(active()).toBe(ids[1]);

    key(trigger(), 'End');
    await fixture.whenStable();
    expect(active()).toBe(ids[2]);

    key(trigger(), 'ArrowUp');
    await fixture.whenStable();
    expect(active()).toBe(ids[1]);

    key(trigger(), 'Home');
    await fixture.whenStable();
    expect(active()).toBe(ids[0]);
    expect(option('Alimentari')?.classList.contains('active')).toBe(true);
  });

  it('Tab chiude senza scegliere', async () => {
    const changes = vi.fn();
    select().value.subscribe(changes);
    await open();

    key(trigger(), 'ArrowDown');
    key(trigger(), 'Tab');
    await fixture.whenStable();

    expect(panel()).toBeNull();
    expect(changes).not.toHaveBeenCalled();
    expect(fixture.componentInstance.value()).toBe('food');
  });

  it('click fuori chiude, anche sul trigger di un altro app-select', async () => {
    await open();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await fixture.whenStable();
    expect(panel()).toBeNull();

    await open();
    const other = selectTrigger(root(), '.secondo');
    other.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    other.click();
    await fixture.whenStable();

    expect(panel()).toBeNull();
    expect(root().querySelector('.secondo .select-panel')).not.toBeNull();
  });

  it('id della listbox univoci tra istanze', async () => {
    const first = trigger().getAttribute('aria-controls');
    const second = selectTrigger(root(), '.secondo').getAttribute('aria-controls');

    expect(first).toMatch(/^app-select-\d+-listbox$/);
    expect(second).toMatch(/^app-select-\d+-listbox$/);
    expect(first).not.toBe(second);
  });

  it('click su una voce emette valueChange e chiude', async () => {
    const changes = vi.fn();
    select().value.subscribe(changes);

    await chooseOption(fixture as ComponentFixture<unknown>, root(), '.primo', 'Caffè');

    expect(changes).toHaveBeenCalledExactlyOnceWith('caffe');
    expect(panel()).toBeNull();
    expect(selectedName(root(), '.primo')).toBe('Caffè');
    expect(document.activeElement).toBe(trigger());
  });

  it('non emette se si sceglie la voce già selezionata', async () => {
    const changes = vi.fn();
    select().value.subscribe(changes);

    await chooseOption(fixture as ComponentFixture<unknown>, root(), '.primo', 'Alimentari');

    expect(changes).not.toHaveBeenCalled();
    expect(panel()).toBeNull();
  });

  it('il placeholder in fondo emette null', async () => {
    fixture.componentInstance.placeholder.set('— Nessuna categoria');
    fixture.componentInstance.placeholderPosition.set('end');
    await fixture.whenStable();
    const changes = vi.fn();
    select().value.subscribe(changes);

    await open();
    const last = options().at(-1)!;
    expect(last.textContent?.trim()).toBe('— Nessuna categoria');
    expect(last.classList.contains('placeholder')).toBe(true);

    last.click();
    await fixture.whenStable();

    expect(changes).toHaveBeenCalledWith(null);
    expect(fixture.componentInstance.value()).toBeNull();
    expect(selectedName(root(), '.primo')).toBe('— Nessuna categoria');
  });

  it('aggiorna la spunta quando value cambia da fuori a pannello aperto', async () => {
    await open();
    expect(option('Alimentari')?.getAttribute('aria-selected')).toBe('true');

    fixture.componentInstance.value.set('caffe');
    await fixture.whenStable();

    expect(option('Alimentari')?.getAttribute('aria-selected')).toBe('false');
    expect(option('Caffè')?.getAttribute('aria-selected')).toBe('true');
    expect(option('Caffè')?.querySelector('.select-check')).not.toBeNull();
  });

  it('senza ricerca, digitare una lettera salta alla voce che inizia così', async () => {
    await open();
    expect(search()).toBeNull();

    key(trigger(), 'c');
    await fixture.whenStable();
    expect(trigger().getAttribute('aria-activedescendant')).toBe(option('Caffè')?.id);

    key(trigger(), 'E');
    await fixture.whenStable();
    expect(trigger().getAttribute('aria-activedescendant')).toBe(option('Entrata')?.id);
  });

  describe('ricerca', () => {
    beforeEach(async () => {
      fixture.componentInstance.options.set(MANY);
      fixture.componentInstance.value.set('affitto');
      await fixture.whenStable();
    });

    it('con più di 8 opzioni mostra la ricerca e le dà il fuoco', async () => {
      await open();

      expect(search()).not.toBeNull();
      expect(search()?.getAttribute('placeholder')).toBe('Cerca…');
      expect(document.activeElement).toBe(search());
      expect(search()?.getAttribute('role')).toBe('combobox');
      expect(search()?.getAttribute('aria-controls')).toBe(trigger().getAttribute('aria-controls'));
      expect(search()?.getAttribute('aria-activedescendant')).toBe(option('Affitto')?.id);
      expect(trigger().hasAttribute('aria-activedescendant')).toBe(false);
    });

    it('la ricerca filtra ignorando gli accenti ed evidenzia il match', async () => {
      await open();
      await type('caffe');

      expect(options()).toHaveLength(1);
      expect(options()[0].querySelector('mark')?.textContent).toBe('Caffè');
      expect(search()?.getAttribute('aria-activedescendant')).toBe(options()[0].id);

      key(search()!, 'Enter');
      await fixture.whenStable();

      expect(fixture.componentInstance.value()).toBe('caffè');
      expect(panel()).toBeNull();
    });

    it('la ricerca senza risultati mostra emptyText ma tiene il placeholder', async () => {
      fixture.componentInstance.placeholder.set('Tutte');
      await fixture.whenStable();
      await open();
      await type('zzz');

      expect(root().querySelector('.primo .select-empty')?.textContent?.trim()).toBe('Nessun risultato');
      expect(options()).toHaveLength(1);
      expect(options()[0].textContent?.trim()).toBe('Tutte');
    });

    it('la ricerca si svuota a ogni apertura', async () => {
      await open();
      await type('cin');
      expect(options()).toHaveLength(1);

      key(search()!, 'Escape');
      await fixture.whenStable();
      expect(document.activeElement).toBe(trigger());

      await open();
      expect(search()?.value).toBe('');
      expect(options()).toHaveLength(MANY.length);
    });

    it('searchable false toglie la ricerca anche con molte opzioni', async () => {
      fixture.componentInstance.searchable.set(false);
      await fixture.whenStable();
      await open();

      expect(search()).toBeNull();
    });
  });

  it('readonly mostra solo il nome, senza button né chevron', async () => {
    fixture.componentInstance.readonly.set(true);
    await fixture.whenStable();

    const readonly = root().querySelector('.primo .select-readonly');
    expect(readonly?.textContent?.trim()).toBe('Alimentari');
    expect(readonly?.querySelector('app-color-marker')).not.toBeNull();
    expect(root().querySelector('.primo button')).toBeNull();
    expect(root().querySelector('.primo .select-chevron')).toBeNull();
  });

  it('disabled disabilita il trigger', async () => {
    fixture.componentInstance.disabled.set(true);
    await fixture.whenStable();

    expect(trigger().disabled).toBe(true);
  });

  it('appearance field applica la classe field e inoltra aria-invalid, aria-describedby e id', async () => {
    expect(trigger().classList.contains('inline')).toBe(true);
    expect(trigger().hasAttribute('aria-invalid')).toBe(false);

    fixture.componentInstance.appearance.set('field');
    fixture.componentInstance.ariaInvalid.set(true);
    fixture.componentInstance.describedBy.set('colonna-errore');
    fixture.componentInstance.triggerId.set('colonna-data');
    await fixture.whenStable();

    expect(trigger().classList.contains('field')).toBe(true);
    expect(trigger().classList.contains('inline')).toBe(false);
    expect(trigger().getAttribute('aria-invalid')).toBe('true');
    expect(trigger().getAttribute('aria-describedby')).toBe('colonna-errore');
    expect(trigger().id).toBe('colonna-data');
  });

  it('riposiziona il pannello allo scroll', async () => {
    let rect = { top: 100, bottom: 130, left: 20, right: 220, width: 200, height: 30 };
    trigger().getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, toJSON: () => rect }) as DOMRect;

    await open();
    expect(panel()?.style.top).toBe('134px');
    expect(panel()?.style.left).toBe('20px');
    expect(panel()?.style.minWidth).toBe('200px');

    rect = { ...rect, top: 50, bottom: 80 };
    window.dispatchEvent(new Event('scroll'));

    expect(panel()?.style.top).toBe('84px');
  });

  it('si apre sopra se sotto non c\'è spazio', async () => {
    const bottom = window.innerHeight - 20;
    const rect = { top: bottom - 30, bottom, left: 20, right: 220, width: 200, height: 30 };
    trigger().getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, toJSON: () => rect }) as DOMRect;

    await open();

    expect(panel()?.classList.contains('above')).toBe(true);
    expect(panel()?.style.bottom).toBe(`${window.innerHeight - rect.top + 4}px`);
  });
});

describe('Select con ngModel', () => {
  it('funziona con ngModel', async () => {
    await TestBed.configureTestingModule({ imports: [NgModelHost] }).compileComponents();
    const fixture = TestBed.createComponent(NgModelHost);
    const root = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();

    expect(selectedName(root, '.modulo')).toBe('Alimentari');

    await chooseOption(fixture as ComponentFixture<unknown>, root, '.modulo', 'Entrata');
    expect(fixture.componentInstance.model()).toBe('income');

    fixture.componentInstance.model.set('caffe');
    await fixture.whenStable();
    expect(selectedName(root, '.modulo')).toBe('Caffè');

    const ngModel = fixture.debugElement.query(By.directive(NgModel)).injector.get(NgModel);
    ngModel.control.disable();
    await fixture.whenStable();
    expect(selectTrigger(root, '.modulo').disabled).toBe(true);
  });
});
