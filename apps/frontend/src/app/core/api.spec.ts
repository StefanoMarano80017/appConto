import { API_BASE_URL } from './api';

describe('API_BASE_URL', () => {
  it('è un percorso sulla stessa origine', () => {
    expect(API_BASE_URL).toBe('/api');
  });

  it('non contiene un indirizzo assoluto', () => {
    // Un URL assoluto rimetterebbe nel frontend la conoscenza di dove gira il
    // backend, e romperebbe una delle due modalità: in produzione l'origine è
    // quella di Express, in sviluppo quella del dev server con il proxy.
    expect(API_BASE_URL.startsWith('/')).toBe(true);
    expect(API_BASE_URL).not.toMatch(/^[a-z]+:/);
    expect(API_BASE_URL).not.toContain('//');
  });
});
