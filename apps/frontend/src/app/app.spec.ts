import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes), provideHttpClient()],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('mostra il marchio', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.brand')?.textContent?.trim()).toBe('Personal Finance Tracker');
  });

  it('mostra le otto voci di navigazione, raggruppate in tre sezioni con etichetta', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    const hrefs = Array.from(host.querySelectorAll<HTMLAnchorElement>('.nav a')).map((a) =>
      a.getAttribute('href')
    );
    expect(hrefs).toEqual([
      '/',
      '/transactions',
      '/analytics',
      '/loans',
      '/categories',
      '/merchants',
      '/import',
      '/settings',
    ]);

    const groupLabels = Array.from(host.querySelectorAll<HTMLElement>('.nav-group-label'));
    expect(groupLabels.map((label) => label.textContent?.trim())).toEqual([
      'Generale',
      'Organizza',
      'Sistema',
    ]);

    // Ogni gruppo è una sezione con nome accessibile: la sua etichetta ha un
    // id e l'<ul> che la segue lo referenzia via aria-labelledby.
    const lists = Array.from(host.querySelectorAll<HTMLUListElement>('.nav-list'));
    expect(lists).toHaveLength(3);
    lists.forEach((list, index) => {
      expect(list.getAttribute('role')).toBe('list');

      const labelledBy = list.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      expect(host.querySelector(`#${labelledBy}`)).toBe(groupLabels[index]);
    });
  });

  /*
   * Il titolo di rotta arriva nella shell dentro la fascia superiore, ed è
   * l'unico <h1> dell'app: le pagine sono state ripulite dal proprio titolo
   * duplicato (o l'hanno declassato a h2/rimosso quando non aggiungeva nulla
   * che la rotta non dicesse già). Questo test cerca comunque solo dentro
   * `.topbar`, per restare mirato a ciò che la shell produce.
   *
   * `TestBed.createComponent` da solo non avvia la navigazione iniziale del
   * router (a differenza del bootstrap reale via `bootstrapApplication`):
   * va richiesta esplicitamente, altrimenti `Title` non si aggiorna mai e il
   * test passerebbe per il motivo sbagliato.
   */
  it('mostra il titolo della rotta corrente in un h1 nella barra superiore', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);

    await router.navigateByUrl('/');
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    const heading = host.querySelector('.topbar h1');
    expect(heading).not.toBeNull();
    expect(heading?.textContent?.trim()).toBe('Riepilogo');
  });

  /*
   * Non basta che il titolo sia corretto alla prima rotta: deve seguire il
   * router ad ogni navigazione successiva, che è il caso che l'effect in
   * app.ts esiste per coprire (un segnale letto una sola volta, senza
   * `effect`, non si aggiornerebbe più dopo la creazione).
   */
  it("aggiorna il titolo quando si naviga verso un'altra rotta", async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);

    await router.navigateByUrl('/');
    await fixture.whenStable();

    await router.navigateByUrl('/analytics');
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.topbar h1')?.textContent?.trim()).toBe('Analytics');
  });
});
