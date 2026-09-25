import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SectionHeader } from './section-header';

describe('SectionHeader', () => {
  let fixture: ComponentFixture<SectionHeader>;

  const render = async () => {
    fixture = TestBed.createComponent(SectionHeader);
    fixture.componentRef.setInput('title', 'Analytics');
    await fixture.whenStable();
  };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SectionHeader] }).compileComponents();
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
});
