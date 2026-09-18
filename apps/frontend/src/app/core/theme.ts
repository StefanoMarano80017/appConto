import { Injectable, computed, effect, signal } from '@angular/core';

/**
 * Tema chiaro e modalità notte.
 *
 * Tre stati e non due: `system` segue il sistema operativo, ed è il valore di
 * partenza perché chi tiene il computer in scuro si aspetta di trovare l'app
 * già scura. `light` e `dark` sono la scelta esplicita dell'utente, che vince
 * sul sistema e sopravvive alla chiusura dell'app.
 *
 * La scelta resta nel browser (`localStorage`) e non nel database: è una
 * preferenza di questo schermo, non un dato del conto — un backup ripristinato
 * su un altro computer non deve portarsi dietro il tema di questo.
 */

export type ThemeMode = 'system' | 'light' | 'dark';

/** Il tema effettivamente applicato: `system` è già stato risolto. */
export type Theme = 'light' | 'dark';

/** Chiave in `localStorage`. Il prefisso evita collisioni su `localhost`. */
export const THEME_STORAGE_KEY = 'appconto.theme';

const MODES: ThemeMode[] = ['system', 'light', 'dark'];

/** Legge una preferenza salvata; qualsiasi valore inatteso ricade su `system`. */
export function parseThemeMode(raw: string | null): ThemeMode {
  return MODES.find((mode) => mode === raw) ?? 'system';
}

/** Il tema da applicare, viste la preferenza e l'impostazione del sistema. */
export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): Theme {
  if (mode === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }

  return mode;
}

/**
 * La preferenza che un interruttore acceso/spento deve scrivere.
 *
 * Sempre esplicita: chi spegne la modalità notte mentre il sistema è scuro
 * vuole l'app chiara, non "come il sistema".
 */
export function toggledMode(current: Theme): ThemeMode {
  return current === 'dark' ? 'light' : 'dark';
}

@Injectable({ providedIn: 'root' })
export class ThemeStore {
  private readonly systemPrefersDark = signal(false);

  readonly mode = signal<ThemeMode>('system');
  readonly theme = computed(() => resolveTheme(this.mode(), this.systemPrefersDark()));

  constructor() {
    this.mode.set(parseThemeMode(readStoredMode()));
    this.watchSystemPreference();

    effect(() => {
      applyTheme(this.theme(), this.mode());
      storeMode(this.mode());
    });
  }

  select(mode: ThemeMode): void {
    this.mode.set(mode);
  }

  /** Accende o spegne la modalità notte, qualunque fosse la preferenza. */
  toggle(): void {
    this.mode.set(toggledMode(this.theme()));
  }

  /** Tiene il tema allineato al sistema mentre l'app è aperta. */
  private watchSystemPreference(): void {
    if (typeof matchMedia !== 'function') {
      return;
    }

    const query = matchMedia('(prefers-color-scheme: dark)');
    this.systemPrefersDark.set(query.matches);
    query.addEventListener('change', (event) => this.systemPrefersDark.set(event.matches));
  }
}

/**
 * Marca la radice col tema.
 *
 * `data-theme` porta la scelta esplicita; con `system` l'attributo va rimosso,
 * perché il tema torni a dipendere da `prefers-color-scheme` nel CSS.
 */
function applyTheme(theme: Theme, mode: ThemeMode): void {
  const root = document.documentElement;

  if (mode === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.dataset['theme'] = theme;
  }
}

/*
 * `localStorage` può non esserci (finestra privata, dati del sito bloccati) e
 * il solo accesso può lanciare: un tema non salvato è un fastidio, un'app che
 * non parte è un guasto.
 */

function readStoredMode(): string | null {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // pazienza: il tema vale per questa sessione
  }
}
