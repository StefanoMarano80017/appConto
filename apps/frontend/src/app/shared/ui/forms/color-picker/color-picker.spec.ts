import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ColorPicker } from './color-picker';

@Component({
  imports: [ColorPicker],
  template: `
    <app-color-picker [(value)]="value" [ariaLabel]="ariaLabel" [disabled]="disabled()" />
  `,
})
class Host {
  readonly value = signal('#4f9b68');
  readonly ariaLabel = 'Colore categoria';
  readonly disabled = signal(false);
}

@Component({
  imports: [ColorPicker, FormsModule],
  template: `<app-color-picker [(ngModel)]="value" ariaLabel="Colore" />`,
})
class NgModelHost {
  value = '#9aa3af';
}

describe('ColorPicker', () => {
  let fixture: ComponentFixture<Host>;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const trigger = (): HTMLButtonElement =>
    root().querySelector('.color-picker-trigger') as HTMLButtonElement;
  const panel = (): HTMLElement | null => root().querySelector('.color-picker-panel');
  const confirmButton = (): HTMLButtonElement =>
    root().querySelector('.color-picker-confirm') as HTMLButtonElement;
  const key = (target: HTMLElement, name: string): void => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
    );
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('mostra il colore selezionato e il nome accessibile', () => {
    expect(trigger().getAttribute('aria-label')).toBe('Colore categoria');
    expect(
      (trigger().querySelector('.color-picker-swatch') as HTMLElement).style.backgroundColor,
    ).toBe('rgb(79, 155, 104)');
  });

  it('apre la palette e applica una scelta predefinita', async () => {
    const picker = fixture.debugElement.children[0].componentInstance as ColorPicker;
    const committed = vi.fn();
    picker.valueCommitted.subscribe(committed);

    trigger().click();
    await fixture.whenStable();

    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(panel()?.getAttribute('role')).toBe('dialog');

    (root().querySelector('[aria-label="Blu"]') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe('#5572b8');
    expect(committed).toHaveBeenCalledWith('#5572b8');
    expect(panel()).toBeNull();
  });

  it('mostra in anteprima il colore dal campo HEX e lo applica con Conferma', async () => {
    trigger().click();
    await fixture.whenStable();

    const input = root().querySelector('input[type="text"]') as HTMLInputElement;
    input.value = '#123456';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe('#4f9b68');
    expect(panel()).not.toBeNull();
    expect(root().querySelector('input[type="color"]')).toBeNull();
    expect(
      (trigger().querySelector('.color-picker-swatch') as HTMLElement).style.backgroundColor,
    ).toBe('rgb(18, 52, 86)');

    confirmButton().click();
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe('#123456');
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('aggiorna anteprima, HEX e valori RGB mentre si muove uno slider', async () => {
    trigger().click();
    await fixture.whenStable();

    const redSlider = root().querySelector(
      'input[type="range"][aria-label="Rosso (RGB)"]',
    ) as HTMLInputElement;
    redSlider.value = '255';
    redSlider.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe('#4f9b68');
    expect(
      (root().querySelector('.color-picker-preview') as HTMLElement).style.backgroundColor,
    ).toBe('rgb(255, 155, 104)');
    expect((root().querySelector('input[type="text"]') as HTMLInputElement).value).toBe('#ff9b68');
    expect(redSlider.value).toBe('255');
    expect(redSlider.style.getPropertyValue('--channel-color')).toBe('var(--color-error)');
    expect(
      (
        root().querySelector('input[type="range"][aria-label="Verde (RGB)"]') as HTMLInputElement
      ).style.getPropertyValue('--channel-color'),
    ).toBe('var(--color-income)');
    expect(
      (
        root().querySelector('input[type="range"][aria-label="Blu (RGB)"]') as HTMLInputElement
      ).style.getPropertyValue('--channel-color'),
    ).toBe('var(--color-info)');
    expect(panel()).not.toBeNull();
  });

  it('emette il colore salvabile solo alla conferma', async () => {
    const picker = fixture.debugElement.children[0].componentInstance as ColorPicker;
    const committed = vi.fn();
    picker.valueCommitted.subscribe(committed);

    trigger().click();
    await fixture.whenStable();

    const slider = root().querySelector(
      'input[type="range"][aria-label="Rosso (RGB)"]',
    ) as HTMLInputElement;
    slider.value = '255';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(committed).not.toHaveBeenCalled();

    slider.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
    expect(committed).not.toHaveBeenCalled();

    confirmButton().click();
    await fixture.whenStable();

    expect(committed).toHaveBeenCalledOnce();
    expect(committed).toHaveBeenCalledWith('#ff9b68');
    expect(fixture.componentInstance.value()).toBe('#ff9b68');
  });

  it('scarta la bozza se il pannello si chiude senza conferma', async () => {
    const picker = fixture.debugElement.children[0].componentInstance as ColorPicker;
    const committed = vi.fn();
    picker.valueCommitted.subscribe(committed);

    trigger().click();
    await fixture.whenStable();

    const slider = root().querySelector(
      'input[type="range"][aria-label="Rosso (RGB)"]',
    ) as HTMLInputElement;
    slider.value = '255';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();

    key(panel()!, 'Escape');
    await fixture.whenStable();

    expect(committed).not.toHaveBeenCalled();
    expect(fixture.componentInstance.value()).toBe('#4f9b68');
    expect(
      (trigger().querySelector('.color-picker-swatch') as HTMLElement).style.backgroundColor,
    ).toBe('rgb(79, 155, 104)');
  });

  it('non si fa sovrascrivere da un valore esterno mentre il pannello è aperto', async () => {
    trigger().click();
    await fixture.whenStable();

    const slider = root().querySelector(
      'input[type="range"][aria-label="Rosso (RGB)"]',
    ) as HTMLInputElement;
    slider.value = '255';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();

    fixture.componentInstance.value.set('#000000');
    await fixture.whenStable();

    expect(
      (root().querySelector('.color-picker-preview') as HTMLElement).style.backgroundColor,
    ).toBe('rgb(255, 155, 104)');
    expect(slider.value).toBe('255');
  });

  it('segnala un codice HEX non valido senza cambiare colore', async () => {
    trigger().click();
    await fixture.whenStable();

    const input = root().querySelector('input[type="text"]') as HTMLInputElement;
    input.value = '#123';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe('#4f9b68');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(panel()).not.toBeNull();
  });

  it('sposta il fuoco fra i colori con le frecce e chiude con Escape', async () => {
    trigger().click();
    await fixture.whenStable();

    const panelElement = panel()!;
    key(document.activeElement as HTMLElement, 'ArrowRight');
    await fixture.whenStable();
    expect((document.activeElement as HTMLElement).getAttribute('data-color-index')).toBe('5');

    key(panelElement, 'Escape');
    await fixture.whenStable();

    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('non apre il pannello quando disabilitato', async () => {
    fixture.componentInstance.disabled.set(true);
    await fixture.whenStable();

    expect(trigger().disabled).toBe(true);
    trigger().click();
    await fixture.whenStable();
    expect(panel()).toBeNull();
  });

  it('supporta ngModel come controllo di form', async () => {
    const modelFixture = TestBed.createComponent(NgModelHost);
    await modelFixture.whenStable();

    (
      modelFixture.nativeElement.querySelector('.color-picker-trigger') as HTMLButtonElement
    ).click();
    await modelFixture.whenStable();
    (modelFixture.nativeElement.querySelector('[aria-label="Blu"]') as HTMLButtonElement).click();
    await modelFixture.whenStable();

    expect(modelFixture.componentInstance.value).toBe('#5572b8');
  });
});
