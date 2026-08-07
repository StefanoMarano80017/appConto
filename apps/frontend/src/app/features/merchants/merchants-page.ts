import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { formatAmount, formatBookingDate } from '../../core/format';
import { toErrorMessage } from '../../core/http-error';
import { CategoriesApi } from '../categories/categories.api';
import { Category } from '../categories/category.model';
import { MerchantFilter, filterMerchants } from './merchant-filter';
import { MerchantSummary } from './merchant.model';
import { MerchantsApi } from './merchants.api';

@Component({
  selector: 'app-merchants-page',
  imports: [FormsModule],
  templateUrl: './merchants-page.html',
  styleUrl: './merchants-page.scss'
})
export class MerchantsPage implements OnInit {
  private readonly api = inject(MerchantsApi);
  private readonly categoriesApi = inject(CategoriesApi);

  protected readonly merchants = signal<MerchantSummary[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly search = signal('');
  protected readonly filter = signal<MerchantFilter>('all');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Merchant con una modifica in corso. */
  protected readonly savingId = signal<string | null>(null);

  protected readonly visible = computed(() =>
    filterMerchants(this.merchants(), { search: this.search(), filter: this.filter() })
  );

  protected readonly counts = computed(() => {
    const all = this.merchants();
    const classified = all.filter((merchant) => merchant.category !== null).length;

    return { all: all.length, classified, unclassified: all.length - classified };
  });

  protected readonly formatAmount = formatAmount;
  protected readonly formatBookingDate = formatBookingDate;

  ngOnInit(): void {
    this.categoriesApi.list().subscribe({
      next: (categories) => this.categories.set(categories),
      error: (error: unknown) => this.error.set(toErrorMessage(error))
    });

    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.summary().subscribe({
      next: (merchants) => {
        this.merchants.set(merchants);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.loading.set(false);
      }
    });
  }

  protected changeCategory(merchant: MerchantSummary, selectedId: string): void {
    const categoryId = selectedId === '' ? null : selectedId;
    if ((merchant.category?.id ?? null) === categoryId) {
      return;
    }

    this.save(merchant.id, this.api.updateCategory(merchant.id, categoryId));
  }

  protected rename(merchant: MerchantSummary, value: string): void {
    const displayName = value.trim();
    if (displayName === (merchant.displayName ?? '')) {
      return;
    }

    this.save(merchant.id, this.api.updateDisplayName(merchant.id, displayName));
  }

  /** Applica la modifica localmente, conservando i totali già calcolati. */
  private save(merchantId: string, request: ReturnType<MerchantsApi['updateCategory']>): void {
    this.savingId.set(merchantId);
    this.error.set(null);

    request.subscribe({
      next: (updated) => {
        this.merchants.update((merchants) =>
          merchants.map((merchant) =>
            merchant.id === updated.id ? { ...merchant, ...updated } : merchant
          )
        );
        this.savingId.set(null);
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.savingId.set(null);
        this.load(); // ripristina lo stato mostrato a video
      }
    });
  }
}
