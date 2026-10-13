import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CategoryWithUsage } from '../category.model';
import { CategoryTile } from './category-tile';

const SPESA: CategoryWithUsage = {
  id: 'cat-spesa',
  name: 'Spesa',
  color: '#4f9b68',
  merchantCount: 3,
};

/** Host di test: fa da contenitore della tessera e registra ogni output. */
@Component({
  imports: [CategoryTile],
  template: `
    <app-category-tile
      [category]="category()"
      [locked]="locked()"
      [busy]="busy()"
      [confirmingDelete]="confirmingDelete()"
      [deleting]="deleting()"
      (renamed)="events.push(['renamed', $event])"
      (recolored)="events.push(['recolored', $event])"
      (deleteAsked)="events.push(['deleteAsked'])"
      (deleteCancelled)="events.push(['deleteCancelled'])"
      (deleteConfirmed)="events.push(['deleteConfirmed'])"
      (created)="events.push(['created', $event])"
      (draftDismissed)="events.push(['draftDismissed'])"
    />
    <button type="button" class="outside">Fuori</button>
  `,
})
class Host {
  readonly category = signal<CategoryWithUsage | null>(SPESA);
  readonly locked = signal(false);
  readonly busy = signal(false);
  readonly confirmingDelete = signal(false);
  readonly deleting = signal(false);
  readonly events: unknown[][] = [];
}

