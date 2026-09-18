import { TestBed } from '@angular/core/testing';
import { THEME_STORAGE_KEY, ThemeStore, parseThemeMode, resolveTheme, toggledMode } from './theme';

describe('resolveTheme', () => {
  it('con la preferenza esplicita ignora il sistema', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('senza preferenza segue il sistema', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('parseThemeMode', () => {
  it('accetta le tre preferenze', () => {
    expect(parseThemeMode('system')).toBe('system');
    expect(parseThemeMode('light')).toBe('light');
    expect(parseThemeMode('dark')).toBe('dark');
  });

  it('su un valore assente o inatteso torna a seguire il sistema', () => {
    expect(parseThemeMode(null)).toBe('system');
    expect(parseThemeMode('')).toBe('system');
    expect(parseThemeMode('notte')).toBe('system');
  });
});

describe('toggledMode', () => {
  it('scrive sempre una preferenza esplicita', () => {
    // Spegnere la modalità notte mentre il sistema è scuro deve dare l'app chiara.
    expect(toggledMode('dark')).toBe('light');
    expect(toggledMode('light')).toBe('dark');
  });
});

describe('ThemeStore', () => {
  beforeEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY);
    document.documentElement.removeAttribute('data-theme');
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY);
    document.documentElement.removeAttribute('data-theme');
  });

  it('accende la modalità notte, la marca sulla radice e la ricorda', () => {
    const store = TestBed.inject(ThemeStore);

    store.toggle();
    TestBed.tick();

    expect(store.theme()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('riparte dalla preferenza salvata', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    const store = TestBed.inject(ThemeStore);
    TestBed.tick();

    expect(store.mode()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('tornando a seguire il sistema toglie la marca dalla radice', () => {
    const store = TestBed.inject(ThemeStore);

    store.select('light');
    TestBed.tick();
    expect(document.documentElement.dataset['theme']).toBe('light');

    store.select('system');
    TestBed.tick();

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });
});
