import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { toErrorMessage } from '../../core/http-error';
import { Panel } from '@shared/layout/panel/panel';
import { PageLayout } from '@shared/layout/page-layout/page-layout';
import { SectionHeader } from '@shared/layout/section-header/section-header';
import { EmptyState } from '@shared/ui/feedback/empty-state/empty-state';
import { ErrorRetry } from '@shared/ui/feedback/error-retry/error-retry';
import { SearchInput } from '@shared/ui/forms/search-input/search-input';
import { Select } from '@shared/ui/forms/select/select';
import { CategoriesApi } from './categories.api';
import { CategoryTile } from './category-tile/category-tile';
import {
  CATEGORY_SORT_OPTIONS,
  CategorySort,
  filterCategories,
  sortCategories
} from './category-list';
import { CategoryWithUsage } from './category.model';

const FALLBACK_CATEGORY_ID = 'c9bfcd74-e342-4a3f-8b0c-116f89236d51';

@Component({
  selector: 'app-categories-page',
  imports: [
    CategoryTile,
    EmptyState,
    ErrorRetry,
    PageLayout,
    Panel,
    SearchInput,
    Select,
    SectionHeader
  ],
  templateUrl: './categories-page.html',
  styleUrl: './categories-page.scss'
})
export class CategoriesPage implements OnInit {
  private readonly api = inject(CategoriesApi);

  protected readonly sortOptions = CATEGORY_SORT_OPTIONS;
  /** Segnaposto dello skeleton: dodici rettangoli nella stessa griglia delle tessere. */
  protected readonly skeletonTiles = Array.from({ length: 12 });

  protected readonly categories = signal<CategoryWithUsage[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  /** Errori di salvataggio, creazione ed eliminazione. */
  protected readonly actionError = signal<string | null>(null);

  protected readonly search = signal('');
  protected readonly sort = signal<CategorySort>('name-asc');
  protected readonly visible = computed(() =>
    sortCategories(filterCategories(this.categories(), this.search()), this.sort())
  );

  protected readonly savingIds = signal<ReadonlySet<string>>(new Set());

  protected readonly confirmingDeleteId = signal<string | null>(null);
  protected readonly deleting = signal(false);

  protected readonly drafting = signal(false);
  protected readonly creating = signal(false);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.api.list().subscribe({
      next: (categories) => {
        this.categories.set(categories);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loadError.set(toErrorMessage(error));
        this.loading.set(false);
      }
    });
  }

  protected isProtected(id: string): boolean {
    return id === FALLBACK_CATEGORY_ID;
  }

  protected openDraft(): void {
    this.actionError.set(null);
    this.drafting.set(true);
  }

  protected resetSearch(): void {
    this.search.set('');
  }

  protected create(draft: { name: string; color: string }): void {
    if (this.creating()) {
      return;
    }

    this.creating.set(true);
    this.actionError.set(null);

    this.api.create(draft).subscribe({
      next: (created) => {
        this.categories.update((categories) => [...categories, { ...created, merchantCount: 0 }]);
        // Una ricerca che non la comprende nasconderebbe la categoria appena creata.
        if (filterCategories([created], this.search()).length === 0) {
          this.search.set('');
        }
        this.drafting.set(false);
        this.creating.set(false);
      },
      error: (error: unknown) => {
        // La bozza resta aperta con il testo digitato.
        this.actionError.set(toErrorMessage(error));
        this.creating.set(false);
      }
    });
  }

  protected rename(category: CategoryWithUsage, name: string): void {
    this.save(category.id, this.api.update(category.id, { name }));
  }

  protected recolor(category: CategoryWithUsage, color: string): void {
    this.save(category.id, this.api.update(category.id, { color }));
  }

  private save(categoryId: string, request: ReturnType<CategoriesApi['update']>): void {
    this.setSaving(categoryId, true);
    this.actionError.set(null);

    request.subscribe({
      next: (updated) => {
        this.categories.update((categories) =>
          categories.map((category) => (category.id === updated.id ? updated : category))
        );
        this.setSaving(categoryId, false);
      },
      error: (error: unknown) => {
        this.actionError.set(toErrorMessage(error));
        this.setSaving(categoryId, false);
        this.load();
      }
    });
  }

  /** Aggiunge o toglie l'id creando sempre un nuovo `Set`, così il segnale notifica. */
  private setSaving(id: string, saving: boolean): void {
    this.savingIds.update((ids) => {
      const next = new Set(ids);
      if (saving) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  protected askDelete(id: string): void {
    this.actionError.set(null);
    this.confirmingDeleteId.set(id);
  }

  protected cancelDelete(): void {
    this.confirmingDeleteId.set(null);
  }

  protected deleteCategory(category: CategoryWithUsage): void {
    this.deleting.set(true);
    this.actionError.set(null);

    this.api.delete(category.id).subscribe({
      next: () => {
        this.categories.update((categories) => categories.filter((c) => c.id !== category.id));
        this.deleting.set(false);
        this.confirmingDeleteId.set(null);
      },
      error: (error: unknown) => {
        this.actionError.set(toErrorMessage(error));
        this.deleting.set(false);
        this.confirmingDeleteId.set(null);
      }
    });
  }
}