describe('CategoryTile', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const tile = (): HTMLElement => root().querySelector('app-category-tile') as HTMLElement;
  const q = <T extends Element = HTMLElement>(selector: string): T | null =>
    tile().querySelector<T>(selector);
  const field = (): HTMLInputElement | null => q<HTMLInputElement>('input.name-input');
  const key = (target: HTMLElement, name: string): void => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
    );
  };
  const type = (input: HTMLInputElement, value: string): void => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const focusOut = (from: HTMLElement, to: EventTarget | null): void => {
    from.dispatchEvent(new FocusEvent('focusout', { relatedTarget: to, bubbles: true }));
  };
  const stable = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const startEditing = async (): Promise<HTMLInputElement> => {
    (q<HTMLButtonElement>('button.name') as HTMLButtonElement).click();
    await stable();
    return field() as HTMLInputElement;
  };

  async function setup(configure?: (h: Host) => void): Promise<void> {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    configure?.(host);
    await stable();
  }

  it('mostra colore, nome, matita e numero di merchant', async () => {
    await setup();

    const picker = q('app-color-picker .color-picker-trigger') as HTMLElement;
    expect(picker.getAttribute('aria-label')).toBe('Colore di Spesa');
    const name = q<HTMLButtonElement>('button.name') as HTMLButtonElement;
    expect(name.textContent?.trim()).toBe('Spesa');
    expect(name.getAttribute('title')).toBe('Spesa');
    expect(name.querySelector('span')).not.toBeNull();
    expect(q('button.edit svg')).not.toBeNull();
    expect(q('.count')?.textContent?.trim()).toBe('3 merchant');
    expect(q('button.delete')?.getAttribute('aria-label')).toBe('Elimina Spesa');
    expect(field()).toBeNull();
  });

  it('clic sul nome apre il campo col nome selezionato e il focus', async () => {
    await setup();

    const input = await startEditing();

    expect(input).not.toBeNull();
    expect(input.value).toBe('Spesa');
    expect(input.getAttribute('aria-label')).toBe('Nome di Spesa');
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Spesa'.length);
    expect(q('button.edit')).toBeNull();
    expect(q('button.delete')).toBeNull();
    expect(tile().classList).toContain('editing');
  });

  it('anche la matita apre il campo', async () => {
    await setup();

    (q<HTMLButtonElement>('button.edit') as HTMLButtonElement).click();
    await stable();

    expect(field()?.value).toBe('Spesa');
  });

  it('Invio emette il nome ripulito dagli spazi', async () => {
    await setup();
    const input = await startEditing();

    type(input, '  Casa nuova  ');
    key(input, 'Enter');
    await stable();

    expect(host.events).toEqual([['renamed', 'Casa nuova']]);
    expect(field()).toBeNull();
  });

  it('Invio con nome vuoto o invariato non emette ed esce dalla modifica', async () => {
    await setup();

    let input = await startEditing();
    type(input, '   ');
    key(input, 'Enter');
    await stable();
    expect(field()).toBeNull();

    input = await startEditing();
    type(input, ' Spesa ');
    key(input, 'Enter');
    await stable();
    expect(field()).toBeNull();

    expect(host.events).toEqual([]);
  });

  it('Esc annulla e ripristina il nome', async () => {
    await setup();
    let input = await startEditing();

    type(input, 'Altro nome');
    key(input, 'Escape');
    await stable();

    expect(host.events).toEqual([]);
    expect(field()).toBeNull();
    expect(q('button.name')?.textContent?.trim()).toBe('Spesa');

    input = await startEditing();
    expect(input.value).toBe('Spesa');
  });

  it("focusout verso l'esterno salva", async () => {
    await setup();
    const input = await startEditing();

    type(input, 'Supermercato');
    focusOut(input, document.body);
    await stable();

    expect(host.events).toEqual([['renamed', 'Supermercato']]);
    expect(field()).toBeNull();
  });

  it('focusout verso un controllo della stessa tessera non chiude la modifica', async () => {
    await setup();
    const input = await startEditing();

    type(input, 'Supermercato');
    focusOut(input, q('app-color-picker button') as HTMLElement);
    await stable();

    expect(host.events).toEqual([]);
    expect(field()?.value).toBe('Supermercato');
  });

  it('categoria bloccata: lucchetto, niente matita né cestino, nome non modificabile', async () => {
    await setup((h) => {
      h.category.set({ ...SPESA, name: 'Da classificare' });
      h.locked.set(true);
    });

    expect(q('svg.lock')).not.toBeNull();
    expect(q('button.edit')).toBeNull();
    expect(q('button.delete')).toBeNull();
    expect(q('button.name')).toBeNull();
    const name = q('.name') as HTMLElement;
    expect(name.textContent?.trim()).toBe('Da classificare');
    expect(name.getAttribute('title')).toBe('Da classificare');

    name.click();
    await stable();
    expect(field()).toBeNull();

    // Il colore resta modificabile.
    expect(
      (q<HTMLButtonElement>('app-color-picker button') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('cestino emette deleteAsked; in conferma mostra il testo al singolare e al plurale', async () => {
    await setup((h) => h.category.set({ ...SPESA, merchantCount: 1 }));

    (q<HTMLButtonElement>('button.delete') as HTMLButtonElement).click();
    expect(host.events).toEqual([['deleteAsked']]);

    host.confirmingDelete.set(true);
    await stable();

    expect(q('.ask')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '1 merchant verrà spostato su «Da classificare». Eliminare?',
    );
    expect(q('app-color-picker')).toBeNull();
    expect(q('button.name')).toBeNull();

    host.category.set({ ...SPESA, merchantCount: 3 });
    await stable();
    expect(q('.ask')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '3 merchant verranno spostati su «Da classificare». Eliminare?',
    );

    const [confirm, cancel] = Array.from(tile().querySelectorAll<HTMLButtonElement>('.confirm button'));
    expect(confirm.textContent?.trim()).toBe('Sì, elimina');
    expect(cancel.textContent?.trim()).toBe('Annulla');
    confirm.click();
    cancel.click();
    expect(host.events).toEqual([['deleteAsked'], ['deleteConfirmed'], ['deleteCancelled']]);

    host.deleting.set(true);
    await stable();
    expect(confirm.textContent?.trim()).toBe('Eliminazione…');
    expect(confirm.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
  });

  it('Esc in conferma emette deleteCancelled', async () => {
    await setup();
    const trash = q<HTMLButtonElement>('button.delete') as HTMLButtonElement;
    trash.focus();
    trash.click();

    host.confirmingDelete.set(true);
    await stable();

    // Il focus entra nella conferma, così la tastiera la raggiunge.
    const active = document.activeElement as HTMLElement;
    expect(q('.confirm')?.contains(active)).toBe(true);

    key(active, 'Escape');
    expect(host.events).toEqual([['deleteAsked'], ['deleteCancelled']]);

    host.confirmingDelete.set(false);
    await stable();

    // All'annullo il focus torna sul cestino.
    expect(document.activeElement).toBe(q('button.delete'));
  });

  it("Esc durante l'eliminazione in corso non annulla", async () => {
    await setup((h) => {
      h.confirmingDelete.set(true);
      h.deleting.set(true);
    });

    key(q('.confirm') as HTMLElement, 'Escape');

    expect(host.events).toEqual([]);
  });

  it('bozza: parte in modifica; Invio emette created con il colore predefinito (#9aa3af)', async () => {
    await setup((h) => h.category.set(null));

    const input = field() as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(q('.count')).toBeNull();
    expect(q('button.delete')).toBeNull();

    key(input, 'Enter');
    expect(host.events).toEqual([]);

    type(input, '  Palestra ');
    key(input, 'Enter');
    await stable();

    expect(host.events).toEqual([['created', { name: 'Palestra', color: '#9aa3af' }]]);
  });

  it('bozza: il colore scelto resta locale fino a created', async () => {
    await setup((h) => h.category.set(null));

    (q<HTMLButtonElement>('app-color-picker button') as HTMLButtonElement).click();
    await stable();
    (q<HTMLButtonElement>('[aria-label="Blu"]') as HTMLButtonElement).click();
    await stable();
    expect(host.events).toEqual([]);

    const input = field() as HTMLInputElement;
    type(input, 'Palestra');
    key(input, 'Enter');

    expect(host.events).toEqual([['created', { name: 'Palestra', color: '#5572b8' }]]);
  });

  it('bozza: focusout verso il color picker della bozza non la chiude; Esc emette draftDismissed', async () => {
    await setup((h) => h.category.set(null));
    const input = field() as HTMLInputElement;

    focusOut(input, q('app-color-picker button') as HTMLElement);
    await stable();
    expect(host.events).toEqual([]);
    expect(field()).not.toBeNull();

    key(input, 'Escape');
    expect(host.events).toEqual([['draftDismissed']]);
  });

  it('bozza: focusout senza relatedTarget dopo un pointerdown sul color picker non la chiude', async () => {
    await setup((h) => h.category.set(null));
    const input = field() as HTMLInputElement;
    const trigger = q('app-color-picker button') as HTMLElement;

    // Safari non dà il focus ai bottoni al clic: il campo perde il focus verso il nulla.
    trigger.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    focusOut(input, null);
    await stable();

    expect(host.events).toEqual([]);
    expect(field()).not.toBeNull();
  });

  it('bozza: pointerdown sul padding della tessera e focusout senza relatedTarget la chiude', async () => {
    await setup((h) => h.category.set(null));

    tile().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    focusOut(field() as HTMLInputElement, null);

    expect(host.events).toEqual([['draftDismissed']]);
  });

  it('rinomina: pointerdown sul padding della tessera e focusout senza relatedTarget salva', async () => {
    await setup();
    const input = await startEditing();
    type(input, 'Supermercato');

    tile().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    focusOut(input, null);
    await stable();

    expect(host.events).toEqual([['renamed', 'Supermercato']]);
    expect(field()).toBeNull();
  });

  it("bozza: focusout senza relatedTarget e senza pointerdown interno la chiude", async () => {
    await setup((h) => h.category.set(null));

    focusOut(field() as HTMLInputElement, null);

    expect(host.events).toEqual([['draftDismissed']]);
  });

  it("bozza: focusout verso l'esterno con nome vuoto emette draftDismissed", async () => {
    await setup((h) => h.category.set(null));
    const input = field() as HTMLInputElement;

    focusOut(input, root().querySelector('.outside') as HTMLElement);

    expect(host.events).toEqual([['draftDismissed']]);
  });

  it('busy disabilita i controlli', async () => {
    await setup((h) => h.busy.set(true));

    const buttons = Array.from(tile().querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(tile().classList).toContain('busy');
  });

  it('colore cambiato emette recolored', async () => {
    await setup();

    (q<HTMLButtonElement>('app-color-picker button') as HTMLButtonElement).click();
    await stable();
    (q<HTMLButtonElement>('[aria-label="Blu"]') as HTMLButtonElement).click();
    await stable();

    expect(host.events).toEqual([['recolored', '#5572b8']]);
  });
  describe('focus da tastiera', () => {
    it('Esc in modifica riporta il focus sul nome', async () => {
      await setup();
      const input = await startEditing();

      key(input, 'Escape');
      await stable();

      expect(document.activeElement).toBe(q('button.name'));
    });

    it('Invio senza modifiche riporta il focus sul nome', async () => {
      await setup();
      const input = await startEditing();

      key(input, 'Enter');
      await stable();

      expect(host.events).toEqual([]);
      expect(document.activeElement).toBe(q('button.name'));
    });

    it('Invio che salva: il focus torna sul nome quando busy finisce', async () => {
      await setup();
      const input = await startEditing();
      type(input, 'Supermercato');
      key(input, 'Enter');
      host.busy.set(true);
      await stable();

      expect((q<HTMLButtonElement>('button.name') as HTMLButtonElement).disabled).toBe(true);
      expect(document.activeElement).not.toBe(q('button.name'));

      host.busy.set(false);
      await stable();
      await stable();

      expect(document.activeElement).toBe(q('button.name'));
    });

    it('cambio colore: il focus torna sul trigger del picker quando busy finisce', async () => {
      await setup();
      (q<HTMLButtonElement>('app-color-picker button') as HTMLButtonElement).click();
      await stable();
      (q<HTMLButtonElement>('[aria-label="Blu"]') as HTMLButtonElement).click();
      expect(document.activeElement).toBe(q('app-color-picker button'));
      // Il browser toglie il focus a un controllo che si disabilita; jsdom no
      // (e non sa togliere il focus a un elemento già disabilitato), quindi lo
      // si toglie a mano prima di `busy`.
      (document.activeElement as HTMLElement).blur();
      host.busy.set(true);
      await stable();
      expect(document.activeElement).toBe(document.body);

      host.busy.set(false);
      await stable();
      await stable();

      expect(host.events).toEqual([['recolored', '#5572b8']]);
      expect(document.activeElement).toBe(q('app-color-picker button'));
    });

    it('eliminazione fallita: alla chiusura della conferma il focus torna sul cestino', async () => {
      await setup((h) => h.confirmingDelete.set(true));
      (tile().querySelector('.confirm button.danger') as HTMLButtonElement).click();
      host.deleting.set(true);
      await stable();

      host.deleting.set(false);
      host.confirmingDelete.set(false);
      await stable();

      expect(document.activeElement).toBe(q('button.delete'));
    });

    it('la conferma che si chiude non ruba il focus finito altrove', async () => {
      await setup((h) => h.confirmingDelete.set(true));
      const outside = root().querySelector('.outside') as HTMLButtonElement;
      outside.focus();

      host.confirmingDelete.set(false);
      await stable();

      expect(document.activeElement).toBe(outside);
    });

    it('bozza: creazione fallita, finito busy il campo riprende il focus', async () => {
      await setup((h) => h.category.set(null));
      const input = field() as HTMLInputElement;
      type(input, 'Palestra');
      key(input, 'Enter');
      // Come sopra: jsdom non toglie il focus al campo che si disabilita.
      input.blur();
      host.busy.set(true);
      await stable();
      expect(document.activeElement).toBe(document.body);

      host.busy.set(false);
      await stable();
      await stable();

      expect(field()?.value).toBe('Palestra');
      expect(document.activeElement).toBe(field());
    });
  });

  describe('pulsanti della bozza', () => {
    const createButton = (): HTMLButtonElement =>
      q<HTMLButtonElement>('button[aria-label="Crea categoria"]') as HTMLButtonElement;
    const dismissButton = (): HTMLButtonElement =>
      q<HTMLButtonElement>('button[aria-label="Annulla nuova categoria"]') as HTMLButtonElement;

    it('solo nella bozza; ✓ disabilitato a nome vuoto, poi emette created', async () => {
      await setup((h) => h.category.set(null));

      expect(createButton().disabled).toBe(true);
      type(field() as HTMLInputElement, ' Palestra ');
      await stable();
      expect(createButton().disabled).toBe(false);

      createButton().click();
      expect(host.events).toEqual([['created', { name: 'Palestra', color: '#9aa3af' }]]);
    });

    it('✕ emette draftDismissed anche con un nome scritto', async () => {
      await setup((h) => h.category.set(null));
      type(field() as HTMLInputElement, 'Palestra');
      await stable();

      dismissButton().click();

      expect(host.events).toEqual([['draftDismissed']]);
    });

    it('il clic sui pulsanti della bozza non la chiude per focusout', async () => {
      await setup((h) => h.category.set(null));
      const input = field() as HTMLInputElement;

      createButton().dispatchEvent(new Event('pointerdown', { bubbles: true }));
      focusOut(input, null);
      focusOut(input, dismissButton());

      expect(host.events).toEqual([]);
    });

    it('le categorie esistenti non hanno i pulsanti della bozza', async () => {
      await setup();
      await startEditing();

      expect(q('.draft-action')).toBeNull();
    });
  });

  it('lettori di schermo: lucchetto e conteggio hanno testo nascosto, non aria-label', async () => {
    await setup((h) => h.locked.set(true));

    expect(q('.lock-slot .sr-only')?.textContent?.trim()).toBe('Categoria protetta');
    expect(q('.count .sr-only')?.textContent?.trim()).toBe('merchant');
    expect(q('.count')?.hasAttribute('aria-label')).toBe(false);
  });
});
