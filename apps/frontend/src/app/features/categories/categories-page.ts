import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toErrorMessage } from '../../core/http-error';
import { Panel } from '../../shared/layout/panel';
import { PageLayout } from '../../shared/layout/page-layout';
import { SectionHeader } from '../../shared/layout/section-header';
import { CategoriesApi } from './categories.api';
import { CategoryWithUsage } from './category.model';

const FALLBACK_CATEGORY_ID = 'c9bfcd74-e342-4a3f-8b0c-116f89236d51';

@Component({
  selector: 'app-categories-page',
  imports: [FormsModule, PageLayout, Panel, SectionHeader],
  templateUrl: './categories-page.html',
  styleUrl: './categories-page.scss'
})
export class CategoriesPage implements OnInit {
  private readonly api = inject(CategoriesApi);

  protected readonly categories = signal<CategoryWithUsage[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly newName = signal('');
  protected readonly newColor = signal('#9aa3af');
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);

  protected readonly savingId = signal<string | null>(null);

  protected readonly confirmingDeleteId = signal<string | null>(null);
  protected readonly deleting = signal(false);

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

  protected create(event: Event): void {
    event.preventDefault();
    const name = this.newName().trim();
    if (name === '' || this.creating()) {
      return;
    }

    this.creating.set(true);
    this.createError.set(null);

    this.api.create({ name, color: this.newColor() }).subscribe({
      next: (created) => {
        this.categories.update((categories) => [...categories, { ...created, merchantCount: 0 }]);
        this.newName.set('');
        this.newColor.set('#9aa3af');
        this.creating.set(false);
      },
      error: (error: unknown) => {
        this.createError.set(toErrorMessage(error));
        this.creating.set(false);
      }
    });
  }

  protected rename(category: CategoryWithUsage, value: string): void {
    const name = value.trim();
    if (name === '' || name === category.name) {
      return;
    }

    this.save(category.id, this.api.update(category.id, { name }));
  }

  protected recolor(category: CategoryWithUsage, value: string): void {
    if (value === category.color) {
      return;
    }

    this.save(category.id, this.api.update(category.id, { color: value }));
  }

  private save(categoryId: string, request: ReturnType<CategoriesApi['update']>): void {
    this.savingId.set(categoryId);
    this.error.set(null);

    request.subscribe({
      next: (updated) => {
        this.categories.update((categories) =>
          categories.map((category) => (category.id === updated.id ? updated : category))
        );
        this.savingId.set(null);
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.savingId.set(null);
        this.load();
      }
    });
  }

  protected askDelete(id: string): void {
    this.error.set(null);
    this.confirmingDeleteId.set(id);
  }

  protected cancelDelete(): void {
    this.confirmingDeleteId.set(null);
  }

  protected deleteCategory(category: CategoryWithUsage): void {
    this.deleting.set(true);
    this.error.set(null);

    this.api.delete(category.id).subscribe({
      next: () => {
        this.categories.update((categories) => categories.filter((c) => c.id !== category.id));
        this.deleting.set(false);
        this.confirmingDeleteId.set(null);
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.deleting.set(false);
        this.confirmingDeleteId.set(null);
      }
    });
  }
}
