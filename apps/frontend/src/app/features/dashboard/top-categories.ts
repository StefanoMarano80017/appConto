import { Component, computed, input } from '@angular/core';
import { Params, RouterLink } from '@angular/router';
import { formatAmount, formatPercent } from '../../core/format';
import { Panel } from '@shared/layout/panel/panel';
import { SectionHeader } from '@shared/layout/section-header/section-header';
import { Amount } from '@shared/ui/data/amount/amount';
import { ColorMarkerComponent } from '@shared/ui/data/color-marker/color-marker';
import { EmptyState } from '@shared/ui/feedback/empty-state/empty-state';
import { DashboardCategory } from './dashboard.model';

/** I tipi che fanno spesa: gli stessi da cui il backend ricava le categorie. */
const SPENDING_TYPES = 'EXPENSE,LOAN';

/** La variazione rispetto al mese precedente, già pronta da mostrare. */
interface CategoryChange {
  readonly text: string;
  /** Più spesa è una cattiva notizia: tono invertito rispetto al segno. */
  readonly tone: 'positive' | 'negative';
}

interface CategoryRow {
  readonly category: DashboardCategory;
  readonly queryParams: Params;
  /** `null` se la spesa non è cambiata: nessuna freccia. */
  readonly change: CategoryChange | null;
}

/**
 * «Dove sono andati i soldi»: le categorie più spese del mese mostrato.
 *
 * Ogni riga apre Movimenti filtrato su quella categoria, sul mese e sui tipi
 * che fanno spesa. La variazione è una freccia con l'importo senza segno
 * («↑ 12,30 €»): un segno davanti a una spesa già negativa sarebbe un doppio
 * negativo da decifrare.
 */
@Component({
  selector: 'app-top-categories',
  imports: [Amount, ColorMarkerComponent, EmptyState, Panel, RouterLink, SectionHeader],
  templateUrl: './top-categories.html',
  styleUrl: './top-categories.scss'
})
export class TopCategories {
  readonly categories = input.required<DashboardCategory[]>();
  /** Primo e ultimo giorno del mese mostrato, per i collegamenti a Movimenti. */
  readonly range = input.required<{ from: string; to: string }>();

  protected readonly formatPercent = formatPercent;

  // Calcolate qui e non nel template: oggetti nuovi a ogni rendering farebbero
  // ricalcolare l'indirizzo a ogni `routerLink` per niente.
  protected readonly rows = computed<CategoryRow[]>(() => {
    const { from, to } = this.range();

    return this.categories().map((category) => ({
      category,
      queryParams:
        category.id === null
          ? { classification: 'unclassified', types: SPENDING_TYPES, from, to }
          : { categoryIds: category.id, types: SPENDING_TYPES, from, to },
      change: categoryChange(category.difference)
    }));
  });
}

function categoryChange(difference: number): CategoryChange | null {
  if (difference === 0) {
    return null;
  }

  return {
    text: `${difference > 0 ? '↑' : '↓'} ${formatAmount(Math.abs(difference))}`,
    tone: difference > 0 ? 'negative' : 'positive'
  };
}
