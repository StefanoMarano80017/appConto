import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PanelFooter } from './panel-footer';

@Component({
  imports: [PanelFooter],
  template: `
    <app-panel-footer>
      <span panelFooterLeft data-test="left">Nota</span>
      <button panelFooterRight data-test="right" type="button">Azione</button>
    </app-panel-footer>
  `,
})
class Host {}

describe('PanelFooter', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('proietta i contenuti negli slot sinistro e destro', () => {
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.left [data-test="left"]')?.textContent?.trim()).toBe('Nota');
    expect(host.querySelector('.left [data-test="right"]')).toBeNull();
    expect(host.querySelector('.right [data-test="right"]')?.textContent?.trim()).toBe('Azione');
    expect(host.querySelector('.right [data-test="left"]')).toBeNull();
  });
});
