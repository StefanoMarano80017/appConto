import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PageLayout } from './page-layout';

@Component({
  imports: [PageLayout],
  template: `<app-page-layout><p>dati</p></app-page-layout>`
})
class SenzaToolbox {}

@Component({
  imports: [PageLayout],
  template: `<app-page-layout>
    <p>dati</p>
    <aside pageToolbox><button>filtro</button></aside>
  </app-page-layout>`
})
class ConToolbox {}

describe('PageLayout', () => {
  const rendi = async (tipo: typeof SenzaToolbox | typeof ConToolbox) => {
    const fixture = TestBed.createComponent(tipo);
    await fixture.whenStable();

    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SenzaToolbox, ConToolbox] }).compileComponents();
  });

  it('mostra sempre il contenuto principale', async () => {
    const host = await rendi(SenzaToolbox);

    expect(host.querySelector('.main')?.textContent?.trim()).toBe('dati');
  });

  // Review Focus 2: una toolbox senza contenuto non deve riservare una colonna.
  it('lascia la colonna della toolbox vuota quando nessuno proietta', async () => {
    const host = await rendi(SenzaToolbox);
    const toolbox = host.querySelector('.toolbox') as HTMLElement;

    expect(toolbox.children.length).toBe(0);
  });

  it('accoglie il contenuto proiettato nella toolbox', async () => {
    const host = await rendi(ConToolbox);
    const toolbox = host.querySelector('.toolbox') as HTMLElement;

    expect(toolbox.children.length).toBe(1);
    expect(toolbox.querySelector('button')?.textContent?.trim()).toBe('filtro');
  });
});
