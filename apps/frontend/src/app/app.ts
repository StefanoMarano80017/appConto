import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ThemeStore } from './core/theme';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly themeStore = inject(ThemeStore);

  protected readonly theme = this.themeStore.theme;
  /** L'etichetta dice cosa succede premendo, non com'è ora. */
  protected readonly themeAction = computed(() =>
    this.theme() === 'dark' ? 'Modalità giorno' : 'Modalità notte'
  );

  protected toggleTheme(): void {
    this.themeStore.toggle();
  }
}
