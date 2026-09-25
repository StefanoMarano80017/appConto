import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import {
  LucideArrowLeftRight,
  LucideChartColumn,
  LucideHandCoins,
  LucideLayoutDashboard,
  LucideMoon,
  LucideSettings,
  LucideStore,
  LucideSun,
  LucideTag,
  LucideUpload
} from '@lucide/angular';
import { ThemeStore } from './core/theme';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    LucideArrowLeftRight,
    LucideChartColumn,
    LucideHandCoins,
    LucideLayoutDashboard,
    LucideMoon,
    LucideSettings,
    LucideStore,
    LucideSun,
    LucideTag,
    LucideUpload
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly themeStore = inject(ThemeStore);
  private readonly router = inject(Router);
  private readonly titleService = inject(Title);

  protected readonly theme = this.themeStore.theme;
  /** L'etichetta dice cosa succede premendo, non com'è ora. */
  protected readonly themeAction = computed(() =>
    this.theme() === 'dark' ? 'Modalità giorno' : 'Modalità notte'
  );

  /**
   * Emette ad ogni navigazione completata. Non ci serve il valore
   * dell'evento, solo il "quando": è il segnale che fa ricalcolare
   * `pageTitle` qui sotto.
   */
  private readonly navigationEnd = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd)
    )
  );

  /**
   * Il titolo della rotta corrente, per l'`<h1>` della barra superiore.
   *
   * Le rotte dichiarano già `title:` in `app.routes.ts` e il Router aggiorna
   * da sé il servizio `Title` — ma lo fa *subito dopo* aver emesso
   * `NavigationEnd`, nella stessa chiamata sincrona (`Router.activateRoutes`
   * emette l'evento e poi chiama `titleStrategy.updateTitle`). Leggere il
   * titolo dentro un operatore agganciato a `NavigationEnd` (un `map` su
   * `toSignal`, la via più ovvia) leggerebbe quindi ancora il titolo della
   * pagina precedente.
   *
   * Un `effect` risolve l'ordine: gira dopo il giro sincrono corrente, a
   * quel punto l'aggiornamento del `Title` è già avvenuto. Funziona senza
   * zone.js perché non è un ciclo di change detection a farlo scattare, ma
   * il grafo dei signal stesso: cambia `navigationEnd()`, l'effect viene
   * pianificato di conseguenza.
   */
  protected readonly pageTitle = signal(this.titleService.getTitle());

  constructor() {
    effect(() => {
      this.navigationEnd();
      this.pageTitle.set(this.titleService.getTitle());
    });
  }

  protected toggleTheme(): void {
    this.themeStore.toggle();
  }
}
