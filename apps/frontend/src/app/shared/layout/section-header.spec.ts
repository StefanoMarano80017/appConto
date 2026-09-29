import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SectionHeader } from './section-header';

/*
 * Ospita `SectionHeader` con tutti e tre gli slot proiettati, per verificare
 * che ciascuno finisca dove deve: l'icona prima del titolo, l'ornamento
 * accanto ad esso, le azioni altrove (a destra), mai mescolati fra loro.
 */
@Component({
  imports: [SectionHeader],
  template: `
    <app-section-header title="Analytics">
      <svg titleIcon data-test="icona"></svg>
      <span titleAdornment data-test="ornamento">3</span>
      <span panelActions data-test="azione">x</span>
    </app-section-header>
  `
})
class Ospite {}

describe('SectionHeader', () => {
  let fixture: ComponentFixture<Ospite>;

  const render = async () => {
    fixture = TestBed.createComponent(Ospite);
    await fixture.whenStable();
  };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Ospite] }).compileComponents();
  });

  /*
   * Il titolo di sezione è sempre un h2: l'unico h1 della pagina è quello
   * della shell, che legge il titolo dalla rotta. Non c'è più un livello
   * "page" da scegliere qui.
   */
  it('rende sempre un h2, mai un h1', async () => {
    await render();

    expect(host().querySelector('h2')?.textContent?.trim()).toBe('Analytics');
    expect(host().querySelector('h1')).toBeNull();
  });

  it('proietta un ornamento accanto al titolo, distinto dalle azioni', async () => {
    await render();

    const titolo = host().querySelector('.title-row');

    // Prima che `.title-row` esista, e non per pignoleria: senza questa riga
    // `titolo?.querySelector(...)` varrebbe `undefined` se la riga del titolo
    // sparisse, e `expect(undefined).not.toBeNull()` passa. Il test
    // continuerebbe a dirsi verde mentre non guarda più niente.
    expect(titolo).not.toBeNull();
    expect(titolo?.querySelector('[data-test="ornamento"]')).not.toBeNull();
    expect(host().querySelector('.actions [data-test="ornamento"]')).toBeNull();
  });

  it("proietta un'icona prima del titolo, distinta dalle azioni", async () => {
    await render();

    const titolo = host().querySelector('.title-row');

    expect(titolo).not.toBeNull();
    expect(titolo?.querySelector('.title-icon [data-test="icona"]')).not.toBeNull();
    // Il contenitore dell'icona è un fratello che precede l'h2 nel DOM:
    // introduce la sezione, non la annota come farebbe un ornamento dopo il
    // titolo.
    expect(titolo?.querySelector('.title-icon ~ h2')).not.toBeNull();
    expect(host().querySelector('.actions [data-test="icona"]')).toBeNull();
  });
});
