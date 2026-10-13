import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { ChartTooltip } from './chart-tooltip';

@Component({
  imports: [ChartTooltip],
  template: `
    <app-chart-tooltip [title]="title" [left]="left" [side]="side">
      <div chartTooltipContent data-test="content">Valore</div>
      <button chartTooltipFooter data-test="footer" type="button">Filtra</button>
    </app-chart-tooltip>
  `,
})
class Host {
  title = 'settimana del 6 luglio';
  left = 75;
  side: 'left' | 'right' = 'left';
}

describe('ChartTooltip', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('compone panel, intestazione, corpo e footer proiettato', () => {
    const host = fixture.nativeElement as HTMLElement;
    const tooltip = host.querySelector('app-chart-tooltip');

    expect(host.querySelector('app-panel')).not.toBeNull();
    expect(host.querySelector('app-section-header h2')?.textContent?.trim()).toBe(
      'settimana del 6 luglio',
    );
    expect(host.querySelector('[data-test="content"]')?.textContent?.trim()).toBe('Valore');
    expect(host.querySelector('app-panel-footer [data-test="footer"]')?.textContent?.trim()).toBe(
      'Filtra',
    );
    expect(tooltip?.classList.contains('left-side')).toBe(true);
    expect((tooltip as HTMLElement | null)?.style.left).toBe('75%');
  });

  it('emette dismiss con Escape e dal pulsante di chiusura', async () => {
    const host = fixture.nativeElement as HTMLElement;
    const tooltip = host.querySelector('app-chart-tooltip')!;
    const dismiss = vi.fn();
    fixture.debugElement
      .query(By.directive(ChartTooltip))
      .componentInstance.dismiss.subscribe(dismiss);

    tooltip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(dismiss).toHaveBeenCalledTimes(1);

    host.querySelector<HTMLButtonElement>('.tooltip-close')?.click();
    expect(dismiss).toHaveBeenCalledTimes(2);
  });
});
