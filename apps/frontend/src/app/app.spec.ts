import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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

  it('mostra il marchio e le otto voci di navigazione', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.brand')?.textContent?.trim()).toBe('Personal Finance Tracker');

    const hrefs = Array.from(host.querySelectorAll<HTMLAnchorElement>('.nav a')).map((a) =>
      a.getAttribute('href')
    );
    expect(hrefs).toEqual([
      '/',
      '/analytics',
      '/transactions',
      '/loans',
      '/merchants',
      '/categories',
      '/import',
      '/settings',
    ]);
  });
});
