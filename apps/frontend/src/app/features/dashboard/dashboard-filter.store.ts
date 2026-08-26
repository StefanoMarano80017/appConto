import { Injectable, computed, signal } from '@angular/core';
import { currentMonth } from '../../core/format';
import { TransactionType } from '../transactions/transaction-type';

/**
 * Stato dei filtri della dashboard.
 *
 * È l'unico posto in cui vive il mese selezionato: nessuna sezione ne possiede
 * una copia, quindi non possono mostrare periodi diversi.
 */
export interface DashboardFilterState {
  month: string;
  type: TransactionType | null;
  categoryId: string | null;
  merchantId: string | null;
}

const INITIAL_STATE: DashboardFilterState = {
  month: currentMonth(),
  type: null,
  categoryId: null,
  merchantId: null
};

@Injectable({ providedIn: 'root' })
export class DashboardFilterStore {
  private readonly state = signal<DashboardFilterState>(INITIAL_STATE);

  readonly filters = this.state.asReadonly();
  readonly month = computed(() => this.state().month);

  /** Quanti filtri, oltre al mese, sono attivi. */
  readonly activeCount = computed(() => {
    const { type, categoryId, merchantId } = this.state();

    return [type, categoryId, merchantId].filter((value) => value !== null).length;
  });

  setMonth(month: string): void {
    this.state.update((state) => ({ ...state, month }));
  }

  setType(type: TransactionType | null): void {
    this.state.update((state) => ({ ...state, type }));
  }

  setCategory(categoryId: string | null): void {
    this.state.update((state) => ({ ...state, categoryId }));
  }

  setMerchant(merchantId: string | null): void {
    this.state.update((state) => ({ ...state, merchantId }));
  }

  /** Azzera i filtri mantenendo il mese osservato. */
  clearFilters(): void {
    this.state.update(({ month }) => ({ ...INITIAL_STATE, month }));
  }
}
