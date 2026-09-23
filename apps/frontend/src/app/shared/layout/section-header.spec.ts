import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SectionHeader } from './section-header';

describe('SectionHeader', () => {
  let fixture: ComponentFixture<SectionHeader>;

  const render = async (level?: 'page' | 'section') => {
    fixture = TestBed.createComponent(SectionHeader);
    fixture.componentRef.setInput('title', 'Analytics');
    if (level !== undefined) {
      fixture.componentRef.setInput('level', level);
    }
    await fixture.whenStable();
  };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SectionHeader] }).compileComponents();
  });

  it('rende un h2 per default, senza cambiare i nove usi esistenti', async () => {
    await render();

    expect(host().querySelector('h2')?.textContent?.trim()).toBe('Analytics');
    expect(host().querySelector('h1')).toBeNull();
  });

  it('rende un h1 quando è il titolo della pagina', async () => {
    await render('page');

    expect(host().querySelector('h1')?.textContent?.trim()).toBe('Analytics');
    expect(host().querySelector('h2')).toBeNull();
  });
});
