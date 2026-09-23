import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FilterGroup } from './filter-group';

@Component({
  imports: [FilterGroup],
  template: `<app-filter-group label="Periodo"><button>ultimi 30 giorni</button></app-filter-group>`
})
class Ospite {}

describe('FilterGroup', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Ospite] }).compileComponents();
  });

  it("mostra l'etichetta e proietta il controllo", async () => {
    const fixture = TestBed.createComponent(Ospite);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.label')?.textContent?.trim()).toBe('Periodo');
    expect(host.querySelector('button')?.textContent?.trim()).toBe('ultimi 30 giorni');
  });
});
