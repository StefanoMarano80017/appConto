import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideCalendarDays } from '@lucide/angular';
import { FilterGroup } from './filter-group';

@Component({
  imports: [FilterGroup, LucideCalendarDays],
  template: `
    <app-filter-group label="Periodo" [count]="count()" [initiallyOpen]="initiallyOpen()">
      <svg icon lucideCalendarDays></svg>
      <input placeholder="cerca" />
    </app-filter-group>
  `
})
class Ospite {
  readonly count = input(0);
  readonly initiallyOpen = input(false);
}

describe('FilterGroup', () => {
  let fixture: ComponentFixture<Ospite>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Ospite] }).compileComponents();
    fixture = TestBed.createComponent(Ospite);
  });

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const bottone = (): HTMLButtonElement => host().querySelector('.toggle') as HTMLButtonElement;
  const pannello = (): HTMLElement => host().querySelector('.body') as HTMLElement;

  it("mostra l'etichetta e proietta il controllo", async () => {
    await fixture.whenStable();

    expect(host().querySelector('.label')?.textContent?.trim()).toBe('Periodo');
    expect(host().querySelector('input')?.getAttribute('placeholder')).toBe('cerca');
  });

  it("proietta l'icona dentro lo slot .icon", async () => {
    await fixture.whenStable();

    const icon = host().querySelector('.icon');
    expect(icon?.querySelector('svg[lucideCalendarDays]')).not.toBeNull();
  });

  it('nasconde il contenuto proiettato senza distruggerlo quando la sezione si chiude', async () => {
    await fixture.whenStable();

    // Chiusa di default (`initiallyOpen` a false): il pannello è nascosto ma
    // il nodo esiste ancora, altrimenti con `@if` sarebbe sparito insieme.
    const input = host().querySelector('input');
    expect(pannello().hidden).toBe(true);
    expect(input).not.toBeNull();

    bottone().click();
    await fixture.whenStable();

    // Stesso nodo, non un rimpiazzo: è la garanzia che @if non darebbe.
    expect(pannello().hidden).toBe(false);
    expect(host().querySelector('input')).toBe(input);

    bottone().click();
    await fixture.whenStable();

    expect(pannello().hidden).toBe(true);
    expect(host().querySelector('input')).toBe(input);
  });

  it('il click sul bottone inverte aria-expanded', async () => {
    await fixture.whenStable();
    expect(bottone().getAttribute('aria-expanded')).toBe('false');

    bottone().click();
    await fixture.whenStable();
    expect(bottone().getAttribute('aria-expanded')).toBe('true');

    bottone().click();
    await fixture.whenStable();
    expect(bottone().getAttribute('aria-expanded')).toBe('false');
  });

  it('collega bottone e region per lo screen reader', async () => {
    await fixture.whenStable();

    const region = pannello();
    expect(region.getAttribute('role')).toBe('region');
    expect(bottone().getAttribute('aria-controls')).toBe(region.id);
    expect(region.getAttribute('aria-labelledby')).toBe(bottone().id);
  });

  it('mostra il badge del conteggio solo quando count è maggiore di zero', async () => {
    fixture.componentRef.setInput('count', 0);
    await fixture.whenStable();
    expect(host().querySelector('.count')).toBeNull();

    fixture.componentRef.setInput('count', 3);
    await fixture.whenStable();
    expect(host().querySelector('.count')?.textContent?.trim()).toBe('3');
  });
});
