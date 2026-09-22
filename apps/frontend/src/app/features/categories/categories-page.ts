import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toErrorMessage } from '../../core/http-error';
import { Panel } from '../../shared/layout/panel';
import { PanelActionsDirective, SectionHeader } from '../../shared/layout/section-header';
import { CategoriesApi } from './categories.api';
import { CategoryWithUsage } from './category.model';

/**
 * L'id fisso di "Da classificare": non rinominabile né eliminabile.
 *
 * Duplicato rispetto a `FALLBACK_CATEGORY_ID` nel backend
 * (`categories.service.ts`) perché il progetto non condivide codice fra le
 * due app.
 */
const FALLBACK_CATEGORY_ID = 'c9bfcd74-e342-4a3f-8b0c-116f89236d51';

/**
 * Gestione delle categorie di spesa.
 *
 * Crea, rinomina, ricolora ed elimina: le categorie sono configurazione a
 * runtime, non più un elenco fisso deciso al primo avvio.
 */
@Component({
  selector: 'app-categories-page',
  imports: [FormsModule, Panel, SectionHeader, PanelActionsDirective],
  templateUrl: './categories-page.html',
  styleUrl: './categories-page.scss'
})
export class CategoriesPage implements OnInit {
  private readonly api = inject(CategoriesApi);

  protected readonly categories = signal<CategoryWithUsage[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.list().subscribe({
      next: (categories) => {
        this.categories.set(categories);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.loading.set(false);
      }
    });
  }

  protected isProtected(id: string): boolean {
    return id === FALLBACK_CATEGORY_ID;
  }
}
